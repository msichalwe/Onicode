/**
 * Scheduler — Cron-based task scheduler for Onicode
 *
 * Supports 5-field cron expressions (minute hour day-of-month month day-of-week).
 * Schedules can fire AI prompts, workflows, or shell commands.
 * Concurrency-limited (per-schedule + global cap).
 *
 * Storage: SQLite via require('./storage') — scheduleStorage object.
 * IPC: 8 handlers (scheduler-list, scheduler-get, scheduler-create, scheduler-update,
 *       scheduler-delete, scheduler-pause, scheduler-resume, scheduler-run-now).
 */

const { execSync } = require('child_process');
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
function setMainWindow(win) {
    _mainWindow = win;
}

function sendToRenderer(channel, data) {
    if (_mainWindow?.webContents) {
        _mainWindow.webContents.send(channel, data);
    }
}

// External function hooks — set by the host (index.js)
let _makeAICall = null;
let _executeWorkflow = null;
let _sendAutomationMessageFn = null;

function setAICallFunction(fn) { _makeAICall = fn; }
function setWorkflowExecutor(fn) { _executeWorkflow = fn; }
function setSendAutomationMessage(fn) { _sendAutomationMessageFn = fn; }

/**
 * Send a message to the chat from the scheduler (background).
 */
function _sendAutomationMessage(content, source, title) {
    if (_sendAutomationMessageFn) {
        _sendAutomationMessageFn(content, source, title);
    } else {
        // Fallback: send directly via renderer
        sendToRenderer('automation-message', {
            id: generateId(),
            content,
            source: source || 'scheduler',
            title: title || 'Scheduled Task',
            timestamp: Date.now(),
        });
    }
}

// ══════════════════════════════════════════
//  ID Generator
// ══════════════════════════════════════════

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ══════════════════════════════════════════
//  Cron Parser (inline — no npm dependency)
// ══════════════════════════════════════════

/**
 * Parse a single cron field into an array of valid integer values.
 *
 * Supports: *, star/n (step), n-m (range), n-m/s (range+step), comma-separated values.
 * @param {string} field — one segment of a cron expression
 * @param {number} min — minimum allowed value (inclusive)
 * @param {number} max — maximum allowed value (inclusive)
 * @returns {number[]} sorted array of matching values
 */
function parseCronField(field, min, max) {
    const values = new Set();

    const parts = field.split(',');
    for (const part of parts) {
        const trimmed = part.trim();

        // Step: */n or n-m/s
        if (trimmed.includes('/')) {
            const [rangePart, stepStr] = trimmed.split('/');
            const step = parseInt(stepStr, 10);
            if (isNaN(step) || step <= 0) continue;

            let start = min;
            let end = max;

            if (rangePart !== '*') {
                if (rangePart.includes('-')) {
                    const [lo, hi] = rangePart.split('-').map(Number);
                    start = Math.max(lo, min);
                    end = Math.min(hi, max);
                } else {
                    start = Math.max(parseInt(rangePart, 10), min);
                }
            }

            for (let i = start; i <= end; i += step) {
                values.add(i);
            }
            continue;
        }

        // Wildcard
        if (trimmed === '*') {
            for (let i = min; i <= max; i++) values.add(i);
            continue;
        }

        // Range: n-m
        if (trimmed.includes('-')) {
            const [lo, hi] = trimmed.split('-').map(Number);
            const start = Math.max(lo, min);
            const end = Math.min(hi, max);
            for (let i = start; i <= end; i++) values.add(i);
            continue;
        }

        // Single value
        const val = parseInt(trimmed, 10);
        if (!isNaN(val) && val >= min && val <= max) {
            values.add(val);
        }
    }

    return [...values].sort((a, b) => a - b);
}

/**
 * Check if a cron expression matches a given Date.
 *
 * Cron format: minute hour day-of-month month day-of-week
 * Day-of-week: 0-7 where 0 and 7 both represent Sunday.
 *
 * @param {string} cronExpr — 5-field cron expression
 * @param {Date} date
 * @returns {boolean}
 */
