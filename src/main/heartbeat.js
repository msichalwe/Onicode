/**
 * Heartbeat System — Periodic AI monitoring and automated checks.
 *
 * Runs on a configurable interval, executing a checklist of monitoring tasks:
 *   - ai_eval:          AI evaluates a prompt, triggers workflow or notification if action needed
 *   - command_check:    Runs a shell command, non-zero exit = action needed
 *   - workflow_trigger: Always triggers a linked workflow
 *
 * Config stored in SQLite (heartbeat_config table, single row id='default').
 * Checklist stored as JSON column within that row.
 *
 * Quiet hours respected — heartbeat skips execution during configured window.
 */

const { execSync } = require('child_process');
const { Notification } = require('electron');
const { logger } = require('./logger');

// ══════════════════════════════════════════
//  Lazy storage (avoids circular require)
// ══════════════════════════════════════════

let _storage = null;

function getStorage() {
    if (!_storage) _storage = require('./storage');
    return _storage;
}

// ══════════════════════════════════════════
//  External dependencies (injected)
// ══════════════════════════════════════════

let _mainWindow = null;
let _makeAICall = null;
let _executeWorkflow = null;
let _lastProviderConfig = null;

function setMainWindow(win) {
    _mainWindow = win;
}

function setAICallFunction(fn) {
    _makeAICall = fn;
}

function setWorkflowExecutor(fn) {
    _executeWorkflow = fn;
}

function setProviderConfig(config) {
    _lastProviderConfig = config;
}

/**
 * Helper: call _makeAICall with proper (messages, providerConfig) signature.
 */
async function _callAI(prompt) {
    if (!_makeAICall) throw new Error('AI call function not configured');
    if (!_lastProviderConfig) throw new Error('No provider configured — send at least one chat message first');
    const messages = [
        { role: 'system', content: 'You are an AI monitoring agent running a heartbeat check. Respond concisely.' },
        { role: 'user', content: prompt },
    ];
    const result = await _makeAICall(messages, _lastProviderConfig, []);
    if (typeof result === 'string') return result;
    if (result?.textContent) return result.textContent;
    if (result?.content) {
        if (typeof result.content === 'string') return result.content;
        if (Array.isArray(result.content)) {
            return result.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        }
    }
    if (result?.choices?.[0]?.message?.content) return result.choices[0].message.content;
    return JSON.stringify(result).slice(0, 4000);
}

// ══════════════════════════════════════════
//  Timer state
// ══════════════════════════════════════════

let _intervalHandle = null;

// ══════════════════════════════════════════
//  ID generation
// ══════════════════════════════════════════

