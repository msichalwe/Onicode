const { app, BrowserWindow, ipcMain, shell, net, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { registerTerminalIPC, killAllSessions } = require('./terminal');
const { registerProjectIPC } = require('./projects');
const { registerGitIPC } = require('./git');
const { registerConnectorIPC } = require('./connectors');
const { registerMemoryIPC, setMainWindow: setMemoryWindow } = require('./memory');
const { logger, registerLoggerIPC } = require('./logger');
const { registerBrowserIPC } = require('./browser');
const { registerHooksIPC, executeHook, getHooksSummary, loadHooks, setMainWindow: setHooksWindow } = require('./hooks');
const { registerCommandsIPC, getCustomCommandsSummary, loadCustomCommands } = require('./commands');
const { registerCompactorIPC, semanticCompact, setAICallFunction: setCompactorAICall } = require('./compactor');
const { TOOL_DEFINITIONS, executeTool, fileContext, listAgents, setMainWindow: setAIToolsWindow, getTerminalSessions, taskManager, setPermissions, setAgentModeRef, setDangerousProtectionCheck, setAutoCommitCheck, setAICallFunction, setLastProviderConfig, startSession, getSessionId, killBackgroundProcesses, getBackgroundProcesses, setAIStreamingActive, getCurrentProjectPath, resolveUserAnswer, resetThoughtChain, resolvePermissionApproval } = require('./aiTools');
const { conversationStorage, milestoneStorage, attachmentStorage, closeDB } = require('./storage');
const { registerLSPIPC, getLSPToolDefinitions, executeLSPTool } = require('./lsp');
const { registerCodeIndexIPC, getCodeIndexToolDefinitions, executeCodeIndexTool } = require('./codeIndex');
const { registerOrchestratorIPC, setOrchestratorDeps, ORCHESTRATOR_TOOL_DEFINITIONS, executeOrchestratorTool } = require('./orchestrator');
const { registerMCPIPC, getMCPToolDefinitions, executeMCPTool, connectAllEnabled: connectAllMCP, disconnectAll: disconnectAllMCP } = require('./mcp');
const { registerContextEngineIPC, getContextEngineToolDefinitions, executeContextEngineTool, buildDependencyGraph, preRetrieve, assemblePreRetrievedContext, startWatching, stopWatching } = require('./contextEngine');

let mainWindow = null;

// Combine all tool definitions from all modules (including MCP)
function getAllToolDefinitions() {
    return [
        ...TOOL_DEFINITIONS,
        ...getLSPToolDefinitions(),
        ...getCodeIndexToolDefinitions(),
        ...ORCHESTRATOR_TOOL_DEFINITIONS,
        ...getContextEngineToolDefinitions(),
        ...getMCPToolDefinitions(),
    ];
}

// Route tool calls to the right executor
async function executeAnyTool(name, args) {
    // MCP tools (prefixed with mcp_)
    if (name.startsWith('mcp_')) {
        return executeMCPTool(name, args);
    }
    // LSP tools
    if (['find_symbol', 'find_references', 'list_symbols', 'get_type_info'].includes(name)) {
        return executeLSPTool(name, args, _currentProjectPath);
    }
    // Code index tools
    if (['semantic_search', 'index_codebase'].includes(name)) {
        return executeCodeIndexTool(name, args, _currentProjectPath);
    }
    // Orchestrator tools
    if (['orchestrate', 'spawn_specialist', 'get_orchestration_status'].includes(name)) {
        return executeOrchestratorTool(name, args, _lastProviderConfig);
    }
    // Context engine tools
    if (['find_implementation', 'impact_analysis', 'prepare_edit_context', 'smart_read', 'batch_search'].includes(name)) {
        return executeContextEngineTool(name, args, _currentProjectPath);
    }
    // Default: aiTools executor
    return executeTool(name, args);
}

let _lastProviderConfig = null;

let _currentProjectPath = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 480,
        minHeight: 600,
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 16 },
        backgroundColor: '#F5EDE0',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
        icon: path.join(__dirname, '../../resources/icon.png'),
        title: 'Onicode',
        show: false,
    });

    const isDev = process.env.NODE_ENV !== 'production' || !app.isPackaged;

    if (isDev) {
        // Vite may pick a different port if 5173 is busy — try common ports
        const devPort = process.env.VITE_DEV_PORT || '5173';
        const devUrl = `http://localhost:${devPort}`;
        mainWindow.loadURL(devUrl);
        mainWindow.webContents.openDevTools({ mode: 'detach' });

        // If load fails (port mismatch), try the next port
        mainWindow.webContents.on('did-fail-load', async (_event, _code, _desc, url) => {
            if (!url.includes('localhost')) return;
            const currentPort = parseInt(new URL(url).port, 10);
            const nextPort = currentPort + 1;
            if (nextPort <= 5180) {
                console.log(`[Onicode] Port ${currentPort} failed, trying ${nextPort}...`);
                mainWindow.loadURL(`http://localhost:${nextPort}`);
            }
        });
    } else {
        mainWindow.loadFile(path.join(__dirname, '../chat/index.html'));
    }

    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.on('closed', () => { mainWindow = null; });

    // Suppress noisy Chrome DevTools protocol errors (Autofill.enable, etc.)
    mainWindow.webContents.on('console-message', (_event, _level, message) => {
        if (message.includes('Autofill.enable') || message.includes('Autofill.setAddresses')) {
            _event.preventDefault?.();
        }
    });

    // Give modules access to mainWindow for IPC events
    setAIToolsWindow(mainWindow);
    setMemoryWindow(mainWindow);
    setHooksWindow(mainWindow);

    // Wire orchestrator dependencies
    setOrchestratorDeps({
        mainWindow,
        makeAICall: (...args) => makeSubAgentAICall(...args),
        executeTool: (...args) => executeAnyTool(...args),
        TOOL_DEFINITIONS: getAllToolDefinitions(),
        activeAgents: require('./aiTools').activeAgents,
    });

    // Load global hooks on startup
    loadHooks();
}

// ══════════════════════════════════════════
//  IPC: App Info & Theme
// ══════════════════════════════════════════

ipcMain.handle('get-app-info', () => ({
    name: 'Onicode',
    version: app.getVersion(),
    platform: process.platform,
}));

ipcMain.handle('get-theme', async () => ({ theme: 'sand' }));
ipcMain.handle('set-theme', async (_event, theme) => ({ success: true, theme }));

ipcMain.handle('open-external', async (_event, url) => {
    if (url) shell.openExternal(url);
});

// ══════════════════════════════════════════
//  JWT + Token Helpers
// ══════════════════════════════════════════

/** Detect if a token is a ChatGPT OAuth JWT vs a standard sk-... API key */
function isOAuthToken(apiKey) {
    if (!apiKey) return false;
    // Standard OpenAI API keys start with sk-
    if (apiKey.startsWith('sk-')) return false;
    // JWTs have 3 dot-separated base64 segments
    const parts = apiKey.split('.');
    return parts.length === 3;
}

/** Decode JWT payload to extract chatgpt_account_id */
function decodeJWT(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const payload = Buffer.from(parts[1], 'base64').toString('utf-8');
        return JSON.parse(payload);
    } catch {
        return null;
    }
}

/** Extract ChatGPT account ID from OAuth JWT */
function getAccountId(token) {
    const payload = decodeJWT(token);
    if (!payload) return null;
    // The account ID is nested under the auth claim
    const authClaim = payload['https://api.openai.com/auth'];
    return authClaim?.chatgpt_account_id || null;
}

// ══════════════════════════════════════════
//  PKCE Helpers
// ══════════════════════════════════════════

function generateRandomString(length) {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
}

function generatePKCE() {
    const verifier = generateRandomString(64);
    const hash = crypto.createHash('sha256').update(verifier).digest();
    const challenge = hash
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return { verifier, challenge };
}

// ══════════════════════════════════════════
//  Codex OAuth Config (matches Codex CLI)
// ══════════════════════════════════════════

const CODEX_OAUTH = {
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    authorizeEndpoint: 'https://auth.openai.com/oauth/authorize',
    tokenEndpoint: 'https://auth.openai.com/oauth/token',
    redirectUri: 'http://localhost:1455/auth/callback',
    scope: 'openid profile email offline_access',
    audience: 'https://api.openai.com/v1',
};

// ══════════════════════════════════════════
//  IPC: Codex OAuth — generate PKCE + auth URL
// ══════════════════════════════════════════

let pendingOAuth = null;

ipcMain.handle('codex-oauth-get-auth-url', async () => {
    const pkce = generatePKCE();
    const state = generateRandomString(32);
    pendingOAuth = { verifier: pkce.verifier, state };

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: CODEX_OAUTH.clientId,
        redirect_uri: CODEX_OAUTH.redirectUri,
        scope: CODEX_OAUTH.scope,
        audience: CODEX_OAUTH.audience,
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        state,
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
        originator: 'codex_cli_rs',
    });

    const authUrl = `${CODEX_OAUTH.authorizeEndpoint}?${params.toString()}`;
    shell.openExternal(authUrl);
    return { success: true, authUrl };
});

// ══════════════════════════════════════════
//  IPC: Codex OAuth — exchange redirect URL for token
// ══════════════════════════════════════════

ipcMain.handle('codex-oauth-exchange', async (_event, redirectUrl) => {
    if (!pendingOAuth) return { error: 'No pending OAuth flow. Click "Sign in" first.' };

    try {
        const url = new URL(redirectUrl.trim());
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        const errorDesc = url.searchParams.get('error_description');

        if (error) { pendingOAuth = null; return { error: errorDesc || error }; }
        if (!code) return { error: 'No authorization code in URL. Copy the full URL.' };

        const tokenData = await exchangeCodeForToken(code, pendingOAuth.verifier);
        pendingOAuth = null;
        return tokenData;
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        if (msg.includes('Invalid URL')) return { error: 'Invalid URL. Paste the full redirect URL.' };
        return { error: `Token exchange failed: ${msg}` };
    }
});

ipcMain.handle('codex-oauth-cancel', async () => { pendingOAuth = null; return { success: true }; });

function exchangeCodeForToken(code, verifier) {
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: CODEX_OAUTH.clientId,
            code,
            redirect_uri: CODEX_OAUTH.redirectUri,
            code_verifier: verifier,
        }).toString();

        const url = new URL(CODEX_OAUTH.tokenEndpoint);
        const req = https.request({
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
            },
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.access_token) {
                        resolve({
                            success: true,
                            accessToken: json.access_token,
                            refreshToken: json.refresh_token,
                            expiresIn: json.expires_in,
                        });
                    } else {
                        resolve({ error: json.error_description || json.error || 'No access token' });
                    }
                } catch {
                    resolve({ error: `Invalid JSON from token endpoint (HTTP ${res.statusCode})` });
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ══════════════════════════════════════════
//  IPC: Test Provider Connection
// ══════════════════════════════════════════

ipcMain.handle('test-provider', async (_event, providerConfig) => {
    if (!providerConfig) return { error: 'No provider config' };

    try {
        if (providerConfig.id === 'codex') {
            if (!providerConfig.apiKey?.trim()) return { error: 'API key is required' };

            if (isOAuthToken(providerConfig.apiKey)) {
                // ChatGPT OAuth: test against chatgpt.com backend
                return await testChatGPTBackend(providerConfig.apiKey);
            } else {
                // Standard API key: test against api.openai.com
                return await testOpenAI(providerConfig.apiKey);
            }
        } else {
            if (!providerConfig.baseUrl?.trim()) return { error: 'Gateway URL is required' };
            return await testGateway(providerConfig.baseUrl, providerConfig.apiKey);
        }
    } catch (err) {
        return { error: err.message || 'Connection failed' };
    }
});

/** Test ChatGPT OAuth token by validating the JWT structure */
function testChatGPTBackend(accessToken) {
    const accountId = getAccountId(accessToken);
    if (!accountId) {
        return Promise.resolve({ error: 'Could not extract account ID from token. Token may be invalid or expired.' });
    }

    // Check if the token is expired
    const payload = decodeJWT(accessToken);
    if (payload?.exp && payload.exp * 1000 < Date.now()) {
        return Promise.resolve({ error: 'Token is expired. Sign in again.' });
    }

    // Token structure is valid — account ID extracted successfully
    return Promise.resolve({ success: true, modelCount: 0 });
}

/** Test standard API key against api.openai.com */
function testOpenAI(apiKey) {
    return new Promise((resolve) => {
        const req = https.request({
            hostname: 'api.openai.com',
            path: '/v1/models',
            method: 'GET',
            headers: { Authorization: `Bearer ${apiKey}` },
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const json = JSON.parse(data);
                        const allModels = json.data?.map((m) => m.id).sort() || [];
                        const relevant = allModels.filter((m) =>
                            m.includes('gpt-5') || m.includes('gpt-4') ||
                            m.includes('o3') || m.includes('o4') || m.includes('codex')
                        );
                        resolve({
                            success: true,
                            models: relevant.length > 0 ? relevant : undefined,
                            modelCount: json.data?.length || 0,
                        });
                    } catch {
                        resolve({ success: true, modelCount: 0 });
                    }
                } else if (res.statusCode === 401) {
                    resolve({ error: 'Authentication failed (401). Check your API key.' });
                } else {
                    let msg = `HTTP ${res.statusCode}`;
                    try { msg = JSON.parse(data).error?.message || msg; } catch { }
                    resolve({ error: msg });
                }
            });
        });
        req.on('error', (err) => resolve({ error: err.message }));
        req.end();
    });
}

function testGateway(baseUrl, apiKey) {
    const base = baseUrl.replace(/\/$/, '');
    return new Promise((resolve) => {
        const url = new URL(`${base}/v1/models`);
        const mod = url.protocol === 'https:' ? https : http;
        const headers = {};
        if (apiKey?.trim()) headers['Authorization'] = `Bearer ${apiKey}`;

        const req = mod.request({
            hostname: url.hostname,
            port: url.port || undefined,
            path: url.pathname + url.search,
            method: 'GET',
            headers,
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    let models, modelCount = 0;
                    try {
                        const json = JSON.parse(data);
                        if (json.data) { modelCount = json.data.length; models = json.data.map((m) => m.id).sort(); }
                    } catch { }
                    resolve({ success: true, models: models?.length > 0 ? models : undefined, modelCount });
                } else {
                    resolve({ error: `HTTP ${res.statusCode} — check URL and credentials` });
                }
            });
        });
        req.on('error', () => resolve({ error: 'Cannot reach gateway — check URL' }));
        req.end();
    });
}

