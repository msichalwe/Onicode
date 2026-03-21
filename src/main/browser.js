/**
 * Browser Agent — Chrome/Puppeteer browser automation for AI agents.
 * Supports connecting to user's actual Chrome browser for real browsing,
 * or launching headless Puppeteer for testing.
 *
 * Dual mode:
 *   - Headless Puppeteer (default) — fast, no UI, for testing
 *   - Chrome (useChrome: true) — real Chrome with user profile, for browsing
 *
 * Features: multi-tab, form filling, table/link extraction, cookies,
 * downloads, scroll, interactive element analysis, page structure.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const net = require('net');
const { logger } = require('./logger');

let puppeteer = null;
let browser = null;
let activePage = null;
let _activeTabId = 'tab_0';
const _pages = new Map(); // tabId -> { page, title, url }
const consoleLogs = [];
const MAX_CONSOLE_LOGS = 200;
let _chromeProcess = null; // Track Chrome process for cleanup
let _useChrome = false;
let _downloadPath = null;
let _tabCounter = 0;
const _agentTabs = new Map(); // agentId -> tabId — per-agent tab isolation

const SCREENSHOTS_DIR = path.join(os.homedir(), '.onicode', 'screenshots');
const DOWNLOADS_DIR = path.join(os.homedir(), '.onicode', 'downloads');
const COOKIES_PATH = path.join(os.homedir(), '.onicode', 'browser_cookies.json');
const CHROME_PROFILE_DIR = path.join(os.homedir(), '.onicode', 'chrome-profile');
const CHROME_USER_DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
let _debugPort = null;

if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

// Chrome executable paths by platform
const CHROME_PATHS = {
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    linux: '/usr/bin/google-chrome',
};

// ══════════════════════════════════════════
//  Lazy Puppeteer loader
// ══════════════════════════════════════════

function getPuppeteer() {
    if (puppeteer) return puppeteer;
    try {
        puppeteer = require('puppeteer');
        return puppeteer;
    } catch {
        try {
            puppeteer = require('puppeteer-core');
            return puppeteer;
        } catch {
            return null;
        }
    }
}

// ══════════════════════════════════════════
//  Utilities
// ══════════════════════════════════════════

/**
 * Find a free TCP port for Chrome remote debugging.
 * @returns {Promise<number>}
 */
function findFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
    });
}

/**
 * Wait for a TCP port to become reachable.
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function waitForPort(port, timeoutMs = 15000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        function attempt() {
            if (Date.now() - start > timeoutMs) {
                return reject(new Error(`Timed out waiting for port ${port} after ${timeoutMs}ms`));
            }
            const sock = net.createConnection({ port, host: '127.0.0.1' });
            sock.once('connect', () => {
                sock.destroy();
                resolve();
            });
            sock.once('error', () => {
                sock.destroy();
                setTimeout(attempt, 250);
            });
        }
        attempt();
    });
}

/**
 * Generate a unique tab ID.
 */
function nextTabId() {
    return `tab_${_tabCounter++}`;
}

/**
 * Find the tab ID that owns a given page instance.
 * @param {object} page - Puppeteer page
 * @returns {string|null} tabId or null
 */
function _findTabIdForPage(page) {
    if (!page) return null;
    for (const [tabId, entry] of _pages) {
        if (entry.page === page) return tabId;
    }
    return null;
}

// ══════════════════════════════════════════
//  Page listeners
// ══════════════════════════════════════════

function setupPageListeners(page) {
    // Capture console logs
    page.on('console', (msg) => {
        const entry = {
            type: msg.type(),
            text: msg.text(),
            ts: new Date().toISOString(),
        };
        consoleLogs.push(entry);
        if (consoleLogs.length > MAX_CONSOLE_LOGS) consoleLogs.shift();
    });

    // Capture page errors
    page.on('pageerror', (err) => {
        consoleLogs.push({
            type: 'error',
            text: `PAGE ERROR: ${err.message}`,
            ts: new Date().toISOString(),
        });
    });

    // Capture request failures
    page.on('requestfailed', (req) => {
        consoleLogs.push({
            type: 'warn',
            text: `REQUEST FAILED: ${req.url()} — ${req.failure()?.errorText || 'unknown'}`,
            ts: new Date().toISOString(),
        });
    });
}

// ══════════════════════════════════════════
//  Browser lifecycle
// ══════════════════════════════════════════

/**
 * Launch browser — headless Puppeteer or user's Chrome.
 * @param {object} opts - { useChrome, headless, width, height, downloadPath }
 */