function cronMatches(cronExpr, date) {
    const fields = cronExpr.trim().split(/\s+/);
    if (fields.length !== 5) return false;

    const minute = date.getMinutes();
    const hour = date.getHours();
    const dayOfMonth = date.getDate();
    const month = date.getMonth() + 1; // JS months are 0-based
    let dayOfWeek = date.getDay(); // 0 = Sunday

    const minutes = parseCronField(fields[0], 0, 59);
    const hours = parseCronField(fields[1], 0, 23);
    const daysOfMonth = parseCronField(fields[2], 1, 31);
    const months = parseCronField(fields[3], 1, 12);

    // Parse day-of-week: 0-7, normalize 7 → 0
    const rawDow = parseCronField(fields[4], 0, 7);
    const daysOfWeek = rawDow.map(d => d === 7 ? 0 : d);

    return (
        minutes.includes(minute) &&
        hours.includes(hour) &&
        daysOfMonth.includes(dayOfMonth) &&
        months.includes(month) &&
        daysOfWeek.includes(dayOfWeek)
    );
}

/**
 * Compute the next run time for a cron expression, scanning forward from `fromDate`.
 * Scans minute-by-minute up to 366 days ahead.
 *
 * @param {string} cronExpr — 5-field cron expression
 * @param {Date} [fromDate] — start scanning from this time (default: now)
 * @returns {Date|null} — next matching Date, or null if none found within 366 days
 */
function computeNextRun(cronExpr, fromDate) {
    const start = fromDate ? new Date(fromDate) : new Date();
    // Round up to the next whole minute
    start.setSeconds(0, 0);
    start.setMinutes(start.getMinutes() + 1);

    const maxMinutes = 366 * 24 * 60;
    const candidate = new Date(start);

    for (let i = 0; i < maxMinutes; i++) {
        if (cronMatches(cronExpr, candidate)) {
            return new Date(candidate);
        }
        candidate.setMinutes(candidate.getMinutes() + 1);
    }

    return null;
}

// ══════════════════════════════════════════
//  Concurrency Manager
// ══════════════════════════════════════════

const MAX_GLOBAL_CONCURRENT = 5;

class ConcurrencyManager {
    constructor() {
        /** @type {Map<string, Set<string>>} scheduleId → set of runIds */
        this._running = new Map();
        this._globalRunning = 0;
    }

    /**
     * Check whether a schedule is allowed to fire a new run.
     * @param {string} scheduleId
     * @param {number} maxConcurrent — per-schedule concurrency cap (default 1)
     * @returns {boolean}
     */
    canRun(scheduleId, maxConcurrent = 1) {
        if (this._globalRunning >= MAX_GLOBAL_CONCURRENT) return false;
        const running = this._running.get(scheduleId);
        if (running && running.size >= maxConcurrent) return false;
        return true;
    }

    /**
     * Mark a run as active.
     * @param {string} scheduleId
     * @param {string} runId
     */
    markRunning(scheduleId, runId) {
        if (!this._running.has(scheduleId)) {
            this._running.set(scheduleId, new Set());
        }
        this._running.get(scheduleId).add(runId);
        this._globalRunning++;
    }

    /**
     * Mark a run as complete.
     * @param {string} scheduleId
     * @param {string} runId
     */
    markDone(scheduleId, runId) {
        const running = this._running.get(scheduleId);
        if (running) {
            running.delete(runId);
            if (running.size === 0) this._running.delete(scheduleId);
        }
        this._globalRunning = Math.max(0, this._globalRunning - 1);
    }
}

const concurrency = new ConcurrencyManager();

// ══════════════════════════════════════════
//  Schedule Actions
// ══════════════════════════════════════════

/**
 * Execute a schedule's action.
 * @param {object} schedule — the schedule row
 * @returns {Promise<{ success: boolean, output?: string, error?: string }>}
 */