// ══════════════════════════════════════════
//  IPC: AI Chat (Streaming via main process)
//  Supports both api.openai.com (API key) and
//  chatgpt.com/backend-api (OAuth token)
// ══════════════════════════════════════════

let currentAIRequest = null;

ipcMain.handle('ai-send-message', async (_event, messages, providerConfig) => {
    if (!providerConfig?.apiKey) return { error: 'No API key configured' };

    // Abort any in-flight request
    if (currentAIRequest) {
        try { currentAIRequest.destroy(); } catch { }
        currentAIRequest = null;
    }

    const apiKey = providerConfig.apiKey;

    // Extract active project path from system prompt for session tracking
    const systemMsg = messages.find(m => m.role === 'system');
    let projectPath = null;
    if (systemMsg?.content) {
        const pathMatch = systemMsg.content.match(/## Active Project:.*?\nPath:\s*`([^`]+)`/);
        if (pathMatch) projectPath = pathMatch[1];
    }

    // Fallback 1: explicit projectPath from renderer (covers race between init_project and project activation)
    if (!projectPath && providerConfig.projectPath) {
        projectPath = providerConfig.projectPath;
    }

    // Debug: log how project path was resolved
    logger.info('session', `Project path resolution: systemPrompt=${systemMsg?.content?.includes('Active Project') ? 'YES' : 'NO'}, providerConfig.projectPath=${providerConfig.projectPath || 'null'}, resolved=${projectPath || 'null'}`);

    // Fallback 2: project path persisted from previous streaming session (aiTools module state)
    // Only use this if the conversation looks like it's continuing project work (has >2 messages, meaning it's a follow-up)
    if (!projectPath && messages.length > 2) {
        const prevPath = getCurrentProjectPath();
        if (prevPath) {
            projectPath = prevPath;
            logger.info('session', `Using projectPath from previous streaming session: ${projectPath}`);
        }
    }

    // Reload hooks for current project (ensures project-level hooks are fresh)
    _currentProjectPath = projectPath;
    if (projectPath) {
        loadHooks(projectPath);
        // Start file watcher + warm dependency graph (fire-and-forget)
        startWatching(projectPath);
        buildDependencyGraph(projectPath);
    }

    // Auto-generate session title from first user message (fire-and-forget)
    const userMsgs = messages.filter(m => m.role === 'user');
    if (userMsgs.length === 1) {
        generateSessionTitle(userMsgs[0].content, providerConfig).catch(() => { });
        // SessionStart hook — first message = new session
        try { executeHook('SessionStart', { projectDir: projectPath || '' }); } catch { }
    }

    // Route based on token type
    const reasoningEffort = providerConfig.reasoningEffort || 'medium';
    if (providerConfig.id === 'codex' && isOAuthToken(apiKey)) {
        return streamChatGPTBackend(messages, apiKey, providerConfig.selectedModel, projectPath, reasoningEffort);
    } else {
        return streamOpenAI(messages, providerConfig, projectPath);
    }
});

/** Convert Chat Completions tool defs to Responses API format */
function toResponsesAPITools(toolDefs) {
    return toolDefs.map(t => ({
        type: 'function',
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
    }));
}

/** Single streaming Responses API call — returns { content, functionCalls } */
async function streamChatGPTSingle(inputItems, instructions, accessToken, accountId, model, includeTools = true, forceToolChoice = false, reasoningEffort = 'medium') {
    const isOModel = model.startsWith('o');

    const bodyObj = {
        model,
        instructions,
        input: inputItems,
        stream: true,
        store: false,
    };

    // Apply reasoning effort for models that support it
    if (reasoningEffort && reasoningEffort !== 'medium') {
        bodyObj.reasoning = { effort: reasoningEffort };
    }

    if (includeTools && !isOModel) {
        bodyObj.tools = toResponsesAPITools(getAllToolDefinitions());
        if (forceToolChoice) {
            bodyObj.tool_choice = 'required';
        }
    }

    const abortController = new AbortController();
    currentAIRequest = abortController;

    const response = await net.fetch('https://chatgpt.com/backend-api/codex/responses', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'chatgpt-account-id': accountId,
            'OpenAI-Beta': 'responses=experimental',
            'originator': 'codex_cli_rs',
            'accept': 'text/event-stream',
        },
        body: JSON.stringify(bodyObj),
        signal: abortController.signal,
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        currentAIRequest = null;
        let errorMsg = `ChatGPT backend returned HTTP ${response.status}`;
        try { const errJson = JSON.parse(errText); errorMsg = errJson.error?.message || errJson.detail || errorMsg; } catch { }
        if (response.status === 401) errorMsg = 'OAuth token expired. Go to Settings and sign in again.';
        if (response.status === 403) errorMsg = 'Access denied. Your ChatGPT subscription may not include this model.';
        console.error('[AI] ChatGPT backend error:', response.status, errText.slice(0, 500));
        throw new Error(errorMsg);
    }

    // Parse SSE stream — accumulate text + function calls
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let textContent = '';
    const functionCalls = new Map(); // item_id -> { call_id, name, arguments }
    let currentFnItemId = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]') continue;
            try {
                const json = JSON.parse(dataStr);

                // Text delta
                if (json.type === 'response.output_text.delta' && json.delta) {
                    textContent += json.delta;
                    mainWindow?.webContents.send('ai-stream-chunk', json.delta);
                }

                // Function call started
                if (json.type === 'response.output_item.added' && json.item?.type === 'function_call') {
                    const item = json.item;
                    currentFnItemId = item.id || json.output_index;
                    functionCalls.set(currentFnItemId, {
                        call_id: item.call_id,
                        name: item.name,
                        arguments: '',
                    });
                }

                // Function call arguments delta
                if (json.type === 'response.function_call_arguments.delta' && json.delta) {
                    const itemId = json.item_id || currentFnItemId;
                    const fn = functionCalls.get(itemId);
                    if (fn) fn.arguments += json.delta;
                }

                // Function call arguments done
                if (json.type === 'response.function_call_arguments.done') {
                    const itemId = json.item_id || currentFnItemId;
                    const fn = functionCalls.get(itemId);
                    if (fn && json.arguments) fn.arguments = json.arguments;
                }

                // Chat Completions fallback (some endpoints return this format)
                if (json.choices?.[0]?.delta?.content) {
                    const chunk = json.choices[0].delta.content;
                    textContent += chunk;
                    mainWindow?.webContents.send('ai-stream-chunk', chunk);
                }
            } catch { }
        }
    }

    currentAIRequest = null;
    return { content: textContent, functionCalls: [...functionCalls.values()] };
}

/**
 * Build rich project context for auto-continue prompts.
 * This prevents the AI from losing track of what it's already built.
 */
function buildContinueContext() {
    const fs = require('fs');
    const parts = [];

    // What files have been created/modified this session
    const created = [...(fileContext.createdFiles || [])];
    const modified = [...(fileContext.modifiedFiles?.keys() || [])];

    if (created.length > 0) {
        parts.push(`Files you ALREADY CREATED this session (they exist on disk, do NOT re-create):\n  ${created.join('\n  ')}`);
    }
    if (modified.length > 0) {
        parts.push(`Files you modified this session:\n  ${modified.filter(f => !fileContext.createdFiles?.has(f)).slice(0, 15).join('\n  ')}`);
    }

    // Try to find the project directory from created files or fileContext
    let projectDir = null;
    if (created.length > 0) {
        // Extract common directory prefix
        const first = created[0];
        const parts2 = first.split('/');
        // Look for OniProjects pattern
        const oniIdx = parts2.findIndex(p => p === 'OniProjects');
        if (oniIdx >= 0 && parts2.length > oniIdx + 1) {
            projectDir = parts2.slice(0, oniIdx + 2).join('/');
        } else if (parts2.length >= 3) {
            // Take directory of first file
            projectDir = parts2.slice(0, -1).join('/');
        }
    }

    // List the actual project directory structure so the AI knows what's there
    if (projectDir && fs.existsSync(projectDir)) {
        try {
            const { registerProjectIPC } = require('./projects');
            // Use a simple inline directory listing
            const listDir = (dir, depth = 0, maxDepth = 2) => {
                if (depth >= maxDepth) return [];
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                return entries
                    .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== '.git')
                    .sort((a, b) => {
                        if (a.isDirectory() && !b.isDirectory()) return -1;
                        if (!a.isDirectory() && b.isDirectory()) return 1;
                        return a.name.localeCompare(b.name);
                    })
                    .flatMap(e => {
                        const indent = '  '.repeat(depth);
                        const fullPath = require('path').join(dir, e.name);
                        if (e.isDirectory()) {
                            return [`${indent}${e.name}/`, ...listDir(fullPath, depth + 1, maxDepth)];
                        }
                        return [`${indent}${e.name}`];
                    });
            };
            const dirListing = listDir(projectDir);
            if (dirListing.length > 0) {
                parts.push(`Current project directory (${projectDir}):\n${dirListing.slice(0, 50).join('\n')}`);
            }
        } catch { /* listing failed */ }
    }

    // Task summary — show the AI what tasks exist and their status
    const taskSummary = taskManager.getSummary();
    if (taskSummary.total > 0) {
        const taskLines = taskSummary.tasks.map(t =>
            `  [${t.status.toUpperCase()}] #${t.id}: ${t.content}`
        );
        parts.push(`Task list (${taskSummary.done}/${taskSummary.total} done):\n${taskLines.join('\n')}`);
    }

    // Background processes
    const bgProcs = getBackgroundProcesses();
    if (bgProcs.length > 0) {
        parts.push(`Background processes running: ${bgProcs.map(p => `${p.command} (pid: ${p.pid}${p.port ? ', port: ' + p.port : ''})`).join(', ')}`);
    }

    return parts.join('\n\n');
}

/**
 * Detect if AI text response contains numbered discovery questions.
 * Used to avoid auto-continuing when the AI is asking the user for input.
 */
function looksLikeDiscoveryQuestions(text) {
    if (!text || text.length < 30) return false;
    const lines = text.split('\n');
    let questionCount = 0;
    for (const line of lines) {
        // Match: "1. Question text?" or "1) Question?" or "- 1. Question?"
        if (/^\s*[-*]?\s*\d+[.)]\s*.+\?/.test(line)) {
            questionCount++;
        }
    }
    return questionCount >= 2;
}

/**
 * Check if the user's message indicates they want to skip questions and just build.
 * e.g. "Use recommended defaults", "Just build it", "Let AI Decide", answering with "→"
 */
function userWantsToSkipQuestions(messages) {
    // Check the last 2 user messages for skip signals
    const userMsgs = messages.filter(m => m.role === 'user').slice(-2);
    for (const msg of userMsgs) {
        const text = (msg.content || '').toLowerCase();
        if (
            text.includes('default') ||
            text.includes('just build') ||
            text.includes('let ai decide') ||
            text.includes('recommended') ||
            text.includes('skip question') ||
            text.includes('go ahead') ||
            text.includes('start building') ||
            /→\s*\*\*/.test(msg.content || '') // QuestionDialog "→ **answer**" format
        ) {
            return true;
        }
    }
    return false;
}

/**
 * Generate a completion summary when the AI finishes an agentic session with tools.
 * @param {Set} toolsUsed — tools called in this request
 * @param {Object} [startSnapshot] — task snapshot at request start { done, total, pending }
 */
function sendCompletionSummary(toolsUsed, startSnapshot) {
    if (toolsUsed.size === 0) return; // No tools were used, no summary needed

    const summary = taskManager.getSummary();
    const parts = [];

    // Only show task progress if tasks changed during this request
    const tasksChanged = !startSnapshot || summary.done !== startSnapshot.done || summary.total !== startSnapshot.total;
    if (summary.total > 0 && tasksChanged) {
        if (startSnapshot && startSnapshot.done < summary.done) {
            const newDone = summary.done - startSnapshot.done;
            parts.push(`**${newDone} task${newDone > 1 ? 's' : ''} completed this round** (${summary.done}/${summary.total} total).`);
        } else {
            parts.push(`**${summary.done}/${summary.total} tasks completed.**`);
        }
        if (summary.pending > 0) parts.push(`${summary.pending} still pending.`);
    }

    const actions = [];
    if (toolsUsed.has('create_file')) {
        const fileCount = fileContext.created?.length || 0;
        actions.push(fileCount > 0 ? `created ${fileCount} files` : 'created files');
    }
    if (toolsUsed.has('edit_file') || toolsUsed.has('multi_edit')) {
        const editCount = fileContext.edited?.length || 0;
        actions.push(editCount > 0 ? `edited ${editCount} files` : 'edited files');
    }
    if (toolsUsed.has('run_command')) actions.push('ran commands');
    if (toolsUsed.has('git_commit')) actions.push('committed changes');
    if (toolsUsed.has('browser_navigate') || toolsUsed.has('browser_screenshot')) actions.push('used browser');
    if (toolsUsed.has('init_project')) actions.push('initialized project');
    if (toolsUsed.has('spawn_sub_agent')) actions.push('spawned sub-agents');
    if (toolsUsed.has('orchestrate')) actions.push('orchestrated multi-agent workflow');
    if (toolsUsed.has('spawn_specialist')) actions.push('spawned specialist agents');

    if (actions.length > 0) {
        parts.push(`Actions: ${actions.join(', ')}.`);
    }

    const bgProcs = getBackgroundProcesses();
    if (bgProcs.length > 0) {
        parts.push(`${bgProcs.length} background process${bgProcs.length > 1 ? 'es' : ''} still running.`);
    }

    if (parts.length > 0) {
        // Break into a new message bubble so the summary is separate from AI text
        sendMessageBreak();
        const summaryText = parts.join(' ');
        mainWindow?.webContents.send('ai-stream-chunk', summaryText);
    }
}

/**
 * Send a message break — tells the renderer to finalize the current message bubble
 * and start a new one. This creates the multi-bubble experience where each task
 * gets its own message, similar to how Claude Code works.
 */
function sendMessageBreak() {
    mainWindow?.webContents.send('ai-message-break', {});
}

