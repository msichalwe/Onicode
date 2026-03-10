/**
 * AI Tool System — Cascade-like tool definitions and executor
 *
 * Provides OpenAI function-calling compatible tool definitions
 * and a tool executor that runs them in the main process.
 *
 * Features:
 * - Permission enforcement (allow/ask/deny per tool)
 * - Task persistence via SQLite
 * - Real sub-agent execution
 * - Session tracking
 * - File size limits and path sanitization
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');
const { logger } = require('./logger');

// ══════════════════════════════════════════
//  Main Window Reference (for IPC events)
// ══════════════════════════════════════════

let _mainWindow = null;

function setMainWindow(win) {
    _mainWindow = win;
}

function sendToRenderer(channel, data) {
    if (_mainWindow?.webContents) {
        _mainWindow.webContents.send(channel, data);
    }
}

// ══════════════════════════════════════════
//  Permission Enforcement
// ══════════════════════════════════════════

let _permissions = null; // Set from index.js
let _agentMode = 'build'; // Set from index.js
let _dangerousProtectionCheck = () => true; // Set from index.js
let _autoCommitCheck = () => true; // Set from index.js

function setPermissions(perms) { _permissions = perms; }
function setAgentModeRef(mode) { _agentMode = mode; }
function setDangerousProtectionCheck(fn) { _dangerousProtectionCheck = fn; }
function setAutoCommitCheck(fn) { _autoCommitCheck = fn; }

/**
 * Check if a tool is allowed to run given current permissions and agent mode.
 * Returns { allowed: true } or { allowed: false, reason: string }
 */
function checkToolPermission(toolName) {
    if (!_permissions) return { allowed: true };
    const perm = _permissions[toolName] || 'allow';
    if (perm === 'allow') return { allowed: true };
    if (perm === 'deny') return { allowed: false, reason: `Tool "${toolName}" is denied by current permissions (agent mode: ${_agentMode})` };
    if (perm === 'ask') {
        // For 'ask' tools, send a request to the renderer and wait for approval
        // For now, auto-allow but log a warning — full ask UI comes later
        logger.warn('permissions', `Tool "${toolName}" requires approval (auto-allowing for now)`);
        sendToRenderer('ai-permission-request', { tool: toolName, mode: _agentMode });
        return { allowed: true, warned: true };
    }
    return { allowed: true };
}

// ══════════════════════════════════════════
//  Path Sanitization
// ══════════════════════════════════════════

const BLOCKED_PATHS = [
    path.join(os.homedir(), '.ssh'),
    path.join(os.homedir(), '.gnupg'),
    path.join(os.homedir(), '.aws'),
    '/etc/shadow',
    '/etc/passwd',
];

function isPathSafe(filePath) {
    if (!filePath) return false;
    const resolved = path.resolve(filePath.replace(/^~/, os.homedir()));
    for (const blocked of BLOCKED_PATHS) {
        if (resolved.startsWith(blocked)) return false;
    }
    return true;
}

// ══════════════════════════════════════════
//  Fuzzy Text Matching
// ══════════════════════════════════════════

/**
 * Fuzzy find a text block in content using line-by-line similarity.
 * Uses Levenshtein distance normalized by line length.
 * Returns { start, end, similarity, matchedText } or null.
 */
function fuzzyFindBlock(content, searchBlock) {
    const contentLines = content.split('\n');
    const searchLines = searchBlock.split('\n').map(l => l.trim());
    const searchLen = searchLines.length;

    if (searchLen === 0 || contentLines.length === 0) return null;

    let bestMatch = null;
    let bestScore = 0;

    // Sliding window over content lines
    for (let i = 0; i <= contentLines.length - searchLen; i++) {
        let totalSim = 0;
        for (let j = 0; j < searchLen; j++) {
            const contentLine = contentLines[i + j].trim();
            const searchLine = searchLines[j];
            totalSim += lineSimilarity(contentLine, searchLine);
        }
        const avgSim = totalSim / searchLen;

        if (avgSim > bestScore) {
            bestScore = avgSim;
            // Calculate character positions
            const startCharPos = contentLines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
            const matchedText = contentLines.slice(i, i + searchLen).join('\n');
            const endCharPos = startCharPos + matchedText.length;
            bestMatch = { start: startCharPos, end: endCharPos, similarity: avgSim, matchedText };
        }
    }

    return bestMatch;
}

/**
 * Line similarity using normalized Levenshtein distance (0-1).
 * Optimized: skip full calculation for very different length strings.
 */
function lineSimilarity(a, b) {
    if (a === b) return 1.0;
    if (a.length === 0 || b.length === 0) return 0;

    const maxLen = Math.max(a.length, b.length);
    // Quick reject if lengths are too different
    if (Math.abs(a.length - b.length) / maxLen > 0.4) return 0.3;

    // Levenshtein with early termination
    const dist = levenshtein(a, b, Math.floor(maxLen * 0.3)); // terminate if dist > 30%
    if (dist === -1) return 0.3; // exceeded threshold
    return 1.0 - dist / maxLen;
}

/**
 * Levenshtein distance with early termination.
 * Returns -1 if distance exceeds maxDist (optimization for large strings).
 */
function levenshtein(a, b, maxDist = Infinity) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > maxDist) return -1;

    // Use single-row optimization
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    let curr = new Array(n + 1);

    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        let rowMin = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
            rowMin = Math.min(rowMin, curr[j]);
        }
        if (rowMin > maxDist) return -1; // Early termination
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

// ══════════════════════════════════════════
//  Session Tracking
// ══════════════════════════════════════════

let _currentSessionId = null;
let _currentProjectId = null;
let _currentProjectPath = null;
let _aiStreamingActive = false; // Lock: true when AI is actively executing tool calls

function startSession(projectId, projectPath) {
    // GUARD: Never reset session while AI is actively streaming (prevents task wipe race condition)
    if (_aiStreamingActive && _currentSessionId) {
        // If we're already streaming for this project, just update references
        if (projectPath) {
            _currentProjectId = projectId || _currentProjectId;
            _currentProjectPath = projectPath || _currentProjectPath;
        }
        logger.info('session', `AI streaming active — kept existing session ${_currentSessionId} (no reset)`);
        return _currentSessionId;
    }

    // If same project is still active, keep the session (don't reset tasks)
    if (_currentProjectPath && _currentProjectPath === projectPath && _currentSessionId) {
        logger.info('session', `Continuing session ${_currentSessionId} for project ${projectPath}`);
        return _currentSessionId;
    }

    _currentSessionId = `ses_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    _currentProjectId = projectId || null;
    _currentProjectPath = projectPath || null;

    // Persist to SQLite if available
    try {
        const { sessionStorage } = require('./storage');
        sessionStorage.create(_currentSessionId, _currentProjectId, _currentProjectPath);
    } catch { /* storage not yet initialized */ }

    // If we have a project, load tasks from the latest session for that project
    if (projectPath) {
        try {
            const { taskStorage } = require('./storage');
            const previousTasks = taskStorage.loadLatestProjectSession(projectPath);
            if (previousTasks.length > 0) {
                // Carry forward pending/in-progress tasks, keep done tasks for history
                taskManager.tasks = previousTasks.map(r => ({
                    id: r.id,
                    content: r.content,
                    status: r.status,
                    priority: r.priority,
                    createdAt: r.created_at,
                    completedAt: r.completed_at,
                    milestoneId: r.milestone_id || null,
                }));
                taskManager.nextId = Math.max(...taskManager.tasks.map(t => t.id), 0) + 1;
                taskManager._notifyRenderer();
                logger.info('session', `Loaded ${previousTasks.length} tasks from previous project session`);
            }
        } catch (err) {
            logger.warn('session', `Failed to load project tasks: ${err.message}`);
        }
    }

    logger.info('session', `Started session ${_currentSessionId} for ${projectPath || 'general'}`);
    return _currentSessionId;
}

function getSessionId() {
    if (!_currentSessionId) startSession();
    return _currentSessionId;
}

function updateSessionStats(toolName) {
    try {
        const { sessionStorage } = require('./storage');
        const updates = {};
        if (toolName === 'create_file') updates.filesCreated = 1;
        else if (toolName === 'edit_file' || toolName === 'multi_edit') updates.filesModified = 1;
        else if (toolName === 'run_command') updates.commandsRun = 1;
        // For counts, we need to increment — use raw SQL
        if (Object.keys(updates).length > 0) {
            const { getDB } = require('./storage');
            const db = getDB();
            if (db && !db._fallback) {
                const field = Object.keys(updates)[0];
                db.prepare(`UPDATE sessions SET ${field} = ${field} + 1, tool_calls = tool_calls + 1 WHERE id = ?`).run(_currentSessionId);
            }
        } else {
            const { getDB } = require('./storage');
            const db = getDB();
            if (db && !db._fallback) {
                db.prepare('UPDATE sessions SET tool_calls = tool_calls + 1 WHERE id = ?').run(_currentSessionId);
            }
        }
    } catch { /* storage not available */ }
}

// ══════════════════════════════════════════
//  File Context Tracker
// ══════════════════════════════════════════

class FileContextTracker {
    constructor() {
        this.readFiles = new Map();    // path -> { lines, lastRead, size }
        this.modifiedFiles = new Map(); // path -> { edits: [], linesAdded, linesDeleted }
        this.createdFiles = new Set();
        this.deletedFiles = new Set();
        this.changelog = [];           // Ordered list of { ts, action, path, detail }
    }

    trackRead(filePath, content) {
        const lines = content.split('\n').length;
        this.readFiles.set(filePath, {
            lines,
            lastRead: Date.now(),
            size: content.length,
        });
        logger.debug('file-ctx', `Read: ${filePath} (${lines} lines)`);
    }

    trackEdit(filePath, oldStr, newStr) {
        if (!this.modifiedFiles.has(filePath)) {
            this.modifiedFiles.set(filePath, { edits: [], linesAdded: 0, linesDeleted: 0 });
        }
        const entry = this.modifiedFiles.get(filePath);
        const oldLines = oldStr.split('\n').length;
        const newLines = newStr.split('\n').length;
        const added = Math.max(0, newLines - oldLines);
        const deleted = Math.max(0, oldLines - newLines);
        entry.linesAdded += added;
        entry.linesDeleted += deleted;
        entry.edits.push({
            oldStr: oldStr.slice(0, 100),
            newStr: newStr.slice(0, 100),
            linesAdded: added,
            linesDeleted: deleted,
            timestamp: Date.now(),
        });
        this.changelog.push({
            ts: new Date().toISOString(),
            action: 'edit',
            path: filePath,
            detail: `+${added} -${deleted} lines`,
        });
        logger.fileChange('edit', filePath, { added, deleted });
    }

    trackCreate(filePath, content) {
        this.createdFiles.add(filePath);
        const lines = content ? content.split('\n').length : 0;
        this.changelog.push({
            ts: new Date().toISOString(),
            action: 'create',
            path: filePath,
            detail: `${lines} lines`,
        });
        logger.fileChange('create', filePath, { lines });
    }

    trackDelete(filePath) {
        this.deletedFiles.add(filePath);
        this.changelog.push({
            ts: new Date().toISOString(),
            action: 'delete',
            path: filePath,
            detail: '',
        });
        logger.fileChange('delete', filePath);
    }

    getSummary() {
        let totalAdded = 0;
        let totalDeleted = 0;
        for (const entry of this.modifiedFiles.values()) {
            totalAdded += entry.linesAdded;
            totalDeleted += entry.linesDeleted;
        }
        return {
            filesRead: this.readFiles.size,
            filesModified: this.modifiedFiles.size,
            filesCreated: this.createdFiles.size,
            filesDeleted: this.deletedFiles.size,
            totalLinesAdded: totalAdded,
            totalLinesDeleted: totalDeleted,
            readPaths: [...this.readFiles.keys()],
            modifiedPaths: [...this.modifiedFiles.keys()],
            createdPaths: [...this.createdFiles],
            deletedPaths: [...this.deletedFiles],
        };
    }

    getChangelog() {
        return this.changelog.slice(-100);
    }

    generateChangelogMarkdown() {
        if (this.changelog.length === 0) return '(no changes yet)';
        const lines = [];
        const created = this.changelog.filter(c => c.action === 'create');
        const edited = this.changelog.filter(c => c.action === 'edit');
        const deleted = this.changelog.filter(c => c.action === 'delete');
        if (created.length > 0) {
            lines.push('### Created');
            const uniquePaths = [...new Set(created.map(c => c.path))];
            uniquePaths.forEach(p => lines.push(`- \`${p}\``));
        }
        if (edited.length > 0) {
            lines.push('### Modified');
            const uniquePaths = [...new Set(edited.map(c => c.path))];
            uniquePaths.forEach(p => {
                const entry = this.modifiedFiles.get(p);
                const detail = entry ? ` (+${entry.linesAdded} -${entry.linesDeleted})` : '';
                lines.push(`- \`${p}\`${detail}`);
            });
        }
        if (deleted.length > 0) {
            lines.push('### Deleted');
            const uniquePaths = [...new Set(deleted.map(c => c.path))];
            uniquePaths.forEach(p => lines.push(`- \`${p}\``));
        }
        return lines.join('\n');
    }

    reset() {
        this.readFiles.clear();
        this.modifiedFiles.clear();
        this.createdFiles.clear();
        this.deletedFiles.clear();
        this.changelog = [];
    }
}

const fileContext = new FileContextTracker();

// ══════════════════════════════════════════
//  Background Process Manager (dev servers, watchers)
// ══════════════════════════════════════════

const _backgroundProcesses = new Map(); // sessionId -> { child, command, port, cwd }

function killBackgroundProcesses() {
    for (const [id, entry] of _backgroundProcesses) {
        try {
            if (entry.child && !entry.child.killed) {
                process.kill(-entry.child.pid, 'SIGTERM');
            }
        } catch {
            try { entry.child.kill('SIGTERM'); } catch { /* already dead */ }
        }
        logger.info('bg-process', `Killed background process ${id}: ${entry.command}`);
    }
    _backgroundProcesses.clear();
}

function getBackgroundProcesses() {
    const result = [];
    for (const [id, entry] of _backgroundProcesses) {
        result.push({ id, command: entry.command, port: entry.port, cwd: entry.cwd, pid: entry.child?.pid });
    }
    return result;
}

// ══════════════════════════════════════════
//  Task Manager — AI-managed task list
// ══════════════════════════════════════════

class TaskManager {
    constructor() {
        this.tasks = [];    // { id, content, status, priority, createdAt, completedAt }
        this.nextId = 1;
    }

    // Notify renderer of task changes
    _notifyRenderer() {
        sendToRenderer('ai-tasks-updated', this.getSummary());
    }

