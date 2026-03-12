/**
 * Workflow Engine — Multi-step automated workflows for Onicode
 *
 * Step types:
 *   - ai_prompt:    Send a prompt to the AI, store response
 *   - command:      Execute a shell command, capture stdout
 *   - tool_call:    Call an AI tool directly
 *   - condition:    Evaluate a JS expression against previous step outputs
 *   - notify:       Send a desktop notification
 *   - wait:         Pause for N seconds
 *   - webhook:      HTTP POST to an external URL
 *
 * Workflows can be triggered by schedulers, heartbeat checks, or manually.
 * Execution history is persisted in SQLite (workflow_runs, workflow_step_runs).
 */

const { execSync } = require('child_process');
const { Notification } = require('electron');
const { logger } = require('./logger');

// ══════════════════════════════════════════
//  Lazy References
// ══════════════════════════════════════════

let _storage = null;
function getStorage() {
    if (!_storage) _storage = require('./storage');
    return _storage;
}

let _mainWindow = null;
function setMainWindow(win) { _mainWindow = win; }

function sendToRenderer(channel, data) {
    if (_mainWindow?.webContents) {
        _mainWindow.webContents.send(channel, data);
    }
}

// External function hooks — set by the host (index.js)
let _makeAICall = null;
let _executeAnyTool = null;
let _getToolSet = null;       // maps tool_set name → array of tool names
let _getToolDefinitions = null; // returns full tool definitions for filtering
let _lastProviderConfig = null;

function setAICallFunction(fn) { _makeAICall = fn; }
function setToolExecutor(fn) { _executeAnyTool = fn; }
function setToolSetResolver(fn) { _getToolSet = fn; }
function setToolDefinitionsGetter(fn) { _getToolDefinitions = fn; }
function setProviderConfig(config) { _lastProviderConfig = config; }

// ══════════════════════════════════════════
//  Workflow Concurrency Queue
// ══════════════════════════════════════════

const MAX_CONCURRENT_WORKFLOWS = 4;

class WorkflowQueue {
    constructor() {
        /** @type {Map<string, { resolve: Function }>} runId → dequeue resolver */
        this._queue = [];
        /** @type {Set<string>} currently running runIds */
        this._running = new Set();
    }

    canRun() {
        return this._running.size < MAX_CONCURRENT_WORKFLOWS;
    }

    /**
     * Enqueue a run. Returns a promise that resolves when the run is allowed to start.
     * @param {string} runId
     * @returns {Promise<void>}
     */
    enqueue(runId) {
        return new Promise(resolve => {
            this._queue.push({ runId, resolve });
            this._emitUpdate();
        });
    }

    markRunning(runId) {
        this._running.add(runId);
        this._emitUpdate();
    }

    markDone(runId) {
        this._running.delete(runId);
        // Dequeue next waiting run
        if (this._queue.length > 0 && this.canRun()) {
            const next = this._queue.shift();
            if (next) next.resolve();
        }
        this._emitUpdate();
    }

    getStatus() {
        return {
            running: this._running.size,
            queued: this._queue.length,
            maxConcurrent: MAX_CONCURRENT_WORKFLOWS,
            runningIds: [...this._running],
            queuedIds: this._queue.map(q => q.runId),
        };
    }

    _emitUpdate() {
        sendToRenderer('workflow-queue-updated', this.getStatus());
    }
}

const workflowQueue = new WorkflowQueue();

// ══════════════════════════════════════════
//  ID Generator
// ══════════════════════════════════════════

function generateId() {
    return 'wf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function generateRunId() {
    return 'wr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ══════════════════════════════════════════
//  Template Variable Substitution
// ══════════════════════════════════════════

/**
 * Replace {{variable}} placeholders with values from the context object.
 * Also supports {{steps.N.output}} to reference previous step outputs.
 */
function substituteVars(template, context) {
    if (typeof template !== 'string') return template;
    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
        const parts = path.trim().split('.');
        let val = context;
        for (const part of parts) {
            if (val == null) return match;
            val = val[part];
        }
        if (val === undefined || val === null) return match;
        return typeof val === 'object' ? JSON.stringify(val) : String(val);
    });
}

// ══════════════════════════════════════════
//  CRUD Operations
// ══════════════════════════════════════════

function createWorkflow({ name, description, steps, trigger_config, project_id, project_path, tags }) {
    if (!name) throw new Error('Workflow name is required');
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
        throw new Error('Workflow must have at least one step');
    }

    // Validate steps
    const validTypes = ['ai_prompt', 'command', 'tool_call', 'condition', 'notify', 'wait', 'webhook'];
    for (let i = 0; i < steps.length; i++) {
        if (!validTypes.includes(steps[i].type)) {
            throw new Error(`Step ${i}: invalid type "${steps[i].type}". Must be one of: ${validTypes.join(', ')}`);
        }
        if (!steps[i].name) steps[i].name = `Step ${i + 1}`;
    }

    const wf = {
        id: generateId(),
        name,
        description: description || '',
        steps,
        trigger_config: trigger_config || {},
        enabled: true,
        project_id: project_id || null,
        project_path: project_path || null,
        tags: tags || [],
        created_at: Date.now(),
        updated_at: Date.now(),
    };

    getStorage().workflowStorage.save(wf);
    logger.info('workflows', `Created workflow: ${name} (${wf.id}) with ${steps.length} steps`);
    return wf;
}