async function launchBrowser(opts = {}) {
    const pptr = getPuppeteer();
    if (!pptr) {
        return { error: 'Puppeteer not installed. Run: npm install puppeteer' };
    }

    if (browser) {
        return { success: true, message: 'Browser already running', reused: true, useChrome: _useChrome };
    }

    try {
        // Default to Chrome mode — use user's real browser with sessions/cookies
        // Only use headless Puppeteer if explicitly requested via useChrome: false
        const useChrome = opts.useChrome !== false;

        if (useChrome) {
            // ── Connect to user's actual Chrome browser ──
            // Strategy:
            //   1. Check if Chrome is already running with debug port → connect
            //   2. If not, launch Chrome with user's REAL profile (all cookies/sessions)
            //   3. Fallback: use separate Onicode profile if user's profile is locked

            const chromePath = CHROME_PATHS[process.platform];
            if (!chromePath || !fs.existsSync(chromePath)) {
                return { error: `Chrome not found at ${chromePath || 'unknown platform'}. Install Google Chrome or use headless mode.` };
            }

            let connected = false;

            // Strategy 1: Check if Chrome is already running with known debug port
            if (_debugPort) {
                try {
                    await waitForPort(_debugPort, 2000);
                    browser = await pptr.connect({
                        browserURL: `http://127.0.0.1:${_debugPort}`,
                        defaultViewport: null,
                    });
                    connected = true;
                    logger.info('browser', `Reconnected to Chrome on cached port ${_debugPort}`);
                } catch {
                    _debugPort = null;
                }
            }

            // Strategy 2: Launch Chrome with user's real profile
            if (!connected) {
                const debugPort = await findFreePort();
                _debugPort = debugPort;
                logger.info('browser', `Launching Chrome on debug port ${debugPort} with user profile`);

                // Determine which profile to use
                // Try the user's actual Chrome profile first (has all logins/cookies)
                // Fall back to Onicode profile if the user's Chrome is already running (profile locked)
                let userDataDir = CHROME_USER_DATA_DIR;
                let usingUserProfile = true;

                // Chrome requires a NON-DEFAULT --user-data-dir for --remote-debugging-port.
                // We use a persistent Onicode Chrome profile at ~/.onicode/chrome-profile.
                // On first use, sites will require login — sessions persist across runs.
                // This is the same model as Perplexity Comet and other AI browser tools.
                userDataDir = CHROME_PROFILE_DIR;
                usingUserProfile = false;

                try {
                    const { execSync } = require('child_process');
                    if (!fs.existsSync(CHROME_PROFILE_DIR)) {
                        fs.mkdirSync(CHROME_PROFILE_DIR, { recursive: true });
                    }

                    // Check if Chrome is running — if so, our profile might be locked
                    // We DON'T kill the user's Chrome. Instead, we use our own separate profile
                    // which won't conflict since it's a different --user-data-dir.

                    // Clean up stale lock files from previous Onicode Chrome sessions
                    for (const lf of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
                        try { fs.unlinkSync(path.join(CHROME_PROFILE_DIR, lf)); } catch {}
                    }

                    logger.info('browser', 'Using Onicode Chrome profile (persistent sessions across runs)');
                } catch (setupErr) {
                    logger.warn('browser', `Profile setup failed: ${setupErr.message}`);
                }

                const chromeArgs = [
                    `--remote-debugging-port=${debugPort}`,
                    `--user-data-dir=${userDataDir}`,
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--restore-last-session',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                ];

                if (opts.width && opts.height) {
                    chromeArgs.push(`--window-size=${opts.width},${opts.height}`);
                }

                _chromeProcess = spawn(chromePath, chromeArgs, {
                    detached: false,
                    stdio: 'ignore',
                });

                _chromeProcess.on('error', (err) => {
                    logger.error('browser', `Chrome process error: ${err.message}`);
                });

                _chromeProcess.on('exit', (code) => {
                    logger.info('browser', `Chrome process exited with code ${code}`);
                    _chromeProcess = null;
                    browser = null;
                    activePage = null;
                    _pages.clear();
                });

                // Wait for Chrome's debug port to become reachable
                try {
                    await waitForPort(debugPort, 15000);
                } catch (err) {
                    try { _chromeProcess.kill(); } catch {}
                    _chromeProcess = null;
                    _debugPort = null;
                    return { error: `Chrome launched but debug port ${debugPort} never became available: ${err.message}` };
                }

                // Small additional delay for Chrome to fully initialize
                await new Promise(r => setTimeout(r, 500));

                // Connect Puppeteer to Chrome
                browser = await pptr.connect({
                    browserURL: `http://127.0.0.1:${debugPort}`,
                    defaultViewport: null,
                });

                connected = true;
                logger.info('browser', `Connected to Chrome via remote debugging (${usingUserProfile ? 'user profile' : 'onicode profile'})`);
            }

            _useChrome = true;

            // Get existing pages or create one
            const pages = await browser.pages();
            if (pages.length > 0) {
                activePage = pages[0];
            } else {
                activePage = await browser.newPage();
            }
        } else {
            // ── Standard headless Puppeteer launch ──
            browser = await pptr.launch({
                headless: opts.headless !== false ? 'new' : false,
                timeout: 60000,
                protocolTimeout: 120000,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                ],
                defaultViewport: { width: opts.width || 1280, height: opts.height || 720 },
            });

            activePage = await browser.newPage();
            _useChrome = false;
        }

        setupPageListeners(activePage);

        // Track this initial page
        _activeTabId = nextTabId();
        _pages.set(_activeTabId, {
            page: activePage,
            title: await activePage.title().catch(() => ''),
            url: activePage.url(),
        });

        // Configure download path
        _downloadPath = opts.downloadPath || DOWNLOADS_DIR;
        try {
            const client = await activePage.createCDPSession();
            await client.send('Page.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: _downloadPath,
            });
        } catch (err) {
            logger.warn('browser', `Could not set download path: ${err.message}`);
        }

        return {
            success: true,
            message: _useChrome ? 'Connected to Chrome browser' : 'Headless browser launched',
            useChrome: _useChrome,
            activeTab: _activeTabId,
        };
    } catch (err) {
        // Cleanup on failure
        if (_chromeProcess) {
            try { _chromeProcess.kill(); } catch {}
            _chromeProcess = null;
        }
        return { error: `Failed to launch browser: ${err.message}` };
    }
}

/**
 * Close browser and cleanup all resources.
 */
async function closeBrowser() {
    // Close all tracked pages
    for (const [tabId, entry] of _pages) {
        try {
            if (entry.page && !entry.page.isClosed()) {
                await entry.page.close();
            }
        } catch {}
    }
    _pages.clear();

    if (browser) {
        try {
            if (_useChrome) {
                // Disconnect (don't close — Chrome was launched separately)
                browser.disconnect();
            } else {
                await browser.close();
            }
        } catch {}
        browser = null;
    }

    // If we're using the user's Chrome (real profile), don't kill it — just disconnect.
    // The user's Chrome should stay open so they can keep browsing.
    // Only kill if using the Onicode profile (separate Chrome instance for automation).
    if (_chromeProcess) {
        // Check if this is the user's real profile Chrome — leave it running
        // We only kill Chrome if we know it's a disposable Onicode-profile instance
        // Since our new strategy always uses the user's real profile, just detach
        try {
            _chromeProcess.unref(); // Let Chrome continue running independently
        } catch {}
        _chromeProcess = null;
    }

    activePage = null;
    _activeTabId = 'tab_0';
    _tabCounter = 0;
    consoleLogs.length = 0;
    _useChrome = false;
    _downloadPath = null;
    _agentTabs.clear();

    logger.info('browser', 'Browser closed and cleaned up');
    return { success: true };
}

// ══════════════════════════════════════════
//  Ensure page helper
// ══════════════════════════════════════════

async function ensurePage() {
    if (!browser) {
        const result = await launchBrowser();
        if (result.error) return result;
    }
    if (!activePage || activePage.isClosed()) {
        activePage = await browser.newPage();
        setupPageListeners(activePage);
        _activeTabId = nextTabId();
        _pages.set(_activeTabId, {
            page: activePage,
            title: '',
            url: activePage.url(),
        });
    }
    return { success: true };
}

// ══════════════════════════════════════════
//  Per-agent tab isolation
// ══════════════════════════════════════════

/**
 * Get or create a dedicated tab for a sub-agent.
 * Each agent gets its own tab so parallel agents don't clobber each other's navigation.
 * If agentId is null/undefined, returns the default activePage (no isolation).
 * @param {string} agentId
 * @returns {Promise<{success: boolean, tabId?: string, page?: object, error?: string}>}
 */
