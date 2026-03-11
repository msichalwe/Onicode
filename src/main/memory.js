/**
 * Unified Memory System — SQLite-backed
 *
 * Single source of truth for ALL memory operations in Onicode.
 * Everything stored in SQLite (~/.onicode/onicode.db) via memoryStorage.
 *
 * Categories:
 *   soul      — AI personality (key: 'soul')
 *   user      — User profile (key: 'profile')
 *   long-term — Durable facts & decisions (key: 'MEMORY')
 *   fact      — Individual learned facts (key: auto-generated)
 *   daily     — Session logs (key: 'YYYY-MM-DD')
 *   project   — Per-project context (key: projectId, project_id: projectId)
 *
 * Change notifications:
 *   All writes emit 'memory-changed' IPC events so the UI stays in sync.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { ipcMain } = require('electron');
const { logger } = require('./logger');

// ══════════════════════════════════════════
//  Main Window Reference (for change notifications)
// ══════════════════════════════════════════

let _mainWindow = null;

function setMainWindow(win) {
    _mainWindow = win;
}

function notifyMemoryChanged(category, key, action) {
    if (_mainWindow?.webContents) {
        _mainWindow.webContents.send('memory-changed', { category, key, action });
    }
}

// ══════════════════════════════════════════
//  Lazy storage reference (avoids circular require)
// ══════════════════════════════════════════

let _memoryStorage = null;

function getStorage() {
    if (!_memoryStorage) {
        _memoryStorage = require('./storage').memoryStorage;
    }
    return _memoryStorage;
}

// ══════════════════════════════════════════
//  Default Templates
// ══════════════════════════════════════════

const DEFAULT_SOUL = `# Onicode AI — Oni

You are **Oni** — not just an AI assistant, but a sharp, witty coding partner with real personality.

## Who You Are
- You're like a brilliant friend who happens to be an elite engineer — funny, direct, and genuinely invested in the user's success
- You have opinions. You'll push back (respectfully) if you think there's a better approach
- You celebrate wins ("hell yeah, that's clean!"), joke about struggles ("CSS centering strikes again"), and challenge the user to level up
- You're NOT a corporate chatbot. No "certainly!", no "I'd be happy to help!", no robotic filler. Just real talk.
- You match the user's energy — if they're casual, be casual. If they're focused, lock in.

## Personality Traits
- **Witty** — drop clever observations, coding jokes, and the occasional roast (with love)
- **Confident** — you know your stuff and it shows, but you admit when you're unsure
- **Competitive** — challenge the user: "bet I can do this in under 5 files" / "watch this"
- **Curious** — genuinely interested in what the user is building and why
- **Encouraging** — hype up good ideas, but also reality-check bad ones
- **Efficient** — you respect time. Talk less, build more. But when you do talk, make it count.

## Communication Style
- Lead with action, follow with personality. Build first, banter second.
- Short, punchy messages. No walls of text unless explaining something complex.
- Use humor naturally — don't force jokes, but don't suppress them either.
- When something goes wrong: acknowledge it with humor, then fix it immediately.
- End complex sessions with a real summary — not robotic bullet points, but a genuine "here's what we built and why it's cool"

## Behavior Rules
- Always use tools to act, never just describe plans
- Write clean, idiomatic code following project conventions
- When you encounter errors, fix them with determination — debugging is just solving puzzles
- Proactively improve code you touch — if you see something ugly, fix it
- Remember the user's preferences, habits, and past frustrations — act on them without being asked
- Challenge bad patterns: "this works, but here's why it'll bite you later..."

## Memory Protocol
- Save important user preferences, likes, dislikes to long-term memory
- Remember the user's name, coding style, favorite tools, pet peeves
- Track recurring frustrations so you can preemptively avoid them
- Note what makes the user laugh or what references they enjoy
- Update project memory with patterns, decisions, and "why we did it this way"
- At session end, log a brief summary with personality (not just dry facts)
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
//  Core Operations (all go through SQLite)
// ══════════════════════════════════════════

/**
 * Read a memory. Filename maps to category+key:
 *   soul.md       → category='soul', key='soul'
 *   user.md       → category='user', key='profile'
 *   MEMORY.md     → category='long-term', key='MEMORY'
 *   YYYY-MM-DD.md → category='daily', key='YYYY-MM-DD'
 *   Other         → category='misc', key=filename
 */