function getWorkflow(id) {
    return getStorage().workflowStorage.get(id);
}

function listWorkflows() {
    return getStorage().workflowStorage.list();
}

function updateWorkflow(id, updates) {
    const existing = getWorkflow(id);
    if (!existing) throw new Error(`Workflow not found: ${id}`);
    getStorage().workflowStorage.update(id, updates);
    logger.info('workflows', `Updated workflow: ${id}`, Object.keys(updates));
    return getWorkflow(id);
}

function deleteWorkflow(id) {
    getStorage().workflowStorage.delete(id);
    logger.info('workflows', `Deleted workflow: ${id}`);
}

// ══════════════════════════════════════════
//  Workflow Execution Engine
// ══════════════════════════════════════════

/**
 * Execute a workflow by ID or definition.
 * @param {string|object} workflowOrId — workflow ID string or full workflow object
 * @param {object} [params] — trigger parameters (available as {{params.xxx}} in templates)
 * @param {string} [triggerType='manual'] — what triggered this run
 * @param {string} [scheduleId] — if triggered by a schedule
 * @returns {Promise<object>} run result
 */
async function executeWorkflow(workflowOrId, params = {}, triggerType = 'manual', scheduleId = null) {
    const workflow = typeof workflowOrId === 'string'
        ? getWorkflow(workflowOrId)
        : workflowOrId;

    if (!workflow) {
        return { success: false, error: `Workflow not found: ${workflowOrId}` };
    }

    if (!workflow.enabled) {
        return { success: false, error: `Workflow "${workflow.name}" is disabled` };
    }

    const runId = generateRunId();
    const startedAt = Date.now();

    // Check concurrency — queue if full
    if (!workflowQueue.canRun()) {
        // Create queued run record
        const queuedRun = {
            id: runId,
            workflow_id: workflow.id,
            schedule_id: scheduleId,
            trigger_type: triggerType,
            trigger_data: params,
            status: 'queued',
            current_step: 0,
            steps_completed: 0,
            steps_total: workflow.steps.length,
            result: {},
            started_at: null,
        };
        getStorage().workflowRunStorage.save(queuedRun);
        sendToRenderer('workflow-run-queued', { runId, workflowId: workflow.id, workflowName: workflow.name });
        logger.info('workflows', `Workflow "${workflow.name}" queued (${workflowQueue._running.size}/${MAX_CONCURRENT_WORKFLOWS} running)`);

        // Wait until dequeued
        await workflowQueue.enqueue(runId);
        logger.info('workflows', `Workflow "${workflow.name}" dequeued, starting execution`);
    }

    workflowQueue.markRunning(runId);

    // Create/update run record as running
    const run = {
        id: runId,
        workflow_id: workflow.id,
        schedule_id: scheduleId,
        trigger_type: triggerType,
        trigger_data: params,
        status: 'running',
        current_step: 0,
        steps_completed: 0,
        steps_total: workflow.steps.length,
        result: {},
        started_at: Date.now(),
    };

    try { getStorage().workflowRunStorage.update(runId, { status: 'running', started_at: run.started_at }); }
    catch { getStorage().workflowRunStorage.save(run); }
    sendToRenderer('workflow-run-started', { runId, workflowId: workflow.id, workflowName: workflow.name });

    // Execution context — accumulates step outputs
    const context = {
        params,
        trigger: { type: triggerType, data: params },
        workflow: { id: workflow.id, name: workflow.name },
        steps: {},
        env: {
            now: new Date().toISOString(),
            timestamp: Date.now(),
        },
    };

    let lastError = null;

    for (let i = 0; i < workflow.steps.length; i++) {
        const step = workflow.steps[i];
        const stepStarted = Date.now();

        // Update current step
        getStorage().workflowRunStorage.update(runId, { current_step: i, status: 'running' });

        sendToRenderer('workflow-step-started', {
            runId, stepIndex: i, stepName: step.name, stepType: step.type,
            total: workflow.steps.length,
        });

        let stepResult;
        try {
            stepResult = await executeStep(step, context, i);
        } catch (err) {
            stepResult = { success: false, error: err.message };
        }

        const stepDuration = Date.now() - stepStarted;

        // Save step run
        getStorage().workflowRunStorage.saveStepRun({
            run_id: runId,
            step_index: i,
            step_name: step.name,
            step_type: step.type,
            input: step,
            output: stepResult,
            status: stepResult.success ? 'completed' : 'failed',
            error: stepResult.error || null,
            started_at: stepStarted,
            completed_at: Date.now(),
            duration_ms: stepDuration,
        });

        // Store in context for subsequent steps
        context.steps[i] = { output: stepResult.output || stepResult, success: stepResult.success };
        context.steps[step.name] = context.steps[i]; // Also accessible by name

        sendToRenderer('workflow-step-completed', {
            runId, stepIndex: i, stepName: step.name,
            success: stepResult.success,
            duration: stepDuration,
            total: workflow.steps.length,
        });

        getStorage().workflowRunStorage.update(runId, {
            steps_completed: i + 1,
        });

        // Handle failure
        if (!stepResult.success) {
            if (step.on_failure === 'continue') {
                logger.warn('workflows', `Step ${i} ("${step.name}") failed but continuing: ${stepResult.error}`);
                continue;
            }
            if (step.on_failure === 'skip_rest') {
                logger.warn('workflows', `Step ${i} ("${step.name}") failed, skipping remaining steps`);
                lastError = stepResult.error;
                break;
            }
            // Default: abort
            lastError = stepResult.error;
            logger.error('workflows', `Step ${i} ("${step.name}") failed, aborting workflow: ${stepResult.error}`);
            break;
        }

        // Condition step can skip subsequent steps
        if (step.type === 'condition' && stepResult.skip_remaining) {
            logger.info('workflows', `Condition step "${step.name}" triggered skip_remaining`);
            break;
        }
    }

    const completedAt = Date.now();
    const finalStatus = lastError ? 'failed' : 'completed';

    // Collect all step outputs into result
    const result = {};
    for (const [key, val] of Object.entries(context.steps)) {
        if (typeof key === 'number' || /^\d+$/.test(key)) {
            result[`step_${key}`] = val.output;
        }
    }

    getStorage().workflowRunStorage.update(runId, {
        status: finalStatus,
        result,
        error: lastError,
        completed_at: completedAt,
        duration_ms: completedAt - startedAt,
    });

    sendToRenderer('workflow-run-completed', {
        runId, workflowId: workflow.id, workflowName: workflow.name,
        status: finalStatus, duration: completedAt - startedAt,
        error: lastError,
    });

    logger.info('workflows', `Workflow "${workflow.name}" ${finalStatus} in ${completedAt - startedAt}ms`);

    // Release concurrency slot — triggers next queued workflow
    workflowQueue.markDone(runId);

    const stepsCompletedCount = Object.keys(context.steps).filter(k => /^\d+$/.test(k)).length;
    const duration = completedAt - startedAt;

    // Build structured result for pipeline delivery
    const stepResults = [];
    for (const [key, val] of Object.entries(context.steps)) {
        if (/^\d+$/.test(key)) {
            const step = workflow.steps[Number(key)];
            stepResults.push({
                stepIndex: Number(key),
                stepName: step?.name || `Step ${key}`,
                output: val.output,
                success: val.success,
            });
        }
    }

    const structuredResult = {
        runId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        workflowDescription: workflow.description,
        status: finalStatus,
        stepsCompleted: stepsCompletedCount,
        stepsTotal: workflow.steps.length,
        duration,
        startedAt: run.started_at,
        completedAt,
        stepResults,
        error: lastError,
    };

    // Queue result for delivery (respects chat activity state)
    if (triggerType !== 'manual') {
        // Summarize asynchronously, then queue
        summarizeResult(structuredResult).then(summary => {
            structuredResult.content = summary;
            queueResult(structuredResult);
        }).catch(() => {
            queueResult(structuredResult);
        });
    }

    return {
        success: !lastError,
        runId,
        status: finalStatus,
        duration,
        stepsCompleted: stepsCompletedCount,
        stepsTotal: workflow.steps.length,
        result,
        error: lastError,
    };
}