    // Persist a task to SQLite
    _persist(task) {
        try {
            const { taskStorage } = require('./storage');
            taskStorage.save(task, getSessionId(), _currentProjectId, _currentProjectPath);
        } catch { /* storage not available */ }
    }

    // Persist a task update to SQLite
    _persistUpdate(id, updates) {
        try {
            const { taskStorage } = require('./storage');
            taskStorage.update(id, updates, getSessionId());
        } catch { /* storage not available */ }
    }

    addTask(content, priority = 'medium', milestoneId = null) {
        const task = {
            id: this.nextId++,
            content,
            status: 'pending',
            priority,
            createdAt: new Date().toISOString(),
            completedAt: null,
            milestoneId,
        };
        this.tasks.push(task);
        this._persist(task);
        logger.info('task-mgr', `Added task #${task.id}: ${content}${milestoneId ? ` (milestone: ${milestoneId})` : ''}`);
        this._notifyRenderer();
        return task;
    }

    updateTask(id, updates) {
        const task = this.tasks.find(t => t.id === id);
        if (!task) return { error: `Task #${id} not found` };
        if (updates.status) {
            task.status = updates.status;
            if (updates.status === 'done') task.completedAt = new Date().toISOString();
        }
        if (updates.content) task.content = updates.content;
        if (updates.priority) task.priority = updates.priority;
        this._persistUpdate(id, { ...updates, completedAt: task.completedAt });
        logger.info('task-mgr', `Updated task #${id}: ${task.status}`);
        this._notifyRenderer();
        return task;
    }

    getTask(id) {
        return this.tasks.find(t => t.id === id) || null;
    }

    listTasks(filter) {
        let result = [...this.tasks];
        if (filter?.status) result = result.filter(t => t.status === filter.status);
        if (filter?.priority) result = result.filter(t => t.priority === filter.priority);
        return result;
    }

    getNextTask() {
        // Priority order: high > medium > low, then by creation order
        const pending = this.tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
        if (pending.length === 0) return null;
        const inProgress = pending.find(t => t.status === 'in_progress');
        if (inProgress) return inProgress;
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        pending.sort((a, b) => (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1));
        return pending[0];
    }

    allDone() {
        return this.tasks.length > 0 && this.tasks.every(t => t.status === 'done' || t.status === 'skipped');
    }

    getSummary() {
        // Exclude archived tasks from the active summary
        const activeTasks = this.tasks.filter(t => t.status !== 'archived');
        const total = activeTasks.length;
        const done = activeTasks.filter(t => t.status === 'done').length;
        const pending = activeTasks.filter(t => t.status === 'pending').length;
        const inProgress = activeTasks.filter(t => t.status === 'in_progress').length;
        return {
            total,
            done,
            pending,
            inProgress,
            allDone: total > 0 && activeTasks.every(t => t.status === 'done' || t.status === 'skipped'),
            nextTask: this.getNextTask(),
            tasks: activeTasks,
        };
    }

    clear() {
        try {
            const { taskStorage } = require('./storage');
            taskStorage.clearSession(getSessionId());
        } catch { /* storage not available */ }
        this.tasks = [];
        this.nextId = 1;
        this._notifyRenderer();
    }

    /** Load tasks for a project from the latest session.
     *  NEVER wipe in-memory tasks when:
     *  1. AI is actively streaming (executing tool calls)
     *  2. The current session already has tasks for this project */
    loadFromProject(projectPath) {
        // GUARD: Never wipe tasks while AI is actively working
        if (_aiStreamingActive) {
            logger.info('task-mgr', `AI streaming active — broadcasting current ${this.tasks.length} tasks instead of reloading`);
            this._notifyRenderer();
            return;
        }

        // If this project is already active with tasks, just re-broadcast (don't reload from DB)
        if (_currentProjectPath === projectPath && this.tasks.length > 0) {
            logger.info('task-mgr', `Project ${projectPath} already active with ${this.tasks.length} tasks, broadcasting`);
            this._notifyRenderer();
            return;
        }

        // If we have tasks but no project path set yet, adopt this project path
        // (covers the case where init_project ran during streaming and set _currentProjectPath)
        if (this.tasks.length > 0 && !_currentProjectPath) {
            _currentProjectPath = projectPath;
            logger.info('task-mgr', `Adopted project path ${projectPath} for ${this.tasks.length} existing tasks`);
            this._notifyRenderer();
            return;
        }

        try {
            const { taskStorage } = require('./storage');
            const rows = taskStorage.loadLatestProjectSession(projectPath);
            if (rows.length > 0) {
                this.tasks = rows.map(r => ({
                    id: r.id,
                    content: r.content,
                    status: r.status,
                    priority: r.priority,
                    createdAt: r.created_at,
                    completedAt: r.completed_at,
                    milestoneId: r.milestone_id || null,
                }));
                this.nextId = Math.max(...this.tasks.map(t => t.id)) + 1;
            }
            // Update project path reference
            _currentProjectPath = projectPath;
            this._notifyRenderer();
            logger.info('task-mgr', `Loaded ${rows.length} tasks for project ${projectPath}`);
        } catch (err) {
            logger.warn('task-mgr', `Failed to load project tasks: ${err.message}`);
        }
    }

    /** Remove a task by ID (for manual task deletion from UI) */
    removeTask(id) {
        const idx = this.tasks.findIndex(t => t.id === id);
        if (idx === -1) return { error: `Task #${id} not found` };
        this.tasks.splice(idx, 1);
        try {
            const { taskStorage } = require('./storage');
            taskStorage.deleteTask(id, getSessionId());
        } catch { /* storage not available */ }
        this._notifyRenderer();
        return { success: true };
    }

    /** Load tasks from a previous session (for recovery) */
    loadFromSession(sessionId) {
        try {
            const { taskStorage } = require('./storage');
            const rows = taskStorage.loadSession(sessionId);
            this.tasks = rows.map(r => ({
                id: r.id,
                content: r.content,
                status: r.status,
                priority: r.priority,
                createdAt: r.created_at,
                completedAt: r.completed_at,
                milestoneId: r.milestone_id || null,
            }));
            this.nextId = this.tasks.length > 0 ? Math.max(...this.tasks.map(t => t.id)) + 1 : 1;
            this._notifyRenderer();
            logger.info('task-mgr', `Loaded ${this.tasks.length} tasks from session ${sessionId}`);
        } catch (err) {
            logger.warn('task-mgr', `Failed to load session: ${err.message}`);
        }
    }
}

const taskManager = new TaskManager();

// Provider config reference for sub-agent calls
let _lastProviderConfig = null;
function setLastProviderConfig(config) { _lastProviderConfig = config; }

// ══════════════════════════════════════════
//  Terminal Session Tracking
// ══════════════════════════════════════════

const terminalSessions = [];
let _termSessionCounter = 0; // Monotonic counter to guarantee unique IDs

function getTerminalSessions() {
    // Cleanup: remove completed sessions older than 100 entries
    while (terminalSessions.length > 100) {
        const oldest = terminalSessions[0];
        if (oldest.status !== 'running') {
            terminalSessions.shift();
        } else {
            break;
        }
    }
    return terminalSessions.slice(-50); // Last 50 sessions
}

// ══════════════════════════════════════════
//  Restore Points
// ══════════════════════════════════════════

const RESTORE_DIR = path.join(
    os.homedir(),
    '.onicode', 'restore-points'
);

class RestorePointManager {
    constructor() {
        if (!fs.existsSync(RESTORE_DIR)) {
            fs.mkdirSync(RESTORE_DIR, { recursive: true });
        }
    }

