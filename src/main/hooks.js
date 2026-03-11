/**
 * Hooks System — Lifecycle hooks for tool calls, commits, tests, sessions, and AI responses.
 *
 * Hooks are shell commands that execute at specific lifecycle points.
 * They can block operations (PreToolUse, PreCommit) or log/react (PostToolUse, OnTestFailure).
 *
 * Storage:
 *   - Global:  ~/.onicode/hooks.json
 *   - Project: <projectDir>/.onicode/hooks.json
 *   - Project hooks merge over global hooks (run last, can override).
 *
 * Environment variables available to all hooks:
 *   ONICODE_HOOK_TYPE     — The hook type (e.g. PreToolUse)
 *   ONICODE_PROJECT_DIR   — Active project directory
 *   ONICODE_SESSION_ID    — Current session ID
 *   ONICODE_TOOL_NAME     — Tool name (Pre/PostToolUse, ToolError, OnDangerousCommand)
 *   ONICODE_TOOL_INPUT    — JSON-encoded tool arguments
 *   ONICODE_TOOL_OUTPUT   — JSON-encoded tool result (PostToolUse only)
 *   ONICODE_ERROR         — Error message (ToolError, OnTestFailure)
 *   ONICODE_COMMIT_MSG    — Commit message (PreCommit, PostCommit)
 *   ONICODE_FILE_PATH     — File path (PreEdit, PostEdit)
 *   ONICODE_TASK_CONTENT  — Task content (OnTaskComplete)
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ══════════════════════════════════════════
//  Constants
// ══════════════════════════════════════════

const GLOBAL_HOOKS_FILE = path.join(os.homedir(), '.onicode', 'hooks.json');

const HOOK_TYPES = [
    // Tool lifecycle
    'PreToolUse',          // Before any tool call — can BLOCK (exit non-zero)
    'PostToolUse',         // After any tool call completes
    'ToolError',           // When a tool call fails/errors

    // File operations
    'PreEdit',             // Before editing a file — can BLOCK
    'PostEdit',            // After a file is edited (run linter, tests, etc.)

    // Command execution
    'PreCommand',          // Before run_command — can BLOCK
    'PostCommand',         // After run_command completes
    'OnDangerousCommand',  // When a potentially destructive command is detected — can BLOCK

    // Git / Version Control
    'PreCommit',           // Before git commit — can BLOCK (run lint, typecheck, format)
    'PostCommit',          // After git commit succeeds

    // Testing
    'OnTestFailure',       // When a test command fails (exit code != 0)

    // Task management
    'OnTaskComplete',      // When a task is marked as done

    // AI lifecycle
    'SessionStart',        // When a new AI session begins
    'AIResponse',          // After the AI finishes responding
    'PreCompact',          // Before context compaction

    // Agent
    'Stop',                // When the AI stops working
    'SubagentStop',        // When a sub-agent completes

    // User input
    'UserPromptSubmit',    // When user submits a message (before AI sees it)
    'Notification',        // When a notification is triggered
];

// Commands that are potentially dangerous — matched against run_command args
const DANGEROUS_PATTERNS = [
    /rm\s+(-rf?|--recursive)\s/,
    /rm\s+-[a-zA-Z]*f/,
    /rmdir\s/,
    /git\s+(reset\s+--hard|clean\s+-f|push\s+--force|push\s+-f|checkout\s+--\s+\.|branch\s+-D)/,
    /drop\s+(table|database)\s/i,
    /truncate\s+table\s/i,
    /DELETE\s+FROM\s+\w+\s*;?\s*$/i,
    /:(){ :\|:& };:/,
    /mkfs\./,
    /dd\s+if=/,
    /chmod\s+-R\s+777/,
    /npm\s+unpublish/,
    /curl\s+.*\|\s*(bash|sh|zsh)/,
    /wget\s+.*\|\s*(bash|sh|zsh)/,
    /kill\s+-9\s+(-1|1)\b/,
    /pkill\s+-9/,
    /npm\s+publish\b/,
    /docker\s+(rm|rmi|system\s+prune|volume\s+prune)/,
    /kubectl\s+delete/,
    /heroku\s+destroy/,
    /firebase\s+delete/,
    /aws\s+s3\s+rm.*--recursive/,
    /git\s+rebase\s+--abort/,
    /env\s*>\s*\/dev/,
    />\s*\/dev\/(sda|hda|nvme)/,
];

// ══════════════════════════════════════════
//  Hook Presets (starter templates)
// ══════════════════════════════════════════

const HOOK_PRESETS = {
    'lint-on-commit': {
        name: 'Lint Before Commit',
        description: 'Run linter and typecheck before every git commit',
        hooks: {
            PreCommit: [{ command: 'npm run lint && npx tsc --noEmit' }],
        },
    },
    'format-on-edit': {
        name: 'Auto-Format After Edit',
        description: 'Run Prettier on edited files',
        hooks: {
            PostEdit: [{ command: 'npx prettier --write "$ONICODE_FILE_PATH"', matcher: '\\.(tsx?|jsx?|css|json|md)$' }],
        },
    },
    'test-on-edit': {
        name: 'Run Tests After Edit',
        description: 'Run related tests when source files change',
        hooks: {
            PostEdit: [{ command: 'npx jest --findRelatedTests "$ONICODE_FILE_PATH" --passWithNoTests 2>&1 | tail -5', matcher: '\\.(tsx?|jsx?)$' }],
        },
    },
    'block-dangerous': {
        name: 'Block All Dangerous Commands',
        description: 'Prevent destructive shell commands from executing',
        hooks: {
            OnDangerousCommand: [{ command: 'echo "BLOCKED: $ONICODE_COMMAND" && exit 1' }],
        },
    },
    'changelog-on-commit': {
        name: 'Update Changelog on Commit',
        description: 'Append commit message to onidocs/changelog.md after each commit',
        hooks: {
            PostCommit: [{ command: 'echo "- $(date +%Y-%m-%d): $ONICODE_COMMIT_MSG" >> onidocs/changelog.md' }],
        },
    },
    'notify-on-complete': {
        name: 'Notify on Task Complete',
        description: 'Show macOS notification when AI finishes a task',
        hooks: {
            OnTaskComplete: [{ command: 'osascript -e \'display notification "$ONICODE_TASK_CONTENT" with title "Onicode — Task Done"\'' }],
        },
    },
    'typecheck-ts': {
        name: 'TypeScript Check on Edit',
        description: 'Run tsc after editing TypeScript files',
        hooks: {
            PostEdit: [{ command: 'npx tsc --noEmit 2>&1 | head -20', matcher: '\\.tsx?$' }],
        },
    },
    'prisma-validate': {
        name: 'Prisma Validate on Schema Change',
        description: 'Validate Prisma schema after editing migration/schema files',
        hooks: {
            PostEdit: [{ command: 'npx prisma validate', matcher: 'schema|migration|prisma' }],
        },
    },
};

const DEFAULT_TIMEOUT = 10000; // 10 seconds

// ══════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

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

function writeHooksFile(filePath, hooks) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify({ hooks }, null, 2));
}

// ══════════════════════════════════════════
//  In-memory cache
// ══════════════════════════════════════════

let _cachedHooks = {};
let _lastProjectPath = null;
let _mainWindow = null;

function setMainWindow(win) {
    _mainWindow = win;
}

function notifyHookExecution(hookType, result, context) {
    if (_mainWindow?.webContents) {
        _mainWindow.webContents.send('hook-executed', {
            hookType,
            allowed: result.allowed,
            reason: result.reason,
            outputs: result.outputs,
            toolName: context?.toolName,
            timestamp: Date.now(),
        });
    }
}

// ══════════════════════════════════════════
//  Core API
// ══════════════════════════════════════════

/**
 * Load and merge global + project hooks.
 * Call this on app start and whenever the active project changes.
 */
