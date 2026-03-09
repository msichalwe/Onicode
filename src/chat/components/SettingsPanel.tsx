import React, { useState, useEffect, useCallback } from 'react';
import { useTheme, type ThemeName } from '../hooks/useTheme';
import ProviderSettings from './ProviderSettings';

const isElectron = typeof window !== 'undefined' && !!window.onicode;

const THEMES: { id: ThemeName; name: string; previewClass: string }[] = [
    { id: 'sand', name: 'Oni Sand', previewClass: 'theme-preview-sand' },
    { id: 'midnight', name: 'Oni Midnight', previewClass: 'theme-preview-midnight' },
    { id: 'obsidian', name: 'Oni Obsidian', previewClass: 'theme-preview-obsidian' },
    { id: 'ocean', name: 'Oni Ocean', previewClass: 'theme-preview-ocean' },
];

interface ConnectorState {
    connected: boolean;
    username?: string;
    avatarUrl?: string;
    loading?: boolean;
    error?: string;
    // GitHub device flow
    userCode?: string;
    verificationUri?: string;
    polling?: boolean;
}

export default function SettingsPanel() {
    const { theme, setTheme } = useTheme();
    const [github, setGithub] = useState<ConnectorState>({ connected: false });
    const [gmail, setGmail] = useState<ConnectorState>({ connected: false });

    const loadConnectors = useCallback(async () => {
        if (!isElectron) return;
        const res = await window.onicode!.connectorList();
        const c = res.connectors || {};
        if (c.github) setGithub({ connected: true, username: c.github.username, avatarUrl: c.github.avatarUrl });
        if (c.gmail) setGmail({ connected: true, username: c.gmail.username, avatarUrl: c.gmail.avatarUrl });
    }, []);

    useEffect(() => { loadConnectors(); }, [loadConnectors]);

    // ── GitHub Device Flow ──
    const connectGithub = useCallback(async () => {
        if (!isElectron) return;
        setGithub(prev => ({ ...prev, loading: true, error: undefined }));

        const startRes = await window.onicode!.connectorGithubStart();
        if (startRes.error || !startRes.deviceCode) {
            setGithub(prev => ({ ...prev, loading: false, error: startRes.error || 'Failed to start' }));
            return;
        }

        setGithub(prev => ({
            ...prev,
            loading: false,
            userCode: startRes.userCode,
            verificationUri: startRes.verificationUri,
            polling: true,
        }));

        // Open verification URL in browser
        if (startRes.verificationUri) {
            window.open(startRes.verificationUri, '_blank');
        }

        // Poll for result
        const pollRes = await window.onicode!.connectorGithubPoll(startRes.deviceCode!, startRes.interval);
        if (pollRes.success) {
            setGithub({ connected: true, username: pollRes.username, avatarUrl: pollRes.avatarUrl });
        } else {
            setGithub(prev => ({ ...prev, polling: false, error: pollRes.error }));
        }
    }, []);

    const disconnectGithub = useCallback(async () => {
        if (!isElectron) return;
        await window.onicode!.connectorDisconnect('github');
        await window.onicode!.connectorGithubCancel();
        setGithub({ connected: false });
    }, []);

    // ── Gmail / Google OAuth ──
    const connectGmail = useCallback(async () => {
        if (!isElectron) return;
        setGmail(prev => ({ ...prev, loading: true, error: undefined }));

        // Listen for the result from the redirect
        const cleanup = window.onicode!.onConnectorGoogleResult((result) => {
            if (result.success) {
                setGmail({ connected: true, username: result.email || result.name });
            } else {
                setGmail(prev => ({ ...prev, loading: false, error: result.error }));
            }
            cleanup();
        });

        const res = await window.onicode!.connectorGoogleStart();
        if (res.error) {
            setGmail(prev => ({ ...prev, loading: false, error: res.error }));
            cleanup();
        }
        // Browser opens automatically via shell.openExternal in main process
    }, []);

    const disconnectGmail = useCallback(async () => {
        if (!isElectron) return;
        await window.onicode!.connectorDisconnect('gmail');
        await window.onicode!.connectorGoogleCancel();
        setGmail({ connected: false });
    }, []);

    const [panelMode, setPanelMode] = useState(() => localStorage.getItem('onicode-panel-mode') || 'always');

    const changePanelMode = useCallback((mode: string) => {
        setPanelMode(mode);
        window.dispatchEvent(new CustomEvent('onicode-panel-mode', { detail: mode }));
    }, []);

    return (
        <div className="settings-panel">
            <h2>Settings</h2>

            <div className="settings-section">
                <h3>Appearance</h3>
                <div className="theme-grid">
                    {THEMES.map(t => (
                        <div
                            key={t.id}
                            className={`theme-card ${theme === t.id ? 'active' : ''}`}
                            onClick={() => setTheme(t.id)}
                        >
                            <div className={`theme-preview ${t.previewClass}`} />
                            <div className="theme-card-name">{t.name}</div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="settings-section">
                <h3>Side Panel</h3>
                <div className="setting-row">
                    <div className="setting-label">
                        <span className="setting-name">Panel Visibility</span>
                        <span className="setting-desc">Controls whether the right panel (terminal, files, browser) is always shown or hidden by default</span>
                    </div>
                    <div className="setting-toggle-group">
                        <button
                            className={`setting-toggle-btn ${panelMode === 'always' ? 'active' : ''}`}
                            onClick={() => changePanelMode('always')}
                            title="Always show side panel"
                        >Always Shown</button>
                        <button
                            className={`setting-toggle-btn ${panelMode === 'hidden' ? 'active' : ''}`}
                            onClick={() => changePanelMode('hidden')}
                            title="Hide side panel by default"
                        >Hidden</button>
                    </div>
                </div>
            </div>

            <div className="settings-section">
                <h3>AI Providers</h3>
                <ProviderSettings />
            </div>

            <div className="settings-section">
                <h3>Connectors</h3>

                {/* GitHub */}
                <div className="connector-item">
                    <div className="connector-icon github">GH</div>
                    <div className="connector-info">
                        <div className="connector-name">GitHub</div>
                        <div className={`connector-status ${github.connected ? 'connected' : ''}`}>
                            {github.connected ? `Connected as ${github.username}` : github.loading ? 'Connecting...' : 'Not connected'}
                        </div>
                        {github.error && <div className="connector-status connector-error">{github.error}</div>}
                    </div>
                    {github.connected ? (
                        <button className="connector-btn disconnect" onClick={disconnectGithub}>Disconnect</button>
                    ) : github.polling ? (
                        <div className="connector-expand">
                            <p>Enter this code on GitHub:</p>
                            <div className="connector-device-code">
                                {github.userCode}
                            </div>
                            <p>Waiting for authorization...</p>
                        </div>
                    ) : (
                        <button className="connector-btn connect" onClick={connectGithub} disabled={github.loading}>
                            {github.loading ? 'Starting...' : 'Connect'}
                        </button>
                    )}
                </div>

                {/* Gmail */}
                <div className="connector-item">
                    <div className="connector-icon gmail">Gm</div>
                    <div className="connector-info">
                        <div className="connector-name">Gmail</div>
                        <div className={`connector-status ${gmail.connected ? 'connected' : ''}`}>
                            {gmail.connected ? `Connected as ${gmail.username}` : gmail.loading ? 'Authenticating...' : 'Not connected'}
                        </div>
                        {gmail.error && <div className="connector-status connector-error">{gmail.error}</div>}
                    </div>
                    {gmail.connected ? (
                        <button className="connector-btn disconnect" onClick={disconnectGmail}>Disconnect</button>
                    ) : (
                        <button className="connector-btn connect" onClick={connectGmail} disabled={gmail.loading}>
                            {gmail.loading ? 'Opening browser...' : 'Connect'}
                        </button>
                    )}
                </div>

                {/* Slack (placeholder) */}
                <div className="connector-item">
                    <div className="connector-icon slack">Sl</div>
                    <div className="connector-info">
                        <div className="connector-name">Slack</div>
                        <div className="connector-status">Coming soon</div>
                    </div>
                    <button className="connector-btn connect" disabled>Connect</button>
                </div>
            </div>

            <div className="settings-section">
                <h3>API Key Store</h3>
                <div className="provider-list">
                    <div className="provider-item" style={{ cursor: 'pointer' }}>
                        <div className="provider-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                            </svg>
                        </div>
                        <div className="provider-info">
                            <div className="provider-name">Global Key Vault</div>
                            <div className="provider-status">0 keys stored — click to manage</div>
                        </div>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary)' }}>
                            <polyline points="9 18 15 12 9 6" />
                        </svg>
                    </div>
                </div>
            </div>
        </div>
    );
}
