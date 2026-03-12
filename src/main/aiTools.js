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

const _pendingApprovals = new Map(); // approvalId -> { resolve, timeout }

/**
 * Check if a tool is allowed to run given current permissions and agent mode.
 * Returns { allowed: true } or { allowed: false, reason: string }
 * For 'ask' permissions, returns a Promise that resolves when user approves/denies.
 */
function checkToolPermission(toolName, toolArgs) {
    if (!_permissions) return { allowed: true };
    const perm = _permissions[toolName] || 'allow';
    if (perm === 'allow') return { allowed: true };
    if (perm === 'deny') return { allowed: false, reason: `Tool "${toolName}" is denied by current permissions (agent mode: ${_agentMode})` };
    if (perm === 'ask') {
        const approvalId = `approve_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        logger.info('permissions', `Tool "${toolName}" requires user approval (${approvalId})`);

        // Send approval request to renderer with tool details
        sendToRenderer('ai-permission-request', {
            approvalId,
            tool: toolName,
            args: toolArgs || {},
            mode: _agentMode,
        });

        // Return a promise that resolves when user approves/denies
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                _pendingApprovals.delete(approvalId);
                resolve({ allowed: true, warned: true }); // Auto-allow after 60s timeout
                logger.warn('permissions', `Approval timeout for ${toolName} — auto-allowing`);
            }, 60000);

            _pendingApprovals.set(approvalId, { resolve, timeout });
        });
    }
    return { allowed: true };
}

/**
 * Resolve a pending permission approval when the user responds.
 * Called from index.js when renderer sends 'ai-permission-response'.
 */
function resolvePermissionApproval(approvalId, approved) {
    const pending = _pendingApprovals.get(approvalId);
    if (pending) {
        clearTimeout(pending.timeout);
        _pendingApprovals.delete(approvalId);
        if (approved) {
            pending.resolve({ allowed: true, approved: true });
            logger.info('permissions', `User approved ${approvalId}`);
        } else {
            pending.resolve({ allowed: false, reason: 'User denied this action' });
            logger.info('permissions', `User denied ${approvalId}`);
        }
    }
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
let _activePlanId = null;
let _aiStreamingActive = false; // Lock: true when AI is actively executing tool calls

// ── Cascade-level state ──
const _pendingQuestions = new Map(); // questionId -> { resolve, timeout }
let _thoughtChain = null; // Array of sequential thinking steps (reset per session)
const _documentCache = new Map(); // documentId -> { url, content, chunks[], fetchedAt }

/**
 * Quick lint/syntax check after file edits.
 * Returns array of diagnostic strings, or empty array if clean.
 * Non-blocking — returns [] on any error rather than crashing the edit flow.
 */
function quickLintCheck(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const diagnostics = [];

    try {
        if (['.js', '.mjs', '.cjs'].includes(ext)) {
            // Node.js syntax check
            const result = require('child_process').execSync(
                `node --check "${filePath}" 2>&1`,
                { encoding: 'utf-8', timeout: 5000 }
            );
        } else if (['.ts', '.tsx', '.jsx'].includes(ext)) {
            // TypeScript syntax check — look for tsconfig in project
            const projectDir = _currentProjectPath || path.dirname(filePath);
            const tsconfig = path.join(projectDir, 'tsconfig.json');
            if (fs.existsSync(tsconfig)) {
                try {
                    const result = require('child_process').execSync(
                        `npx tsc --noEmit --pretty false "${filePath}" 2>&1`,
                        { encoding: 'utf-8', timeout: 15000, cwd: projectDir }
                    );
                } catch (tsErr) {
                    // tsc exits non-zero on errors
                    const output = tsErr.stdout || tsErr.stderr || '';
                    const lines = output.split('\n').filter(l => l.includes('error TS'));
                    for (const line of lines.slice(0, 5)) {
                        diagnostics.push(line.trim());
                    }
                }
            }
        } else if (ext === '.json') {
            // JSON syntax check
            JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } else if (ext === '.py') {
            try {
                require('child_process').execSync(
                    `python3 -m py_compile "${filePath}" 2>&1`,
                    { encoding: 'utf-8', timeout: 5000 }
                );
            } catch (pyErr) {
                const output = pyErr.stdout || pyErr.stderr || '';
                if (output.trim()) diagnostics.push(output.trim().split('\n').slice(-2).join(' '));
            }
        }
    } catch (err) {
        // Syntax check itself failed (e.g., node --check found errors)
        const output = err.stdout || err.stderr || err.message || '';
        const lines = output.split('\n').filter(l => l.trim());
        for (const line of lines.slice(0, 3)) {
            diagnostics.push(line.trim());
        }
    }

    return diagnostics;
}

/**
 * Strip HTML to readable text (basic implementation for URL content reading).
 */
function htmlToText(html) {
    return html
        // Remove script/style blocks
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        // Convert common block elements to newlines
        .replace(/<\/?(div|p|br|h[1-6]|li|tr|td|th|blockquote|pre|hr|section|article|header|main)[^>]*>/gi, '\n')
        // Remove remaining tags
        .replace(/<[^>]+>/g, '')
        // Decode common entities
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
        // Collapse whitespace
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*\n+/g, '\n\n')
        .trim();
}

/**
 * Chunk text content into pages of ~4000 chars each.
 */
function chunkContent(content, chunkSize = 4000) {
    const chunks = [];
    for (let i = 0; i < content.length; i += chunkSize) {
        chunks.push(content.slice(i, i + chunkSize));
    }
    return chunks;
}

/**
 * Simple glob pattern matcher (supports * and ? wildcards)
 */
function matchGlob(name, pattern) {
    const regex = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`, 'i').test(name);
}

/**
 * Search messages in a conversation for relevant chunks
 */
function searchMessages(messages, query, limit, convId, convTitle) {
    const results = [];
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
        const contentLower = content.toLowerCase();

        // Score based on query term matches
        let score = 0;
        for (const term of queryTerms) {
            const occurrences = (contentLower.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
            score += occurrences;
        }

        if (score > 0) {
            // Extract a relevant snippet (max 500 chars around the first match)
            const firstMatch = contentLower.indexOf(queryTerms[0] || queryLower);
            const snippetStart = Math.max(0, firstMatch - 100);
            const snippet = content.slice(snippetStart, snippetStart + 500);

            results.push({
                conversation_id: convId,
                conversation_title: convTitle || '(untitled)',
                message_index: i,
                role: msg.role,
                score: Math.round(score * 100) / 100,
                snippet: snippet + (content.length > snippetStart + 500 ? '...' : ''),
                timestamp: msg.timestamp || null,
            });
        }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
}

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

    // If same project is still active (or both are general/null), keep the session (don't reset tasks)
    if (_currentSessionId && _currentProjectPath === projectPath) {
        logger.info('session', `Continuing session ${_currentSessionId} for ${projectPath || 'general'}`);
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
        this._accessCount = new Map(); // path -> count (for hot files ranking)
    }

    trackRead(filePath, content) {
        const lines = content.split('\n').length;
        this.readFiles.set(filePath, {
            lines,
            lastRead: Date.now(),
            size: content.length,
        });
        this._accessCount.set(filePath, (this._accessCount.get(filePath) || 0) + 1);
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

    /**
     * Get the most frequently accessed files this session, scored by access count + recency.
     */
    getHotFiles(limit = 10) {
        const now = Date.now();
        const scored = [];
        for (const [filePath, count] of this._accessCount) {
            const readInfo = this.readFiles.get(filePath);
            const recencyBonus = readInfo ? Math.max(0, 1 - ((now - readInfo.lastRead) / 600000)) : 0; // decay over 10 min
            const score = (count * 2) + recencyBonus;
            scored.push({ filePath, score, count, lastRead: readInfo?.lastRead || 0 });
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit);
    }

    reset() {
        this.readFiles.clear();
        this.modifiedFiles.clear();
        this.createdFiles.clear();
        this.deletedFiles.clear();
        this.changelog = [];
        this._accessCount.clear();
    }
}

const fileContext = new FileContextTracker();

// ══════════════════════════════════════════
//  Background Process Manager (dev servers, watchers)
// ══════════════════════════════════════════

const _backgroundProcesses = new Map(); // sessionId -> { child, command, port, cwd, outputBuffer, startedAt }
const MAX_OUTPUT_BUFFER = 200; // Keep last 200 lines per process

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
    const now = Date.now();
    for (const [id, entry] of _backgroundProcesses) {
        const running = entry.child && !entry.child.killed && !entry.child.exitCode;
        result.push({
            id,
            command: entry.command,
            port: entry.port,
            cwd: entry.cwd,
            pid: entry.child?.pid,
            running: !!running,
            uptime: entry.startedAt ? Math.round((now - entry.startedAt) / 1000) : 0,
            url: entry.url || null,
            lastLine: entry.outputBuffer?.length > 0 ? entry.outputBuffer[entry.outputBuffer.length - 1] : null,
        });
    }
    return result;
}

/**
 * Get recent output from a background process.
 * @param {string} sessionId - The terminal session ID
 * @param {number} lines - Number of lines to return (default 20)
 * @returns {{ found, running, pid, uptime, output, exitCode, port, url }}
 */
function getTerminalOutput(sessionId, lines = 20) {
    // Check background processes first
    const entry = _backgroundProcesses.get(sessionId);
    if (entry) {
        const running = entry.child && !entry.child.killed;
        const buf = entry.outputBuffer || [];
        return {
            found: true,
            session_id: sessionId,
            command: entry.command,
            running: !!running,
            pid: entry.child?.pid,
            port: entry.port,
            url: entry.url || null,
            uptime: entry.startedAt ? Math.round((Date.now() - entry.startedAt) / 1000) : 0,
            output: buf.slice(-lines).join('\n'),
            line_count: buf.length,
            exitCode: entry.child?.exitCode ?? null,
        };
    }
    // Check terminal sessions (completed commands)
    const session = terminalSessions.find(s => s.id === sessionId);
    if (session) {
        return {
            found: true,
            session_id: sessionId,
            command: session.command,
            running: session.status === 'running',
            status: session.status,
            exitCode: session.exitCode ?? null,
            duration: session.duration,
            port: session.port,
            url: session.url || null,
        };
    }
    return { found: false, error: `No terminal session found with ID: ${sessionId}` };
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
        // Debounce: skip if called again within 200ms (two listeners fire on same event)
        const now = Date.now();
        if (this._lastLoadTime && now - this._lastLoadTime < 200) return;
        this._lastLoadTime = now;

        // GUARD: Never wipe tasks while AI is actively working
        if (_aiStreamingActive) {
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
//  Sub-Agent System — Real Execution
// ══════════════════════════════════════════

const activeAgents = new Map();

// Reference to the streamOpenAISingle function from index.js (set at init time)
let _makeAICall = null;
function setAICallFunction(fn) { _makeAICall = fn; }

// Plan mode state
let _planModeActive = false;
let _currentPlanId = null;
let _currentPlanPath = null;

// Worktree state
let _worktreeActive = false;
let _worktreePath = null;
let _worktreeOriginalCwd = null;

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
        toolSet: parentContext?.tool_set || 'read-only',
        role: parentContext?.role || null,
    };
    activeAgents.set(id, agent);
    return agent;
}

/**
 * Actually execute a sub-agent task.
 * The sub-agent gets read-only tools + search + terminal.
 * It runs a mini agentic loop (up to 10 rounds) and returns results.
 */
// Tool sets for sub-agents — each set gives access to specific tools
const SUB_AGENT_TOOL_SETS = {
    'read-only': ['read_file', 'search_files', 'list_directory', 'glob_files', 'explore_codebase', 'get_context_summary'],
    'git': ['read_file', 'search_files', 'list_directory', 'glob_files', 'git_status', 'git_diff', 'git_log', 'git_branches', 'git_show', 'git_remotes', 'gh_cli'],
    'browser': ['browser_navigate', 'browser_screenshot', 'browser_evaluate', 'browser_click', 'browser_type', 'browser_wait', 'browser_console_logs', 'browser_close', 'read_file'],
    'workspace': ['gws_cli', 'read_file', 'search_files', 'list_directory'],
    'file-ops': ['read_file', 'edit_file', 'multi_edit', 'create_file', 'delete_file', 'search_files', 'list_directory', 'glob_files'],
    'search': ['read_file', 'search_files', 'glob_files', 'list_directory', 'find_symbol', 'find_references', 'list_symbols', 'semantic_search', 'find_implementation', 'batch_search'],
    'research': ['websearch', 'read_url_content', 'view_content_chunk', 'browser_navigate', 'browser_screenshot', 'browser_evaluate', 'browser_close', 'read_file'],
};

// Tool categories for deferred loading (load_tools)
const DEFERRED_TOOL_CATEGORIES = {
    deployment: ['deploy_web_app', 'read_deployment_config', 'check_deploy_status'],
    browser: ['browser_navigate', 'browser_screenshot', 'browser_evaluate', 'browser_click', 'browser_type', 'browser_wait', 'browser_console_logs', 'browser_close'],
    notebooks: ['read_notebook', 'edit_notebook'],
    url_reading: ['read_url_content', 'view_content_chunk'],
    orchestration: ['orchestrate', 'spawn_specialist', 'delegate_task'],
    code_intelligence: ['find_symbol', 'find_references', 'list_symbols', 'find_implementation'],
    context_engine: ['get_context_summary', 'explore_codebase', 'get_dependency_graph', 'get_smart_context'],
    verification: ['verify_project'],
};

// Core tools always sent to AI (everything NOT in deferred categories)
const DEFERRED_TOOL_NAMES = new Set(Object.values(DEFERRED_TOOL_CATEGORIES).flat());

// Agent type restrictions — enforce read-only for explore/plan agents
const AGENT_TYPE_RESTRICTIONS = {
    'explore': {
        denied: ['edit_file', 'create_file', 'delete_file', 'multi_edit', 'run_command', 'deploy_web_app'],
        defaultToolSet: 'search',
    },
    'plan': {
        denied: ['edit_file', 'create_file', 'delete_file', 'multi_edit', 'run_command', 'deploy_web_app'],
        defaultToolSet: 'read-only',
    },
    'research': {
        denied: ['edit_file', 'create_file', 'delete_file', 'multi_edit'],
        defaultToolSet: 'research',
    },
    'general-purpose': {
        denied: [],
        defaultToolSet: null, // uses whatever tool_set is specified
    },
};

// Track loaded tool categories per conversation
const _loadedToolCategories = new Set();

function getLoadedToolCategories() { return [..._loadedToolCategories]; }
function loadToolCategories(categories) {
    for (const cat of categories) {
        if (DEFERRED_TOOL_CATEGORIES[cat]) {
            _loadedToolCategories.add(cat);
        }
    }
    return getLoadedToolCategories();
}
function resetLoadedTools() { _loadedToolCategories.clear(); }

// Get tool definitions filtered for current state (core + loaded deferred)
function getActiveToolDefinitions() {
    return TOOL_DEFINITIONS.filter(t => {
        const name = t.function.name;
        if (!DEFERRED_TOOL_NAMES.has(name)) return true; // core tool
        // Check if its category is loaded
        for (const [cat, tools] of Object.entries(DEFERRED_TOOL_CATEGORIES)) {
            if (tools.includes(name) && _loadedToolCategories.has(cat)) return true;
        }
        return false;
    });
}

// Agent conversation storage for resume
const _agentConversations = new Map(); // agentId -> { messages, toolSet, agentType }

