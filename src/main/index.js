const { app, BrowserWindow, ipcMain, shell, net } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { registerTerminalIPC, killAllSessions } = require('./terminal');
const { registerProjectIPC } = require('./projects');
const { registerGitIPC } = require('./git');
const { registerConnectorIPC } = require('./connectors');
const { registerMemoryIPC } = require('./memory');
const { logger, registerLoggerIPC } = require('./logger');
const { registerBrowserIPC } = require('./browser');
const { TOOL_DEFINITIONS, executeTool, fileContext, restorePoints, listAgents, setMainWindow: setAIToolsWindow, getTerminalSessions, taskManager } = require('./aiTools');

let mainWindow = null;

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

    // Give aiTools access to mainWindow for IPC events
    setAIToolsWindow(mainWindow);
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

    // Auto-generate session title from first user message (fire-and-forget)
    const userMsgs = messages.filter(m => m.role === 'user');
    if (userMsgs.length === 1) {
        generateSessionTitle(userMsgs[0].content, providerConfig).catch(() => { });
    }

    // Route based on token type
    if (providerConfig.id === 'codex' && isOAuthToken(apiKey)) {
        return streamChatGPTBackend(messages, apiKey, providerConfig.selectedModel);
    } else {
        return streamOpenAI(messages, providerConfig);
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
async function streamChatGPTSingle(inputItems, instructions, accessToken, accountId, model, includeTools = true) {
    const isOModel = model.startsWith('o');

    const bodyObj = {
        model,
        instructions,
        input: inputItems,
        stream: true,
        store: false,
    };

    if (includeTools && !isOModel) {
        bodyObj.tools = toResponsesAPITools(TOOL_DEFINITIONS);
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

/** Stream chat via ChatGPT backend API with agentic tool-calling loop */
async function streamChatGPTBackend(messages, accessToken, selectedModel) {
    const accountId = getAccountId(accessToken);
    if (!accountId) {
        mainWindow?.webContents.send('ai-stream-done', 'Cannot extract account ID from token. Sign in again.');
        return { error: 'Invalid token' };
    }

    const model = selectedModel || 'gpt-4o';
    const MAX_ROUNDS = 50;
    const MAX_AUTO_CONTINUES = 5;

    // Separate system/developer instructions from user/assistant messages
    const systemMessages = messages.filter((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');

    const instructions = systemMessages.map((m) => m.content).join('\n\n')
        || 'You are Onicode AI, an intelligent development companion.';

    // Convert to Responses API input format
    const inputItems = chatMessages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
    }));

    let autoContinueCount = 0;
    const toolsUsed = new Set();

    try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
            mainWindow?.webContents.send('ai-agent-step', { round, status: 'streaming' });

            const result = await streamChatGPTSingle(inputItems, instructions, accessToken, accountId, model);

            // No function calls — check if we should auto-continue
            if (!result.functionCalls || result.functionCalls.length === 0) {
                const summary = taskManager.getSummary();
                const hasPendingTasks = summary.total > 0 && !summary.allDone;
                const hasBuiltAnything = toolsUsed.has('create_file') || toolsUsed.has('run_command');

                if (hasPendingTasks && autoContinueCount < MAX_AUTO_CONTINUES) {
                    autoContinueCount++;
                    logger.info('agent-loop', `Auto-continue #${autoContinueCount}: ${summary.pending} tasks pending`);

                    let continuePrompt;
                    if (!hasBuiltAnything) {
                        continuePrompt = `You have ${summary.pending} pending tasks but have not created any project files yet. You MUST call create_file now to create the actual source code files. Do not explain — just make the tool calls.`;
                    } else {
                        const nextTask = summary.nextTask;
                        continuePrompt = `Continue building. ${summary.done}/${summary.total} tasks done. Next task: "${nextTask?.content || 'check task_list'}". Execute it now with tool calls.`;
                    }

                    inputItems.push({ role: 'user', content: continuePrompt });
                    mainWindow?.webContents.send('ai-agent-step', { round, status: 'continuing', pending: summary.pending });
                    continue;
                }

                mainWindow?.webContents.send('ai-stream-done', null);
                return { success: true };
            }

            // Execute each function call
            autoContinueCount = 0;
            for (const fn of result.functionCalls) {
                let args = {};
                try { args = JSON.parse(fn.arguments); } catch { }

                toolsUsed.add(fn.name);

                mainWindow?.webContents.send('ai-tool-call', {
                    id: fn.call_id,
                    name: fn.name,
                    args,
                    round,
                });

                logger.toolCall(fn.name, args, round);
                const toolResult = await executeTool(fn.name, args);
                logger.toolResult(fn.name, toolResult, round);

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
        }

        // Hit max rounds
        mainWindow?.webContents.send('ai-stream-done', null);
        return { success: true };

    } catch (err) {
        currentAIRequest = null;
        if (err.name === 'AbortError') {
            mainWindow?.webContents.send('ai-stream-done', null);
            return { success: true };
        }
        console.error('[AI] ChatGPT backend request error:', err.message);
        mainWindow?.webContents.send('ai-stream-done', err.message);
        return { error: err.message };
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

    // Add tools for function calling (skip for o-models which may not support tools well)
    if (includeTools && !isOModel) {
        bodyObj.tools = TOOL_DEFINITIONS;
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
 * Context compaction — summarize old messages when conversation gets too long.
 * Keeps the system prompt and last N messages, replaces the middle with a summary.
 * Inspired by OpenCode's compaction agent.
 */
function compactConversation(messages, maxTokenEstimate = 100000) {
    // Rough token estimate: ~4 chars per token
    const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0) + JSON.stringify(m.tool_calls || '').length, 0);
    const estimatedTokens = totalChars / 4;

    if (estimatedTokens < maxTokenEstimate * 0.8) return messages; // Under 80%, no compaction needed

    logger.info('compaction', `Conversation too long (~${Math.round(estimatedTokens)} tokens). Compacting...`);

    // Keep system messages, first user message, and last 10 messages
    const systemMsgs = messages.filter(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');
    const keepLast = 10;

    if (nonSystem.length <= keepLast + 2) return messages; // Too short to compact

    const firstUserMsg = nonSystem[0];
    const middleMsgs = nonSystem.slice(1, -keepLast);
    const lastMsgs = nonSystem.slice(-keepLast);

    // Summarize the middle section
    const summaryParts = [];
    let filesModified = new Set();
    let toolsCalled = {};
    let keyDecisions = [];

    for (const msg of middleMsgs) {
        if (msg.role === 'assistant' && msg.content) {
            // Extract key sentences (first sentence of each paragraph)
            const sentences = msg.content.split(/\.\s/).slice(0, 3);
            if (sentences.length > 0) keyDecisions.push(sentences[0]);
        }
        if (msg.role === 'assistant' && msg.tool_calls) {
            for (const tc of msg.tool_calls) {
                const name = tc.function?.name || 'unknown';
                toolsCalled[name] = (toolsCalled[name] || 0) + 1;
                try {
                    const args = JSON.parse(tc.function?.arguments || '{}');
                    if (args.file_path) filesModified.add(args.file_path);
                } catch { }
            }
        }
    }

    const toolSummary = Object.entries(toolsCalled).map(([k, v]) => `${k}(${v}x)`).join(', ');
    const filesSummary = [...filesModified].slice(0, 20).join(', ');

    const compactionMsg = {
        role: 'user',
        content: `[CONTEXT COMPACTION: The conversation was too long and has been summarized. Here is what happened in the compacted section:]\n\nTools used: ${toolSummary || 'none'}\nFiles touched: ${filesSummary || 'none'}\nKey points: ${keyDecisions.slice(0, 10).join('. ') || 'General discussion'}\n\n[End of compacted section. Continue from here.]`,
    };

    const compacted = [...systemMsgs, firstUserMsg, compactionMsg, ...lastMsgs];
    logger.info('compaction', `Compacted ${messages.length} messages → ${compacted.length} messages`);

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
async function streamOpenAI(messages, providerConfig) {
    const MAX_TOOL_ROUNDS = 50;  // Support long 10+ minute sessions
    const MAX_AUTO_CONTINUES = 5; // Max times we'll push the model to continue
    let conversationMessages = [...messages];
    let round = 0;
    let autoContinueCount = 0;
    const toolsUsed = new Set(); // Track which tool types have been called

    while (round < MAX_TOOL_ROUNDS) {
        round++;

        // Auto-compact conversation if it's getting too long
        if (round > 3) {
            conversationMessages = compactConversation(conversationMessages);
        }

        // Notify renderer of agentic step
        if (round > 1) {
            mainWindow?.webContents.send('ai-agent-step', { round, status: 'thinking' });
        }

        // Use forceToolChoice on auto-continuation rounds to guarantee tool calls
        const forceTools = autoContinueCount > 0;
        const result = await streamOpenAISingle(conversationMessages, providerConfig, true, forceTools);

        if (result.error) {
            mainWindow?.webContents.send('ai-stream-done', result.error);
            return { error: result.error };
        }

        // ── Text-only response: check if we should auto-continue ──
        if (!result.hasToolCalls) {
            const summary = taskManager.getSummary();
            const hasPendingTasks = summary.total > 0 && !summary.allDone;
            const hasBuiltAnything = toolsUsed.has('create_file') || toolsUsed.has('run_command');

            // Auto-continue if: tasks are pending AND (we haven't built anything yet OR tasks in-progress)
            if (hasPendingTasks && autoContinueCount < MAX_AUTO_CONTINUES) {
                autoContinueCount++;
                logger.info('agent-loop', `Auto-continue #${autoContinueCount} (will force tool_choice:required): ${summary.pending} tasks pending, ${summary.done}/${summary.total} done`);

                // Add the assistant's text response to conversation
                if (result.textContent) {
                    conversationMessages.push({ role: 'assistant', content: result.textContent });
                }

                // Build a specific continuation prompt based on what's missing
                let continuePrompt;
                if (!hasBuiltAnything) {
                    continuePrompt = `You have ${summary.pending} pending tasks but have not created any project files yet. You MUST call create_file now to create the actual source code files (package.json, tsconfig.json, source files, components, etc.). Do not explain — just make the tool calls.`;
                } else {
                    const nextTask = summary.nextTask;
                    continuePrompt = `Continue building. ${summary.done}/${summary.total} tasks done. Next task: "${nextTask?.content || 'check task_list'}". Execute it now with tool calls.`;
                }

                conversationMessages.push({ role: 'user', content: continuePrompt });

                // Notify renderer that agent is auto-continuing
                mainWindow?.webContents.send('ai-agent-step', { round, status: 'continuing', pending: summary.pending });
                continue; // Loop back for another round
            }

            // Actually done (no pending tasks, or max auto-continues reached)
            currentAIRequest = null;
            mainWindow?.webContents.send('ai-stream-done', null);
            return { success: true };
        }

        // ── Tool calling round ──
        autoContinueCount = 0; // Reset auto-continue counter on successful tool calls

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
            } catch {
                args = {};
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

            // Execute the tool
            logger.toolCall(tc.name, args, round);
            const toolResult = await executeTool(tc.name, args);
            logger.toolResult(tc.name, toolResult, round);

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

        // Loop back for next round — AI will see tool results and decide next action
    }

    // Safety: max rounds reached
    mainWindow?.webContents.send('ai-stream-chunk', '\n\n*[Reached maximum tool-calling rounds. Stopping.]*');
    mainWindow?.webContents.send('ai-stream-done', null);
    currentAIRequest = null;
    return { success: true };
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
    delete_file: 'ask',
    multi_edit: 'allow',
    run_command: 'allow',
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
    task_clear: 'allow',
    init_project: 'allow',
    memory_write: 'allow',
    memory_append: 'allow',
    create_restore_point: 'allow',
    restore_to_point: 'ask',
    list_restore_points: 'allow',
    get_context_summary: 'allow',
    spawn_sub_agent: 'allow',
    get_agent_status: 'allow',
    get_system_logs: 'allow',
    get_changelog: 'allow',
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
    } else {
        activePermissions = { ...DEFAULT_PERMISSIONS };
    }
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

// Task manager IPC — allows renderer to query current tasks
ipcMain.handle('tasks-list', async () => {
    return taskManager.getSummary();
});

// ══════════════════════════════════════════
//  App Lifecycle
// ══════════════════════════════════════════

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    killAllSessions();
});
