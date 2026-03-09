/**
 * Hooks System — extensible hook points for tool calls, sessions, and AI lifecycle.
 *
 * Modeled after Claude Code's hooks. Hooks are loaded from:
 *   - Global:  ~/.onicode/hooks.json
 *   - Project: <projectDir>/.onicode/hooks.json
 *
 * Project-level hooks are merged over global hooks (per hook type).
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Constants ──

const GLOBAL_HOOKS_FILE = path.join(os.homedir(), '.onicode', 'hooks.json');

const HOOK_TYPES = [
    'PreToolUse',
    'PostToolUse',
    'Stop',
    'SubagentStop',
    'UserPromptSubmit',
    'Notification',
    'PreCompact',
    'SessionStart',
];

const DEFAULT_TIMEOUT = 10000; // 10 seconds

// ── Helpers ──

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Read a hooks.json file and return its `hooks` object, or empty object on failure.
 */
function readHooksFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) return {};
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return parsed.hooks || {};
    } catch {
        return {};
    }
}

/**
 * Write a hooks config to a file.
 */
function writeHooksFile(filePath, hooks) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify({ hooks }, null, 2));
}

// ── In-memory cache ──

let _cachedHooks = {};
let _lastProjectPath = null;

// ── Core API ──

/**
 * Load and merge global + project hooks.
 * Call this whenever the active project changes.
 *
 * @param {string} [projectPath] — active project directory (optional)
 * @returns {Object} merged hooks map  { HookType: [ ...entries ] }
 */
function loadHooks(projectPath) {
    const globalHooks = readHooksFile(GLOBAL_HOOKS_FILE);

    let projectHooks = {};
    if (projectPath) {
        const projectHooksFile = path.join(projectPath, '.onicode', 'hooks.json');
        projectHooks = readHooksFile(projectHooksFile);
    }

    // Merge: for each hook type, concatenate global then project entries.
    // Project entries come after global so they run last (and can override).
    const merged = {};
    for (const type of HOOK_TYPES) {
        const globalEntries = Array.isArray(globalHooks[type]) ? globalHooks[type] : [];
        const projectEntries = Array.isArray(projectHooks[type]) ? projectHooks[type] : [];
        if (globalEntries.length > 0 || projectEntries.length > 0) {
            merged[type] = [...globalEntries, ...projectEntries];
        }
    }

    _cachedHooks = merged;
    _lastProjectPath = projectPath || null;
    return merged;
}

/**
 * Execute all hooks for a given hook type.
 *
 * @param {string} hookType — one of HOOK_TYPES
 * @param {Object} context
 * @param {string} [context.projectDir]   — active project path
 * @param {string} [context.toolName]     — tool name (Pre/PostToolUse)
 * @param {Object} [context.toolInput]    — tool arguments (Pre/PostToolUse)
 * @param {Object} [context.toolOutput]   — tool result (PostToolUse only)
 * @param {string} [context.sessionId]    — current session ID
 * @returns {{ allowed: boolean, reason?: string, outputs: string[] }}
 */
function executeHook(hookType, context = {}) {
    if (!HOOK_TYPES.includes(hookType)) {
        return { allowed: true, outputs: [] };
    }

    const entries = _cachedHooks[hookType] || [];
    if (entries.length === 0) {
        return { allowed: true, outputs: [] };
    }

    // Build environment variables
    const env = {
        ...process.env,
        ONICODE_HOOK_TYPE: hookType,
        ONICODE_PROJECT_DIR: context.projectDir || '',
        ONICODE_SESSION_ID: context.sessionId || '',
        ONICODE_TOOL_NAME: context.toolName || '',
        ONICODE_TOOL_INPUT: context.toolInput ? JSON.stringify(context.toolInput) : '',
    };

    if (hookType === 'PostToolUse' && context.toolOutput !== undefined) {
        env.ONICODE_TOOL_OUTPUT = JSON.stringify(context.toolOutput);
    }

    const outputs = [];
    let allowed = true;
    let reason = null;

    for (const entry of entries) {
        // Matcher check: if a matcher is specified, test it against the tool name.
        // Only applies to Pre/PostToolUse hooks.
        if (entry.matcher && (hookType === 'PreToolUse' || hookType === 'PostToolUse')) {
            const toolName = context.toolName || '';
            try {
                const regex = new RegExp(entry.matcher);
                if (!regex.test(toolName)) {
                    continue; // skip this hook — tool doesn't match
                }
            } catch {
                // Invalid regex — skip this entry
                continue;
            }
        }

        if (!entry.command) {
            continue;
        }

        const timeout = entry.timeout || DEFAULT_TIMEOUT;
        const cwd = context.projectDir || os.homedir();

        try {
            const stdout = execSync(entry.command, {
                env,
                cwd,
                timeout,
                stdio: ['pipe', 'pipe', 'pipe'],
                encoding: 'utf-8',
                shell: true,
                maxBuffer: 1024 * 1024, // 1 MB
            });
            outputs.push((stdout || '').trim());
        } catch (err) {
            // Non-zero exit code
            const stderr = (err.stderr || '').trim();
            const stdout = (err.stdout || '').trim();

            if (stdout) outputs.push(stdout);

            // For PreToolUse, a non-zero exit means BLOCK the tool call
            if (hookType === 'PreToolUse') {
                allowed = false;
                reason = stderr || `Hook command failed: ${entry.command}`;
                break; // Stop processing further hooks — tool is blocked
            }

            // For other hook types, record the error but continue
            outputs.push(`[hook error] ${stderr || err.message}`);
        }
    }

    const result = { allowed, outputs };
    if (reason) result.reason = reason;
    return result;
}