function loadHooks(projectPath) {
    const globalHooks = readHooksFile(GLOBAL_HOOKS_FILE);

    let projectHooks = {};
    if (projectPath) {
        const projectHooksFile = path.join(projectPath, '.onicode', 'hooks.json');
        projectHooks = readHooksFile(projectHooksFile);
    }

    // Merge: for each hook type, concatenate global then project entries.
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
 * For PreToolUse, PreEdit, PreCommand, OnDangerousCommand, PreCommit:
 *   Non-zero exit = BLOCKS the operation. Returns { allowed: false, reason: "..." }
 *
 * For all other hooks:
 *   Non-zero exit = logged but does not block. Returns { allowed: true }
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

    // Type-specific env vars
    if (context.toolOutput !== undefined) {
        const outputStr = typeof context.toolOutput === 'string' ? context.toolOutput : JSON.stringify(context.toolOutput);
        env.ONICODE_TOOL_OUTPUT = outputStr.slice(0, 50000); // Cap at 50KB
    }
    if (context.error) env.ONICODE_ERROR = context.error;
    if (context.commitMsg) env.ONICODE_COMMIT_MSG = context.commitMsg;
    if (context.filePath) env.ONICODE_FILE_PATH = context.filePath;
    if (context.taskContent) env.ONICODE_TASK_CONTENT = context.taskContent;
    if (context.command) env.ONICODE_COMMAND = context.command;
    if (context.exitCode !== undefined) env.ONICODE_EXIT_CODE = String(context.exitCode);

    const outputs = [];
    let allowed = true;
    let reason = null;

    // These hook types can BLOCK operations
    const blockingHooks = ['PreToolUse', 'PreEdit', 'PreCommand', 'OnDangerousCommand', 'PreCommit', 'UserPromptSubmit'];

    for (const entry of entries) {
        // Matcher check: if a matcher regex is specified, test against tool/command name
        if (entry.matcher) {
            const matchTarget = context.toolName || context.command || '';
            try {
                const regex = new RegExp(entry.matcher);
                if (!regex.test(matchTarget)) {
                    continue; // skip — doesn't match
                }
            } catch {
                continue; // invalid regex — skip
            }
        }

        if (!entry.command) continue;

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
                maxBuffer: 1024 * 1024,
            });
            outputs.push((stdout || '').trim());
        } catch (err) {
            const stderr = (err.stderr || '').trim();
            const stdout = (err.stdout || '').trim();

            if (stdout) outputs.push(stdout);

            // For blocking hooks, non-zero exit = BLOCK
            if (blockingHooks.includes(hookType)) {
                allowed = false;
                reason = stderr || stdout || `Hook blocked: ${entry.command}`;
                break;
            }

            // For non-blocking hooks, record error and continue
            outputs.push(`[hook error] ${stderr || err.message}`);
        }
    }

    const result = { allowed, outputs };
    if (reason) result.reason = reason;

    // Notify renderer about hook execution (for UI logging)
    notifyHookExecution(hookType, result, context);

    return result;
}