function generateId() {
    return 'hbc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

// ══════════════════════════════════════════
//  SQLite schema bootstrap
// ══════════════════════════════════════════

function ensureHeartbeatDefaults() {
    try {
        const db = getStorage().getDB();

        db.exec(`
            CREATE TABLE IF NOT EXISTS heartbeat_config (
                id TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 0,
                interval_minutes INTEGER NOT NULL DEFAULT 30,
                checklist TEXT NOT NULL DEFAULT '[]',
                quiet_hours_start TEXT NOT NULL DEFAULT '22:00',
                quiet_hours_end TEXT NOT NULL DEFAULT '08:00',
                max_actions_per_beat INTEGER NOT NULL DEFAULT 3,
                last_beat_at INTEGER,
                updated_at INTEGER NOT NULL
            )
        `);

        const row = db.prepare('SELECT id FROM heartbeat_config WHERE id = ?').get('default');
        if (!row) {
            db.prepare(`
                INSERT INTO heartbeat_config (id, enabled, interval_minutes, checklist, quiet_hours_start, quiet_hours_end, max_actions_per_beat, updated_at)
                VALUES (?, 0, 30, '[]', '22:00', '08:00', 3, ?)
            `).run('default', Date.now());
            logger.info('heartbeat', 'Default heartbeat config created');
        }
    } catch (err) {
        logger.error('heartbeat', `Failed to ensure heartbeat defaults: ${err.message}`);
    }
}

// ══════════════════════════════════════════
//  Config CRUD
// ══════════════════════════════════════════

function getHeartbeatConfig() {
    try {
        const db = getStorage().getDB();
        const row = db.prepare('SELECT * FROM heartbeat_config WHERE id = ?').get('default');
        if (!row) return null;

        return {
            ...row,
            enabled: !!row.enabled,
            checklist: JSON.parse(row.checklist || '[]'),
        };
    } catch (err) {
        logger.error('heartbeat', `Failed to get config: ${err.message}`);
        return null;
    }
}

function updateHeartbeatConfig(updates) {
    try {
        const db = getStorage().getDB();
        const allowed = ['enabled', 'interval_minutes', 'quiet_hours_start', 'quiet_hours_end', 'max_actions_per_beat'];
        const sets = [];
        const values = [];

        for (const key of allowed) {
            if (updates[key] !== undefined) {
                let val = updates[key];
                if (key === 'enabled') val = val ? 1 : 0;
                if (key === 'interval_minutes') val = Math.max(5, Math.min(240, val));
                sets.push(`${key} = ?`);
                values.push(val);
            }
        }

        if (sets.length === 0) return getHeartbeatConfig();

        sets.push('updated_at = ?');
        values.push(Date.now());
        values.push('default');

        db.prepare(`UPDATE heartbeat_config SET ${sets.join(', ')} WHERE id = ?`).run(...values);
        logger.info('heartbeat', 'Config updated', updates);

        // Restart timer if interval or enabled changed
        const config = getHeartbeatConfig();
        if (config?.enabled) {
            startHeartbeat();
        } else {
            stopHeartbeat();
        }

        return config;
    } catch (err) {
        logger.error('heartbeat', `Failed to update config: ${err.message}`);
        return null;
    }
}

// ══════════════════════════════════════════
//  Checklist CRUD
// ══════════════════════════════════════════

function addHeartbeatCheck(check) {
    try {
        const db = getStorage().getDB();
        const config = getHeartbeatConfig();
        if (!config) return null;

        const newCheck = {
            id: generateId(),
            name: check.name || 'Unnamed check',
            type: check.type || 'ai_eval',
            prompt: check.prompt || null,
            command: check.command || null,
            trigger_workflow_id: check.trigger_workflow_id || null,
            priority: check.priority ?? 10,
            enabled: true,
            last_checked_at: null,
            created_at: Date.now(),
        };

        const checklist = config.checklist;
        checklist.push(newCheck);

        db.prepare('UPDATE heartbeat_config SET checklist = ?, updated_at = ? WHERE id = ?')
            .run(JSON.stringify(checklist), Date.now(), 'default');

        logger.info('heartbeat', `Check added: ${newCheck.name}`, { id: newCheck.id, type: newCheck.type });
        return newCheck;
    } catch (err) {
        logger.error('heartbeat', `Failed to add check: ${err.message}`);
        return null;
    }
}

function removeHeartbeatCheck(checkId) {
    try {
        const db = getStorage().getDB();
        const config = getHeartbeatConfig();
        if (!config) return false;

        const before = config.checklist.length;
        const checklist = config.checklist.filter(c => c.id !== checkId);
        if (checklist.length === before) return false;

        db.prepare('UPDATE heartbeat_config SET checklist = ?, updated_at = ? WHERE id = ?')
            .run(JSON.stringify(checklist), Date.now(), 'default');

        logger.info('heartbeat', `Check removed: ${checkId}`);
        return true;
    } catch (err) {
        logger.error('heartbeat', `Failed to remove check: ${err.message}`);
        return false;
    }
}

function updateHeartbeatCheck(checkId, updates) {
    try {
        const db = getStorage().getDB();
        const config = getHeartbeatConfig();
        if (!config) return null;

        const checklist = config.checklist;
        const idx = checklist.findIndex(c => c.id === checkId);
        if (idx === -1) return null;

        const allowed = ['name', 'type', 'prompt', 'command', 'trigger_workflow_id', 'priority', 'enabled'];
        for (const key of allowed) {
            if (updates[key] !== undefined) {
                checklist[idx][key] = updates[key];
            }
        }

        db.prepare('UPDATE heartbeat_config SET checklist = ?, updated_at = ? WHERE id = ?')
            .run(JSON.stringify(checklist), Date.now(), 'default');

        logger.info('heartbeat', `Check updated: ${checkId}`, updates);
        return checklist[idx];
    } catch (err) {
        logger.error('heartbeat', `Failed to update check: ${err.message}`);
        return null;
    }
}

// ══════════════════════════════════════════
//  Quiet hours check
// ══════════════════════════════════════════

function isInQuietHours(startStr, endStr) {
    if (!startStr || !endStr) return false;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const [startH, startM] = startStr.split(':').map(Number);
    const [endH, endM] = endStr.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
        // Same-day window (e.g. 09:00 - 17:00)
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
        // Overnight window (e.g. 22:00 - 08:00)
        return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
}

// ══════════════════════════════════════════
//  Heartbeat execution
// ══════════════════════════════════════════

async function executeHeartbeat() {
    const config = getHeartbeatConfig();
    if (!config) {
        logger.warn('heartbeat', 'No config found, skipping beat');
        return { skipped: true, reason: 'no_config' };
    }

    // Check quiet hours
    if (isInQuietHours(config.quiet_hours_start, config.quiet_hours_end)) {
        logger.info('heartbeat', 'In quiet hours, skipping beat');
        return { skipped: true, reason: 'quiet_hours' };
    }

    const checks = config.checklist
        .filter(c => c.enabled !== false)
        .sort((a, b) => (a.priority ?? 10) - (b.priority ?? 10));

    const results = [];
    const actionsToTake = Math.min(checks.length, config.max_actions_per_beat || 3);

    for (let i = 0; i < actionsToTake; i++) {
        const check = checks[i];
        let result = { check_id: check.id, check_name: check.name, type: check.type, action_needed: false };

        try {
            switch (check.type) {
                case 'ai_eval':
                    result = await _executeAIEvalCheck(check, result);
                    break;
                case 'command_check':
                    result = _executeCommandCheck(check, result);
                    break;
                case 'workflow_trigger':
                    result = await _executeWorkflowTrigger(check, result);
                    break;
                default:
                    result.error = `Unknown check type: ${check.type}`;
                    logger.warn('heartbeat', `Unknown check type: ${check.type}`);
            }
        } catch (err) {
            result.error = err.message;
            logger.error('heartbeat', `Check "${check.name}" failed: ${err.message}`);
        }

        // Update last_checked_at for this check
        _updateCheckTimestamp(check.id);

        results.push(result);

        // Emit per-action event
        if (result.action_needed) {
            _emitEvent('heartbeat-action', {
                check_id: check.id,
                check_name: check.name,
                type: check.type,
                reason: result.reason || '',
                urgency: result.urgency || 'low',
                timestamp: Date.now(),
            });
        }
    }

    // Update last_beat_at
    try {
        const db = getStorage().getDB();
        db.prepare('UPDATE heartbeat_config SET last_beat_at = ?, updated_at = ? WHERE id = ?')
            .run(Date.now(), Date.now(), 'default');
    } catch (err) {
        logger.error('heartbeat', `Failed to update last_beat_at: ${err.message}`);
    }

    const summary = {
        timestamp: Date.now(),
        checks_run: results.length,
        actions_needed: results.filter(r => r.action_needed).length,
        errors: results.filter(r => r.error).length,
        results,
    };

    _emitEvent('heartbeat-tick', summary);
    logger.info('heartbeat', `Beat complete: ${summary.checks_run} checks, ${summary.actions_needed} actions`, summary);

    return summary;
}

// ── Check executors ──

async function _executeAIEvalCheck(check, result) {
    const prompt = `You are evaluating a heartbeat check: "${check.name}"\n${check.prompt || ''}\n\nRespond with ONLY a JSON object: { "action_needed": true/false, "reason": "brief reason", "urgency": "low"|"medium"|"high" }`;

    try {
        const response = await _callAI(prompt);
        const jsonMatch = response.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            result.action_needed = !!parsed.action_needed;
            result.reason = parsed.reason || '';
            result.urgency = parsed.urgency || 'low';

            if (result.action_needed) {
                if (check.trigger_workflow_id && _executeWorkflow) {
                    await _executeWorkflow(check.trigger_workflow_id, {
                        trigger: 'heartbeat',
                        check: check.name,
                        reason: result.reason,
                        urgency: result.urgency,
                    });
                    result.workflow_triggered = true;
                } else {
                    _sendNotification(
                        `Heartbeat: ${check.name}`,
                        `[${result.urgency.toUpperCase()}] ${result.reason}`
                    );
                    result.notification_sent = true;
                }
            }
        } else {
            result.error = 'AI response did not contain valid JSON';
        }
    } catch (err) {
        result.error = `AI eval failed: ${err.message}`;
    }

    return result;
}

