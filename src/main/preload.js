const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('onicode', {
    // App info
    getAppInfo: () => ipcRenderer.invoke('get-app-info'),

    // Theme
    getTheme: () => ipcRenderer.invoke('get-theme'),
    setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),

    // AI Chat — streaming through main process
    sendMessage: (messages, providerConfig) =>
        ipcRenderer.invoke('ai-send-message', messages, providerConfig),

    onStreamChunk: (callback) => {
        const handler = (_event, chunk) => callback(chunk);
        ipcRenderer.on('ai-stream-chunk', handler);
        return () => ipcRenderer.removeListener('ai-stream-chunk', handler);
    },

    onStreamDone: (callback) => {
        const handler = (_event, error) => callback(error);
        ipcRenderer.on('ai-stream-done', handler);
        return () => ipcRenderer.removeListener('ai-stream-done', handler);
    },

    abortAI: () => ipcRenderer.invoke('ai-abort'),

    // AI Agentic Events — tool calls, results, agent steps
    onToolCall: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('ai-tool-call', handler);
        return () => ipcRenderer.removeListener('ai-tool-call', handler);
    },

    onToolResult: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('ai-tool-result', handler);
        return () => ipcRenderer.removeListener('ai-tool-result', handler);
    },

    // Open external URL or file path
    openExternal: (url) => ipcRenderer.invoke('open-external', url),

    onAgentStep: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('ai-agent-step', handler);
        return () => ipcRenderer.removeListener('ai-agent-step', handler);
    },

    // Agent & process runtime
    listAgents: () => ipcRenderer.invoke('list-agents'),
    listBackgroundProcesses: () => ipcRenderer.invoke('list-background-processes'),
    killBackgroundProcess: (processId) => ipcRenderer.invoke('kill-background-process', processId),
    readFileContent: (filePath) => ipcRenderer.invoke('read-file-content', filePath),

    // Task management (extends existing tasksList + onTasksUpdated)
    listProjectTasks: (projectPath) => ipcRenderer.invoke('list-project-tasks', projectPath),
    archiveCompletedTasks: () => ipcRenderer.invoke('archive-completed-tasks'),

    onPanelOpen: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('ai-panel-open', handler);
        return () => ipcRenderer.removeListener('ai-panel-open', handler);
    },

    onTerminalSession: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('ai-terminal-session', handler);
        return () => ipcRenderer.removeListener('ai-terminal-session', handler);
    },

    onAITerminalOutput: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('ai-terminal-output', handler);
        return () => ipcRenderer.removeListener('ai-terminal-output', handler);
    },

    // Codex OAuth — PKCE in main, paste-redirect flow
    codexOAuthGetAuthUrl: () => ipcRenderer.invoke('codex-oauth-get-auth-url'),
    codexOAuthExchange: (redirectUrl) => ipcRenderer.invoke('codex-oauth-exchange', redirectUrl),
    codexOAuthCancel: () => ipcRenderer.invoke('codex-oauth-cancel'),

    // Test provider connection through main process (no CORS)
    testProvider: (providerConfig) =>
        ipcRenderer.invoke('test-provider', providerConfig),

    // ── Terminal ──
    createTerminal: (cwd) => ipcRenderer.invoke('terminal-create', cwd),
    writeTerminal: (sessionId, data) => ipcRenderer.invoke('terminal-write', sessionId, data),
    killTerminal: (sessionId) => ipcRenderer.invoke('terminal-kill', sessionId),
    terminalStatus: (sessionId) => ipcRenderer.invoke('terminal-status', sessionId),
    terminalExec: (command, cwd) => ipcRenderer.invoke('terminal-exec', command, cwd),

    onTerminalOutput: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('terminal-output', handler);
        return () => ipcRenderer.removeListener('terminal-output', handler);
    },

    onTerminalExit: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('terminal-exit', handler);
        return () => ipcRenderer.removeListener('terminal-exit', handler);
    },

    // ── Projects ──
    initProject: (opts) => ipcRenderer.invoke('project-init', opts),
    scanProject: (folderPath) => ipcRenderer.invoke('project-scan', folderPath),
    listProjects: () => ipcRenderer.invoke('project-list'),
    getProject: (projectId) => ipcRenderer.invoke('project-get', projectId),
    deleteProject: (projectId) => ipcRenderer.invoke('project-delete', projectId),
    openProjectIn: (projectPath, editor) => ipcRenderer.invoke('project-open-in', projectPath, editor),

    // ── File System ──
    readDir: (dirPath, maxDepth) => ipcRenderer.invoke('fs-read-dir', dirPath, maxDepth),
    readFile: (filePath) => ipcRenderer.invoke('fs-read-file', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('fs-write-file', filePath, content),

    // ── Connectors ──
    connectorList: () => ipcRenderer.invoke('connector-list'),
    connectorGet: (connectorId) => ipcRenderer.invoke('connector-get', connectorId),
    connectorDisconnect: (connectorId) => ipcRenderer.invoke('connector-disconnect', connectorId),
    connectorGithubStart: () => ipcRenderer.invoke('connector-github-start'),
    connectorGithubPoll: (deviceCode, interval) => ipcRenderer.invoke('connector-github-poll', deviceCode, interval),
    connectorGithubCancel: () => ipcRenderer.invoke('connector-github-cancel'),
    connectorGoogleStart: () => ipcRenderer.invoke('connector-google-start'),
    connectorGoogleCancel: () => ipcRenderer.invoke('connector-google-cancel'),
    onConnectorGoogleResult: (callback) => {
        const handler = (_event, result) => callback(result);
        ipcRenderer.on('connector-google-result', handler);
        return () => ipcRenderer.removeListener('connector-google-result', handler);
    },

    // ── Memory ──
    memoryLoadCore: (projectId) => ipcRenderer.invoke('memory-load-core', projectId),
    memoryEnsureDefaults: () => ipcRenderer.invoke('memory-ensure-defaults'),
    memorySaveOnboarding: (answers) => ipcRenderer.invoke('memory-save-onboarding', answers),
    memoryRead: (filename) => ipcRenderer.invoke('memory-read', filename),
    memoryWrite: (filename, content) => ipcRenderer.invoke('memory-write', filename, content),
    memoryAppend: (filename, content) => ipcRenderer.invoke('memory-append', filename, content),
    memoryList: () => ipcRenderer.invoke('memory-list'),
    memoryDelete: (filename) => ipcRenderer.invoke('memory-delete', filename),
    memoryCompact: (messages, keepRecent) => ipcRenderer.invoke('memory-compact', messages, keepRecent),

    // Project-scoped memory
    memoryProjectRead: (projectId) => ipcRenderer.invoke('memory-project-read', projectId),
    memoryProjectWrite: (projectId, content) => ipcRenderer.invoke('memory-project-write', projectId, content),
    memoryProjectAppend: (projectId, content) => ipcRenderer.invoke('memory-project-append', projectId, content),

    // Memory change notifications (for UI sync)
    onMemoryChanged: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('memory-changed', handler);
        return () => ipcRenderer.removeListener('memory-changed', handler);
    },

    // ── Browser / Puppeteer ──
    browserLaunch: (opts) => ipcRenderer.invoke('browser-launch', opts),
    browserClose: () => ipcRenderer.invoke('browser-close'),
    browserNavigate: (url, opts) => ipcRenderer.invoke('browser-navigate', url, opts),
    browserScreenshot: (opts) => ipcRenderer.invoke('browser-screenshot', opts),
    browserEvaluate: (script) => ipcRenderer.invoke('browser-evaluate', script),
    browserClick: (selector) => ipcRenderer.invoke('browser-click', selector),
    browserType: (selector, text) => ipcRenderer.invoke('browser-type', selector, text),
    browserWait: (selector, opts) => ipcRenderer.invoke('browser-wait', selector, opts),
    browserContent: () => ipcRenderer.invoke('browser-content'),
    browserConsoleLogs: (opts) => ipcRenderer.invoke('browser-console-logs', opts),
    browserConsoleClear: () => ipcRenderer.invoke('browser-console-clear'),

    // ── Conversations (SQLite) ──
    conversationSave: (conv) => ipcRenderer.invoke('conversation-save', conv),
    conversationGet: (id) => ipcRenderer.invoke('conversation-get', id),
    conversationList: (limit, offset) => ipcRenderer.invoke('conversation-list', limit, offset),
    conversationDelete: (id) => ipcRenderer.invoke('conversation-delete', id),
    conversationSearch: (query) => ipcRenderer.invoke('conversation-search', query),
    conversationMigrate: (conversations) => ipcRenderer.invoke('conversation-migrate', conversations),

    // ── Logger ──
    loggerGetRecent: (opts) => ipcRenderer.invoke('logger-get-recent', opts),
    loggerReadDay: (date) => ipcRenderer.invoke('logger-read-day', date),
    loggerListFiles: () => ipcRenderer.invoke('logger-list-files'),

    // ── Tasks ──
    tasksList: () => ipcRenderer.invoke('tasks-list'),
    loadProjectTasks: (projectPath) => ipcRenderer.invoke('load-project-tasks', projectPath),
    onTasksUpdated: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('ai-tasks-updated', handler);
        return () => ipcRenderer.removeListener('ai-tasks-updated', handler);
    },

    // ── Live File Changes (from AI tool calls) ──
    onFileChanged: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('ai-file-changed', handler);
        return () => ipcRenderer.removeListener('ai-file-changed', handler);
    },

    // ── Agent Mode & Permissions ──
    agentSetMode: (mode) => ipcRenderer.invoke('agent-set-mode', mode),
    agentGetMode: () => ipcRenderer.invoke('agent-get-mode'),
    setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
    getSetting: (key) => ipcRenderer.invoke('get-setting', key),
    onAgentMode: (callback) => {
        const handler = (_event, mode) => callback(mode);
        ipcRenderer.on('ai-agent-mode', handler);
        return () => ipcRenderer.removeListener('ai-agent-mode', handler);
    },

    // ── Session Title ──
    onSessionTitle: (callback) => {
        const handler = (_event, title) => callback(title);
        ipcRenderer.on('ai-session-title', handler);
        return () => ipcRenderer.removeListener('ai-session-title', handler);
    },

    // ── Git ──
    gitIsRepo: (repoPath) => ipcRenderer.invoke('git-is-repo', repoPath),
    gitInit: (repoPath) => ipcRenderer.invoke('git-init', repoPath),
    gitStatus: (repoPath) => ipcRenderer.invoke('git-status', repoPath),
    gitBranches: (repoPath) => ipcRenderer.invoke('git-branches', repoPath),
    gitLog: (repoPath, count) => ipcRenderer.invoke('git-log', repoPath, count),
    gitDiff: (repoPath, filePath, staged) => ipcRenderer.invoke('git-diff', repoPath, filePath, staged),
    gitStage: (repoPath, files) => ipcRenderer.invoke('git-stage', repoPath, files),
    gitUnstage: (repoPath, files) => ipcRenderer.invoke('git-unstage', repoPath, files),
    gitCommit: (repoPath, message) => ipcRenderer.invoke('git-commit', repoPath, message),
    gitCheckout: (repoPath, branch, create) => ipcRenderer.invoke('git-checkout', repoPath, branch, create),
    gitStash: (repoPath, action, message) => ipcRenderer.invoke('git-stash', repoPath, action, message),
    gitRemotes: (repoPath) => ipcRenderer.invoke('git-remotes', repoPath),
    gitPull: (repoPath) => ipcRenderer.invoke('git-pull', repoPath),
    gitPush: (repoPath) => ipcRenderer.invoke('git-push', repoPath),
    gitShow: (repoPath, ref, filePath) => ipcRenderer.invoke('git-show', repoPath, ref, filePath),

    // ── Hooks ──
    hooksList: (projectPath) => ipcRenderer.invoke('hooks-list', projectPath),
    hooksSave: (hooks, scope, projectPath) => ipcRenderer.invoke('hooks-save', hooks, scope, projectPath),
    hooksTest: (hookType, context) => ipcRenderer.invoke('hooks-test', { hookType, context }),
    onHookExecuted: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('hook-executed', handler);
        return () => ipcRenderer.removeListener('hook-executed', handler);
    },

    // ── Custom Commands ──
    customCommandsList: (projectPath) => ipcRenderer.invoke('custom-commands-list', projectPath),
    customCommandsCreate: (name, content, scope, projectPath) => ipcRenderer.invoke('custom-commands-create', name, content, scope, projectPath),
    customCommandsDelete: (name, scope, projectPath) => ipcRenderer.invoke('custom-commands-delete', name, scope, projectPath),

    // ── Context Compaction ──
    compactMessages: (messages) => ipcRenderer.invoke('compact-messages', messages),
    estimateTokens: (messages) => ipcRenderer.invoke('estimate-tokens', messages),

    // Platform
    platform: process.platform,
});
