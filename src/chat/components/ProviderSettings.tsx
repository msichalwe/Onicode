import React, { useState, useCallback } from 'react';

interface ProviderConfig {
    id: string;
    name: string;
    initials: string;
    description: string;
    enabled: boolean;
    connected: boolean;
    authType: 'api-key' | 'url-key';
    apiKey?: string;
    baseUrl?: string;
    selectedModel?: string;
    models?: string[];
    testStatus?: 'idle' | 'testing' | 'success' | 'error';
    testMessage?: string;
    comingSoon?: boolean;
}

const OPENAI_MODELS = [
    'gpt-5.4',
    'gpt-5.4-pro',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-5',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-4o',
    'gpt-4o-mini',
    'o3',
    'o3-pro',
    'o3-mini',
    'o4-mini',
];

const CODEX_MODELS = [
    'gpt-5.4',
    'gpt-5-codex',
    'gpt-5.3-codex',
    'gpt-5.2-codex',
    'gpt-5.1-codex-max',
    'codex-mini-latest',
    'gpt-4o',
    'o4-mini',
];

const ANTHROPIC_MODELS = [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-5-20250514',
    'claude-3-5-haiku-20241022',
];

const DEFAULT_PROVIDERS: ProviderConfig[] = [
    {
        id: 'codex',
        name: 'OpenAI',
        initials: 'AI',
        description: 'ChatGPT OAuth sign-in or API key',
        enabled: true,
        connected: false,
        authType: 'api-key',
        apiKey: '',
        selectedModel: 'gpt-5.4',
        models: CODEX_MODELS,
    },
    {
        id: 'openai',
        name: 'OpenAI API',
        initials: 'GP',
        description: 'GPT-5.4, o3, o4-mini via API key',
        enabled: false,
        connected: false,
        authType: 'api-key',
        apiKey: '',
        selectedModel: 'gpt-5.4',
        models: OPENAI_MODELS,
        comingSoon: true,
    },
    {
        id: 'anthropic',
        name: 'Anthropic Claude',
        initials: 'Cl',
        description: 'Opus 4.6, Sonnet 4.6, Haiku 4.5',
        enabled: false,
        connected: false,
        authType: 'api-key',
        apiKey: '',
        selectedModel: 'claude-sonnet-4-6',
        models: ANTHROPIC_MODELS,
        comingSoon: true,
    },
    {
        id: 'ollama',
        name: 'Ollama (Local)',
        initials: 'OL',
        description: 'Run models locally, no key needed',
        enabled: false,
        connected: false,
        authType: 'url-key',
        baseUrl: 'http://localhost:11434',
        apiKey: '',
        selectedModel: '',
        models: [],
        comingSoon: true,
    },
    {
        id: 'onigateway',
        name: 'OniAI Gateway',
        initials: 'On',
        description: 'Self-hosted AI gateway',
        enabled: false,
        connected: false,
        authType: 'url-key',
        baseUrl: '',
        apiKey: '',
        selectedModel: 'default',
        models: ['default'],
        comingSoon: true,
    },
    {
        id: 'openclaw',
        name: 'OpenClaw',
        initials: 'OC',
        description: 'Multi-model gateway',
        enabled: false,
        connected: false,
        authType: 'url-key',
        baseUrl: '',
        apiKey: '',
        selectedModel: 'default',
        models: ['default'],
        comingSoon: true,
    },
];

import { isElectron } from '../utils';

// ══════════════════════════════════════════
//  Fallback: renderer-side PKCE for non-Electron (Vite dev in browser)
// ══════════════════════════════════════════

const CODEX_OAUTH = {
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    authorizeEndpoint: 'https://auth.openai.com/oauth/authorize',
    tokenEndpoint: 'https://auth.openai.com/oauth/token',
    redirectUri: 'http://localhost:1455/auth/callback',
    scope: 'openid profile email offline_access',
    audience: 'https://api.openai.com/v1',
};

function fallbackRandomString(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => chars[b % chars.length]).join('');
}

async function fallbackGeneratePKCE() {
    const verifier = fallbackRandomString(64);
    const encoded = new TextEncoder().encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', encoded);
    const bytes = new Uint8Array(hash);
    let binary = '';
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    const challenge = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return { verifier, challenge };
}