async function ensureAgentTab(agentId) {
    if (!agentId) return ensurePage(); // No agent context — use default

    // Check if this agent already has a tab
    if (_agentTabs.has(agentId)) {
        const tabId = _agentTabs.get(agentId);
        const entry = _pages.get(tabId);
        if (entry && entry.page && !entry.page.isClosed()) {
            return { success: true, tabId, page: entry.page };
        }
        // Tab was closed or stale — remove mapping
        _agentTabs.delete(agentId);
    }

    // Create a new tab for this agent
    const result = await openTab();
    if (result.error) return result;

    _agentTabs.set(agentId, result.tabId);
    const entry = _pages.get(result.tabId);
    logger.info('browser', `Created dedicated tab ${result.tabId} for agent ${agentId}`);
    return { success: true, tabId: result.tabId, page: entry?.page };
}

/**
 * Get the page for a specific agent (or activePage if no agent context).
 * @param {string} agentId
 * @returns {object|null} Puppeteer page instance
 */
function getAgentPage(agentId) {
    if (!agentId) return activePage;
    const tabId = _agentTabs.get(agentId);
    if (tabId) {
        const entry = _pages.get(tabId);
        if (entry && entry.page && !entry.page.isClosed()) return entry.page;
    }
    return activePage; // Fallback to default
}

/**
 * Release an agent's tab mapping when the agent finishes.
 * Does NOT close the tab — it might have useful state for inspection.
 * @param {string} agentId
 */
function releaseAgentTab(agentId) {
    if (!agentId || !_agentTabs.has(agentId)) return;
    const tabId = _agentTabs.get(agentId);
    _agentTabs.delete(agentId);
    logger.info('browser', `Released tab ${tabId} from agent ${agentId}`);
}

// ══════════════════════════════════════════
//  Navigation & interaction (existing)
// ══════════════════════════════════════════

async function navigate(url, opts = {}) {
    const page = opts._page; // Agent-specific page override
    if (!page) {
        const check = await ensurePage();
        if (check.error) return check;
    }
    const targetPage = page || activePage;

    try {
        const timeout = opts.timeout || 60000;
        const response = await targetPage.goto(url, {
            waitUntil: opts.waitUntil || 'load',
            timeout,
        });

        const title = await targetPage.title();
        const currentUrl = targetPage.url();

        // Update tab tracking — find the tab for this page
        const tabIdForPage = page ? _findTabIdForPage(page) : _activeTabId;
        if (tabIdForPage && _pages.has(tabIdForPage)) {
            _pages.get(tabIdForPage).title = title;
            _pages.get(tabIdForPage).url = currentUrl;
        }

        // Auto-include interactive elements summary so AI has valid selectors immediately
        let interactiveElements = null;
        try {
            interactiveElements = await getInteractiveElements({ _page: page });
        } catch {}

        return {
            success: true,
            url: currentUrl,
            status: response?.status() || null,
            title,
            interactiveElements: interactiveElements || null,
            SELECTOR_GUIDE: 'Use the selectors from interactiveElements to click/type. Do NOT construct your own CSS selectors — they will likely be invalid.',
        };
    } catch (err) {
        return { error: `Navigation failed: ${err.message}`, url };
    }
}

async function screenshot(opts = {}) {
    const page = opts._page; // Agent-specific page override
    if (!page) {
        const check = await ensurePage();
        if (check.error) return check;
    }
    const targetPage = page || activePage;

    try {
        const name = opts.name || `screenshot_${Date.now()}`;
        const filePath = path.join(SCREENSHOTS_DIR, `${name}.png`);

        const screenshotOpts = { path: filePath, type: 'png' };
        if (opts.selector) {
            const el = await targetPage.$(opts.selector);
            if (!el) return { error: `Element not found: ${opts.selector}` };
            await el.screenshot(screenshotOpts);
        } else {
            screenshotOpts.fullPage = opts.fullPage || false;
            await targetPage.screenshot(screenshotOpts);
        }

        const stats = fs.statSync(filePath);

        // Extract visible text + DOM structure so the AI can analyze what's on screen
        let pageAnalysis = {};
        try {
            pageAnalysis = await targetPage.evaluate(() => {
                const title = document.title || '';
                const bodyText = document.body?.innerText?.slice(0, 3000) || '';
                const headings = [...document.querySelectorAll('h1, h2, h3')].slice(0, 10).map(el => el.textContent?.trim());
                const buttons = [...document.querySelectorAll('button, [role="button"], a.btn')].slice(0, 15).map(el => el.textContent?.trim());
                const inputs = [...document.querySelectorAll('input, textarea, select')].slice(0, 10).map(el => ({
                    type: el.getAttribute('type') || el.tagName.toLowerCase(),
                    placeholder: el.getAttribute('placeholder') || '',
                    value: el.value?.slice(0, 50) || '',
                }));
                const images = [...document.querySelectorAll('img')].slice(0, 5).map(el => ({
                    alt: el.getAttribute('alt') || '',
                    src: el.getAttribute('src')?.slice(0, 100) || '',
                }));
                const errors = [...document.querySelectorAll('.error, [class*="error"], [role="alert"]')].slice(0, 5).map(el => el.textContent?.trim());
                const isEmpty = bodyText.trim().length < 50;
                return { title, bodyText: bodyText.slice(0, 2000), headings, buttons, inputs, images, errors, isEmpty };
            });
        } catch { /* page analysis failed, proceed with screenshot only */ }

        // Auto-include interactive elements so AI has valid selectors
        let interactiveElements = null;
        try {
            interactiveElements = await getInteractiveElements({ _page: page });
        } catch {}

        return {
            success: true,
            path: filePath,
            name,
            size: stats.size,
            url: targetPage.url(),
            pageContent: pageAnalysis,
            interactiveElements: interactiveElements || null,
            ANALYSIS_GUIDE: 'Use the pageContent field to understand what is displayed. Check headings, buttons, bodyText, and errors to verify the UI matches expectations. If bodyText is empty or shows error messages, the app may not be rendering correctly — check console_logs for errors. IMPORTANT: To click or type into elements, use the selectors from interactiveElements — do NOT construct your own CSS selectors.',
        };
    } catch (err) {
        return { error: `Screenshot failed: ${err.message}` };
    }
}

