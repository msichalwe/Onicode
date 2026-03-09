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

    onAgentStep: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('ai-agent-step', handler);
        return () => ipcRenderer.removeListener('ai-agent-step', handler);
    },

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

    // Platform
    platform: process.platform,
});