/** Stream chat via ChatGPT backend API with agentic tool-calling loop */
async function streamChatGPTBackend(messages, accessToken, selectedModel, projectPath, reasoningEffort = 'medium') {
    const accountId = getAccountId(accessToken);
    if (!accountId) {
        mainWindow?.webContents.send('ai-stream-done', 'Cannot extract account ID from token. Sign in again.');
        return { error: 'Invalid token' };
    }

    const model = selectedModel || 'gpt-4o';
    const MAX_ROUNDS = 75;
    const MAX_AUTO_CONTINUES = 15;

    // Wire provider config for sub-agent + orchestrator use
    const provConfig = { id: 'codex', apiKey: accessToken, selectedModel: model };
    setLastProviderConfig(provConfig);
    _lastProviderConfig = provConfig;
    setPermissions(activePermissions);
    setAgentModeRef(agentMode);
    setAIStreamingActive(true); // Lock: prevent renderer from wiping tasks (BEFORE startSession)
    startSession(null, projectPath);

    // Snapshot task state at request start so completion summary only shows changes
    const _taskStartSnapshot = { ...taskManager.getSummary() };

    // Separate system/developer instructions from user/assistant messages
    const systemMessages = messages.filter((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');

    let instructions = systemMessages.map((m) => m.content).join('\n\n')
        || 'You are Onicode AI, an intelligent development companion.';

    // Inject current session state (task list, file context, background processes) into system instructions
    const initialContext = buildContinueContext();
    if (initialContext) {
        instructions += '\n\n## Current Session State\n' + initialContext;
    }

    // ── Pre-retrieval: gather context BEFORE the model is called ──
    if (projectPath && chatMessages.length > 0) {
        try {
            const lastUserMsg = [...chatMessages].reverse().find(m => m.role === 'user');
            if (lastUserMsg?.content) {
                const workingSet = [...(fileContext.readFiles?.keys() || []), ...(fileContext.modifiedFiles?.keys() || [])];
                // Fire with 2s timeout
                const preResult = await Promise.race([
                    preRetrieve(lastUserMsg.content, projectPath, workingSet),
                    new Promise(resolve => setTimeout(() => resolve(null), 2000)),
                ]);
                const preContext = assemblePreRetrievedContext(preResult);
                if (preContext) {
                    instructions += '\n\n' + preContext;
                }
            }
        } catch { /* pre-retrieval failed, continue without it */ }
    }

    // Convert to Responses API input format
    const inputItems = chatMessages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
    }));

    let autoContinueCount = 0;
    const toolsUsed = new Set();
    let _forceNoToolsNextRound = false; // After init_project, force text-only to get discovery questions
    let _browserNavFailures = 0; // Track consecutive browser_navigate failures
    let _consecutiveTextOnlyRounds = 0; // Track text-only rounds to detect stuck loops
    let _toolOnlyRounds = 0; // Track consecutive tool-only rounds for synthetic status
    const _roundToolNames = []; // Collect tool names per round for status generation

    try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
            // Signal thinking on tool-loop rounds, streaming on first/text rounds
            if (round > 0) {
                mainWindow?.webContents.send('ai-agent-step', { round, status: 'thinking' });
            } else {
                mainWindow?.webContents.send('ai-agent-step', { round, status: 'streaming' });
            }

            // Auto-compact inputItems if conversation is getting too long
            if (round > 3) {
                const totalChars = inputItems.reduce((sum, item) => {
                    if (typeof item.content === 'string') return sum + item.content.length;
                    if (item.output) return sum + item.output.length;
                    return sum + (JSON.stringify(item).length);
                }, 0);
                const estTokens = totalChars / 4;
                if (estTokens > 80000) {
                    logger.info('compaction', `ChatGPT backend auto-compact at round ${round}, ~${Math.round(estTokens)} tokens, ${inputItems.length} items`);
                    const keepLast = 20;
                    if (inputItems.length > keepLast + 5) {
                        // Extract context from items being removed
                        const removing = inputItems.slice(0, -keepLast);
                        const filesCreated = new Set();
                        const filesEdited = new Set();
                        const toolsCalled = {};
                        for (const item of removing) {
                            if (item.type === 'function_call' && item.name) {
                                toolsCalled[item.name] = (toolsCalled[item.name] || 0) + 1;
                                try {
                                    const a = JSON.parse(item.arguments || '{}');
                                    if (item.name === 'create_file' && a.file_path) filesCreated.add(a.file_path.split('/').pop());
                                    if ((item.name === 'edit_file' || item.name === 'multi_edit') && a.file_path) filesEdited.add(a.file_path.split('/').pop());
                                } catch {}
                            }
                        }
                        const taskSummary = taskManager.getSummary();
                        const summaryParts = [];
                        if (filesCreated.size > 0) summaryParts.push(`Files created: ${[...filesCreated].join(', ')}`);
                        if (filesEdited.size > 0) summaryParts.push(`Files edited: ${[...filesEdited].join(', ')}`);
                        const toolList = Object.entries(toolsCalled).map(([k, v]) => `${k}(${v})`).join(', ');
                        if (toolList) summaryParts.push(`Tools used: ${toolList}`);
                        summaryParts.push(`Tasks: ${taskSummary.done}/${taskSummary.total} done, ${taskSummary.pending} pending`);

                        const trimmed = inputItems.slice(-keepLast);
                        trimmed.unshift({
                            role: 'user',
                            content: `[Context compacted — ${removing.length} older items summarized]\n${summaryParts.join('\n')}\n\nAll files listed above exist on disk. Continue from the most recent results. Check task_list for current state.`,
                        });
                        const beforeLen = inputItems.length;
                        inputItems.length = 0;
                        inputItems.push(...trimmed);
                        logger.info('compaction', `Compacted ${beforeLen} → ${inputItems.length} items`);
                    }
                }
            }

            // Force tool_choice on auto-continue rounds to guarantee the model makes tool calls
            // BUT if we just did init_project, force text-only so AI asks discovery questions
            const forceTools = _forceNoToolsNextRound ? false : (autoContinueCount > 0);
            const includeTools = !_forceNoToolsNextRound; // Completely remove tools to force text response
            _forceNoToolsNextRound = false; // Reset for next iteration

            // ── Stream with auto-retry for transient network errors ──
            let result;
            const TRANSIENT_ERRORS_CGP = ['ERR_QUIC_PROTOCOL_ERROR', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ERR_CONNECTION_RESET', 'ERR_NETWORK_CHANGED', 'EPIPE', 'socket hang up', 'network error'];
            const MAX_RETRIES_CGP = 2;
            for (let attempt = 0; attempt <= MAX_RETRIES_CGP; attempt++) {
                try {
                    result = await streamChatGPTSingle(inputItems, instructions, accessToken, accountId, model, includeTools, forceTools, reasoningEffort);
                    break; // Success
                } catch (retryErr) {
                    const errMsg = retryErr.message || String(retryErr);
                    const isTransient = TRANSIENT_ERRORS_CGP.some(e => errMsg.includes(e));
                    if (!isTransient || attempt === MAX_RETRIES_CGP) throw retryErr; // Re-throw to outer catch
                    const delay = (attempt + 1) * 3000;
                    logger.warn('agent-loop', `Transient error "${errMsg}" — retrying in ${delay/1000}s (attempt ${attempt + 1}/${MAX_RETRIES_CGP})`);
                    mainWindow?.webContents.send('ai-stream-chunk', `\n*[Network error — retrying in ${delay/1000}s...]*\n`);
                    await new Promise(r => setTimeout(r, delay));
                }
            }

            // No function calls — check if we should auto-continue
            if (!result.functionCalls || result.functionCalls.length === 0) {
                const summary = taskManager.getSummary();
                const hasPendingTasks = summary.pending > 0 || summary.inProgress > 0;
                const hasBuiltAnything = toolsUsed.has('create_file') || toolsUsed.has('run_command');
                const justInitProject = toolsUsed.has('init_project') && !hasBuiltAnything && summary.total === 0;
                const aiTextContent = result.text || result.content || '';

                // Detect if the AI is announcing intent to act without making tool calls
                // e.g., "I'll fix that now", "Let me update the styles", "On it — I'll..."
                // Triggers when AI used discovery/read tools but hasn't built anything yet
                const announcesIntent = /\b(I'll|I will|let me|I'm going to|I'm now|on it|working on|starting|proceeding|I need to|I can fix|I'll now|implementing|adding|creating|wiring|building)\b/i.test(aiTextContent)
                    && aiTextContent.length < 500 // Short intent messages, not long explanations
                    && round < 10 // Early/mid rounds (AI stalling before building)
                    && !hasBuiltAnything; // Hasn't created files or run commands yet

                // If the AI is asking discovery questions after init_project, let the response
                // end naturally so the user can answer. Don't force auto-continue.
                // BUT: if user already said "use defaults" / "just build it", don't pause.
                if (justInitProject && looksLikeDiscoveryQuestions(aiTextContent) && !userWantsToSkipQuestions(inputItems)) {
                    logger.info('agent-loop', 'AI is asking discovery questions after init_project — pausing for user input');
                    sendCompletionSummary(toolsUsed, _taskStartSnapshot);
                    mainWindow?.webContents.send('ai-stream-done', null);
                    return { success: true };
                }

                if ((hasPendingTasks || justInitProject || announcesIntent) && autoContinueCount < MAX_AUTO_CONTINUES) {
                    autoContinueCount++;
                    _consecutiveTextOnlyRounds = (_consecutiveTextOnlyRounds || 0) + 1;
                    logger.info('agent-loop', `Auto-continue #${autoContinueCount}/${MAX_AUTO_CONTINUES}: ${summary.pending} pending, ${summary.inProgress} in_progress, ${summary.done}/${summary.total} done${justInitProject ? ' [post-init]' : ''}${announcesIntent ? ' [intent-detected]' : ''} [textOnly=${_consecutiveTextOnlyRounds}]`);

                    // Circuit breaker: if AI sent 3+ text-only rounds in a row, it's stuck repeating itself
                    if (_consecutiveTextOnlyRounds >= 3) {
                        logger.warn('agent-loop', `AI stuck in text-only loop (${_consecutiveTextOnlyRounds} rounds). Force-closing remaining in_progress tasks and stopping.`);
                        // Auto-close any in_progress tasks since the AI clearly considers them done
                        for (const t of summary.tasks) {
                            if (t.status === 'in_progress') {
                                taskManager.update(t.id, 'done');
                                logger.info('agent-loop', `Auto-closed stuck task #${t.id}: ${t.content}`);
                            }
                        }
                        sendCompletionSummary(toolsUsed, _taskStartSnapshot);
                        mainWindow?.webContents.send('ai-stream-done', null);
                        return { success: true };
                    }

                    const projectContext = buildContinueContext();
                    const nextTask = summary.nextTask;
                    const roundsLeft = MAX_ROUNDS - round;
                    const taskStatusLine = `${summary.done}/${summary.total} tasks done${summary.inProgress > 0 ? `, ${summary.inProgress} IN PROGRESS (must finish!)` : ''}${summary.pending > 0 ? `, ${summary.pending} pending` : ''}`;

                    // Detect if AI wrote a completion summary but forgot to mark tasks done
                    const looksLikeDoneSummary = /\b(done|completed|finished|all.*tasks|that's it|everything.*(work|done))\b/i.test(aiTextContent)
                        && summary.inProgress > 0
                        && summary.pending === 0;
                    const inProgressTasks = summary.tasks.filter(t => t.status === 'in_progress');

                    let continuePrompt;
                    if (looksLikeDoneSummary && inProgressTasks.length > 0) {
                        // AI thinks it's done but forgot to mark tasks — give a very specific prompt
                        const taskIds = inProgressTasks.map(t => `task_update({ id: ${t.id}, status: "done" })`).join(', then ');
                        continuePrompt = `You just wrote a completion summary, but ${inProgressTasks.length} task(s) are still marked in_progress. You MUST call ${taskIds} RIGHT NOW. Do NOT write any text — just make the tool calls.`;
                        logger.info('agent-loop', `Detected done-summary with ${inProgressTasks.length} in_progress tasks — forcing task_update`);
                    } else if (announcesIntent && !hasPendingTasks) {
                        continuePrompt = `STOP TALKING. You just said "${aiTextContent.slice(0, 100)}..." but made ZERO tool calls. DO NOT describe what you'll do — USE TOOLS NOW. Call task_add to plan tasks, then create_file or edit_file to implement. Every response MUST contain tool calls.\n\n${projectContext}`;
                        logger.info('agent-loop', `Detected intent-without-action — forcing tool use (round ${round})`);
                    } else if (justInitProject && !userWantsToSkipQuestions(inputItems)) {
                        continuePrompt = `MANDATORY: You just initialized the project. Before adding tasks, ask the user 3-5 quick setup questions to clarify their preferences (tech stack, features, design style, etc.). Format as numbered questions with options in parentheses so the UI can render them as interactive buttons. Example:\n1. What tech stack? (React + Vite, Next.js, Vue)\n2. Auth needed? (yes, no, later)\n\nDo NOT add tasks or create files yet — ask questions first.\n\n${projectContext}`;
                    } else if (justInitProject) {
                        continuePrompt = `The user chose recommended defaults — skip all questions. Call task_add to plan 4-6 tasks, then immediately call create_file to start building. Do NOT ask any questions. Start NOW.\n\n${projectContext}`;
                    } else if (!hasBuiltAnything) {
                        continuePrompt = `MANDATORY: You have ${summary.pending} pending${summary.inProgress > 0 ? ` + ${summary.inProgress} in-progress` : ''} tasks and have NOT created any files yet. You MUST call create_file or run_command NOW. Do not respond with text — make tool calls immediately. First task: "${nextTask?.content || 'unknown'}"\n\n⏱️ Budget: ${roundsLeft} rounds remaining. EFFICIENCY: Call create_file MULTIPLE TIMES in the same response. Batch 3-5 file creations per round.\n\n${projectContext}`;
                    } else {
                        continuePrompt = `MANDATORY: ${taskStatusLine}. Continue with tool calls NOW — do NOT repeat any status updates you already gave.${nextTask ? `\nNext task: "${nextTask.content}" (${nextTask.status})` : ''}\n\n⏱️ ${roundsLeft} rounds left. Batch 3-5 file ops per round. Mark tasks done immediately.\n${roundsLeft < 15 ? '⚠️ LOW ROUNDS — finish remaining tasks NOW.\n' : ''}\n${projectContext}`;
                    }

                    inputItems.push({ role: 'user', content: continuePrompt });
                    mainWindow?.webContents.send('ai-agent-step', { round, status: 'continuing', pending: summary.pending });
                    continue;
                }

                if (hasPendingTasks) {
                    logger.warn('agent-loop', `Max auto-continues (${MAX_AUTO_CONTINUES}) reached with ${summary.pending} tasks still pending`);
                    mainWindow?.webContents.send('ai-stream-chunk', `\n\n*[Agent paused — ${summary.pending} tasks still pending. Send another message to continue.]*`);
                }
                sendCompletionSummary(toolsUsed, _taskStartSnapshot);
                mainWindow?.webContents.send('ai-stream-done', null);
                return { success: true };
            }

            // Execute each function call
            autoContinueCount = 0;
            _consecutiveTextOnlyRounds = 0; // Reset — AI made tool calls

            // ── Break message bubble when AI emitted text before tool calls ──
            // This creates the "text update → tool group → text update" pattern
            const roundText = result.text || result.content || '';
            if (roundText.trim()) {
                sendMessageBreak();
            }

            mainWindow?.webContents.send('ai-agent-step', { round, status: 'executing' });
            for (const fn of result.functionCalls) {
                let args = {};
                try {
                    args = JSON.parse(fn.arguments);
                } catch (parseErr) {
                    logger.warn('tool-args', `Malformed JSON in ${fn.name} tool call: ${fn.arguments?.slice(0, 200)}`);
                    // Try to salvage — common issue is trailing garbage from streaming
                    const cleaned = (fn.arguments || '').replace(/[}\]]*\s*,?\s*\{[^}]*$/g, '').trim();
                    try { args = JSON.parse(cleaned.endsWith('}') ? cleaned : cleaned + '}'); } catch { }
                }

                toolsUsed.add(fn.name);

                mainWindow?.webContents.send('ai-tool-call', {
                    id: fn.call_id,
                    name: fn.name,
                    args,
                    round,
                });

                logger.toolCall(fn.name, args, round);
                let toolResult;
                if (fn.name === 'init_project' && _currentProjectPath) {
                    // HARD GUARD: Block duplicate init_project when a project is already active
                    logger.warn('agent-loop', `Blocked duplicate init_project call — project already active at ${_currentProjectPath}`);
                    toolResult = {
                        success: true,
                        already_registered: true,
                        project_path: _currentProjectPath,
                        message: `A project is ALREADY initialized at ${_currentProjectPath}. Do NOT call init_project again. Proceed directly with task_add to plan tasks, then create_file to build.`,
                    };
                } else {
                    toolResult = await executeAnyTool(fn.name, args);
                }
                logger.toolResult(fn.name, toolResult, round);

                // Track browser_navigate failures — block AI from calling it again after 3 cumulative failures
                // (Note: aiTools.js already retries internally up to 3 times with progressive delays)
                if (fn.name === 'browser_navigate') {
                    if (toolResult?.error && /ECONNREFUSED|CONNECTION_REFUSED|ERR_CONNECTION_REFUSED/i.test(toolResult.error)) {
                        _browserNavFailures++;
                        if (_browserNavFailures >= 3) {
                            toolResult.STOP_RETRYING = 'Browser navigation has failed multiple times with CONNECTION_REFUSED (including internal retries). The dev server is not running or crashed. Do NOT call browser_navigate again — skip browser testing and move on.';
                            logger.warn('browser', `browser_navigate failed ${_browserNavFailures} times (cumulative) — injecting stop-retry directive`);
                        }
                    } else if (!toolResult?.error) {
                        _browserNavFailures = 0; // Reset on success
                    }
                }

                mainWindow?.webContents.send('ai-tool-result', {
                    id: fn.call_id,
                    name: fn.name,
                    result: toolResult,
                    round,
                });

                // Add function call + result to input for next round
                inputItems.push({
                    type: 'function_call',
                    call_id: fn.call_id,
                    name: fn.name,
                    arguments: fn.arguments,
                });
                inputItems.push({
                    type: 'function_call_output',
                    call_id: fn.call_id,
                    output: JSON.stringify(toolResult).slice(0, 16000),
                });
            }

            // ── Track tool-only rounds and inject synthetic status every 3 rounds ──
            const roundToolNames = result.functionCalls.map(fn => fn.name);
            _roundToolNames.push(...roundToolNames);
            const hasTextThisRound = (result.text || result.content || '').trim().length > 0;
            if (!hasTextThisRound) {
                _toolOnlyRounds++;
            } else {
                _toolOnlyRounds = 0;
                _roundToolNames.length = 0;
            }
            if (_toolOnlyRounds >= 3) {
                // Generate a concise synthetic status from accumulated tool names
                const counts = {};
                for (const n of _roundToolNames) counts[n] = (counts[n] || 0) + 1;
                const parts = [];
                if (counts.read_file || counts.smart_read) parts.push(`Read ${(counts.read_file || 0) + (counts.smart_read || 0)} files`);
                if (counts.find_implementation) parts.push(`Found ${counts.find_implementation} implementations`);
                if (counts.edit_file || counts.multi_edit) parts.push(`Edited ${(counts.edit_file || 0) + (counts.multi_edit || 0)} files`);
                if (counts.create_file) parts.push(`Created ${counts.create_file} files`);
                if (counts.task_add) parts.push(`Added ${counts.task_add} tasks`);
                if (counts.run_command) parts.push(`Ran ${counts.run_command} commands`);
                if (counts.search_files || counts.batch_search) parts.push(`Searched ${(counts.search_files || 0) + (counts.batch_search || 0)} queries`);
                if (counts.orchestrate) parts.push(`Orchestrated ${counts.orchestrate} multi-agent task${counts.orchestrate > 1 ? 's' : ''}`);
                if (counts.spawn_specialist) parts.push(`Spawned ${counts.spawn_specialist} specialist${counts.spawn_specialist > 1 ? 's' : ''}`);
                if (parts.length === 0) {
                    const uniqueTools = [...new Set(_roundToolNames)].slice(0, 4);
                    parts.push(uniqueTools.join(', '));
                }
                const summary = taskManager.getSummary();
                const taskStatus = summary.total > 0 ? ` (${summary.done}/${summary.total} tasks done)` : '';
                sendMessageBreak();
                mainWindow?.webContents.send('ai-stream-chunk', parts.join(', ') + '.' + taskStatus);
                sendMessageBreak();
                _toolOnlyRounds = 0;
                _roundToolNames.length = 0;
            }

            // ── Per-round: break message bubble when a task is completed ──
            const postRoundSummary = taskManager.getSummary();
            if (postRoundSummary.done > _taskStartSnapshot.done) {
                sendMessageBreak();
                _taskStartSnapshot.done = postRoundSummary.done;
            }

            // ── Post-round: check if init_project was called for a NEW project ──
            const initThisRound = result.functionCalls.find(fn => fn.name === 'init_project');
            if (initThisRound) {
                // Parse the tool result to check if it's a new project
                const initResultStr = inputItems.findLast(item => item.type === 'function_call_output' && item.call_id === initThisRound.call_id);
                let isNewProject = true;
                let initProjectPath = null;
                try {
                    const parsed = JSON.parse(initResultStr?.output || '{}');
                    isNewProject = !parsed.already_registered;
                    initProjectPath = parsed.project_path;
                } catch {}

                // Update projectPath for this session so follow-up calls use the correct project
                if (initProjectPath) {
                    projectPath = initProjectPath;
                    _currentProjectPath = initProjectPath;
                    // Re-init session with correct project (won't wipe tasks — same path check will pass on subsequent calls)
                    startSession(null, initProjectPath);
                    logger.info('agent-loop', `Updated session projectPath after init_project: ${initProjectPath}`);
                }
                if (isNewProject && !userWantsToSkipQuestions(inputItems)) {
                    logger.info('agent-loop', 'init_project created NEW project — forcing text-only next round for discovery questions');
                    _forceNoToolsNextRound = true;
                    inputItems.push({
                        role: 'user',
                        content: 'CRITICAL: You just created a NEW project. Before calling task_add or create_file, you MUST respond with 3-5 numbered discovery questions asking the user about their preferences. Do NOT make any tool calls — respond with text only. Format: "1. Question? (Option A, Option B, Option C)"',
                    });
                } else if (isNewProject) {
                    logger.info('agent-loop', 'init_project created NEW project — user already answered questions, skipping to build');
                    inputItems.push({
                        role: 'user',
                        content: 'The user chose to use recommended defaults. Skip questions entirely. Call task_add to plan tasks, then immediately start building with create_file. Do NOT ask any questions.',
                    });
                }
            }
        }

        // Hit max rounds
        sendCompletionSummary(toolsUsed, _taskStartSnapshot);
        mainWindow?.webContents.send('ai-stream-done', null);
        return { success: true };

    } catch (err) {
        currentAIRequest = null;
        if (err.name === 'AbortError') {
            sendCompletionSummary(toolsUsed, _taskStartSnapshot);
            mainWindow?.webContents.send('ai-stream-done', null);
            return { success: true };
        }
        console.error('[AI] ChatGPT backend request error:', err.message);
        // Check if there are in-progress tasks — inform user they can continue
        const summary = taskManager.getSummary();
        if (summary.inProgress > 0 || summary.pending > 0) {
            const taskStatus = `${summary.done}/${summary.total} tasks done, ${summary.pending} pending`;
            mainWindow?.webContents.send('ai-stream-chunk', `\n\n*[Connection lost — ${taskStatus}. Send another message to continue where you left off.]*`);
            sendCompletionSummary(toolsUsed, _taskStartSnapshot);
        }
        mainWindow?.webContents.send('ai-stream-done', err.message);
        return { error: err.message };
    } finally {
        setAIStreamingActive(false); // Unlock: renderer can now safely reload tasks
    }
}

