/**
 * Memory System — OpenClaw-inspired persistent AI memory
 *
 * Architecture:
 * - ~/.onicode/memories/user.md     — User preferences, name, coding style (always injected)
 * - ~/.onicode/memories/soul.md     — AI personality & behavior customization (always injected)
 * - ~/.onicode/memories/YYYY-MM-DD.md — Daily session logs (append-only, load today+yesterday)
 * - ~/.onicode/memories/MEMORY.md   — Curated long-term memory (durable facts, decisions)
 *
 * Memory is injected into system prompt on every request.
 * Compaction: when conversation exceeds threshold, older messages are summarized.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { ipcMain } = require('electron');

const MEMORIES_DIR = path.join(os.homedir(), '.onicode', 'memories');

function ensureMemoriesDir() {
    if (!fs.existsSync(MEMORIES_DIR)) fs.mkdirSync(MEMORIES_DIR, { recursive: true });
}

/**
 * Default soul.md — AI personality
 */
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
`;

/**
 * Default user.md template
 */
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

/**
 * Read a memory file. Returns content or null if not found.
 */
function readMemory(filename) {
    ensureMemoriesDir();
    const filePath = path.join(MEMORIES_DIR, filename);
    try {
        return fs.readFileSync(filePath, 'utf-8');
    } catch {
        return null;
    }
}

/**
 * Write a memory file (overwrite).
 */
function writeMemory(filename, content) {
    ensureMemoriesDir();
    const filePath = path.join(MEMORIES_DIR, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Append to a memory file (create if missing).
 */
function appendMemory(filename, content) {
    ensureMemoriesDir();
    const filePath = path.join(MEMORIES_DIR, filename);
    fs.appendFileSync(filePath, '\n' + content, 'utf-8');
}

/**
 * List all memory files.
 */
function listMemories() {
    ensureMemoriesDir();
    try {
        return fs.readdirSync(MEMORIES_DIR)
            .filter(f => f.endsWith('.md'))
            .map(f => {
                const filePath = path.join(MEMORIES_DIR, f);
                const stat = fs.statSync(filePath);
                return {
                    name: f,
                    size: stat.size,
                    modified: stat.mtime.toISOString(),
                };
            })
            .sort((a, b) => b.modified.localeCompare(a.modified));
    } catch {
        return [];
    }
}

/**
 * Delete a memory file.
 */
function deleteMemory(filename) {
    const filePath = path.join(MEMORIES_DIR, filename);
    try {
        fs.unlinkSync(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get today's date string for daily log.
 */
function todayString() {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Get yesterday's date string.
 */
function yesterdayString() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
}

/**
 * Load core memories for system prompt injection.
 * Returns: { soul, user, longTerm, dailyToday, dailyYesterday }
 */
function loadCoreMemories() {
    ensureMemoriesDir();

    const soul = readMemory('soul.md');
    const user = readMemory('user.md');
    const longTerm = readMemory('MEMORY.md');
    const dailyToday = readMemory(`${todayString()}.md`);
    const dailyYesterday = readMemory(`${yesterdayString()}.md`);

    return {
        soul: soul || null,
        user: user || null,
        longTerm: longTerm || null,
        dailyToday: dailyToday || null,
        dailyYesterday: dailyYesterday || null,
        hasUserProfile: !!user,
        hasSoul: !!soul,
    };
}

/**
 * Initialize default memory files if they don't exist.
 * Returns which files were created.
 */
function ensureDefaults() {
    ensureMemoriesDir();
    const created = [];

    if (!fs.existsSync(path.join(MEMORIES_DIR, 'soul.md'))) {
        writeMemory('soul.md', DEFAULT_SOUL);
        created.push('soul.md');
    }

    return { created, needsOnboarding: !fs.existsSync(path.join(MEMORIES_DIR, 'user.md')) };
}

/**
 * Save onboarding answers as user.md
 */
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

/**
 * Compact conversation messages into a summary.
 * Takes an array of messages and returns a compact summary string.
 * This is a simple heuristic compaction — not AI-powered.
 */
function compactMessages(messages, keepRecent = 6) {
    if (messages.length <= keepRecent + 2) return null; // Not enough to compact

    const oldMessages = messages.slice(0, messages.length - keepRecent);
    const recentMessages = messages.slice(messages.length - keepRecent);

    // Build a summary of old messages
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
    const dailyFile = `${todayString()}.md`;
    appendMemory(dailyFile, `\n---\n### Compaction at ${new Date().toLocaleTimeString()}\n${summary}\n`);

    return {
        summary,
        recentMessages,
        compactedCount: oldMessages.length,
    };
}

/**
 * Register all memory IPC handlers.
 */
function registerMemoryIPC() {
    // Load core memories (for system prompt injection)
    ipcMain.handle('memory-load-core', async () => {
        try {
            return { success: true, memories: loadCoreMemories() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // Ensure defaults exist, check if onboarding needed
    ipcMain.handle('memory-ensure-defaults', async () => {
        try {
            return { success: true, ...ensureDefaults() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // Save onboarding answers
    ipcMain.handle('memory-save-onboarding', async (_event, answers) => {
        try {
            saveOnboarding(answers);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // Read a specific memory file
    ipcMain.handle('memory-read', async (_event, filename) => {
        try {
            const content = readMemory(filename);
            return { success: true, content };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // Write a memory file
    ipcMain.handle('memory-write', async (_event, filename, content) => {
        try {
            writeMemory(filename, content);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // Append to a memory file
    ipcMain.handle('memory-append', async (_event, filename, content) => {
        try {
            appendMemory(filename, content);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // List all memory files
    ipcMain.handle('memory-list', async () => {
        try {
            return { success: true, files: listMemories() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // Delete a memory file
    ipcMain.handle('memory-delete', async (_event, filename) => {
        try {
            const ok = deleteMemory(filename);
            return { success: ok };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // Compact messages
    ipcMain.handle('memory-compact', async (_event, messages, keepRecent) => {
        try {
            const result = compactMessages(messages, keepRecent);
            return { success: true, result };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
}

module.exports = { registerMemoryIPC, loadCoreMemories, compactMessages };