async function evaluate(script, opts = {}) {
    const page = opts._page;
    if (!page) {
        const check = await ensurePage();
        if (check.error) return check;
    }
    const targetPage = page || activePage;

    try {
        const result = await targetPage.evaluate((code) => {
            try {
                // eslint-disable-next-line no-eval
                const r = eval(code);
                return { success: true, result: String(r) };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }, script);
        return result;
    } catch (err) {
        return { error: `Evaluate failed: ${err.message}` };
    }
}

async function click(selector, opts = {}) {
    const page = opts._page;
    if (!page) {
        const check = await ensurePage();
        if (check.error) return check;
    }
    const targetPage = page || activePage;

    try {
        await targetPage.click(selector);
        return { success: true, selector };
    } catch (err) {
        return { error: `Click failed on "${selector}": ${err.message}` };
    }
}

async function type(selector, text, opts = {}) {
    const page = opts._page;
    if (!page) {
        const check = await ensurePage();
        if (check.error) return check;
    }
    const targetPage = page || activePage;

    try {
        await targetPage.type(selector, text);
        return { success: true, selector, typed: text.length };
    } catch (err) {
        return { error: `Type failed on "${selector}": ${err.message}` };
    }
}

async function waitForSelector(selector, opts = {}) {
    const page = opts._page;
    if (!page) {
        const check = await ensurePage();
        if (check.error) return check;
    }
    const targetPage = page || activePage;

    try {
        await targetPage.waitForSelector(selector, { timeout: opts.timeout || 10000 });
        return { success: true, selector };
    } catch (err) {
        return { error: `Wait failed for "${selector}": ${err.message}` };
    }
}

async function getPageContent(opts = {}) {
    const page = opts._page;
    if (!page) {
        const check = await ensurePage();
        if (check.error) return check;
    }
    const targetPage = page || activePage;

    try {
        const content = await targetPage.content();
        return {
            success: true,
            url: targetPage.url(),
            title: await targetPage.title(),
            html: content.slice(0, 15000),
            length: content.length,
        };
    } catch (err) {
        return { error: `getPageContent failed: ${err.message}` };
    }
}

function getConsoleLogs(opts = {}) {
    let logs = [...consoleLogs];
    if (opts.type) {
        logs = logs.filter(l => l.type === opts.type);
    }
    if (opts.since) {
        logs = logs.filter(l => l.ts >= opts.since);
    }
    const limit = opts.limit || 50;
    return logs.slice(-limit);
}

function clearConsoleLogs() {
    consoleLogs.length = 0;
    return { success: true };
}

// ══════════════════════════════════════════
//  Interactive element analysis
// ══════════════════════════════════════════

/**
 * Extract all interactive elements from the page with labels, types, bounding boxes.
 * Groups into buttons, links, inputs, selects.
 * @returns {Promise<object>}
 */
async function getInteractiveElements(opts = {}) {
    const page = opts._page;
    if (!page) {
        const check = await ensurePage();
        if (check.error) return check;
    }
    const targetPage = page || activePage;

    try {
        const elements = await targetPage.evaluate(() => {
            function getUniqueSelector(el) {
                if (el.id) return `#${CSS.escape(el.id)}`;
                if (el.name) {
                    const byName = document.querySelectorAll(`[name="${CSS.escape(el.name)}"]`);
                    if (byName.length === 1) return `[name="${el.name}"]`;
                }
                // Build nth-of-type path
                const parts = [];
                let current = el;
                while (current && current !== document.body && current !== document.documentElement) {
                    const parent = current.parentElement;
                    if (!parent) break;
                    const siblings = [...parent.children].filter(c => c.tagName === current.tagName);
                    if (siblings.length === 1) {
                        parts.unshift(current.tagName.toLowerCase());
                    } else {
                        const idx = siblings.indexOf(current) + 1;
                        parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${idx})`);
                    }
                    current = parent;
                    if (parts.length >= 4) break; // Keep selectors reasonably short
                }
                return parts.join(' > ');
            }

            function isVisible(el) {
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            }

            function getLabel(el) {
                // Check for associated label
                if (el.id) {
                    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
                    if (label) return label.textContent?.trim();
                }
                // Check parent label
                const parentLabel = el.closest('label');
                if (parentLabel) return parentLabel.textContent?.trim();
                // Check aria-label
                if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
                // Check aria-labelledby
                const labelledBy = el.getAttribute('aria-labelledby');
                if (labelledBy) {
                    const ref = document.getElementById(labelledBy);
                    if (ref) return ref.textContent?.trim();
                }
                return null;
            }

            function extractElement(el, index) {
                const rect = el.getBoundingClientRect();
                return {
                    index,
                    tag: el.tagName.toLowerCase(),
                    type: el.getAttribute('type') || el.tagName.toLowerCase(),
                    text: (el.textContent || '').trim().slice(0, 100),
                    label: getLabel(el),
                    placeholder: el.getAttribute('placeholder') || null,
                    value: (el.value || '').slice(0, 100),
                    name: el.getAttribute('name') || null,
                    id: el.id || null,
                    selector: getUniqueSelector(el),
                    rect: {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                    },
                    isVisible: true,
                    ariaLabel: el.getAttribute('aria-label') || null,
                };
            }

            const buttons = [];
            const links = [];
            const inputs = [];
            const selects = [];
            let globalIndex = 0;

            // Buttons: button, [role=button], input[type=submit], input[type=button]
            const btnEls = document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]');
            for (const el of btnEls) {
                if (!isVisible(el)) continue;
                buttons.push(extractElement(el, globalIndex++));
                if (buttons.length >= 50) break;
            }

            // Links: a[href]
            const linkEls = document.querySelectorAll('a[href]');
            for (const el of linkEls) {
                if (!isVisible(el)) continue;
                const info = extractElement(el, globalIndex++);
                info.href = el.getAttribute('href')?.slice(0, 200) || '';
                links.push(info);
                if (links.length >= 50) break;
            }

            // Inputs: input (not button/submit), textarea
            const inputEls = document.querySelectorAll('input:not([type="submit"]):not([type="button"]):not([type="hidden"]), textarea');
            for (const el of inputEls) {
                if (!isVisible(el)) continue;
                inputs.push(extractElement(el, globalIndex++));
                if (inputs.length >= 50) break;
            }

            // Selects
            const selectEls = document.querySelectorAll('select');
            for (const el of selectEls) {
                if (!isVisible(el)) continue;
                const info = extractElement(el, globalIndex++);
                info.options = [...el.options].slice(0, 20).map(o => ({
                    value: o.value,
                    text: o.textContent?.trim(),
                    selected: o.selected,
                }));
                selects.push(info);
                if (selects.length >= 50) break;
            }

            return {
                buttons,
                links,
                inputs,
                selects,
                total: buttons.length + links.length + inputs.length + selects.length,
            };
        });

        return { success: true, ...elements };
    } catch (err) {
        return { error: `getInteractiveElements failed: ${err.message}` };
    }
}

// ══════════════════════════════════════════
//  Page structure analysis
// ══════════════════════════════════════════

/**
 * Semantic page structure analysis — extract meaningful page components.
 * @returns {Promise<object>}
 */
async function getPageStructure(opts = {}) {
    const page = opts._page;
    if (!page) {
        const check = await ensurePage();
        if (check.error) return check;
    }
    const targetPage = page || activePage;

    try {
        const structure = await targetPage.evaluate(() => {
            // Title & meta
            const title = document.title || '';
            const url = window.location.href;
            const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';

            // Headings hierarchy
            const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].slice(0, 30).map(el => ({
                level: parseInt(el.tagName[1]),
                text: el.textContent?.trim().slice(0, 150),
            }));

            // Navigation links
            const navLinks = [];
            const navEls = document.querySelectorAll('nav a, [role="navigation"] a, header a');
            for (const el of [...navEls].slice(0, 20)) {
                navLinks.push({
                    text: el.textContent?.trim().slice(0, 80),
                    href: el.getAttribute('href')?.slice(0, 200) || '',
                });
            }

            // Main content text (first 3000 chars)
            const main = document.querySelector('main, [role="main"], article, .content, #content');
            const mainText = (main || document.body)?.innerText?.slice(0, 3000) || '';

            // Forms with fields
            const forms = [...document.querySelectorAll('form')].slice(0, 5).map(form => {
                const fields = [...form.querySelectorAll('input, textarea, select')].slice(0, 15).map(el => ({
                    tag: el.tagName.toLowerCase(),
                    type: el.getAttribute('type') || el.tagName.toLowerCase(),
                    name: el.getAttribute('name') || '',
                    placeholder: el.getAttribute('placeholder') || '',
                    label: el.id
                        ? (document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() || '')
                        : (el.closest('label')?.textContent?.trim() || ''),
                    required: el.required || false,
                }));
                return {
                    action: form.getAttribute('action') || '',
                    method: form.getAttribute('method') || 'GET',
                    fields,
                };
            });

            // Tables — count + headers
            const tables = [...document.querySelectorAll('table')].slice(0, 10).map((table, i) => {
                const headers = [...table.querySelectorAll('th')].slice(0, 20).map(th => th.textContent?.trim());
                const rowCount = table.querySelectorAll('tbody tr, tr').length;
                return { index: i, headers, rowCount };
            });

            // Images with alt text
            const images = [...document.querySelectorAll('img')].slice(0, 15).map(img => ({
                alt: img.getAttribute('alt') || '',
                src: img.getAttribute('src')?.slice(0, 150) || '',
                width: img.naturalWidth || img.width,
                height: img.naturalHeight || img.height,
            }));

            // Modals / dialogs
            const modals = [];
            const dialogEls = document.querySelectorAll('dialog[open], [role="dialog"], .modal.show, .modal.active, [class*="modal"][class*="open"]');
            for (const el of [...dialogEls].slice(0, 3)) {
                modals.push({
                    tag: el.tagName.toLowerCase(),
                    text: el.innerText?.slice(0, 500) || '',
                    isOpen: true,
                });
            }

            return {
                title,
                url,
                metaDescription: metaDesc,
                headings,
                navLinks,
                mainContent: mainText,
                forms,
                tables,
                images,
                modals,
            };
        });

        return { success: true, ...structure };
    } catch (err) {
        return { error: `getPageStructure failed: ${err.message}` };
    }
}

// ══════════════════════════════════════════
//  Table extraction
// ══════════════════════════════════════════

/**
 * Extract structured data from HTML tables.
 * @param {string} [selector] - CSS selector for specific table. If omitted, all tables.
 * @returns {Promise<object>}
 */
async function extractTables(selector, opts = {}) {
    const page = opts._page;
    if (!page) {
        const check = await ensurePage();
        if (check.error) return check;
    }
    const targetPage = page || activePage;

    try {
        const tables = await targetPage.evaluate((sel) => {
            const MAX_ROWS = 100;
            const tableEls = sel
                ? [...document.querySelectorAll(sel)]
                : [...document.querySelectorAll('table')];

            return tableEls.slice(0, 10).map((table, idx) => {
                // Extract headers
                const headerEls = table.querySelectorAll('thead th, thead td, tr:first-child th');
                const headers = [...headerEls].map(th => th.textContent?.trim() || '');

                // If no thead headers, try first row
                if (headers.length === 0) {
                    const firstRow = table.querySelector('tr');
                    if (firstRow) {
                        [...firstRow.querySelectorAll('th, td')].forEach(cell => {
                            headers.push(cell.textContent?.trim() || '');
                        });
                    }
                }

                // Extract rows (skip header row if headers came from first row)
                const allRows = [...table.querySelectorAll('tbody tr, tr')];
                const dataRows = headers.length > 0 ? allRows.slice(1) : allRows;
                const rows = dataRows.slice(0, MAX_ROWS).map(tr => {
                    return [...tr.querySelectorAll('td, th')].map(cell => cell.textContent?.trim() || '');
                });

                // Build a unique-ish selector for this table
                let tableSelector = sel || '';
                if (!tableSelector) {
                    if (table.id) {
                        tableSelector = `#${table.id}`;
                    } else {
                        tableSelector = `table:nth-of-type(${idx + 1})`;
                    }
                }

                return {
                    headers,
                    rows,
                    rowCount: rows.length,
                    totalRows: allRows.length,
                    selector: tableSelector,
                };
            });
        }, selector || null);

        return { success: true, tables, count: tables.length };
    } catch (err) {
        return { error: `extractTables failed: ${err.message}` };
    }
}