async function executeAction(schedule) {
    let action;
    try {
        action = typeof schedule.action === 'string'
            ? JSON.parse(schedule.action)
            : schedule.action;
    } catch {
        return { success: false, error: 'Invalid action JSON' };
    }

    const type = action?.type;

    switch (type) {
        case 'ai_prompt': {
            if (!_makeAICall) {
                return { success: false, error: 'AI call function not configured' };
            }
            try {
                const result = await _makeAICall(action.prompt || action.payload);
                return { success: true, output: typeof result === 'string' ? result : JSON.stringify(result).slice(0, 2000) };
            } catch (err) {
                return { success: false, error: `AI call failed: ${err.message}` };
            }
        }

        case 'workflow': {
            if (!_executeWorkflow) {
                return { success: false, error: 'Workflow executor not configured' };
            }
            try {
                const wfId = action.workflow_id || schedule.workflow_id;
                const result = await _executeWorkflow(wfId, action.params);
                return { success: true, output: typeof result === 'string' ? result : JSON.stringify(result).slice(0, 2000) };
            } catch (err) {
                return { success: false, error: `Workflow failed: ${err.message}` };
            }
        }

        case 'command': {
            try {
                const cmd = action.command || action.payload;
                if (!cmd) return { success: false, error: 'No command specified' };
                const output = execSync(cmd, {
                    timeout: 30000,
                    encoding: 'utf-8',
                    maxBuffer: 1024 * 1024,
                }).trim();
                return { success: true, output: output.slice(0, 2000) };
            } catch (err) {
                return { success: false, error: `Command failed: ${err.message?.slice(0, 500)}` };
            }
        }

        default:
            return { success: false, error: `Unknown action type: ${type}` };
    }
}

// ══════════════════════════════════════════
//  Scheduler Loop
// ══════════════════════════════════════════

let _intervalId = null;
const TICK_INTERVAL_MS = 15_000; // 15 seconds

/**
 * Start the scheduler polling loop.
 * Checks all enabled schedules every 15 seconds and fires those whose next_run_at <= now.
 */
function startSchedulerLoop() {
    if (_intervalId) {
        logger.warn('scheduler', 'Scheduler loop already running');
        return;
    }

    logger.info('scheduler', 'Starting scheduler loop (tick every 15s)');

    _intervalId = setInterval(() => {
        try {
            tick();
        } catch (err) {
            logger.error('scheduler', `Scheduler tick error: ${err.message}`);
        }
    }, TICK_INTERVAL_MS);

    // Fire an immediate first tick
    try { tick(); } catch (err) {
        logger.error('scheduler', `Initial tick error: ${err.message}`);
    }
}

/**
 * Stop the scheduler polling loop.
 */
function stopSchedulerLoop() {
    if (_intervalId) {
        clearInterval(_intervalId);
        _intervalId = null;
        logger.info('scheduler', 'Scheduler loop stopped');
    }
}

/**
 * Single tick: check all enabled schedules, fire those that are due.
 */