function filenameToKey(filename) {
    if (filename === 'soul.md') return { category: 'soul', key: 'soul' };
    if (filename === 'user.md') return { category: 'user', key: 'profile' };
    if (filename === 'MEMORY.md') return { category: 'long-term', key: 'MEMORY' };
    if (/^\d{4}-\d{2}-\d{2}\.md$/.test(filename)) return { category: 'daily', key: filename.replace('.md', '') };
    return { category: 'misc', key: filename.replace('.md', '') };
}

function readMemory(filename) {
    const { category, key } = filenameToKey(filename);
    const row = getStorage().get(category, key);
    return row?.content || null;
}

function writeMemory(filename, content) {
    const { category, key } = filenameToKey(filename);
    getStorage().upsert(category, key, content);
    notifyMemoryChanged(category, key, 'write');
}

function appendMemory(filename, content) {
    const { category, key } = filenameToKey(filename);
    getStorage().append(category, key, content);
    notifyMemoryChanged(category, key, 'append');
}

function listMemories() {
    const rows = getStorage().list(null, null, 200);
    return rows.map(r => ({
        name: keyToFilename(r.category, r.key),
        size: (r.content || '').length,
        modified: r.updated_at,
        scope: r.project_id ? 'project' : 'global',
        category: r.category,
        id: r.id,
    }));
}

function keyToFilename(category, key) {
    if (category === 'soul') return 'soul.md';
    if (category === 'user') return 'user.md';
    if (category === 'long-term') return 'MEMORY.md';
    if (category === 'daily') return `${key}.md`;
    if (category === 'project') return `projects/${key}.md`;
    if (category === 'fact') return `fact-${key}`;
    return `${key}.md`;
}

function deleteMemory(filename) {
    const { category, key } = filenameToKey(filename);
    getStorage().deleteByKey(category, key);
    notifyMemoryChanged(category, key, 'delete');
    return true;
}

// ══════════════════════════════════════════
//  Project-Scoped Memory
// ══════════════════════════════════════════

function readProjectMemory(projectId) {
    const row = getStorage().get('project', projectId);
    return row?.content || null;
}

function writeProjectMemory(projectId, content) {
    getStorage().upsert('project', projectId, content, projectId);
    notifyMemoryChanged('project', projectId, 'write');
}

function appendProjectMemory(projectId, content) {
    getStorage().append('project', projectId, content, projectId);
    notifyMemoryChanged('project', projectId, 'append');
}

function listProjectMemories() {
    const rows = getStorage().list('project');
    return rows.map(r => ({
        name: `${r.key}.md`,
        size: (r.content || '').length,
        modified: r.updated_at,
        scope: 'project',
    }));
}

// ══════════════════════════════════════════
//  Search (FTS5-backed)
// ══════════════════════════════════════════

function searchMemory(query, scope) {
    const category = scope === 'global' ? null : scope === 'project' ? 'project' : null;
    const results = getStorage().search(query, category, null, 20);
    return results.map(r => ({
        id: r.id,
        category: r.category,
        key: r.key,
        file: keyToFilename(r.category, r.key),
        content: r.content,
        snippet: extractSnippet(r.content, query),
        updated_at: r.updated_at,
    }));
}

function extractSnippet(content, query) {
    if (!content || !query) return '';
    const lower = content.toLowerCase();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    for (const term of terms) {
        const idx = lower.indexOf(term);
        if (idx >= 0) {
            const start = Math.max(0, idx - 80);
            const end = Math.min(content.length, idx + term.length + 80);
            return (start > 0 ? '...' : '') + content.slice(start, end).trim() + (end < content.length ? '...' : '');
        }
    }
    return content.slice(0, 160) + (content.length > 160 ? '...' : '');
}

// ══════════════════════════════════════════
//  Fact Storage (individual learned facts)
// ══════════════════════════════════════════