// ══════════════════════════════════════════
//  Step Executors
// ══════════════════════════════════════════

async function executeStep(step, context, stepIndex) {
    switch (step.type) {
        case 'ai_prompt':
            return await executeAIPromptStep(step, context);
        case 'command':
            return executeCommandStep(step, context);
        case 'tool_call':
            return await executeToolCallStep(step, context);
        case 'condition':
            return executeConditionStep(step, context);
        case 'notify':
            return executeNotifyStep(step, context);
        case 'wait':
            return await executeWaitStep(step, context);
        case 'webhook':
            return await executeWebhookStep(step, context);
        default:
            return { success: false, error: `Unknown step type: ${step.type}` };
    }
}

async function executeAIPromptStep(step, context) {
    // Route to agentic execution if new fields are present
    if (step.goal || step.tool_set || step.tool_priority || step.max_rounds) {
        return executeAgenticStep(step, context);
    }

    if (!_makeAICall) {
        return { success: false, error: 'AI call function not configured' };
    }
    const prompt = substituteVars(step.prompt || step.payload || '', context);
    try {
        const response = await _makeAICall(prompt);
        return { success: true, output: typeof response === 'string' ? response : JSON.stringify(response).slice(0, 4000) };
    } catch (err) {
        return { success: false, error: `AI prompt failed: ${err.message}` };
    }
}

/**
 * Agentic step execution — runs a full agentic loop with tool access.
 * Models the loop after executeSubAgent in aiTools.js.
 */
