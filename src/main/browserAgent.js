/**
 * Browser Agent — Goal-driven autonomous web browsing.
 *
 * Takes a natural language goal ("book a flight to London", "find the cheapest laptop",
 * "fill out the contact form") and uses AI + browser tools to achieve it.
 *
 * Architecture:
 * 1. User provides a goal
 * 2. Agent analyzes current page state (interactive elements, structure)
 * 3. AI decides next action (click, type, navigate, extract, scroll)
 * 4. Action is executed via browser.js
 * 5. Agent verifies result and loops until goal is achieved or max steps reached
 */

const { logger } = require('./logger');
const browser = require('./browser');

let _makeAICall = null;
let _mainWindow = null;
let _providerConfig = null;

// Active agent sessions
const _sessions = new Map(); // sessionId -> { goal, steps, status, startedAt, tabId, result }

const MAX_STEPS = 30;
const STEP_TIMEOUT = 30000; // 30s per step

// ══════════════════════════════════════════
//  Setup
// ══════════════════════════════════════════

function setAICallFunction(fn) { _makeAICall = fn; }
function setMainWindow(win) { _mainWindow = win; }
function setProviderConfig(config) { _providerConfig = config; }

function emit(event, data) {
    if (_mainWindow && !_mainWindow.isDestroyed()) {
        try { _mainWindow.webContents.send(event, data); } catch {}
    }
}

// ══════════════════════════════════════════
//  Page State Builder
// ══════════════════════════════════════════

/**
 * Build a concise text representation of the current page state
 * that the AI can reason about to decide the next action.
 */
async function buildPageState(page) {
    try {
        const elements = await browser.getInteractiveElements();
        const structure = await browser.getPageStructure();
        if (elements.error || structure.error) {
            return { error: elements.error || structure.error };
        }

        // Build a compact text representation
        let state = `## Current Page\n`;
        state += `URL: ${structure.url}\n`;
        state += `Title: ${structure.title}\n\n`;

        if (structure.meta_description) {
            state += `Description: ${structure.meta_description}\n\n`;
        }

        // Main content (truncated)
        if (structure.main_text) {
            state += `### Page Content (preview)\n${structure.main_text.slice(0, 1500)}\n\n`;
        }

        // Interactive elements formatted for AI
        state += `### Interactive Elements\n`;

        if (elements.buttons && elements.buttons.length > 0) {
            state += `\n**Buttons:**\n`;
            for (const btn of elements.buttons) {
                state += `  [${btn.index}] "${btn.text}" → selector: \`${btn.selector}\`\n`;
            }
        }

        if (elements.links && elements.links.length > 0) {
            state += `\n**Links:**\n`;
            for (const link of elements.links.slice(0, 20)) {
                state += `  [${link.index}] "${link.text}" → ${link.href} → selector: \`${link.selector}\`\n`;
            }
        }

        if (elements.inputs && elements.inputs.length > 0) {
            state += `\n**Input Fields:**\n`;
            for (const input of elements.inputs) {
                const label = input.ariaLabel || input.placeholder || input.name || input.type;
                const val = input.value ? ` (current: "${input.value}")` : '';
                state += `  [${input.index}] ${input.tag}[${input.type}] "${label}"${val} → selector: \`${input.selector}\`\n`;
            }
        }

        if (elements.selects && elements.selects.length > 0) {
            state += `\n**Dropdowns:**\n`;
            for (const sel of elements.selects) {
                state += `  [${sel.index}] "${sel.text}" → selector: \`${sel.selector}\`\n`;
            }
        }

        // Forms
        if (structure.forms && structure.forms.length > 0) {
            state += `\n**Forms:**\n`;
            for (const form of structure.forms) {
                state += `  Form: ${form.action || '(no action)'} — ${form.fields?.length || 0} fields\n`;
            }
        }

        // Tables
        if (structure.tables && structure.tables.count > 0) {
            state += `\n**Tables:** ${structure.tables.count} table(s)\n`;
            for (const t of (structure.tables.list || [])) {
                state += `  Table: ${t.headers?.join(', ') || 'no headers'} — ${t.rowCount} rows\n`;
            }
        }

        return { state, elementCount: elements.total || 0 };
    } catch (err) {
        return { error: `Failed to build page state: ${err.message}` };
    }
}