// ══════════════════════════════════════════
//  Link extraction
// ══════════════════════════════════════════

/**
 * Extract all links from the page.
 * @param {string} [filter] - Text or href pattern to filter by.
 * @returns {Promise<object>}
 */
async function extractLinks(filter, opts = {}) {
    const page = opts._page;
    if (!page) {
        const check = await ensurePage();
        if (check.error) return check;
    }
    const targetPage = page || activePage;

    try {
        const result = await targetPage.evaluate((filterStr) => {
            const allLinks = [...document.querySelectorAll('a[href]')];
            const pageOrigin = window.location.origin;

            let links = allLinks.map(a => {
                const href = a.getAttribute('href') || '';
                const text = (a.textContent || '').trim().slice(0, 200);
                // Get parent context
                const parent = a.parentElement;
                const context = parent ? parent.textContent?.trim().slice(0, 150) : '';

                let isExternal = false;
                try {
                    const url = new URL(href, window.location.href);
                    isExternal = url.origin !== pageOrigin;
                } catch {
                    isExternal = href.startsWith('http') && !href.startsWith(pageOrigin);
                }

                return { text, href, isExternal, context };
            });

            // Apply filter if provided
            if (filterStr) {
                const lower = filterStr.toLowerCase();
                links = links.filter(l =>
                    l.text.toLowerCase().includes(lower) ||
                    l.href.toLowerCase().includes(lower)
                );
            }

            return { links: links.slice(0, 200), total: links.length };
        }, filter || null);

        return { success: true, ...result };
    } catch (err) {
        return { error: `extractLinks failed: ${err.message}` };
    }
}