async function executeAgenticStep(step, context) {
    if (!_makeAICall) {
        return { success: false, error: 'AI call function not configured' };
    }
    if (!_lastProviderConfig) {
        return { success: false, error: 'No provider configured — send at least one chat message first' };
    }

    const goal = substituteVars(step.goal || step.prompt || '', context);
    const maxRounds = step.max_rounds || 10;
    const toolSetName = step.tool_set || 'read-only';
    const toolsUsed = [];

    // 1. Build context from step.context
    let fileContext = '';
    if (step.context?.files && Array.isArray(step.context.files)) {
        const fs = require('fs');
        const os = require('os');
        for (const fp of step.context.files) {
            try {
                const expanded = fp.replace(/^~/, os.homedir());
                if (fs.existsSync(expanded)) {
                    const content = fs.readFileSync(expanded, 'utf-8');
                    fileContext += `\n\n--- File: ${fp} ---\n${content.slice(0, 5000)}`;
                }
            } catch { /* skip */ }
        }
    }

    let previousStepContext = '';
    if (step.context?.previous_steps !== false) {
        // Include outputs from previous steps
        const stepEntries = Object.entries(context.steps).filter(([k]) => /^\d+$/.test(k));
        if (stepEntries.length > 0) {
            previousStepContext = '\n\nPrevious step outputs:\n' + stepEntries.map(([i, s]) =>
                `Step ${i}: ${typeof s.output === 'string' ? s.output.slice(0, 2000) : JSON.stringify(s.output).slice(0, 2000)}`
            ).join('\n');
        }
    }

    // 2. Resolve tool set
    let allowedToolNames;
    if (_getToolSet) {
        allowedToolNames = _getToolSet(toolSetName);
    }
    if (!allowedToolNames) {
        // Fallback minimal set
        allowedToolNames = ['read_file', 'search_files', 'list_directory'];
    }
    const allowedSet = new Set(allowedToolNames);

    // Filter tool definitions to allowed set
    let allowedTools = [];
    if (_getToolDefinitions) {
        const allDefs = _getToolDefinitions();
        allowedTools = allDefs.filter(t => {
            const name = t.function?.name || t.name || '';
            return allowedSet.has(name);
        });
    }

    // 3. Build system prompt
    const toolListStr = allowedToolNames.join(', ');
    const priorityHint = step.tool_priority?.length
        ? `\nPreferred tools (use first): ${step.tool_priority.join(', ')}`
        : '';

    const systemPrompt = `You are a focused workflow agent executing a specific goal.

**Goal:** ${goal}
**Available tools:** ${toolListStr}${priorityHint}
**Do NOT call any tools outside your tool set.**

Complete the goal efficiently and return a clear, actionable summary of what you did and found.
${fileContext}${previousStepContext}`;

    // 4. Run agentic loop
    try {
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: goal },
        ];

        for (let round = 0; round < maxRounds; round++) {
            sendToRenderer('workflow-agent-round', {
                stepName: step.name,
                round: round + 1,
                maxRounds,
            });

            const result = await _makeAICall(messages, _lastProviderConfig, allowedTools);

            if (result.error) {
                return { success: false, error: `Agentic AI call failed: ${result.error}`, toolsUsed, rounds: round + 1 };
            }

            // No tool calls — agent is done
            if (!result.hasToolCalls && !result.functionCalls?.length) {
                const output = result.textContent || result.content || '';
                return { success: true, output: output.slice(0, 8000), toolsUsed, rounds: round + 1 };
            }

            // Execute tool calls
            const toolCalls = result.toolCalls || result.functionCalls || [];
            const assistantMsg = { role: 'assistant', content: result.textContent || null };
            if (toolCalls.length > 0) {
                assistantMsg.tool_calls = toolCalls.map(tc => ({
                    id: tc.id || tc.call_id,
                    type: 'function',
                    function: { name: tc.name, arguments: tc.arguments },
                }));
            }
            messages.push(assistantMsg);

            for (const tc of toolCalls) {
                let args;
                try { args = JSON.parse(tc.arguments); } catch { args = {}; }

                toolsUsed.push(tc.name);

                // Enforce tool set boundary
                if (!allowedSet.has(tc.name)) {
                    messages.push({
                        role: 'tool',
                        tool_call_id: tc.id || tc.call_id,
                        content: JSON.stringify({ error: `Tool "${tc.name}" not in your tool set (${toolSetName}). Available: ${toolListStr}` }),
                    });
                    continue;
                }

                let toolResult;
                try {
                    toolResult = await _executeAnyTool(tc.name, args);
                } catch (err) {
                    toolResult = { error: err.message };
                }
                messages.push({
                    role: 'tool',
                    tool_call_id: tc.id || tc.call_id,
                    content: JSON.stringify(toolResult).slice(0, 8000),
                });
            }
        }

        return { success: true, output: 'Workflow agent reached max rounds.', toolsUsed, rounds: maxRounds };
    } catch (err) {
        return { success: false, error: `Agentic step failed: ${err.message}`, toolsUsed, rounds: 0 };
    }
}

function executeCommandStep(step, context) {
    const command = substituteVars(step.command || step.payload || '', context);
    if (!command) return { success: false, error: 'No command specified' };
    try {
        const output = execSync(command, {
            timeout: step.timeout || 30000,
            encoding: 'utf-8',
            maxBuffer: 2 * 1024 * 1024,
            cwd: step.cwd || undefined,
        }).trim();
        return { success: true, output: output.slice(0, 4000) };
    } catch (err) {
        return { success: false, error: `Command failed (exit ${err.status || 1}): ${(err.stderr || err.message || '').toString().slice(0, 500)}`, output: (err.stdout || '').toString().slice(0, 2000) };
    }
}

