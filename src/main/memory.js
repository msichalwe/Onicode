/**
 * Unified Memory System
 *
 * Single source of truth for ALL memory operations in Onicode.
 * All memory reads/writes MUST go through this module.
 *
 * Architecture:
 *
 * GLOBAL MEMORIES (always injected into system prompt):
 *   ~/.onicode/memories/soul.md         — AI personality & behavior rules
 *   ~/.onicode/memories/user.md         — User profile, preferences, coding style
 *   ~/.onicode/memories/MEMORY.md       — Long-term durable facts & decisions
 *   ~/.onicode/memories/YYYY-MM-DD.md   — Daily session logs (today + yesterday injected)
 *
 * PROJECT MEMORIES (injected when project is active):
 *   ~/.onicode/memories/projects/<project-id>.md — Per-project context, decisions, patterns
 *
 * CONVERSATION MEMORY:
 *   Handled by compactor.js (context compaction) + storage.js (SQLite persistence)
 *   This module bridges: when compaction happens, the summary is saved to daily log.
 *
 * AGENTIC MEMORY:
 *   AI tools (memory_read, memory_write, memory_append) call this module directly.
 *   Auto-extraction (extractAndSaveMemory in index.js) calls this module directly.
 *
 * Change notifications:
 *   All writes emit 'memory-changed' IPC events so the UI stays in sync.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { ipcMain } = require('electron');

// ══════════════════════════════════════════
//  Paths
// ══════════════════════════════════════════

const ONICODE_DIR = path.join(os.homedir(), '.onicode');
const MEMORIES_DIR = path.join(ONICODE_DIR, 'memories');
const PROJECTS_MEMORY_DIR = path.join(MEMORIES_DIR, 'projects');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ══════════════════════════════════════════
//  Main Window Reference (for change notifications)
// ══════════════════════════════════════════

let _mainWindow = null;

function setMainWindow(win) {
    _mainWindow = win;
}

function notifyMemoryChanged(filename, action, scope = 'global') {
    if (_mainWindow?.webContents) {
        _mainWindow.webContents.send('memory-changed', { filename, action, scope });
    }
}

// ══════════════════════════════════════════
//  Default Templates
// ══════════════════════════════════════════

const DEFAULT_SOUL = `# Onicode AI — Soul

You are a highly capable, action-oriented AI coding assistant.

## Personality
- Direct and concise — no fluff
- Proactive — fix issues you notice, don't just report them
- Thorough — verify your work with builds/tests
- Respectful of the user's time — get things done fast

## Behavior Rules
- Always use tools to act, never just describe plans
- Create projects via /init before coding
- Write clean, idiomatic code following project conventions
- When you encounter errors, fix them — don't give up

## Memory Protocol
- Save important user preferences to MEMORY.md for cross-session recall
- Append daily session activity to today's daily log
- Update project memory when you learn project-specific patterns
- Read your memories at session start to resume context
`;

const DEFAULT_USER = `# User Profile

## Preferences
- Name: (not set)
- Preferred Language: (not set)
- Preferred Framework: (not set)
- Code Style: (not set)
- Timezone: (not set)

## Notes
(No notes yet — the AI will learn your preferences over time)
`;

// ══════════════════════════════════════════
//  Core File Operations (global scope)
// ══════════════════════════════════════════

function readMemory(filename) {
    ensureDir(MEMORIES_DIR);
    const filePath = path.join(MEMORIES_DIR, filename);
    try {
        return fs.readFileSync(filePath, 'utf-8');
    } catch {
        return null;
    }
}

function writeMemory(filename, content) {
    ensureDir(MEMORIES_DIR);
    const filePath = path.join(MEMORIES_DIR, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    notifyMemoryChanged(filename, 'write', 'global');
}

function appendMemory(filename, content) {
    ensureDir(MEMORIES_DIR);
    const filePath = path.join(MEMORIES_DIR, filename);
    fs.appendFileSync(filePath, '\n' + content, 'utf-8');
    notifyMemoryChanged(filename, 'append', 'global');
}

function listMemories() {
    ensureDir(MEMORIES_DIR);
    try {
        return fs.readdirSync(MEMORIES_DIR)
            .filter(f => f.endsWith('.md'))
            .map(f => {
                const filePath = path.join(MEMORIES_DIR, f);
                const stat = fs.statSync(filePath);
                return { name: f, size: stat.size, modified: stat.mtime.toISOString(), scope: 'global' };
            })
            .sort((a, b) => b.modified.localeCompare(a.modified));
    } catch {
        return [];
    }
}

function deleteMemory(filename) {
    const filePath = path.join(MEMORIES_DIR, filename);
    try {
        fs.unlinkSync(filePath);
        notifyMemoryChanged(filename, 'delete', 'global');
        return true;
    } catch {
        return false;
    }
}

// ══════════════════════════════════════════
//  Project-Scoped Memory
// ══════════════════════════════════════════

function getProjectMemoryPath(projectId) {
    return path.join(PROJECTS_MEMORY_DIR, `${projectId}.md`);
}

function readProjectMemory(projectId) {
    ensureDir(PROJECTS_MEMORY_DIR);
    try {
        return fs.readFileSync(getProjectMemoryPath(projectId), 'utf-8');
    } catch {
        return null;
    }
}

function writeProjectMemory(projectId, content) {
    ensureDir(PROJECTS_MEMORY_DIR);
    fs.writeFileSync(getProjectMemoryPath(projectId), content, 'utf-8');
    notifyMemoryChanged(`projects/${projectId}.md`, 'write', 'project');
}

function appendProjectMemory(projectId, content) {
    ensureDir(PROJECTS_MEMORY_DIR);
    const filePath = getProjectMemoryPath(projectId);
    fs.appendFileSync(filePath, '\n' + content, 'utf-8');
    notifyMemoryChanged(`projects/${projectId}.md`, 'append', 'project');
}

function listProjectMemories() {
    ensureDir(PROJECTS_MEMORY_DIR);
    try {
        return fs.readdirSync(PROJECTS_MEMORY_DIR)
            .filter(f => f.endsWith('.md'))
            .map(f => {
                const filePath = path.join(PROJECTS_MEMORY_DIR, f);
                const stat = fs.statSync(filePath);
                return { name: f, size: stat.size, modified: stat.mtime.toISOString(), scope: 'project' };
            })
            .sort((a, b) => b.modified.localeCompare(a.modified));
    } catch {
        return [];
    }
}

// ══════════════════════════════════════════
//  Date Helpers
// ══════════════════════════════════════════

function todayString() {
    return new Date().toISOString().slice(0, 10);
}

function yesterdayString() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
}

// ══════════════════════════════════════════
//  Load Core Memories (for system prompt injection)
// ══════════════════════════════════════════

/**
 * Load all memories needed for system prompt injection.
 * @param {string} [projectId] — if provided, also loads project-scoped memory
 * @returns {object} All memory content for injection
 */