function tick() {
    const schedules = listSchedules();
    const now = Date.now();
    let fired = 0;

    for (const schedule of schedules) {
        if (!schedule.enabled) continue;
        if (!schedule.next_run_at) continue;

        const nextRunTs = new Date(schedule.next_run_at).getTime();
        if (nextRunTs > now) continue;

        // Rate limit check
        if (schedule.rate_limit_seconds && schedule.last_run_at) {
            const lastTs = new Date(schedule.last_run_at).getTime();
            if (now - lastTs < schedule.rate_limit_seconds * 1000) {
                logger.debug('scheduler', `Rate-limited: ${schedule.name} (${schedule.id})`);
                continue;
            }
        }

        // Concurrency check
        const maxConcurrent = schedule.max_concurrent || 1;
        if (!concurrency.canRun(schedule.id, maxConcurrent)) {
            logger.info('scheduler', `Skipping ${schedule.name} — concurrency limit reached`);
            continue;
        }

        // Fire!
        const runId = generateId();
        concurrency.markRunning(schedule.id, runId);
        fired++;

        // Detect one-time flag from the action JSON
        let parsedAction;
        try { parsedAction = typeof schedule.action === 'string' ? JSON.parse(schedule.action) : schedule.action; } catch { parsedAction = {}; }
        const isOneTime = !!parsedAction.one_time;

        logger.info('scheduler', `Firing schedule: ${schedule.name} (${schedule.id}) run=${runId}${isOneTime ? ' [one-time]' : ''}`);

        if (isOneTime) {
            // One-time schedule: disable immediately so it never fires again
            updateSchedule(schedule.id, {
                last_run_at: new Date().toISOString(),
                next_run_at: null,
                enabled: 0,
            });
        } else {
            // Recurring schedule: compute next run
            const nextRun = computeNextRun(schedule.cron_expression, new Date());
            updateSchedule(schedule.id, {
                last_run_at: new Date().toISOString(),
                next_run_at: nextRun ? nextRun.toISOString() : null,
            });
        }

        // Execute action asynchronously
        executeAction(schedule)
            .then(result => {
                concurrency.markDone(schedule.id, runId);
                logger.info('scheduler', `Schedule ${schedule.name} run=${runId} completed`, {
                    success: result.success,
                    output: result.output?.slice(0, 200),
                    error: result.error,
                });
                sendToRenderer('scheduler-status', {
                    scheduleId: schedule.id,
                    runId,
                    status: result.success ? 'completed' : 'failed',
                    output: result.output,
                    error: result.error,
                    timestamp: new Date().toISOString(),
                });

                // Deliver result to chat via automation message
                const statusEmoji = result.success ? '\u2705' : '\u274c';
                const msg = result.success
                    ? `${statusEmoji} **${schedule.name}** completed${result.output ? ':\n' + result.output.slice(0, 1000) : '.'}`
                    : `${statusEmoji} **${schedule.name}** failed: ${result.error || 'Unknown error'}`;
                _sendAutomationMessage(msg, 'scheduler', schedule.name);

                if (isOneTime) {
                    logger.info('scheduler', `One-time schedule "${schedule.name}" (${schedule.id}) has been disabled after firing`);
                }
            })
            .catch(err => {
                concurrency.markDone(schedule.id, runId);
                logger.error('scheduler', `Schedule ${schedule.name} run=${runId} crashed: ${err.message}`);
                sendToRenderer('scheduler-status', {
                    scheduleId: schedule.id,
                    runId,
                    status: 'error',
                    error: err.message,
                    timestamp: new Date().toISOString(),
                });
                _sendAutomationMessage(`\u274c **${schedule.name}** error: ${err.message}`, 'scheduler', schedule.name);
            });
    }

    // Emit tick event to renderer
    if (fired > 0 || schedules.length > 0) {
        sendToRenderer('scheduler-tick', {
            timestamp: new Date().toISOString(),
            checked: schedules.length,
            fired,
        });
    }
}

// ══════════════════════════════════════════
//  CRUD Operations
// ══════════════════════════════════════════

/**
 * Create a new schedule.
 * @param {object} opts
 * @param {string} opts.name — human-readable name
 * @param {string} opts.cron_expression — 5-field cron expression
 * @param {object} opts.action — { type: 'ai_prompt'|'workflow'|'command', ... }
 * @param {string} [opts.workflow_id] — associated workflow ID
 * @param {number} [opts.max_concurrent=1] — max concurrent runs for this schedule
 * @param {number} [opts.rate_limit_seconds=0] — minimum seconds between runs
 * @returns {object} the created schedule
 */