function _executeCommandCheck(check, result) {
    if (!check.command) {
        result.error = 'No command specified';
        return result;
    }

    try {
        execSync(check.command, { timeout: 30000, stdio: 'pipe' });
        result.action_needed = false;
        result.reason = 'Command exited successfully';
    } catch (err) {
        result.action_needed = true;
        result.reason = `Command exited with code ${err.status || 1}: ${(err.stderr || '').toString().slice(0, 200)}`;
        result.urgency = 'medium';

        _sendNotification(
            `Heartbeat: ${check.name}`,
            `Command check failed (exit ${err.status || 1})`
        );
        result.notification_sent = true;
    }

    return result;
}

async function _executeWorkflowTrigger(check, result) {
    if (!check.trigger_workflow_id) {
        result.error = 'No workflow ID specified';
        return result;
    }

    if (!_executeWorkflow) {
        result.error = 'Workflow executor not configured';
        return result;
    }

    try {
        await _executeWorkflow(check.trigger_workflow_id, {
            trigger: 'heartbeat',
            check: check.name,
        });
        result.action_needed = true;
        result.reason = 'Workflow triggered on schedule';
        result.workflow_triggered = true;
    } catch (err) {
        result.error = `Workflow execution failed: ${err.message}`;
    }

    return result;
}