export default function ProviderSettings() {
    const [providers, setProviders] = useState<ProviderConfig[]>(() => {
        const saved = localStorage.getItem('onicode-providers');
        if (saved) {
            try {
                const parsed = JSON.parse(saved) as ProviderConfig[];
                return DEFAULT_PROVIDERS.map((def) => {
                    const existing = parsed.find((p) => p.id === def.id);
                    if (existing) {
                        return {
                            ...def,
                            apiKey: existing.apiKey,
                            baseUrl: existing.baseUrl,
                            selectedModel: def.models?.includes(existing.selectedModel || '')
                                ? existing.selectedModel
                                : def.selectedModel,
                            enabled: existing.enabled,
                            connected: existing.connected,
                        };
                    }
                    return def;
                });
            } catch {
                return DEFAULT_PROVIDERS;
            }
        }
        return DEFAULT_PROVIDERS;
    });

    const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
    const [authState, setAuthState] = useState<'idle' | 'waiting-for-redirect' | 'exchanging'>('idle');
    const [redirectUrl, setRedirectUrl] = useState('');

    // Fallback PKCE verifier for browser-only mode
    const [fallbackVerifier, setFallbackVerifier] = useState<string | null>(null);

    const updateProvider = useCallback((id: string, updates: Partial<ProviderConfig>) => {
        setProviders((prev) => {
            const next = prev.map((p) => (p.id === id ? { ...p, ...updates } : p));
            localStorage.setItem('onicode-providers', JSON.stringify(next));
            return next;
        });
    }, []);

    // ── Step 1: Open browser for ChatGPT sign-in ──
    const startChatGPTSignIn = useCallback(async () => {
        setAuthState('waiting-for-redirect');
        updateProvider('codex', {
            testStatus: 'testing',
            testMessage: 'Opening browser for sign-in\u2026',
        });

        if (isElectron) {
            // Electron: main process generates PKCE + opens browser
            const result = await window.onicode!.codexOAuthGetAuthUrl();
            if (result.error) {
                setAuthState('idle');
                updateProvider('codex', { testStatus: 'error', testMessage: result.error });
            }
        } else {
            // Browser fallback: generate PKCE in renderer + open in new tab
            const pkce = await fallbackGeneratePKCE();
            setFallbackVerifier(pkce.verifier);

            const state = fallbackRandomString(32);
            localStorage.setItem('onicode-oauth-state', state);

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

            window.open(`${CODEX_OAUTH.authorizeEndpoint}?${params.toString()}`, '_blank');
        }
    }, [updateProvider]);

    // ── Step 2: User pastes the redirect URL ──
    const handleRedirectSubmit = useCallback(async () => {
        const url = redirectUrl.trim();
        if (!url) return;

        setAuthState('exchanging');
        updateProvider('codex', { testStatus: 'testing', testMessage: 'Exchanging authorization code\u2026' });

        if (isElectron) {
            // Electron: main process does the token exchange (no CORS)
            const result = await window.onicode!.codexOAuthExchange(url);

            if (result.success && result.accessToken) {
                updateProvider('codex', {
                    apiKey: result.accessToken,
                    connected: true,
                    enabled: true,
                    testStatus: 'success',
                    testMessage: 'Signed in with ChatGPT successfully',
                });
                localStorage.setItem('onicode-codex-tokens', JSON.stringify({
                    access_token: result.accessToken,
                    refresh_token: result.refreshToken,
                    expires_in: result.expiresIn,
                    obtained_at: Date.now(),
                }));
            } else {
                updateProvider('codex', {
                    testStatus: 'error',
                    testMessage: result.error || 'Token exchange failed',
                });
            }
        } else {
            // Browser fallback: attempt token exchange from renderer
            // NOTE: This will likely fail due to CORS on auth.openai.com
            try {
                const parsedUrl = new URL(url);
                const code = parsedUrl.searchParams.get('code');
                if (!code) {
                    updateProvider('codex', { testStatus: 'error', testMessage: 'No code found in URL' });
                    setAuthState('idle');
                    setRedirectUrl('');
                    return;
                }

                const verifier = fallbackVerifier;
                if (!verifier) {
                    updateProvider('codex', { testStatus: 'error', testMessage: 'PKCE verifier lost. Try signing in again.' });
                    setAuthState('idle');
                    setRedirectUrl('');
                    return;
                }

                const res = await fetch(CODEX_OAUTH.tokenEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        grant_type: 'authorization_code',
                        client_id: CODEX_OAUTH.clientId,
                        code,
                        redirect_uri: CODEX_OAUTH.redirectUri,
                        code_verifier: verifier,
                    }),
                });

                if (res.ok) {
                    const json = await res.json();
                    if (json.access_token) {
                        updateProvider('codex', {
                            apiKey: json.access_token,
                            connected: true,
                            enabled: true,
                            testStatus: 'success',
                            testMessage: 'Signed in with ChatGPT successfully',
                        });
                        localStorage.setItem('onicode-codex-tokens', JSON.stringify({
                            access_token: json.access_token,
                            refresh_token: json.refresh_token,
                            expires_in: json.expires_in,
                            obtained_at: Date.now(),
                        }));
                    } else {
                        updateProvider('codex', { testStatus: 'error', testMessage: json.error_description || json.error || 'No token received' });
                    }
                } else {
                    const err = await res.json().catch(() => ({}));
                    updateProvider('codex', {
                        testStatus: 'error',
                        testMessage: err.error_description || err.error || `HTTP ${res.status} — CORS may block this in browser. Run with Electron.`,
                    });
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Unknown error';
                updateProvider('codex', { testStatus: 'error', testMessage: `Token exchange failed: ${msg}` });
            }
        }

        setAuthState('idle');
        setRedirectUrl('');
        setFallbackVerifier(null);
    }, [redirectUrl, fallbackVerifier, updateProvider]);

    const cancelOAuth = useCallback(async () => {
        if (isElectron) await window.onicode!.codexOAuthCancel();
        setAuthState('idle');
        setRedirectUrl('');
        setFallbackVerifier(null);
        updateProvider('codex', { testStatus: 'idle', testMessage: '' });
    }, [updateProvider]);

    // ── Test connection ──
    const testConnection = useCallback(async (provider: ProviderConfig) => {
        updateProvider(provider.id, { testStatus: 'testing', testMessage: '' });

        if (isElectron) {
            const result = await window.onicode!.testProvider({
                id: provider.id,
                apiKey: provider.apiKey,
                baseUrl: provider.baseUrl,
            });

            if (result.success) {
                updateProvider(provider.id, {
                    testStatus: 'success',
                    testMessage: result.modelCount ? `Connected \u2014 ${result.modelCount} models available` : 'Connected',
                    connected: true,
                    enabled: true,
                    models: result.models || provider.models,
                });
            } else {
                updateProvider(provider.id, {
                    testStatus: 'error',
                    testMessage: result.error || 'Connection failed',
                    connected: false,
                });
            }
        } else {
            // Browser fallback: test with a minimal chat completion instead of /v1/models
            // because /v1/models returns 403 from browser origins for many tokens
            try {
                if (provider.id === 'codex') {
                    if (!provider.apiKey?.trim()) {
                        updateProvider(provider.id, { testStatus: 'error', testMessage: 'API key is required' });
                        return;
                    }

                    // Try /v1/models first
                    let modelsWorked = false;
                    try {
                        const modelsRes = await fetch('https://api.openai.com/v1/models', {
                            headers: { Authorization: `Bearer ${provider.apiKey}` },
                        });
                        if (modelsRes.ok) {
                            const data = await modelsRes.json();
                            const allModels = data.data?.map((m: { id: string }) => m.id).sort() || [];
                            const relevant = allModels.filter((m: string) =>
                                m.includes('gpt-5') || m.includes('gpt-4') || m.includes('o3') || m.includes('o4') || m.includes('codex')
                            );
                            updateProvider(provider.id, {
                                testStatus: 'success',
                                testMessage: `Connected \u2014 ${data.data?.length || 0} models available`,
                                connected: true, enabled: true,
                                models: relevant.length > 0 ? relevant : provider.models,
                            });
                            modelsWorked = true;
                        }
                    } catch { /* CORS or network error, try fallback */ }

                    if (!modelsWorked) {
                        // Fallback: send a tiny non-streaming request to verify the key works
                        const testRes = await fetch('https://api.openai.com/v1/chat/completions', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${provider.apiKey}`,
                            },
                            body: JSON.stringify({
                                model: provider.selectedModel || 'gpt-4o',
                                messages: [{ role: 'user', content: 'Hi' }],
                                max_tokens: 1,
                            }),
                        });

                        if (testRes.ok || testRes.status === 200) {
                            updateProvider(provider.id, {
                                testStatus: 'success',
                                testMessage: 'Connected \u2014 API key verified',
                                connected: true, enabled: true,
                            });
                        } else if (testRes.status === 401) {
                            updateProvider(provider.id, {
                                testStatus: 'error',
                                testMessage: 'Authentication failed (401). Check your API key.',
                                connected: false,
                            });
                        } else if (testRes.status === 403) {
                            // 403 on chat completions usually means the token doesn't have model.request scope
                            // But the key IS valid — mark as connected, user can try different models
                            const errBody = await testRes.json().catch(() => ({}));
                            const errMsg = errBody.error?.message || '';
                            if (errMsg.includes('model') || errMsg.includes('permission')) {
                                updateProvider(provider.id, {
                                    testStatus: 'success',
                                    testMessage: `Connected \u2014 key valid, but "${provider.selectedModel || 'gpt-4o'}" may need different permissions. Try another model.`,
                                    connected: true, enabled: true,
                                });
                            } else {
                                updateProvider(provider.id, {
                                    testStatus: 'error',
                                    testMessage: errMsg || `Access denied (403)`,
                                    connected: false,
                                });
                            }
                        } else {
                            const errBody = await testRes.json().catch(() => ({}));
                            updateProvider(provider.id, {
                                testStatus: 'error',
                                testMessage: errBody.error?.message || `HTTP ${testRes.status}`,
                                connected: false,
                            });
                        }
                    }
                } else if (provider.id === 'anthropic') {
                    // Anthropic API test
                    if (!provider.apiKey?.trim()) {
                        updateProvider(provider.id, { testStatus: 'error', testMessage: 'Anthropic API key is required' });
                        return;
                    }
                    try {
                        const testRes = await fetch('https://api.anthropic.com/v1/messages', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'x-api-key': provider.apiKey,
                                'anthropic-version': '2023-06-01',
                                'anthropic-dangerous-direct-browser-access': 'true',
                            },
                            body: JSON.stringify({
                                model: provider.selectedModel || 'claude-sonnet-4-6',
                                max_tokens: 1,
                                messages: [{ role: 'user', content: 'Hi' }],
                            }),
                        });
                        if (testRes.ok || testRes.status === 200) {
                            updateProvider(provider.id, {
                                testStatus: 'success',
                                testMessage: 'Connected — Anthropic API key verified',
                                connected: true, enabled: true,
                            });
                        } else if (testRes.status === 401) {
                            updateProvider(provider.id, {
                                testStatus: 'error',
                                testMessage: 'Authentication failed (401). Check your API key.',
                                connected: false,
                            });
                        } else {
                            const errBody = await testRes.json().catch(() => ({}));
                            updateProvider(provider.id, {
                                testStatus: 'error',
                                testMessage: errBody.error?.message || `HTTP ${testRes.status}`,
                                connected: false,
                            });
                        }
                    } catch (err) {
                        // CORS may block browser requests to Anthropic — suggest using Electron
                        updateProvider(provider.id, {
                            testStatus: 'error',
                            testMessage: err instanceof Error ? `${err.message} — CORS may block this in browser. Run with Electron.` : 'Connection failed',
                            connected: false,
                        });
                    }
                } else if (provider.id === 'ollama') {
                    // Ollama uses OpenAI-compatible API — test by listing models
                    const base = (provider.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
                    try {
                        const res = await fetch(`${base}/api/tags`);
                        if (res.ok) {
                            const data = await res.json();
                            const models = data.models?.map((m: { name: string }) => m.name) || [];
                            if (models.length === 0) {
                                updateProvider(provider.id, {
                                    testStatus: 'error',
                                    testMessage: 'Ollama is running but no models installed. Run: ollama pull llama3.3',
                                    connected: false,
                                });
                            } else {
                                updateProvider(provider.id, {
                                    testStatus: 'success',
                                    testMessage: `Connected — ${models.length} model${models.length !== 1 ? 's' : ''} available`,
                                    connected: true, enabled: true,
                                    models,
                                    selectedModel: provider.selectedModel && models.includes(provider.selectedModel) ? provider.selectedModel : models[0],
                                });
                            }
                        } else {
                            updateProvider(provider.id, {
                                testStatus: 'error',
                                testMessage: `HTTP ${res.status} — check Ollama is running`,
                                connected: false,
                            });
                        }
                    } catch {
                        updateProvider(provider.id, {
                            testStatus: 'error',
                            testMessage: 'Cannot reach Ollama — is it running? Start with: ollama serve',
                            connected: false,
                        });
                    }
                } else {
                    // Gateway test
                    if (!provider.baseUrl?.trim()) {
                        updateProvider(provider.id, { testStatus: 'error', testMessage: 'Gateway URL is required' });
                        return;
                    }
                    const headers: Record<string, string> = {};
                    if (provider.apiKey?.trim()) headers['Authorization'] = `Bearer ${provider.apiKey}`;
                    const url = `${provider.baseUrl.replace(/\/$/, '')}/v1/models`;

                    const res = await fetch(url, { headers });
                    if (res.ok) {
                        let modelCount = 0;
                        let models: string[] | undefined;
                        try {
                            const data = await res.json();
                            if (data.data) {
                                modelCount = data.data.length;
                                models = data.data.map((m: { id: string }) => m.id).sort();
                            }
                        } catch {}
                        updateProvider(provider.id, {
                            testStatus: 'success',
                            testMessage: modelCount > 0 ? `Connected \u2014 ${modelCount} models` : 'Connected',
                            connected: true, enabled: true,
                            models: models && models.length > 0 ? models : provider.models,
                        });
                    } else {
                        updateProvider(provider.id, {
                            testStatus: 'error',
                            testMessage: `HTTP ${res.status} \u2014 check URL and credentials`,
                            connected: false,
                        });
                    }
                }
            } catch (err) {
                updateProvider(provider.id, {
                    testStatus: 'error',
                    testMessage: err instanceof Error ? err.message : 'Connection failed',
                    connected: false,
                });
            }
        }
    }, [updateProvider]);

    const toggleExpanded = (id: string) => {
        // Don't expand coming-soon providers
        const p = providers.find(pr => pr.id === id);
        if (p?.comingSoon) return;
        setExpandedProvider((prev) => (prev === id ? null : id));
    };

    const expanded = expandedProvider ? providers.find(p => p.id === expandedProvider) : null;

    return (
        <div className="provider-settings">
            {/* Grid of provider cards */}
            <div className="provider-grid">
                {providers.map((provider) => (
                    <div
                        key={provider.id}
                        className={`provider-tile ${expandedProvider === provider.id ? 'provider-tile-active' : ''} ${provider.comingSoon ? 'provider-tile-coming-soon' : provider.enabled ? 'provider-tile-enabled' : 'provider-tile-disabled'}`}
                        onClick={() => toggleExpanded(provider.id)}
                    >
                        <div className="provider-tile-top">
                            <div className="provider-tile-icon">{provider.initials}</div>
                            {!provider.comingSoon && (
                                <button
                                    className={`provider-toggle ${provider.enabled ? 'active' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        updateProvider(provider.id, { enabled: !provider.enabled });
                                    }}
                                    title={provider.enabled ? 'Disable' : 'Enable'}
                                />
                            )}
                            {provider.comingSoon && (
                                <span className="provider-coming-soon-badge">Coming Soon</span>
                            )}
                        </div>
                        <div className="provider-tile-name">{provider.name}</div>
                        <div className="provider-tile-desc">{provider.description}</div>
                        <div className="provider-tile-status">
                            {provider.comingSoon ? (
                                <span className="connection-badge" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}>Unavailable</span>
                            ) : (
                                <>
                                    {provider.connected && <span className="connection-badge connected">Connected</span>}
                                    {!provider.connected && provider.enabled && <span className="connection-badge" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}>Not connected</span>}
                                    {!provider.enabled && <span className="connection-badge" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}>Disabled</span>}
                                    {provider.testStatus === 'error' && <span className="connection-badge error">Error</span>}
                                </>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Expanded config panel below the grid */}
            {expanded && (
                <div className="provider-card expanded">
                    <div className="provider-card-header" onClick={() => toggleExpanded(expanded.id)}>
                        <div className="provider-icon">{expanded.initials}</div>
                        <div className="provider-info">
                            <div className="provider-name">{expanded.name}</div>
                            <div className="provider-status">{expanded.description}</div>
                        </div>
                        <svg
                            className="expand-chevron open"
                            width="18" height="18" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        >
                            <polyline points="6 9 12 15 18 9" />
                        </svg>
                    </div>
                    <div className="provider-card-body">
                            {/* URL + API Key fields */}
                            <div className="field-group">
                                {expanded.authType === 'url-key' && (
                                    <>
                                        <label className="field-label">
                                            {expanded.id === 'ollama' ? 'Ollama URL' : 'Gateway URL'}
                                        </label>
                                        <input
                                            className="field-input" type="url"
                                            placeholder={
                                                expanded.id === 'ollama' ? 'http://localhost:11434' :
                                                expanded.id === 'onigateway' ? 'https://your-oni-gateway.com' : 'https://gateway.openclaw.io'
                                            }
                                            value={expanded.baseUrl || ''}
                                            onChange={(e) => updateProvider(expanded.id, { baseUrl: e.target.value })}
                                            spellCheck={false}
                                        />
                                    </>
                                )}
                                {expanded.id !== 'ollama' && expanded.id !== 'codex' && (
                                    <>
                                        <label className="field-label">
                                            {expanded.id === 'openai' ? 'OpenAI API Key' : expanded.id === 'anthropic' ? 'Anthropic API Key' : 'API Key'}
                                            {expanded.id === 'openai' && (
                                                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="field-link">Get key</a>
                                            )}
                                            {expanded.id === 'anthropic' && (
                                                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="field-link">Get key</a>
                                            )}
                                        </label>
                                        <input
                                            className="field-input" type="password"
                                            placeholder={
                                                expanded.id === 'openai' ? 'sk-...' :
                                                expanded.id === 'anthropic' ? 'sk-ant-...' :
                                                'Enter API key (optional)'
                                            }
                                            value={expanded.apiKey || ''}
                                            onChange={(e) => updateProvider(expanded.id, { apiKey: e.target.value })}
                                            spellCheck={false}
                                        />
                                    </>
                                )}
                                {expanded.id === 'codex' && (
                                    <>
                                        <label className="field-label">
                                            API Key <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 11, color: 'var(--text-tertiary)' }}>(or use ChatGPT sign-in below)</span>
                                        </label>
                                        <input
                                            className="field-input" type="password"
                                            placeholder="sk-..."
                                            value={expanded.apiKey || ''}
                                            onChange={(e) => updateProvider(expanded.id, { apiKey: e.target.value })}
                                            spellCheck={false}
                                        />
                                    </>
                                )}
                                {expanded.id === 'openai' && (
                                    <div className="field-hint">
                                        Standard API key from platform.openai.com. Use "Refresh" in model picker to pull your available models.
                                    </div>
                                )}
                                {expanded.id === 'codex' && (
                                    <div className="field-hint">
                                        Uses your ChatGPT Plus/Pro subscription. Enter an API key above or sign in with ChatGPT below.
                                    </div>
                                )}
                                {expanded.id === 'anthropic' && (
                                    <div className="field-hint">
                                        Get an API key from console.anthropic.com. Supports Claude Opus, Sonnet, and Haiku.
                                    </div>
                                )}
                                {expanded.id === 'ollama' && (
                                    <div className="field-hint">
                                        No API key needed. Make sure Ollama is running locally. Install models with: ollama pull llama3.3
                                    </div>
                                )}
                            </div>

                            {/* Codex ChatGPT OAuth sign-in (paste redirect URL flow) */}
                            {expanded.id === 'codex' && (
                                <div className="field-group">
                                    <div className="auth-divider"><span>or sign in with ChatGPT</span></div>

                                    {authState === 'idle' && (
                                        <button className="auth-btn" onClick={startChatGPTSignIn}>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
                                                <polyline points="10 17 15 12 10 7" />
                                                <line x1="15" y1="12" x2="3" y2="12" />
                                            </svg>
                                            Sign in with ChatGPT
                                        </button>
                                    )}

                                    {authState === 'waiting-for-redirect' && (
                                        <div className="oauth-redirect-flow">
                                            <div className="oauth-steps">
                                                <div className="oauth-step">
                                                    <span className="oauth-step-num">1</span>
                                                    Sign in with your ChatGPT account in the browser window
                                                </div>
                                                <div className="oauth-step">
                                                    <span className="oauth-step-num">2</span>
                                                    After sign-in, your browser will redirect to a localhost URL that won&apos;t load
                                                </div>
                                                <div className="oauth-step">
                                                    <span className="oauth-step-num">3</span>
                                                    Copy the <strong>full URL</strong> from your browser&apos;s address bar and paste it below
                                                </div>
                                            </div>
                                            <div className="oauth-url-input-group">
                                                <input
                                                    className="field-input"
                                                    type="text"
                                                    placeholder="http://localhost:1455/auth/callback?code=..."
                                                    value={redirectUrl}
                                                    onChange={(e) => setRedirectUrl(e.target.value)}
                                                    spellCheck={false}
                                                    autoFocus
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleRedirectSubmit();
                                                    }}
                                                />
                                                <div className="oauth-actions">
                                                    <button
                                                        className="test-btn"
                                                        onClick={handleRedirectSubmit}
                                                        disabled={!redirectUrl.trim()}
                                                    >
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                                            <polyline points="20 6 9 17 4 12" />
                                                        </svg>
                                                        Submit
                                                    </button>
                                                    <button className="disconnect-btn" onClick={cancelOAuth}>
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {authState === 'exchanging' && (
                                        <div className="test-result testing">
                                            <span className="test-spinner" />
                                            Exchanging authorization code for token...
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Model selection */}
                            {expanded.models && expanded.models.length > 0 && (
                                <div className="field-group">
                                    <label className="field-label">Model</label>
                                    <select
                                        className="field-select"
                                        value={expanded.selectedModel || ''}
                                        onChange={(e) => updateProvider(expanded.id, { selectedModel: e.target.value })}
                                    >
                                        {expanded.models.map((model) => (
                                            <option key={model} value={model}>{model}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Test connection */}
                            <div className="field-group">
                                <button
                                    className={`test-btn ${expanded.testStatus || ''}`}
                                    onClick={() => testConnection(expanded)}
                                    disabled={expanded.testStatus === 'testing'}
                                >
                                    {expanded.testStatus === 'testing' ? (
                                        <><span className="test-spinner" /> Testing...</>
                                    ) : (
                                        <>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                                                <polyline points="22 4 12 14.01 9 11.01" />
                                            </svg>
                                            Test Connection
                                        </>
                                    )}
                                </button>
                                {expanded.testMessage && (
                                    <div className={`test-result ${expanded.testStatus}`}>
                                        {expanded.testStatus === 'success' && (
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12" />
                                            </svg>
                                        )}
                                        {expanded.testStatus === 'error' && (
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <circle cx="12" cy="12" r="10" />
                                                <line x1="15" y1="9" x2="9" y2="15" />
                                                <line x1="9" y1="9" x2="15" y2="15" />
                                            </svg>
                                        )}
                                        {expanded.testMessage}
                                    </div>
                                )}
                            </div>

                            {/* Disconnect */}
                            {expanded.connected && (
                                <button
                                    className="disconnect-btn"
                                    onClick={() => {
                                        updateProvider(expanded.id, {
                                            connected: false, enabled: false,
                                            testStatus: 'idle', testMessage: '', apiKey: '',
                                        });
                                        if (expanded.id === 'codex') localStorage.removeItem('onicode-codex-tokens');
                                    }}
                                >
                                    Disconnect
                                </button>
                            )}
                        </div>
                </div>
            )}
        </div>
    );
}