/**
 * Single streaming call to OpenAI API. Returns accumulated response
 * including any tool_calls. Streams text content to renderer in real-time.
 */
function streamOpenAISingle(messages, providerConfig, includeTools = true, forceToolChoice = false) {
    let endpoint;
    if (providerConfig.id === 'codex') {
        endpoint = 'https://api.openai.com/v1/chat/completions';
    } else {
        const base = (providerConfig.baseUrl || '').replace(/\/$/, '');
        endpoint = `${base}/v1/chat/completions`;
    }

    const model = providerConfig.selectedModel || 'gpt-4o-mini';
    const isOModel = model.startsWith('o');

    const bodyObj = {
        model,
        messages: isOModel ? messages.filter((m) => m.role !== 'system') : messages,
        stream: true,
    };

    // Apply reasoning effort for models that support it
    const reasoningEffort = providerConfig.reasoningEffort || 'medium';
    if (reasoningEffort && reasoningEffort !== 'medium') {
        bodyObj.reasoning_effort = reasoningEffort;
    }

    // Add tools for function calling (skip for o-models which may not support tools well)
    if (includeTools && !isOModel) {
        bodyObj.tools = getAllToolDefinitions();
        bodyObj.tool_choice = forceToolChoice ? 'required' : 'auto';
    }

    if (isOModel) bodyObj.max_completion_tokens = 16384;
    else bodyObj.max_tokens = 16384;

    const bodyStr = JSON.stringify(bodyObj);

    try {
        const url = new URL(endpoint);
        const mod = url.protocol === 'https:' ? https : http;

        return new Promise((resolve) => {
            const req = mod.request({
                hostname: url.hostname,
                port: url.port || undefined,
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${providerConfig.apiKey}`,
                    'Content-Length': Buffer.byteLength(bodyStr),
                },
            }, (res) => {
                if (res.statusCode !== 200) {
                    let data = '';
                    res.on('data', (c) => { data += c; });
                    res.on('end', () => {
                        currentAIRequest = null;
                        let errorMsg = `HTTP ${res.statusCode}`;
                        try { errorMsg = JSON.parse(data).error?.message || errorMsg; } catch { }
                        if (res.statusCode === 401) errorMsg = 'Authentication failed (401). Check your API key.';
                        if (res.statusCode === 403) errorMsg = `Access denied for model "${model}". Try a different model.`;
                        console.error('[AI] OpenAI API error:', res.statusCode, data.slice(0, 200));
                        resolve({ error: errorMsg });
                    });
                    return;
                }

                // Accumulators
                let textContent = '';
                const toolCalls = {};  // index -> { id, name, arguments }
                let finishReason = null;
                let buffer = '';

                function processLine(trimmed) {
                    if (!trimmed || trimmed === 'data: [DONE]') return;
                    if (!trimmed.startsWith('data: ')) return;
                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        const choice = json.choices?.[0];
                        if (!choice) return;

                        // Track finish reason
                        if (choice.finish_reason) finishReason = choice.finish_reason;

                        const delta = choice.delta;
                        if (!delta) return;

                        // Text content — stream to renderer
                        if (delta.content) {
                            textContent += delta.content;
                            mainWindow?.webContents.send('ai-stream-chunk', delta.content);
                        }

                        // Tool calls — accumulate
                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                const idx = tc.index;
                                if (!toolCalls[idx]) {
                                    toolCalls[idx] = { id: tc.id || '', name: '', arguments: '' };
                                }
                                if (tc.id) toolCalls[idx].id = tc.id;
                                if (tc.function?.name) toolCalls[idx].name = tc.function.name;
                                if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
                            }
                        }
                    } catch { }
                }

                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) processLine(line.trim());
                });

                res.on('end', () => {
                    // Process remaining buffer
                    if (buffer.trim()) processLine(buffer.trim());

                    const toolCallsArray = Object.values(toolCalls).filter(tc => tc.name);
                    resolve({
                        textContent,
                        toolCalls: toolCallsArray,
                        finishReason,
                        hasToolCalls: toolCallsArray.length > 0,
                    });
                });

                res.on('error', (err) => {
                    currentAIRequest = null;
                    resolve({ error: err.message });
                });
            });

            currentAIRequest = req;
            req.on('error', (err) => {
                currentAIRequest = null;
                resolve({ error: err.message });
            });
            req.write(bodyStr);
            req.end();
        });
    } catch (err) {
        return Promise.resolve({ error: err.message || 'Unknown error' });
    }
}

/**
 * Wrapper for sub-agent AI calls.
 * Accepts messages, providerConfig, and optional tool overrides.
 * Returns { textContent, toolCalls, hasToolCalls } or { error }.
 *
 * Dual-mode: detects OAuth JWT tokens and routes to the ChatGPT Responses API,
 * otherwise uses the standard OpenAI Chat Completions API.
 */
function makeSubAgentAICall(messages, providerConfig, toolOverrides) {
    // OAuth tokens → ChatGPT Responses API
    if (providerConfig.id === 'codex' && isOAuthToken(providerConfig.apiKey)) {
        return makeSubAgentOAuthCall(messages, providerConfig, toolOverrides);
    }
    // Standard sk- keys and gateways → Chat Completions API
    return makeSubAgentCompletionsCall(messages, providerConfig, toolOverrides);
}

/**
 * Sub-agent call via ChatGPT Responses API (for OAuth JWT tokens).
 * Converts Chat Completions message format to Responses API input format.
 */
async function makeSubAgentOAuthCall(messages, providerConfig, toolOverrides) {
    const accessToken = providerConfig.apiKey;
    const accountId = getAccountId(accessToken);
    if (!accountId) return { error: 'Cannot extract account ID from OAuth token. Re-authenticate in Settings.' };

    const model = providerConfig.selectedModel || 'gpt-4o';

    // Extract system prompt → instructions (Responses API separates these)
    const systemMsgs = messages.filter(m => m.role === 'system');
    const instructions = systemMsgs.map(m => m.content).join('\n\n') || 'You are a specialist AI agent.';

    // Convert Chat Completions messages to Responses API input items
    const inputItems = [];
    for (const msg of messages) {
        if (msg.role === 'system') continue; // Already in instructions

        if (msg.role === 'user') {
            inputItems.push({ role: 'user', content: msg.content });
        } else if (msg.role === 'assistant') {
            if (msg.tool_calls && msg.tool_calls.length > 0) {
                // Assistant text before tool calls
                if (msg.content) {
                    inputItems.push({ role: 'assistant', content: msg.content });
                }
                // Convert tool_calls to function_call items
                for (const tc of msg.tool_calls) {
                    inputItems.push({
                        type: 'function_call',
                        call_id: tc.id || tc.call_id,
                        name: tc.function?.name || tc.name || '',
                        arguments: tc.function?.arguments || tc.arguments || '{}',
                    });
                }
            } else {
                inputItems.push({ role: 'assistant', content: msg.content || '' });
            }
        } else if (msg.role === 'tool') {
            inputItems.push({
                type: 'function_call_output',
                call_id: msg.tool_call_id,
                output: msg.content || '',
            });
        }
    }

    // Build tools in Responses API format
    let tools;
    if (toolOverrides && toolOverrides.length > 0) {
        tools = toResponsesAPITools(toolOverrides);
    }

    const bodyObj = {
        model,
        instructions,
        input: inputItems,
        stream: false, // Sub-agents don't stream to UI
        store: false,
    };
    if (tools && tools.length > 0) {
        bodyObj.tools = tools;
        bodyObj.tool_choice = 'auto';
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s timeout

        const response = await net.fetch('https://chatgpt.com/backend-api/codex/responses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'chatgpt-account-id': accountId,
                'OpenAI-Beta': 'responses=experimental',
                'originator': 'codex_cli_rs',
            },
            body: JSON.stringify(bodyObj),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            if (response.status === 401) return { error: 'OAuth token expired. Re-authenticate in Settings.' };
            if (response.status === 429) return { error: 'Rate limited. Try again in a moment.' };
            let errorMsg = `ChatGPT backend error: ${response.status}`;
            try { const errJson = JSON.parse(errText); errorMsg = errJson.error?.message || errJson.detail || errorMsg; } catch {}
            return { error: errorMsg };
        }

        const json = await response.json();

        // Parse non-streaming Responses API format
        let textContent = '';
        const toolCalls = [];

        const output = json.output || [];
        for (const item of output) {
            if (item.type === 'message' && item.content) {
                for (const part of item.content) {
                    if (part.type === 'output_text' && part.text) {
                        textContent += part.text;
                    }
                }
            } else if (item.type === 'function_call') {
                toolCalls.push({
                    id: item.id || item.call_id,
                    call_id: item.call_id,
                    name: item.name,
                    arguments: item.arguments || '{}',
                });
            }
        }

        return {
            textContent,
            toolCalls,
            hasToolCalls: toolCalls.length > 0,
        };
    } catch (err) {
        if (err.name === 'AbortError') return { error: 'Sub-agent AI call timed out (90s)' };
        return { error: err.message };
    }
}

/**
 * Sub-agent call via standard OpenAI Chat Completions API (for sk- keys and gateways).
 */
function makeSubAgentCompletionsCall(messages, providerConfig, toolOverrides) {
    const bodyObj = {
        model: providerConfig.selectedModel || 'gpt-4o-mini',
        messages,
        stream: false,
    };

    if (toolOverrides && toolOverrides.length > 0) {
        bodyObj.tools = toolOverrides;
        bodyObj.tool_choice = 'auto';
    }

    bodyObj.max_tokens = 16384;

    let endpoint;
    if (providerConfig.id === 'codex') {
        endpoint = 'https://api.openai.com/v1/chat/completions';
    } else {
        const base = (providerConfig.baseUrl || '').replace(/\/$/, '');
        endpoint = `${base}/v1/chat/completions`;
    }

    const bodyStr = JSON.stringify(bodyObj);

    return new Promise((resolve) => {
        const url = new URL(endpoint);
        const mod = url.protocol === 'https:' ? https : http;

        const req = mod.request({
            hostname: url.hostname,
            port: url.port || undefined,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${providerConfig.apiKey}`,
                'Content-Length': Buffer.byteLength(bodyStr),
            },
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) {
                        resolve({ error: json.error.message || 'AI API error' });
                        return;
                    }
                    const choice = json.choices?.[0];
                    if (!choice) {
                        resolve({ error: 'No response from AI' });
                        return;
                    }
                    const textContent = choice.message?.content || '';
                    const toolCalls = (choice.message?.tool_calls || []).map(tc => ({
                        id: tc.id,
                        name: tc.function?.name || '',
                        arguments: tc.function?.arguments || '{}',
                    }));
                    resolve({
                        textContent,
                        toolCalls,
                        hasToolCalls: toolCalls.length > 0,
                    });
                } catch (err) {
                    resolve({ error: `Parse error: ${err.message}` });
                }
            });
        });
        req.on('error', (err) => resolve({ error: err.message }));
        req.setTimeout(90000, () => { req.destroy(); resolve({ error: 'Sub-agent AI call timed out (90s)' }); });
        req.write(bodyStr);
        req.end();
    });
}

