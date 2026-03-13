/**
 * Permissions system + settings management.
 * Extracted from index.js for modularity.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { logger } = require('../logger');

// ══════════════════════════════════════════
//  Permissions System
// ══════════════════════════════════════════

const DEFAULT_PERMISSIONS = {
    read_file: 'allow',
    edit_file: 'allow',
    create_file: 'allow',
    delete_file: 'allow',
    multi_edit: 'allow',
    run_command: 'allow',
    check_terminal: 'allow',
    list_terminals: 'allow',
    search_files: 'allow',
    list_directory: 'allow',
    glob_files: 'allow',
    explore_codebase: 'allow',
    webfetch: 'allow',
    websearch: 'allow',
    browser_navigate: 'allow',
    browser_screenshot: 'allow',
    browser_evaluate: 'allow',
    browser_click: 'allow',
    browser_type: 'allow',
    browser_console_logs: 'allow',
    browser_close: 'allow',
    task_add: 'allow',
    task_update: 'allow',
    task_list: 'allow',
    milestone_create: 'allow',
    create_plan: 'allow',
    update_plan: 'allow',
    get_plan: 'allow',
    init_project: 'allow',
    memory_read: 'allow',
    memory_write: 'allow',
    memory_append: 'allow',
    memory_search: 'allow',
    memory_save_fact: 'allow',
    memory_smart_search: 'allow',
    memory_get_related: 'allow',
    memory_hot_list: 'allow',
    conversation_search: 'allow',
    conversation_recall: 'allow',
    get_context_summary: 'allow',
    spawn_sub_agent: 'allow',
    orchestrate: 'allow',
    spawn_specialist: 'allow',
    get_orchestration_status: 'allow',
    get_agent_status: 'allow',
    verify_project: 'allow',
    ask_user_question: 'allow',
    sequential_thinking: 'allow',
    trajectory_search: 'allow',
    find_by_name: 'allow',
    read_url_content: 'allow',
    view_content_chunk: 'allow',
    read_notebook: 'allow',
    edit_notebook: 'allow',
    read_deployment_config: 'allow',
    deploy_web_app: 'ask',
    check_deploy_status: 'allow',
    get_system_logs: 'allow',
    get_changelog: 'allow',
    git_diff: 'allow',
    git_log: 'allow',
    git_branches: 'allow',
    git_checkout: 'allow',
    git_stash: 'allow',
    git_pull: 'allow',
    find_symbol: 'allow',
    find_references: 'allow',
    list_symbols: 'allow',
    get_type_info: 'allow',
    semantic_search: 'allow',
    index_codebase: 'allow',
    git_create_pr: 'allow',
    git_list_prs: 'allow',
    git_publish: 'ask',
    gh_cli: 'allow',
    gws_cli: 'allow',
};

let activePermissions = { ...DEFAULT_PERMISSIONS };
let agentMode = 'build';
let dangerousCommandProtection = true;
let autoCommitEnabled = true;

function loadProjectPermissions(projectPath) {
    try {
        const configPath = path.join(projectPath, '.onicode', 'config.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (config.permissions) {
                activePermissions = { ...DEFAULT_PERMISSIONS, ...config.permissions };
                logger.info('permissions', `Loaded project permissions from ${configPath}`);
            }
        }
    } catch (err) {
        logger.warn('permissions', `Failed to load project permissions: ${err.message}`);
    }
}

function setAgentMode(mode) {
    agentMode = mode;
    if (mode === 'plan') {
        const readOnlyPerms = { ...DEFAULT_PERMISSIONS };
        Object.keys(readOnlyPerms).forEach(tool => {
            if (!['read_file', 'search_files', 'list_directory', 'glob_files', 'explore_codebase',
                'task_list', 'get_plan', 'memory_read', 'memory_search', 'conversation_search',
                'conversation_recall', 'get_context_summary', 'ask_user_question',
                'sequential_thinking', 'trajectory_search', 'find_by_name',
                'read_url_content', 'view_content_chunk', 'read_notebook',
                'get_system_logs', 'get_changelog', 'git_diff', 'git_log', 'git_branches',
                'find_symbol', 'find_references', 'list_symbols', 'get_type_info',
                'semantic_search', 'index_codebase', 'memory_smart_search',
                'memory_get_related', 'memory_hot_list',
            ].includes(tool)) {
                readOnlyPerms[tool] = 'deny';
            }
        });
        activePermissions = readOnlyPerms;
    } else {
        activePermissions = { ...DEFAULT_PERMISSIONS };
    }
}

function checkPermission(toolName) {
    return activePermissions[toolName] || 'allow';
}

function isDangerousProtectionEnabled() { return dangerousCommandProtection; }
function isAutoCommitEnabled() { return autoCommitEnabled; }

// ══════════════════════════════════════════
//  Settings
// ══════════════════════════════════════════

const SETTINGS_PATH = path.join(os.homedir(), '.onicode', 'settings.json');

const _settings = {
    'permission-mode': 'auto-allow',
    'dangerous-cmd-protection': true,
    'auto-commit': true,
    'font-size': 13,
    'chat-history-limit': 50,
    'default-project-path': '~/OniProjects',
    'show-tool-details': true,
    'auto-title': true,
    'send-on-enter': true,
    'notifications': true,
    'max-auto-continues': 15,
    'compact-threshold': 60000,
    'panel-mode': 'always',
};

// Load persisted settings from disk
try {
    if (fs.existsSync(SETTINGS_PATH)) {
        const saved = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
        Object.assign(_settings, saved);
        dangerousCommandProtection = _settings['dangerous-cmd-protection'];
        autoCommitEnabled = _settings['auto-commit'];
    }
} catch {}

function persistSettings() {
    try {
        const dir = path.dirname(SETTINGS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(_settings, null, 2), 'utf-8');
    } catch (err) {
        logger.warn('settings', `Failed to persist settings: ${err.message}`);
    }
}

// ══════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════

function registerPermissionsIPC(deps) {
    const { ipcMain, syncPermissions } = deps;

    ipcMain.handle('agent-set-mode', (_, mode) => {
        setAgentMode(mode);
        syncPermissions();
        return { success: true, mode: agentMode };
    });

    ipcMain.handle('agent-get-mode', () => {
        return { mode: agentMode, permissions: activePermissions };
    });

    ipcMain.handle('set-setting', (_, key, value) => {
        if (key in _settings) {
            _settings[key] = value;
            persistSettings();
            if (key === 'dangerous-cmd-protection') dangerousCommandProtection = !!value;
            if (key === 'auto-commit') autoCommitEnabled = !!value;
            return { success: true };
        }
        return { error: `Unknown setting: ${key}` };
    });

    ipcMain.handle('get-setting', (_, key) => {
        return { value: _settings[key] };
    });

    ipcMain.handle('get-all-settings', () => {
        return { ..._settings };
    });
}

module.exports = {
    registerPermissionsIPC,
    DEFAULT_PERMISSIONS,
    activePermissions,
    agentMode,
    loadProjectPermissions,
    setAgentMode,
    checkPermission,
    isDangerousProtectionEnabled,
    isAutoCommitEnabled,
    getActivePermissions: () => activePermissions,
    getAgentMode: () => agentMode,
};