/**
 * Return a human-readable summary of configured hooks for the AI system prompt.
 *
 * @returns {string}
 */
function getHooksSummary() {
    const lines = [];
    let totalCount = 0;

    for (const type of HOOK_TYPES) {
        const entries = _cachedHooks[type] || [];
        if (entries.length > 0) {
            totalCount += entries.length;
            const descriptions = entries.map((e) => {
                const matcher = e.matcher ? ` (matcher: ${e.matcher})` : '';
                return `  - \`${e.command}\`${matcher}`;
            });
            lines.push(`**${type}** (${entries.length} hook${entries.length > 1 ? 's' : ''}):`);
            lines.push(...descriptions);
        }
    }

    if (totalCount === 0) {
        return 'No hooks configured.';
    }

    return `${totalCount} hook${totalCount > 1 ? 's' : ''} configured:\n${lines.join('\n')}`;
}

// ── IPC Registration ──

/**
 * Register IPC handlers for hooks management.
 *
 * Channels:
 *   hooks-list    — returns { global, project, merged } hook configs
 *   hooks-save    — saves hooks to global or project file
 *   hooks-test    — runs a single hook command and returns output
 *
 * @param {Electron.IpcMain} ipcMain
 */
function registerHooksIPC(ipcMain) {
    // ── hooks-list ──
    ipcMain.handle('hooks-list', (_event, projectPath) => {
        const globalHooks = readHooksFile(GLOBAL_HOOKS_FILE);

        let projectHooks = {};
        if (projectPath) {
            const projectHooksFile = path.join(projectPath, '.onicode', 'hooks.json');
            projectHooks = readHooksFile(projectHooksFile);
        }

        const merged = loadHooks(projectPath);

        return {
            global: globalHooks,
            project: projectHooks,
            merged,
            hookTypes: HOOK_TYPES,
        };
    });

    // ── hooks-save ──
    ipcMain.handle('hooks-save', (_event, hooks, scope, projectPath) => {
        try {
            if (scope === 'project' && projectPath) {
                const projectHooksFile = path.join(projectPath, '.onicode', 'hooks.json');
                writeHooksFile(projectHooksFile, hooks);
            } else {
                writeHooksFile(GLOBAL_HOOKS_FILE, hooks);
            }

            // Reload cache
            loadHooks(projectPath || _lastProjectPath);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── hooks-test ──
    ipcMain.handle('hooks-test', (_event, { hookType, context, command: cmdOverride }) => {
        const command = cmdOverride;
        const testContext = {
            projectDir: context?.projectDir || os.homedir(),
            toolName: context?.toolName || 'test_tool',
            toolInput: context?.toolInput || {},
            toolOutput: context?.toolOutput || {},
            sessionId: context?.sessionId || 'test-session',
        };

        const env = {
            ...process.env,
            ONICODE_HOOK_TYPE: hookType || 'PreToolUse',
            ONICODE_PROJECT_DIR: testContext.projectDir,
            ONICODE_SESSION_ID: testContext.sessionId,
            ONICODE_TOOL_NAME: testContext.toolName,
            ONICODE_TOOL_INPUT: JSON.stringify(testContext.toolInput),
            ONICODE_TOOL_OUTPUT: JSON.stringify(testContext.toolOutput),
        };

        try {
            const stdout = execSync(command, {
                env,
                cwd: testContext.projectDir,
                timeout: DEFAULT_TIMEOUT,
                stdio: ['pipe', 'pipe', 'pipe'],
                encoding: 'utf-8',
                shell: true,
                maxBuffer: 1024 * 1024,
            });
            return { success: true, exitCode: 0, stdout: (stdout || '').trim(), stderr: '' };
        } catch (err) {
            return {
                success: false,
                exitCode: err.status || 1,
                stdout: (err.stdout || '').trim(),
                stderr: (err.stderr || '').trim(),
                error: err.message,
            };
        }
    });
}

// ── Exports ──

module.exports = {
    HOOK_TYPES,
    loadHooks,
    executeHook,
    getHooksSummary,
    registerHooksIPC,
};