// Wire sub-agent AI call function
setAICallFunction(makeSubAgentAICall);

// Wire AI call function to compactor for semantic compaction
setCompactorAICall(makeSubAgentAICall);

/**
 * Context compaction — summarize old messages when conversation gets too long.
 * Keeps the system prompt and last N messages, replaces the middle with a summary.
 * Inspired by OpenCode's compaction agent.
 */
function compactConversation(messages, maxTokenEstimate = 180000) {
    // Rough token estimate: ~4 chars per token
    const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0) + JSON.stringify(m.tool_calls || '').length, 0);
    const estimatedTokens = totalChars / 4;

    if (estimatedTokens < maxTokenEstimate * 0.8) return messages; // Under 80%, no compaction needed

    logger.info('compaction', `Conversation too long (~${Math.round(estimatedTokens)} tokens). Compacting...`);

    // Keep system messages, first user message, and last 20 messages (more context)
    const systemMsgs = messages.filter(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');
    const keepLast = 20;

    if (nonSystem.length <= keepLast + 2) return messages; // Too short to compact

    const firstUserMsg = nonSystem[0];
    const middleMsgs = nonSystem.slice(1, -keepLast);
    const lastMsgs = nonSystem.slice(-keepLast);

    // Build comprehensive context from ALL messages (including compacted ones)
    let filesCreated = new Set();
    let filesModified = new Set();
    let toolsCalled = {};
    let projectPaths = new Set();
    let keyDecisions = [];
    let commandsRun = [];

    for (const msg of middleMsgs) {
        if (msg.role === 'assistant' && msg.content) {
            const sentences = msg.content.split(/\.\s/).slice(0, 2);
            if (sentences.length > 0) keyDecisions.push(sentences[0]);
        }
        if (msg.role === 'assistant' && msg.tool_calls) {
            for (const tc of msg.tool_calls) {
                const name = tc.function?.name || 'unknown';
                toolsCalled[name] = (toolsCalled[name] || 0) + 1;
                try {
                    const args = JSON.parse(tc.function?.arguments || '{}');
                    if (args.file_path) {
                        if (name === 'create_file') filesCreated.add(args.file_path);
                        else filesModified.add(args.file_path);
                    }
                    if (args.project_path) projectPaths.add(args.project_path);
                    if (args.dir_path) projectPaths.add(args.dir_path);
                    if (name === 'run_command' && args.command) {
                        commandsRun.push(args.command.slice(0, 80));
                    }
                } catch { }
            }
        }
        // Also check tool results for file paths
        if (msg.role === 'tool' && msg.content) {
            try {
                const result = JSON.parse(msg.content);
                if (result.path) filesModified.add(result.path);
                if (result.project_path) projectPaths.add(result.project_path);
            } catch { }
        }
    }

    // Also gather current session file context from the tracker
    const trackedCreated = [...(fileContext.createdFiles || [])];
    const trackedModified = [...(fileContext.modifiedFiles?.keys() || [])];
    const trackedRead = [...(fileContext.readFiles?.keys() || [])];

    const toolSummary = Object.entries(toolsCalled).map(([k, v]) => `${k}(${v}x)`).join(', ');
    const createdList = [...filesCreated].join('\n  - ') || 'none';
    const modifiedList = [...filesModified].filter(f => !filesCreated.has(f)).slice(0, 30).join('\n  - ') || 'none';
    const projectList = [...projectPaths].join(', ') || 'unknown';

    const compactionMsg = {
        role: 'user',
        content: `[CONTEXT COMPACTION: The conversation was summarized to save tokens. IMPORTANT: You are still working in the SAME session. All files you created still exist on disk.]\n\n` +
            `**Working directory / project paths:** ${projectList}\n\n` +
            `**Files CREATED (these exist on disk now):**\n  - ${createdList}\n\n` +
            `**Files MODIFIED:**\n  - ${modifiedList}\n\n` +
            `**Tools used:** ${toolSummary || 'none'}\n` +
            (commandsRun.length > 0 ? `**Commands run:** ${commandsRun.slice(-10).join('; ')}\n` : '') +
            (trackedCreated.length > 0 ? `**Session file tracker — created:** ${trackedCreated.join(', ')}\n` : '') +
            (trackedModified.length > 0 ? `**Session file tracker — modified:** ${trackedModified.slice(0, 20).join(', ')}\n` : '') +
            (trackedRead.length > 0 ? `**Session file tracker — read:** ${trackedRead.slice(0, 15).join(', ')}\n` : '') +
            `**Key points:** ${keyDecisions.slice(-10).join('. ') || 'General work'}\n\n` +
            `[Continue from where you left off. The files listed above are REAL and exist on disk — do NOT re-create them. Check task_list if unsure what to do next.]`,
    };

    const compacted = [...systemMsgs, firstUserMsg, compactionMsg, ...lastMsgs];
    logger.info('compaction', `Compacted ${messages.length} messages → ${compacted.length} (kept ${keepLast} recent, ${filesCreated.size} created files tracked)`);

    mainWindow?.webContents.send('ai-agent-step', { round: 0, status: 'compacted', original: messages.length, compacted: compacted.length });
    return compacted;
}

/**
 * Agentic OpenAI loop with tool calling.
 * Streams text, executes tools, loops until done or max iterations.
 * 
 * Key pattern (inspired by claude-code/opencode):
 * When the model responds with text-only but tasks are still pending,
 * inject a continuation prompt to push the model back into tool-calling mode.
 * This prevents the "init_project + task_add then stop" hallucination pattern.
 */