function createSchedule({ name, cron_expression, action, workflow_id, max_concurrent, rate_limit_seconds, one_time }) {
    if (!name || !cron_expression || !action) {
        throw new Error('name, cron_expression, and action are required');
    }

    // Validate cron expression
    const nextRun = computeNextRun(cron_expression, new Date());
    if (!nextRun) {
        throw new Error(`Invalid or unreachable cron expression: ${cron_expression}`);
    }

    const id = generateId();
    const now = new Date().toISOString();

    // Embed one_time flag inside the action JSON so it persists without schema migration
    const actionObj = typeof action === 'string' ? JSON.parse(action) : { ...action };
    if (one_time) actionObj.one_time = true;
    const actionStr = JSON.stringify(actionObj);

    const schedule = {
        id,
        name,
        cron_expression,
        action: actionStr,
        workflow_id: workflow_id || null,
        max_concurrent: max_concurrent || 1,
        rate_limit_seconds: rate_limit_seconds || 0,
        enabled: 1,
        created_at: now,
        updated_at: now,
        last_run_at: null,
        next_run_at: nextRun.toISOString(),
    };

    try {
        const storage = getStorage();
        storage.scheduleStorage.save(schedule);
        logger.info('scheduler', `Created schedule: ${name} (${id}) next_run=${nextRun.toISOString()}`);
    } catch (err) {
        logger.error('scheduler', `Failed to create schedule: ${err.message}`);
        throw err;
    }

    return schedule;
}

/**
 * Update a schedule's fields.
 * @param {string} id
 * @param {object} updates — partial fields to update
 * @returns {object} updated schedule
 */
function updateSchedule(id, updates) {
    try {
        const storage = getStorage();
        const existing = storage.scheduleStorage.get(id);
        if (!existing) throw new Error(`Schedule not found: ${id}`);

        // If cron expression changed, recompute next run
        if (updates.cron_expression && updates.cron_expression !== existing.cron_expression) {
            const nextRun = computeNextRun(updates.cron_expression, new Date());
            if (!nextRun) throw new Error(`Invalid or unreachable cron expression: ${updates.cron_expression}`);
            updates.next_run_at = nextRun.toISOString();
        }

        // Serialize action if provided as object
        if (updates.action && typeof updates.action === 'object') {
            updates.action = JSON.stringify(updates.action);
        }

        updates.updated_at = new Date().toISOString();

        storage.scheduleStorage.update(id, updates);
        logger.info('scheduler', `Updated schedule: ${id}`, Object.keys(updates));
        return { ...existing, ...updates };
    } catch (err) {
        logger.error('scheduler', `Failed to update schedule ${id}: ${err.message}`);
        throw err;
    }
}

/**
 * Delete a schedule.
 * @param {string} id
 */
function deleteSchedule(id) {
    try {
        const storage = getStorage();
        storage.scheduleStorage.delete(id);
        logger.info('scheduler', `Deleted schedule: ${id}`);
    } catch (err) {
        logger.error('scheduler', `Failed to delete schedule ${id}: ${err.message}`);
        throw err;
    }
}

/**
 * List all schedules.
 * @returns {object[]}
 */
function listSchedules() {
    try {
        const storage = getStorage();
        return storage.scheduleStorage.list();
    } catch (err) {
        logger.error('scheduler', `Failed to list schedules: ${err.message}`);
        return [];
    }
}

/**
 * Get a single schedule by ID.
 * @param {string} id
 * @returns {object|null}
 */
function getSchedule(id) {
    try {
        const storage = getStorage();
        return storage.scheduleStorage.get(id) || null;
    } catch (err) {
        logger.error('scheduler', `Failed to get schedule ${id}: ${err.message}`);
        return null;
    }
}

/**
 * Pause a schedule (set enabled = 0).
 * @param {string} id
 * @returns {object} updated schedule
 */
function pauseSchedule(id) {
    return updateSchedule(id, { enabled: 0 });
}

/**
 * Resume a schedule (set enabled = 1, recompute next_run_at).
 * @param {string} id
 * @returns {object} updated schedule
 */
function resumeSchedule(id) {
    const schedule = getSchedule(id);
    if (!schedule) throw new Error(`Schedule not found: ${id}`);

    const nextRun = computeNextRun(schedule.cron_expression, new Date());
    return updateSchedule(id, {
        enabled: 1,
        next_run_at: nextRun ? nextRun.toISOString() : null,
    });
}

/**
 * Immediately fire a schedule (bypass timing, still respects concurrency).
 * @param {string} id
 * @returns {Promise<{ success: boolean, output?: string, error?: string }>}
 */