// ══════════════════════════════════════════
//  Agent Action Parser
// ══════════════════════════════════════════

/**
 * Parse the AI's response into an executable action.
 * The AI responds with a JSON action block.
 */
function parseAction(aiResponse) {
    // Try to extract JSON from the response
    const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)```/) ||
                      aiResponse.match(/\{[\s\S]*"action"\s*:[\s\S]*\}/);

    if (jsonMatch) {
        try {
            const raw = jsonMatch[1] || jsonMatch[0];
            return JSON.parse(raw);
        } catch {}
    }

    // Try the whole response as JSON
    try {
        return JSON.parse(aiResponse);
    } catch {}

    // Check for done/complete signal in text
    if (/\b(done|complete|finished|achieved|goal\s*reached)\b/i.test(aiResponse)) {
        return { action: 'done', summary: aiResponse };
    }

    return null;
}

// ══════════════════════════════════════════
//  Action Executor
// ══════════════════════════════════════════

async function executeAction(action) {
    const type = action.action;

    try {
        switch (type) {
            case 'navigate': {
                return await browser.navigate(action.url, { waitUntil: action.wait_until || 'load' });
            }
            case 'click': {
                const result = await browser.click(action.selector);
                // Wait briefly for page to update after click
                await new Promise(r => setTimeout(r, action.wait || 1000));
                return result;
            }
            case 'type': {
                // Clear field first if requested
                if (action.clear) {
                    await browser.evaluate(`document.querySelector('${action.selector.replace(/'/g, "\\'")}').value = ''`);
                }
                return await browser.type(action.selector, action.text);
            }
            case 'select': {
                return await browser.selectOption(action.selector, action.value);
            }
            case 'scroll': {
                return await browser.scrollTo({
                    selector: action.selector,
                    direction: action.direction,
                    amount: action.amount,
                    toBottom: action.to_bottom,
                    toTop: action.to_top,
                });
            }
            case 'wait': {
                if (action.selector) {
                    return await browser.waitForSelector(action.selector, { timeout: action.timeout || 10000 });
                }
                await new Promise(r => setTimeout(r, action.ms || 2000));
                return { success: true, waited: action.ms || 2000 };
            }
            case 'extract_table': {
                return await browser.extractTables(action.selector);
            }
            case 'extract_links': {
                return await browser.extractLinks(action.filter);
            }
            case 'fill_form': {
                return await browser.fillForm(action.fields);
            }
            case 'screenshot': {
                return await browser.screenshot({ name: action.name || `agent_${Date.now()}`, fullPage: action.full_page });
            }
            case 'evaluate': {
                return await browser.evaluate(action.script);
            }
            case 'open_tab': {
                return await browser.openTab(action.url);
            }
            case 'switch_tab': {
                return await browser.switchTab(action.tab_id);
            }
            case 'back': {
                const page = browser.getActivePage ? browser.getActivePage() : null;
                if (page) { await page.goBack({ waitUntil: 'load' }); }
                return { success: true, action: 'back' };
            }
            case 'done': {
                return { done: true, summary: action.summary || action.result || 'Goal completed' };
            }
            case 'fail': {
                return { done: true, failed: true, reason: action.reason || 'Agent could not complete the goal' };
            }
            default:
                return { error: `Unknown action: ${type}` };
        }
    } catch (err) {
        return { error: `Action "${type}" failed: ${err.message}` };
    }
}

// ══════════════════════════════════════════
//  Browser Agent Loop
// ══════════════════════════════════════════