async function executeToolCallStep(step, context) {
    if (!_executeAnyTool) {
        return { success: false, error: 'Tool executor not configured' };
    }
    const toolName = step.tool || step.tool_name;
    if (!toolName) return { success: false, error: 'No tool name specified' };

    // Substitute variables in tool args
    let args = step.args || step.tool_args || {};
    if (typeof args === 'string') {
        args = JSON.parse(substituteVars(args, context));
    } else {
        // Deep substitute in object values
        const substituted = {};
        for (const [k, v] of Object.entries(args)) {
            substituted[k] = typeof v === 'string' ? substituteVars(v, context) : v;
        }
        args = substituted;
    }

    try {
        const result = await _executeAnyTool(toolName, args);
        return { success: true, output: typeof result === 'string' ? result : JSON.stringify(result).slice(0, 4000) };
    } catch (err) {
        return { success: false, error: `Tool call failed: ${err.message}` };
    }
}

function executeConditionStep(step, context) {
    const expression = substituteVars(step.condition || step.expression || '', context);
    if (!expression) return { success: false, error: 'No condition expression' };

    try {
        // Create a safe evaluation context
        const evalContext = {
            steps: context.steps,
            params: context.params,
            env: context.env,
        };
        // Use Function constructor for slightly safer eval
        const fn = new Function('ctx', `with(ctx) { return !!(${expression}); }`);
        const result = fn(evalContext);
        return {
            success: true,
            output: result,
            skip_remaining: step.skip_if_false && !result,
        };
    } catch (err) {
        return { success: false, error: `Condition evaluation failed: ${err.message}` };
    }
}

function executeNotifyStep(step, context) {
    const title = substituteVars(step.title || 'Onicode Workflow', context);
    const body = substituteVars(step.body || step.message || '', context);
    try {
        new Notification({ title, body }).show();
        sendToRenderer('workflow-notification', { title, body, timestamp: Date.now() });
        sendAutomationMessage(body, 'workflow', title);
        return { success: true, output: `Notification sent: ${title}` };
    } catch (err) {
        return { success: false, error: `Notification failed: ${err.message}` };
    }
}

async function executeWaitStep(step, context) {
    const seconds = step.seconds || step.duration || 5;
    const capped = Math.min(seconds, 300); // Max 5 minutes
    await new Promise(resolve => setTimeout(resolve, capped * 1000));
    return { success: true, output: `Waited ${capped} seconds` };
}

async function executeWebhookStep(step, context) {
    const url = substituteVars(step.url || '', context);
    if (!url) return { success: false, error: 'No webhook URL specified' };

    const method = (step.method || 'POST').toUpperCase();
    const headers = { 'Content-Type': 'application/json', ...(step.headers || {}) };
    let body = step.body || context.steps;
    if (typeof body === 'string') body = substituteVars(body, context);
    else body = JSON.stringify(body);

    try {
        const { net } = require('electron');
        const response = await net.fetch(url, {
            method,
            headers,
            body: method !== 'GET' ? body : undefined,
        });
        const text = await response.text();
        return {
            success: response.ok,
            output: text.slice(0, 4000),
            status: response.status,
        };
    } catch (err) {
        return { success: false, error: `Webhook failed: ${err.message}` };
    }
}

// ══════════════════════════════════════════
//  Run History
// ══════════════════════════════════════════

function getWorkflowRuns(workflowId, limit = 20) {
    return getStorage().workflowRunStorage.list({ workflow_id: workflowId, limit });
}

function getRunDetail(runId) {
    const run = getStorage().workflowRunStorage.get(runId);
    if (!run) return null;
    const steps = getStorage().workflowRunStorage.getStepRuns(runId);
    return { ...run, stepRuns: steps };
}

function getAllRuns(limit = 50) {
    return getStorage().workflowRunStorage.list({ limit });
}

// ══════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════

function registerWorkflowIPC(ipcMainArg, getWindow) {
    if (getWindow) {
        _mainWindow = getWindow();
        setInterval(() => { _mainWindow = getWindow(); }, 5000);
    }

    ipcMainArg.handle('workflow-list', () => {
        try { return { success: true, workflows: listWorkflows() }; }
        catch (err) { return { success: false, error: err.message }; }
    });

    ipcMainArg.handle('workflow-get', (_e, id) => {
        try {
            const wf = getWorkflow(id);
            if (!wf) return { success: false, error: 'Not found' };
            return { success: true, workflow: wf };
        } catch (err) { return { success: false, error: err.message }; }
    });

    ipcMainArg.handle('workflow-create', (_e, opts) => {
        try {
            const wf = createWorkflow(opts);
            return { success: true, workflow: wf };
        } catch (err) { return { success: false, error: err.message }; }
    });

    ipcMainArg.handle('workflow-update', (_e, id, updates) => {
        try {
            const wf = updateWorkflow(id, updates);
            return { success: true, workflow: wf };
        } catch (err) { return { success: false, error: err.message }; }
    });

    ipcMainArg.handle('workflow-delete', (_e, id) => {
        try { deleteWorkflow(id); return { success: true }; }
        catch (err) { return { success: false, error: err.message }; }
    });

    ipcMainArg.handle('workflow-run', async (_e, id, params) => {
        try {
            const result = await executeWorkflow(id, params || {}, 'manual');
            return { success: result.success, ...result };
        } catch (err) { return { success: false, error: err.message }; }
    });

    ipcMainArg.handle('workflow-runs', (_e, workflowId, limit) => {
        try { return { success: true, runs: getWorkflowRuns(workflowId, limit) }; }
        catch (err) { return { success: false, error: err.message }; }
    });

    ipcMainArg.handle('workflow-run-detail', (_e, runId) => {
        try {
            const detail = getRunDetail(runId);
            if (!detail) return { success: false, error: 'Run not found' };
            return { success: true, run: detail };
        } catch (err) { return { success: false, error: err.message }; }
    });

    ipcMainArg.handle('workflow-all-runs', (_e, limit) => {
        try { return { success: true, runs: getAllRuns(limit) }; }
        catch (err) { return { success: false, error: err.message }; }
    });

    ipcMainArg.handle('workflow-queue-status', () => {
        return { success: true, ...workflowQueue.getStatus() };
    });

    logger.info('workflows', 'IPC handlers registered (10 channels)');
}