async function executeSubAgent(agentId, task, contextFiles, providerConfig, toolSet, constraints, resumeId, agentType, thoroughness) {
    const agent = activeAgents.get(agentId);
    if (!agent) return { error: 'Agent not found' };

    // Apply agent type restrictions
    const typeConfig = AGENT_TYPE_RESTRICTIONS[agentType || 'general-purpose'] || AGENT_TYPE_RESTRICTIONS['general-purpose'];
    const effectiveToolSet = toolSet || typeConfig.defaultToolSet || 'read-only';

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

    // Resolve allowed tools for this sub-agent
    let allowedToolNames = SUB_AGENT_TOOL_SETS[effectiveToolSet] || SUB_AGENT_TOOL_SETS['read-only'];

    // Remove denied tools based on agent type
    if (typeConfig.denied.length > 0) {
        const deniedSet = new Set(typeConfig.denied);
        allowedToolNames = allowedToolNames.filter(t => !deniedSet.has(t));
    }

    const allowedSet = new Set(allowedToolNames);
    const toolListStr = allowedToolNames.join(', ');

    // Thoroughness hint for explore agents
    const thoroughnessHint = agentType === 'explore' && thoroughness
        ? `\n**Thoroughness:** ${thoroughness} — ${thoroughness === 'quick' ? 'basic search, 2-3 queries max' : thoroughness === 'thorough' ? 'comprehensive analysis, check multiple naming conventions and locations' : 'moderate exploration across relevant directories'}`
        : '';

    const subAgentPrompt = `You are a focused sub-agent${agentType ? ` (type: ${agentType})` : ''}. Your ONLY task: ${task}

**Available tools:** ${toolListStr}
**Do NOT attempt to call any other tools.**
${constraints ? `\n**Constraints:** ${constraints}` : ''}${thoroughnessHint}

Complete the task efficiently and return a clear, actionable summary.
${fileContext ? `\n\nContext files provided:\n${fileContext}` : ''}`;

    // Filter tool definitions to only allowed tools
    const allowedTools = TOOL_DEFINITIONS.filter(t => allowedSet.has(t.function.name));

    if (!_makeAICall) {
        agent.status = 'error';
        agent.result = { error: 'AI call function not configured. Sub-agents require a provider connection.' };
        return agent.result;
    }

    try {
        const MAX_SUB_ROUNDS = agentType === 'explore' && thoroughness === 'quick' ? 5 : 10;
        let messages;

        // Resume: load previous conversation
        if (resumeId && _agentConversations.has(resumeId)) {
            const prev = _agentConversations.get(resumeId);
            messages = [...prev.messages, { role: 'user', content: task }];
        } else {
            messages = [
                { role: 'system', content: subAgentPrompt },
                { role: 'user', content: task },
            ];
        }

        for (let round = 0; round < MAX_SUB_ROUNDS; round++) {
            const result = await _makeAICall(messages, providerConfig, allowedTools);

            if (result.error) {
                agent.status = 'error';
                agent.result = { error: result.error };
                return agent.result;
            }

            // No tool calls — sub-agent is done
            if (!result.hasToolCalls && !result.functionCalls?.length) {
                messages.push({ role: 'assistant', content: result.textContent || result.content || '' });
                // Save conversation for potential resume
                _agentConversations.set(agentId, { messages: [...messages], toolSet: effectiveToolSet, agentType });
                agent.status = 'done';
                agent.result = {
                    content: result.textContent || result.content || '',
                    agentId,
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

                // Enforce tool set boundary
                if (!allowedSet.has(tc.name)) {
                    messages.push({
                        role: 'tool',
                        tool_call_id: tc.id || tc.call_id,
                        content: JSON.stringify({ error: `Tool "${tc.name}" not in your tool set (${toolSet || 'read-only'}). Available: ${toolListStr}` }),
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

        // Save conversation for potential resume
        _agentConversations.set(agentId, { messages: [...messages], toolSet: effectiveToolSet, agentType });
        agent.status = 'done';
        agent.result = { content: 'Sub-agent reached max rounds.', agentId, toolsUsed: agent.toolsUsed, rounds: MAX_SUB_ROUNDS };
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
        toolSet: a.toolSet || null,
        result: a.status === 'done' ? (typeof a.result === 'object' ? (a.result?.content || '') : a.result) : null,
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
            description: 'Execute a terminal command and return stdout/stderr. Use for running scripts, installing packages, building, testing, git operations, etc. Never use cd — use cwd instead.',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'The exact command to execute. Never includes cd — use cwd instead.' },
                    cwd: { type: 'string', description: 'Working directory for the command (used instead of cd)' },
                    timeout: { type: 'integer', description: 'Timeout in milliseconds (default 120000)' },
                    blocking: { type: 'boolean', description: 'If true, blocks until command finishes (default: auto-detected). If false, runs async (for dev servers, watchers).' },
                    safe_to_auto_run: { type: 'boolean', description: 'If true, this is a read-only command safe to auto-run (ls, cat, echo, pwd). NEVER set true for destructive commands (rm, install, curl, etc.).' },
                },
                required: ['command'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'check_terminal',
            description: 'Check the status and recent output of a running terminal session (dev server, install, build). Use this to monitor background processes, verify dev servers are still running, check install progress, or read error output.',
            parameters: {
                type: 'object',
                properties: {
                    session_id: { type: 'string', description: 'The terminal session ID (returned by run_command)' },
                    lines: { type: 'integer', description: 'Number of recent output lines to return (default 20, max 100)' },
                },
                required: ['session_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_terminals',
            description: 'List all active terminal sessions — running dev servers, background processes, and recent commands. Shows PID, port, uptime, and status for each.',
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
            description: 'Spawn a focused sub-agent for a specific task. Give it precise instructions, a constrained tool set, and clear boundaries. Supports agent types for specialized behavior and resume for continuing previous agent conversations.',
            parameters: {
                type: 'object',
                properties: {
                    task: { type: 'string', description: 'Precise task description. Be specific: what to do, what NOT to do, expected output format.' },
                    tool_set: {
                        type: 'string',
                        enum: ['read-only', 'git', 'browser', 'workspace', 'file-ops', 'search', 'research'],
                        description: 'Tool set for the sub-agent. read-only (default): read/search/list. git: git tools. browser: puppeteer. workspace: gws_cli. file-ops: full CRUD. search: LSP + semantic. research: websearch + browser + URL reading.',
                    },
                    agent_type: {
                        type: 'string',
                        enum: ['general-purpose', 'explore', 'plan', 'research'],
                        description: 'Agent type. explore: fast codebase exploration (read-only). plan: design implementation strategy (read-only). research: web research + analysis. general-purpose (default): full capabilities.',
                    },
                    thoroughness: {
                        type: 'string',
                        enum: ['quick', 'medium', 'thorough'],
                        description: 'For explore agents: quick (basic search), medium (moderate exploration), thorough (comprehensive analysis). Default: medium.',
                    },
                    resume_id: {
                        type: 'string',
                        description: 'Agent ID from a previous spawn_sub_agent call. Resumes the agent with its full prior conversation preserved. The task field becomes a follow-up message.',
                    },
                    context_files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'File paths to include as context for the sub-agent',
                    },
                    constraints: {
                        type: 'string',
                        description: 'Explicit constraints: "only read these 3 files", "do not modify anything", "return JSON format", "max 5 files", etc.',
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
            description: 'Create a BRAND NEW project from scratch. Creates a clean project folder with only onicode.md (project context) + git init. No template bloat. Use ONLY for new projects — for existing folders/repos, use detect_project instead.',
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
            name: 'detect_project',
            description: 'Scan an existing folder to detect if it is a known project (already registered in Onicode) or import it as a new project. Use this INSTEAD of init_project when the user wants to work on an existing codebase, git repo, or folder they did not create through Onicode. Returns project info, detected tech stack, git status, and file listing. Automatically registers unregistered folders as projects.',
            parameters: {
                type: 'object',
                properties: {
                    folder_path: { type: 'string', description: 'Path to the existing folder to scan (e.g. "~/Projects/my-app" or "/Users/me/code/repo")' },
                },
                required: ['folder_path'],
            },
        },
    },
    // ── Conversation Recall Tools ──
    {
        type: 'function',
        function: {
            name: 'conversation_search',
            description: 'Search past conversations by content. Use when the user references previous work ("remember that thing we built", "yesterday we...", "that project from last week"). Returns matching conversations with snippets. FTS5-powered with ranking.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search keywords — what the user is referring to (e.g. "zombie game", "auth system", "portfolio site")' },
                    limit: { type: 'number', description: 'Max results (default: 5)' },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'conversation_recall',
            description: 'Load the full context of a past conversation by ID. Returns a summary with the last 20 user/AI messages. Use after conversation_search to get details about a specific past conversation the user is referencing.',
            parameters: {
                type: 'object',
                properties: {
                    conversation_id: { type: 'string', description: 'The conversation ID from conversation_search results' },
                },
                required: ['conversation_id'],
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
            description: 'Write or overwrite a memory file. Use this to update user.md with structured profile data. For incremental additions, prefer memory_append. MANDATORY: call this when the user shares personal info or you need to update their profile.',
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
            description: 'Append content to a memory file. MANDATORY: call this when the user states a preference, makes a tech decision, or you learn something worth remembering. Append to "user.md" for preferences, "MEMORY.md" for durable facts, or "<YYYY-MM-DD>.md" for session logs.',
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
    {
        type: 'function',
        function: {
            name: 'memory_search',
            description: 'Semantic search across all memories using FTS5 + TF-IDF similarity. Returns ranked results with snippets from soul, user profile, long-term memory, daily logs, and project memories. Use this PROACTIVELY to recall user preferences, past decisions, project patterns, or any relevant context before starting work.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query — keywords or phrases to find in memories' },
                    scope: { type: 'string', enum: ['all', 'global', 'project'], description: 'Search scope: all (default), global (soul/user/MEMORY/daily), or project memories only' },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'memory_save_fact',
            description: 'Quick-save a single learned fact to persistent memory. Use this whenever you learn something about the user, their preferences, a decision, or a pattern. Facts are individually indexed for fast semantic search. Much simpler than memory_append — just pass the fact string.',
            parameters: {
                type: 'object',
                properties: {
                    fact: { type: 'string', description: 'The fact to remember (e.g. "User prefers dark mode", "Project uses Prisma with PostgreSQL", "User\'s name is Alex")' },
                    category: { type: 'string', enum: ['preference', 'personal', 'technical', 'decision', 'correction', 'general'], description: 'Category for the fact (default: general)' },
                },
                required: ['fact'],
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
            description: 'Take a screenshot AND extract page content (headings, buttons, text, errors, inputs). Use the returned pageContent to analyze what the user sees — check headings, bodyText, buttons, and errors fields. If bodyText is empty, the app may not be rendering.',
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
            name: 'browser_wait',
            description: 'Wait for an element to appear on the page by CSS selector. Useful after navigation or interaction to wait for dynamic content to load before taking screenshots or clicking.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of element to wait for' },
                    timeout: { type: 'integer', description: 'Max time to wait in ms (default 10000)' },
                },
                required: ['selector'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_console_logs',
            description: 'Get browser console logs (errors, warnings, info). IMPORTANT: When you see errors, ACT on them — read the relevant source file, fix the bug with edit_file, then re-check. Do NOT just report errors to the user.',
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
            description: 'Add a task to your work plan. Always create a task list BEFORE starting any multi-step work. Supports dependency chains: use blocks/blocked_by to enforce task ordering.',
            parameters: {
                type: 'object',
                properties: {
                    content: { type: 'string', description: 'Task description' },
                    priority: { type: 'string', description: '"high", "medium", or "low"' },
                    milestone_id: { type: 'string', description: 'Optional milestone ID to group this task under' },
                    blocks: { type: 'array', items: { type: 'integer' }, description: 'Task IDs that this task blocks (they cannot start until this completes)' },
                    blocked_by: { type: 'array', items: { type: 'integer' }, description: 'Task IDs that must complete before this task can start' },
                },
                required: ['content'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'task_update',
            description: 'Update a task status or dependencies. Mark tasks "in_progress" when starting, "done" when finished. Tasks with non-empty blocked_by cannot be claimed until blockers complete.',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'integer', description: 'Task ID to update' },
                    status: { type: 'string', description: '"pending", "in_progress", "done", "skipped"' },
                    content: { type: 'string', description: 'Updated task description (optional)' },
                    add_blocks: { type: 'array', items: { type: 'integer' }, description: 'Task IDs to add as blocked by this task' },
                    add_blocked_by: { type: 'array', items: { type: 'integer' }, description: 'Task IDs to add as blocking this task' },
                    remove_blocks: { type: 'array', items: { type: 'integer' }, description: 'Task IDs to remove from blocks' },
                    remove_blocked_by: { type: 'array', items: { type: 'integer' }, description: 'Task IDs to remove from blocked_by' },
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
    // ── Plan Tools ──
    {
        type: 'function',
        function: {
            name: 'create_plan',
            description: 'Create an architecture/design plan BEFORE writing any code. Plans define the system design, components, file structure, and key decisions. The AI references plans while coding to stay aligned. Always create a plan for any non-trivial project or feature.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Plan title (e.g. "Zombie Survival Game Architecture")' },
                    overview: { type: 'string', description: 'High-level summary of what is being built and why (1-3 paragraphs)' },
                    architecture: { type: 'string', description: 'Technical architecture: patterns, data flow, state management, APIs, rendering approach, etc. Use markdown.' },
                    components: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: 'Component/module name' },
                                purpose: { type: 'string', description: 'What this component does' },
                                dependencies: { type: 'array', items: { type: 'string' }, description: 'Other components it depends on' },
                            },
                        },
                        description: 'List of components/modules in the system',
                    },
                    file_map: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                path: { type: 'string', description: 'File path relative to project root' },
                                purpose: { type: 'string', description: 'What this file contains' },
                            },
                        },
                        description: 'Planned file structure',
                    },
                    design_decisions: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Key design decisions and trade-offs (e.g. "Using Canvas2D over WebGL for simplicity")',
                    },
                },
                required: ['title', 'overview'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'update_plan',
            description: 'Update the active plan as scope evolves. Use this when the user changes requirements, you discover new needs, or architecture decisions change. Keep the plan as the living source of truth.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Updated title (optional)' },
                    overview: { type: 'string', description: 'Updated overview (optional)' },
                    architecture: { type: 'string', description: 'Updated architecture (optional)' },
                    components: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                purpose: { type: 'string' },
                                dependencies: { type: 'array', items: { type: 'string' } },
                            },
                        },
                        description: 'Updated component list (replaces existing)',
                    },
                    file_map: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                path: { type: 'string' },
                                purpose: { type: 'string' },
                            },
                        },
                        description: 'Updated file map (replaces existing)',
                    },
                    design_decisions: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Updated design decisions (replaces existing)',
                    },
                    status: { type: 'string', description: '"active", "completed", "archived"' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_plan',
            description: 'Retrieve the current active plan. Use this to refresh your understanding of the architecture before coding, after compaction, or when starting a new task. Returns the full plan with components, file map, and design decisions.',
            parameters: {
                type: 'object',
                properties: {},
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
            name: 'verify_project',
            description: 'Run automated quality checks on a project: cross-reference integrity (IDs match between files), import resolution, route/navigation target validation, unused exports detection, and dead code analysis. MANDATORY to run after building any project before marking it complete. Returns a list of issues found.',
            parameters: {
                type: 'object',
                properties: {
                    project_path: { type: 'string', description: 'Root path of the project to verify' },
                    checks: { type: 'string', description: 'Comma-separated checks to run: "cross-refs,imports,routes,exports,all" (default: "all")' },
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
    // ── Git: Stage & Unstage ──
    {
        type: 'function',
        function: {
            name: 'git_stage',
            description: 'Stage specific files for commit. Use this to selectively stage files before committing (instead of staging everything).',
            parameters: {
                type: 'object',
                properties: {
                    files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'File paths to stage. Use ["."] to stage all.',
                    },
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
                required: ['files'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_unstage',
            description: 'Unstage files that were staged for commit, keeping the working directory changes.',
            parameters: {
                type: 'object',
                properties: {
                    files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'File paths to unstage.',
                    },
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
                required: ['files'],
            },
        },
    },
    // ── Git: Merge ──
    {
        type: 'function',
        function: {
            name: 'git_merge',
            description: 'Merge a branch into the current branch. Use --no-ff for explicit merge commits.',
            parameters: {
                type: 'object',
                properties: {
                    branch: { type: 'string', description: 'Branch to merge into current branch' },
                    no_ff: { type: 'boolean', description: 'Force a merge commit even for fast-forward merges (default false)' },
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
                required: ['branch'],
            },
        },
    },
    // ── Git: Reset ──
    {
        type: 'function',
        function: {
            name: 'git_reset',
            description: 'Reset current HEAD to a specified state. Modes: soft (keep staged+working), mixed (keep working, unstage), hard (discard all changes). DANGEROUS with hard mode.',
            parameters: {
                type: 'object',
                properties: {
                    mode: { type: 'string', enum: ['soft', 'mixed', 'hard'], description: 'Reset mode (default: mixed)' },
                    ref: { type: 'string', description: 'Commit reference to reset to (default: HEAD)' },
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
            },
        },
    },
    // ── Git: Tag ──
    {
        type: 'function',
        function: {
            name: 'git_tag',
            description: 'Create, list, or delete git tags. Use for versioning releases.',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['list', 'create', 'delete'], description: 'Tag action (default: list)' },
                    tag_name: { type: 'string', description: 'Tag name (required for create/delete)' },
                    message: { type: 'string', description: 'Annotated tag message (optional, for create)' },
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
            },
        },
    },
    // ── Git: Remotes ──
    {
        type: 'function',
        function: {
            name: 'git_remotes',
            description: 'List, add, or remove remote repositories.',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['list', 'add', 'remove'], description: 'Remote action (default: list)' },
                    name: { type: 'string', description: 'Remote name (required for add/remove)' },
                    url: { type: 'string', description: 'Remote URL (required for add)' },
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
            },
        },
    },
    // ── Git: Show file at commit ──
    {
        type: 'function',
        function: {
            name: 'git_show',
            description: 'Show the contents of a file at a specific commit or branch. Useful for comparing versions.',
            parameters: {
                type: 'object',
                properties: {
                    ref: { type: 'string', description: 'Commit hash, branch name, or tag (e.g., "HEAD~1", "main", "v1.0")' },
                    file_path: { type: 'string', description: 'Path to the file within the repository' },
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
                required: ['ref', 'file_path'],
            },
        },
    },
    // ── GitHub PR Tools ──
    {
        type: 'function',
        function: {
            name: 'git_create_pr',
            description: 'Create a pull request on GitHub for the current branch. Requires GitHub account to be connected.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'PR title' },
                    body: { type: 'string', description: 'PR description/body (markdown)' },
                    base: { type: 'string', description: 'Base branch to merge into (default: main)' },
                    cwd: { type: 'string', description: 'Repository path' },
                },
                required: ['title'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_list_prs',
            description: 'List pull requests for the current repository on GitHub.',
            parameters: {
                type: 'object',
                properties: {
                    state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Filter by state (default: open)' },
                    cwd: { type: 'string', description: 'Repository path' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_publish',
            description: 'Create a new GitHub repository and push the local repo to it. Requires GitHub account.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Repository name' },
                    description: { type: 'string', description: 'Repository description' },
                    private: { type: 'boolean', description: 'Make repository private (default: true)' },
                    cwd: { type: 'string', description: 'Repository path' },
                },
                required: ['name'],
            },
        },
    },
    // ══════════════════════════════════════════
    //  GitHub CLI (gh) Tools
    // ══════════════════════════════════════════
    {
        type: 'function',
        function: {
            name: 'gh_cli',
            description: 'Execute GitHub CLI (gh) commands. Use for ALL GitHub operations: issues, PRs, repos, releases, actions, gists, codespaces, API calls. The gh CLI is authenticated via the connected GitHub account. Examples: "pr list", "issue create --title Bug --body Details", "api repos/{owner}/{repo}", "release list", "run list".',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'The gh subcommand to run (e.g. "pr list", "issue view 123", "repo clone owner/repo", "api /user/repos")' },
                    cwd: { type: 'string', description: 'Working directory (defaults to current project)' },
                    flags: { type: 'string', description: 'Additional flags as a single string (e.g. "--json number,title,state --limit 20")' },
                },
                required: ['command'],
            },
        },
    },
    // ══════════════════════════════════════════
    //  Google Workspace CLI (gws) Tools
    // ══════════════════════════════════════════
    {
        type: 'function',
        function: {
            name: 'gws_cli',
            description: 'Execute Google Workspace CLI (gws) commands for Gmail, Drive, Docs, Sheets, Calendar, and 30+ Google services. Auth is handled by gws itself (run "gws auth login" first). If auth fails, tell the user to run "gws auth login" in terminal. Common operations: "gmail users messages list --params {\"userId\":\"me\",\"maxResults\":10}", "drive files list", "sheets spreadsheets create --json {}", "calendar events list", "docs documents get --params {\"documentId\":\"...\"}". Use --json for structured input and --params for query parameters.',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'The gws subcommand (e.g. "gmail users messages list", "drive files list", "sheets spreadsheets create")' },
                    params: { type: 'string', description: 'JSON string for --params flag (query parameters)' },
                    json_body: { type: 'string', description: 'JSON string for --json flag (request body)' },
                    flags: { type: 'string', description: 'Additional flags (e.g. "--page-all", "--dry-run")' },
                },
                required: ['command'],
            },
        },
    },
    // ══════════════════════════════════════════
    //  Cascade-Level Tools
    // ══════════════════════════════════════════
    // ── Ask User Question (structured multiple-choice) ──
    {
        type: 'function',
        function: {
            name: 'ask_user_question',
            description: 'Present the user with a structured question and up to 4 clickable options. Use when you need clarification, confirmation, or a choice from the user. The user can also provide free-text instead of picking an option. ALWAYS use this instead of asking questions in plain text — it provides a better UX with clickable buttons.',
            parameters: {
                type: 'object',
                properties: {
                    question: { type: 'string', description: 'The question to ask the user' },
                    options: {
                        type: 'array',
                        description: 'Up to 4 options for the user to choose from',
                        items: {
                            type: 'object',
                            properties: {
                                label: { type: 'string', description: 'Short label for the option (shown on button)' },
                                description: { type: 'string', description: 'Longer description of what this option means' },
                            },
                            required: ['label'],
                        },
                    },
                    allow_multiple: { type: 'boolean', description: 'Whether the user can select more than one option (default: false)' },
                },
                required: ['question', 'options'],
            },
        },
    },
    // ── Sequential Thinking (structured chain-of-thought reasoning) ──
    {
        type: 'function',
        function: {
            name: 'sequential_thinking',
            description: 'A structured reasoning tool for complex multi-step problems. Call this multiple times to build a chain of thought. Each call adds a numbered thought step. You can revise previous thoughts, branch into alternatives, and adjust the total number of steps dynamically. Use for: debugging with unclear root cause, multi-file refactoring planning, architecture decisions, any problem where you need to reason step by step before acting.',
            parameters: {
                type: 'object',
                properties: {
                    thought: { type: 'string', description: 'The current thinking step content' },
                    thought_number: { type: 'integer', description: 'Current step number (1-indexed)' },
                    total_thoughts: { type: 'integer', description: 'Current estimate of total steps needed (can be adjusted)' },
                    next_thought_needed: { type: 'boolean', description: 'Whether another thought step follows' },
                    is_revision: { type: 'boolean', description: 'Whether this revises a previous thought' },
                    revises_thought: { type: 'integer', description: 'Which thought number is being reconsidered' },
                    branch_from_thought: { type: 'integer', description: 'Branching point thought number' },
                    branch_id: { type: 'string', description: 'Identifier for the current branch (e.g., "approach-A")' },
                },
                required: ['thought', 'thought_number', 'total_thoughts', 'next_thought_needed'],
            },
        },
    },
    // ── Trajectory Search (search past conversations) ──
    {
        type: 'function',
        function: {
            name: 'trajectory_search',
            description: 'Search through previous conversations for relevant context. Returns matching conversation chunks scored by relevance. Use when the user references past work, or when you need context from a previous session.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query — can be a topic, file name, tool name, or natural language description' },
                    conversation_id: { type: 'string', description: 'Optional: specific conversation ID to search within' },
                    max_results: { type: 'integer', description: 'Maximum number of results to return (default: 10, max: 50)' },
                },
                required: ['query'],
            },
        },
    },
    // ── Find by Name (enhanced file finder) ──
    {
        type: 'function',
        function: {
            name: 'find_by_name',
            description: 'Search for files and directories by name pattern. Fast alternative to list_directory for locating files. Respects .gitignore by default. Use before read_file when you know the filename but not the exact path.',
            parameters: {
                type: 'object',
                properties: {
                    search_directory: { type: 'string', description: 'The directory to search within' },
                    pattern: { type: 'string', description: 'Glob pattern to match (e.g., "*.tsx", "README*", "auth*")' },
                    type: { type: 'string', enum: ['file', 'directory', 'any'], description: 'Filter by type (default: "any")' },
                    extensions: { type: 'array', items: { type: 'string' }, description: 'File extensions to include without dot (e.g., ["ts", "tsx", "js"])' },
                    excludes: { type: 'array', items: { type: 'string' }, description: 'Glob patterns to exclude (e.g., ["node_modules/**", "dist/**"])' },
                    max_depth: { type: 'integer', description: 'Maximum directory depth to search (default: unlimited)' },
                },
                required: ['search_directory', 'pattern'],
            },
        },
    },

    // ── URL Content & Pagination ──

    {
        type: 'function',
        function: {
            name: 'read_url_content',
            description: 'Fetch and read content from a public HTTP/HTTPS URL. Returns the text content (HTML stripped) and a document_id for paginated reading with view_content_chunk. Use for documentation, API references, or any web page the user references.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'The URL to fetch (must be HTTP or HTTPS)' },
                },
                required: ['url'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'view_content_chunk',
            description: 'View a specific chunk of a previously fetched web document. The document must have already been read by read_url_content. Use to page through long documents.',
            parameters: {
                type: 'object',
                properties: {
                    document_id: { type: 'string', description: 'The document ID from a previous read_url_content call' },
                    position: { type: 'integer', description: 'The chunk position to view (0-indexed)' },
                },
                required: ['document_id', 'position'],
            },
        },
    },

    // ── Jupyter Notebook ──

    {
        type: 'function',
        function: {
            name: 'read_notebook',
            description: 'Read and parse a Jupyter notebook (.ipynb file). Shows cells with their IDs, types (code/markdown), source content, and outputs in a formatted view.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: { type: 'string', description: 'Absolute path to the .ipynb file' },
                },
                required: ['file_path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'edit_notebook',
            description: 'Edit a Jupyter notebook cell. Can replace existing cell content or insert a new cell. Cannot delete cells.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: { type: 'string', description: 'Absolute path to the .ipynb file' },
                    cell_number: { type: 'integer', description: '0-indexed cell number to edit (default: 0)' },
                    new_source: { type: 'string', description: 'New content for the cell' },
                    edit_mode: { type: 'string', enum: ['replace', 'insert'], description: '"replace" to replace cell content (default), "insert" to insert a new cell' },
                    cell_type: { type: 'string', enum: ['code', 'markdown'], description: 'Cell type — required when edit_mode is "insert"' },
                },
                required: ['file_path', 'new_source'],
            },
        },
    },

    // ── Deployment ──

    {
        type: 'function',
        function: {
            name: 'read_deployment_config',
            description: 'Read the deployment configuration for a web project. Detects framework, build settings, and readiness for deployment. Must be called before deploy_web_app.',
            parameters: {
                type: 'object',
                properties: {
                    project_path: { type: 'string', description: 'Absolute path to the project root' },
                },
                required: ['project_path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'deploy_web_app',
            description: 'Deploy a JavaScript web application to a hosting provider (Netlify/Vercel). Runs the build and deploys. Only source files needed — no pre-build required.',
            parameters: {
                type: 'object',
                properties: {
                    project_path: { type: 'string', description: 'Absolute path to the project' },
                    framework: { type: 'string', enum: ['nextjs', 'react', 'vue', 'svelte', 'astro', 'nuxt', 'gatsby', 'vite', 'remix', 'angular'], description: 'Framework enum' },
                    provider: { type: 'string', enum: ['netlify', 'vercel'], description: 'Hosting provider (default: netlify)' },
                    subdomain: { type: 'string', description: 'Unique subdomain for the URL (leave empty for re-deploys)' },
                    project_id: { type: 'string', description: 'Existing project ID for re-deploys' },
                },
                required: ['project_path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'check_deploy_status',
            description: 'Check whether a deployment build succeeded and the site is live.',
            parameters: {
                type: 'object',
                properties: {
                    deployment_id: { type: 'string', description: 'The deployment ID from deploy_web_app' },
                    provider: { type: 'string', enum: ['netlify', 'vercel'], description: 'Hosting provider' },
                },
                required: ['deployment_id'],
            },
        },
    },
    // ── Plan Mode Tools ──
    {
        type: 'function',
        function: {
            name: 'enter_plan_mode',
            description: 'Enter plan mode for non-trivial implementation tasks. In plan mode, you are restricted to read-only tools (no edit/create/delete/run_command). Explore the codebase, understand patterns, then write a plan before coding. Use for: new features, multi-file changes, architectural decisions, unclear requirements.',
            parameters: {
                type: 'object',
                properties: {
                    reason: { type: 'string', description: 'Brief reason for entering plan mode (e.g. "Multi-file refactor needs architecture review")' },
                },
                required: ['reason'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'exit_plan_mode',
            description: 'Exit plan mode after writing your plan. The plan should already be complete. This signals readiness for implementation.',
            parameters: {
                type: 'object',
                properties: {
                    plan_summary: { type: 'string', description: 'One-line summary of what the plan covers' },
                },
                required: ['plan_summary'],
            },
        },
    },
    // ── Worktree Tools ──
    {
        type: 'function',
        function: {
            name: 'enter_worktree',
            description: 'Create an isolated git worktree for experimental or parallel work. Creates a new branch from HEAD in .onicode/worktrees/. Use when you need to make changes without affecting the main working directory.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Worktree name (used for directory and branch name). Auto-generated if omitted.' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'exit_worktree',
            description: 'Leave the current worktree. Choose to keep it (for later review/merge) or remove it (cleanup).',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['keep', 'remove'], description: '"keep" preserves the worktree and branch. "remove" deletes both.' },
                    discard_changes: { type: 'boolean', description: 'Force remove even with uncommitted changes. Default false.' },
                },
                required: ['action'],
            },
        },
    },
    // ── Deferred Tool Loading ──
    {
        type: 'function',
        function: {
            name: 'load_tools',
            description: 'Load extended tool definitions by category. By default, only core tools (read/edit/create/delete/search/run_command/etc) are available. Use this to activate specialized tools when needed.',
            parameters: {
                type: 'object',
                properties: {
                    categories: {
                        type: 'array',
                        items: { type: 'string', enum: ['deployment', 'browser', 'notebooks', 'url_reading', 'orchestration', 'code_intelligence', 'context_engine', 'verification'] },
                        description: 'Tool categories to load. Each category activates a group of related tools.',
                    },
                },
                required: ['categories'],
            },
        },
    },
    // ── Background Task Output ──
    {
        type: 'function',
        function: {
            name: 'get_background_output',
            description: 'Retrieve output from a background process or async sub-agent by its ID. Can optionally block until completion.',
            parameters: {
                type: 'object',
                properties: {
                    process_id: { type: 'string', description: 'Process or agent ID to retrieve output from' },
                    block: { type: 'boolean', description: 'If true, wait for the process to complete before returning. Default false.' },
                    timeout_ms: { type: 'integer', description: 'Max wait time in ms when blocking. Default 30000 (30s). Max 300000 (5min).' },
                },
                required: ['process_id'],
            },
        },
    },
];

// ══════════════════════════════════════════
//  Tool Executor
// ══════════════════════════════════════════

async function executeTool(name, args) {
    const { executeHook, isDangerousCommand } = require('./hooks');

    // ── Permission check (may be async for 'ask' permissions) ──
    let permCheck = checkToolPermission(name, args);
    if (permCheck instanceof Promise) {
        permCheck = await permCheck;
    }
    if (!permCheck.allowed) {
        logger.warn('permissions', `Denied: ${name} — ${permCheck.reason}`);
        return { error: permCheck.reason };
    }

    // ── Plan mode enforcement — block destructive tools ──
    if (_planModeActive) {
        const planBlockedTools = ['create_file', 'delete_file', 'multi_edit', 'deploy_web_app'];
        // Allow edit_file ONLY on the plan file itself
        if (name === 'edit_file' && args.file_path !== _currentPlanPath) {
            return { error: 'PLAN MODE: edit_file is only allowed on the plan file. Call exit_plan_mode first to make code changes.' };
        }
        if (planBlockedTools.includes(name)) {
            return { error: `PLAN MODE: ${name} is blocked. Explore the codebase and write your plan first. Call exit_plan_mode to resume coding.` };
        }
        if (name === 'run_command' && args.command && !/^(git\s|cat\s|head\s|tail\s|ls\s|find\s|grep\s|wc\s|echo\s|pwd|which|env|node\s-e|python3?\s-c)/.test(args.command.trim())) {
            return { error: 'PLAN MODE: Only read-only commands allowed (git, ls, cat, grep, etc). Call exit_plan_mode first.' };
        }
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
                let { file_path, start_line, end_line } = args;
                // Auto-correct hallucinated paths: if file doesn't exist but project is active, try remapping
                if (!fs.existsSync(file_path) && _currentProjectPath) {
                    const basename = path.basename(file_path);
                    const relative = file_path.replace(/^.*?OniProjects\/[^/]+\//, '');
                    const corrected = path.join(_currentProjectPath, relative);
                    if (fs.existsSync(corrected)) {
                        logger.warn('file-ops', `Auto-corrected path: ${file_path} → ${corrected}`);
                        file_path = corrected;
                    } else {
                        return { error: `File not found: ${file_path}`, hint: _currentProjectPath ? `Active project is at: ${_currentProjectPath}` : undefined };
                    }
                }
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
                let { file_path, old_string, new_string, description } = args;
                // Auto-correct hallucinated paths
                if (!fs.existsSync(file_path) && _currentProjectPath) {
                    const relative = file_path.replace(/^.*?OniProjects\/[^/]+\//, '');
                    const corrected = path.join(_currentProjectPath, relative);
                    if (fs.existsSync(corrected)) {
                        logger.warn('file-ops', `Auto-corrected path: ${file_path} → ${corrected}`);
                        file_path = corrected;
                    }
                }
                if (!fs.existsSync(file_path)) {
                    return { error: `File not found: ${file_path}`, hint: _currentProjectPath ? `Active project is at: ${_currentProjectPath}` : undefined };
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

                        // Lint feedback
                        const fDiag = quickLintCheck(file_path);

                        return {
                            success: true,
                            file_path,
                            fuzzy_match: true,
                            similarity: Math.round(fuzzyResult.similarity * 100),
                            lines_removed: fLinesRemoved,
                            lines_added: fLinesAdded,
                            warning: `Used fuzzy match (${Math.round(fuzzyResult.similarity * 100)}% similar). Original text had minor differences.`,
                            ...(fDiag.length > 0 ? { lint_errors: fDiag } : {}),
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

                // Lint feedback after edit
                const editDiag = quickLintCheck(file_path);

                return {
                    success: true,
                    file_path,
                    description: description || 'File edited',
                    lines_removed: linesRemoved,
                    lines_added: linesAdded,
                    ...(editDiag.length > 0 ? { lint_errors: editDiag } : {}),
                };
            }

            case 'create_file': {
                const { file_path, content } = args;
                const dir = path.dirname(file_path);

                // Block binary files with empty/placeholder content
                const binaryExts = ['.ico', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.wav', '.pdf', '.zip', '.tar', '.gz'];
                const ext = path.extname(file_path).toLowerCase();
                if (binaryExts.includes(ext) && (!content || content.trim().length === 0)) {
                    return { error: `Cannot create ${ext} file with empty content — ${ext} files are binary and need real data. Skip this file or use a different approach (e.g., download it, or use an SVG text format for icons).` };
                }

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

                // Lint feedback after create
                const createDiag = quickLintCheck(file_path);
                return {
                    success: true,
                    file_path,
                    lines: lineCount,
                    ...(createDiag.length > 0 ? { lint_errors: createDiag } : {}),
                };
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
                        _backgroundProcesses.set(sessionEntry.id, { child, command, port: expectedPort, cwd: execCwd, outputBuffer: [], startedAt: Date.now(), url: null });

                        const readyTimeout = setTimeout(() => {
                            if (!resolved) {
                                resolved = true;
                                sessionEntry.status = 'running';
                                sendToRenderer('ai-terminal-session', sessionEntry);
                                resolve({
                                    command,
                                    cwd: execCwd,
                                    session_id: sessionEntry.id,
                                    exitCode: null,
                                    success: true,
                                    background: true,
                                    pid: child.pid,
                                    port: expectedPort,
                                    stdout: stdout.slice(0, 4000),
                                    stderr: stderr.slice(0, 2000),
                                    message: `Dev server started in background (PID ${child.pid}). ${expectedPort ? `Expected at http://localhost:${expectedPort} — wait a few seconds then navigate.` : 'Waiting for readiness signal...'}`,
                                    hint: expectedPort ? `Wait 5 seconds then: browser_navigate("http://localhost:${expectedPort}")` : undefined,
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
                                // Store URL on background entry for check_terminal
                                const bgEntryReady = _backgroundProcesses.get(sessionEntry.id);
                                if (bgEntryReady) bgEntryReady.url = actualUrl;
                                sendToRenderer('ai-terminal-session', sessionEntry);

                                resolve({
                                    command,
                                    cwd: execCwd,
                                    session_id: sessionEntry.id,
                                    exitCode: null,
                                    success: true,
                                    background: true,
                                    pid: child.pid,
                                    port: expectedPort,
                                    url: actualUrl,
                                    stdout: stdout.slice(0, 4000),
                                    stderr: stderr.slice(0, 2000),
                                    message: `Dev server is ready at ${actualUrl || 'unknown URL'}. Use check_terminal("${sessionEntry.id}") to monitor.`,
                                    hint: actualUrl ? `browser_navigate("${actualUrl}")` : undefined,
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

                        // Rolling output buffer for background process monitoring
                        const bgEntry = _backgroundProcesses.get(sessionEntry.id);
                        const appendToBuffer = (text) => {
                            if (!bgEntry) return;
                            const lines = text.split('\n').filter(l => l.trim());
                            bgEntry.outputBuffer.push(...lines);
                            // Keep only last MAX_OUTPUT_BUFFER lines
                            if (bgEntry.outputBuffer.length > MAX_OUTPUT_BUFFER) {
                                bgEntry.outputBuffer.splice(0, bgEntry.outputBuffer.length - MAX_OUTPUT_BUFFER);
                            }
                        };

                        child.stdout.on('data', (chunk) => {
                            const text = chunk.toString();
                            stdout += text;
                            appendToBuffer(text);
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
                            appendToBuffer(text);
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
                                    command, cwd: execCwd, session_id: sessionEntry.id,
                                    exitCode: code ?? 1,
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

            case 'check_terminal': {
                const { session_id, lines } = args;
                const lineCount = Math.min(lines || 20, 100);
                return getTerminalOutput(session_id, lineCount);
            }

            case 'list_terminals': {
                const bg = getBackgroundProcesses();
                const recent = terminalSessions
                    .filter(s => s.status === 'done' || s.status === 'error')
                    .slice(-5)
                    .map(s => ({
                        id: s.id,
                        command: s.command,
                        status: s.status,
                        exitCode: s.exitCode,
                        duration: s.duration ? `${(s.duration / 1000).toFixed(1)}s` : null,
                    }));
                return {
                    active: bg,
                    active_count: bg.length,
                    recent_completed: recent,
                    hint: bg.length > 0
                        ? `Use check_terminal("${bg[0].id}") to see recent output from a running process.`
                        : 'No active background processes.',
                };
            }

            case 'get_context_summary': {
                return fileContext.getSummary();
            }

            case 'spawn_sub_agent': {
                const { task, context_files, tool_set, constraints, resume_id, agent_type, thoroughness } = args;
                const agentId = resume_id || `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                if (!resume_id) {
                    createSubAgent(agentId, task, { context_files, tool_set, agent_type });
                }

                // Notify renderer that a sub-agent is running
                sendToRenderer('ai-agent-step', { round: 0, status: resume_id ? 'sub-agent-resume' : 'sub-agent', agentId, task, toolSet: tool_set || 'read-only' });

                // Execute the sub-agent with constrained tool set
                const result = await executeSubAgent(agentId, task, context_files, _lastProviderConfig, tool_set, constraints, resume_id, agent_type, thoroughness);

                const agentResult = {
                    agent_id: result.agentId || agentId,
                    task,
                    agent_type: agent_type || 'general-purpose',
                    tool_set: tool_set || 'read-only',
                    status: result.error ? 'error' : 'done',
                    tools_used: result.toolsUsed || [],
                    rounds: result.rounds || 0,
                    resumable: true,
                };

                // Surface the sub-agent's actual findings/output prominently
                if (result.error) {
                    agentResult.error = result.error;
                    agentResult.IMPORTANT = `Sub-agent FAILED: ${result.error}. You must handle this — either retry with different approach, do it yourself, or skip if non-critical.`;
                } else {
                    agentResult.findings = result.content || '(no output)';
                    agentResult.IMPORTANT = `Sub-agent completed. READ the "findings" field above — it contains the sub-agent's actual work output. Use these findings to inform your next steps. Do NOT ignore them.`;
                }

                return agentResult;
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
                let { file_path, edits, description, dry_run } = args;
                // Auto-correct hallucinated paths
                if (!fs.existsSync(file_path) && _currentProjectPath) {
                    const relative = file_path.replace(/^.*?OniProjects\/[^/]+\//, '');
                    const corrected = path.join(_currentProjectPath, relative);
                    if (fs.existsSync(corrected)) {
                        logger.warn('file-ops', `Auto-corrected path: ${file_path} → ${corrected}`);
                        file_path = corrected;
                    }
                }
                if (!fs.existsSync(file_path)) {
                    return { error: `File not found: ${file_path}`, hint: _currentProjectPath ? `Active project is at: ${_currentProjectPath}` : undefined };
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

            case 'detect_project': {
                const folderPath = args.folder_path;
                let expandedPath = folderPath.replace(/^~/, os.homedir());
                expandedPath = path.resolve(expandedPath);

                if (!fs.existsSync(expandedPath) || !fs.statSync(expandedPath).isDirectory()) {
                    return { error: `Directory not found: ${expandedPath}`, suggestion: 'Use init_project to create a new project instead.' };
                }

                // Delegate to project-scan IPC (already handles detection, registration, tech detection)
                const scanResult = await new Promise((resolve) => {
                    const { loadProjects, saveProjects } = require('./projects');
                    const projectName = path.basename(expandedPath);

                    const result = { name: projectName, path: expandedPath };

                    // Detect git
                    result.hasGit = fs.existsSync(path.join(expandedPath, '.git'));
                    if (result.hasGit) {
                        try {
                            result.gitBranch = execSync('git rev-parse --abbrev-ref HEAD', {
                                cwd: expandedPath, timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'],
                            }).toString().trim();
                        } catch { result.gitBranch = 'unknown'; }
                    }

                    // Detect onidocs
                    result.hasOnidocs = fs.existsSync(path.join(expandedPath, 'onidocs')) ||
                                        fs.existsSync(path.join(expandedPath, '.onidocs'));

                    // Detect tech stack
                    const files = fs.readdirSync(expandedPath);
                    const techSignals = [];
                    if (files.includes('package.json')) techSignals.push('Node.js');
                    if (files.includes('tsconfig.json')) techSignals.push('TypeScript');
                    if (files.includes('next.config.js') || files.includes('next.config.mjs') || files.includes('next.config.ts')) techSignals.push('Next.js');
                    if (files.includes('vite.config.ts') || files.includes('vite.config.js')) techSignals.push('Vite');
                    if (files.includes('Cargo.toml')) techSignals.push('Rust');
                    if (files.includes('go.mod')) techSignals.push('Go');
                    if (files.includes('requirements.txt') || files.includes('pyproject.toml')) techSignals.push('Python');
                    if (files.includes('Gemfile')) techSignals.push('Ruby');
                    if (files.includes('docker-compose.yml') || files.includes('Dockerfile')) techSignals.push('Docker');
                    result.detectedTech = techSignals;
                    result.topLevelFiles = files.filter(f => !f.startsWith('.') && f !== 'node_modules').slice(0, 25);

                    // Check if already registered
                    const projects = loadProjects();
                    const existing = projects.find(p => p.path === expandedPath);
                    if (existing) {
                        result.alreadyRegistered = true;
                        result.project = existing;
                    } else {
                        // Auto-register
                        const project = {
                            id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                            name: projectName,
                            path: expandedPath,
                            description: `Imported project (${techSignals.join(', ') || 'unknown stack'})`,
                            techStack: techSignals.join(', '),
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                        };
                        projects.unshift(project);
                        saveProjects(projects);
                        result.project = project;
                        result.alreadyRegistered = false;
                        logger.info('detect_project', `Auto-registered project "${projectName}" at ${expandedPath}`);
                    }

                    resolve(result);
                });

                // Activate this project in the session
                _currentProjectId = scanResult.project.id;
                _currentProjectPath = expandedPath;

                // Fire activation event
                if (_mainWindow?.webContents) {
                    _mainWindow.webContents.executeJavaScript(`
                        window.dispatchEvent(new CustomEvent('onicode-project-activate', {
                            detail: {
                                id: ${JSON.stringify(scanResult.project.id)},
                                name: ${JSON.stringify(scanResult.project.name)},
                                path: ${JSON.stringify(expandedPath)},
                                branch: ${JSON.stringify(scanResult.gitBranch || 'main')}
                            }
                        }));
                    `);
                }

                // Read AGENTS.md or README for context if available
                let projectContext = null;
                const agentsPath = path.join(expandedPath, 'AGENTS.md');
                const readmePath = path.join(expandedPath, 'README.md');
                if (fs.existsSync(agentsPath)) {
                    projectContext = { file: 'AGENTS.md', content: fs.readFileSync(agentsPath, 'utf-8').slice(0, 3000) };
                } else if (fs.existsSync(readmePath)) {
                    projectContext = { file: 'README.md', content: fs.readFileSync(readmePath, 'utf-8').slice(0, 3000) };
                }

                return {
                    success: true,
                    project_name: scanResult.name,
                    project_path: expandedPath,
                    already_registered: scanResult.alreadyRegistered,
                    has_git: scanResult.hasGit,
                    git_branch: scanResult.gitBranch,
                    has_onidocs: scanResult.hasOnidocs,
                    detected_tech: scanResult.detectedTech,
                    top_level_files: scanResult.topLevelFiles,
                    project_context: projectContext,
                    INSTRUCTIONS: 'This project is now active. You can read files, edit files, and run commands in this directory. Use index_project to get a deeper codebase map if needed.',
                };
            }

            case 'init_project': {
                const { name: projName, projectPath, description: projDesc, techStack } = args;

                // GUARD: If a project is already active in this session, don't create another one
                if (_currentProjectPath && fs.existsSync(_currentProjectPath)) {
                    logger.warn('init_project', `Blocked — project already active at ${_currentProjectPath}`);
                    return {
                        success: true,
                        project_path: _currentProjectPath,
                        project_name: path.basename(_currentProjectPath),
                        already_registered: true,
                        message: `A project is already active at ${_currentProjectPath}. Use this project instead.`,
                        NEXT: 'Do NOT call init_project again. Continue building in the active project.',
                    };
                }

                // Expand ~ to home directory — use ~/OniProjects/ by default (avoids macOS TCC permission issues with ~/Documents/)
                let expandedPath = projectPath.replace(/^~/, os.homedir());
                const docsOniProjects = path.join(os.homedir(), 'Documents', 'OniProjects');
                if (expandedPath.startsWith(docsOniProjects)) {
                    expandedPath = expandedPath.replace(docsOniProjects, path.join(os.homedir(), 'OniProjects'));
                }

                const result = await new Promise((resolve) => {
                    // Ensure project directory exists
                    if (!fs.existsSync(expandedPath)) {
                        fs.mkdirSync(expandedPath, { recursive: true });
                    }

                    // Create a single onicode.md — clean project context file
                    const onicodeMdPath = path.join(expandedPath, 'onicode.md');
                    if (!fs.existsSync(onicodeMdPath)) {
                        fs.writeFileSync(onicodeMdPath, `# ${projName}\n\n${projDesc || 'A project created with Onicode AI.'}\n\n## Tech Stack\n\n${techStack || '- To be defined'}\n\n## Architecture\n\n*Describe the system architecture, key components, and data flow here.*\n\n## Directory Structure\n\n\`\`\`\n${path.basename(expandedPath)}/\n├── onicode.md\n└── ...\n\`\`\`\n\n## Coding Conventions\n\n*Add project-specific patterns, naming conventions, and style rules here.*\n\n## Key Decisions\n\n*Document important architectural and design decisions here.*\n\n---\n*Managed by [Onicode](https://onicode.dev) — update this file as the project evolves.*\n`);
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
                    // Detect near-duplicates in same parent directory
                    const parentDir = path.dirname(expandedPath);
                    const nameMatch = projects.find(p => {
                        const pDir = path.dirname(p.path);
                        const pBase = path.basename(p.path).toLowerCase();
                        const newBase = path.basename(expandedPath).toLowerCase();
                        return pDir === parentDir && pBase !== newBase && (
                            pBase.includes(newBase) || newBase.includes(pBase) ||
                            pBase.replace(/[-_]?v?\d+$/, '') === newBase.replace(/[-_]?v?\d+$/, '')
                        );
                    });
                    if (nameMatch) {
                        logger.warn('init_project', `Near-duplicate detected: "${projName}" ≈ "${nameMatch.name}" at ${nameMatch.path}`);
                        resolve({ success: true, project: nameMatch, alreadyRegistered: true });
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
                            execSync('git init -b main', { cwd: expandedPath, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
                            const gitignorePath = path.join(expandedPath, '.gitignore');
                            if (!fs.existsSync(gitignorePath)) {
                                fs.writeFileSync(gitignorePath, `node_modules/\ndist/\nbuild/\n.next/\n.env\n.env.local\n.DS_Store\n*.log\ncoverage/\n.turbo/\n.cache/\n`);
                            }
                            execSync('git add -A && git commit -m "Initial commit — project scaffolded by Onicode"', {
                                cwd: expandedPath, timeout: 10000,
                                stdio: ['pipe', 'pipe', 'pipe'],
                                env: { ...process.env, GIT_AUTHOR_NAME: 'Onicode', GIT_AUTHOR_EMAIL: 'ai@onicode.dev', GIT_COMMITTER_NAME: 'Onicode', GIT_COMMITTER_EMAIL: 'ai@onicode.dev' },
                            });
                            logger.info('git', `Initialized git repo at ${expandedPath}`);
                        }
                    } catch (err) {
                        logger.warn('git', `Auto git init failed (non-critical): ${err.message}`);
                    }
                }

                // Update session references
                _currentProjectId = result.project?.id || _currentProjectId;
                _currentProjectPath = expandedPath;

                try {
                    const { taskStorage, sessionStorage: sesStore } = require('./storage');
                    const sid = getSessionId();
                    sesStore.updateProjectPath(sid, _currentProjectId, expandedPath);
                    taskStorage.updateSessionProjectPath(sid, expandedPath, _currentProjectId);
                } catch { /* non-fatal */ }

                // Fire project activation event
                if (result.project) {
                    sendToRenderer('ai-panel-open', { type: 'project' });
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
                        }, 500);
                    }
                }

                return {
                    success: true,
                    project_name: projName,
                    project_path: expandedPath,
                    already_registered: result.alreadyRegistered || false,
                    files_created: result.alreadyRegistered ? [] : ['onicode.md', '.gitignore'],
                    message: result.alreadyRegistered
                        ? `Project "${projName}" already registered — activated.`
                        : `Project "${projName}" created. Clean folder with onicode.md for project context.`,
                    NEXT: result.alreadyRegistered
                        ? 'Project exists. Proceed with the user\'s request — call task_add or create_file.'
                        : 'New project created. Start building — use create_file for source files, update onicode.md as the architecture evolves.',
                };
            }

            // ── Conversation Recall Executors ──

            case 'conversation_search': {
                const { conversationStorage } = require('./storage');
                const query = (args.query || '').trim();
                if (!query) return { error: 'query is required' };
                const limit = args.limit || 5;
                const results = conversationStorage.searchWithSnippets(query, limit);
                if (!results || results.length === 0) {
                    return {
                        query,
                        results: [],
                        totalResults: 0,
                        message: `No past conversations found matching "${query}". Try different keywords.`,
                    };
                }
                return {
                    query,
                    results: results.map(r => ({
                        id: r.id,
                        title: r.title,
                        project: r.project_name || null,
                        date: r.updated_at ? new Date(r.updated_at).toISOString().slice(0, 10) : null,
                        snippet: r.snippet,
                    })),
                    totalResults: results.length,
                    IMPORTANT: `Found ${results.length} past conversation(s). If the user is referencing one of these, call conversation_recall(id) to load its full context before proceeding.`,
                };
            }

            case 'conversation_recall': {
                const { conversationStorage } = require('./storage');
                const id = (args.conversation_id || '').trim();
                if (!id) return { error: 'conversation_id is required' };
                const summary = conversationStorage.getSummary(id);
                if (!summary) {
                    return { error: `Conversation "${id}" not found.` };
                }
                return {
                    conversation: {
                        id: summary.id,
                        title: summary.title,
                        project: summary.projectName || null,
                        messageCount: summary.messageCount,
                        date: summary.updatedAt ? new Date(summary.updatedAt).toISOString().slice(0, 10) : null,
                    },
                    context: summary.summary,
                    IMPORTANT: `This is the past conversation the user is referencing. Use this context to understand what was built/discussed, then proceed with their current request.`,
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

            case 'memory_search': {
                const { searchMemory } = require('./memory');
                const query = (args.query || '').trim();
                const scope = args.scope || 'all';
                if (!query) return { error: 'query is required' };

                const results = searchMemory(query, scope);
                return {
                    query: args.query,
                    results: results.map(r => ({
                        file: r.file,
                        category: r.category,
                        snippet: r.snippet,
                        updated_at: r.updated_at,
                        score: r.score,
                    })),
                    totalResults: results.length,
                    searchMethod: 'FTS5 + TF-IDF semantic',
                };
            }

            case 'memory_save_fact': {
                const { addFact, appendMemory } = require('./memory');
                const fact = (args.fact || '').trim();
                if (!fact) return { error: 'fact is required' };
                const category = args.category || 'general';

                // Save as individual indexed fact
                const factKey = addFact(`[${category}] ${fact}`);

                // Also append to MEMORY.md for durability
                appendMemory('MEMORY.md', `\n- [${category}] ${fact}`);

                sendToRenderer('memory-changed', { filename: 'MEMORY.md', action: 'append' });
                return {
                    success: true,
                    factKey,
                    category,
                    message: `Saved: "${fact}" — indexed for semantic search.`,
                };
            }

            // ── Browser / Puppeteer Executors ──

            case 'browser_navigate': {
                const browserMod = require('./browser');
                let result = await browserMod.navigate(args.url, {
                    waitUntil: args.wait_until || 'networkidle2',
                });
                // Auto-retry up to 3 times on CONNECTION_REFUSED (dev servers can take 5-10s to start)
                if (result.error && result.error.includes('ERR_CONNECTION_REFUSED')) {
                    for (let attempt = 1; attempt <= 3; attempt++) {
                        const delay = attempt * 3000; // 3s, 6s, 9s
                        logger.info('browser', `Connection refused on ${args.url} — waiting ${delay / 1000}s and retrying (attempt ${attempt}/3)...`);
                        await new Promise(r => setTimeout(r, delay));
                        result = await browserMod.navigate(args.url, {
                            waitUntil: args.wait_until || 'networkidle2',
                        });
                        if (!result.error || !result.error.includes('ERR_CONNECTION_REFUSED')) break;
                    }
                }
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

            case 'browser_wait': {
                const browserMod = require('./browser');
                const result = await browserMod.waitForSelector(args.selector, {
                    timeout: args.timeout || 10000,
                });
                logger.tool('browser', `wait → ${args.selector}`, result);
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
                // Set up dependencies if provided
                if (task && task.id) {
                    if (args.blocks && args.blocks.length > 0) {
                        task.blocks = args.blocks;
                        taskManager.updateTask(task.id, { blocks: JSON.stringify(args.blocks) });
                        // Also update blocked_by on target tasks
                        for (const blockedId of args.blocks) {
                            const blocked = taskManager.getTask(blockedId);
                            if (blocked) {
                                const existing = JSON.parse(blocked.blocked_by || '[]');
                                if (!existing.includes(task.id)) {
                                    existing.push(task.id);
                                    taskManager.updateTask(blockedId, { blocked_by: JSON.stringify(existing) });
                                }
                            }
                        }
                    }
                    if (args.blocked_by && args.blocked_by.length > 0) {
                        task.blocked_by = args.blocked_by;
                        taskManager.updateTask(task.id, { blocked_by: JSON.stringify(args.blocked_by) });
                        // Also update blocks on blocker tasks
                        for (const blockerId of args.blocked_by) {
                            const blocker = taskManager.getTask(blockerId);
                            if (blocker) {
                                const existing = JSON.parse(blocker.blocks || '[]');
                                if (!existing.includes(task.id)) {
                                    existing.push(task.id);
                                    taskManager.updateTask(blockerId, { blocks: JSON.stringify(existing) });
                                }
                            }
                        }
                    }
                }
                const summary = taskManager.getSummary();
                const result = { success: true, task, summary };
                if (summary.total === 1) {
                    sendToRenderer('ai-panel-open', { type: 'tasks' });
                }
                if (summary.total > 0 && summary.done === 0 && summary.inProgress === 0) {
                    result.REMINDER = 'Tasks are just a plan. You MUST now call task_update to mark a task in_progress, then call create_file and run_command to ACTUALLY build the project files. Do not respond with only text.';
                }
                return result;
            }

            case 'task_update': {
                const updates = {};
                if (args.status) updates.status = args.status;
                if (args.content) updates.content = args.content;

                // Check blocked_by constraint before allowing in_progress
                if (args.status === 'in_progress') {
                    const currentTask = taskManager.getTask(args.id);
                    if (currentTask) {
                        const blockedBy = JSON.parse(currentTask.blocked_by || '[]');
                        if (blockedBy.length > 0) {
                            const unfinished = blockedBy.filter(bid => {
                                const blocker = taskManager.getTask(bid);
                                return blocker && blocker.status !== 'done' && blocker.status !== 'skipped';
                            });
                            if (unfinished.length > 0) {
                                return { error: `Task ${args.id} is blocked by tasks [${unfinished.join(', ')}] which are not yet done. Complete those first.` };
                            }
                        }
                    }
                }

                // Handle dependency updates
                if (args.add_blocks) {
                    const current = taskManager.getTask(args.id);
                    const existing = JSON.parse(current?.blocks || '[]');
                    for (const bid of args.add_blocks) {
                        if (!existing.includes(bid)) existing.push(bid);
                    }
                    updates.blocks = JSON.stringify(existing);
                }
                if (args.add_blocked_by) {
                    const current = taskManager.getTask(args.id);
                    const existing = JSON.parse(current?.blocked_by || '[]');
                    for (const bid of args.add_blocked_by) {
                        if (!existing.includes(bid)) existing.push(bid);
                    }
                    updates.blocked_by = JSON.stringify(existing);
                }
                if (args.remove_blocks) {
                    const current = taskManager.getTask(args.id);
                    const existing = JSON.parse(current?.blocks || '[]').filter(b => !args.remove_blocks.includes(b));
                    updates.blocks = JSON.stringify(existing);
                }
                if (args.remove_blocked_by) {
                    const current = taskManager.getTask(args.id);
                    const existing = JSON.parse(current?.blocked_by || '[]').filter(b => !args.remove_blocked_by.includes(b));
                    updates.blocked_by = JSON.stringify(existing);
                }

                const task = taskManager.updateTask(args.id, updates);
                if (task.error) return task;

                // OnTaskComplete hook — fire when a task is marked done
                if (args.status === 'done' && task.content) {
                    try {
                        executeHook('OnTaskComplete', { ...hookContext, taskContent: task.content });
                    } catch { /* non-fatal */ }

                    // Auto-commit on task completion (if enabled and in a git repo)
                    try {
                        const autoCommitEnabled = _autoCommitCheck();
                        if (autoCommitEnabled && _currentProjectPath) {
                            const gitDir = path.join(_currentProjectPath, '.git');
                            if (fs.existsSync(gitDir)) {
                                // Check if there are staged or unstaged changes
                                const statusOut = execSync('git status --porcelain', {
                                    cwd: _currentProjectPath, encoding: 'utf-8', timeout: 5000,
                                    stdio: ['pipe', 'pipe', 'pipe'],
                                }).trim();
                                if (statusOut) {
                                    // Stage all changes and commit with task description
                                    const safeMsg = (task.content || 'Task completed').replace(/"/g, '\\"').slice(0, 120);
                                    execSync(`git add -A && git commit -m "task: ${safeMsg}"`, {
                                        cwd: _currentProjectPath, timeout: 10000,
                                        stdio: ['pipe', 'pipe', 'pipe'],
                                        env: { ...process.env, GIT_AUTHOR_NAME: 'Onicode', GIT_AUTHOR_EMAIL: 'ai@onicode.dev', GIT_COMMITTER_NAME: 'Onicode', GIT_COMMITTER_EMAIL: 'ai@onicode.dev' },
                                    });
                                    logger.info('git', `Auto-committed on task completion: "${safeMsg}"`);
                                    sendToRenderer('ai-auto-commit', { message: `task: ${safeMsg}`, taskId: task.id });
                                }
                            }
                        }
                    } catch (commitErr) {
                        logger.warn('git', `Auto-commit on task completion failed (non-critical): ${commitErr.message}`);
                    }
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

            // ── Plan Executors ──

            case 'create_plan': {
                const { planStorage } = require('./storage');
                const planId = `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
                const plan = {
                    id: planId,
                    title: args.title,
                    overview: args.overview || '',
                    architecture: args.architecture || '',
                    components: args.components || [],
                    fileMap: args.file_map || [],
                    designDecisions: args.design_decisions || [],
                    status: 'active',
                    createdAt: new Date().toISOString(),
                };
                planStorage.save(plan, getSessionId(), _currentProjectId, _currentProjectPath);
                _activePlanId = planId;
                sendToRenderer('ai-plan-updated', { planId, title: plan.title, status: 'active' });
                return {
                    success: true,
                    planId,
                    title: plan.title,
                    componentCount: plan.components.length,
                    fileCount: plan.fileMap.length,
                    decisionCount: plan.designDecisions.length,
                    message: `Plan "${plan.title}" created. Now create tasks based on this plan, then execute them.`,
                };
            }

            case 'update_plan': {
                const { planStorage: ps } = require('./storage');
                const currentPlanId = _activePlanId || (() => {
                    const active = ps.getActiveForSession(getSessionId());
                    return active?.id || null;
                })();
                if (!currentPlanId) return { error: 'No active plan found. Use create_plan first.' };

                const updates = {};
                if (args.title !== undefined) updates.title = args.title;
                if (args.overview !== undefined) updates.overview = args.overview;
                if (args.architecture !== undefined) updates.architecture = args.architecture;
                if (args.components !== undefined) updates.components = args.components;
                if (args.file_map !== undefined) updates.fileMap = args.file_map;
                if (args.design_decisions !== undefined) updates.designDecisions = args.design_decisions;
                if (args.status !== undefined) updates.status = args.status;

                const updated = ps.update(currentPlanId, updates);
                if (!updated) return { error: `Plan ${currentPlanId} not found.` };

                sendToRenderer('ai-plan-updated', { planId: currentPlanId, title: updated.title, status: updated.status });
                return {
                    success: true,
                    planId: currentPlanId,
                    title: updated.title,
                    status: updated.status,
                    message: `Plan updated.`,
                };
            }

            case 'get_plan': {
                const { planStorage: pg } = require('./storage');
                const pid = _activePlanId || (() => {
                    const active = pg.getActiveForSession(getSessionId());
                    return active?.id || null;
                })();
                if (!pid) return { success: true, plan: null, message: 'No active plan. Use create_plan to create one.' };

                const plan = pg.get(pid);
                if (!plan) return { success: true, plan: null, message: 'Plan not found.' };

                return {
                    success: true,
                    plan: {
                        id: plan.id,
                        title: plan.title,
                        overview: plan.overview,
                        architecture: plan.architecture,
                        components: plan.components,
                        fileMap: plan.fileMap,
                        designDecisions: plan.designDecisions,
                        status: plan.status,
                        updatedAt: plan.updated_at,
                    },
                };
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

            // ── Project Verification ──

            case 'verify_project': {
                const { project_path, checks = 'all' } = args;
                const expandedPath = project_path.replace(/^~/, os.homedir());
                if (!fs.existsSync(expandedPath)) {
                    return { error: `Project path not found: ${project_path}` };
                }

                const enabledChecks = checks === 'all'
                    ? ['cross-refs', 'imports', 'routes', 'exports']
                    : checks.split(',').map(c => c.trim());

                const issues = [];
                const skipDirs = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage', '__pycache__', '.cache', '.turbo', '.venv', 'vendor', 'target']);

                // Collect all source files
                const sourceFiles = [];
                function collectFiles(dir, depth = 0) {
                    if (depth > 6) return;
                    try {
                        const entries = fs.readdirSync(dir, { withFileTypes: true });
                        for (const entry of entries) {
                            if (entry.name.startsWith('.')) continue;
                            const fullPath = path.join(dir, entry.name);
                            if (entry.isDirectory()) {
                                if (!skipDirs.has(entry.name)) collectFiles(fullPath, depth + 1);
                                continue;
                            }
                            const ext = path.extname(entry.name);
                            if (['.ts', '.tsx', '.js', '.jsx', '.py', '.vue', '.svelte'].includes(ext)) {
                                try {
                                    const stat = fs.statSync(fullPath);
                                    if (stat.size < 500 * 1024) {
                                        const content = fs.readFileSync(fullPath, 'utf-8');
                                        sourceFiles.push({
                                            path: path.relative(expandedPath, fullPath),
                                            fullPath,
                                            content,
                                            ext,
                                        });
                                    }
                                } catch (_) { /* skip unreadable */ }
                            }
                        }
                    } catch (_) { /* skip unreadable dirs */ }
                }
                collectFiles(expandedPath);

                // Check 1: Cross-Reference Integrity
                if (enabledChecks.includes('cross-refs')) {
                    // Find all exported arrays/objects with IDs
                    const idCollections = new Map(); // collectionName -> Set<id>
                    const idReferences = []; // { from, field, referencedId, collection? }

                    for (const file of sourceFiles) {
                        const lines = file.content.split('\n');

                        // Find arrays of objects with `id` fields
                        let currentArrayName = null;
                        let bracketDepth = 0;
                        let inArray = false;

                        for (const line of lines) {
                            // Detect array declarations: export const SCENES: Scene[] = [
                            const arrayMatch = line.match(/(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*\w+(?:\[\])?\s*)?=\s*\[/);
                            if (arrayMatch) {
                                currentArrayName = arrayMatch[1];
                                inArray = true;
                                bracketDepth = 1;
                                if (!idCollections.has(currentArrayName)) {
                                    idCollections.set(currentArrayName, new Set());
                                }
                                continue;
                            }

                            if (inArray) {
                                for (const ch of line) {
                                    if (ch === '[') bracketDepth++;
                                    if (ch === ']') bracketDepth--;
                                }
                                if (bracketDepth <= 0) {
                                    inArray = false;
                                    currentArrayName = null;
                                }

                                // Extract IDs: id: "some_id" or id: 'some_id'
                                const idMatch = line.match(/\bid\s*:\s*["']([^"']+)["']/);
                                if (idMatch && currentArrayName) {
                                    idCollections.get(currentArrayName).add(idMatch[1]);
                                }
                            }

                            // Find ID references: nextSceneId, sceneId, endingId, routeId, targetId, etc.
                            const refPatterns = [
                                /next\w*Id\s*:\s*["']([^"']+)["']/g,
                                /(?:scene|ending|route|target|parent|redirect)\w*(?:Id)?\s*:\s*["']([^"']+)["']/gi,
                                /(?:to|href|redirect|navigate)\s*:\s*["']([^"']+)["']/g,
                            ];
                            const seenRefs = new Set();
                            for (const pattern of refPatterns) {
                                let match;
                                while ((match = pattern.exec(line)) !== null) {
                                    const field = match[0].split(':')[0].trim();
                                    const refKey = `${file.path}:${field}:${match[1]}`;
                                    if (seenRefs.has(refKey)) continue;
                                    seenRefs.add(refKey);
                                    idReferences.push({
                                        from: file.path,
                                        field,
                                        referencedId: match[1],
                                    });
                                }
                            }
                        }
                    }

                    // Check if referenced IDs exist in the expected collection
                    const allKnownIds = new Set();
                    for (const ids of idCollections.values()) {
                        for (const id of ids) allKnownIds.add(id);
                    }

                    // Build a mapping of field names to expected collection names
                    // e.g., "nextSceneId" → should resolve against collections containing "scene"
                    function inferExpectedCollection(fieldName) {
                        const lower = fieldName.toLowerCase().replace(/next|id|_/g, '');
                        const collectionNames = [...idCollections.keys()];
                        for (const cn of collectionNames) {
                            const cnLower = cn.toLowerCase();
                            if (cnLower.includes(lower) || lower.includes(cnLower.replace(/s$/, ''))) {
                                return cn;
                            }
                        }
                        return null;
                    }

                    for (const ref of idReferences) {
                        // Skip non-ID-like values (URLs, paths, etc.)
                        if (ref.referencedId.startsWith('/') || ref.referencedId.startsWith('http') || ref.referencedId.includes('.')) continue;

                        if (!allKnownIds.has(ref.referencedId)) {
                            issues.push({
                                severity: 'critical',
                                type: 'broken-cross-reference',
                                file: ref.from,
                                message: `"${ref.field}: ${ref.referencedId}" references an ID that doesn't exist in any data collection. Known collections: ${[...idCollections.keys()].join(', ')} (${allKnownIds.size} total IDs)`,
                            });
                        } else {
                            // Check if the ID resolves in the EXPECTED collection (not just any collection)
                            const expectedCollection = inferExpectedCollection(ref.field);
                            if (expectedCollection && idCollections.has(expectedCollection)) {
                                const expectedIds = idCollections.get(expectedCollection);
                                if (!expectedIds.has(ref.referencedId)) {
                                    // Find which collection it DOES exist in
                                    const actualCollections = [...idCollections.entries()]
                                        .filter(([_, ids]) => ids.has(ref.referencedId))
                                        .map(([name]) => name);
                                    issues.push({
                                        severity: 'critical',
                                        type: 'cross-reference-mismatch',
                                        file: ref.from,
                                        message: `"${ref.field}: ${ref.referencedId}" — field name suggests it should exist in "${expectedCollection}" but the ID was only found in: ${actualCollections.join(', ')}. This means the app's lookup function for ${expectedCollection} will NOT find this ID, causing a silent failure.`,
                                    });
                                }
                            }
                        }
                    }

                    // Report collections found
                    for (const [name, ids] of idCollections) {
                        if (ids.size > 0) {
                            issues.push({
                                severity: 'info',
                                type: 'collection-found',
                                message: `Collection "${name}" has ${ids.size} IDs: ${[...ids].slice(0, 10).join(', ')}${ids.size > 10 ? '...' : ''}`,
                            });
                        }
                    }
                }

                // Check 2: Import Resolution
                if (enabledChecks.includes('imports')) {
                    for (const file of sourceFiles) {
                        const importRegex = /(?:import|from)\s+['"]([^'"]+)['"]/g;
                        let match;
                        while ((match = importRegex.exec(file.content)) !== null) {
                            const importPath = match[1];
                            // Skip node_modules imports
                            if (!importPath.startsWith('.') && !importPath.startsWith('@/') && !importPath.startsWith('~/')) continue;

                            let resolvedImport = importPath;
                            if (importPath.startsWith('@/')) {
                                resolvedImport = importPath.replace('@/', 'src/');
                            }

                            // Check if the import target exists
                            const possiblePaths = [
                                path.join(expandedPath, resolvedImport),
                                path.join(expandedPath, resolvedImport + '.ts'),
                                path.join(expandedPath, resolvedImport + '.tsx'),
                                path.join(expandedPath, resolvedImport + '.js'),
                                path.join(expandedPath, resolvedImport + '.jsx'),
                                path.join(expandedPath, resolvedImport, 'index.ts'),
                                path.join(expandedPath, resolvedImport, 'index.tsx'),
                                path.join(expandedPath, resolvedImport, 'index.js'),
                            ];

                            const exists = possiblePaths.some(p => fs.existsSync(p));
                            if (!exists) {
                                issues.push({
                                    severity: 'high',
                                    type: 'broken-import',
                                    file: file.path,
                                    message: `Import "${importPath}" could not be resolved to an existing file`,
                                });
                            }
                        }
                    }
                }

                // Check 3: Route/Navigation Target Validation
                if (enabledChecks.includes('routes')) {
                    const definedRoutes = new Set();
                    const referencedRoutes = [];

                    for (const file of sourceFiles) {
                        // Next.js App Router: detect page.tsx files as routes
                        if (file.path.endsWith('page.tsx') || file.path.endsWith('page.jsx') || file.path.endsWith('page.ts') || file.path.endsWith('page.js')) {
                            const routePath = '/' + path.dirname(file.path).replace(/^src\/app\/?/, '').replace(/^app\/?/, '');
                            definedRoutes.add(routePath === '/.' ? '/' : routePath);
                        }

                        // React Router route definitions
                        const routeDefRegex = /path\s*[:=]\s*["']([^"']+)["']/g;
                        let match;
                        while ((match = routeDefRegex.exec(file.content)) !== null) {
                            definedRoutes.add(match[1]);
                        }

                        // Route references: href, to, navigate, redirect, push
                        const routeRefRegex = /(?:href|to|navigate|redirect|push)\s*(?:\(|=|:)\s*["']([^"']+)["']/g;
                        while ((match = routeRefRegex.exec(file.content)) !== null) {
                            if (match[1].startsWith('/') && !match[1].startsWith('//')) {
                                referencedRoutes.push({ file: file.path, route: match[1] });
                            }
                        }
                    }

                    for (const ref of referencedRoutes) {
                        const baseRoute = ref.route.split('?')[0].split('#')[0];
                        if (!definedRoutes.has(baseRoute) && definedRoutes.size > 0) {
                            issues.push({
                                severity: 'medium',
                                type: 'undefined-route',
                                file: ref.file,
                                message: `Route "${ref.route}" is referenced but no matching page/route definition was found. Known routes: ${[...definedRoutes].join(', ')}`,
                            });
                        }
                    }
                }

                // Check 4: Unused Exports
                if (enabledChecks.includes('exports')) {
                    const allExports = []; // { file, name, isDefault }
                    const allImportedNames = new Set();

                    for (const file of sourceFiles) {
                        // Collect exports
                        const exportRegex = /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g;
                        let match;
                        while ((match = exportRegex.exec(file.content)) !== null) {
                            allExports.push({ file: file.path, name: match[1] });
                        }

                        // Collect imported names
                        const importNameRegex = /import\s+(?:\{([^}]+)\}|(\w+))\s+from/g;
                        while ((match = importNameRegex.exec(file.content)) !== null) {
                            if (match[1]) {
                                match[1].split(',').forEach(name => {
                                    const cleaned = name.trim().split(/\s+as\s+/)[0].trim();
                                    if (cleaned) allImportedNames.add(cleaned);
                                });
                            }
                            if (match[2]) allImportedNames.add(match[2]);
                        }

                        // Also check for usage in JSX (component references)
                        const jsxUsageRegex = /<(\w+)/g;
                        while ((match = jsxUsageRegex.exec(file.content)) !== null) {
                            if (match[1][0] === match[1][0].toUpperCase()) {
                                allImportedNames.add(match[1]);
                            }
                        }
                    }

                    for (const exp of allExports) {
                        if (!allImportedNames.has(exp.name)) {
                            // Skip common entry points and config
                            const skipNames = ['default', 'metadata', 'generateMetadata', 'generateStaticParams', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'middleware', 'config', 'revalidate'];
                            if (!skipNames.includes(exp.name) && !exp.file.includes('page.') && !exp.file.includes('layout.') && !exp.file.includes('route.')) {
                                issues.push({
                                    severity: 'low',
                                    type: 'unused-export',
                                    file: exp.file,
                                    message: `Export "${exp.name}" is never imported/used by any other file`,
                                });
                            }
                        }
                    }
                }

                // Summary
                const critical = issues.filter(i => i.severity === 'critical').length;
                const high = issues.filter(i => i.severity === 'high').length;
                const medium = issues.filter(i => i.severity === 'medium').length;
                const low = issues.filter(i => i.severity === 'low').length;
                const info = issues.filter(i => i.severity === 'info').length;

                return {
                    project: project_path,
                    files_scanned: sourceFiles.length,
                    checks_run: enabledChecks,
                    summary: {
                        critical,
                        high,
                        medium,
                        low,
                        info,
                        total_issues: critical + high + medium + low,
                        verdict: critical > 0 ? 'FAIL — critical issues found, project will not work correctly' :
                                 high > 0 ? 'WARN — high-severity issues found, some features may be broken' :
                                 medium > 0 ? 'OK — minor issues found' : 'PASS — no issues detected',
                    },
                    issues: issues.filter(i => i.severity !== 'info').slice(0, 30),
                    collections: issues.filter(i => i.severity === 'info').slice(0, 10),
                };
            }

            // ══════════════════════════════════════════
            //  Cascade-Level Tool Executors
            // ══════════════════════════════════════════

            case 'ask_user_question': {
                const { question, options = [], allow_multiple = false } = args;
                if (!question) return { error: 'question is required' };
                if (!options.length) return { error: 'at least one option is required' };
                if (options.length > 4) return { error: 'maximum 4 options allowed' };

                const questionId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

                // Send question to renderer as a special UI event
                sendToRenderer('ai-ask-user', {
                    questionId,
                    question,
                    options: options.slice(0, 4),
                    allowMultiple: allow_multiple,
                });

                logger.info('ask-user', `Question ${questionId}: ${question} (${options.length} options)`);

                // Create a promise that resolves when the user answers
                // The answer comes back via IPC 'ai-user-answer'
                return new Promise((resolve) => {
                    const timeout = setTimeout(() => {
                        _pendingQuestions.delete(questionId);
                        resolve({ question, answer: '(user did not respond within 5 minutes)', timed_out: true });
                    }, 300000); // 5 min timeout

                    _pendingQuestions.set(questionId, { resolve, timeout });
                });
            }

            case 'sequential_thinking': {
                const {
                    thought,
                    thought_number,
                    total_thoughts,
                    next_thought_needed,
                    is_revision = false,
                    revises_thought,
                    branch_from_thought,
                    branch_id,
                } = args;

                if (!thought || !thought_number || !total_thoughts) {
                    return { error: 'thought, thought_number, and total_thoughts are required' };
                }

                // Initialize thought chain for this session if not exists
                if (!_thoughtChain) _thoughtChain = [];

                const step = {
                    number: thought_number,
                    total: total_thoughts,
                    thought,
                    isRevision: is_revision,
                    revisesThought: revises_thought || null,
                    branchFromThought: branch_from_thought || null,
                    branchId: branch_id || null,
                    timestamp: Date.now(),
                };

                // Handle revision: replace the revised thought
                if (is_revision && revises_thought) {
                    const idx = _thoughtChain.findIndex(t => t.number === revises_thought && !t.isRevision);
                    if (idx >= 0) {
                        _thoughtChain[idx].revised = true;
                        _thoughtChain[idx].revisedBy = thought_number;
                    }
                }

                _thoughtChain.push(step);

                // Send thought step to renderer for display
                sendToRenderer('ai-thinking-step', {
                    step,
                    chainLength: _thoughtChain.length,
                    nextNeeded: next_thought_needed,
                });

                logger.info('thinking', `Step ${thought_number}/${total_thoughts}${is_revision ? ' (revision)' : ''}${branch_id ? ` [${branch_id}]` : ''}: ${thought.slice(0, 100)}`);

                return {
                    thought_number,
                    total_thoughts,
                    next_thought_needed,
                    chain_length: _thoughtChain.length,
                    ...(is_revision ? { revised_thought: revises_thought } : {}),
                    ...(branch_id ? { branch_id } : {}),
                };
            }

            case 'trajectory_search': {
                const { query, conversation_id, max_results = 10 } = args;
                if (!query) return { error: 'query is required' };

                try {
                    const { conversationStorage } = require('./storage');
                    const limit = Math.min(max_results, 50);

                    let results;
                    if (conversation_id) {
                        // Search within a specific conversation
                        const conv = conversationStorage.get(conversation_id);
                        if (!conv) return { error: `Conversation ${conversation_id} not found` };
                        const messages = JSON.parse(conv.messages || '[]');
                        results = searchMessages(messages, query, limit, conversation_id, conv.title);
                    } else {
                        // Search across all conversations
                        const searchResults = conversationStorage.search(query);
                        results = [];
                        for (const sr of searchResults.slice(0, 10)) {
                            const conv = conversationStorage.get(sr.id);
                            if (!conv) continue;
                            const messages = JSON.parse(conv.messages || '[]');
                            const chunks = searchMessages(messages, query, Math.ceil(limit / Math.min(searchResults.length, 5)), sr.id, sr.title);
                            results.push(...chunks);
                        }
                        // Sort by relevance score
                        results.sort((a, b) => b.score - a.score);
                        results = results.slice(0, limit);
                    }

                    logger.info('trajectory', `Search "${query}": ${results.length} results`);
                    return { query, results, total: results.length };
                } catch (err) {
                    return { error: `Trajectory search failed: ${err.message}` };
                }
            }

            case 'find_by_name': {
                const {
                    search_directory,
                    pattern,
                    type: filterType = 'any',
                    extensions = [],
                    excludes = [],
                    max_depth,
                } = args;

                const expandedDir = search_directory.replace(/^~/, os.homedir());
                if (!fs.existsSync(expandedDir)) {
                    return { error: `Directory not found: ${search_directory}` };
                }

                try {
                    const results = [];
                    const defaultExcludes = ['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '__pycache__', '.venv', 'coverage', '.turbo'];
                    const allExcludes = [...defaultExcludes, ...excludes.map(e => e.replace(/\/\*\*$/, ''))];

                    function walkFind(dir, depth) {
                        if (max_depth !== undefined && depth > max_depth) return;
                        if (results.length >= 50) return; // Cap at 50

                        let entries;
                        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

                        for (const entry of entries) {
                            if (results.length >= 50) break;
                            if (allExcludes.includes(entry.name)) continue;
                            if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.gitignore') continue;

                            const fullPath = path.join(dir, entry.name);
                            const isDir = entry.isDirectory();

                            // Type filter
                            if (filterType === 'file' && isDir) {
                                walkFind(fullPath, depth + 1);
                                continue;
                            }
                            if (filterType === 'directory' && !isDir) continue;

                            // Extension filter
                            if (extensions.length > 0 && !isDir) {
                                const ext = path.extname(entry.name).slice(1).toLowerCase();
                                if (!extensions.includes(ext)) {
                                    continue;
                                }
                            }

                            // Pattern matching (simple glob)
                            const matchesPattern = matchGlob(entry.name, pattern);

                            if (matchesPattern) {
                                try {
                                    const stat = fs.statSync(fullPath);
                                    results.push({
                                        path: fullPath,
                                        name: entry.name,
                                        type: isDir ? 'directory' : 'file',
                                        size: isDir ? null : stat.size,
                                        modified: stat.mtime.toISOString(),
                                    });
                                } catch { /* skip inaccessible */ }
                            }

                            if (isDir) {
                                walkFind(fullPath, depth + 1);
                            }
                        }
                    }

                    walkFind(expandedDir, 0);
                    logger.info('find', `find_by_name "${pattern}" in ${search_directory}: ${results.length} matches`);
                    return { pattern, search_directory, results, total: results.length };
                } catch (err) {
                    return { error: `Find by name failed: ${err.message}` };
                }
            }

            // ── URL Content & Pagination ──

            case 'read_url_content': {
                const { url } = args;
                if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
                    return { error: 'url must be a valid HTTP or HTTPS URL' };
                }

                try {
                    const { net } = require('electron');
                    const response = await new Promise((resolve, reject) => {
                        const request = net.request(url);
                        let body = '';
                        request.on('response', (resp) => {
                            resp.on('data', (chunk) => { body += chunk.toString(); });
                            resp.on('end', () => resolve({ statusCode: resp.statusCode, body }));
                        });
                        request.on('error', reject);
                        setTimeout(() => reject(new Error('Request timed out')), 30000);
                        request.end();
                    });

                    if (response.statusCode >= 400) {
                        return { error: `HTTP ${response.statusCode} fetching ${url}` };
                    }

                    // Convert HTML to text
                    const contentType = response.body.slice(0, 100).toLowerCase();
                    const isHtml = contentType.includes('<!doctype') || contentType.includes('<html');
                    const text = isHtml ? htmlToText(response.body) : response.body;

                    // Store in document cache
                    const documentId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                    const chunks = chunkContent(text);
                    _documentCache.set(documentId, {
                        url,
                        content: text,
                        chunks,
                        fetchedAt: new Date().toISOString(),
                    });

                    // Cleanup old documents (keep last 20)
                    if (_documentCache.size > 20) {
                        const oldest = _documentCache.keys().next().value;
                        _documentCache.delete(oldest);
                    }

                    logger.info('url', `Fetched ${url}: ${text.length} chars, ${chunks.length} chunks`);

                    return {
                        document_id: documentId,
                        url,
                        total_chunks: chunks.length,
                        total_chars: text.length,
                        first_chunk: chunks[0] || '',
                        hint: chunks.length > 1 ? `Use view_content_chunk with document_id="${documentId}" and position=1..${chunks.length - 1} to read remaining content.` : undefined,
                    };
                } catch (err) {
                    return { error: `Failed to fetch URL: ${err.message}` };
                }
            }

            case 'view_content_chunk': {
                const { document_id, position } = args;
                if (!document_id) return { error: 'document_id is required' };

                const doc = _documentCache.get(document_id);
                if (!doc) {
                    return { error: `Document "${document_id}" not found in cache. Use read_url_content first to fetch the URL.` };
                }

                if (position < 0 || position >= doc.chunks.length) {
                    return { error: `Position ${position} out of range. Valid range: 0-${doc.chunks.length - 1}` };
                }

                return {
                    document_id,
                    url: doc.url,
                    position,
                    total_chunks: doc.chunks.length,
                    content: doc.chunks[position],
                    has_next: position < doc.chunks.length - 1,
                };
            }

            // ── Jupyter Notebook ──

            case 'read_notebook': {
                const { file_path } = args;
                if (!fs.existsSync(file_path)) {
                    return { error: `File not found: ${file_path}` };
                }

                try {
                    const raw = fs.readFileSync(file_path, 'utf-8');
                    const notebook = JSON.parse(raw);
                    const cells = (notebook.cells || []).map((cell, idx) => {
                        const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
                        const outputs = (cell.outputs || []).map(out => {
                            if (out.text) return { type: 'text', content: Array.isArray(out.text) ? out.text.join('') : out.text };
                            if (out.data && out.data['text/plain']) return { type: 'text', content: Array.isArray(out.data['text/plain']) ? out.data['text/plain'].join('') : out.data['text/plain'] };
                            if (out.data && out.data['image/png']) return { type: 'image', format: 'png', truncated: true };
                            if (out.ename) return { type: 'error', name: out.ename, message: out.evalue || '' };
                            return { type: 'unknown' };
                        });
                        return {
                            cell_number: idx,
                            cell_id: cell.id || `cell_${idx}`,
                            cell_type: cell.cell_type || 'code',
                            source: source.length > 5000 ? source.slice(0, 5000) + '\n... (truncated)' : source,
                            outputs: outputs.slice(0, 5), // Cap outputs
                            execution_count: cell.execution_count || null,
                        };
                    });

                    const kernelSpec = notebook.metadata?.kernelspec || {};
                    logger.info('notebook', `Read ${file_path}: ${cells.length} cells`);

                    return {
                        file_path,
                        kernel: kernelSpec.display_name || kernelSpec.name || 'unknown',
                        language: notebook.metadata?.language_info?.name || kernelSpec.language || 'unknown',
                        total_cells: cells.length,
                        cells,
                    };
                } catch (err) {
                    return { error: `Failed to read notebook: ${err.message}` };
                }
            }

            case 'edit_notebook': {
                const { file_path, cell_number = 0, new_source, edit_mode = 'replace', cell_type } = args;
                if (!fs.existsSync(file_path)) {
                    return { error: `File not found: ${file_path}` };
                }

                try {
                    const raw = fs.readFileSync(file_path, 'utf-8');
                    const notebook = JSON.parse(raw);
                    const cells = notebook.cells || [];

                    if (edit_mode === 'insert') {
                        if (!cell_type) return { error: 'cell_type is required for insert mode' };
                        const newCell = {
                            cell_type,
                            source: new_source.split('\n').map((l, i, arr) => i < arr.length - 1 ? l + '\n' : l),
                            metadata: {},
                            ...(cell_type === 'code' ? { outputs: [], execution_count: null } : {}),
                        };
                        const insertAt = Math.min(cell_number, cells.length);
                        cells.splice(insertAt, 0, newCell);
                        logger.info('notebook', `Inserted ${cell_type} cell at position ${insertAt} in ${file_path}`);
                    } else {
                        // Replace
                        if (cell_number < 0 || cell_number >= cells.length) {
                            return { error: `Cell number ${cell_number} out of range (0-${cells.length - 1})` };
                        }
                        cells[cell_number].source = new_source.split('\n').map((l, i, arr) => i < arr.length - 1 ? l + '\n' : l);
                        // Clear outputs for code cells on edit
                        if (cells[cell_number].cell_type === 'code') {
                            cells[cell_number].outputs = [];
                            cells[cell_number].execution_count = null;
                        }
                        logger.info('notebook', `Replaced cell ${cell_number} in ${file_path}`);
                    }

                    notebook.cells = cells;
                    fs.writeFileSync(file_path, JSON.stringify(notebook, null, 1));

                    return {
                        success: true,
                        file_path,
                        edit_mode,
                        cell_number: edit_mode === 'insert' ? Math.min(cell_number, cells.length - 1) : cell_number,
                        total_cells: cells.length,
                    };
                } catch (err) {
                    return { error: `Failed to edit notebook: ${err.message}` };
                }
            }

            // ── Deployment Tools ──

            case 'read_deployment_config': {
                const { project_path } = args;
                if (!fs.existsSync(project_path)) {
                    return { error: `Project not found: ${project_path}` };
                }

                try {
                    const config = { project_path, ready: false, issues: [] };

                    // Detect framework
                    const pkgPath = path.join(project_path, 'package.json');
                    if (fs.existsSync(pkgPath)) {
                        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                        config.name = pkg.name;
                        config.scripts = Object.keys(pkg.scripts || {});
                        config.has_build = !!(pkg.scripts?.build);

                        // Detect framework
                        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
                        if (deps['next']) config.framework = 'nextjs';
                        else if (deps['@sveltejs/kit']) config.framework = 'sveltekit';
                        else if (deps['nuxt']) config.framework = 'nuxt';
                        else if (deps['astro']) config.framework = 'astro';
                        else if (deps['gatsby']) config.framework = 'gatsby';
                        else if (deps['@remix-run/dev']) config.framework = 'remix';
                        else if (deps['@angular/core']) config.framework = 'angular';
                        else if (deps['vue']) config.framework = 'vue';
                        else if (deps['react']) config.framework = 'react';
                        else config.framework = 'unknown';
                    } else {
                        config.issues.push('No package.json found');
                    }

                    // Check for common config files
                    const configFiles = ['netlify.toml', 'vercel.json', '.env', '.env.local', 'next.config.js', 'next.config.mjs', 'vite.config.ts', 'vite.config.js'];
                    config.config_files = configFiles.filter(f => fs.existsSync(path.join(project_path, f)));

                    // Check for build output
                    const buildDirs = ['dist', 'build', '.next', 'out', '.output', '.svelte-kit'];
                    config.build_dirs = buildDirs.filter(d => fs.existsSync(path.join(project_path, d)));

                    // Check node_modules
                    config.has_node_modules = fs.existsSync(path.join(project_path, 'node_modules'));
                    if (!config.has_node_modules) config.issues.push('node_modules not installed — run npm install first');

                    config.ready = config.issues.length === 0 && config.has_build;
                    if (!config.has_build) config.issues.push('No "build" script in package.json');

                    return config;
                } catch (err) {
                    return { error: `Failed to read deployment config: ${err.message}` };
                }
            }

            case 'deploy_web_app': {
                const { project_path, framework, provider = 'netlify', subdomain, project_id } = args;

                try {
                    // Check if CLI tool is available
                    const cli = provider === 'netlify' ? 'netlify' : 'vercel';
                    try {
                        execSync(`which ${cli}`, { encoding: 'utf-8', timeout: 5000 });
                    } catch {
                        return { error: `${cli} CLI not installed. Run: npm install -g ${cli === 'netlify' ? 'netlify-cli' : 'vercel'}` };
                    }

                    // Build first
                    logger.info('deploy', `Building ${project_path} for ${provider}...`);
                    sendToRenderer('ai-tool-call', { name: 'deploy_web_app', args: { status: 'building', provider } });

                    try {
                        execSync('npm run build', { cwd: project_path, encoding: 'utf-8', timeout: 120000 });
                    } catch (buildErr) {
                        return { error: `Build failed: ${(buildErr.stderr || buildErr.message).slice(0, 500)}` };
                    }

                    // Deploy
                    let deployCmd;
                    if (provider === 'netlify') {
                        deployCmd = `netlify deploy --prod --dir=dist`;
                        if (subdomain) deployCmd += ` --site=${subdomain}`;
                    } else {
                        deployCmd = `vercel --prod --yes`;
                    }

                    const deployOutput = execSync(deployCmd, {
                        cwd: project_path,
                        encoding: 'utf-8',
                        timeout: 120000,
                    });

                    // Parse deployment URL from output
                    const urlMatch = deployOutput.match(/https?:\/\/[^\s]+/);
                    const deploymentId = `deploy_${Date.now()}`;

                    logger.info('deploy', `Deployed to ${provider}: ${urlMatch ? urlMatch[0] : 'URL pending'}`);

                    return {
                        success: true,
                        deployment_id: deploymentId,
                        provider,
                        url: urlMatch ? urlMatch[0] : null,
                        output: deployOutput.slice(0, 1000),
                    };
                } catch (err) {
                    return { error: `Deployment failed: ${err.message}` };
                }
            }

            case 'check_deploy_status': {
                const { deployment_id, provider = 'netlify' } = args;
                return {
                    deployment_id,
                    provider,
                    status: 'unknown',
                    message: `Use the ${provider} dashboard to check deployment status. Full API integration coming soon.`,
                };
            }

            // ── Plan Mode Tools ──

            case 'enter_plan_mode': {
                const { reason } = args;
                _planModeActive = true;
                const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                const planDir = path.join(os.homedir(), '.onicode', 'plans');
                if (!fs.existsSync(planDir)) fs.mkdirSync(planDir, { recursive: true });
                const planPath = path.join(planDir, `${planId}.md`);
                fs.writeFileSync(planPath, `# Plan: ${reason}\n\n_Write your implementation plan here._\n\nCreated: ${new Date().toISOString()}\n\n## Analysis\n\n## Approach\n\n## Files to Modify\n\n## Steps\n\n`);
                _currentPlanId = planId;
                _currentPlanPath = planPath;
                sendToRenderer('plan-mode-change', { active: true, planId, planPath });
                return {
                    success: true,
                    plan_id: planId,
                    plan_path: planPath,
                    message: `Plan mode ACTIVE. You are now restricted to read-only tools. Explore the codebase, then write your plan to: ${planPath}. Use edit_file on the plan file to write your plan. Call exit_plan_mode when done.`,
                    IMPORTANT: 'You are in PLAN MODE. DO NOT use create_file, delete_file, or run_command (except read-only commands). Focus on exploration and planning.',
                    restricted_tools: ['edit_file (only for plan file)', 'read_file', 'search_files', 'glob_files', 'list_directory', 'find_symbol', 'find_references', 'list_symbols', 'semantic_search', 'find_implementation', 'batch_search'],
                };
            }

            case 'exit_plan_mode': {
                const { plan_summary } = args;
                if (!_planModeActive) {
                    return { error: 'Not in plan mode. Call enter_plan_mode first.' };
                }
                let planContent = '';
                try {
                    if (_currentPlanPath && fs.existsSync(_currentPlanPath)) {
                        planContent = fs.readFileSync(_currentPlanPath, 'utf-8');
                    }
                } catch { /* ignore */ }
                _planModeActive = false;
                const planId = _currentPlanId;
                _currentPlanId = null;
                _currentPlanPath = null;
                sendToRenderer('plan-mode-change', { active: false, planId });
                return {
                    success: true,
                    plan_id: planId,
                    summary: plan_summary,
                    plan_content: planContent.slice(0, 4000),
                    message: 'Plan mode EXITED. You now have full tool access. Implement the plan.',
                };
            }

            // ── Worktree Tools ──

            case 'enter_worktree': {
                const wtName = args.name || `wt-${Date.now().toString(36)}`;
                const cwd = _currentProjectPath || process.cwd();
                try {
                    // Check if in git repo
                    execSync('git rev-parse --git-dir', { cwd, encoding: 'utf-8', timeout: 5000 });
                } catch {
                    return { error: 'Not in a git repository. Worktrees require git.' };
                }
                const wtDir = path.join(cwd, '.onicode', 'worktrees');
                if (!fs.existsSync(wtDir)) fs.mkdirSync(wtDir, { recursive: true });
                const wtPath = path.join(wtDir, wtName);
                const branchName = `worktree/${wtName}`;
                try {
                    execSync(`git worktree add -b "${branchName}" "${wtPath}" HEAD`, { cwd, encoding: 'utf-8', timeout: 15000 });
                    _worktreeActive = true;
                    _worktreeOriginalCwd = cwd;
                    _worktreePath = wtPath;
                    return {
                        success: true,
                        path: wtPath,
                        branch: branchName,
                        message: `Worktree created at ${wtPath} on branch ${branchName}. You are now working in the worktree. Use exit_worktree when done.`,
                    };
                } catch (err) {
                    return { error: `Failed to create worktree: ${err.message}` };
                }
            }

            case 'exit_worktree': {
                const { action, discard_changes } = args;
                if (!_worktreeActive || !_worktreePath) {
                    return { error: 'Not in a worktree.' };
                }
                const wtPath = _worktreePath;
                const origCwd = _worktreeOriginalCwd;
                if (action === 'remove') {
                    try {
                        // Check for uncommitted changes
                        const status = execSync('git status --porcelain', { cwd: wtPath, encoding: 'utf-8', timeout: 5000 }).trim();
                        if (status && !discard_changes) {
                            return { error: 'Worktree has uncommitted changes. Set discard_changes=true to force remove, or commit first.' };
                        }
                        const branchOutput = execSync('git branch --show-current', { cwd: wtPath, encoding: 'utf-8', timeout: 5000 }).trim();
                        execSync(`git worktree remove "${wtPath}" ${discard_changes ? '--force' : ''}`, { cwd: origCwd, encoding: 'utf-8', timeout: 15000 });
                        // Clean up branch
                        try { execSync(`git branch -D "${branchOutput}"`, { cwd: origCwd, encoding: 'utf-8', timeout: 5000 }); } catch { /* ignore */ }
                        _worktreeActive = false;
                        _worktreePath = null;
                        _worktreeOriginalCwd = null;
                        return { success: true, action: 'removed', message: 'Worktree removed and branch deleted.' };
                    } catch (err) {
                        return { error: `Failed to remove worktree: ${err.message}` };
                    }
                } else {
                    _worktreeActive = false;
                    const keptPath = _worktreePath;
                    _worktreePath = null;
                    _worktreeOriginalCwd = null;
                    return { success: true, action: 'kept', path: keptPath, message: `Worktree kept at ${keptPath}. You can return to it later or merge its branch.` };
                }
            }

            // ── Deferred Tool Loading ──

            case 'load_tools': {
                const { categories } = args;
                const loaded = loadToolCategories(categories);
                const toolNames = {};
                for (const cat of categories) {
                    toolNames[cat] = DEFERRED_TOOL_CATEGORIES[cat] || [];
                }
                return {
                    success: true,
                    loaded_categories: loaded,
                    tools_activated: toolNames,
                    message: `Loaded ${categories.join(', ')} tools. These tools are now available for use.`,
                };
            }

            // ── Background Task Output ──

            case 'get_background_output': {
                const { process_id, block, timeout_ms } = args;
                // Check sub-agents
                const agentInfo = getAgentStatus(process_id);
                if (agentInfo) {
                    if (block && agentInfo.status === 'running') {
                        const maxWait = Math.min(timeout_ms || 30000, 300000);
                        const startWait = Date.now();
                        while (Date.now() - startWait < maxWait) {
                            const current = getAgentStatus(process_id);
                            if (!current || current.status !== 'running') {
                                return { id: process_id, type: 'agent', status: current?.status || 'unknown', result: current?.result || null };
                            }
                            await new Promise(r => setTimeout(r, 500));
                        }
                        return { id: process_id, type: 'agent', status: 'timeout', message: `Agent still running after ${maxWait}ms` };
                    }
                    return { id: process_id, type: 'agent', status: agentInfo.status, result: agentInfo.result || null };
                }
                // Check background processes
                const bgOutput = getTerminalOutput(process_id, 50);
                if (bgOutput) return { id: process_id, type: 'process', ...bgOutput };
                return { error: `No agent or process found with ID: ${process_id}` };
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
                        const ab = execSync('git rev-list --left-right --count HEAD...@{upstream}', { cwd, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
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

            case 'git_stage': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                const files = args.files || ['.'];
                try {
                    const fileArgs = files.map(f => `"${f}"`).join(' ');
                    execSync(`git add ${fileArgs}`, { cwd, encoding: 'utf-8', timeout: 10000 });
                    return { success: true, staged: files };
                } catch (err) {
                    return { error: `Git stage failed: ${err.stderr?.slice(0, 300) || err.message?.slice(0, 300)}` };
                }
            }

            case 'git_unstage': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                const files = args.files || [];
                try {
                    const fileArgs = files.map(f => `"${f}"`).join(' ');
                    execSync(`git restore --staged ${fileArgs}`, { cwd, encoding: 'utf-8', timeout: 10000 });
                    return { success: true, unstaged: files };
                } catch (err) {
                    return { error: `Git unstage failed: ${err.stderr?.slice(0, 300) || err.message?.slice(0, 300)}` };
                }
            }

            case 'git_merge': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                const branch = args.branch;
                if (!branch) return { error: 'Branch name is required for merge' };
                try {
                    const flag = args.no_ff ? '--no-ff' : '';
                    const output = execSync(`git merge ${flag} "${branch}"`, { cwd, encoding: 'utf-8', timeout: 30000, maxBuffer: 5 * 1024 * 1024 }).trim();
                    logger.info('git', `Merge ${branch}: ${output.slice(0, 100)}`);
                    return { success: true, branch, output };
                } catch (err) {
                    const stderr = err.stderr?.slice(0, 500) || err.message?.slice(0, 500);
                    if (stderr.includes('CONFLICT') || stderr.includes('Automatic merge failed')) {
                        return { error: `Merge conflict detected. Use git_status to see conflicted files, resolve them with edit_file, then git_stage + git_commit. Or call git_reset({ mode: "hard", ref: "HEAD" }) to abort.`, conflicts: true };
                    }
                    return { error: `Git merge failed: ${stderr}` };
                }
            }

            case 'git_reset': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                const mode = args.mode || 'mixed';
                const ref = args.ref || 'HEAD';
                if (!['soft', 'mixed', 'hard'].includes(mode)) {
                    return { error: `Invalid reset mode: ${mode}. Use soft, mixed, or hard.` };
                }
                try {
                    const output = execSync(`git reset --${mode} ${ref}`, { cwd, encoding: 'utf-8', timeout: 10000 }).trim();
                    logger.info('git', `Reset --${mode} ${ref}: ${output.slice(0, 100)}`);
                    return { success: true, mode, ref, output: output || `Reset to ${ref} (${mode})` };
                } catch (err) {
                    return { error: `Git reset failed: ${err.stderr?.slice(0, 300) || err.message?.slice(0, 300)}` };
                }
            }

            case 'git_tag': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                const action = args.action || 'list';
                try {
                    if (action === 'list') {
                        const output = execSync('git tag -l --sort=-creatordate', { cwd, encoding: 'utf-8', timeout: 10000 }).trim();
                        return { success: true, tags: output ? output.split('\n').filter(Boolean) : [] };
                    }
                    if (action === 'create') {
                        if (!args.tag_name) return { error: 'Tag name is required' };
                        const cmd = args.message
                            ? `git tag -a "${args.tag_name}" -m "${args.message.replace(/"/g, '\\"')}"`
                            : `git tag "${args.tag_name}"`;
                        execSync(cmd, { cwd, encoding: 'utf-8', timeout: 10000 });
                        logger.info('git', `Created tag: ${args.tag_name}`);
                        return { success: true, tag: args.tag_name, annotated: !!args.message };
                    }
                    if (action === 'delete') {
                        if (!args.tag_name) return { error: 'Tag name is required' };
                        execSync(`git tag -d "${args.tag_name}"`, { cwd, encoding: 'utf-8', timeout: 10000 });
                        return { success: true, deleted: args.tag_name };
                    }
                    return { error: `Unknown tag action: ${action}` };
                } catch (err) {
                    return { error: `Git tag failed: ${err.stderr?.slice(0, 300) || err.message?.slice(0, 300)}` };
                }
            }

            case 'git_remotes': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                const action = args.action || 'list';
                try {
                    if (action === 'list') {
                        const output = execSync('git remote -v', { cwd, encoding: 'utf-8', timeout: 10000 }).trim();
                        const remotes = {};
                        output.split('\n').filter(Boolean).forEach(line => {
                            const [rname, url, type] = line.split(/\s+/);
                            if (!remotes[rname]) remotes[rname] = {};
                            remotes[rname][type?.replace(/[()]/g, '')] = url;
                        });
                        return {
                            success: true,
                            remotes: Object.entries(remotes).map(([rname, urls]) => ({
                                name: rname, fetchUrl: urls.fetch || '', pushUrl: urls.push || '',
                            })),
                        };
                    }
                    if (action === 'add') {
                        if (!args.name || !args.url) return { error: 'Remote name and URL are required' };
                        execSync(`git remote add "${args.name}" "${args.url}"`, { cwd, encoding: 'utf-8', timeout: 10000 });
                        return { success: true, added: args.name, url: args.url };
                    }
                    if (action === 'remove') {
                        if (!args.name) return { error: 'Remote name is required' };
                        execSync(`git remote remove "${args.name}"`, { cwd, encoding: 'utf-8', timeout: 10000 });
                        return { success: true, removed: args.name };
                    }
                    return { error: `Unknown remote action: ${action}` };
                } catch (err) {
                    return { error: `Git remotes failed: ${err.stderr?.slice(0, 300) || err.message?.slice(0, 300)}` };
                }
            }

            case 'git_show': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                if (!args.ref || !args.file_path) return { error: 'Both ref and file_path are required' };
                try {
                    const output = execSync(`git show ${args.ref}:"${args.file_path}"`, { cwd, encoding: 'utf-8', timeout: 10000, maxBuffer: 5 * 1024 * 1024 }).trim();
                    return { success: true, ref: args.ref, file_path: args.file_path, content: output };
                } catch (err) {
                    return { error: `Git show failed: ${err.stderr?.slice(0, 300) || err.message?.slice(0, 300)}` };
                }
            }

            case 'git_create_pr': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                const { getGithubToken } = require('./git');
                const token = getGithubToken();
                if (!token) return { error: 'GitHub account not connected. User must connect in Settings > Connectors.' };
                try {
                    // Get current branch
                    const branchOut = execSync('git branch --show-current', { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
                    const https = require('https');
                    // Get owner/repo from remote
                    const remoteUrl = execSync('git remote get-url origin', { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
                    const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
                    if (!match) return { error: 'Cannot determine GitHub owner/repo from remote URL' };
                    const ownerRepo = `${match[1]}/${match[2]}`;
                    // First push current branch
                    const authUrl = remoteUrl.replace(/https:\/\/[^@]*github\.com\//, `https://${token}@github.com/`);
                    try {
                        execSync(`git remote set-url origin "${authUrl}"`, { cwd, encoding: 'utf-8', timeout: 5000 });
                        execSync(`git push -u origin ${branchOut}`, { cwd, encoding: 'utf-8', timeout: 30000 });
                        execSync(`git remote set-url origin "${remoteUrl}"`, { cwd, encoding: 'utf-8', timeout: 5000 });
                    } catch (pushErr) {
                        try { execSync(`git remote set-url origin "${remoteUrl}"`, { cwd, encoding: 'utf-8', timeout: 5000 }); } catch {}
                    }
                    // Create PR via API
                    const prData = await new Promise((resolve, reject) => {
                        const body = JSON.stringify({ title: args.title, body: args.body || '', head: branchOut, base: args.base || 'main' });
                        const req = https.request({ hostname: 'api.github.com', path: `/repos/${ownerRepo}/pulls`, method: 'POST',
                            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'Onicode', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' }
                        }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { const p = JSON.parse(d); if (res.statusCode >= 400) reject(new Error(p.message)); else resolve(p); } catch { resolve(d); } }); });
                        req.on('error', reject); req.write(body); req.end();
                    });
                    return { success: true, pr_number: prData.number, url: prData.html_url, title: prData.title, head: branchOut, base: args.base || 'main' };
                } catch (err) {
                    return { error: `PR creation failed: ${err.message?.slice(0, 300)}` };
                }
            }

            case 'git_list_prs': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                const { getGithubToken } = require('./git');
                const token = getGithubToken();
                if (!token) return { error: 'GitHub account not connected.' };
                try {
                    const remoteUrl = execSync('git remote get-url origin', { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
                    const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
                    if (!match) return { error: 'Cannot determine GitHub owner/repo' };
                    const ownerRepo = `${match[1]}/${match[2]}`;
                    const https = require('https');
                    const state = args.state || 'open';
                    const prsData = await new Promise((resolve, reject) => {
                        const req = https.request({ hostname: 'api.github.com', path: `/repos/${ownerRepo}/pulls?state=${state}&per_page=20`, method: 'GET',
                            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'Onicode', 'X-GitHub-Api-Version': '2022-11-28' }
                        }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve([]); } }); });
                        req.on('error', reject); req.end();
                    });
                    const prs = (Array.isArray(prsData) ? prsData : []).map(pr => ({
                        number: pr.number, title: pr.title, state: pr.state, author: pr.user?.login,
                        head: pr.head?.ref, base: pr.base?.ref, url: pr.html_url,
                        draft: pr.draft, labels: (pr.labels || []).map(l => l.name),
                    }));
                    return { success: true, count: prs.length, prs };
                } catch (err) {
                    return { error: `List PRs failed: ${err.message?.slice(0, 300)}` };
                }
            }

            case 'git_publish': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                const { getGithubToken } = require('./git');
                const token = getGithubToken();
                if (!token) return { error: 'GitHub account not connected.' };
                try {
                    const https = require('https');
                    const repoData = await new Promise((resolve, reject) => {
                        const body = JSON.stringify({ name: args.name, description: args.description || '', private: args.private !== false, auto_init: false });
                        const req = https.request({ hostname: 'api.github.com', path: '/user/repos', method: 'POST',
                            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'Onicode', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' }
                        }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { const p = JSON.parse(d); if (res.statusCode >= 400) reject(new Error(p.message)); else resolve(p); } catch { resolve(d); } }); });
                        req.on('error', reject); req.write(body); req.end();
                    });
                    // Add remote and push
                    const cloneUrl = repoData.clone_url;
                    const authUrl = cloneUrl.replace('https://github.com/', `https://${token}@github.com/`);
                    execSync(`git remote add origin "${cloneUrl}"`, { cwd, encoding: 'utf-8', timeout: 5000 });
                    const branch = execSync('git branch --show-current', { cwd, encoding: 'utf-8', timeout: 5000 }).trim() || 'main';
                    execSync(`git remote set-url origin "${authUrl}"`, { cwd, encoding: 'utf-8', timeout: 5000 });
                    execSync(`git push -u origin ${branch}`, { cwd, encoding: 'utf-8', timeout: 60000 });
                    execSync(`git remote set-url origin "${cloneUrl}"`, { cwd, encoding: 'utf-8', timeout: 5000 });
                    return { success: true, name: repoData.full_name, url: repoData.html_url, clone_url: cloneUrl, private: repoData.private };
                } catch (err) {
                    return { error: `Publish failed: ${err.message?.slice(0, 300)}` };
                }
            }

            // ══════════════════════════════════════════
            //  GitHub CLI (gh) Executor
            // ══════════════════════════════════════════

            case 'gh_cli': {
                const cwd = args.cwd || _currentProjectPath || os.homedir();
                const command = args.command;
                if (!command || typeof command !== 'string') return { error: 'command is required' };

                // Get GitHub token — try our connector first, then fall back to gh's own auth
                const { getGithubToken: getGhToken } = require('./git');
                const ghToken = getGhToken();
                const ghEnv = { ...process.env };
                if (ghToken) ghEnv.GH_TOKEN = ghToken;

                // Check if gh is installed
                try {
                    execSync('which gh', { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
                } catch {
                    return { error: 'GitHub CLI (gh) is not installed. Connect GitHub in Settings > Connectors (auto-installs), or manually: brew install gh' };
                }

                // Check auth status if no connector token
                if (!ghToken) {
                    try {
                        execSync('gh auth status', { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
                    } catch (authErr) {
                        const authStderr = (authErr.stderr || '').trim();
                        if (authStderr.includes('not logged') || authStderr.includes('no token')) {
                            return { error: 'GitHub CLI is not authenticated. Tell the user to either: 1) Connect GitHub in Settings > Connectors, or 2) Run `gh auth login` in terminal.' };
                        }
                        // gh auth status may write to stderr even when auth is OK — continue
                    }
                }

                try {
                    const flags = args.flags ? ` ${args.flags}` : '';
                    const fullCmd = `gh ${command}${flags}`;
                    logger.info('gh_cli', `Executing: ${fullCmd}`);
                    const output = execSync(fullCmd, {
                        cwd,
                        encoding: 'utf-8',
                        timeout: 30000,
                        maxBuffer: 5 * 1024 * 1024,
                        stdio: ['pipe', 'pipe', 'pipe'],
                        env: ghEnv,
                    });
                    // Try to parse JSON output
                    try {
                        const parsed = JSON.parse(output);
                        return { success: true, data: parsed };
                    } catch {
                        return { success: true, output: output.trim().slice(0, 12000) };
                    }
                } catch (err) {
                    const stderr = (err.stderr || '').trim();
                    const stdout = (err.stdout || '').trim();
                    // Auth errors
                    if (stderr.includes('401') || stderr.includes('authentication') || stderr.includes('not logged') || stderr.includes('gh auth login')) {
                        return { error: `GitHub auth error: ${stderr.slice(0, 500)}. Tell the user to connect GitHub in Settings > Connectors or run \`gh auth login\` in terminal.` };
                    }
                    return { error: `gh command failed: ${stderr || stdout || err.message}`.slice(0, 2000) };
                }
            }

            // ══════════════════════════════════════════
            //  Google Workspace CLI (gws) Executor
            // ══════════════════════════════════════════

            case 'gws_cli': {
                const command = args.command;
                if (!command || typeof command !== 'string') return { error: 'command is required' };

                // gws handles its own auth via `gws auth login` — credentials stored in ~/.config/gws/
                // No need to inject tokens; just pass through the environment
                try {
                    let fullCmd = `gws ${command}`;
                    if (args.params) fullCmd += ` --params '${args.params}'`;
                    if (args.json_body) fullCmd += ` --json '${args.json_body}'`;
                    if (args.flags) fullCmd += ` ${args.flags}`;
                    logger.info('gws_cli', `Executing: ${fullCmd}`);
                    const output = execSync(fullCmd, {
                        encoding: 'utf-8',
                        timeout: 30000,
                        maxBuffer: 5 * 1024 * 1024,
                        stdio: ['pipe', 'pipe', 'pipe'],
                    });
                    // Parse JSON output (gws always outputs JSON)
                    try {
                        const parsed = JSON.parse(output);
                        return { success: true, data: parsed };
                    } catch {
                        return { success: true, output: output.trim().slice(0, 12000) };
                    }
                } catch (err) {
                    const stderr = (err.stderr || '').trim();
                    const stdout = (err.stdout || '').trim();
                    if (stderr.includes('not found') || stderr.includes('command not found') || err.message.includes('ENOENT')) {
                        return { error: 'Google Workspace CLI (gws) is not installed. Install with: npm install -g @googleworkspace/cli && gws auth setup' };
                    }
                    if (stderr.includes('No credentials') || stderr.includes('401') || stderr.includes('auth') || stderr.includes('token') || stderr.includes('login')) {
                        return { error: `gws auth error: ${(stderr || stdout).slice(0, 500)}. Tell the user to run "gws auth login" in terminal to authenticate.` };
                    }
                    return { error: `gws command failed: ${stderr || stdout || err.message}`.slice(0, 2000) };
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

/**
 * Resolve a pending ask_user_question when the user answers.
 * Called from index.js when the renderer sends 'ai-user-answer'.
 */
function resolveUserAnswer(questionId, answer) {
    const pending = _pendingQuestions.get(questionId);
    if (pending) {
        clearTimeout(pending.timeout);
        _pendingQuestions.delete(questionId);
        pending.resolve({ answer, timed_out: false });
        logger.info('ask-user', `User answered ${questionId}: ${typeof answer === 'string' ? answer.slice(0, 100) : JSON.stringify(answer)}`);
    }
}

/**
 * Reset sequential thinking chain (called at session start)
 */
function resetThoughtChain() {
    _thoughtChain = null;
}

module.exports = {
    TOOL_DEFINITIONS,
    executeTool,
    fileContext,
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
    // Get current project path (persists across streaming sessions — used by index.js fallback)
    getCurrentProjectPath: () => _currentProjectPath,
    // Background process management
    killBackgroundProcesses,
    getBackgroundProcesses,
    // Cascade-level features
    resolveUserAnswer,
    resetThoughtChain,
    resolvePermissionApproval,
    // Tool sets for workflow agentic steps
    SUB_AGENT_TOOL_SETS,
    // Deferred tool loading
    getActiveToolDefinitions,
    loadToolCategories,
    resetLoadedTools,
    DEFERRED_TOOL_CATEGORIES,
    AGENT_TYPE_RESTRICTIONS,
    // Plan mode
    getPlanModeState: () => ({ active: _planModeActive, planId: _currentPlanId, planPath: _currentPlanPath }),
    setPlanModeState: (active, planId, planPath) => { _planModeActive = active; _currentPlanId = planId || null; _currentPlanPath = planPath || null; },
    // Worktree
    getWorktreeState: () => ({ active: _worktreeActive, path: _worktreePath, originalCwd: _worktreeOriginalCwd }),
    // Agent conversations (for resume)
    getAgentConversation: (id) => _agentConversations.get(id) || null,
    listAgentConversations: () => [..._agentConversations.keys()],
};
