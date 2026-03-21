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
    browser_agent_run: 'ask',
    browser_get_elements: 'allow',
    browser_get_structure: 'allow',
    browser_extract_table: 'allow',
    browser_extract_links: 'allow',
    browser_fill_form: 'allow',
    browser_select: 'allow',
    browser_scroll: 'allow',
    browser_tab_open: 'allow',
    browser_tab_switch: 'allow',
    browser_tab_list: 'allow',
    browser_tab_close: 'allow',
    browser_status: 'allow',
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
    // LSP tools
    find_symbol: 'allow',
    find_references: 'allow',
    list_symbols: 'allow',
    get_type_info: 'allow',
    // Code index tools
    semantic_search: 'allow',
    index_codebase: 'allow',
    // GitHub & Google CLI tools
    git_create_pr: 'allow',
    git_list_prs: 'allow',
    git_publish: 'ask',
    gh_cli: 'allow',
    gws_cli: 'allow',
    // Context mode tools
    ctx_execute: 'allow',
    ctx_search: 'allow',
    ctx_index: 'allow',
    ctx_batch: 'allow',
    ctx_stats: 'allow',
    ctx_fetch: 'allow',
    // MCP catalog
    mcp_search: 'allow',
    // Widgets
    show_widget: 'allow',
};

let activePermissions = { ...DEFAULT_PERMISSIONS };
let agentMode = 'build'; // 'build' (full access) or 'plan' (read-only)

// Sync callback — set during registration so setAgentMode can push changes
let _syncPermissions = null;

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
    } catch { }
}

function setAgentMode(mode) {
    agentMode = mode;
    if (mode === 'plan') {
        // Plan mode: deny all writes, ask for commands
        activePermissions = { ...DEFAULT_PERMISSIONS };
        activePermissions.edit_file = 'deny';
        activePermissions.create_file = 'deny';
        activePermissions.delete_file = 'deny';
        activePermissions.multi_edit = 'deny';
        activePermissions.run_command = 'ask';
        activePermissions.init_project = 'deny';
    } else if (mode === 'ask-destructive') {
        // Ask-destructive mode: allow everything except destructive ops
        activePermissions = { ...DEFAULT_PERMISSIONS };
        activePermissions.delete_file = 'ask';
        activePermissions.restore_to_point = 'ask';
        activePermissions.run_command = 'ask'; // commands checked individually
    } else {
        // Auto-allow / build mode: everything allowed
        activePermissions = { ...DEFAULT_PERMISSIONS };
    }
    // Sync to aiTools module + notify renderer
    if (_syncPermissions) _syncPermissions(activePermissions, mode);
    logger.info('agent-mode', `Switched to ${mode} mode`);
}

function checkPermission(toolName) {
    return activePermissions[toolName] || 'allow';
}

// ══════════════════════════════════════════
//  Settings
// ══════════════════════════════════════════

const SETTINGS_PATH = path.join(os.homedir(), '.onicode', 'settings.json');

// Default settings
const _settings = {
    'dangerous-cmd-protection': true,
    'auto-commit': true,
    'permission-mode': 'auto-allow',
    'panel-mode': 'always',
    'font-size': 13,
    'chat-history-limit': 50,
    'default-project-path': path.join(os.homedir(), 'OniProjects'),
    'show-tool-details': true,
    'auto-title': true,
    'send-on-enter': true,
    'notifications': true,
    'compact-threshold': 60000,
    'max-auto-continues': 15,
};

// Load persisted settings on startup
try {
    if (fs.existsSync(SETTINGS_PATH)) {
        const saved = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
        Object.assign(_settings, saved);
        logger.info('settings', `Loaded settings from ${SETTINGS_PATH}`);
    }
} catch (err) {
    logger.warn('settings', `Failed to load settings: ${err.message}`);
}

function persistSettings() {
    try {
        const dir = path.dirname(SETTINGS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(_settings, null, 2), 'utf-8');
    } catch (err) {
        logger.warn('settings', `Failed to persist settings: ${err.message}`);
    }
}

// Backward-compat aliases
let dangerousCommandProtection = _settings['dangerous-cmd-protection'];
let autoCommitEnabled = _settings['auto-commit'];

function isDangerousProtectionEnabled() { return dangerousCommandProtection; }
function isAutoCommitEnabled() { return autoCommitEnabled; }

// ══════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════

function registerPermissionsIPC(deps) {
    const { ipcMain, syncPermissions } = deps;
    _syncPermissions = syncPermissions;

    // Restore permission mode on startup (now that syncPermissions is available)
    if (_settings['permission-mode'] && _settings['permission-mode'] !== 'auto-allow') {
        setAgentMode(_settings['permission-mode'] === 'plan-only' ? 'plan' : _settings['permission-mode']);
    }

    ipcMain.handle('agent-set-mode', (_, mode) => {
        setAgentMode(mode);
        return { success: true, mode };
    });

    ipcMain.handle('agent-get-mode', () => {
        return { mode: agentMode, permissions: activePermissions };
    });

    ipcMain.handle('set-setting', (_, key, value) => {
        _settings[key] = value;
        persistSettings();
        // Keep backward-compat vars in sync
        if (key === 'dangerous-cmd-protection') dangerousCommandProtection = !!value;
        if (key === 'auto-commit') autoCommitEnabled = !!value;
        if (key === 'permission-mode') {
            const modeMap = { 'auto-allow': 'build', 'ask-destructive': 'ask-destructive', 'plan-only': 'plan' };
            setAgentMode(modeMap[value] || 'build');
        }
        logger.info('settings', `Setting "${key}" = ${JSON.stringify(value)}`);
        return { success: true };
    });

    ipcMain.handle('get-setting', (_, key) => {
        return key ? _settings[key] : { ..._settings };
    });

    ipcMain.handle('get-all-settings', () => {
        return { ..._settings };
    });
}

module.exports = {
    registerPermissionsIPC,
    DEFAULT_PERMISSIONS,
    loadProjectPermissions,
    setAgentMode,
    checkPermission,
    isDangerousProtectionEnabled,
    isAutoCommitEnabled,
    getActivePermissions: () => activePermissions,
    getAgentMode: () => agentMode,
};