// ══════════════════════════════════════════
//  Form filling
// ══════════════════════════════════════════

/**
 * Batch fill form fields by label/placeholder/selector matching.
 * @param {Array<{label: string, value: string, selector?: string}>} fields
 * @returns {Promise<object>}
 */
async function fillForm(fields, opts = {}) {
    const page = opts._page;
    if (!page) {
        const check = await ensurePage();
        if (check.error) return check;
    }
    const targetPage = page || activePage;

    if (!Array.isArray(fields) || fields.length === 0) {
        return { error: 'fields must be a non-empty array of { label, value, selector? }' };
    }

    const filled = [];
    const errors = [];

    for (const field of fields) {
        try {
            let targetSelector = field.selector;

            if (!targetSelector) {
                // Try to find element by label or placeholder
                targetSelector = await targetPage.evaluate((labelText) => {
                    const lower = labelText.toLowerCase();

                    // 1. Find by label[for]
                    const labels = document.querySelectorAll('label');
                    for (const label of labels) {
                        if (label.textContent?.trim().toLowerCase().includes(lower)) {
                            const forId = label.getAttribute('for');
                            if (forId) {
                                const el = document.getElementById(forId);
                                if (el) {
                                    if (el.id) return `#${CSS.escape(el.id)}`;
                                    if (el.name) return `[name="${el.name}"]`;
                                }
                            }
                            // Check for input inside the label
                            const inner = label.querySelector('input, textarea, select');
                            if (inner) {
                                if (inner.id) return `#${CSS.escape(inner.id)}`;
                                if (inner.name) return `[name="${inner.name}"]`;
                            }
                        }
                    }

                    // 2. Find by placeholder
                    const inputs = document.querySelectorAll('input, textarea');
                    for (const input of inputs) {
                        const ph = input.getAttribute('placeholder') || '';
                        if (ph.toLowerCase().includes(lower)) {
                            if (input.id) return `#${CSS.escape(input.id)}`;
                            if (input.name) return `[name="${input.name}"]`;
                            return `[placeholder="${input.getAttribute('placeholder')}"]`;
                        }
                    }

                    // 3. Find by aria-label
                    const ariaEls = document.querySelectorAll('[aria-label]');
                    for (const el of ariaEls) {
                        if (el.getAttribute('aria-label').toLowerCase().includes(lower)) {
                            if (el.id) return `#${CSS.escape(el.id)}`;
                            if (el.name) return `[name="${el.name}"]`;
                            return `[aria-label="${el.getAttribute('aria-label')}"]`;
                        }
                    }

                    // 4. Find by name attribute
                    const byName = document.querySelector(`[name="${CSS.escape(labelText)}"]`);
                    if (byName) return `[name="${labelText}"]`;

                    return null;
                }, field.label);
            }

            if (!targetSelector) {
                errors.push({ label: field.label, error: 'Could not find matching form element' });
                continue;
            }

            // Determine element type and fill accordingly
            const elementInfo = await targetPage.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (!el) return null;
                return {
                    tag: el.tagName.toLowerCase(),
                    type: (el.getAttribute('type') || '').toLowerCase(),
                    exists: true,
                };
            }, targetSelector);

            if (!elementInfo || !elementInfo.exists) {
                errors.push({ label: field.label, selector: targetSelector, error: 'Element not found' });
                continue;
            }

            const { tag, type: inputType } = elementInfo;

            if (tag === 'select') {
                // Select option by value or text
                await targetPage.select(targetSelector, field.value);
                filled.push({ label: field.label, selector: targetSelector, action: 'selected', value: field.value });
            } else if (inputType === 'checkbox' || inputType === 'radio') {
                // For checkbox/radio, click to toggle
                const isChecked = await targetPage.evaluate((sel) => {
                    return document.querySelector(sel)?.checked || false;
                }, targetSelector);

                const shouldBeChecked = field.value === 'true' || field.value === true || field.value === '1';
                if (isChecked !== shouldBeChecked) {
                    await targetPage.click(targetSelector);
                }
                filled.push({ label: field.label, selector: targetSelector, action: 'toggled', value: shouldBeChecked });
            } else if (inputType === 'file') {
                // File upload
                const fileInput = await targetPage.$(targetSelector);
                if (fileInput) {
                    await fileInput.uploadFile(field.value);
                    filled.push({ label: field.label, selector: targetSelector, action: 'file_uploaded', value: field.value });
                }
            } else {
                // Text input — clear and type
                await targetPage.click(targetSelector, { clickCount: 3 }); // Select all
                await targetPage.type(targetSelector, field.value);
                filled.push({ label: field.label, selector: targetSelector, action: 'typed', value: field.value });
            }
        } catch (err) {
            errors.push({ label: field.label, error: err.message });
        }
    }

    return { success: true, filled, errors, totalFilled: filled.length, totalErrors: errors.length };
}

// ══════════════════════════════════════════
//  Select dropdown
// ══════════════════════════════════════════

/**
 * Select an option in a dropdown by value or visible text.
 * @param {string} selector - CSS selector for the <select> element
 * @param {string} value - Value or visible text to select
 * @returns {Promise<object>}
 */
async function selectOption(selector, value, opts = {}) {
    const page = opts._page;
    if (!page) {
        const check = await ensurePage();
        if (check.error) return check;
    }
    const targetPage = page || activePage;

    try {
        // First try selecting by value directly
        const result = await targetPage.evaluate((sel, val) => {
            const select = document.querySelector(sel);
            if (!select || select.tagName.toLowerCase() !== 'select') {
                return { error: `Element "${sel}" is not a select element` };
            }

            // Try by value
            const byValue = [...select.options].find(o => o.value === val);
            if (byValue) {
                select.value = byValue.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                return { success: true, selected: byValue.value, text: byValue.textContent?.trim() };
            }

            // Try by visible text (case-insensitive)
            const lowerVal = val.toLowerCase();
            const byText = [...select.options].find(o =>
                o.textContent?.trim().toLowerCase() === lowerVal ||
                o.textContent?.trim().toLowerCase().includes(lowerVal)
            );
            if (byText) {
                select.value = byText.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                return { success: true, selected: byText.value, text: byText.textContent?.trim() };
            }

            const available = [...select.options].map(o => ({
                value: o.value,
                text: o.textContent?.trim(),
            }));
            return { error: `No option matching "${val}" found`, availableOptions: available };
        }, selector, value);

        return result;
    } catch (err) {
        return { error: `selectOption failed: ${err.message}` };
    }
}