    create(name, filePaths) {
        const id = `rp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const rpDir = path.join(RESTORE_DIR, id);
        fs.mkdirSync(rpDir, { recursive: true });

        const manifest = {
            id,
            name,
            createdAt: Date.now(),
            files: [],
        };

        for (const fp of filePaths) {
            try {
                if (fs.existsSync(fp)) {
                    const content = fs.readFileSync(fp, 'utf-8');
                    const relName = fp.replace(/[/\\:]/g, '__');
                    fs.writeFileSync(path.join(rpDir, relName), content);
                    manifest.files.push({ original: fp, backup: relName, exists: true });
                } else {
                    manifest.files.push({ original: fp, backup: null, exists: false });
                }
            } catch (err) {
                manifest.files.push({ original: fp, backup: null, error: err.message });
            }
        }

        fs.writeFileSync(path.join(rpDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        return manifest;
    }

    list() {
        try {
            const dirs = fs.readdirSync(RESTORE_DIR).filter(d =>
                fs.statSync(path.join(RESTORE_DIR, d)).isDirectory()
            );
            return dirs.map(d => {
                try {
                    const m = JSON.parse(fs.readFileSync(path.join(RESTORE_DIR, d, 'manifest.json'), 'utf-8'));
                    return { id: m.id, name: m.name, createdAt: m.createdAt, fileCount: m.files.length };
                } catch {
                    return { id: d, name: 'Unknown', createdAt: 0, fileCount: 0 };
                }
            }).sort((a, b) => b.createdAt - a.createdAt);
        } catch {
            return [];
        }
    }

    restore(id) {
        const rpDir = path.join(RESTORE_DIR, id);
        if (!fs.existsSync(rpDir)) return { error: 'Restore point not found' };

        const manifest = JSON.parse(fs.readFileSync(path.join(rpDir, 'manifest.json'), 'utf-8'));
        const results = [];

        for (const file of manifest.files) {
            try {
                if (file.backup && file.exists) {
                    const content = fs.readFileSync(path.join(rpDir, file.backup), 'utf-8');
                    const dir = path.dirname(file.original);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(file.original, content);
                    results.push({ path: file.original, restored: true });
                } else if (!file.exists) {
                    // File didn't exist before, delete it if it exists now
                    if (fs.existsSync(file.original)) {
                        fs.unlinkSync(file.original);
                        results.push({ path: file.original, deleted: true });
                    }
                }
            } catch (err) {
                results.push({ path: file.original, error: err.message });
            }
        }

        return { success: true, restored: results, name: manifest.name };
    }

    delete(id) {
        const rpDir = path.join(RESTORE_DIR, id);
        if (fs.existsSync(rpDir)) {
            fs.rmSync(rpDir, { recursive: true, force: true });
            return { success: true };
        }
        return { error: 'Not found' };
    }
}

const restorePoints = new RestorePointManager();

// ══════════════════════════════════════════
//  Sub-Agent System — Real Execution
// ══════════════════════════════════════════

const activeAgents = new Map();

// Reference to the streamOpenAISingle function from index.js (set at init time)
let _makeAICall = null;
function setAICallFunction(fn) { _makeAICall = fn; }

function createSubAgent(id, task, parentContext) {
    const agent = {
        id,
        task,
        status: 'running',
        createdAt: Date.now(),
        messages: [],
        result: null,
        parentContext,
        toolsUsed: [],
    };
    activeAgents.set(id, agent);
    return agent;
}

/**
 * Actually execute a sub-agent task.
 * The sub-agent gets read-only tools + search + terminal.
 * It runs a mini agentic loop (up to 10 rounds) and returns results.
 */
async function executeSubAgent(agentId, task, contextFiles, providerConfig) {
    const agent = activeAgents.get(agentId);
    if (!agent) return { error: 'Agent not found' };

    // Build context from files
    let fileContext = '';
    if (contextFiles && contextFiles.length > 0) {
        for (const fp of contextFiles) {
            try {
                const expanded = fp.replace(/^~/, os.homedir());
                if (fs.existsSync(expanded)) {
                    const content = fs.readFileSync(expanded, 'utf-8');
                    fileContext += `\n\n--- File: ${fp} ---\n${content.slice(0, 5000)}`;
                }
            } catch { /* skip unreadable */ }
        }
    }

    const subAgentPrompt = `You are a focused sub-agent. Your task: ${task}

You have access to read_file, search_files, list_directory, glob_files, and explore_codebase tools.
Complete the task and return a clear, actionable summary.
${fileContext ? `\n\nContext files provided:\n${fileContext}` : ''}`;

    // Sub-agent only gets read-only tools
    const readOnlyTools = TOOL_DEFINITIONS.filter(t =>
        ['read_file', 'search_files', 'list_directory', 'glob_files', 'explore_codebase', 'get_context_summary'].includes(t.function.name)
    );

    if (!_makeAICall) {
        agent.status = 'error';
        agent.result = { error: 'AI call function not configured. Sub-agents require a provider connection.' };
        return agent.result;
    }

    try {
        const MAX_SUB_ROUNDS = 10;
        const messages = [
            { role: 'system', content: subAgentPrompt },
            { role: 'user', content: task },
        ];

        for (let round = 0; round < MAX_SUB_ROUNDS; round++) {
            const result = await _makeAICall(messages, providerConfig, readOnlyTools);

            if (result.error) {
                agent.status = 'error';
                agent.result = { error: result.error };
                return agent.result;
            }

            // No tool calls — sub-agent is done
            if (!result.hasToolCalls && !result.functionCalls?.length) {
                agent.status = 'done';
                agent.result = {
                    content: result.textContent || result.content || '',
                    toolsUsed: agent.toolsUsed,
                    rounds: round + 1,
                };
                return agent.result;
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

                agent.toolsUsed.push(tc.name);

                // Only allow read-only tools for sub-agents
                if (!['read_file', 'search_files', 'list_directory', 'glob_files', 'explore_codebase', 'get_context_summary'].includes(tc.name)) {
                    messages.push({
                        role: 'tool',
                        tool_call_id: tc.id || tc.call_id,
                        content: JSON.stringify({ error: `Tool "${tc.name}" not available to sub-agents. Use only read-only tools.` }),
                    });
                    continue;
                }

                const toolResult = await executeTool(tc.name, args);
                messages.push({
                    role: 'tool',
                    tool_call_id: tc.id || tc.call_id,
                    content: JSON.stringify(toolResult).slice(0, 8000),
                });
            }
        }

        agent.status = 'done';
        agent.result = { content: 'Sub-agent reached max rounds.', toolsUsed: agent.toolsUsed, rounds: MAX_SUB_ROUNDS };
        return agent.result;
    } catch (err) {
        agent.status = 'error';
        agent.result = { error: err.message };
        return agent.result;
    }
}

function updateAgent(id, update) {
    const agent = activeAgents.get(id);
    if (agent) Object.assign(agent, update);
    return agent;
}

function getAgentStatus(id) {
    return activeAgents.get(id) || null;
}

function listAgents() {
    return [...activeAgents.values()].map(a => ({
        id: a.id,
        task: a.task,
        status: a.status,
        createdAt: a.createdAt,
        role: a.role || null,
    }));
}

// ══════════════════════════════════════════
//  Tool Definitions (OpenAI format)
// ══════════════════════════════════════════

const TOOL_DEFINITIONS = [
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the contents of a file. Can optionally read specific line ranges. Returns the file content with line numbers.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: { type: 'string', description: 'Absolute path to the file to read' },
                    start_line: { type: 'integer', description: 'Optional 1-indexed start line' },
                    end_line: { type: 'integer', description: 'Optional 1-indexed end line' },
                },
                required: ['file_path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'edit_file',
            description: 'Edit a file by replacing an exact string match with new content. The old_string must match exactly (including whitespace). Use this to modify existing files.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: { type: 'string', description: 'Absolute path to the file to edit' },
                    old_string: { type: 'string', description: 'The exact text to find and replace. Must be unique in the file.' },
                    new_string: { type: 'string', description: 'The replacement text' },
                    description: { type: 'string', description: 'Brief description of the change' },
                },
                required: ['file_path', 'old_string', 'new_string'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'create_file',
            description: 'Create a new file with the given content. Parent directories will be created if they do not exist.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: { type: 'string', description: 'Absolute path for the new file' },
                    content: { type: 'string', description: 'Content to write to the file' },
                },
                required: ['file_path', 'content'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'delete_file',
            description: 'Delete a file from the filesystem.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: { type: 'string', description: 'Absolute path to the file to delete' },
                },
                required: ['file_path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_directory',
            description: 'List files and directories in the given path. Returns names, types (file/dir), and sizes.',
            parameters: {
                type: 'object',
                properties: {
                    dir_path: { type: 'string', description: 'Absolute path to the directory' },
                    max_depth: { type: 'integer', description: 'Maximum recursion depth (default 1)' },
                    include_hidden: { type: 'boolean', description: 'Include hidden files/dirs (default false)' },
                },
                required: ['dir_path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'search_files',
            description: 'Search for a pattern across files in a directory using grep. Returns matching file paths and line content.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search pattern (regex supported)' },
                    search_path: { type: 'string', description: 'Directory or file path to search in' },
                    file_pattern: { type: 'string', description: 'Glob pattern to filter files, e.g., "*.ts" or "*.js"' },
                    case_sensitive: { type: 'boolean', description: 'Case-sensitive search (default false)' },
                    max_results: { type: 'integer', description: 'Maximum number of results (default 50)' },
                },
                required: ['query', 'search_path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'run_command',
            description: 'Execute a terminal command and return stdout/stderr. Use for running scripts, installing packages, building, testing, git operations, etc.',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'The command to execute' },
                    cwd: { type: 'string', description: 'Working directory for the command' },
                    timeout: { type: 'integer', description: 'Timeout in milliseconds (default 30000)' },
                },
                required: ['command'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'create_restore_point',
            description: 'Create a snapshot/restore point of the current state of specified files. Use this before making significant changes so the user can roll back.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Descriptive name for the restore point' },
                    file_paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Array of absolute file paths to snapshot',
                    },
                },
                required: ['name', 'file_paths'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'restore_to_point',
            description: 'Restore files back to a previously created restore point.',
            parameters: {
                type: 'object',
                properties: {
                    restore_point_id: { type: 'string', description: 'ID of the restore point to restore' },
                },
                required: ['restore_point_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_restore_points',
            description: 'List all available restore points.',
            parameters: {
                type: 'object',
                properties: {},
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_context_summary',
            description: 'Get a summary of the current working context: files read, files modified, files created, active project info.',
            parameters: {
                type: 'object',
                properties: {},
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'spawn_sub_agent',
            description: 'Spawn a sub-agent to handle a specific sub-task in parallel. The sub-agent gets its own conversation context.',
            parameters: {
                type: 'object',
                properties: {
                    task: { type: 'string', description: 'Description of the sub-task to perform' },
                    context_files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'File paths to include as context for the sub-agent',
                    },
                },
                required: ['task'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_agent_status',
            description: 'Check the status and results of a previously spawned sub-agent.',
            parameters: {
                type: 'object',
                properties: {
                    agent_id: { type: 'string', description: 'ID of the sub-agent to check' },
                },
                required: ['agent_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'multi_edit',
            description: 'Make multiple edits to a single file in one operation. Each edit is a find-and-replace. Edits are applied sequentially.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: { type: 'string', description: 'Absolute path to the file' },
                    edits: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                old_string: { type: 'string', description: 'Text to find' },
                                new_string: { type: 'string', description: 'Replacement text' },
                            },
                            required: ['old_string', 'new_string'],
                        },
                        description: 'Array of edit operations to apply sequentially',
                    },
                    description: { type: 'string', description: 'Brief description of the changes' },
                    dry_run: { type: 'boolean', description: 'If true, preview all edits without writing to disk. Returns what would change.' },
                },
                required: ['file_path', 'edits'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'init_project',
            description: 'MANDATORY first step when creating any new project. Registers the project in Onicode\'s Projects tab, creates .onidocs/ folder with project.md, tasks.md, changelog.md. This activates "project mode" in the IDE. You MUST call this before any other tool call when creating a project.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Project name (e.g. "streaming-website", "todo-app")' },
                    projectPath: { type: 'string', description: 'Full path for the project (e.g. "~/Documents/OniProjects/my-app")' },
                    description: { type: 'string', description: 'Brief project description' },
                    techStack: { type: 'string', description: 'Tech stack (e.g. "Next.js + TypeScript + Tailwind")' },
                },
                required: ['name', 'projectPath'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'memory_read',
            description: 'Read a memory file or list all memory files. Use to recall past decisions, user preferences, project context, or session history.',
            parameters: {
                type: 'object',
                properties: {
                    filename: { type: 'string', description: 'Memory filename to read (e.g. "MEMORY.md", "user.md", "soul.md", "2025-03-09.md"). Omit to list all files.' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'memory_write',
            description: 'Write or update a memory file. Use this to save durable facts, user preferences, project decisions, or session notes to persistent memory.',
            parameters: {
                type: 'object',
                properties: {
                    filename: { type: 'string', description: 'Memory filename (e.g. "MEMORY.md", "user.md", "2025-03-09.md")' },
                    content: { type: 'string', description: 'Full content to write (overwrites existing)' },
                },
                required: ['filename', 'content'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'memory_append',
            description: 'Append content to a memory file. Use for daily logs and incremental notes. Creates the file if it does not exist.',
            parameters: {
                type: 'object',
                properties: {
                    filename: { type: 'string', description: 'Memory filename to append to' },
                    content: { type: 'string', description: 'Content to append' },
                },
                required: ['filename', 'content'],
            },
        },
    },
    // ── Browser / Puppeteer Tools ──
    {
        type: 'function',
        function: {
            name: 'browser_navigate',
            description: 'Launch a browser (if not already running) and navigate to a URL. Use this to test web apps you create. Returns page title, status code, and URL. Console logs are captured automatically.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'URL to navigate to (e.g. http://localhost:3000)' },
                    wait_until: { type: 'string', description: 'Wait strategy: "load", "domcontentloaded", "networkidle0", "networkidle2" (default)' },
                },
                required: ['url'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_screenshot',
            description: 'Take a screenshot of the current browser page or a specific element. Returns the screenshot file path.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Name for the screenshot file' },
                    selector: { type: 'string', description: 'Optional CSS selector to screenshot a specific element' },
                    full_page: { type: 'boolean', description: 'Capture full page (default false)' },
                },
                required: ['name'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_evaluate',
            description: 'Execute JavaScript in the browser page context. Use to check DOM state, read values, or interact with the page.',
            parameters: {
                type: 'object',
                properties: {
                    script: { type: 'string', description: 'JavaScript code to execute in the browser' },
                },
                required: ['script'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_click',
            description: 'Click an element on the page by CSS selector.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of element to click' },
                },
                required: ['selector'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_type',
            description: 'Type text into an input field by CSS selector.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of input element' },
                    text: { type: 'string', description: 'Text to type' },
                },
                required: ['selector', 'text'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_console_logs',
            description: 'Get captured browser console logs (console.log, console.error, page errors, request failures). Use this to debug web apps.',
            parameters: {
                type: 'object',
                properties: {
                    type: { type: 'string', description: 'Filter by type: "log", "error", "warn", "info"' },
                    limit: { type: 'integer', description: 'Max number of entries (default 50)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_close',
            description: 'Close the browser instance and free resources.',
            parameters: { type: 'object', properties: {} },
        },
    },
    // ── Task Management Tools ──
    {
        type: 'function',
        function: {
            name: 'task_add',
            description: 'Add a task to your work plan. Always create a task list BEFORE starting any multi-step work. This is how you track what needs to be done. Optionally assign to a milestone for agile sprint tracking.',
            parameters: {
                type: 'object',
                properties: {
                    content: { type: 'string', description: 'Task description' },
                    priority: { type: 'string', description: '"high", "medium", or "low"' },
                    milestone_id: { type: 'string', description: 'Optional milestone ID to group this task under' },
                },
                required: ['content'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'task_update',
            description: 'Update a task status. Mark tasks "in_progress" when starting, "done" when finished. After completing a task, check if more tasks remain.',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'integer', description: 'Task ID to update' },
                    status: { type: 'string', description: '"pending", "in_progress", "done", "skipped"' },
                    content: { type: 'string', description: 'Updated task description (optional)' },
                },
                required: ['id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'task_list',
            description: 'List all tasks with their status. Use this to check what is done and what remains. Call this after completing each task to decide what to do next.',
            parameters: {
                type: 'object',
                properties: {
                    status: { type: 'string', description: 'Filter by status: "pending", "in_progress", "done"' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'milestone_create',
            description: 'Create a milestone to group tasks into sprints/phases. Tasks can be assigned to milestones via task_add(milestone_id).',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Milestone title (e.g. "Sprint 1", "Phase 1: Setup")' },
                    description: { type: 'string', description: 'What this milestone covers' },
                },
                required: ['title'],
            },
        },
    },
    // ── Web Tools ──
    {
        type: 'function',
        function: {
            name: 'webfetch',
            description: 'Fetch and read the content of a web page. Use this to look up documentation, READMEs, API references, or any web content. Returns the text content of the page.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'URL to fetch (must start with http:// or https://)' },
                    max_length: { type: 'integer', description: 'Maximum characters to return (default 8000)' },
                },
                required: ['url'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'websearch',
            description: 'Search the web for information. Returns a list of relevant results with titles, URLs, and snippets. Use this to find solutions, documentation, or research topics.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query' },
                    max_results: { type: 'integer', description: 'Maximum number of results (default 5)' },
                },
                required: ['query'],
            },
        },
    },
    // ── File Discovery Tools ──
    {
        type: 'function',
        function: {
            name: 'glob_files',
            description: 'Find files by glob pattern. Returns matching file paths sorted by modification time. Respects .gitignore. Use this to discover files by extension or name pattern.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.tsx", "*.json")' },
                    search_path: { type: 'string', description: 'Root directory to search from' },
                    max_results: { type: 'integer', description: 'Maximum results (default 50)' },
                },
                required: ['pattern', 'search_path'],
            },
        },
    },
    // ── Codebase Exploration ──
    {
        type: 'function',
        function: {
            name: 'explore_codebase',
            description: 'Fast, read-only exploration of a codebase. Analyzes project structure, key files, tech stack, and entry points. Use this to quickly understand an unfamiliar codebase before making changes.',
            parameters: {
                type: 'object',
                properties: {
                    project_path: { type: 'string', description: 'Root path of the project to explore' },
                    focus: { type: 'string', description: 'Optional focus area: "structure", "dependencies", "entrypoints", "config", or "all" (default)' },
                },
                required: ['project_path'],
            },
        },
    },
    // ── Logging / Context Tools ──
    {
        type: 'function',
        function: {
            name: 'get_system_logs',
            description: 'Get recent system logs including command outputs, errors, tool calls. Use this to debug issues or check what happened.',
            parameters: {
                type: 'object',
                properties: {
                    level: { type: 'string', description: 'Minimum level: "DEBUG", "INFO", "TOOL", "CMD", "WARN", "ERROR"' },
                    category: { type: 'string', description: 'Filter by category: "tool-call", "tool-result", "cmd-exec", "file-change", "agent-step"' },
                    limit: { type: 'integer', description: 'Max entries (default 50)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_changelog',
            description: 'Get the auto-generated changelog of all file changes in this session (files created, modified, deleted with line counts).',
            parameters: {
                type: 'object',
                properties: {
                    format: { type: 'string', description: '"json" or "markdown" (default markdown)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'index_project',
            description: 'Index a project directory to build a searchable map of all source files, their exports, imports, and key structures. Returns a condensed project context for better understanding. Use before making complex changes to unfamiliar codebases.',
            parameters: {
                type: 'object',
                properties: {
                    project_path: { type: 'string', description: 'Path to the project root' },
                    file_types: { type: 'string', description: 'Comma-separated extensions to index (default: ts,tsx,js,jsx,py,go,rs,java,css,html)' },
                    max_files: { type: 'integer', description: 'Maximum files to index (default 100)' },
                },
                required: ['project_path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_status',
            description: 'Get git status for a repository — branch, changed files, ahead/behind counts. Use before committing to see what changed.',
            parameters: {
                type: 'object',
                properties: {
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_commit',
            description: 'Stage all changes and create a git commit. Use after completing milestones, features, or bug fixes.',
            parameters: {
                type: 'object',
                properties: {
                    message: { type: 'string', description: 'Commit message (use conventional commits: feat:, fix:, refactor:, docs:, chore:)' },
                    cwd: { type: 'string', description: 'Repository path' },
                    files: { type: 'string', description: 'Files to stage (default: -A for all). Can be specific paths separated by spaces.' },
                },
                required: ['message'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_push',
            description: 'Push committed changes to the remote repository. Use after committing to sync with remote.',
            parameters: {
                type: 'object',
                properties: {
                    cwd: { type: 'string', description: 'Repository path' },
                    set_upstream: { type: 'boolean', description: 'Set upstream tracking branch (default true for first push)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_diff',
            description: 'View changes in working directory or staged files. Use to review what changed before committing.',
            parameters: {
                type: 'object',
                properties: {
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                    file_path: { type: 'string', description: 'Specific file to diff (optional, defaults to all files)' },
                    staged: { type: 'boolean', description: 'Show staged changes instead of unstaged (default false)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_log',
            description: 'View recent commit history. Use to understand what has been done recently or find a specific commit.',
            parameters: {
                type: 'object',
                properties: {
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                    count: { type: 'number', description: 'Number of commits to show (default 20, max 50)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_branches',
            description: 'List all local and remote branches. Use to see available branches before switching.',
            parameters: {
                type: 'object',
                properties: {
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_checkout',
            description: 'Switch to a different branch or create a new branch. Use for branching workflows.',
            parameters: {
                type: 'object',
                properties: {
                    branch: { type: 'string', description: 'Branch name to switch to or create' },
                    create: { type: 'boolean', description: 'Create a new branch (default false)' },
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
                required: ['branch'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_stash',
            description: 'Stash or restore uncommitted changes. Use to temporarily save work without committing.',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['push', 'pop', 'list', 'drop'], description: 'Stash action: push (save), pop (restore), list (show all), drop (discard)' },
                    message: { type: 'string', description: 'Stash message (only for push action)' },
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
                required: ['action'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_pull',
            description: 'Pull latest changes from the remote repository. Use to sync with teammates\' changes.',
            parameters: {
                type: 'object',
                properties: {
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
            },
        },
    },
];

// ══════════════════════════════════════════
//  Tool Executor
// ══════════════════════════════════════════

async function executeTool(name, args) {
    const { executeHook, isDangerousCommand } = require('./hooks');

    // ── Permission check ──
    const permCheck = checkToolPermission(name);
    if (!permCheck.allowed) {
        logger.warn('permissions', `Denied: ${name} — ${permCheck.reason}`);
        return { error: permCheck.reason };
    }

    // ── Path safety check for file operations ──
    const fileTools = ['read_file', 'edit_file', 'create_file', 'delete_file', 'multi_edit'];
    if (fileTools.includes(name) && args.file_path) {
        if (!isPathSafe(args.file_path)) {
            return { error: `Access denied: "${args.file_path}" is in a restricted location (.ssh, .gnupg, .aws, etc.)` };
        }
    }

    // ── Resolve project dir for hook context ──
    const hookContext = {
        toolName: name,
        toolInput: args,
        projectDir: args.cwd || args.file_path ? path.dirname(args.file_path || '') : '',
        sessionId: _currentSessionId || '',
    };

    // ── PreToolUse hook — can BLOCK any tool ──
    const preResult = executeHook('PreToolUse', hookContext);
    if (!preResult.allowed) {
        logger.warn('hooks', `PreToolUse blocked ${name}: ${preResult.reason}`);
        return { error: `Hook blocked: ${preResult.reason}`, blocked_by_hook: true };
    }

    // ── PreEdit hook — can BLOCK file edits ──
    const editTools = ['edit_file', 'multi_edit', 'create_file'];
    if (editTools.includes(name) && args.file_path) {
        const preEditResult = executeHook('PreEdit', { ...hookContext, filePath: args.file_path });
        if (!preEditResult.allowed) {
            logger.warn('hooks', `PreEdit blocked ${name} on ${args.file_path}: ${preEditResult.reason}`);
            return { error: `PreEdit hook blocked: ${preEditResult.reason}`, blocked_by_hook: true };
        }
    }

    // ── PreCommand hook — can BLOCK commands ──
    if (name === 'run_command' && args.command) {
        const preCommandResult = executeHook('PreCommand', { ...hookContext, command: args.command });
        if (!preCommandResult.allowed) {
            logger.warn('hooks', `PreCommand blocked: ${args.command} — ${preCommandResult.reason}`);
            return { error: `PreCommand hook blocked: ${preCommandResult.reason}`, blocked_by_hook: true };
        }

        // ── OnDangerousCommand hook — auto-detect dangerous commands ──
        if (_dangerousProtectionCheck()) {
            const dangerousMatch = isDangerousCommand(args.command);
            if (dangerousMatch) {
                const dangerResult = executeHook('OnDangerousCommand', { ...hookContext, command: args.command });
                if (!dangerResult.allowed) {
                    logger.warn('hooks', `Dangerous command blocked: ${args.command}`);
                    return { error: `Dangerous command blocked by hook: ${dangerResult.reason || args.command}`, blocked_by_hook: true };
                }
            }
        }
    }

    // ── PreCommit hook — can BLOCK git commits ──
    if (name === 'git_commit') {
        const preCommitResult = executeHook('PreCommit', { ...hookContext, commitMsg: args.message || '' });
        if (!preCommitResult.allowed) {
            logger.warn('hooks', `PreCommit blocked: ${preCommitResult.reason}`);
            return { error: `PreCommit hook blocked: ${preCommitResult.reason}`, blocked_by_hook: true };
        }
    }

    // ── Track session stats ──
    updateSessionStats(name);

    try {
        const toolResult = await (async () => { switch (name) {
            case 'read_file': {
                const { file_path, start_line, end_line } = args;
                if (!fs.existsSync(file_path)) {
                    return { error: `File not found: ${file_path}` };
                }
                // File size guard — refuse files larger than 10MB
                const stat = fs.statSync(file_path);
                if (stat.size > 10 * 1024 * 1024) {
                    return { error: `File too large (${Math.round(stat.size / 1024 / 1024)}MB). Max 10MB. Use start_line/end_line for large files.` };
                }
                const content = fs.readFileSync(file_path, 'utf-8');
                const lines = content.split('\n');
                const start = (start_line || 1) - 1;
                const end = end_line || lines.length;
                const slice = lines.slice(start, end);
                const numbered = slice.map((l, i) => `${start + i + 1}\t${l}`).join('\n');

                fileContext.trackRead(file_path, content);

                return {
                    file_path,
                    total_lines: lines.length,
                    showing: `${start + 1}-${Math.min(end, lines.length)}`,
                    content: numbered,
                };
            }

            case 'edit_file': {
                const { file_path, old_string, new_string, description } = args;
                if (!fs.existsSync(file_path)) {
                    return { error: `File not found: ${file_path}` };
                }

                // Auto-backup before edit
                const backupDir = path.join(os.homedir(), '.onicode', 'auto-backups');
                if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
                const backupName = path.basename(file_path) + '.' + Date.now() + '.bak';
                try {
                    if (fs.existsSync(file_path)) {
                        fs.copyFileSync(file_path, path.join(backupDir, backupName));
                    }
                } catch (e) {
                    logger.warn('backup', `Auto-backup failed for ${file_path}: ${e.message}`);
                }
                // Cleanup old backups (keep last 100)
                try {
                    const backups = fs.readdirSync(backupDir).filter(f => f.endsWith('.bak')).sort();
                    while (backups.length > 100) {
                        fs.unlinkSync(path.join(backupDir, backups.shift()));
                    }
                } catch {}

                const content = fs.readFileSync(file_path, 'utf-8');
                const occurrences = content.split(old_string).length - 1;
                if (occurrences === 0) {
                    // Try fuzzy match — find the closest matching block in the file
                    const fuzzyResult = fuzzyFindBlock(content, old_string);
                    if (fuzzyResult && fuzzyResult.similarity >= 0.85) {
                        // Found a close match — use it but warn
                        logger.info('edit', `Fuzzy match used for ${file_path} (${Math.round(fuzzyResult.similarity * 100)}% similar)`);
                        const newContent = content.slice(0, fuzzyResult.start) + new_string + content.slice(fuzzyResult.end);
                        fs.writeFileSync(file_path, newContent);

                        // Track the edit
                        fileContext.trackEdit(file_path, old_string, new_string);

                        // Notify renderer
                        const fLinesRemoved = old_string.split('\n').length;
                        const fLinesAdded = new_string.split('\n').length;
                        sendToRenderer('ai-file-changed', { action: 'edited', path: file_path, linesAdded: fLinesAdded, linesRemoved: fLinesRemoved });

                        return {
                            success: true,
                            file_path,
                            fuzzy_match: true,
                            similarity: Math.round(fuzzyResult.similarity * 100),
                            lines_removed: fLinesRemoved,
                            lines_added: fLinesAdded,
                            warning: `Used fuzzy match (${Math.round(fuzzyResult.similarity * 100)}% similar). Original text had minor differences.`
                        };
                    }

                    return { error: `old_string not found in ${path.basename(file_path)}. ${fuzzyResult ? `Best match was ${Math.round(fuzzyResult.similarity * 100)}% similar (needs ≥85%).` : 'No similar text found.'} Ensure it matches the file content exactly, including whitespace and indentation. Use read_file to check the current content.` };
                }
                if (occurrences > 1) {
                    return { error: `old_string found ${occurrences} times in ${file_path}. It must be unique. Include more surrounding context.` };
                }
                const newContent = content.replace(old_string, new_string);
                fs.writeFileSync(file_path, newContent);
                fileContext.trackEdit(file_path, old_string, new_string);

                const linesRemoved = old_string.split('\n').length;
                const linesAdded = new_string.split('\n').length;

                // Notify renderer for live file panel updates
                sendToRenderer('ai-file-changed', {
                    action: 'edit',
                    path: file_path,
                    linesAdded: Math.max(0, linesAdded - linesRemoved),
                    linesRemoved: Math.max(0, linesRemoved - linesAdded),
                });

                return {
                    success: true,
                    file_path,
                    description: description || 'File edited',
                    lines_removed: linesRemoved,
                    lines_added: linesAdded,
                };
            }

            case 'create_file': {
                const { file_path, content } = args;
                const dir = path.dirname(file_path);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                if (fs.existsSync(file_path)) {
                    return { error: `File already exists: ${file_path}. Use edit_file to modify it.` };
                }
                fs.writeFileSync(file_path, content);
                const lineCount = content.split('\n').length;
                fileContext.trackCreate(file_path, content);

                // Notify renderer for live file panel updates
                sendToRenderer('ai-file-changed', {
                    action: 'create',
                    path: file_path,
                    lines: lineCount,
                    dir: dir,
                });

                return { success: true, file_path, lines: lineCount };
            }

            case 'delete_file': {
                const { file_path } = args;
                if (!fs.existsSync(file_path)) {
                    return { error: `File not found: ${file_path}` };
                }
                fs.unlinkSync(file_path);
                fileContext.trackDelete(file_path);
                return { success: true, file_path };
            }

            case 'list_directory': {
                const { dir_path, max_depth = 1, include_hidden = false } = args;
                if (!fs.existsSync(dir_path)) {
                    return { error: `Directory not found: ${dir_path}` };
                }

                function listDir(dirPath, depth, maxD) {
                    if (depth > maxD) return [];
                    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                    const result = [];
                    const skipDirs = ['node_modules', '.git', 'dist', '.next', 'build', 'coverage', '__pycache__', '.cache', '.turbo'];
                    for (const entry of entries) {
                        if (!include_hidden && entry.name.startsWith('.')) continue;
                        if (skipDirs.includes(entry.name)) continue;
                        const fullPath = path.join(dirPath, entry.name);
                        const isDir = entry.isDirectory();
                        const item = {
                            name: entry.name,
                            type: isDir ? 'directory' : 'file',
                            path: fullPath,
                        };
                        if (!isDir) {
                            try {
                                item.size = fs.statSync(fullPath).size;
                            } catch { }
                        }
                        result.push(item);
                        if (isDir && depth < maxD) {
                            item.children = listDir(fullPath, depth + 1, maxD);
                        }
                    }
                    return result.sort((a, b) => {
                        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                        return a.name.localeCompare(b.name);
                    });
                }

                return { dir_path, entries: listDir(dir_path, 1, max_depth) };
            }

            case 'search_files': {
                const { query, search_path, file_pattern, case_sensitive = false, max_results = 20 } = args;
                if (!fs.existsSync(search_path)) {
                    return { error: `Path not found: ${search_path}` };
                }

                // Prefer ripgrep (rg) if available, falls back to grep. Both respect .gitignore.
                // Fetch extra results to detect overflow, add -C 1 for context lines
                let cmd;
                let useRg = false;
                try {
                    execSync('which rg', { encoding: 'utf-8', timeout: 2000 });
                    useRg = true;
                    // Use ripgrep — respects .gitignore by default, -C 1 for 1 line context
                    cmd = `rg ${case_sensitive ? '' : '-i'} -n -C 1 --max-count ${max_results + 1} `;
                    if (file_pattern) cmd += `-g ${JSON.stringify(file_pattern)} `;
                    cmd += `${JSON.stringify(query)} ${JSON.stringify(search_path)}`;
                } catch {
                    // Fallback to grep with -C 1 for context
                    cmd = `grep -r${case_sensitive ? '' : 'i'}n -C 1 --include="${file_pattern || '*'}" `;
                    cmd += `--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.next --exclude-dir=build --exclude-dir=coverage `;
                    cmd += `-m ${max_results + 1} `;
                    cmd += `${JSON.stringify(query)} ${JSON.stringify(search_path)}`;
                }

                try {
                    const output = execSync(cmd, { encoding: 'utf-8', timeout: 10000, maxBuffer: 1024 * 1024 });
                    // With -C 1, results are separated by -- lines; parse match groups
                    const rawLines = output.trim().split('\n').filter(Boolean);
                    const allMatches = [];
                    for (const line of rawLines) {
                        if (line === '--') continue; // context separator
                        const match = line.match(/^(.+?)[:\-](\d+)[:\-](.*)$/);
                        if (match) {
                            allMatches.push({ file: match[1], line: parseInt(match[2]), content: match[3].trim() });
                        }
                    }

                    // Deduplicate by file:line (context lines may overlap)
                    const seen = new Set();
                    const uniqueMatches = allMatches.filter(m => {
                        const key = `${m.file}:${m.line}`;
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    });

                    // Re-rank results by semantic relevance if code index is available
                    let ranked = uniqueMatches;
                    try {
                        const { rankSearchResults } = require('./codeIndex');
                        ranked = rankSearchResults(uniqueMatches, query);
                    } catch {}

                    const limited = ranked.slice(0, max_results);
                    const overflow = ranked.length > max_results ? ranked.length - max_results : 0;
                    const result = { query, matches: limited, total: limited.length };
                    if (overflow > 0) {
                        result.overflow = `... and ${overflow} more matches (use more specific query to narrow)`;
                    }
                    return result;
                } catch (err) {
                    if (err.status === 1) return { query, matches: [], total: 0, message: 'No matches found' };
                    return { error: err.message?.slice(0, 200) };
                }
            }

            case 'run_command': {
                const { command, cwd, timeout = 120000 } = args;
                const execCwd = cwd || os.homedir();

                // ── Detect long-running / dev server commands ──
                const LONG_RUNNING_PATTERNS = [
                    /\bnpm\s+run\s+(dev|start|serve)\b/,
                    /\byarn\s+(dev|start|serve)\b/,
                    /\bpnpm\s+(dev|start|serve)\b/,
                    /\bbun\s+(dev|start|serve|run\s+dev)\b/,
                    /\bnpx\s+(vite|next\s+dev|nuxt\s+dev|remix\s+dev|astro\s+dev)\b/,
                    /\bnode\s+.*server/,
                    /\bpython\s+.*manage\.py\s+runserver/,
                    /\buvicorn\b/,
                    /\bflask\s+run\b/,
                    /\bcargo\s+watch\b/,
                    /\bgo\s+run\b.*server/,
                ];
                const isLongRunning = LONG_RUNNING_PATTERNS.some(p => p.test(command));

                // ── Detect port from command ──
                const portMatch = command.match(/--port\s+(\d+)|:(\d+)|PORT[= ](\d+)|-p\s+(\d+)/);
                const expectedPort = portMatch
                    ? parseInt(portMatch[1] || portMatch[2] || portMatch[3] || portMatch[4], 10)
                    : isLongRunning ? 3000 : null; // Default dev port

                // Auto-open terminal panel in renderer
                sendToRenderer('ai-panel-open', { type: 'terminal' });

                // Track in terminal session history (monotonic counter ensures unique IDs)
                _termSessionCounter++;
                const sessionEntry = {
                    id: `cmd_${Date.now().toString(36)}_${_termSessionCounter}`,
                    command,
                    cwd: execCwd,
                    startedAt: Date.now(),
                    status: 'running',
                    isLongRunning,
                    port: expectedPort,
                };
                terminalSessions.push(sessionEntry);
                sendToRenderer('ai-terminal-session', sessionEntry);

                // Show the command prompt in terminal
                sendToRenderer('ai-terminal-output', {
                    sessionId: sessionEntry.id,
                    type: 'prompt',
                    data: `\x1b[36m❯ ${command}\x1b[0m\n`,
                    cwd: execCwd,
                });

                // ── Port-in-use check before starting dev servers ──
                if (isLongRunning && expectedPort) {
                    try {
                        const netModule = require('net');
                        const portInUse = await new Promise((res) => {
                            const tester = netModule.createServer()
                                .once('error', (err) => res(err.code === 'EADDRINUSE'))
                                .once('listening', () => { tester.close(); res(false); })
                                .listen(expectedPort);
                        });
                        if (portInUse) {
                            // Kill existing process on the port and inform
                            try { execSync(`lsof -ti:${expectedPort} | xargs kill -9 2>/dev/null`, { timeout: 3000 }); } catch { /* nothing on port or kill failed */ }
                            sendToRenderer('ai-terminal-output', {
                                sessionId: sessionEntry.id,
                                type: 'stdout',
                                data: `\x1b[33m⚠ Port ${expectedPort} was in use — freed it.\x1b[0m\n`,
                            });
                            // Small delay to let the port release
                            await new Promise(r => setTimeout(r, 500));
                        }
                    } catch { /* port check failed, proceed anyway */ }
                }

                // ── Long-running command: run in background, wait for port/output readiness ──
                if (isLongRunning) {
                    return new Promise((resolve) => {
                        let stdout = '';
                        let stderr = '';
                        let resolved = false;

                        const child = spawn('sh', ['-c', command], {
                            cwd: execCwd,
                            env: { ...process.env },
                            stdio: ['ignore', 'pipe', 'pipe'],
                            detached: true,
                        });

                        // Store the child PID so we can clean it up later
                        sessionEntry.pid = child.pid;
                        _backgroundProcesses.set(sessionEntry.id, { child, command, port: expectedPort, cwd: execCwd });

                        const readyTimeout = setTimeout(() => {
                            if (!resolved) {
                                resolved = true;
                                sessionEntry.status = 'running';
                                sendToRenderer('ai-terminal-session', sessionEntry);
                                resolve({
                                    command,
                                    cwd: execCwd,
                                    exitCode: null,
                                    success: true,
                                    background: true,
                                    pid: child.pid,
                                    port: expectedPort,
                                    stdout: stdout.slice(0, 4000),
                                    stderr: stderr.slice(0, 2000),
                                    message: `Dev server started in background (PID ${child.pid}). Output is streaming. ${expectedPort ? `Expected on port ${expectedPort}.` : ''}`,
                                    hint: expectedPort ? `Use browser_navigate("http://localhost:${expectedPort}") to test the app.` : undefined,
                                });
                            }
                        }, 15000); // Max 15s wait for readiness signals

                        // Check for readiness signals in output
                        const checkReady = (text) => {
                            if (resolved) return;
                            const readyPatterns = [
                                /ready in/i,
                                /listening on/i,
                                /started server on/i,
                                /local:\s+http/i,
                                /running at/i,
                                /compiled.*successfully/i,
                                /webpack compiled/i,
                                /server running/i,
                                /available on/i,
                                /➜\s+Local:/,
                                /localhost:\d+/,
                            ];
                            if (readyPatterns.some(p => p.test(text))) {
                                clearTimeout(readyTimeout);
                                resolved = true;
                                // Extract the actual URL/port from output
                                const urlMatch = text.match(/https?:\/\/localhost[:\d]*/);
                                const actualUrl = urlMatch ? urlMatch[0] : (expectedPort ? `http://localhost:${expectedPort}` : null);

                                sessionEntry.status = 'running';
                                sessionEntry.url = actualUrl;
                                sendToRenderer('ai-terminal-session', sessionEntry);

                                resolve({
                                    command,
                                    cwd: execCwd,
                                    exitCode: null,
                                    success: true,
                                    background: true,
                                    pid: child.pid,
                                    port: expectedPort,
                                    url: actualUrl,
                                    stdout: stdout.slice(0, 4000),
                                    stderr: stderr.slice(0, 2000),
                                    message: `Dev server is ready! ${actualUrl || ''}`,
                                    hint: actualUrl ? `Use browser_navigate("${actualUrl}") to test the app.` : undefined,
                                });
                            }
                        };

                        // Check for port-in-use error
                        const checkPortError = (text) => {
                            if (resolved) return;
                            if (/EADDRINUSE|address already in use|port.*already|is already being used/i.test(text)) {
                                clearTimeout(readyTimeout);
                                resolved = true;
                                child.kill('SIGTERM');
                                sessionEntry.status = 'error';
                                sessionEntry.finishedAt = Date.now();
                                sessionEntry.duration = sessionEntry.finishedAt - sessionEntry.startedAt;
                                sendToRenderer('ai-terminal-session', sessionEntry);

                                resolve({
                                    command,
                                    cwd: execCwd,
                                    exitCode: 1,
                                    success: false,
                                    stdout: stdout.slice(0, 4000),
                                    stderr: stderr.slice(0, 2000),
                                    error: `Port ${expectedPort || 'unknown'} is already in use.`,
                                    suggestion: `Kill the process using the port first: run_command("lsof -ti:${expectedPort || 3000} | xargs kill -9") then retry.`,
                                });
                            }
                        };

                        child.stdout.on('data', (chunk) => {
                            const text = chunk.toString();
                            stdout += text;
                            sendToRenderer('ai-terminal-output', {
                                sessionId: sessionEntry.id,
                                type: 'stdout',
                                data: text,
                            });
                            checkReady(text);
                        });

                        child.stderr.on('data', (chunk) => {
                            const text = chunk.toString();
                            stderr += text;
                            sendToRenderer('ai-terminal-output', {
                                sessionId: sessionEntry.id,
                                type: 'stderr',
                                data: `\x1b[31m${text}\x1b[0m`,
                            });
                            checkReady(text); // Some tools print to stderr
                            checkPortError(text);
                        });

                        child.on('close', (code) => {
                            clearTimeout(readyTimeout);
                            _backgroundProcesses.delete(sessionEntry.id);
                            sessionEntry.status = code === 0 ? 'done' : 'error';
                            sessionEntry.exitCode = code;
                            sessionEntry.finishedAt = Date.now();
                            sessionEntry.duration = sessionEntry.finishedAt - sessionEntry.startedAt;
                            sendToRenderer('ai-terminal-session', sessionEntry);
                            sendToRenderer('ai-terminal-output', {
                                sessionId: sessionEntry.id,
                                type: 'exit',
                                data: `\x1b[${code === 0 ? '32' : '31'}m${code === 0 ? '✓' : '✗'} exit ${code}\x1b[0m\n\n`,
                            });
                            logger.cmdExec(command, execCwd, code, sessionEntry.duration);
                            if (!resolved) {
                                resolved = true;
                                resolve({
                                    command, cwd: execCwd, exitCode: code ?? 1,
                                    stdout: stdout.slice(0, 8000), stderr: stderr.slice(0, 4000),
                                    success: code === 0,
                                });
                            }
                        });

                        child.on('error', (err) => {
                            clearTimeout(readyTimeout);
                            _backgroundProcesses.delete(sessionEntry.id);
                            if (!resolved) {
                                resolved = true;
                                sessionEntry.status = 'error';
                                sessionEntry.finishedAt = Date.now();
                                sendToRenderer('ai-terminal-session', sessionEntry);
                                resolve({
                                    command, cwd: execCwd, exitCode: 1,
                                    stdout: '', stderr: err.message,
                                    success: false, error_code: err.code,
                                });
                            }
                        });

                        // Unref so the child doesn't block app exit
                        child.unref();
                    });
                }