const AGENT_SYSTEM_PROMPT = `You are a browser automation agent. You control a real web browser to achieve user goals.

You receive the current page state (URL, visible text, interactive elements with selectors) and must decide the next action.

RESPOND WITH ONLY A JSON OBJECT — no explanation text before or after.

Available actions:
- {"action": "navigate", "url": "https://..."} — Go to a URL
- {"action": "click", "selector": "...", "wait": 1000} — Click an element (wait ms after click, default 1000)
- {"action": "type", "selector": "...", "text": "...", "clear": true} — Type into input (clear first if true)
- {"action": "select", "selector": "...", "value": "..."} — Select dropdown option
- {"action": "scroll", "selector": "...", "direction": "down", "amount": 500} — Scroll (or to_bottom: true, to_top: true)
- {"action": "wait", "selector": "...", "timeout": 5000} — Wait for element to appear
- {"action": "wait", "ms": 2000} — Wait fixed time
- {"action": "extract_table", "selector": "table.results"} — Extract table data
- {"action": "extract_links", "filter": "keyword"} — Extract links matching filter
- {"action": "fill_form", "fields": [{"label": "Email", "value": "..."}, ...]} — Fill multiple form fields
- {"action": "screenshot", "name": "step_1"} — Take screenshot for reference
- {"action": "evaluate", "script": "..."} — Run JavaScript on page
- {"action": "open_tab", "url": "..."} — Open new tab
- {"action": "switch_tab", "tab_id": "tab_1"} — Switch to tab
- {"action": "back"} — Go back to previous page
- {"action": "done", "summary": "Describe what was accomplished", "result": {...}} — Goal achieved
- {"action": "fail", "reason": "Why the goal cannot be completed"} — Cannot continue

Rules:
1. ONLY use CSS selectors from the "Interactive Elements" section — they are auto-generated and guaranteed valid
2. NEVER construct selectors like :has-text(), :contains(), or guess complex paths — they will fail
3. After clicking or typing, the page state will refresh — check new elements before acting
4. If a page asks for login/credentials, use action "done" with summary "Login required — tell the user to log in to [site] in the Onicode Chrome window (it opens automatically), then retry. Sessions persist after first login."
5. If you're stuck in a loop, try a different approach or use "fail"
6. Extract and include relevant data in "done" result
7. Be efficient — don't take unnecessary actions
8. If you need to fill a form, prefer "fill_form" over multiple "type" actions
9. When navigating to a new page, wait for it to load before interacting`;

/**
 * Run the browser agent to achieve a goal.
 * @param {string} goal - Natural language description of what to accomplish
 * @param {object} opts - { startUrl, maxSteps, sessionId, useChrome }
 * @returns {{ success, result, steps, error }}
 */