async function streamOpenAI(messages, providerConfig, projectPath) {
    const MAX_TOOL_ROUNDS = 75;  // Support long agentic sessions (50 was too low for complex projects)
    const MAX_AUTO_CONTINUES = 15; // Max times we'll push the model to continue (was 5, too low)
    let conversationMessages = [...messages];
    setAIStreamingActive(true); // Lock: prevent renderer from wiping tasks
    let round = 0;
    let autoContinueCount = 0;
    const toolsUsed = new Set(); // Track which tool types have been called
    let _forceNoToolsNextRound = false; // After init_project, force text-only to get discovery questions
    let _browserNavFailures = 0; // Track consecutive browser_navigate failures
    let _consecutiveTextOnlyRounds = 0; // Track text-only rounds to detect stuck loops
    let _toolOnlyRounds = 0; // Track consecutive tool-only rounds for synthetic status
    const _roundToolNames = []; // Collect tool names for status generation

    // Snapshot task state at request start so completion summary only shows changes
    const _taskStartSnapshot = { ...taskManager.getSummary() };

    // Wire provider config for sub-agent + orchestrator use
    setLastProviderConfig(providerConfig);
    _lastProviderConfig = providerConfig;

    // Start or continue agentic session (preserves tasks for same project)
    startSession(null, projectPath);

    // Sync permissions to aiTools
    setPermissions(activePermissions);
    setAgentModeRef(agentMode);

    // Inject project file context at session start so the AI knows what exists
    const initialContext = buildContinueContext();
    if (initialContext && round === 0) {
        // Find the last system message and append project context
        const lastSystemIdx = conversationMessages.findLastIndex(m => m.role === 'system');
        if (lastSystemIdx >= 0) {
            conversationMessages[lastSystemIdx] = {
                ...conversationMessages[lastSystemIdx],
                content: conversationMessages[lastSystemIdx].content + '\n\n## Current Session State\n' + initialContext,
            };
        }
    }

    // Inject previous session context when continuing work on a project
    if (projectPath) {
        try {
            const { conversationStorage: convStore } = require('./storage');
            const contextParts = [];

            // 1. Task history — show what tasks exist from previous/current sessions
            const taskSummary = taskManager.getSummary();
            if (taskSummary.total > 0) {
                const taskLines = taskSummary.tasks.map(t =>
                    `  [${t.status.toUpperCase()}] #${t.id}: ${t.content}`
                );
                contextParts.push(`Existing tasks (${taskSummary.done}/${taskSummary.total} done):\n${taskLines.join('\n')}`);
            }

            // 2. Previous conversation context (for new conversations only)
            if (conversationMessages.length <= 3) {
                // Find project conversations by searching recent ones
                const recent = convStore.list(10, 0);
                const projConv = recent.find(c => {
                    if (c.project_name && projectPath.includes(c.project_name)) return true;
                    return false;
                });
                if (projConv) {
                    const lastConv = convStore.getLatestForProject(projConv.project_id);
                    if (lastConv?.messages) {
                        const msgs = typeof lastConv.messages === 'string' ? JSON.parse(lastConv.messages) : lastConv.messages;
                        if (msgs.length > 2) {
                            const userMsgs = msgs.filter(m => m.role === 'user');
                            const aiMsgs = msgs.filter(m => m.role === 'ai' || m.role === 'assistant');
                            if (userMsgs.length > 0) {
                                contextParts.push(`Previous session request: "${userMsgs[0].content?.slice(0, 300)}"`);
                            }
                            if (aiMsgs.length > 0) {
                                contextParts.push(`Last AI summary: "${aiMsgs[aiMsgs.length - 1].content?.slice(0, 500)}"`);
                            }
                            const toolSteps = msgs.flatMap(m => m.toolSteps || []).filter(s => s.status === 'done');
                            if (toolSteps.length > 0) {
                                const toolNames = [...new Set(toolSteps.map(s => s.name))];
                                contextParts.push(`Tools used last session: ${toolNames.join(', ')}`);
                            }
                        }
                    }
                }
            }

            // 3. Project directory listing — show what files exist
            const fs = require('fs');
            if (fs.existsSync(projectPath)) {
                const listDir = (dir, depth = 0, max = 2) => {
                    if (depth >= max) return [];
                    try {
                        return fs.readdirSync(dir, { withFileTypes: true })
                            .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== '.git')
                            .sort((a, b) => (a.isDirectory() === b.isDirectory()) ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1)
                            .flatMap(e => {
                                const p = require('path').join(dir, e.name);
                                return e.isDirectory() ? [`${'  '.repeat(depth)}${e.name}/`, ...listDir(p, depth + 1, max)] : [`${'  '.repeat(depth)}${e.name}`];
                            });
                    } catch { return []; }
                };
                const listing = listDir(projectPath);
                if (listing.length > 0) {
                    contextParts.push(`Project directory (${projectPath}):\n${listing.slice(0, 40).join('\n')}`);
                }
            }

            // Inject context into system message
            if (contextParts.length > 0) {
                const lastSystemIdx = conversationMessages.findLastIndex(m => m.role === 'system');
                if (lastSystemIdx >= 0) {
                    conversationMessages[lastSystemIdx] = {
                        ...conversationMessages[lastSystemIdx],
                        content: conversationMessages[lastSystemIdx].content +
                            '\n\n## Project Context (auto-injected)\n' +
                            contextParts.join('\n\n') +
                            '\n\nUse this context to understand the current state. Check task_list before adding new tasks. Do NOT repeat completed work or re-create existing files.',
                    };
                }
            }
        } catch { /* context injection failed, proceed without */ }
    }

    // ── Pre-retrieval: gather context BEFORE the model is called ──
    if (projectPath && conversationMessages.length > 0) {
        try {
            const lastUserMsg = [...conversationMessages].reverse().find(m => m.role === 'user');
            if (lastUserMsg?.content) {
                const workingSet = [...(fileContext.readFiles?.keys() || []), ...(fileContext.modifiedFiles?.keys() || [])];
                const preResult = await Promise.race([
                    preRetrieve(lastUserMsg.content, projectPath, workingSet),
                    new Promise(resolve => setTimeout(() => resolve(null), 2000)),
                ]);
                const preContext = assemblePreRetrievedContext(preResult);
                if (preContext) {
                    const lastSystemIdx = conversationMessages.findLastIndex(m => m.role === 'system');
                    if (lastSystemIdx >= 0) {
                        conversationMessages[lastSystemIdx] = {
                            ...conversationMessages[lastSystemIdx],
                            content: conversationMessages[lastSystemIdx].content + '\n\n' + preContext,
                        };
                    }
                }
            }
        } catch { /* pre-retrieval failed, continue without */ }
    }

    try {
    while (round < MAX_TOOL_ROUNDS) {
        round++;

        // Auto-compact conversation if it's getting too long
        // Check actual token estimate before compacting
        if (round > 3) {
            const totalChars = conversationMessages.reduce((sum, m) => sum + (m.content?.length || 0) + JSON.stringify(m.tool_calls || '').length, 0);
            const estTokens = totalChars / 4;
            if (estTokens > 80000) {
                logger.info('compaction', `Auto-compact triggered at round ${round}, ~${Math.round(estTokens)} tokens`);
                try {
                    conversationMessages = await semanticCompact(conversationMessages);
                } catch {
                    conversationMessages = compactConversation(conversationMessages);
                }
            }
        }

        // Notify renderer of agentic step
        if (round > 1) {
            mainWindow?.webContents.send('ai-agent-step', { round, status: 'thinking' });
        }

        // Use forceToolChoice on auto-continuation rounds to guarantee tool calls
        // BUT if we just did init_project, force text-only so AI asks discovery questions
        const forceTools = _forceNoToolsNextRound ? false : (autoContinueCount > 0);
        const includeTools = !_forceNoToolsNextRound;
        _forceNoToolsNextRound = false; // Reset for next iteration
        // ── Stream with auto-retry for transient network errors ──
        let result;
        const TRANSIENT_ERRORS = ['ERR_QUIC_PROTOCOL_ERROR', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ERR_CONNECTION_RESET', 'ERR_NETWORK_CHANGED', 'EPIPE', 'socket hang up', 'network error'];
        const MAX_RETRIES = 2;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            result = await streamOpenAISingle(conversationMessages, providerConfig, includeTools, forceTools);
            if (!result.error) break;
            const isTransient = TRANSIENT_ERRORS.some(e => result.error.includes(e));
            if (!isTransient || attempt === MAX_RETRIES) break;
            const delay = (attempt + 1) * 3000; // 3s, 6s
            logger.warn('agent-loop', `Transient error "${result.error}" — retrying in ${delay/1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
            mainWindow?.webContents.send('ai-stream-chunk', `\n*[Network error — retrying in ${delay/1000}s...]*\n`);
            await new Promise(r => setTimeout(r, delay));
        }

        if (result.error) {
            // Check if there are in-progress tasks — inform user they can continue
            const errSummary = taskManager.getSummary();
            if (errSummary.inProgress > 0 || errSummary.pending > 0) {
                const taskStatus = `${errSummary.done}/${errSummary.total} tasks done, ${errSummary.pending} pending`;
                mainWindow?.webContents.send('ai-stream-chunk', `\n\n*[Connection lost — ${taskStatus}. Send another message to continue where you left off.]*`);
                sendCompletionSummary(toolsUsed, _taskStartSnapshot);
            }
            mainWindow?.webContents.send('ai-stream-done', result.error);
            return { error: result.error };
        }

        // ── Handle finish_reason: length (truncated response) ──
        if (result.finishReason === 'length' && !result.hasToolCalls) {
            logger.info('agent-loop', `Response truncated (finish_reason=length) at round ${round}. Requesting continuation.`);
            if (result.textContent) {
                conversationMessages.push({ role: 'assistant', content: result.textContent });
            }
            conversationMessages.push({ role: 'user', content: 'Your previous response was truncated due to length limits. Continue exactly where you left off. Do NOT repeat what you already said.' });
            continue; // Loop back — this does NOT count against MAX_AUTO_CONTINUES
        }

        // ── Text-only response: check if we should auto-continue ──
        if (!result.hasToolCalls) {
            const summary = taskManager.getSummary();
            const hasPendingTasks = summary.pending > 0 || summary.inProgress > 0;
            const hasBuiltAnything = toolsUsed.has('create_file') || toolsUsed.has('run_command');
            const justInitProject = toolsUsed.has('init_project') && !hasBuiltAnything && summary.total === 0;
            const aiTextContent = result.textContent || '';

            // Detect if the AI is announcing intent to act without making tool calls
            // Triggers when AI used discovery/read tools but hasn't built anything yet
            const announcesIntent = /\b(I'll|I will|let me|I'm going to|I'm now|on it|working on|starting|proceeding|I need to|I can fix|I'll now|implementing|adding|creating|wiring|building)\b/i.test(aiTextContent)
                && aiTextContent.length < 500
                && round < 10
                && !hasBuiltAnything;

            // If the AI is asking discovery questions after init_project, let the response
            // end naturally so the user can answer. Don't force auto-continue.
            // BUT: if user already said "use defaults" / "just build it", don't pause.
            if (justInitProject && looksLikeDiscoveryQuestions(aiTextContent) && !userWantsToSkipQuestions(conversationMessages)) {
                logger.info('agent-loop', 'AI is asking discovery questions after init_project — pausing for user input');
                currentAIRequest = null;
                sendCompletionSummary(toolsUsed, _taskStartSnapshot);
                mainWindow?.webContents.send('ai-stream-done', null);
                try { executeHook('AIResponse', { projectDir: projectPath || '' }); } catch {}
                return { success: true };
            }

            // Auto-continue if:
            // 1. Tasks are pending (normal case)
            // 2. init_project was called but no tasks or files were created yet (post-init stall)
            // 3. AI announced intent but made zero tool calls (stalling)
            if ((hasPendingTasks || justInitProject || announcesIntent) && autoContinueCount < MAX_AUTO_CONTINUES) {
                autoContinueCount++;
                _consecutiveTextOnlyRounds++;
                logger.info('agent-loop', `Auto-continue #${autoContinueCount}/${MAX_AUTO_CONTINUES} (force tool_choice:required): ${summary.pending} pending, ${summary.inProgress} active, ${summary.done}/${summary.total} done${justInitProject ? ' [post-init]' : ''}${announcesIntent ? ' [intent-detected]' : ''} [textOnly=${_consecutiveTextOnlyRounds}]`);

                // Circuit breaker: if AI sent 3+ text-only rounds in a row, it's stuck repeating itself
                if (_consecutiveTextOnlyRounds >= 3) {
                    logger.warn('agent-loop', `AI stuck in text-only loop (${_consecutiveTextOnlyRounds} rounds). Force-closing remaining in_progress tasks and stopping.`);
                    for (const t of summary.tasks) {
                        if (t.status === 'in_progress') {
                            taskManager.update(t.id, 'done');
                            logger.info('agent-loop', `Auto-closed stuck task #${t.id}: ${t.content}`);
                        }
                    }
                    currentAIRequest = null;
                    sendCompletionSummary(toolsUsed, _taskStartSnapshot);
                    mainWindow?.webContents.send('ai-stream-done', null);
                    try { executeHook('AIResponse', { projectDir: projectPath || '' }); } catch {}
                    return { success: true };
                }

                // Add the assistant's text response to conversation
                if (result.textContent) {
                    conversationMessages.push({ role: 'assistant', content: result.textContent });
                }

                // Build continuation prompt
                const projectContext = buildContinueContext();
                const nextTask = summary.nextTask;
                const roundsLeft = MAX_TOOL_ROUNDS - round;
                const taskStatusLine = `${summary.done}/${summary.total} tasks done${summary.inProgress > 0 ? `, ${summary.inProgress} IN PROGRESS (must finish!)` : ''}${summary.pending > 0 ? `, ${summary.pending} pending` : ''}`;

                // Detect if AI wrote a completion summary but forgot to mark tasks done
                const looksLikeDoneSummary = /\b(done|completed|finished|all.*tasks|that's it|everything.*(work|done))\b/i.test(aiTextContent)
                    && summary.inProgress > 0
                    && summary.pending === 0;
                const inProgressTasks = summary.tasks.filter(t => t.status === 'in_progress');

                let continuePrompt;
                if (looksLikeDoneSummary && inProgressTasks.length > 0) {
                    const taskIds = inProgressTasks.map(t => `task_update({ id: ${t.id}, status: "done" })`).join(', then ');
                    continuePrompt = `You just wrote a completion summary, but ${inProgressTasks.length} task(s) are still marked in_progress. You MUST call ${taskIds} RIGHT NOW. Do NOT write any text — just make the tool calls.`;
                    logger.info('agent-loop', `Detected done-summary with ${inProgressTasks.length} in_progress tasks — forcing task_update`);
                } else if (announcesIntent && !hasPendingTasks) {
                    continuePrompt = `STOP TALKING. You just said "${aiTextContent.slice(0, 100)}..." but made ZERO tool calls. DO NOT describe what you'll do — USE TOOLS NOW. Call task_add to plan tasks, then create_file or edit_file to implement. Every response MUST contain tool calls.\n\n${projectContext}`;
                    logger.info('agent-loop', `Detected intent-without-action — forcing tool use (round ${round})`);
                } else if (justInitProject && !userWantsToSkipQuestions(conversationMessages)) {
                    continuePrompt = `MANDATORY: You just initialized the project. Before adding tasks, ask the user 3-5 quick setup questions to clarify their preferences (tech stack, features, design style, etc.). Format as numbered questions with options in parentheses so the UI can render them as interactive buttons. Example:\n1. What tech stack? (React + Vite, Next.js, Vue)\n2. Auth needed? (yes, no, later)\n\nDo NOT add tasks or create files yet — ask questions first.\n\n${projectContext}`;
                } else if (justInitProject) {
                    continuePrompt = `The user chose recommended defaults — skip all questions. Call task_add to plan 4-6 tasks, then immediately call create_file to start building. Do NOT ask any questions. Start NOW.\n\n${projectContext}`;
                } else if (!hasBuiltAnything) {
                    continuePrompt = `MANDATORY: You have ${summary.pending} pending${summary.inProgress > 0 ? ` + ${summary.inProgress} in-progress` : ''} tasks and have NOT created any files yet. You MUST call create_file or run_command NOW. Do not respond with text — make tool calls immediately. First task: "${nextTask?.content || 'unknown'}"\n\n⏱️ Budget: ${roundsLeft} rounds remaining. EFFICIENCY: Call create_file MULTIPLE TIMES in the same response. Batch 3-5 file creations per round.\n\n${projectContext}`;
                } else {
                    continuePrompt = `MANDATORY: ${taskStatusLine}. Continue with tool calls NOW — do NOT repeat any status updates you already gave.${nextTask ? `\nNext task: "${nextTask.content}" (${nextTask.status})` : ''}\n\n⏱️ ${roundsLeft} rounds left. Batch 3-5 file ops per round. Mark tasks done immediately.\n${roundsLeft < 15 ? '⚠️ LOW ROUNDS — finish remaining tasks NOW.\n' : ''}\n${projectContext}`;
                }

                conversationMessages.push({ role: 'user', content: continuePrompt });

                // Notify renderer that agent is auto-continuing
                mainWindow?.webContents.send('ai-agent-step', { round, status: 'continuing', pending: summary.pending });
                continue; // Loop back for another round
            }

            // Actually done (no pending tasks, or max auto-continues reached)
            if (hasPendingTasks) {
                // Reached MAX_AUTO_CONTINUES with tasks still pending — notify user
                logger.warn('agent-loop', `Max auto-continues (${MAX_AUTO_CONTINUES}) reached with ${summary.pending} tasks still pending`);
                mainWindow?.webContents.send('ai-stream-chunk', `\n\n*[Agent paused — ${summary.pending} tasks still pending. Send another message to continue.]*`);
            }
            currentAIRequest = null;
            sendCompletionSummary(toolsUsed, _taskStartSnapshot);
            mainWindow?.webContents.send('ai-stream-done', null);
            // Post-response hooks and memory extraction (background, non-blocking)
            try { executeHook('AIResponse', { projectDir: projectPath || '' }); } catch {}
            try { extractAndSaveMemory(conversationMessages, providerConfig); } catch {}
            return { success: true };
        }

        // ── Tool calling round ──
        autoContinueCount = 0; // Reset auto-continue counter on successful tool calls
        _consecutiveTextOnlyRounds = 0; // Reset — AI made tool calls

        // ── Break message bubble when AI emitted text before tool calls ──
        // This creates the "text update → tool group → text update" pattern
        const roundText = result.textContent || '';
        if (roundText.trim()) {
            sendMessageBreak();
        }

        // Add assistant message with tool calls to conversation
        const assistantMsg = { role: 'assistant', content: result.textContent || null };
        assistantMsg.tool_calls = result.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
        }));
        conversationMessages.push(assistantMsg);

        // Execute each tool call
        for (const tc of result.toolCalls) {
            let args;
            try {
                args = JSON.parse(tc.arguments);
            } catch (parseErr) {
                logger.warn('tool-args', `Malformed JSON in ${tc.name} tool call: ${tc.arguments?.slice(0, 200)}`);
                // Try to salvage — common issue is trailing garbage from streaming
                const cleaned = (tc.arguments || '').replace(/[}\]]*\s*,?\s*\{[^}]*$/g, '').trim();
                try { args = JSON.parse(cleaned.endsWith('}') ? cleaned : cleaned + '}'); } catch { args = {}; }
            }

            // Track tool types used
            toolsUsed.add(tc.name);

            // Notify renderer: tool call starting
            mainWindow?.webContents.send('ai-tool-call', {
                id: tc.id,
                name: tc.name,
                args,
                round,
            });

            // Execute the tool (with init_project guard)
            logger.toolCall(tc.name, args, round);
            let toolResult;
            if (tc.name === 'init_project' && _currentProjectPath) {
                // HARD GUARD: Block duplicate init_project when a project is already active
                logger.warn('agent-loop', `Blocked duplicate init_project call — project already active at ${_currentProjectPath}`);
                toolResult = {
                    success: true,
                    already_registered: true,
                    project_path: _currentProjectPath,
                    message: `A project is ALREADY initialized at ${_currentProjectPath}. Do NOT call init_project again. Proceed directly with task_add to plan tasks, then create_file to build.`,
                };
            } else {
                toolResult = await executeAnyTool(tc.name, args);
            }
            logger.toolResult(tc.name, toolResult, round);

            // Track browser_navigate failures — block AI from calling it again after 3 cumulative failures
            // (Note: aiTools.js already retries internally up to 3 times with progressive delays)
            if (tc.name === 'browser_navigate') {
                if (toolResult?.error && /ECONNREFUSED|CONNECTION_REFUSED|ERR_CONNECTION_REFUSED/i.test(toolResult.error)) {
                    _browserNavFailures++;
                    if (_browserNavFailures >= 3) {
                        toolResult.STOP_RETRYING = 'Browser navigation has failed multiple times with CONNECTION_REFUSED (including internal retries). The dev server is not running or crashed. Do NOT call browser_navigate again — skip browser testing and move on.';
                        logger.warn('browser', `browser_navigate failed ${_browserNavFailures} times (cumulative) — injecting stop-retry directive`);
                    }
                } else if (!toolResult?.error) {
                    _browserNavFailures = 0; // Reset on success
                }
            }

            // Notify renderer: tool result
            mainWindow?.webContents.send('ai-tool-result', {
                id: tc.id,
                name: tc.name,
                result: toolResult,
                round,
            });

            // Add tool result to conversation
            conversationMessages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify(toolResult),
            });
        }

        // ── Track tool-only rounds and inject synthetic status every 3 rounds ──
        const roundToolNames = result.toolCalls.map(tc => tc.name);
        _roundToolNames.push(...roundToolNames);
        const hasTextThisRound = (result.textContent || '').trim().length > 0;
        if (!hasTextThisRound) {
            _toolOnlyRounds++;
        } else {
            _toolOnlyRounds = 0;
            _roundToolNames.length = 0;
        }
        if (_toolOnlyRounds >= 3) {
            const counts = {};
            for (const n of _roundToolNames) counts[n] = (counts[n] || 0) + 1;
            const parts = [];
            if (counts.read_file || counts.smart_read) parts.push(`Read ${(counts.read_file || 0) + (counts.smart_read || 0)} files`);
            if (counts.find_implementation) parts.push(`Found ${counts.find_implementation} implementations`);
            if (counts.edit_file || counts.multi_edit) parts.push(`Edited ${(counts.edit_file || 0) + (counts.multi_edit || 0)} files`);
            if (counts.create_file) parts.push(`Created ${counts.create_file} files`);
            if (counts.task_add) parts.push(`Added ${counts.task_add} tasks`);
            if (counts.run_command) parts.push(`Ran ${counts.run_command} commands`);
            if (counts.search_files || counts.batch_search) parts.push(`Searched ${(counts.search_files || 0) + (counts.batch_search || 0)} queries`);
            if (counts.orchestrate) parts.push(`Orchestrated ${counts.orchestrate} multi-agent task${counts.orchestrate > 1 ? 's' : ''}`);
            if (counts.spawn_specialist) parts.push(`Spawned ${counts.spawn_specialist} specialist${counts.spawn_specialist > 1 ? 's' : ''}`);
            if (parts.length === 0) {
                const uniqueTools = [...new Set(_roundToolNames)].slice(0, 4);
                parts.push(uniqueTools.join(', '));
            }
            const synthSummary = taskManager.getSummary();
            const taskStatus = synthSummary.total > 0 ? ` (${synthSummary.done}/${synthSummary.total} tasks done)` : '';
            sendMessageBreak();
            mainWindow?.webContents.send('ai-stream-chunk', parts.join(', ') + '.' + taskStatus);
            sendMessageBreak();
            _toolOnlyRounds = 0;
            _roundToolNames.length = 0;
        }

        // ── Per-round: break message bubble when a task is completed ──
        const postRoundSummary = taskManager.getSummary();
        if (postRoundSummary.done > _taskStartSnapshot.done) {
            sendMessageBreak();
            _taskStartSnapshot.done = postRoundSummary.done;
        }

        // ── Post-round: check if init_project was called for a NEW project ──
        const initCallThisRound = result.toolCalls?.find(tc => tc.name === 'init_project');
        if (initCallThisRound) {
            const initResultMsg = conversationMessages.findLast(m => m.role === 'tool' && m.tool_call_id === initCallThisRound.id);
            let isNewProject = true;
            let initProjectPath = null;
            try {
                const parsed = JSON.parse(initResultMsg?.content || '{}');
                isNewProject = !parsed.already_registered;
                initProjectPath = parsed.project_path;
            } catch {}

            // Update projectPath for this session so follow-up calls use the correct project
            if (initProjectPath) {
                projectPath = initProjectPath;
                _currentProjectPath = initProjectPath;
                startSession(null, initProjectPath);
                logger.info('agent-loop', `Updated session projectPath after init_project: ${initProjectPath}`);
            }

            if (isNewProject && !userWantsToSkipQuestions(conversationMessages)) {
                logger.info('agent-loop', 'init_project created NEW project — forcing text-only next round for discovery questions');
                _forceNoToolsNextRound = true;
                conversationMessages.push({
                    role: 'user',
                    content: 'CRITICAL: You just created a NEW project. Before calling task_add or create_file, you MUST respond with 3-5 numbered discovery questions asking the user about their preferences. Do NOT make any tool calls — respond with text only. Format: "1. Question? (Option A, Option B, Option C)"',
                });
            } else if (isNewProject) {
                logger.info('agent-loop', 'init_project created NEW project — user already answered questions, skipping to build');
                conversationMessages.push({
                    role: 'user',
                    content: 'The user chose to use recommended defaults. Skip questions entirely. Call task_add to plan tasks, then immediately start building with create_file. Do NOT ask any questions.',
                });
            }
        }

        // Loop back for next round — AI will see tool results and decide next action
    }

    // Safety: max rounds reached
    sendCompletionSummary(toolsUsed, _taskStartSnapshot);
    mainWindow?.webContents.send('ai-stream-chunk', '\n\n*[Reached maximum tool-calling rounds. Stopping.]*');
    mainWindow?.webContents.send('ai-stream-done', null);
    try { executeHook('Stop', { projectDir: projectPath || '' }); } catch {}
    try { extractAndSaveMemory(conversationMessages, providerConfig); } catch {}
    currentAIRequest = null;
    return { success: true };

    } finally {
        setAIStreamingActive(false); // Unlock: renderer can now safely reload tasks
    }
}

