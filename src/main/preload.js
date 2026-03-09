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
    listProjects: () => ipcRenderer.invoke('project-list'),
    getProject: (projectId) => ipcRenderer.invoke('project-get', projectId),
    deleteProject: (projectId) => ipcRenderer.invoke('project-delete', projectId),
    openProjectIn: (projectPath, editor) => ipcRenderer.invoke('project-open-in', projectPath, editor),

    // ── File System ──
    readDir: (dirPath, maxDepth) => ipcRenderer.invoke('fs-read-dir', dirPath, maxDepth),
    readFile: (filePath) => ipcRenderer.invoke('fs-read-file', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('fs-write-file', filePath, content),

    // Platform
    platform: process.platform,
});