async function runScheduleNow(id) {
    const schedule = getSchedule(id);
    if (!schedule) return { success: false, error: `Schedule not found: ${id}` };

    const maxConcurrent = schedule.max_concurrent || 1;
    if (!concurrency.canRun(id, maxConcurrent)) {
        return { success: false, error: 'Concurrency limit reached — try again later' };
    }

    const runId = generateId();
    concurrency.markRunning(id, runId);

    logger.info('scheduler', `Manual run: ${schedule.name} (${id}) run=${runId}`);

    try {
        const result = await executeAction(schedule);
        concurrency.markDone(id, runId);

        // Update last_run_at
        updateSchedule(id, { last_run_at: new Date().toISOString() });

        sendToRenderer('scheduler-status', {
            scheduleId: id,
            runId,
            status: result.success ? 'completed' : 'failed',
            output: result.output,
            error: result.error,
            timestamp: new Date().toISOString(),
            manual: true,
        });

        return result;
    } catch (err) {
        concurrency.markDone(id, runId);
        return { success: false, error: err.message };
    }
}

// ══════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════

/**
 * Register all scheduler IPC handlers.
 * @param {Electron.IpcMain} ipcMainArg
 * @param {function} getWindow — returns the BrowserWindow instance
 */
function registerSchedulerIPC(ipcMainArg, getWindow) {
    const ipc = ipcMainArg;

    // Keep mainWindow reference fresh
    if (getWindow) {
        _mainWindow = getWindow();
        // Re-fetch periodically in case window is recreated
        setInterval(() => { _mainWindow = getWindow(); }, 5000);
    }

    ipc.handle('scheduler-list', () => {
        try {
            return { success: true, schedules: listSchedules() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('scheduler-get', (_event, id) => {
        try {
            const schedule = getSchedule(id);
            if (!schedule) return { success: false, error: 'Not found' };
            return { success: true, schedule };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('scheduler-create', (_event, opts) => {
        try {
            const schedule = createSchedule(opts);
            return { success: true, schedule };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('scheduler-update', (_event, id, updates) => {
        try {
            const schedule = updateSchedule(id, updates);
            return { success: true, schedule };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('scheduler-delete', (_event, id) => {
        try {
            deleteSchedule(id);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('scheduler-pause', (_event, id) => {
        try {
            const schedule = pauseSchedule(id);
            return { success: true, schedule };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('scheduler-resume', (_event, id) => {
        try {
            const schedule = resumeSchedule(id);
            return { success: true, schedule };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('scheduler-run-now', async (_event, id) => {
        try {
            const result = await runScheduleNow(id);
            return { success: result.success, ...result };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    logger.info('scheduler', 'IPC handlers registered (8 channels)');
}

// ══════════════════════════════════════════
//  AI Tool Definitions
// ══════════════════════════════════════════

const SCHEDULER_TOOL_DEFINITIONS = [
    {
        type: 'function',
        function: {
            name: 'create_schedule',
            description: 'Create a new cron-based schedule (one-time or recurring). Supports AI prompts, workflows, or shell commands as actions. Cron format: "minute hour day-of-month month day-of-week".',
            parameters: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Human-readable name for the schedule',
                    },
                    cron: {
                        type: 'string',
                        description: 'Cron expression (5 fields): "minute hour day-of-month month day-of-week". Examples: "0 9 * * 1-5" (weekdays 9am), "*/30 * * * *" (every 30 min), "45 14 * * *" (2:45pm daily)',
                    },
                    action_type: {
                        type: 'string',
                        enum: ['ai_prompt', 'workflow', 'command'],
                        description: 'Type of action to execute: ai_prompt (send prompt to AI), workflow (run workflow), command (shell command)',
                    },
                    action_payload: {
                        type: 'string',
                        description: 'The action payload: prompt text for ai_prompt, command string for command, or params JSON for workflow',
                    },
                    workflow_id: {
                        type: 'string',
                        description: 'Workflow ID (required when action_type is "workflow")',
                    },
                    one_time: {
                        type: 'boolean',
                        description: 'If true, schedule fires once then auto-disables. Use for one-off delayed tasks (e.g. "remind me at 3pm"). Default: false (recurring).',
                    },
                },
                required: ['name', 'cron', 'action_type', 'action_payload'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_schedules',
            description: 'List all scheduled tasks with their cron expressions, next run times, and status.',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'delete_schedule',
            description: 'Delete a scheduled task by its ID.',
            parameters: {
                type: 'object',
                properties: {
                    schedule_id: {
                        type: 'string',
                        description: 'The ID of the schedule to delete',
                    },
                },
                required: ['schedule_id'],
            },
        },
    },
];

// ══════════════════════════════════════════
//  Tool Executor
// ══════════════════════════════════════════

/**
 * Execute a scheduler AI tool.
 * @param {string} toolName
 * @param {object} args
 * @returns {Promise<object>}
 */
async function executeSchedulerTool(toolName, args) {
    switch (toolName) {
        case 'create_schedule': {
            const { name, cron, action_type, action_payload, workflow_id, one_time } = args;
            const action = { type: action_type };

            if (action_type === 'ai_prompt') {
                action.prompt = action_payload;
            } else if (action_type === 'command') {
                action.command = action_payload;
            } else if (action_type === 'workflow') {
                action.workflow_id = workflow_id;
                try { action.params = JSON.parse(action_payload); } catch { action.params = {}; }
            }

            try {
                const schedule = createSchedule({
                    name,
                    cron_expression: cron,
                    action,
                    workflow_id,
                    one_time: !!one_time,
                });
                const typeLabel = one_time ? 'One-time' : 'Recurring';
                return {
                    message: `${typeLabel} schedule "${name}" created. Next run: ${schedule.next_run_at}`,
                    schedule: {
                        id: schedule.id,
                        name: schedule.name,
                        cron: schedule.cron_expression,
                        next_run: schedule.next_run_at,
                        action_type,
                        one_time: !!one_time,
                    },
                };
            } catch (err) {
                return { error: err.message };
            }
        }

        case 'list_schedules': {
            const schedules = listSchedules();
            if (schedules.length === 0) {
                return { message: 'No schedules configured.' };
            }
            const summary = schedules.map(s => {
                let actionData;
                try { actionData = typeof s.action === 'string' ? JSON.parse(s.action) : s.action; } catch { actionData = {}; }
                return {
                    id: s.id,
                    name: s.name,
                    cron: s.cron_expression,
                    enabled: !!s.enabled,
                    one_time: !!actionData.one_time,
                    next_run: s.next_run_at,
                    last_run: s.last_run_at,
                };
            });
            return {
                message: `${schedules.length} schedule(s) found.`,
                schedules: summary,
            };
        }

        case 'delete_schedule': {
            const { schedule_id } = args;
            const existing = getSchedule(schedule_id);
            if (!existing) return { error: `Schedule not found: ${schedule_id}` };

            try {
                deleteSchedule(schedule_id);
                return { message: `Schedule "${existing.name}" (${schedule_id}) deleted.` };
            } catch (err) {
                return { error: err.message };
            }
        }

        default:
            return { error: `Unknown scheduler tool: ${toolName}` };
    }
}

// ══════════════════════════════════════════
//  Exports
// ══════════════════════════════════════════

module.exports = {
    // IPC + lifecycle
    registerSchedulerIPC,
    startSchedulerLoop,
    stopSchedulerLoop,

    // CRUD
    createSchedule,
    updateSchedule,
    deleteSchedule,
    listSchedules,
    getSchedule,
    pauseSchedule,
    resumeSchedule,
    runScheduleNow,

    // AI tools
    getSchedulerToolDefinitions: () => SCHEDULER_TOOL_DEFINITIONS,
    executeSchedulerTool,

    // Host wiring
    setAICallFunction,
    setWorkflowExecutor,
    setMainWindow,
    setSendAutomationMessage,
};