function loadCoreMemories(projectId) {
    ensureDir(MEMORIES_DIR);

    const soul = readMemory('soul.md');
    const user = readMemory('user.md');
    const longTerm = readMemory('MEMORY.md');
    const dailyToday = readMemory(`${todayString()}.md`);
    const dailyYesterday = readMemory(`${yesterdayString()}.md`);
    const projectMemory = projectId ? readProjectMemory(projectId) : null;

    return {
        soul: soul || null,
        user: user || null,
        longTerm: longTerm || null,
        dailyToday: dailyToday || null,
        dailyYesterday: dailyYesterday || null,
        projectMemory: projectMemory || null,
        hasUserProfile: !!user,
        hasSoul: !!soul,
    };
}

// ══════════════════════════════════════════
//  Defaults & Onboarding
// ══════════════════════════════════════════

function ensureDefaults() {
    ensureDir(MEMORIES_DIR);
    const created = [];

    if (!fs.existsSync(path.join(MEMORIES_DIR, 'soul.md'))) {
        writeMemory('soul.md', DEFAULT_SOUL);
        created.push('soul.md');
    }

    return { created, needsOnboarding: !fs.existsSync(path.join(MEMORIES_DIR, 'user.md')) };
}

function saveOnboarding(answers) {
    const lines = ['# User Profile\n'];
    lines.push('## Preferences');
    if (answers.name) lines.push(`- Name: ${answers.name}`);
    if (answers.language) lines.push(`- Preferred Language: ${answers.language}`);
    if (answers.framework) lines.push(`- Preferred Framework: ${answers.framework}`);
    if (answers.codeStyle) lines.push(`- Code Style: ${answers.codeStyle}`);
    if (answers.extras) lines.push(`\n## Notes\n${answers.extras}`);
    writeMemory('user.md', lines.join('\n'));
}

// ══════════════════════════════════════════
//  Compaction → Memory Bridge
// ══════════════════════════════════════════

/**
 * Save a compaction summary to the daily memory log.
 * Called by compactor.js after context compaction.
 */
function saveCompactionToMemory(summary, compactedCount) {
    const dailyFile = `${todayString()}.md`;
    const entry = `\n---\n### Context Compaction at ${new Date().toLocaleTimeString()}\n(${compactedCount} messages compacted)\n${summary}\n`;
    appendMemory(dailyFile, entry);
}

/**
 * Legacy compactMessages — preserved for the memory-compact IPC handler.
 * For actual conversation compaction, use compactor.js instead.
 */