ipcMain.handle('ai-abort', () => {
    if (currentAIRequest) {
        try {
            // AbortController (fetch-based) or raw request (https-based)
            if (typeof currentAIRequest.abort === 'function') currentAIRequest.abort();
            else if (typeof currentAIRequest.destroy === 'function') currentAIRequest.destroy();
        } catch { }
        currentAIRequest = null;
    }
    return { success: true };
});

// ══════════════════════════════════════════
//  IPC: Ask User Question (Cascade-level)
// ══════════════════════════════════════════

ipcMain.handle('ai-user-answer', (_event, { questionId, answer }) => {
    resolveUserAnswer(questionId, answer);
    return { success: true };
});

ipcMain.handle('ai-permission-response', (_event, { approvalId, approved }) => {
    resolvePermissionApproval(approvalId, approved);
    return { success: true };
});

// ══════════════════════════════════════════
//  IPC: Agent & Process Runtime
// ══════════════════════════════════════════

ipcMain.handle('list-agents', () => {
    return listAgents();
});

ipcMain.handle('list-background-processes', () => {
    return getBackgroundProcesses().map(p => ({
        id: p.id || String(p.pid),
        command: p.command || 'unknown',
        status: p.running ? 'running' : (p.exitCode != null ? (p.exitCode === 0 ? 'done' : 'error') : 'done'),
        pid: p.pid,
        port: p.port,
        startedAt: p.startedAt,
    }));
});

ipcMain.handle('kill-background-process', async (_event, processId) => {
    const procs = getBackgroundProcesses();
    const proc = procs.find(p => p.id === processId);
    if (!proc) return { error: 'Process not found' };
    try {
        if (proc.pid) {
            // Kill the process group (negative PID) for background spawns
            try { process.kill(-proc.pid, 'SIGTERM'); } catch {
                process.kill(proc.pid, 'SIGTERM');
            }
        }
        return { success: true };
    } catch (err) {
        return { error: err.message };
    }
});

ipcMain.handle('read-file-content', async (_event, filePath) => {
    const fs = require('fs');
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const stats = fs.statSync(filePath);
        return { content, size: stats.size, modified: stats.mtime.toISOString() };
    } catch (err) {
        return { error: err.message };
    }
});

ipcMain.handle('read-screenshot-base64', async (_event, filePath) => {
    try {
        const home = require('os').homedir();
        const allowedPrefixes = [
            path.join(home, '.onicode'),
            path.join(home, 'OniProjects'),
        ];
        if (!allowedPrefixes.some(prefix => filePath.startsWith(prefix))) {
            return { error: 'Forbidden' };
        }
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
        const mime = mimeMap[ext] || 'image/png';
        return { dataUri: `data:${mime};base64,${data.toString('base64')}` };
    } catch {
        return { error: 'Not found' };
    }
});

// ══════════════════════════════════════════
//  IPC: Task Management (for UI)
// ══════════════════════════════════════════

ipcMain.handle('list-project-tasks', async (_event, projectPath) => {
    try {
        const { taskStorage } = require('./storage');
        return taskStorage.getProjectTaskSummary(projectPath);
    } catch {
        return { pending: [], inProgress: [], done: [], archived: [], skipped: [] };
    }
});

ipcMain.handle('archive-completed-tasks', async () => {
    try {
        const { taskStorage } = require('./storage');
        const sessionId = getSessionId();
        if (sessionId) taskStorage.archiveCompleted(sessionId);
        // Also update in-memory tasks
        taskManager.tasks.forEach(t => {
            if (t.status === 'done' || t.status === 'skipped') t.status = 'archived';
        });
        taskManager._notifyRenderer();
        return { success: true };
    } catch (err) {
        return { error: err.message };
    }
});

// ══════════════════════════════════════════
//  Session Title Auto-Generation
// ══════════════════════════════════════════

/**
 * Generate a short title for a conversation based on the first user message.
 * Uses a lightweight AI call (non-streaming, no tools).
 */