// ══════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════

function _updateCheckTimestamp(checkId) {
    try {
        const config = getHeartbeatConfig();
        if (!config) return;

        const checklist = config.checklist;
        const idx = checklist.findIndex(c => c.id === checkId);
        if (idx === -1) return;

        checklist[idx].last_checked_at = Date.now();

        const db = getStorage().getDB();
        db.prepare('UPDATE heartbeat_config SET checklist = ?, updated_at = ? WHERE id = ?')
            .run(JSON.stringify(checklist), Date.now(), 'default');
    } catch (err) {
        logger.error('heartbeat', `Failed to update check timestamp: ${err.message}`);
    }
}

function _sendNotification(title, body) {
    try {
        new Notification({ title, body }).show();
    } catch (err) {
        logger.warn('heartbeat', `Failed to show notification: ${err.message}`);
    }
}

function _emitEvent(channel, data) {
    if (_mainWindow?.webContents) {
        _mainWindow.webContents.send(channel, data);
    }
}

// ══════════════════════════════════════════
//  Timer management
// ══════════════════════════════════════════

function startHeartbeat() {
    stopHeartbeat();

    const config = getHeartbeatConfig();
    if (!config || !config.enabled) {
        logger.info('heartbeat', 'Heartbeat disabled, not starting timer');
        return;
    }

    const intervalMs = (config.interval_minutes || 30) * 60 * 1000;

    _intervalHandle = setInterval(async () => {
        try {
            await executeHeartbeat();
        } catch (err) {
            logger.error('heartbeat', `Heartbeat execution error: ${err.message}`);
        }
    }, intervalMs);

    logger.info('heartbeat', `Heartbeat started: every ${config.interval_minutes} min`);
}

function stopHeartbeat() {
    if (_intervalHandle) {
        clearInterval(_intervalHandle);
        _intervalHandle = null;
        logger.info('heartbeat', 'Heartbeat stopped');
    }
}

// ══════════════════════════════════════════
//  Manual trigger
// ══════════════════════════════════════════

async function triggerHeartbeatNow() {
    logger.info('heartbeat', 'Manual heartbeat triggered');
    return await executeHeartbeat();
}

// ══════════════════════════════════════════
//  AI Tool Definition
// ══════════════════════════════════════════