function addFact(content, projectId) {
    const key = `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    getStorage().upsert('fact', key, content, projectId || null);
    notifyMemoryChanged('fact', key, 'write');
    return key;
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

function loadCoreMemories(projectId) {
    return getStorage().loadCore(projectId);
}

// ══════════════════════════════════════════
//  Defaults & Migration
// ══════════════════════════════════════════

function ensureDefaults() {
    const storage = getStorage();
    const created = [];

    if (!storage.get('soul', 'soul')) {
        storage.upsert('soul', 'soul', DEFAULT_SOUL);
        created.push('soul');
    }

    const hasUser = !!storage.get('user', 'profile');

    // One-time migration from markdown files
    const memoriesDir = path.join(os.homedir(), '.onicode', 'memories');
    const projectsDir = path.join(memoriesDir, 'projects');
    const stats = storage.stats();
    if (stats.total <= 1) { // Only the soul we just created
        const result = storage.migrateFromFiles(memoriesDir, projectsDir);
        if (result.migrated > 0) {
            logger.info('memory', `Migrated ${result.migrated} markdown files to SQLite`);
            created.push(`${result.migrated} files migrated`);
        }
    }

    return { created, needsOnboarding: !hasUser };
}

function saveOnboarding(answers) {
    const lines = ['# User Profile\n'];
    lines.push('## Preferences');
    if (answers.name) lines.push(`- Name: ${answers.name}`);
    if (answers.language) lines.push(`- Preferred Language: ${answers.language}`);
    if (answers.framework) lines.push(`- Preferred Framework: ${answers.framework}`);
    if (answers.codeStyle) lines.push(`- Code Style: ${answers.codeStyle}`);
    if (answers.extras) lines.push(`\n## Notes\n${answers.extras}`);
    getStorage().upsert('user', 'profile', lines.join('\n'));
}

// ══════════════════════════════════════════
//  Compaction → Memory Bridge
// ══════════════════════════════════════════

function saveCompactionToMemory(summary, compactedCount) {
    const dailyKey = todayString();
    const entry = `\n---\n### Context Compaction at ${new Date().toLocaleTimeString()}\n(${compactedCount} messages compacted)\n${summary}\n`;
    getStorage().append('daily', dailyKey, entry);
}

// ══════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════

function registerMemoryIPC(ipcMainArg) {
    const ipc = ipcMainArg || ipcMain;

    ipc.handle('memory-load-core', async (_event, projectId) => {
        try {
            return { success: true, memories: loadCoreMemories(projectId) };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-ensure-defaults', async () => {
        try {
            return { success: true, ...ensureDefaults() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-save-onboarding', async (_event, answers) => {
        try {
            saveOnboarding(answers);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-read', async (_event, filename) => {
        try {
            const content = readMemory(filename);
            return { success: true, content };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-write', async (_event, filename, content) => {
        try {
            writeMemory(filename, content);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-append', async (_event, filename, content) => {
        try {
            appendMemory(filename, content);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-list', async () => {
        try {
            const files = listMemories();
            return { success: true, files };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-delete', async (_event, filename) => {
        try {
            deleteMemory(filename);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-search', async (_event, query, scope) => {
        try {
            const results = searchMemory(query, scope);
            return { success: true, results };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-stats', async () => {
        try {
            return { success: true, ...getStorage().stats() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-compact', async (_event, messages, keepRecent) => {
        // Legacy compaction — delegate to compactor.js
        return { success: true, result: null };
    });

    // Project memory IPC
    ipc.handle('memory-project-read', async (_event, projectId) => {
        try {
            return { success: true, content: readProjectMemory(projectId) };
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
//  Exports
// ══════════════════════════════════════════

module.exports = {
    registerMemoryIPC,
    setMainWindow,

    // Core operations
    readMemory,
    writeMemory,
    appendMemory,
    listMemories,
    deleteMemory,
    searchMemory,
    loadCoreMemories,

    // Facts
    addFact,

    // Project memory
    readProjectMemory,
    writeProjectMemory,
    appendProjectMemory,
    listProjectMemories,

    // Compaction bridge
    saveCompactionToMemory,

    // Defaults
    ensureDefaults,
    saveOnboarding,

    // Helpers
    todayString,
};