async function generateSessionTitle(userMessage, providerConfig) {
    if (!providerConfig?.apiKey && providerConfig?.id !== 'codex') return null;
    try {
        const titleMessages = [
            { role: 'system', content: 'Generate a short title (3-6 words, no quotes) for this conversation based on the user message. Reply with ONLY the title, nothing else.' },
            { role: 'user', content: userMessage.slice(0, 500) },
        ];

        let endpoint;
        if (providerConfig.id === 'codex') {
            endpoint = 'https://api.openai.com/v1/chat/completions';
        } else {
            const base = (providerConfig.baseUrl || '').replace(/\/$/, '');
            endpoint = `${base}/v1/chat/completions`;
        }

        const bodyStr = JSON.stringify({
            model: providerConfig.selectedModel || 'gpt-4o-mini',
            messages: titleMessages,
            max_tokens: 20,
        });

        const url = new URL(endpoint);
        const mod = url.protocol === 'https:' ? https : http;

        return new Promise((resolve) => {
            const req = mod.request({
                hostname: url.hostname,
                port: url.port || undefined,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${providerConfig.apiKey}`,
                    'Content-Length': Buffer.byteLength(bodyStr),
                },
            }, (res) => {
                let data = '';
                res.on('data', (c) => { data += c; });
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        const title = json.choices?.[0]?.message?.content?.trim();
                        if (title) {
                            mainWindow?.webContents.send('ai-session-title', title);
                            resolve(title);
                        } else resolve(null);
                    } catch { resolve(null); }
                });
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
            req.setTimeout(5000);
            req.write(bodyStr);
            req.end();
        });
    } catch { return null; }
}

// ══════════════════════════════════════════
//  Auto Memory Extraction
// ══════════════════════════════════════════

/**
 * After each conversation exchange, extract learnings and append to daily memory log.
 * Runs in background — non-blocking. OpenClaw-style memory building.
 */
function extractAndSaveMemory(messages, providerConfig) {
    if (!providerConfig?.apiKey || messages.length < 4) return; // Need enough context
    try {
        const { appendMemory, readMemory, appendProjectMemory, todayString } = require('./memory');
        const today = todayString();

        // Extract key facts from the conversation
        const userMsgs = messages.filter(m => m.role === 'user').map(m => m.content.slice(0, 300));

        // Simple heuristic extraction (no AI call needed — fast and free)
        const learnings = [];
        const projectLearnings = [];

        // Detect user preferences
        for (const msg of userMsgs) {
            const lower = msg.toLowerCase();
            if (lower.includes('i prefer') || lower.includes('i like') || lower.includes('always use') || lower.includes('never use')) {
                learnings.push(`User preference: ${msg.slice(0, 150)}`);
            }
            if (lower.includes('my name is')) {
                const match = msg.match(/my name is\s+(\w+)/i);
                if (match) learnings.push(`User name: ${match[1]}`);
            }
            if (lower.match(/use\s+(typescript|python|rust|go|java|react|vue|angular|next|svelte)/i)) {
                const match = msg.match(/use\s+(typescript|python|rust|go|java|react|vue|angular|next|svelte)/i);
                if (match) learnings.push(`Tech preference: ${match[1]}`);
            }
        }

        // Detect project patterns from tool calls
        const toolSteps = messages.flatMap(m => m.toolSteps || []);
        const filesCreated = toolSteps.filter(s => s.name === 'create_file').map(s => s.args?.file_path).filter(Boolean);
        const filesEdited = toolSteps.filter(s => s.name === 'edit_file').map(s => s.args?.file_path).filter(Boolean);
        const projectsCreated = toolSteps.filter(s => s.name === 'init_project').map(s => s.args?.name).filter(Boolean);
        const commandsRun = toolSteps.filter(s => s.name === 'run_command').map(s => s.args?.command).filter(Boolean);

        if (projectsCreated.length > 0) {
            projectLearnings.push(`Created project(s): ${projectsCreated.join(', ')}`);
        }
        if (filesCreated.length > 0) {
            projectLearnings.push(`Created ${filesCreated.length} files: ${filesCreated.slice(-5).join(', ')}`);
        }
        if (filesEdited.length > 0) {
            projectLearnings.push(`Edited ${filesEdited.length} files: ${filesEdited.slice(-5).join(', ')}`);
        }
        if (commandsRun.length > 0) {
            projectLearnings.push(`Ran ${commandsRun.length} commands`);
        }

        // Save to daily log
        const allLearnings = [...learnings, ...projectLearnings];
        if (allLearnings.length > 0) {
            const entry = `\n### Session ${new Date().toLocaleTimeString()}\n${allLearnings.map(l => `- ${l}`).join('\n')}\n`;
            appendMemory(`${today}.md`, entry);
        }

        // Build up MEMORY.md with durable facts (user preferences only)
        const prefs = learnings.filter(l => l.startsWith('User ') || l.startsWith('Tech '));
        if (prefs.length > 0) {
            const existing = readMemory('MEMORY.md') || '# Long-Term Memory\n';
            const newPrefs = prefs.filter(p => !existing.includes(p));
            if (newPrefs.length > 0) {
                appendMemory('MEMORY.md', '\n' + newPrefs.map(p => `- ${p}`).join('\n'));
            }
        }

        // Save project-specific learnings to project memory
        const systemMsg = messages.find(m => m.role === 'system');
        if (systemMsg?.content && projectLearnings.length > 0) {
            // Extract project ID from system prompt
            const projMatch = systemMsg.content.match(/## Active Project:.*?\nPath:\s*`([^`]+)`/);
            if (projMatch) {
                // Use path hash as project ID for memory
                const projPath = projMatch[1];
                const projId = projPath.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
                const entry = `\n### ${new Date().toLocaleTimeString()} — ${today}\n${projectLearnings.map(l => `- ${l}`).join('\n')}\n`;
                try { appendProjectMemory(projId, entry); } catch { /* project memory not critical */ }
            }
        }
    } catch (err) {
        console.log('[Memory] Auto-extraction error:', err.message);
    }
}

// ══════════════════════════════════════════
//  Permissions System
// ══════════════════════════════════════════

/**
 * Permission levels for tools: 'allow' | 'ask' | 'deny'
 * Default permissions can be overridden per-project via .onicode/config.json
 */
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
    init_project: 'allow',
    memory_read: 'allow',
    memory_write: 'allow',
    memory_append: 'allow',
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
};

let activePermissions = { ...DEFAULT_PERMISSIONS };
let agentMode = 'build'; // 'build' (full access) or 'plan' (read-only)

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
    // Sync permissions to aiTools module
    setPermissions(activePermissions);
    setAgentModeRef(mode);
    mainWindow?.webContents.send('ai-agent-mode', mode);
    logger.info('agent-mode', `Switched to ${mode} mode`);
}

function checkPermission(toolName) {
    return activePermissions[toolName] || 'allow';
}

// IPC handlers for permissions and agent mode
ipcMain.handle('agent-set-mode', (_, mode) => {
    setAgentMode(mode);
    return { success: true, mode };
});

ipcMain.handle('agent-get-mode', () => {
    return { mode: agentMode, permissions: activePermissions };
});

// ── Settings flags (synced from renderer localStorage) ──

let dangerousCommandProtection = true;
let autoCommitEnabled = true;

ipcMain.handle('set-setting', (_, key, value) => {
    if (key === 'dangerous-cmd-protection') {
        dangerousCommandProtection = !!value;
        logger.info('settings', `Dangerous command protection: ${dangerousCommandProtection}`);
    } else if (key === 'auto-commit') {
        autoCommitEnabled = !!value;
        logger.info('settings', `Auto-commit: ${autoCommitEnabled}`);
    }
    return { success: true };
});

ipcMain.handle('get-setting', (_, key) => {
    if (key === 'dangerous-cmd-protection') return dangerousCommandProtection;
    if (key === 'auto-commit') return autoCommitEnabled;
    return null;
});

// Expose to aiTools
function isDangerousProtectionEnabled() { return dangerousCommandProtection; }
function isAutoCommitEnabled() { return autoCommitEnabled; }

// ══════════════════════════════════════════
//  Register Terminal & Project IPC
// ══════════════════════════════════════════

registerTerminalIPC(ipcMain, () => mainWindow);
registerProjectIPC(ipcMain, () => mainWindow);
registerGitIPC(ipcMain);
registerConnectorIPC(ipcMain, () => mainWindow);
registerMemoryIPC();
registerLoggerIPC();
registerBrowserIPC();
registerHooksIPC(ipcMain);
registerCommandsIPC(ipcMain);
registerCompactorIPC(ipcMain);
registerLSPIPC(ipcMain);
registerCodeIndexIPC(ipcMain);
registerOrchestratorIPC(ipcMain);
registerContextEngineIPC(ipcMain);
registerMCPIPC(ipcMain, () => mainWindow);

// Task manager IPC — allows renderer to query current tasks
ipcMain.handle('tasks-list', async () => {
    return taskManager.getSummary();
});

// Load tasks for a project (on project activation / app startup)
ipcMain.handle('load-project-tasks', async (_event, projectPath) => {
    if (!projectPath) return { success: false, error: 'No project path' };
    try {
        taskManager.loadFromProject(projectPath);
        return { success: true, summary: taskManager.getSummary() };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Manual task CRUD — allows UI to create/update/delete tasks through TaskManager
ipcMain.handle('task-create', async (_event, { content, priority }) => {
    try {
        const task = taskManager.addTask(content, priority || 'medium');
        return { success: true, task, summary: taskManager.getSummary() };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('task-update', async (_event, { id, updates }) => {
    try {
        const result = taskManager.updateTask(id, updates);
        if (result.error) return { success: false, error: result.error };
        return { success: true, task: result, summary: taskManager.getSummary() };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('task-delete', async (_event, { id }) => {
    try {
        const result = taskManager.removeTask(id);
        if (result.error) return { success: false, error: result.error };
        return { success: true, summary: taskManager.getSummary() };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ══════════════════════════════════════════
//  Milestone IPC (SQLite-backed)
// ══════════════════════════════════════════

ipcMain.handle('milestone-list', async (_event, projectPath) => {
    try {
        const milestones = milestoneStorage.getProjectSummary(projectPath);
        return { success: true, milestones };
    } catch (err) {
        return { success: false, error: err.message, milestones: [] };
    }
});

ipcMain.handle('milestone-create', async (_event, { milestone, projectId, projectPath }) => {
    try {
        milestoneStorage.save(milestone, projectId, projectPath);
        return { success: true, milestone };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('milestone-update', async (_event, { id, updates }) => {
    try {
        milestoneStorage.update(id, updates);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('milestone-delete', async (_event, { id }) => {
    try {
        milestoneStorage.delete(id);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Assign a task to a milestone
ipcMain.handle('task-set-milestone', async (_event, { taskId, milestoneId }) => {
    try {
        const task = taskManager.getTask(taskId);
        if (!task) return { success: false, error: 'Task not found' };
        task.milestoneId = milestoneId || null;
        taskManager._persistUpdate(taskId, { milestoneId: milestoneId || null });
        taskManager._notifyRenderer();
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ══════════════════════════════════════════
//  Conversation Storage IPC (SQLite)
// ══════════════════════════════════════════

ipcMain.handle('conversation-save', async (_event, conv) => {
    try {
        conversationStorage.save(conv);
        return { success: true };
    } catch (err) {
        return { error: err.message };
    }
});

ipcMain.handle('conversation-get', async (_event, id) => {
    try {
        const conv = conversationStorage.get(id);
        return { success: true, conversation: conv };
    } catch (err) {
        return { error: err.message };
    }
});

ipcMain.handle('conversation-list', async (_event, limit, offset) => {
    try {
        const conversations = conversationStorage.listFull(limit || 50);
        return { success: true, conversations };
    } catch (err) {
        return { error: err.message };
    }
});

ipcMain.handle('conversation-delete', async (_event, id) => {
    try {
        conversationStorage.delete(id);
        return { success: true };
    } catch (err) {
        return { error: err.message };
    }
});

ipcMain.handle('conversation-search', async (_event, query) => {
    try {
        const results = conversationStorage.search(query);
        return { success: true, results };
    } catch (err) {
        return { error: err.message };
    }
});

ipcMain.handle('conversation-migrate', async (_event, conversations) => {
    try {
        const result = conversationStorage.migrateFromLocalStorage(conversations);
        return { success: true, ...result };
    } catch (err) {
        return { error: err.message };
    }
});

// ══════════════════════════════════════════
//  Attachment Storage IPC (project-scoped)
// ══════════════════════════════════════════

ipcMain.handle('attachment-save', async (_event, att) => {
    try {
        attachmentStorage.save(att);
        return { success: true };
    } catch (err) {
        return { error: err.message };
    }
});

ipcMain.handle('attachment-list', async (_event, projectId) => {
    try {
        const attachments = attachmentStorage.listByProject(projectId);
        return { success: true, attachments };
    } catch (err) {
        return { error: err.message };
    }
});

ipcMain.handle('attachment-delete', async (_event, id) => {
    try {
        attachmentStorage.delete(id);
        return { success: true };
    } catch (err) {
        return { error: err.message };
    }
});

// ══════════════════════════════════════════
//  Initialize Permissions Sync
// ══════════════════════════════════════════

// Sync default permissions to aiTools on startup
setPermissions(activePermissions);
setAgentModeRef(agentMode);
setDangerousProtectionCheck(() => dangerousCommandProtection);
setAutoCommitCheck(() => autoCommitEnabled);

// ══════════════════════════════════════════
//  App Lifecycle
// ══════════════════════════════════════════

// Register custom protocol for serving local files (screenshots, etc.)
// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([{
    scheme: 'onicode-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

app.whenReady().then(() => {
    // Register protocol handler for local file access (screenshots, etc.)
    protocol.handle('onicode-file', (request) => {
        const filePath = decodeURIComponent(request.url.replace('onicode-file://', ''));
        // Security: only allow files from ~/.onicode/ and project directories
        const home = require('os').homedir();
        const allowedPrefixes = [
            path.join(home, '.onicode'),
            path.join(home, 'OniProjects'),
        ];
        if (!allowedPrefixes.some(prefix => filePath.startsWith(prefix))) {
            return new Response('Forbidden', { status: 403 });
        }
        try {
            const data = fs.readFileSync(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
            return new Response(data, {
                headers: { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' },
            });
        } catch {
            return new Response('Not Found', { status: 404 });
        }
    });

    createWindow();

    // Auto-connect enabled MCP servers after window is ready
    connectAllMCP().catch(err => logger.warn('mcp', `Auto-connect failed: ${err?.message}`));

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    killAllSessions();
    killBackgroundProcesses();
    disconnectAllMCP();
    stopWatching();
    try { closeDB(); } catch { }
});