// ══════════════════════════════════════════
//  AI Tool Definitions
// ══════════════════════════════════════════

const WORKFLOW_TOOL_DEFINITIONS = [
    {
        type: 'function',
        function: {
            name: 'create_workflow',
            description: 'Create a multi-step automated workflow. Steps execute sequentially. Step types: ai_prompt (AI call), command (shell), tool_call (AI tool), condition (branch), notify (notification), wait (delay), webhook (HTTP).',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Workflow name' },
                    description: { type: 'string', description: 'What this workflow does' },
                    steps: {
                        type: 'array',
                        description: 'Array of step objects. Each: { name, type, ...type-specific fields }. Use {{params.xxx}} for dynamic values and {{steps.N.output}} for previous step results.',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                type: { type: 'string', enum: ['ai_prompt', 'command', 'tool_call', 'condition', 'notify', 'wait', 'webhook'] },
                                prompt: { type: 'string', description: 'For ai_prompt: the prompt text (legacy mode, no tools)' },
                                goal: { type: 'string', description: 'For ai_prompt: what the step should achieve (enables agentic mode with tool access)' },
                                tool_set: { type: 'string', enum: ['read-only', 'file-ops', 'search', 'git', 'browser', 'workspace'], description: 'For ai_prompt: which tools the agent can use' },
                                tool_priority: { type: 'array', items: { type: 'string' }, description: 'For ai_prompt: preferred tools listed first' },
                                max_rounds: { type: 'number', description: 'For ai_prompt: max AI rounds (default 10)' },
                                context: { type: 'object', description: 'For ai_prompt: { files?: string[], previous_steps?: boolean, project_docs?: boolean }' },
                                command: { type: 'string', description: 'For command: shell command to run' },
                                tool: { type: 'string', description: 'For tool_call: tool name' },
                                args: { type: 'object', description: 'For tool_call: tool arguments' },
                                condition: { type: 'string', description: 'For condition: JS expression to evaluate' },
                                title: { type: 'string', description: 'For notify: notification title' },
                                body: { type: 'string', description: 'For notify: notification body' },
                                seconds: { type: 'number', description: 'For wait: seconds to pause' },
                                url: { type: 'string', description: 'For webhook: URL to call' },
                                on_failure: { type: 'string', enum: ['abort', 'continue', 'skip_rest'], description: 'What to do if step fails (default: abort)' },
                            },
                            required: ['type'],
                        },
                    },
                },
                required: ['name', 'steps'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'run_workflow',
            description: 'Execute a workflow immediately by its ID, with optional parameters.',
            parameters: {
                type: 'object',
                properties: {
                    workflow_id: { type: 'string', description: 'ID of the workflow to run' },
                    params: { type: 'object', description: 'Parameters available as {{params.xxx}} in step templates' },
                    background: { type: 'boolean', description: 'If true, run in background and deliver result to chat when done. Use this for workflows with wait steps or long-running tasks.' },
                },
                required: ['workflow_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_workflows',
            description: 'List all workflows with their steps, status, and recent run history.',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'delete_workflow',
            description: 'Delete a workflow by ID.',
            parameters: {
                type: 'object',
                properties: { workflow_id: { type: 'string' } },
                required: ['workflow_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'set_timer',
            description: 'Set a one-time timer that fires after a delay. When it fires, it sends a desktop notification and a message in the chat. Use this for reminders, pings, and delayed one-time actions. The timer runs in the background — the user can continue chatting.',
            parameters: {
                type: 'object',
                properties: {
                    seconds: { type: 'number', description: 'Delay in seconds before the timer fires' },
                    message: { type: 'string', description: 'Message to show when timer fires' },
                    title: { type: 'string', description: 'Title for the notification (default: "Onicode Timer")' },
                },
                required: ['seconds', 'message'],
            },
        },
    },
];

// ══════════════════════════════════════════
//  Tool Executor
// ══════════════════════════════════════════

async function executeWorkflowTool(toolName, args) {
    switch (toolName) {
        case 'create_workflow': {
            try {
                const wf = createWorkflow({
                    name: args.name,
                    description: args.description,
                    steps: args.steps,
                    tags: args.tags,
                });
                return {
                    message: `Workflow "${wf.name}" created with ${wf.steps.length} steps.`,
                    workflow: { id: wf.id, name: wf.name, steps: wf.steps.length },
                };
            } catch (err) {
                return { error: err.message };
            }
        }

        case 'run_workflow': {
            if (args.background) {
                // Fire and forget — runs in background, result delivered to chat
                executeWorkflow(args.workflow_id, args.params || {}, 'ai_triggered')
                    .then(result => {
                        const msg = result.success
                            ? `Workflow completed (${result.stepsCompleted}/${result.stepsTotal} steps, ${result.duration}ms)`
                            : `Workflow failed: ${result.error}`;
                        sendAutomationMessage(msg, 'workflow', 'Background Workflow');
                    })
                    .catch(err => sendAutomationMessage(`Workflow error: ${err.message}`, 'workflow', 'Background Workflow'));
                return { message: `Workflow started in background.`, runId: 'pending' };
            }
            try {
                const result = await executeWorkflow(args.workflow_id, args.params || {}, 'ai_triggered');
                return {
                    message: `Workflow ${result.success ? 'completed' : 'failed'} in ${result.duration}ms (${result.stepsCompleted}/${result.stepsTotal} steps).`,
                    runId: result.runId,
                    status: result.status,
                    duration: result.duration,
                    error: result.error,
                };
            } catch (err) {
                return { error: err.message };
            }
        }

        case 'list_workflows': {
            const workflows = listWorkflows();
            if (workflows.length === 0) return { message: 'No workflows defined.' };
            const summary = workflows.map(wf => ({
                id: wf.id,
                name: wf.name,
                description: wf.description,
                steps: wf.steps.length,
                enabled: wf.enabled,
                tags: wf.tags,
            }));
            return { message: `${workflows.length} workflow(s) found.`, workflows: summary };
        }

        case 'delete_workflow': {
            const existing = getWorkflow(args.workflow_id);
            if (!existing) return { error: `Workflow not found: ${args.workflow_id}` };
            try {
                deleteWorkflow(args.workflow_id);
                return { message: `Workflow "${existing.name}" deleted.` };
            } catch (err) {
                return { error: err.message };
            }
        }

        case 'set_timer': {
            const result = setTimer(args.seconds, {
                type: 'notify',
                title: args.title || 'Onicode Timer',
                body: args.message,
            });
            return { message: `Timer set! Will fire in ${args.seconds} seconds.`, timerId: result.timerId };
        }

        default:
            return { error: `Unknown workflow tool: ${toolName}` };
    }
}

// ══════════════════════════════════════════
//  Timer System
// ══════════════════════════════════════════

const _timers = new Map();

function generateTimerId() {
    return 'tmr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Set a one-time timer that fires after `seconds` seconds.
 * @param {number} seconds — delay before firing
 * @param {object} action — { type: 'notify'|'ai_prompt'|'command', title?, body?, prompt?, command? }
 * @returns {{ timerId: string, firesAt: number }}
 */
function setTimer(seconds, action) {
    const timerId = generateTimerId();
    const firesAt = Date.now() + seconds * 1000;

    const handle = setTimeout(async () => {
        _timers.delete(timerId);
        logger.info('workflows', `Timer ${timerId} fired after ${seconds}s`);

        try {
            switch (action.type) {
                case 'notify': {
                    const title = action.title || 'Onicode Timer';
                    const body = action.body || '';
                    new Notification({ title, body }).show();
                    sendAutomationMessage(body, 'timer', title);
                    break;
                }
                case 'ai_prompt': {
                    if (_makeAICall) {
                        const response = await _makeAICall(action.prompt || action.body || '');
                        const text = typeof response === 'string' ? response : JSON.stringify(response).slice(0, 4000);
                        sendAutomationMessage(text, 'timer', action.title || 'Onicode Timer');
                    } else {
                        sendAutomationMessage(action.prompt || action.body || '(AI not configured)', 'timer', action.title || 'Onicode Timer');
                    }
                    break;
                }
                case 'command': {
                    try {
                        const output = execSync(action.command || '', { timeout: 30000, encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 }).trim();
                        sendAutomationMessage(output || '(command completed)', 'timer', action.title || 'Onicode Timer');
                    } catch (err) {
                        sendAutomationMessage(`Command failed: ${err.message}`, 'timer', action.title || 'Onicode Timer');
                    }
                    break;
                }
                default:
                    sendAutomationMessage(action.body || action.message || '(timer fired)', 'timer', action.title || 'Onicode Timer');
            }
        } catch (err) {
            logger.error('workflows', `Timer ${timerId} action failed: ${err.message}`);
            sendAutomationMessage(`Timer action failed: ${err.message}`, 'timer', 'Onicode Timer Error');
        }
    }, seconds * 1000);

    _timers.set(timerId, { handle, firesAt, action, createdAt: Date.now() });
    logger.info('workflows', `Timer ${timerId} set for ${seconds}s (fires at ${new Date(firesAt).toISOString()})`);

    return { timerId, firesAt };
}

function cancelTimer(timerId) {
    const timer = _timers.get(timerId);
    if (!timer) return { success: false, error: `Timer not found: ${timerId}` };
    clearTimeout(timer.handle);
    _timers.delete(timerId);
    logger.info('workflows', `Timer ${timerId} cancelled`);
    return { success: true, message: `Timer ${timerId} cancelled.` };
}

// ══════════════════════════════════════════
//  Result Pipeline (queue when chat active)
// ══════════════════════════════════════════

const _resultQueue = [];
let _isChatActive = false;

function setChatActive(active) {
    _isChatActive = active;
    if (!active) flushResultQueue();
}

function queueResult(result) {
    if (_isChatActive) {
        _resultQueue.push(result);
        logger.info('workflows', `Result queued (chat active), queue size: ${_resultQueue.length}`);
    } else {
        deliverResult(result);
    }
}

function flushResultQueue() {
    while (_resultQueue.length > 0) {
        const result = _resultQueue.shift();
        deliverResult(result);
    }
}

function deliverResult(result) {
    const content = result.content || buildResultMarkdown(result);
    sendAutomationMessage(content, 'workflow', result.workflowName || 'Workflow');
}

function buildResultMarkdown(result) {
    const status = result.status === 'completed' ? 'completed' : 'failed';
    const duration = result.duration ? `${(result.duration / 1000).toFixed(1)}s` : 'unknown';
    let md = `Workflow **${result.workflowName || 'Untitled'}** ${status} (${result.stepsCompleted}/${result.stepsTotal} steps, ${duration})`;
    if (result.error) md += `\n\nError: ${result.error}`;
    if (result.stepResults?.length) {
        const summaries = result.stepResults
            .filter(s => s.output)
            .map(s => `- **${s.stepName}:** ${typeof s.output === 'string' ? s.output.slice(0, 200) : JSON.stringify(s.output).slice(0, 200)}`);
        if (summaries.length) md += '\n\n' + summaries.join('\n');
    }
    return md;
}

/**
 * Generate an AI-written natural summary of a workflow result.
 * Falls back to raw markdown if AI is unavailable.
 */
async function summarizeResult(structuredResult) {
    if (!_makeAICall || !_lastProviderConfig) {
        return buildResultMarkdown(structuredResult);
    }

    const stepSummaries = (structuredResult.stepResults || [])
        .map(s => `- ${s.stepName}: ${s.success ? 'OK' : 'FAILED'}. Output: ${typeof s.output === 'string' ? s.output.slice(0, 300) : JSON.stringify(s.output).slice(0, 300)}`)
        .join('\n');

    const duration = structuredResult.duration ? `${(structuredResult.duration / 1000).toFixed(1)}s` : 'unknown';

    const prompt = `Summarize this workflow result in a brief, conversational message (under 200 words). Write it as if you're updating the user on what happened. Be specific about findings, not just "the workflow ran."

Workflow: ${structuredResult.workflowName}
${structuredResult.workflowDescription ? `Description: ${structuredResult.workflowDescription}` : ''}
Status: ${structuredResult.status}
Steps: ${structuredResult.stepsCompleted}/${structuredResult.stepsTotal} completed in ${duration}
${structuredResult.error ? `Error: ${structuredResult.error}` : ''}

Step results:
${stepSummaries || '(no step output)'}`;

    try {
        const messages = [
            { role: 'system', content: 'You are a concise notification writer. Summarize workflow results naturally and briefly. Use markdown formatting.' },
            { role: 'user', content: prompt },
        ];
        const result = await _makeAICall(messages, _lastProviderConfig, []);
        const text = result?.textContent || result?.content;
        if (text && text.trim().length > 10) {
            return text.trim();
        }
    } catch (err) {
        logger.warn('workflows', `AI summary failed, using raw markdown: ${err.message}`);
    }

    return buildResultMarkdown(structuredResult);
}

// ══════════════════════════════════════════
//  Automation Chat Message
// ══════════════════════════════════════════

/**
 * Send a message to the chat UI from an automation source (timer, workflow, heartbeat, etc.).
 * Appears as a system/automation bubble in the conversation.
 */
function sendAutomationMessage(content, source, title) {
    const id = 'auto_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    sendToRenderer('automation-message', {
        id,
        content,
        source: source || 'automation',
        title: title || undefined,
        timestamp: Date.now(),
    });
    logger.info('workflows', `Automation message sent [${source}]: ${(title || '').slice(0, 40)} — ${(content || '').slice(0, 80)}`);
}

// ══════════════════════════════════════════
//  Exports
// ══════════════════════════════════════════

module.exports = {
    // IPC
    registerWorkflowIPC,

    // CRUD
    createWorkflow,
    getWorkflow,
    listWorkflows,
    updateWorkflow,
    deleteWorkflow,

    // Execution
    executeWorkflow,
    getWorkflowRuns,
    getRunDetail,
    getAllRuns,

    // Timer
    setTimer,
    cancelTimer,

    // Automation
    sendAutomationMessage,

    // AI tools
    getWorkflowToolDefinitions: () => WORKFLOW_TOOL_DEFINITIONS,
    executeWorkflowTool,

    // Host wiring
    setAICallFunction,
    setToolExecutor,
    setToolSetResolver,
    setToolDefinitionsGetter,
    setProviderConfig,
    setMainWindow,

    // Result pipeline
    setChatActive,
    flushResultQueue,
};
