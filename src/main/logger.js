/**
 * System Logger — Centralized logging for all AI actions, command outputs, errors.
 * Persists logs to ~/.onicode/logs/ with daily rotation.
 * Provides structured log entries with levels, timestamps, and categories.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOGS_DIR = path.join(os.homedir(), '.onicode', 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// ══════════════════════════════════════════
//  In-memory ring buffer (last N entries)
// ══════════════════════════════════════════

const MAX_BUFFER = 500;
const logBuffer = [];

// ══════════════════════════════════════════
//  Log levels
// ══════════════════════════════════════════

const LEVELS = {
    DEBUG: 0,
    INFO: 1,
    TOOL: 2,
    CMD: 3,
    WARN: 4,
    ERROR: 5,
};

let currentLevel = LEVELS.DEBUG;

function setLogLevel(level) {
    if (LEVELS[level] !== undefined) currentLevel = LEVELS[level];
}

// ══════════════════════════════════════════
//  Core log function
// ══════════════════════════════════════════

function log(level, category, message, data = null) {
    if (LEVELS[level] === undefined || LEVELS[level] < currentLevel) return;

    const entry = {
        ts: new Date().toISOString(),
        level,
        category,
        message,
        data: data ? (typeof data === 'string' ? data : JSON.stringify(data)) : null,
    };

    // In-memory buffer
    logBuffer.push(entry);
    if (logBuffer.length > MAX_BUFFER) logBuffer.shift();

    // Console output
    const prefix = `[${entry.ts.slice(11, 19)}] [${level}] [${category}]`;
    if (level === 'ERROR') {
        console.error(`${prefix} ${message}`, data || '');
    } else if (level === 'WARN') {
        console.warn(`${prefix} ${message}`, data || '');
    } else {
        console.log(`${prefix} ${message}`, data ? JSON.stringify(data).slice(0, 200) : '');
    }

    // Persist to daily log file (async, fire-and-forget)
    const today = new Date().toISOString().slice(0, 10);
    const logFile = path.join(LOGS_DIR, `${today}.jsonl`);
    const line = JSON.stringify(entry) + '\n';
    fs.appendFile(logFile, line, () => {});
}

// ══════════════════════════════════════════
//  Convenience methods
// ══════════════════════════════════════════

const logger = {
    debug: (cat, msg, data) => log('DEBUG', cat, msg, data),
    info: (cat, msg, data) => log('INFO', cat, msg, data),
    tool: (cat, msg, data) => log('TOOL', cat, msg, data),
    cmd: (cat, msg, data) => log('CMD', cat, msg, data),
    warn: (cat, msg, data) => log('WARN', cat, msg, data),
    error: (cat, msg, data) => log('ERROR', cat, msg, data),

    // Log a tool call (name + args)
    toolCall(name, args, round) {
        log('TOOL', 'tool-call', `${name}`, { args: summarizeArgs(args), round });
    },

    // Log a tool result (name + success/error)
    toolResult(name, result, round) {
        const success = !result?.error;
        const summary = success
            ? (result?.message || 'ok')
            : result.error;
        log('TOOL', 'tool-result', `${name} → ${success ? '✓' : '✗'} ${summary.slice(0, 200)}`, { round });
    },

    // Log a command execution
    cmdExec(command, cwd, exitCode, duration) {
        const level = exitCode === 0 ? 'CMD' : 'ERROR';
        log(level, 'cmd-exec', `$ ${command}`, { cwd, exitCode, duration });
    },

    // Log an agent step
    agentStep(round, status, detail) {
        log('INFO', 'agent-step', `Round ${round}: ${status}`, detail);
    },

    // Log a file change
    fileChange(action, filePath, detail) {
        log('INFO', 'file-change', `${action}: ${filePath}`, detail);
    },

    setLevel: setLogLevel,
};

// ══════════════════════════════════════════
//  Query / retrieval
// ══════════════════════════════════════════

/**
 * Get recent log entries from in-memory buffer.
 * @param {object} opts - { level, category, limit, since }
 */
function getRecentLogs(opts = {}) {
    let entries = [...logBuffer];

    if (opts.level) {
        const minLevel = LEVELS[opts.level] || 0;
        entries = entries.filter(e => (LEVELS[e.level] || 0) >= minLevel);
    }
    if (opts.category) {
        entries = entries.filter(e => e.category === opts.category);
    }
    if (opts.since) {
        entries = entries.filter(e => e.ts >= opts.since);
    }

    const limit = opts.limit || 50;
    return entries.slice(-limit);
}

/**
 * Read a full day's log file.
 */
function readDayLog(date) {
    const logFile = path.join(LOGS_DIR, `${date}.jsonl`);
    if (!fs.existsSync(logFile)) return [];
    const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
    return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/**
 * List available log files.
 */
function listLogFiles() {
    if (!fs.existsSync(LOGS_DIR)) return [];
    return fs.readdirSync(LOGS_DIR)
        .filter(f => f.endsWith('.jsonl'))
        .sort()
        .reverse()
        .map(f => ({
            name: f,
            date: f.replace('.jsonl', ''),
            size: fs.statSync(path.join(LOGS_DIR, f)).size,
        }));
}

// ══════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════

function summarizeArgs(args) {
    if (!args) return {};
    const summary = {};
    for (const [k, v] of Object.entries(args)) {
        if (typeof v === 'string' && v.length > 100) {
            summary[k] = v.slice(0, 100) + `... (${v.length} chars)`;
        } else {
            summary[k] = v;
        }
    }
    return summary;
}

// ══════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════

function registerLoggerIPC() {
    const { ipcMain } = require('electron');

    ipcMain.handle('logger-get-recent', (_event, opts) => {
        return { success: true, entries: getRecentLogs(opts || {}) };
    });

    ipcMain.handle('logger-read-day', (_event, date) => {
        return { success: true, entries: readDayLog(date) };
    });

    ipcMain.handle('logger-list-files', () => {
        return { success: true, files: listLogFiles() };
    });
}

module.exports = {
    logger,
    getRecentLogs,
    readDayLog,
    listLogFiles,
    registerLoggerIPC,
};
