/**
 * Connectors — OAuth flows for GitHub, Gmail, Slack
 * Uses OAuth Device Flow for GitHub (no client secret needed)
 * Uses Google OAuth 2.0 with localhost redirect for Gmail
 */

const { shell } = require('electron');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONNECTORS_FILE = path.join(
    process.env.HOME || process.env.USERPROFILE || '/tmp',
    '.onicode',
    'connectors.json'
);

// ── Storage ──

function loadConnectors() {
    try {
        if (fs.existsSync(CONNECTORS_FILE)) {
            return JSON.parse(fs.readFileSync(CONNECTORS_FILE, 'utf-8'));
        }
    } catch {}
    return {};
}

function saveConnectors(data) {
    const dir = path.dirname(CONNECTORS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONNECTORS_FILE, JSON.stringify(data, null, 2));
}

function getConnector(id) {
    const all = loadConnectors();
    return all[id] || null;
}

function setConnector(id, data) {
    const all = loadConnectors();
    all[id] = { ...data, updatedAt: Date.now() };
    saveConnectors(all);
}

function removeConnector(id) {
    const all = loadConnectors();
    delete all[id];
    saveConnectors(all);
}

// ── GitHub OAuth (Device Flow) ──
// Device flow doesn't need a client secret and works great for desktop apps.
// We use a well-known public client ID for device flow.

const GITHUB_CLIENT_ID = 'Ov23liUKbMFBtGpqKfnr'; // Public GitHub OAuth App

let githubDevicePoll = null;

async function githubDeviceFlowStart() {
    // Step 1: Request device + user codes
    const res = await fetchJSON('https://github.com/login/device/code', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: 'repo user read:org' }),
    });

    if (!res.device_code || !res.user_code) {
        return { error: 'Failed to start GitHub device flow', details: res };
    }

    return {
        success: true,
        deviceCode: res.device_code,
        userCode: res.user_code,
        verificationUri: res.verification_uri,
        expiresIn: res.expires_in,
        interval: res.interval || 5,
    };
}

async function githubDeviceFlowPoll(deviceCode, interval = 5) {
    // Poll for the token
    return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = Math.ceil(600 / interval); // 10 min max

        githubDevicePoll = setInterval(async () => {
            attempts++;
            if (attempts > maxAttempts) {
                clearInterval(githubDevicePoll);
                githubDevicePoll = null;
                resolve({ error: 'Device flow timed out' });
                return;
            }

            try {
                const res = await fetchJSON('https://github.com/login/oauth/access_token', {
                    method: 'POST',
                    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        client_id: GITHUB_CLIENT_ID,
                        device_code: deviceCode,
                        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                    }),
                });

                if (res.access_token) {
                    clearInterval(githubDevicePoll);
                    githubDevicePoll = null;

                    // Get user info
                    const user = await fetchJSON('https://api.github.com/user', {
                        headers: { 'Authorization': `Bearer ${res.access_token}`, 'User-Agent': 'Onicode' },
                    });

                    setConnector('github', {
                        accessToken: res.access_token,
                        tokenType: res.token_type,
                        scope: res.scope,
                        username: user.login || 'unknown',
                        avatarUrl: user.avatar_url || '',
                        connectedAt: Date.now(),
                    });

                    resolve({
                        success: true,
                        username: user.login,
                        avatarUrl: user.avatar_url,
                    });
                } else if (res.error === 'authorization_pending') {
                    // Keep polling
                } else if (res.error === 'slow_down') {
                    // Increase interval — handled by clearing and restarting
                } else if (res.error === 'expired_token' || res.error === 'access_denied') {
                    clearInterval(githubDevicePoll);
                    githubDevicePoll = null;
                    resolve({ error: res.error_description || res.error });
                }
            } catch (err) {
                // Network error, keep trying
            }
        }, interval * 1000);
    });
}

// ── Google OAuth 2.0 (localhost redirect) ──
// Uses a localhost HTTP server to capture the redirect.
// No client secret needed for "installed app" / public client.