// ══════════════════════════════════════════
//  Scroll
// ══════════════════════════════════════════

/**
 * Scroll the page or to a specific element.
 * @param {object} options - { selector?, direction?, amount?, toBottom?, toTop? }
 * @returns {Promise<object>}
 */
async function scrollTo(options = {}) {
    const page = options._page;
    if (!page) {
        const check = await ensurePage();
        if (check.error) return check;
    }
    const targetPage = page || activePage;

    try {
        if (options.selector) {
            // Scroll to specific element
            await targetPage.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return { success: true, action: 'scrollToElement', selector: sel };
                }
                throw new Error(`Element not found: ${sel}`);
            }, options.selector);
            return { success: true, action: 'scrollToElement', selector: options.selector };
        }

        if (options.toBottom) {
            await targetPage.evaluate(() => {
                window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            });
            return { success: true, action: 'scrollToBottom' };
        }

        if (options.toTop) {
            await targetPage.evaluate(() => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
            return { success: true, action: 'scrollToTop' };
        }

        // Scroll by direction and amount
        const amount = options.amount || 500;
        const direction = options.direction || 'down';

        await targetPage.evaluate((dir, amt) => {
            const delta = dir === 'up' || dir === 'left' ? -amt : amt;
            if (dir === 'left' || dir === 'right') {
                window.scrollBy({ left: delta, behavior: 'smooth' });
            } else {
                window.scrollBy({ top: delta, behavior: 'smooth' });
            }
        }, direction, amount);

        // Get current scroll position
        const pos = await targetPage.evaluate(() => ({
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            scrollHeight: document.body.scrollHeight,
            scrollWidth: document.body.scrollWidth,
            viewportHeight: window.innerHeight,
            viewportWidth: window.innerWidth,
        }));

        return { success: true, action: 'scroll', direction, amount, ...pos };
    } catch (err) {
        return { error: `scrollTo failed: ${err.message}` };
    }
}

// ══════════════════════════════════════════
//  Multi-tab management
// ══════════════════════════════════════════

/**
 * Open a new tab, optionally navigate to URL.
 * @param {string} [url] - URL to navigate to
 * @returns {Promise<object>}
 */
async function openTab(url) {
    const check = await ensurePage();
    if (check.error) return check;

    try {
        const page = await browser.newPage();
        setupPageListeners(page);

        // Configure download path for new tab
        if (_downloadPath) {
            try {
                const client = await page.createCDPSession();
                await client.send('Page.setDownloadBehavior', {
                    behavior: 'allow',
                    downloadPath: _downloadPath,
                });
            } catch {}
        }

        const tabId = nextTabId();

        if (url) {
            await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        }

        const title = await page.title().catch(() => '');
        const pageUrl = page.url();

        _pages.set(tabId, { page, title, url: pageUrl });

        // Switch to this new tab
        activePage = page;
        _activeTabId = tabId;

        logger.info('browser', `Opened new tab ${tabId}: ${pageUrl}`);

        return { success: true, tabId, url: pageUrl, title };
    } catch (err) {
        return { error: `openTab failed: ${err.message}` };
    }
}

/**
 * Switch to a specific tab.
 * @param {string} tabId
 * @returns {Promise<object>}
 */
async function switchTab(tabId) {
    if (!_pages.has(tabId)) {
        return { error: `Tab "${tabId}" not found. Available: ${[..._pages.keys()].join(', ')}` };
    }

    const entry = _pages.get(tabId);
    if (entry.page.isClosed()) {
        _pages.delete(tabId);
        return { error: `Tab "${tabId}" has been closed` };
    }

    try {
        await entry.page.bringToFront();
        activePage = entry.page;
        _activeTabId = tabId;

        // Update tab info
        entry.title = await entry.page.title().catch(() => '');
        entry.url = entry.page.url();

        logger.info('browser', `Switched to tab ${tabId}: ${entry.url}`);

        return { success: true, tabId, url: entry.url, title: entry.title };
    } catch (err) {
        return { error: `switchTab failed: ${err.message}` };
    }
}

/**
 * List all open tabs.
 * @returns {Promise<object>}
 */
async function listTabs() {
    const tabs = [];
    const toDelete = [];

    for (const [tabId, entry] of _pages) {
        if (entry.page.isClosed()) {
            toDelete.push(tabId);
            continue;
        }

        try {
            // Refresh title/url
            entry.title = await entry.page.title().catch(() => entry.title || '');
            entry.url = entry.page.url();
        } catch {}

        tabs.push({
            tabId,
            url: entry.url,
            title: entry.title,
            isActive: tabId === _activeTabId,
        });
    }

    // Clean up closed tabs
    for (const id of toDelete) _pages.delete(id);

    return { success: true, tabs, count: tabs.length };
}

/**
 * Close a specific tab.
 * @param {string} tabId
 * @returns {Promise<object>}
 */
async function closeTab(tabId) {
    if (!_pages.has(tabId)) {
        return { error: `Tab "${tabId}" not found` };
    }

    const entry = _pages.get(tabId);

    try {
        if (!entry.page.isClosed()) {
            await entry.page.close();
        }
    } catch {}

    _pages.delete(tabId);
    logger.info('browser', `Closed tab ${tabId}`);

    // If we closed the active tab, switch to another
    if (tabId === _activeTabId) {
        const remaining = [..._pages.entries()];
        if (remaining.length > 0) {
            const [newTabId, newEntry] = remaining[remaining.length - 1];
            activePage = newEntry.page;
            _activeTabId = newTabId;
            try { await activePage.bringToFront(); } catch {}
            return {
                success: true,
                closed: tabId,
                switchedTo: _activeTabId,
                url: newEntry.url,
                title: newEntry.title,
            };
        } else {
            activePage = null;
            _activeTabId = null;
            return { success: true, closed: tabId, noTabsRemaining: true };
        }
    }

    return { success: true, closed: tabId, activeTab: _activeTabId };
}

// ══════════════════════════════════════════
//  Cookie / session management
// ══════════════════════════════════════════

/**
 * Save all browser cookies to disk.
 * @returns {Promise<object>}
 */