const HEARTBEAT_TOOL_DEFINITIONS = [{
    type: 'function',
    function: {
        name: 'configure_heartbeat',
        description: 'Configure the AI heartbeat system. Set interval, quiet hours, and checklist items for periodic monitoring.',
        parameters: {
            type: 'object',
            properties: {
                enabled: { type: 'boolean' },
                interval_minutes: { type: 'integer', description: 'Minutes between beats (default 30, min 5, max 240)' },
                quiet_hours_start: { type: 'string', description: 'e.g. "22:00"' },
                quiet_hours_end: { type: 'string', description: 'e.g. "08:00"' },
                add_check: { type: 'object', description: 'Add a check: { name, type, prompt?, command?, trigger_workflow_id?, priority }' },
                remove_check_id: { type: 'string', description: 'Remove a check by ID' },
            },
        },
    },
}];

// ══════════════════════════════════════════
//  Tool Executor
// ══════════════════════════════════════════

async function executeHeartbeatTool(toolName, args) {
    if (toolName !== 'configure_heartbeat') {
        return { success: false, error: `Unknown heartbeat tool: ${toolName}` };
    }

    const results = {};

    // Update config fields if any are provided
    const configUpdates = {};
    if (args.enabled !== undefined) configUpdates.enabled = args.enabled;
    if (args.interval_minutes !== undefined) configUpdates.interval_minutes = args.interval_minutes;
    if (args.quiet_hours_start !== undefined) configUpdates.quiet_hours_start = args.quiet_hours_start;
    if (args.quiet_hours_end !== undefined) configUpdates.quiet_hours_end = args.quiet_hours_end;

    if (Object.keys(configUpdates).length > 0) {
        const updated = updateHeartbeatConfig(configUpdates);
        results.config = updated ? 'updated' : 'failed';
    }

    // Add a check
    if (args.add_check) {
        const check = addHeartbeatCheck(args.add_check);
        results.check_added = check ? { id: check.id, name: check.name } : 'failed';
    }

    // Remove a check
    if (args.remove_check_id) {
        const removed = removeHeartbeatCheck(args.remove_check_id);
        results.check_removed = removed ? args.remove_check_id : 'not_found';
    }

    // Return current config
    const config = getHeartbeatConfig();
    return {
        success: true,
        message: 'Heartbeat configuration updated',
        ...results,
        current_config: config ? {
            enabled: config.enabled,
            interval_minutes: config.interval_minutes,
            quiet_hours: `${config.quiet_hours_start} - ${config.quiet_hours_end}`,
            max_actions_per_beat: config.max_actions_per_beat,
            checks: config.checklist.length,
            last_beat_at: config.last_beat_at ? new Date(config.last_beat_at).toISOString() : null,
        } : null,
    };
}

// ══════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════

function registerHeartbeatIPC(ipcMainArg, getWindow) {
    ipcMainArg.handle('heartbeat-config', () => {
        try {
            const config = getHeartbeatConfig();
            return { success: true, config };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMainArg.handle('heartbeat-update', (_event, updates) => {
        try {
            const config = updateHeartbeatConfig(updates);
            return { success: true, config };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMainArg.handle('heartbeat-add-check', (_event, check) => {
        try {
            const added = addHeartbeatCheck(check);
            return added
                ? { success: true, check: added }
                : { success: false, error: 'Failed to add check' };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMainArg.handle('heartbeat-remove-check', (_event, checkId) => {
        try {
            const removed = removeHeartbeatCheck(checkId);
            return removed
                ? { success: true, removed: checkId }
                : { success: false, error: 'Check not found' };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMainArg.handle('heartbeat-update-check', (_event, checkId, updates) => {
        try {
            const updated = updateHeartbeatCheck(checkId, updates);
            return updated
                ? { success: true, check: updated }
                : { success: false, error: 'Check not found' };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMainArg.handle('heartbeat-trigger', async () => {
        try {
            const result = await triggerHeartbeatNow();
            return { success: true, result };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
}

// ══════════════════════════════════════════
//  Exports
// ══════════════════════════════════════════

module.exports = {
    registerHeartbeatIPC,
    startHeartbeat,
    stopHeartbeat,
    getHeartbeatConfig,
    updateHeartbeatConfig,
    addHeartbeatCheck,
    removeHeartbeatCheck,
    updateHeartbeatCheck,
    triggerHeartbeatNow,
    ensureHeartbeatDefaults,
    getHeartbeatToolDefinitions: () => HEARTBEAT_TOOL_DEFINITIONS,
    executeHeartbeatTool,
    setAICallFunction,
    setWorkflowExecutor,
    setMainWindow,
    setProviderConfig,
};
