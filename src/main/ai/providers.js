/**
 * AI Provider management — OAuth PKCE, provider testing, model fetching.
 * Extracted from index.js for modularity.
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');

// ══════════════════════════════════════════
//  JWT + Token Helpers
// ══════════════════════════════════════════

function isOAuthToken(apiKey) {
    if (!apiKey) return false;
    if (apiKey.startsWith('sk-')) return false;
    const parts = apiKey.split('.');
    return parts.length === 3;
}

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

function getAccountId(token) {
    const payload = decodeJWT(token);
    if (!payload) return null;
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
//  Codex OAuth Config
// ══════════════════════════════════════════

const CODEX_OAUTH = {
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    authorizeEndpoint: 'https://auth.openai.com/oauth/authorize',
    tokenEndpoint: 'https://auth.openai.com/oauth/token',
    redirectUri: 'http://localhost:1455/auth/callback',
    scope: 'openid profile email offline_access',
    audience: 'https://api.openai.com/v1',
};

let pendingOAuth = null;

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
//  Provider Testing
// ══════════════════════════════════════════

function testChatGPTBackend(accessToken) {
    const accountId = getAccountId(accessToken);
    if (!accountId) {
        return Promise.resolve({ error: 'Could not extract account ID from token. Token may be invalid or expired.' });
    }
    const payload = decodeJWT(accessToken);
    if (payload?.exp && payload.exp * 1000 < Date.now()) {
        return Promise.resolve({ error: 'Token is expired. Sign in again.' });
    }
    return Promise.resolve({ success: true, modelCount: 0 });
}

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
                        const excluded = ['image', 'audio', 'realtime', 'tts', 'whisper', 'dall-e', 'sora', 'embed', 'moderation', 'transcribe', 'search-preview', 'chat-latest'];
                        const relevant = allModels.filter((m) =>
                            (m.includes('gpt-5') || m.includes('gpt-4') ||
                            m.includes('o3') || m.includes('o4') || m.includes('codex')) &&
                            !excluded.some(ex => m.includes(ex))
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

function testAnthropic(apiKey) {
    return new Promise((resolve) => {
        const bodyStr = JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'Hi' }],
        });
        const req = https.request({
            hostname: 'api.anthropic.com',
            path: '/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Length': Buffer.byteLength(bodyStr),
            },
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve({ success: true, modelCount: 5 });
                } else if (res.statusCode === 401) {
                    resolve({ error: 'Authentication failed (401). Check your Anthropic API key.' });
                } else {
                    let msg = `HTTP ${res.statusCode}`;
                    try { msg = JSON.parse(data).error?.message || msg; } catch { }
                    resolve({ error: msg });
                }
            });
        });
        req.on('error', (err) => resolve({ error: err.message }));
        req.write(bodyStr);
        req.end();
    });
}

function testOllama(baseUrl) {
    const base = (baseUrl || 'http://localhost:11434').replace(/\/$/, '');
    return new Promise((resolve) => {
        const url = new URL(`${base}/api/tags`);
        const mod = url.protocol === 'https:' ? https : http;

        const req = mod.request({
            hostname: url.hostname,
            port: url.port || undefined,
            path: url.pathname,
            method: 'GET',
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const json = JSON.parse(data);
                        const models = json.models?.map((m) => m.name) || [];
                        if (models.length === 0) {
                            resolve({ error: 'Ollama is running but no models installed. Run: ollama pull llama3.3' });
                        } else {
                            resolve({ success: true, models, modelCount: models.length });
                        }
                    } catch {
                        resolve({ success: true, modelCount: 0 });
                    }
                } else {
                    resolve({ error: `HTTP ${res.statusCode} — check Ollama is running` });
                }
            });
        });
        req.on('error', () => resolve({ error: 'Cannot reach Ollama — is it running? Start with: ollama serve' }));
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
//  IPC Registration
// ══════════════════════════════════════════

function registerProviderIPC(ipcMain, shell) {
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

    ipcMain.handle('test-provider', async (_event, providerConfig) => {
        if (!providerConfig) return { error: 'No provider config' };

        try {
            if (providerConfig.id === 'openai') {
                if (!providerConfig.apiKey?.trim()) return { error: 'OpenAI API key is required' };
                return await testOpenAI(providerConfig.apiKey);
            } else if (providerConfig.id === 'codex') {
                if (!providerConfig.apiKey?.trim()) return { error: 'API key is required' };

                if (isOAuthToken(providerConfig.apiKey)) {
                    return await testChatGPTBackend(providerConfig.apiKey);
                } else {
                    return await testOpenAI(providerConfig.apiKey);
                }
            } else if (providerConfig.id === 'anthropic') {
                if (!providerConfig.apiKey?.trim()) return { error: 'Anthropic API key is required' };
                return await testAnthropic(providerConfig.apiKey);
            } else if (providerConfig.id === 'ollama') {
                return await testOllama(providerConfig.baseUrl);
            } else {
                if (!providerConfig.baseUrl?.trim()) return { error: 'Gateway URL is required' };
                return await testGateway(providerConfig.baseUrl, providerConfig.apiKey);
            }
        } catch (err) {
            return { error: err.message || 'Connection failed' };
        }
    });

    ipcMain.handle('fetch-models', async (_event, providerConfig) => {
        if (!providerConfig) return { error: 'No provider config' };
        try {
            if (providerConfig.id === 'openai') {
                if (!providerConfig.apiKey?.trim()) return { error: 'API key required' };
                const result = await testOpenAI(providerConfig.apiKey);
                if (result.models) return { models: result.models };
                return { models: ['gpt-5.4', 'gpt-5.4-pro', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'o3', 'o3-mini', 'o4-mini'] };
            } else if (providerConfig.id === 'codex') {
                if (!providerConfig.apiKey?.trim()) return { error: 'API key required' };
                if (isOAuthToken(providerConfig.apiKey)) return { models: ['gpt-5.4', 'gpt-5-codex', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-max', 'codex-mini-latest', 'gpt-4o', 'o4-mini'] };
                const result = await testOpenAI(providerConfig.apiKey);
                if (result.models) return { models: result.models };
                return { models: ['gpt-5.4', 'gpt-5-codex', 'codex-mini-latest', 'gpt-4o', 'o4-mini'] };
            } else if (providerConfig.id === 'anthropic') {
                return { models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'claude-3-5-haiku-20241022'] };
            } else if (providerConfig.id === 'ollama') {
                const result = await testOllama(providerConfig.baseUrl);
                if (result.models) return { models: result.models };
                return { error: result.error || 'No models found' };
            } else {
                const result = await testGateway(providerConfig.baseUrl, providerConfig.apiKey);
                if (result.models) return { models: result.models };
                return { models: [] };
            }
        } catch (err) {
            return { error: err.message };
        }
    });
}

module.exports = {
    registerProviderIPC,
    isOAuthToken,
    decodeJWT,
    getAccountId,
};