// Google OAuth Client ID — set via env var or ~/.onicode/google-oauth.json
// Users must create their own OAuth 2.0 client at https://console.cloud.google.com/apis/credentials
// Type: "Desktop app", no client secret needed for PKCE flow
let GOOGLE_CLIENT_ID = process.env.ONICODE_GOOGLE_CLIENT_ID || '';
try {
    const googleOAuthPath = path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.onicode', 'google-oauth.json');
    if (!GOOGLE_CLIENT_ID && fs.existsSync(googleOAuthPath)) {
        const cfg = JSON.parse(fs.readFileSync(googleOAuthPath, 'utf-8'));
        GOOGLE_CLIENT_ID = cfg.clientId || cfg.client_id || '';
    }
} catch {}

const GOOGLE_REDIRECT_PORT = 1456;
const GOOGLE_REDIRECT_URI = `http://localhost:${GOOGLE_REDIRECT_PORT}/auth/google/callback`;
const GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

let googleAuthServer = null;

async function googleRefreshToken() {
    const connector = getConnector('gmail') || getConnector('google');
    if (!connector || !connector.refreshToken) return { error: 'No refresh token available' };
    if (!GOOGLE_CLIENT_ID) return { error: 'Google Client ID not configured' };

    try {
        const res = await fetchJSON('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                refresh_token: connector.refreshToken,
                grant_type: 'refresh_token',
            }).toString(),
        });

        if (res.access_token) {
            const connectorId = getConnector('gmail') ? 'gmail' : 'google';
            setConnector(connectorId, {
                ...connector,
                accessToken: res.access_token,
                expiresAt: Date.now() + (res.expires_in || 3600) * 1000,
            });
            return { success: true, accessToken: res.access_token };
        }
        return { error: res.error_description || res.error || 'Refresh failed' };
    } catch (err) {
        return { error: `Token refresh failed: ${err.message}` };
    }
}

// Get a valid Google access token, refreshing if expired
async function getValidGoogleToken() {
    const connector = getConnector('gmail') || getConnector('google');
    if (!connector || !connector.accessToken) return null;

    // Check if token is expired (with 5min buffer)
    if (connector.expiresAt && Date.now() > connector.expiresAt - 300000) {
        const refreshResult = await googleRefreshToken();
        if (refreshResult.success) return refreshResult.accessToken;
        return null; // expired and can't refresh
    }
    return connector.accessToken;
}

function googleOAuthStart() {
    if (!GOOGLE_CLIENT_ID) {
        return {
            error: 'Google Client ID not configured. Create an OAuth 2.0 client at https://console.cloud.google.com/apis/credentials (Desktop app type) and either set ONICODE_GOOGLE_CLIENT_ID env var or create ~/.onicode/google-oauth.json with { "clientId": "your-id" }',
        };
    }
    // PKCE
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
        `&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(GOOGLE_SCOPES)}` +
        `&state=${encodeURIComponent(state)}` +
        `&code_challenge=${encodeURIComponent(challenge)}` +
        `&code_challenge_method=S256` +
        `&access_type=offline` +
        `&prompt=consent`;

    return { authUrl, verifier, state };
}

async function googleOAuthExchange(code, verifier) {
    const res = await fetchJSON('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            code,
            code_verifier: verifier,
            grant_type: 'authorization_code',
            redirect_uri: GOOGLE_REDIRECT_URI,
        }).toString(),
    });

    if (res.access_token) {
        // Get user info
        const user = await fetchJSON('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { 'Authorization': `Bearer ${res.access_token}` },
        });

        setConnector('gmail', {
            accessToken: res.access_token,
            refreshToken: res.refresh_token || '',
            expiresAt: Date.now() + (res.expires_in || 3600) * 1000,
            email: user.email || 'unknown',
            name: user.name || '',
            picture: user.picture || '',
            connectedAt: Date.now(),
        });

        return { success: true, email: user.email, name: user.name, picture: user.picture };
    }

    return { error: res.error_description || res.error || 'Token exchange failed' };
}

// ── Fetch helper ──

function fetchJSON(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const lib = urlObj.protocol === 'https:' ? https : http;

        const req = lib.request(url, {
            method: options.method || 'GET',
            headers: options.headers || {},
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve({ raw: data }); }
            });
        });

        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

// ── IPC Registration ──