/**
 * Check if a command is dangerous (matches known destructive patterns).
 * Returns the matched pattern description or null.
 */
function isDangerousCommand(command) {
    if (!command || typeof command !== 'string') return null;
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(command)) {
            return pattern.toString();
        }
    }
    return null;
}

/**
 * Execute hooks asynchronously (non-blocking, parallel).
 * Used for non-blocking hooks like PostEdit, PostCommand, etc.
 * Returns immediately with a placeholder result, fires hooks in background.
 */
function executeHookAsync(hookType, context = {}) {
    if (!HOOK_TYPES.includes(hookType)) return;

    const entries = _cachedHooks[hookType] || [];
    if (entries.length === 0) return;

    // Non-blocking hooks that can run async
    const asyncSafeHooks = ['PostToolUse', 'PostEdit', 'PostCommand', 'PostCommit', 'OnTestFailure',
        'OnTaskComplete', 'AIResponse', 'Stop', 'SubagentStop', 'Notification'];

    if (!asyncSafeHooks.includes(hookType)) {
        // For blocking hooks, fall back to sync execution
        return executeHook(hookType, context);
    }

    // Fire and forget
    setImmediate(() => {
        const result = executeHook(hookType, context);
        // Log errors from async hooks
        if (result.outputs) {
            for (const out of result.outputs) {
                if (out.startsWith('[hook error]')) {
                    const { logger } = require('./logger');
                    logger.warn('hooks', `Async hook ${hookType}: ${out}`);
                }
            }
        }
    });
}

/**
 * Return a human-readable summary of configured hooks for the AI system prompt.
 */
function getHooksSummary() {
    const lines = [];
    let totalCount = 0;

    for (const type of HOOK_TYPES) {
        const entries = _cachedHooks[type] || [];
        if (entries.length > 0) {
            totalCount += entries.length;
            const descriptions = entries.map((e) => {
                const matcher = e.matcher ? ` (match: /${e.matcher}/)` : '';
                return `  - \`${e.command}\`${matcher}`;
            });
            lines.push(`**${type}** (${entries.length} hook${entries.length > 1 ? 's' : ''}):`);
            lines.push(...descriptions);
        }
    }

    if (totalCount === 0) {
        return '';
    }

    return `${totalCount} hook${totalCount > 1 ? 's' : ''} configured:\n${lines.join('\n')}`;
}