async function runAgent(goal, opts = {}) {
    if (!_makeAICall) return { error: 'AI call function not configured' };

    const sessionId = opts.sessionId || `bagent_${Date.now()}`;
    const maxSteps = opts.maxSteps || MAX_STEPS;
    const startUrl = opts.startUrl || null;

    // Track session
    const session = {
        goal,
        steps: [],
        status: 'running',
        startedAt: Date.now(),
        tabId: null,
        result: null,
    };
    _sessions.set(sessionId, session);

    emit('browser-agent-status', { sessionId, status: 'starting', goal });

    try {
        // Ensure browser is running
        const browserStatus = browser.getBrowserStatus();
        if (!browserStatus.running) {
            const launchResult = await browser.launchBrowser({
                useChrome: opts.useChrome !== false, // Default to Chrome
                headless: false,
            });
            if (launchResult.error) return { error: launchResult.error };
        }

        // Load saved cookies
        await browser.loadCookies();

        // Navigate to start URL if provided
        if (startUrl) {
            await browser.navigate(startUrl, { waitUntil: 'load' });
        }

        const messages = [
            { role: 'system', content: AGENT_SYSTEM_PROMPT },
            { role: 'user', content: `## Goal\n${goal}\n\n${startUrl ? `Starting URL: ${startUrl}` : 'No starting URL — navigate to where you need to go.'}` },
        ];

        // Agent loop
        for (let step = 0; step < maxSteps; step++) {
            // 1. Get current page state
            const pageState = await buildPageState();
            if (pageState.error) {
                session.steps.push({ step, error: pageState.error });
                emit('browser-agent-step', { sessionId, step, error: pageState.error });
                continue;
            }

            // Add page state to conversation
            messages.push({
                role: 'user',
                content: `## Step ${step + 1} — Current Page State\n\n${pageState.state}\n\nWhat is your next action? Respond with a JSON action object only.`,
            });

            emit('browser-agent-step', { sessionId, step: step + 1, status: 'thinking', url: pageState.state?.match(/URL: (.+)/)?.[1] });

            // 2. Ask AI for next action
            let aiResponse;
            try {
                aiResponse = await _makeAICall(messages, _providerConfig, { maxTokens: 1024, temperature: 0.1 });
            } catch (err) {
                session.steps.push({ step, error: `AI call failed: ${err.message}` });
                break;
            }

            if (!aiResponse) {
                session.steps.push({ step, error: 'Empty AI response' });
                break;
            }

            // Add AI response to conversation
            messages.push({ role: 'assistant', content: aiResponse });

            // 3. Parse action
            const action = parseAction(aiResponse);
            if (!action) {
                session.steps.push({ step, error: 'Could not parse AI action', raw: aiResponse.slice(0, 500) });
                messages.push({ role: 'user', content: 'I could not parse your response. Please respond with ONLY a valid JSON action object.' });
                continue;
            }

            logger.info('browser-agent', `Step ${step + 1}: ${action.action}${action.selector ? ` → ${action.selector}` : ''}${action.url ? ` → ${action.url}` : ''}`);

            emit('browser-agent-step', {
                sessionId,
                step: step + 1,
                action: action.action,
                detail: action.selector || action.url || action.text?.slice(0, 50) || '',
            });

            // 4. Check for done/fail
            if (action.action === 'done') {
                session.status = 'completed';
                session.result = action.result || action.summary || 'Goal achieved';
                session.steps.push({ step, action: 'done', result: session.result });
                break;
            }
            if (action.action === 'fail') {
                session.status = 'failed';
                session.result = action.reason || 'Agent could not complete the goal';
                session.steps.push({ step, action: 'fail', reason: session.result });
                break;
            }

            // 5. Execute action
            const result = await executeAction(action);
            session.steps.push({ step, action: action.action, result: typeof result === 'object' ? JSON.stringify(result).slice(0, 500) : result });

            if (result.error) {
                messages.push({ role: 'user', content: `Action failed: ${result.error}. Try a different approach.` });
            }

            // Brief pause between steps
            await new Promise(r => setTimeout(r, 500));
        }

        // Save cookies after browsing
        await browser.saveCookies();

        if (session.status === 'running') {
            session.status = 'max_steps';
            session.result = 'Reached maximum steps without completing the goal';
        }

        const duration = Date.now() - session.startedAt;

        emit('browser-agent-status', {
            sessionId,
            status: session.status,
            goal,
            steps: session.steps.length,
            duration,
            result: session.result,
        });

        return {
            success: session.status === 'completed',
            sessionId,
            goal,
            status: session.status,
            result: session.result,
            steps: session.steps,
            totalSteps: session.steps.length,
            duration,
        };

    } catch (err) {
        session.status = 'error';
        session.result = err.message;
        return { error: err.message, sessionId, steps: session.steps };
    }
}

// ══════════════════════════════════════════
//  Session Management
// ══════════════════════════════════════════

function getSession(sessionId) {
    return _sessions.get(sessionId) || null;
}

function listSessions() {
    return [..._sessions.entries()].map(([id, s]) => ({
        id,
        goal: s.goal,
        status: s.status,
        steps: s.steps.length,
        startedAt: s.startedAt,
        result: typeof s.result === 'string' ? s.result.slice(0, 200) : s.result,
    }));
}

function clearSessions() {
    _sessions.clear();
    return { success: true };
}

// ══════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════

function registerBrowserAgentIPC(ipcMain) {
    ipcMain.handle('browser-agent-run', (_event, goal, opts) => runAgent(goal, opts));
    ipcMain.handle('browser-agent-session', (_event, sessionId) => getSession(sessionId));
    ipcMain.handle('browser-agent-sessions', () => listSessions());
    ipcMain.handle('browser-agent-clear', () => clearSessions());
}

module.exports = {
    setAICallFunction,
    setMainWindow,
    setProviderConfig,
    runAgent,
    getSession,
    listSessions,
    clearSessions,
    registerBrowserAgentIPC,
};