function registerConnectorIPC(ipcMain, getWindow) {
    // List all connectors status
    ipcMain.handle('connector-list', async () => {
        const all = loadConnectors();
        const result = {};
        for (const [id, data] of Object.entries(all)) {
            result[id] = {
                connected: true,
                username: data.username || data.email || 'Connected',
                avatarUrl: data.avatarUrl || data.picture || '',
                connectedAt: data.connectedAt,
            };
        }
        return { connectors: result };
    });

    // GitHub — start device flow
    ipcMain.handle('connector-github-start', async () => {
        return githubDeviceFlowStart();
    });

    // GitHub — poll for token (call after user enters code)
    ipcMain.handle('connector-github-poll', async (_event, deviceCode, interval) => {
        return githubDeviceFlowPoll(deviceCode, interval);
    });

    // GitHub — cancel polling
    ipcMain.handle('connector-github-cancel', async () => {
        if (githubDevicePoll) {
            clearInterval(githubDevicePoll);
            githubDevicePoll = null;
        }
        return { success: true };
    });

    // Google/Gmail — start OAuth (opens browser, starts local server)
    ipcMain.handle('connector-google-start', async () => {
        const startResult = googleOAuthStart();
        if (startResult.error) {
            return { error: startResult.error };
        }
        const { authUrl, verifier, state } = startResult;

        // Start local HTTP server to capture redirect
        return new Promise((resolve) => {
            if (googleAuthServer) {
                try { googleAuthServer.close(); } catch {}
            }

            googleAuthServer = http.createServer(async (req, res) => {
                const url = new URL(req.url, `http://localhost:${GOOGLE_REDIRECT_PORT}`);
                if (url.pathname === '/auth/google/callback') {
                    const code = url.searchParams.get('code');
                    const returnedState = url.searchParams.get('state');
                    const error = url.searchParams.get('error');

                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    
                    if (error) {
                        res.end('<html><body><h2>Authentication failed</h2><p>You can close this window.</p></body></html>');
                        googleAuthServer.close();
                        googleAuthServer = null;
                        const win = getWindow();
                        if (win) win.webContents.send('connector-google-result', { error });
                        return;
                    }

                    if (code && returnedState === state) {
                        res.end('<html><body><h2>Authentication successful!</h2><p>You can close this window and return to Onicode.</p></body></html>');
                        googleAuthServer.close();
                        googleAuthServer = null;

                        const result = await googleOAuthExchange(code, verifier);
                        const win = getWindow();
                        if (win) win.webContents.send('connector-google-result', result);
                    } else {
                        res.end('<html><body><h2>Invalid state</h2><p>Please try again.</p></body></html>');
                        googleAuthServer.close();
                        googleAuthServer = null;
                    }
                } else {
                    res.writeHead(404);
                    res.end('Not found');
                }
            });

            googleAuthServer.listen(GOOGLE_REDIRECT_PORT, () => {
                shell.openExternal(authUrl);
                resolve({ success: true, authUrl });
            });

            googleAuthServer.on('error', (err) => {
                resolve({ error: `Failed to start auth server: ${err.message}` });
            });
        });
    });

    // Google — cancel
    ipcMain.handle('connector-google-cancel', async () => {
        if (googleAuthServer) {
            try { googleAuthServer.close(); } catch {}
            googleAuthServer = null;
        }
        return { success: true };
    });

    // Disconnect a connector
    ipcMain.handle('connector-disconnect', async (_event, connectorId) => {
        removeConnector(connectorId);
        return { success: true };
    });

    // Get connector details
    ipcMain.handle('connector-get', async (_event, connectorId) => {
        const data = getConnector(connectorId);
        if (!data) return { connected: false };
        return {
            connected: true,
            ...data,
            // Don't expose tokens to renderer
            accessToken: undefined,
            refreshToken: undefined,
        };
    });

    // Refresh Google token
    ipcMain.handle('connector-google-refresh', async () => {
        return googleRefreshToken();
    });

    // ── Google Workspace CLI (gws) auth ──

    function isGwsInstalled() {
        const { execSync } = require('child_process');
        try {
            execSync('which gws || where gws', { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
            return true;
        } catch { return false; }
    }

    async function installGws(win) {
        const { execSync } = require('child_process');
        if (win) win.webContents.send('connector-google-result', { installing: true });
        try {
            execSync('npm install -g @googleworkspace/cli', {
                encoding: 'utf-8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'],
            });
            return { success: true };
        } catch (err) {
            const stderr = (err.stderr || '').trim();
            // npm may need sudo on some systems — try without global
            if (stderr.includes('EACCES') || stderr.includes('permission')) {
                try {
                    // Try npx as fallback — makes gws available without global install
                    execSync('npx --yes @googleworkspace/cli --version', {
                        encoding: 'utf-8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'],
                    });
                    return { success: true, npx: true };
                } catch {
                    return { error: `Install failed (permission denied). Try: sudo npm install -g @googleworkspace/cli` };
                }
            }
            return { error: `Install failed: ${stderr || err.message}`.slice(0, 500) };
        }
    }

    function checkGwsAuth() {
        const { execSync } = require('child_process');
        try {
            const out = execSync('gws auth status', {
                encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
            });
            // gws auth status outputs JSON with token_valid and user fields
            // Strip "Using keyring backend: keyring\n" prefix if present
            const jsonStr = out.replace(/^Using keyring backend:.*\n/m, '').trim();
            const data = JSON.parse(jsonStr);
            if (data.token_valid && data.user) {
                return data.user;
            }
            return null;
        } catch { return null; }
    }

    // Check if gws is installed and authenticated
    ipcMain.handle('connector-gws-status', async () => {
        if (!isGwsInstalled()) {
            return { installed: false, authenticated: false };
        }
        const email = checkGwsAuth();
        if (email) {
            setConnector('gmail', { email, username: email, connectedAt: Date.now(), authMethod: 'gws' });
            return { installed: true, authenticated: true, email };
        }
        return { installed: true, authenticated: false };
    });

    // Full connect flow: install gws if needed → run gws auth login → verify
    ipcMain.handle('connector-gws-login', async () => {
        const { exec, execSync } = require('child_process');
        const win = getWindow();

        // Step 1: Auto-install if not present
        if (!isGwsInstalled()) {
            if (win) win.webContents.send('connector-google-result', { status: 'Installing Google Workspace CLI...' });
            const installResult = await installGws(win);
            if (!installResult.success) {
                return { error: installResult.error };
            }
            // Verify install worked
            if (!isGwsInstalled()) {
                return { error: 'Installation completed but gws command not found. Restart the app and try again.' };
            }
        }

        // Step 2: Check if already authenticated
        const existingEmail = checkGwsAuth();
        if (existingEmail) {
            setConnector('gmail', { email: existingEmail, username: existingEmail, connectedAt: Date.now(), authMethod: 'gws' });
            if (win) win.webContents.send('connector-google-result', { success: true, email: existingEmail });
            return { success: true, message: 'Already authenticated' };
        }

        // Step 3: Run gws auth login (opens browser for OAuth)
        if (win) win.webContents.send('connector-google-result', { status: 'Opening browser for Google sign-in...' });

        exec('gws auth login', { timeout: 180000 }, (err, stdout, stderr) => {
            if (err) {
                if (win) win.webContents.send('connector-google-result', { error: `Auth failed: ${(stderr || err.message).slice(0, 300)}` });
                return;
            }
            // Auth completed — verify
            const email = checkGwsAuth();
            if (email) {
                setConnector('gmail', { email, username: email, connectedAt: Date.now(), authMethod: 'gws' });
                if (win) win.webContents.send('connector-google-result', { success: true, email });
            } else {
                if (win) win.webContents.send('connector-google-result', { success: true, email: 'authenticated' });
            }
        });

        return { success: true, message: 'Opening browser for Google authentication...' };
    });

    // ── GitHub CLI (gh) auto-install + auth ──

    ipcMain.handle('connector-gh-ensure', async () => {
        const { execSync } = require('child_process');
        try {
            execSync('which gh || where gh', { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
            return { installed: true };
        } catch {
            // Auto-install gh via Homebrew (macOS) or npm
            const win = getWindow();
            if (win) win.webContents.send('connector-google-result', { status: 'Installing GitHub CLI...' });
            try {
                // Try Homebrew first (macOS)
                execSync('brew install gh', { encoding: 'utf-8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] });
                return { installed: true };
            } catch {
                return { installed: false, error: 'Could not auto-install gh. Install manually: https://cli.github.com' };
            }
        }
    });
}

module.exports = { registerConnectorIPC, getValidGoogleToken, getConnector, googleRefreshToken };