                // ── Standard command: run and wait for exit ──
                return new Promise((resolve) => {
                    let stdout = '';
                    let stderr = '';

                    const child = spawn('sh', ['-c', command], {
                        cwd: execCwd,
                        env: { ...process.env },
                        stdio: ['ignore', 'pipe', 'pipe'],
                    });

                    // Timeout handling
                    const timer = setTimeout(() => {
                        child.kill('SIGTERM');
                        sendToRenderer('ai-terminal-output', {
                            sessionId: sessionEntry.id,
                            type: 'stderr',
                            data: '\n\x1b[31m[Timed out]\x1b[0m\n',
                        });
                    }, timeout);

                    // Stream stdout to terminal in real-time
                    child.stdout.on('data', (chunk) => {
                        const text = chunk.toString();
                        stdout += text;
                        sendToRenderer('ai-terminal-output', {
                            sessionId: sessionEntry.id,
                            type: 'stdout',
                            data: text,
                        });
                    });

                    // Stream stderr to terminal in real-time
                    child.stderr.on('data', (chunk) => {
                        const text = chunk.toString();
                        stderr += text;
                        sendToRenderer('ai-terminal-output', {
                            sessionId: sessionEntry.id,
                            type: 'stderr',
                            data: `\x1b[31m${text}\x1b[0m`,
                        });
                    });

                    child.on('close', (code) => {
                        clearTimeout(timer);
                        const exitCode = code ?? 1;
                        const success = exitCode === 0;

                        // Show exit status in terminal
                        sendToRenderer('ai-terminal-output', {
                            sessionId: sessionEntry.id,
                            type: 'exit',
                            data: success
                                ? `\x1b[32m✓ exit 0\x1b[0m\n\n`
                                : `\x1b[31m✗ exit ${exitCode}\x1b[0m\n\n`,
                        });

                        // Update session tracking
                        sessionEntry.status = success ? 'done' : 'error';
                        sessionEntry.exitCode = exitCode;
                        sessionEntry.finishedAt = Date.now();
                        sessionEntry.duration = sessionEntry.finishedAt - sessionEntry.startedAt;
                        sendToRenderer('ai-terminal-session', sessionEntry);

                        // Log command execution
                        logger.cmdExec(command, execCwd, exitCode, sessionEntry.duration);

                        resolve({
                            command,
                            cwd: execCwd,
                            exitCode,
                            stdout: stdout.slice(0, 8000),
                            stderr: stderr.slice(0, 4000),
                            success,
                        });
                    });

                    child.on('error', (err) => {
                        clearTimeout(timer);
                        sendToRenderer('ai-terminal-output', {
                            sessionId: sessionEntry.id,
                            type: 'stderr',
                            data: `\x1b[31mError: ${err.message}\x1b[0m\n`,
                        });

                        sessionEntry.status = 'error';
                        sessionEntry.exitCode = 1;
                        sessionEntry.finishedAt = Date.now();
                        sessionEntry.duration = sessionEntry.finishedAt - sessionEntry.startedAt;
                        sendToRenderer('ai-terminal-session', sessionEntry);

                        // Provide diagnostic hints for common errors
                        let hint = '';
                        if (err.code === 'ENOENT') {
                            hint = 'HINT: "sh" not found (spawn ENOENT). Try using the full path to the binary, or ensure the cwd directory exists.';
                        } else if (err.code === 'EACCES') {
                            hint = 'HINT: Permission denied. The command or directory may require elevated permissions.';
                        }

                        resolve({
                            command,
                            cwd: execCwd,
                            exitCode: 1,
                            stdout: stdout.slice(0, 8000),
                            stderr: `${err.message}${hint ? '\n' + hint : ''}`,
                            success: false,
                            error_code: err.code || 'UNKNOWN',
                            recoverable: true,
                            suggestion: hint || 'Check that the command exists and the working directory is valid.',
                        });
                    });
                });
            }

            case 'create_restore_point': {
                const { name, file_paths } = args;
                const rp = restorePoints.create(name, file_paths);
                return {
                    success: true,
                    id: rp.id,
                    name: rp.name,
                    files_backed_up: rp.files.filter(f => f.exists).length,
                    total_files: rp.files.length,
                };
            }

            case 'restore_to_point': {
                const { restore_point_id } = args;
                return restorePoints.restore(restore_point_id);
            }

            case 'list_restore_points': {
                return { restore_points: restorePoints.list() };
            }

            case 'get_context_summary': {
                return fileContext.getSummary();
            }

            case 'spawn_sub_agent': {
                const { task, context_files } = args;
                const agentId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                createSubAgent(agentId, task, { context_files });

                // Notify renderer that a sub-agent is running
                sendToRenderer('ai-agent-step', { round: 0, status: 'sub-agent', agentId, task });

                // Execute the sub-agent synchronously (it has its own mini agentic loop)
                // We need a provider config — get it from the parent context
                const result = await executeSubAgent(agentId, task, context_files, _lastProviderConfig);

                return {
                    agent_id: agentId,
                    task,
                    status: result.error ? 'error' : 'done',
                    result: result.content || result.error,
                    tools_used: result.toolsUsed || [],
                    rounds: result.rounds || 0,
                };
            }

            case 'get_agent_status': {
                const { agent_id } = args;
                const agent = getAgentStatus(agent_id);
                if (!agent) return { error: `Agent ${agent_id} not found` };
                return {
                    id: agent.id,
                    task: agent.task,
                    status: agent.status,
                    createdAt: agent.createdAt,
                    result: agent.result,
                };
            }

            case 'multi_edit': {
                const { file_path, edits, description, dry_run } = args;
                if (!fs.existsSync(file_path)) {
                    return { error: `File not found: ${file_path}` };
                }

                // Auto-backup before edit (skip for dry run)
                if (!dry_run) {
                    const meBackupDir = path.join(os.homedir(), '.onicode', 'auto-backups');
                    if (!fs.existsSync(meBackupDir)) fs.mkdirSync(meBackupDir, { recursive: true });
                    const meBackupName = path.basename(file_path) + '.' + Date.now() + '.bak';
                    try {
                        if (fs.existsSync(file_path)) {
                            fs.copyFileSync(file_path, path.join(meBackupDir, meBackupName));
                        }
                    } catch (e) {
                        logger.warn('backup', `Auto-backup failed for ${file_path}: ${e.message}`);
                    }
                    // Cleanup old backups (keep last 100)
                    try {
                        const meBackups = fs.readdirSync(meBackupDir).filter(f => f.endsWith('.bak')).sort();
                        while (meBackups.length > 100) {
                            fs.unlinkSync(path.join(meBackupDir, meBackups.shift()));
                        }
                    } catch {}
                }

                let content = fs.readFileSync(file_path, 'utf-8');
                const results = [];

                for (let i = 0; i < edits.length; i++) {
                    const { old_string, new_string } = edits[i];
                    const occurrences = content.split(old_string).length - 1;
                    if (occurrences === 0) {
                        // Try fuzzy match fallback
                        const fuzzyResult = fuzzyFindBlock(content, old_string);
                        if (fuzzyResult && fuzzyResult.similarity >= 0.85) {
                            logger.info('multi_edit', `Edit ${i + 1}: fuzzy match used (${Math.round(fuzzyResult.similarity * 100)}% similar)`);
                            content = content.slice(0, fuzzyResult.start) + new_string + content.slice(fuzzyResult.end);
                            results.push({
                                index: i,
                                success: true,
                                fuzzy_match: true,
                                similarity: Math.round(fuzzyResult.similarity * 100),
                            });
                            continue;
                        }
                        // Build error with context about which edits succeeded
                        const appliedSummary = results.length > 0
                            ? ` Edits 1-${results.length} matched successfully (not written to disk).`
                            : '';
                        const fuzzyHint = fuzzyResult
                            ? ` Best match was ${Math.round(fuzzyResult.similarity * 100)}% similar (needs >=85%).`
                            : ' No similar text found.';
                        return { error: `Edit ${i + 1}/${edits.length}: old_string not found.${fuzzyHint}${appliedSummary} No changes were written. Use read_file to check current content.` };
                    }
                    if (occurrences > 1) {
                        const appliedSummary = results.length > 0
                            ? ` Edits 1-${results.length} matched successfully (not written to disk).`
                            : '';
                        return { error: `Edit ${i + 1}/${edits.length}: old_string found ${occurrences} times. Must be unique. Include more context.${appliedSummary} No changes were written.` };
                    }
                    content = content.replace(old_string, new_string);
                    results.push({ index: i, success: true });
                }

                // Dry run — return preview without writing
                if (dry_run) {
                    const fuzzyCount = results.filter(r => r.fuzzy_match).length;
                    return {
                        success: true,
                        dry_run: true,
                        file_path,
                        edits_applied: results.length,
                        fuzzy_matches: fuzzyCount,
                        results,
                        description,
                        message: `Dry run complete: all ${results.length} edits would apply successfully${fuzzyCount > 0 ? ` (${fuzzyCount} via fuzzy match)` : ''}. Run again without dry_run to write changes.`,
                    };
                }

                fs.writeFileSync(file_path, content);
                fileContext.trackEdit(file_path, `[multi_edit: ${edits.length} edits]`, description || '');

                const fuzzyCount = results.filter(r => r.fuzzy_match).length;
                return {
                    success: true,
                    file_path,
                    edits_applied: results.length,
                    fuzzy_matches: fuzzyCount,
                    results,
                    description,
                };
            }

            case 'init_project': {
                const { name: projName, projectPath, description: projDesc, techStack } = args;
                // Expand ~ to home directory — use ~/OniProjects/ by default (avoids macOS TCC permission issues with ~/Documents/)
                let expandedPath = projectPath.replace(/^~/, os.homedir());
                // If the path uses ~/Documents/OniProjects, redirect to ~/OniProjects to avoid macOS sandbox issues
                const docsOniProjects = path.join(os.homedir(), 'Documents', 'OniProjects');
                if (expandedPath.startsWith(docsOniProjects)) {
                    expandedPath = expandedPath.replace(docsOniProjects, path.join(os.homedir(), 'OniProjects'));
                }

                const result = await new Promise((resolve) => {

                    // Ensure project directory exists
                    if (!fs.existsSync(expandedPath)) {
                        fs.mkdirSync(expandedPath, { recursive: true });
                    }

                    // Create onidocs directory (no dot prefix — matches project-get and project-init IPC)
                    const onidocsDir = path.join(expandedPath, 'onidocs');
                    if (!fs.existsSync(onidocsDir)) {
                        fs.mkdirSync(onidocsDir, { recursive: true });
                    }

                    // Create src directory
                    const srcDir = path.join(expandedPath, 'src');
                    if (!fs.existsSync(srcDir)) {
                        fs.mkdirSync(srcDir, { recursive: true });
                    }

                    // Create onidocs template files (same as project-init IPC uses)
                    const docsDefaults = {
                        'architecture.md': `# ${projName} — Architecture\n\n## Overview\nThis document describes the architecture of **${projName}**.\n\n## Tech Stack\n${techStack || '- To be defined'}\n\n## Directory Structure\n\`\`\`\n${projName}/\n├── src/\n├── onidocs/\n│   ├── architecture.md\n│   ├── changelog.md\n│   ├── scope.md\n│   └── tasks.md\n└── README.md\n\`\`\`\n\n## Key Decisions\n- *Document architectural decisions here*\n\n## Data Flow\n- *Describe how data flows through the system*\n`,
                        'scope.md': `# ${projName} — Project Scope\n\n## Description\n${projDesc || 'A new project created with Onicode.'}\n\n## Goals\n- [ ] Define project objectives\n- [ ] Set up development environment\n- [ ] Build core features\n- [ ] Deploy\n\n## Non-Goals\n- *List what is explicitly out of scope*\n`,
                        'changelog.md': `# ${projName} — Changelog\n\nAll notable changes to this project will be documented here.\n\n## [Unreleased]\n\n### Added\n- Initial project setup with Onicode\n- Created onidocs documentation structure\n`,
                        'tasks.md': `# ${projName} — Tasks\n\n## In Progress\n- [ ] Set up project structure\n- [ ] Define architecture\n\n## To Do\n- [ ] Implement core features\n- [ ] Write tests\n- [ ] Set up CI/CD\n- [ ] Documentation\n\n## Done\n- [x] Project initialized with Onicode\n- [x] Created onidocs documentation\n`,
                    };

                    for (const [fname, content] of Object.entries(docsDefaults)) {
                        const fpath = path.join(onidocsDir, fname);
                        if (!fs.existsSync(fpath)) {
                            fs.writeFileSync(fpath, content);
                        }
                    }

                    // Create AGENTS.md (project context for AI — like OpenCode's /init)
                    const agentsMdPath = path.join(expandedPath, 'AGENTS.md');
                    if (!fs.existsSync(agentsMdPath)) {
                        fs.writeFileSync(agentsMdPath, `# AGENTS.md — ${projName}\n\n## Project Overview\n${projDesc || 'A project created with Onicode AI.'}\n\n## Tech Stack\n${techStack || '- To be defined during setup'}\n\n## Directory Structure\nThis file helps the AI coding agent understand the project.\nUpdate this as the project evolves.\n\n## Coding Conventions\n- *Add project-specific patterns here*\n\n## Important Files\n- \`onidocs/architecture.md\` — System architecture\n- \`onidocs/scope.md\` — Project scope and goals\n- \`onidocs/tasks.md\` — Task tracking\n- \`onidocs/changelog.md\` — Version history\n\n## Testing\n- *Describe how to run tests*\n\n## Build & Deploy\n- *Describe build and deploy process*\n\n---\n*Auto-generated by Onicode AI. Commit this file to your repo.*\n`);
                    }

                    // Create README.md in project root
                    const readmePath = path.join(expandedPath, 'README.md');
                    if (!fs.existsSync(readmePath)) {
                        fs.writeFileSync(readmePath, `# ${projName}\n\n${projDesc || 'A project created with Onicode AI.'}\n\n## Getting Started\n\n\`\`\`bash\ncd ${projName}\n# Add setup instructions here\n\`\`\`\n\n## Documentation\n\nSee the \`onidocs/\` folder for detailed project documentation:\n- **architecture.md** — System architecture and tech stack\n- **scope.md** — Project scope and goals\n- **changelog.md** — Version history\n- **tasks.md** — Task tracking\n\n---\n*Created with [Onicode](https://onicode.dev)*\n`);
                    }

                    // Load and save to projects registry
                    const PROJECTS_FILE = path.join(os.homedir(), '.onicode', 'projects.json');
                    let projects = [];
                    try {
                        if (fs.existsSync(PROJECTS_FILE)) {
                            projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
                        }
                    } catch { projects = []; }

                    // Check if already registered
                    const existing = projects.find(p => p.path === expandedPath);
                    if (existing) {
                        resolve({ success: true, project: existing, alreadyRegistered: true });
                        return;
                    }

                    const project = {
                        id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        name: projName,
                        path: expandedPath,
                        description: projDesc || '',
                        techStack: techStack || '',
                        createdAt: Date.now(),
                    };
                    projects.push(project);

                    const onicodeDir = path.join(os.homedir(), '.onicode');
                    if (!fs.existsSync(onicodeDir)) fs.mkdirSync(onicodeDir, { recursive: true });
                    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));

                    resolve({ success: true, project });
                });

                // ── Auto git init + initial commit ──
                if (result.success && !result.alreadyRegistered) {
                    try {
                        const gitDir = path.join(expandedPath, '.git');
                        if (!fs.existsSync(gitDir)) {
                            execSync('git init', { cwd: expandedPath, timeout: 5000 });
                            // Create .gitignore
                            const gitignorePath = path.join(expandedPath, '.gitignore');
                            if (!fs.existsSync(gitignorePath)) {
                                fs.writeFileSync(gitignorePath, `node_modules/\ndist/\nbuild/\n.next/\n.env\n.env.local\n.DS_Store\n*.log\ncoverage/\n.turbo/\n.cache/\n`);
                            }
                            execSync('git add -A && git commit -m "Initial commit — project scaffolded by Onicode"', {
                                cwd: expandedPath, timeout: 10000,
                                env: { ...process.env, GIT_AUTHOR_NAME: 'Onicode', GIT_AUTHOR_EMAIL: 'ai@onicode.dev', GIT_COMMITTER_NAME: 'Onicode', GIT_COMMITTER_EMAIL: 'ai@onicode.dev' },
                            });
                            logger.info('git', `Initialized git repo and made initial commit at ${expandedPath}`);
                        }
                    } catch (err) {
                        logger.warn('git', `Auto git init failed (non-critical): ${err.message}`);
                    }
                }

                // Update session references for this project (safe during streaming — won't wipe tasks)
                _currentProjectId = result.project?.id || _currentProjectId;
                _currentProjectPath = expandedPath;

                // Retroactively update project_path on session + orphaned tasks (fixes persistence across restarts)
                try {
                    const { taskStorage, sessionStorage: sesStore } = require('./storage');
                    const sid = getSessionId();
                    sesStore.updateProjectPath(sid, _currentProjectId, expandedPath);
                    taskStorage.updateSessionProjectPath(sid, expandedPath, _currentProjectId);
                } catch { /* non-fatal */ }

                // Fire project activation event in the renderer (deferred to avoid race with task_add)
                if (result.project) {
                    sendToRenderer('ai-panel-open', { type: 'project' });
                    // Defer the event dispatch so it doesn't trigger loadProjectTasks() while AI is adding tasks
                    if (_mainWindow?.webContents) {
                        setTimeout(() => {
                            _mainWindow?.webContents.executeJavaScript(`
                                window.dispatchEvent(new CustomEvent('onicode-project-activate', {
                                    detail: {
                                        id: ${JSON.stringify(result.project.id)},
                                        name: ${JSON.stringify(result.project.name)},
                                        path: ${JSON.stringify(result.project.path || expandedPath)},
                                        branch: 'main'
                                    }
                                }));
                            `);
                        }, 500); // 500ms delay — enough for task_add calls to complete first
                    }
                }

                return {
                    success: true,
                    project_name: projName,
                    project_path: expandedPath,
                    already_registered: result.alreadyRegistered || false,
                    onidocs_created: ['architecture.md', 'project.md', 'changelog.md', 'README.md'],
                    message: result.alreadyRegistered
                        ? `Project "${projName}" is already registered. Task list cleared for fresh start.`
                        : `Project "${projName}" registered in Onicode. Template onidocs/ created.`,
                    IMPORTANT_NEXT_STEPS: result.alreadyRegistered
                        ? `Project already exists at ${expandedPath}. Continue building — call task_add to plan, then create_file to build.`
                        : `STOP — DO NOT call task_add yet. This is a NEW project. You MUST first ask the user 3-5 discovery questions about their preferences (tech stack choices, features, design style, auth needs, etc.). Format as numbered questions with options in parentheses so the UI renders them as buttons. Example: "1. What framework? (React, Vue, Svelte)". Only after the user answers should you call task_add and start building. The project directory is: ${expandedPath}`,
                };
            }

            case 'memory_read': {
                const { readMemory, listMemories, loadCoreMemories } = require('./memory');
                if (args.filename) {
                    const content = readMemory(args.filename);
                    if (content === null) return { success: false, error: `Memory file "${args.filename}" not found.` };
                    return { success: true, filename: args.filename, content, size: content.length };
                }
                // No filename = list all + load core summary
                const files = listMemories();
                const core = loadCoreMemories();
                return {
                    success: true,
                    files: files.map(f => ({ name: f.name, size: f.size, modified: f.modified })),
                    coreLoaded: { hasSoul: core.hasSoul, hasUser: core.hasUserProfile, hasLongTerm: !!core.longTerm },
                };
            }

            case 'memory_write': {
                const { writeMemory: memWrite } = require('./memory');
                memWrite(args.filename, args.content);
                // Notify renderer that memory changed
                sendToRenderer('memory-changed', { filename: args.filename, action: 'write' });
                return { success: true, filename: args.filename, size: args.content.length, message: `Memory "${args.filename}" saved.` };
            }

            case 'memory_append': {
                const { appendMemory: memAppend } = require('./memory');
                memAppend(args.filename, args.content);
                sendToRenderer('memory-changed', { filename: args.filename, action: 'append' });
                return { success: true, filename: args.filename, appended: args.content.length, message: `Appended to memory "${args.filename}".` };
            }

            // ── Browser / Puppeteer Executors ──

            case 'browser_navigate': {
                const browserMod = require('./browser');
                const result = await browserMod.navigate(args.url, {
                    waitUntil: args.wait_until || 'networkidle2',
                });
                logger.tool('browser', `navigate → ${args.url}`, result);
                return result;
            }

            case 'browser_screenshot': {
                const browserMod = require('./browser');
                const result = await browserMod.screenshot({
                    name: args.name,
                    selector: args.selector,
                    fullPage: args.full_page,
                });
                logger.tool('browser', `screenshot → ${args.name}`, result);
                return result;
            }

            case 'browser_evaluate': {
                const browserMod = require('./browser');
                const result = await browserMod.evaluate(args.script);
                logger.tool('browser', 'evaluate', result);
                return result;
            }

            case 'browser_click': {
                const browserMod = require('./browser');
                const result = await browserMod.click(args.selector);
                logger.tool('browser', `click → ${args.selector}`, result);
                return result;
            }

            case 'browser_type': {
                const browserMod = require('./browser');
                const result = await browserMod.type(args.selector, args.text);
                logger.tool('browser', `type → ${args.selector}`, result);
                return result;
            }

            case 'browser_console_logs': {
                const browserMod = require('./browser');
                const logs = browserMod.getConsoleLogs({
                    type: args.type,
                    limit: args.limit,
                });
                return { success: true, logs, count: logs.length };
            }

            case 'browser_close': {
                const browserMod = require('./browser');
                const result = await browserMod.closeBrowser();
                logger.tool('browser', 'close');
                return result;
            }

            // ── Task Management Executors ──

            case 'task_add': {
                const task = taskManager.addTask(args.content, args.priority || 'medium', args.milestone_id || null);
                const summary = taskManager.getSummary();
                const result = { success: true, task, summary };
                // If we have tasks but none are in-progress or done, remind AI to start executing
                if (summary.total > 0 && summary.done === 0 && summary.inProgress === 0) {
                    result.REMINDER = 'Tasks are just a plan. You MUST now call task_update to mark a task in_progress, then call create_file and run_command to ACTUALLY build the project files. Do not respond with only text.';
                }
                return result;
            }

            case 'task_update': {
                const updates = {};
                if (args.status) updates.status = args.status;
                if (args.content) updates.content = args.content;
                const task = taskManager.updateTask(args.id, updates);
                if (task.error) return task;

                // OnTaskComplete hook — fire when a task is marked done
                if (args.status === 'done' && task.content) {
                    try {
                        executeHook('OnTaskComplete', { ...hookContext, taskContent: task.content });
                    } catch { /* non-fatal */ }
                }

                return { success: true, task, summary: taskManager.getSummary() };
            }

            case 'task_list': {
                const filter = {};
                if (args.status) filter.status = args.status;
                const tasks = taskManager.listTasks(filter);
                return { success: true, ...taskManager.getSummary() };
            }

            case 'milestone_create': {
                const msId = `ms_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
                const milestone = {
                    id: msId,
                    title: args.title,
                    description: args.description || '',
                    status: 'open',
                    createdAt: Date.now(),
                };
                try {
                    const { milestoneStorage } = require('./storage');
                    milestoneStorage.save(milestone, _currentProjectId, _currentProjectPath);
                } catch { /* storage not available */ }
                return { success: true, milestone, message: `Created milestone "${args.title}" (id: ${msId}). Use this ID in task_add(milestone_id) to assign tasks.` };
            }

            // ── Logging / Context Executors ──

            case 'get_system_logs': {
                const { getRecentLogs } = require('./logger');
                const entries = getRecentLogs({
                    level: args.level,
                    category: args.category,
                    limit: args.limit,
                });
                return { success: true, entries, count: entries.length };
            }

            case 'get_changelog': {
                const format = args.format || 'markdown';
                if (format === 'json') {
                    return { success: true, changes: fileContext.getChangelog(), summary: fileContext.getSummary() };
                }
                return { success: true, changelog: fileContext.generateChangelogMarkdown(), summary: fileContext.getSummary() };
            }

            // ── Web Tools Executors ──

            case 'webfetch': {
                const { url, max_length = 8000 } = args;
                if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
                    return { error: 'URL must start with http:// or https://' };
                }
                const mod = url.startsWith('https:') ? require('https') : require('http');
                return new Promise((resolve) => {
                    const req = mod.get(url, { headers: { 'User-Agent': 'Onicode/1.0' }, timeout: 15000 }, (res) => {
                        // Follow redirects
                        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                            const redirectMod = res.headers.location.startsWith('https:') ? require('https') : require('http');
                            redirectMod.get(res.headers.location, { headers: { 'User-Agent': 'Onicode/1.0' }, timeout: 15000 }, (res2) => {
                                let data = '';
                                res2.on('data', (c) => { data += c; if (data.length > max_length * 2) res2.destroy(); });
                                res2.on('end', () => {
                                    const text = data.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                                    resolve({ success: true, url, status: res2.statusCode, content: text.slice(0, max_length), length: text.length, truncated: text.length > max_length });
                                });
                            }).on('error', (e) => resolve({ error: `Redirect fetch failed: ${e.message}` }));
                            return;
                        }
                        let data = '';
                        res.on('data', (c) => { data += c; if (data.length > max_length * 2) res.destroy(); });
                        res.on('end', () => {
                            const text = data.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                            resolve({ success: true, url, status: res.statusCode, content: text.slice(0, max_length), length: text.length, truncated: text.length > max_length });
                        });
                    });
                    req.on('error', (e) => resolve({ error: `Fetch failed: ${e.message}` }));
                    req.on('timeout', () => { req.destroy(); resolve({ error: 'Request timed out (15s)' }); });
                });
            }

            case 'websearch': {
                const { query, max_results = 5 } = args;
                // Use DuckDuckGo HTML lite (no API key needed)
                const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
                const httpsMod = require('https');
                return new Promise((resolve) => {
                    httpsMod.get(searchUrl, { headers: { 'User-Agent': 'Onicode/1.0' }, timeout: 10000 }, (res) => {
                        let data = '';
                        res.on('data', (c) => { data += c; });
                        res.on('end', () => {
                            // Parse DuckDuckGo HTML results
                            const results = [];
                            const resultRegex = /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
                            let match;
                            while ((match = resultRegex.exec(data)) !== null && results.length < max_results) {
                                const href = match[1].replace(/\/\/duckduckgo\.com\/l\/\?uddg=/, '').split('&')[0];
                                const title = match[2].replace(/<[^>]+>/g, '').trim();
                                const snippet = match[3].replace(/<[^>]+>/g, '').trim();
                                try {
                                    results.push({ title, url: decodeURIComponent(href), snippet });
                                } catch {
                                    results.push({ title, url: href, snippet });
                                }
                            }
                            if (results.length === 0) {
                                // Fallback: try simpler parsing
                                const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
                                while ((match = linkRegex.exec(data)) !== null && results.length < max_results) {
                                    results.push({ title: match[2].trim(), url: match[1], snippet: '' });
                                }
                            }
                            resolve({ success: true, query, results, total: results.length });
                        });
                    }).on('error', (e) => resolve({ error: `Search failed: ${e.message}` }));
                });
            }

            // ── File Discovery Executors ──

            case 'glob_files': {
                const { pattern, search_path, max_results = 50 } = args;
                if (!fs.existsSync(search_path)) {
                    return { error: `Path not found: ${search_path}` };
                }
                // Use find command with -name pattern, respecting .gitignore via git ls-files or find
                try {
                    // Try git ls-files first (respects .gitignore)
                    let cmd;
                    const isGitRepo = fs.existsSync(path.join(search_path, '.git'));
                    if (isGitRepo) {
                        cmd = `cd ${JSON.stringify(search_path)} && git ls-files --cached --others --exclude-standard ${JSON.stringify(pattern)} 2>/dev/null | head -${max_results}`;
                    } else {
                        // Fallback: use find with common exclusions
                        const findPattern = pattern.replace(/\*\*/g, '').replace(/^\*\./, '*.'); // Simplify for find
                        cmd = `find ${JSON.stringify(search_path)} -name ${JSON.stringify(findPattern)} -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/.next/*" 2>/dev/null | head -${max_results}`;
                    }
                    const output = execSync(cmd, { encoding: 'utf-8', timeout: 10000, maxBuffer: 512 * 1024 });
                    const files = output.trim().split('\n').filter(Boolean).map(f => {
                        const fullPath = isGitRepo ? path.join(search_path, f) : f;
                        let stat = null;
                        try { stat = fs.statSync(fullPath); } catch { }
                        return { path: fullPath, relative: path.relative(search_path, fullPath), size: stat?.size, modified: stat?.mtime?.toISOString() };
                    });
                    return { success: true, pattern, search_path, files, total: files.length };
                } catch (err) {
                    return { error: `Glob failed: ${err.message?.slice(0, 200)}` };
                }
            }

            // ── Codebase Exploration Executor ──

            case 'explore_codebase': {
                const { project_path, focus = 'all' } = args;
                if (!fs.existsSync(project_path)) {
                    return { error: `Path not found: ${project_path}` };
                }
                const result = { project_path, analysis: {} };

                // Structure: list top-level files and dirs
                if (focus === 'all' || focus === 'structure') {
                    try {
                        const entries = fs.readdirSync(project_path, { withFileTypes: true });
                        result.analysis.structure = entries
                            .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
                            .map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }))
                            .sort((a, b) => a.type === 'dir' ? -1 : 1);
                        // Count files recursively (fast estimate)
                        try {
                            const countOut = execSync(`find ${JSON.stringify(project_path)} -type f -not -path "*/node_modules/*" -not -path "*/.git/*" | wc -l`, { encoding: 'utf-8', timeout: 5000 });
                            result.analysis.total_files = parseInt(countOut.trim()) || 0;
                        } catch { }
                    } catch (e) { result.analysis.structure_error = e.message; }
                }

                // Dependencies: read package.json, requirements.txt, go.mod, Cargo.toml, etc.
                if (focus === 'all' || focus === 'dependencies') {
                    const depFiles = ['package.json', 'requirements.txt', 'go.mod', 'Cargo.toml', 'Gemfile', 'pom.xml', 'build.gradle', 'pyproject.toml', 'composer.json'];
                    result.analysis.dependencies = {};
                    for (const df of depFiles) {
                        const dfPath = path.join(project_path, df);
                        if (fs.existsSync(dfPath)) {
                            try {
                                const content = fs.readFileSync(dfPath, 'utf-8');
                                if (df === 'package.json') {
                                    const pkg = JSON.parse(content);
                                    result.analysis.dependencies.npm = {
                                        name: pkg.name, version: pkg.version,
                                        deps: Object.keys(pkg.dependencies || {}),
                                        devDeps: Object.keys(pkg.devDependencies || {}),
                                        scripts: Object.keys(pkg.scripts || {}),
                                    };
                                } else {
                                    result.analysis.dependencies[df] = content.slice(0, 2000);
                                }
                            } catch { }
                        }
                    }
                }

                // Entrypoints: common entry files
                if (focus === 'all' || focus === 'entrypoints') {
                    const entryFiles = [
                        'src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js', 'src/app.ts', 'src/app.js',
                        'src/App.tsx', 'src/App.jsx', 'app/page.tsx', 'app/layout.tsx', 'pages/index.tsx', 'pages/index.js',
                        'index.ts', 'index.js', 'main.ts', 'main.js', 'server.ts', 'server.js', 'app.py', 'main.py',
                        'main.go', 'src/main.rs', 'src/lib.rs',
                    ];
                    result.analysis.entrypoints = entryFiles
                        .filter(f => fs.existsSync(path.join(project_path, f)))
                        .map(f => {
                            const content = fs.readFileSync(path.join(project_path, f), 'utf-8');
                            return { path: f, lines: content.split('\n').length, preview: content.slice(0, 500) };
                        });
                }

                // Config: tsconfig, .env, tailwind, etc.
                if (focus === 'all' || focus === 'config') {
                    const configFiles = [
                        'tsconfig.json', 'tailwind.config.js', 'tailwind.config.ts', 'next.config.js', 'next.config.ts',
                        'vite.config.ts', 'vite.config.js', '.env', '.env.local', '.env.example',
                        'prisma/schema.prisma', 'drizzle.config.ts', 'eslint.config.js', '.eslintrc.json',
                    ];
                    result.analysis.config = configFiles
                        .filter(f => fs.existsSync(path.join(project_path, f)))
                        .map(f => f);
                }

                // Tech stack detection
                result.analysis.tech_stack = [];
                if (result.analysis.dependencies?.npm) {
                    const deps = [...(result.analysis.dependencies.npm.deps || []), ...(result.analysis.dependencies.npm.devDeps || [])];
                    if (deps.includes('next')) result.analysis.tech_stack.push('Next.js');
                    if (deps.includes('react')) result.analysis.tech_stack.push('React');
                    if (deps.includes('vue')) result.analysis.tech_stack.push('Vue');
                    if (deps.includes('svelte')) result.analysis.tech_stack.push('Svelte');
                    if (deps.includes('express')) result.analysis.tech_stack.push('Express');
                    if (deps.includes('prisma') || deps.includes('@prisma/client')) result.analysis.tech_stack.push('Prisma');
                    if (deps.includes('tailwindcss')) result.analysis.tech_stack.push('Tailwind CSS');
                    if (deps.includes('typescript')) result.analysis.tech_stack.push('TypeScript');
                    if (deps.includes('drizzle-orm')) result.analysis.tech_stack.push('Drizzle');
                }
                if (fs.existsSync(path.join(project_path, 'requirements.txt')) || fs.existsSync(path.join(project_path, 'pyproject.toml'))) result.analysis.tech_stack.push('Python');
                if (fs.existsSync(path.join(project_path, 'go.mod'))) result.analysis.tech_stack.push('Go');
                if (fs.existsSync(path.join(project_path, 'Cargo.toml'))) result.analysis.tech_stack.push('Rust');

                return result;
            }

            // ── Project Indexer ──

            case 'index_project': {
                const { project_path, file_types, max_files = 200 } = args;
                const expandedPath = project_path.replace(/^~/, os.homedir());
                if (!fs.existsSync(expandedPath)) {
                    return { error: `Project path not found: ${project_path}` };
                }

                const extensions = (file_types || 'ts,tsx,js,jsx,py,go,rs,java,css,html,json,md').split(',').map(e => e.trim());
                const skipDirs = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage', '__pycache__', '.cache', '.turbo', '.venv', 'vendor', 'target']);
                const index = [];

                function walkDir(dir, depth = 0) {
                    if (depth > 6 || index.length >= max_files) return;
                    try {
                        const entries = fs.readdirSync(dir, { withFileTypes: true });
                        for (const entry of entries) {
                            if (index.length >= max_files) return;
                            if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
                            const fullPath = path.join(dir, entry.name);
                            if (entry.isDirectory()) {
                                if (!skipDirs.has(entry.name)) walkDir(fullPath, depth + 1);
                                continue;
                            }
                            const ext = path.extname(entry.name).slice(1);
                            if (!extensions.includes(ext)) continue;

                            try {
                                const stat = fs.statSync(fullPath);
                                if (stat.size > 500 * 1024) continue; // skip >500KB files
                                const content = fs.readFileSync(fullPath, 'utf-8');
                                const lines = content.split('\n');
                                const relPath = path.relative(expandedPath, fullPath);

                                // Extract key info based on file type
                                const info = { path: relPath, lines: lines.length, size: stat.size };

                                // Extract exports, imports, and functions/methods
                                const exports = [];
                                const imports = [];
                                const functions = [];
                                for (const line of lines.slice(0, 200)) {
                                    const exportMatch = line.match(/export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/);
                                    if (exportMatch) exports.push(exportMatch[1]);
                                    const importMatch = line.match(/(?:import|from)\s+['"](.+?)['"]/);
                                    if (importMatch) imports.push(importMatch[1]);
                                    const pyDef = line.match(/^(?:def|class)\s+(\w+)/);
                                    if (pyDef) exports.push(pyDef[1]);
                                    // Detect function/method declarations
                                    const funcMatch = line.match(/(?:async\s+)?function\s+(\w+)|(\w+)\s*(?:=\s*)?(?:\(|=>)/);
                                    if (funcMatch) {
                                        const fname = funcMatch[1] || funcMatch[2];
                                        if (fname && !['if', 'else', 'for', 'while', 'switch', 'catch', 'return', 'require', 'import', 'export', 'const', 'let', 'var'].includes(fname)) {
                                            functions.push(fname);
                                        }
                                    }
                                }
                                if (exports.length > 0) info.exports = exports.slice(0, 10);
                                if (imports.length > 0) info.imports = imports.slice(0, 10);
                                if (functions.length > 0) info.functions = [...new Set(functions)].slice(0, 15);

                                // Extract component/function signatures for entry files
                                if (['tsx', 'jsx'].includes(ext)) {
                                    const componentMatch = content.match(/(?:export\s+(?:default\s+)?)?function\s+(\w+)\s*\(([^)]*)\)/);
                                    if (componentMatch) info.component = `${componentMatch[1]}(${componentMatch[2].slice(0, 50)})`;
                                }

                                index.push(info);
                            } catch { /* skip unreadable */ }
                        }
                    } catch { /* skip unreadable dirs */ }
                }

                walkDir(expandedPath);

                // Build summary
                const byExt = {};
                for (const file of index) {
                    const ext = path.extname(file.path).slice(1);
                    byExt[ext] = (byExt[ext] || 0) + 1;
                }

                const totalLines = index.reduce((sum, f) => sum + f.lines, 0);

                return {
                    success: true,
                    project_path,
                    files_indexed: index.length,
                    total_lines: totalLines,
                    by_extension: byExt,
                    index: index.slice(0, max_files),
                };
            }

            // ── Git Tools ──

            case 'git_status': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                try {
                    const branch = execSync('git branch --show-current', { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
                    const statusOut = execSync('git status --porcelain -u', { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
                    const files = statusOut.split('\n').filter(Boolean).map(line => {
                        const status = line.substring(0, 2);
                        const filePath = line.substring(3);
                        let state = 'modified';
                        if (status.includes('?')) state = 'untracked';
                        else if (status.includes('A')) state = 'added';
                        else if (status.includes('D')) state = 'deleted';
                        else if (status.includes('R')) state = 'renamed';
                        const staged = status[0] !== ' ' && status[0] !== '?';
                        return { path: filePath, status: state, staged };
                    });
                    let ahead = 0, behind = 0;
                    try {
                        const ab = execSync('git rev-list --left-right --count HEAD...@{upstream}', { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
                        const parts = ab.split('\t');
                        ahead = parseInt(parts[0]) || 0;
                        behind = parseInt(parts[1]) || 0;
                    } catch { /* no upstream */ }
                    return { success: true, branch, files, ahead, behind, clean: files.length === 0 };
                } catch (err) {
                    return { error: `Git status failed: ${err.message?.slice(0, 200)}` };
                }
            }

            case 'git_commit': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                const message = args.message;
                const filesToStage = args.files || '-A';
                try {
                    // Stage files
                    execSync(`git add ${filesToStage}`, { cwd, encoding: 'utf-8', timeout: 10000 });
                    // Check if there's anything to commit
                    const staged = execSync('git diff --cached --stat', { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
                    if (!staged) {
                        return { success: false, error: 'Nothing to commit (no staged changes)' };
                    }
                    // Commit
                    const result = execSync(`git commit -m ${JSON.stringify(message)}`, { cwd, encoding: 'utf-8', timeout: 15000 }).trim();
                    // Parse commit hash
                    const hashMatch = result.match(/\[[\w/]+ ([a-f0-9]+)\]/);
                    const hash = hashMatch ? hashMatch[1] : null;
                    // Get file stats from the commit output
                    const statsMatch = result.match(/(\d+) files? changed/);
                    const filesChanged = statsMatch ? parseInt(statsMatch[1]) : 0;
                    logger.info('git', `Committed: ${message} (${hash || 'no hash'})`);
                    return {
                        success: true,
                        hash,
                        message,
                        filesChanged,
                        output: result.slice(0, 500),
                    };
                } catch (err) {
                    return { error: `Git commit failed: ${err.stderr?.slice(0, 300) || err.message?.slice(0, 300)}` };
                }
            }

            case 'git_push': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                try {
                    // Check if remote exists
                    const remotes = execSync('git remote', { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
                    if (!remotes) {
                        return { success: false, error: 'No remote configured. Add a remote first: git remote add origin <url>' };
                    }
                    // Check current branch
                    const branch = execSync('git branch --show-current', { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
                    // Push (with upstream if needed)
                    let pushCmd = `git push`;
                    if (args.set_upstream !== false) {
                        // Check if upstream exists
                        try {
                            execSync(`git rev-parse --abbrev-ref ${branch}@{upstream}`, { cwd, encoding: 'utf-8', timeout: 5000 });
                        } catch {
                            pushCmd = `git push -u origin ${branch}`;
                        }
                    }
                    const result = execSync(pushCmd, { cwd, encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
                    logger.info('git', `Pushed branch ${branch} to remote`);
                    return { success: true, branch, output: result.slice(0, 500) };
                } catch (err) {
                    const stderr = err.stderr?.toString() || '';
                    // Git push outputs to stderr even on success
                    if (stderr.includes('->') || stderr.includes('Everything up-to-date')) {
                        logger.info('git', `Pushed (via stderr): ${stderr.slice(0, 100)}`);
                        return { success: true, output: stderr.slice(0, 500) };
                    }
                    return { error: `Git push failed: ${stderr.slice(0, 300) || err.message?.slice(0, 300)}` };
                }
            }

            case 'git_diff': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                const staged = args.staged || false;
                const filePath = args.file_path || null;
                try {
                    let cmd = staged ? 'git diff --cached' : 'git diff';
                    if (filePath) cmd += ` -- ${JSON.stringify(filePath)}`;
                    const diff = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 15000, maxBuffer: 5 * 1024 * 1024 }).trim();
                    const result = { diff: diff || '(no changes)', staged };
                    if (filePath) result.file_path = filePath;
                    return result;
                } catch (err) {
                    return { error: `Git diff failed: ${err.stderr?.slice(0, 300) || err.message?.slice(0, 300)}` };
                }
            }

            case 'git_log': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                const count = Math.min(Math.max(args.count || 20, 1), 50);
                try {
                    const log = execSync(`git log --oneline --format="%h %s (%an, %cr)" -${count}`, { cwd, encoding: 'utf-8', timeout: 15000, maxBuffer: 5 * 1024 * 1024 }).trim();
                    return { log: log || '(no commits)', count };
                } catch (err) {
                    return { error: `Git log failed: ${err.stderr?.slice(0, 300) || err.message?.slice(0, 300)}` };
                }
            }

            case 'git_branches': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                try {
                    const currentBranch = execSync('git branch --show-current', { cwd, encoding: 'utf-8', timeout: 15000, maxBuffer: 5 * 1024 * 1024 }).trim();
                    const output = execSync('git branch -a --format="%(refname:short) %(objectname:short) %(upstream:short)"', { cwd, encoding: 'utf-8', timeout: 15000, maxBuffer: 5 * 1024 * 1024 }).trim();
                    const local = [];
                    const remote = [];
                    output.split('\n').filter(Boolean).forEach(line => {
                        const name = line.split(' ')[0];
                        if (name.startsWith('origin/') || name.startsWith('remotes/')) {
                            remote.push(name);
                        } else {
                            local.push(name);
                        }
                    });
                    return { current: currentBranch, local, remote };
                } catch (err) {
                    return { error: `Git branches failed: ${err.stderr?.slice(0, 300) || err.message?.slice(0, 300)}` };
                }
            }

            case 'git_checkout': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                const branch = args.branch;
                const create = args.create || false;
                if (!branch) return { error: 'Branch name is required' };
                try {
                    const cmd = create ? `git checkout -b ${JSON.stringify(branch)}` : `git checkout ${JSON.stringify(branch)}`;
                    execSync(cmd, { cwd, encoding: 'utf-8', timeout: 15000, maxBuffer: 5 * 1024 * 1024 });
                    logger.info('git', `Checked out branch: ${branch}${create ? ' (created)' : ''}`);
                    return { success: true, branch, created: create };
                } catch (err) {
                    return { error: `Git checkout failed: ${err.stderr?.slice(0, 300) || err.message?.slice(0, 300)}` };
                }
            }

            case 'git_stash': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                const action = args.action;
                const message = args.message || '';
                try {
                    let cmd;
                    if (action === 'push') {
                        cmd = message ? `git stash push -m ${JSON.stringify(message)}` : 'git stash push';
                    } else if (action === 'pop') {
                        cmd = 'git stash pop';
                    } else if (action === 'list') {
                        cmd = 'git stash list';
                    } else if (action === 'drop') {
                        cmd = 'git stash drop';
                    } else {
                        return { error: `Unknown stash action: ${action}. Use push, pop, list, or drop.` };
                    }
                    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 15000, maxBuffer: 5 * 1024 * 1024 }).trim();
                    logger.info('git', `Stash ${action}: ${output.slice(0, 100)}`);
                    return { success: true, action, output: output || `(stash ${action} completed)` };
                } catch (err) {
                    return { error: `Git stash ${action} failed: ${err.stderr?.slice(0, 300) || err.message?.slice(0, 300)}` };
                }
            }

            case 'git_pull': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                try {
                    const output = execSync('git pull', { cwd, encoding: 'utf-8', timeout: 15000, maxBuffer: 5 * 1024 * 1024 }).trim();
                    logger.info('git', `Pull: ${output.slice(0, 100)}`);
                    return { success: true, output: output || 'Already up to date.' };
                } catch (err) {
                    return { error: `Git pull failed: ${err.stderr?.slice(0, 300) || err.message?.slice(0, 300)}` };
                }
            }

            default:
                return { error: `Unknown tool: ${name}` };
        } })();

        // ── Post-tool hooks (only on success) ──
        if (toolResult && !toolResult.error) {
            try {
                // PostToolUse — runs after any successful tool call
                executeHook('PostToolUse', { ...hookContext, toolOutput: toolResult });

                // PostEdit — runs after file edits
                const editToolNames = ['edit_file', 'multi_edit', 'create_file'];
                if (editToolNames.includes(name) && args.file_path) {
                    executeHook('PostEdit', { ...hookContext, filePath: args.file_path, toolOutput: toolResult });
                }

                // PostCommand — runs after shell commands
                if (name === 'run_command') {
                    executeHook('PostCommand', {
                        ...hookContext,
                        command: args.command,
                        exitCode: toolResult.code || toolResult.exit_code || 0,
                        toolOutput: toolResult,
                    });

                    // OnTestFailure — detect test commands with non-zero exit
                    const cmd = (args.command || '').toLowerCase();
                    const exitCode = toolResult.code || toolResult.exit_code || 0;
                    if (exitCode !== 0 && (cmd.includes('test') || cmd.includes('jest') || cmd.includes('vitest') ||
                        cmd.includes('pytest') || cmd.includes('mocha') || cmd.includes('cargo test'))) {
                        executeHook('OnTestFailure', {
                            ...hookContext,
                            command: args.command,
                            exitCode,
                            error: toolResult.stderr || `Test exited with code ${exitCode}`,
                        });
                    }
                }

                // PostCommit — runs after git commit + auto-update changelog
                if (name === 'git_commit') {
                    executeHook('PostCommit', { ...hookContext, commitMsg: args.message || '' });

                    // Auto-append to onidocs/changelog.md if it exists
                    if (_currentProjectPath && args.message) {
                        try {
                            const changelogPath = require('path').join(_currentProjectPath, 'onidocs', 'changelog.md');
                            if (require('fs').existsSync(changelogPath)) {
                                const content = require('fs').readFileSync(changelogPath, 'utf8');
                                const date = new Date().toISOString().split('T')[0];
                                const entry = `- ${args.message} (${date})`;
                                // Insert after the ## [Unreleased] header if it exists
                                const marker = '### Added';
                                if (content.includes(marker)) {
                                    const updated = content.replace(marker, `${marker}\n${entry}`);
                                    require('fs').writeFileSync(changelogPath, updated);
                                    logger.info('changelog', `Auto-appended commit to changelog: ${args.message}`);
                                }
                            }
                        } catch { /* non-fatal */ }
                    }
                }
            } catch { /* post-hooks are non-fatal */ }
        }

        return toolResult;
    } catch (err) {
        logger.error('tool-exec', `${name} failed: ${err.message}`);

        // ── ToolError hook ──
        try {
            executeHook('ToolError', { ...hookContext, error: err.message });
        } catch { /* hook errors are non-fatal */ }

        // ── OnTestFailure hook — detect test commands that failed ──
        if (name === 'run_command' && args.command) {
            const cmd = args.command.toLowerCase();
            if (cmd.includes('test') || cmd.includes('jest') || cmd.includes('vitest') ||
                cmd.includes('pytest') || cmd.includes('mocha') || cmd.includes('cargo test')) {
                try {
                    executeHook('OnTestFailure', { ...hookContext, command: args.command, error: err.message });
                } catch { /* non-fatal */ }
            }
        }

        return { error: `Tool execution error: ${err.message}` };
    }
}

// ══════════════════════════════════════════
//  Exports
// ══════════════════════════════════════════

module.exports = {
    TOOL_DEFINITIONS,
    executeTool,
    fileContext,
    restorePoints,
    activeAgents,
    createSubAgent,
    updateAgent,
    getAgentStatus,
    listAgents,
    setMainWindow: setMainWindow,
    getTerminalSessions,
    taskManager,
    // New exports for enhanced agentic loop
    setPermissions,
    setAgentModeRef,
    setDangerousProtectionCheck,
    setAutoCommitCheck,
    setAICallFunction,
    setLastProviderConfig,
    startSession,
    getSessionId,
    checkToolPermission,
    // AI streaming lock — prevents renderer from wiping tasks mid-stream
    setAIStreamingActive: (active) => { _aiStreamingActive = active; },
    // Background process management
    killBackgroundProcesses,
    getBackgroundProcesses,
};