function compactMessages(messages, keepRecent = 6) {
    if (messages.length <= keepRecent + 2) return null;

    const oldMessages = messages.slice(0, messages.length - keepRecent);
    const recentMessages = messages.slice(messages.length - keepRecent);

    const summaryParts = [];
    summaryParts.push('## Compacted Conversation Summary');
    summaryParts.push(`(${oldMessages.length} older messages summarized)\n`);

    let toolCallCount = 0;
    let filesModified = new Set();
    let commandsRun = [];
    let keyTopics = [];

    for (const msg of oldMessages) {
        if (msg.role === 'user') {
            const short = msg.content.slice(0, 200);
            keyTopics.push(`- User: ${short}${msg.content.length > 200 ? '...' : ''}`);
        }
        if (msg.toolSteps) {
            for (const step of msg.toolSteps) {
                toolCallCount++;
                if (step.name === 'create_file' || step.name === 'edit_file') {
                    const p = step.args?.file_path || step.args?.path;
                    if (p) filesModified.add(p);
                }
                if (step.name === 'run_command') {
                    commandsRun.push(step.args?.command || '?');
                }
            }
        }
    }

    if (keyTopics.length > 0) {
        summaryParts.push('### Topics Discussed');
        summaryParts.push(keyTopics.slice(-10).join('\n'));
    }
    if (toolCallCount > 0) {
        summaryParts.push(`\n### Work Done`);
        summaryParts.push(`- Tool calls: ${toolCallCount}`);
        if (filesModified.size > 0) summaryParts.push(`- Files modified: ${Array.from(filesModified).join(', ')}`);
        if (commandsRun.length > 0) summaryParts.push(`- Commands: ${commandsRun.slice(-5).join(', ')}`);
    }

    const summary = summaryParts.join('\n');

    // Save to daily log
    saveCompactionToMemory(summary, oldMessages.length);

    return { summary, recentMessages, compactedCount: oldMessages.length };
}

// ══════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════

function registerMemoryIPC(ipcMainArg, getWindow) {
    const ipc = ipcMainArg || ipcMain;

    // Store window getter for change notifications
    if (getWindow) {
        // Use getter so we always have current window reference
        const origNotify = notifyMemoryChanged;
        // Override with getter-based version is handled by setMainWindow
    }

    // Load core memories (with optional project context)
    ipc.handle('memory-load-core', async (_event, projectId) => {
        try {
            return { success: true, memories: loadCoreMemories(projectId) };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // Ensure defaults exist, check if onboarding needed
    ipc.handle('memory-ensure-defaults', async () => {
        try {
            return { success: true, ...ensureDefaults() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // Save onboarding answers
    ipc.handle('memory-save-onboarding', async (_event, answers) => {
        try {
            saveOnboarding(answers);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // Read a specific memory file
    ipc.handle('memory-read', async (_event, filename) => {
        try {
            const content = readMemory(filename);
            return { success: true, content };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // Write a memory file (with change notification)
    ipc.handle('memory-write', async (_event, filename, content) => {
        try {
            writeMemory(filename, content);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // Append to a memory file (with change notification)
    ipc.handle('memory-append', async (_event, filename, content) => {
        try {
            appendMemory(filename, content);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // List all memory files (global + project)
    ipc.handle('memory-list', async () => {
        try {
            const globalFiles = listMemories();
            const projectFiles = listProjectMemories();
            return { success: true, files: [...globalFiles, ...projectFiles] };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // Delete a memory file
    ipc.handle('memory-delete', async (_event, filename) => {
        try {
            const ok = deleteMemory(filename);
            return { success: ok };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // Compact messages (legacy — use compactor.js for real compaction)
    ipc.handle('memory-compact', async (_event, messages, keepRecent) => {
        try {
            const result = compactMessages(messages, keepRecent);
            return { success: true, result };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── Project Memory IPC ──

    ipc.handle('memory-project-read', async (_event, projectId) => {
        try {
            const content = readProjectMemory(projectId);
            return { success: true, content };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-project-write', async (_event, projectId, content) => {
        try {
            writeProjectMemory(projectId, content);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-project-append', async (_event, projectId, content) => {
        try {
            appendProjectMemory(projectId, content);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
}

// ══════════════════════════════════════════
//  Exports — Single Source of Truth
// ══════════════════════════════════════════

module.exports = {
    // IPC
    registerMemoryIPC,
    setMainWindow,

    // Core operations (used by aiTools.js, index.js, compactor.js)
    readMemory,
    writeMemory,
    appendMemory,
    listMemories,
    deleteMemory,
    loadCoreMemories,

    // Project memory
    readProjectMemory,
    writeProjectMemory,
    appendProjectMemory,
    listProjectMemories,

    // Compaction bridge
    saveCompactionToMemory,
    compactMessages,

    // Defaults
    ensureDefaults,
    saveOnboarding,

    // Helpers
    todayString,
};