/**
 * Get structured hook info for the settings UI.
 */
function getHooksInfo() {
    const info = {};
    for (const type of HOOK_TYPES) {
        info[type] = {
            entries: _cachedHooks[type] || [],
            blocking: ['PreToolUse', 'PreEdit', 'PreCommand', 'OnDangerousCommand', 'PreCommit', 'UserPromptSubmit'].includes(type),
            description: HOOK_DESCRIPTIONS[type] || '',
        };
    }
    return info;
}

// ══════════════════════════════════════════
//  Hook Type Descriptions (for UI)
// ══════════════════════════════════════════

const HOOK_DESCRIPTIONS = {
    PreToolUse:          'Runs before any AI tool call. Exit non-zero to BLOCK the tool.',
    PostToolUse:         'Runs after any AI tool call completes successfully.',
    ToolError:           'Runs when a tool call fails or errors.',
    PreEdit:             'Runs before the AI edits a file. Exit non-zero to BLOCK. Use matcher for file patterns.',
    PostEdit:            'Runs after a file is edited. Great for auto-linting, formatting, or running tests.',
    PreCommand:          'Runs before the AI executes a shell command. Exit non-zero to BLOCK.',
    PostCommand:         'Runs after a shell command completes. Check exit codes, run follow-up actions.',
    OnDangerousCommand:  'Runs when a potentially destructive command is detected (rm -rf, git reset --hard, etc.). Exit non-zero to BLOCK.',
    PreCommit:           'Runs before a git commit. Exit non-zero to BLOCK. Great for lint + typecheck + format.',
    PostCommit:          'Runs after a git commit succeeds. Push notifications, CI triggers.',
    OnTestFailure:       'Runs when a test command exits with a non-zero code.',
    OnTaskComplete:      'Runs when the AI marks a task as done.',
    SessionStart:        'Runs when a new AI coding session begins.',
    AIResponse:          'Runs after the AI finishes a full response (all tool rounds complete).',
    PreCompact:          'Runs before context compaction happens.',
    Stop:                'Runs when the AI stops working on the current request.',
    SubagentStop:        'Runs when a sub-agent completes its task.',
    UserPromptSubmit:    'Runs when the user submits a message. Exit non-zero to BLOCK submission.',
    Notification:        'Runs when a notification event is triggered.',
};

// ══════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════

function registerHooksIPC(ipcMain) {
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
            descriptions: HOOK_DESCRIPTIONS,
        };
    });

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

    // List available presets
    ipcMain.handle('hooks-presets', () => {
        return Object.entries(HOOK_PRESETS).map(([id, preset]) => ({
            id,
            name: preset.name,
            description: preset.description,
            hookTypes: Object.keys(preset.hooks),
        }));
    });

    // Apply a preset (merge into current hooks)
    ipcMain.handle('hooks-apply-preset', async (_event, presetId, scope = 'global', projectPath) => {
        const preset = HOOK_PRESETS[presetId];
        if (!preset) return { success: false, error: `Unknown preset: ${presetId}` };

        try {
            let filePath;
            if (scope === 'project' && projectPath) {
                filePath = path.join(projectPath, '.onicode', 'hooks.json');
            } else {
                filePath = GLOBAL_HOOKS_FILE;
            }

            const existing = readHooksFile(filePath);
            const merged = { ...existing };

            for (const [type, entries] of Object.entries(preset.hooks)) {
                if (!merged[type]) merged[type] = [];
                // Avoid duplicates
                for (const entry of entries) {
                    const isDuplicate = merged[type].some(e => e.command === entry.command && e.matcher === entry.matcher);
                    if (!isDuplicate) merged[type].push(entry);
                }
            }

            writeHooksFile(filePath, merged);
            loadHooks(projectPath || _lastProjectPath);
            return { success: true, preset: preset.name };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

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

// ══════════════════════════════════════════
//  Exports
// ══════════════════════════════════════════

module.exports = {
    HOOK_TYPES,
    HOOK_DESCRIPTIONS,
    HOOK_PRESETS,
    loadHooks,
    executeHook,
    executeHookAsync,
    isDangerousCommand,
    getHooksSummary,
    getHooksInfo,
    registerHooksIPC,
    setMainWindow: setMainWindow,
};