async function saveCookies() {
    const check = await ensurePage();
    if (check.error) return check;

    try {
        const cookies = await activePage.cookies();

        // Also get cookies from all other pages
        const allCookies = new Map();
        for (const cookie of cookies) {
            allCookies.set(`${cookie.domain}:${cookie.name}`, cookie);
        }

        for (const [, entry] of _pages) {
            if (entry.page !== activePage && !entry.page.isClosed()) {
                try {
                    const pageCookies = await entry.page.cookies();
                    for (const cookie of pageCookies) {
                        allCookies.set(`${cookie.domain}:${cookie.name}`, cookie);
                    }
                } catch {}
            }
        }

        const cookieArray = [...allCookies.values()];
        fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookieArray, null, 2), 'utf-8');

        logger.info('browser', `Saved ${cookieArray.length} cookies to ${COOKIES_PATH}`);

        return { success: true, count: cookieArray.length, path: COOKIES_PATH };
    } catch (err) {
        return { error: `saveCookies failed: ${err.message}` };
    }
}

/**
 * Load cookies from disk and set them in the browser.
 * @returns {Promise<object>}
 */
async function loadCookies() {
    const check = await ensurePage();
    if (check.error) return check;

    if (!fs.existsSync(COOKIES_PATH)) {
        return { success: false, message: 'No saved cookies found', path: COOKIES_PATH };
    }

    try {
        const raw = fs.readFileSync(COOKIES_PATH, 'utf-8');
        const cookies = JSON.parse(raw);

        if (!Array.isArray(cookies) || cookies.length === 0) {
            return { success: false, message: 'Cookie file is empty' };
        }

        await activePage.setCookie(...cookies);

        logger.info('browser', `Loaded ${cookies.length} cookies from ${COOKIES_PATH}`);

        return { success: true, count: cookies.length };
    } catch (err) {
        return { error: `loadCookies failed: ${err.message}` };
    }
}

// ══════════════════════════════════════════
//  Downloads
// ══════════════════════════════════════════

/**
 * List downloaded files in the download directory.
 * @returns {object}
 */
function getDownloads() {
    const downloadDir = _downloadPath || DOWNLOADS_DIR;

    try {
        if (!fs.existsSync(downloadDir)) {
            return { success: true, files: [], directory: downloadDir };
        }

        const files = fs.readdirSync(downloadDir)
            .filter(f => !f.startsWith('.'))
            .map(f => {
                const filePath = path.join(downloadDir, f);
                try {
                    const stats = fs.statSync(filePath);
                    return {
                        name: f,
                        path: filePath,
                        size: stats.size,
                        modified: stats.mtime.toISOString(),
                        isDirectory: stats.isDirectory(),
                    };
                } catch {
                    return { name: f, path: filePath, error: 'stat failed' };
                }
            })
            .sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));

        return { success: true, files, count: files.length, directory: downloadDir };
    } catch (err) {
        return { error: `getDownloads failed: ${err.message}` };
    }
}

// ══════════════════════════════════════════
//  Browser status
// ══════════════════════════════════════════

/**
 * Get overall browser status.
 * @returns {Promise<object>}
 */
async function getBrowserStatus() {
    const running = browser !== null;
    const tabList = [];

    if (running) {
        for (const [tabId, entry] of _pages) {
            if (entry.page.isClosed()) continue;
            try {
                entry.title = await entry.page.title().catch(() => entry.title || '');
                entry.url = entry.page.url();
            } catch {}
            tabList.push({
                tabId,
                url: entry.url,
                title: entry.title,
                isActive: tabId === _activeTabId,
            });
        }
    }

    const downloads = getDownloads();

    return {
        success: true,
        running,
        useChrome: _useChrome,
        tabs: tabList,
        tabCount: tabList.length,
        activeTab: _activeTabId,
        url: activePage && !activePage.isClosed() ? activePage.url() : null,
        downloadDirectory: _downloadPath || DOWNLOADS_DIR,
        downloadCount: downloads.count || 0,
        hasSavedCookies: fs.existsSync(COOKIES_PATH),
    };
}

// ══════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════

function registerBrowserIPC() {
    const { ipcMain } = require('electron');

    // ── Existing handlers ──
    ipcMain.handle('browser-launch', (_event, opts) => launchBrowser(opts));
    ipcMain.handle('browser-close', () => closeBrowser());
    ipcMain.handle('browser-navigate', (_event, url, opts) => navigate(url, opts));
    ipcMain.handle('browser-screenshot', (_event, opts) => screenshot(opts));
    ipcMain.handle('browser-evaluate', (_event, script) => evaluate(script));
    ipcMain.handle('browser-click', (_event, selector) => click(selector));
    ipcMain.handle('browser-type', (_event, selector, text) => type(selector, text));
    ipcMain.handle('browser-wait', (_event, selector, opts) => waitForSelector(selector, opts));
    ipcMain.handle('browser-content', () => getPageContent());
    ipcMain.handle('browser-console-logs', (_event, opts) => ({ success: true, logs: getConsoleLogs(opts) }));
    ipcMain.handle('browser-console-clear', () => clearConsoleLogs());

    // ── New handlers ──
    ipcMain.handle('browser-interactive-elements', () => getInteractiveElements());
    ipcMain.handle('browser-page-structure', () => getPageStructure());
    ipcMain.handle('browser-extract-tables', (_event, selector) => extractTables(selector));
    ipcMain.handle('browser-extract-links', (_event, filter) => extractLinks(filter));
    ipcMain.handle('browser-fill-form', (_event, fields) => fillForm(fields));
    ipcMain.handle('browser-select', (_event, selector, value) => selectOption(selector, value));
    ipcMain.handle('browser-scroll', (_event, options) => scrollTo(options));
    ipcMain.handle('browser-open-tab', (_event, url) => openTab(url));
    ipcMain.handle('browser-switch-tab', (_event, tabId) => switchTab(tabId));
    ipcMain.handle('browser-list-tabs', () => listTabs());
    ipcMain.handle('browser-close-tab', (_event, tabId) => closeTab(tabId));
    ipcMain.handle('browser-save-cookies', () => saveCookies());
    ipcMain.handle('browser-load-cookies', () => loadCookies());
    ipcMain.handle('browser-downloads', () => getDownloads());
    ipcMain.handle('browser-status', () => getBrowserStatus());
}

module.exports = {
    // Existing
    launchBrowser,
    closeBrowser,
    navigate,
    screenshot,
    evaluate,
    click,
    type: type,
    waitForSelector,
    getPageContent,
    getConsoleLogs,
    clearConsoleLogs,
    // New — analysis
    getInteractiveElements,
    getPageStructure,
    extractTables,
    extractLinks,
    // New — form interaction
    fillForm,
    selectOption,
    scrollTo,
    // New — multi-tab
    openTab,
    switchTab,
    listTabs,
    closeTab,
    // New — cookies & downloads
    saveCookies,
    loadCookies,
    getDownloads,
    // New — status
    getBrowserStatus,
    // Agent tab isolation
    ensureAgentTab,
    getAgentPage,
    releaseAgentTab,
    // IPC
    registerBrowserIPC,
};
