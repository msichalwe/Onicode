import React from 'react';
import { useTheme, type ThemeName } from '../hooks/useTheme';
import ProviderSettings from './ProviderSettings';

const THEMES: { id: ThemeName; name: string; previewClass: string }[] = [
    { id: 'sand', name: 'Oni Sand', previewClass: 'theme-preview-sand' },
    { id: 'midnight', name: 'Oni Midnight', previewClass: 'theme-preview-midnight' },
    { id: 'obsidian', name: 'Oni Obsidian', previewClass: 'theme-preview-obsidian' },
    { id: 'ocean', name: 'Oni Ocean', previewClass: 'theme-preview-ocean' },
];

export default function SettingsPanel() {
    const { theme, setTheme } = useTheme();

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
                <h3>AI Providers</h3>
                <ProviderSettings />
            </div>

            <div className="settings-section">
                <h3>Connectors</h3>
                <div className="provider-list">
                    {[
                        { id: 'github', name: 'GitHub', initials: 'GH', status: 'Not connected' },
                        { id: 'gmail', name: 'Gmail', initials: 'Gm', status: 'Not connected' },
                        { id: 'slack', name: 'Slack', initials: 'Sl', status: 'Not connected' },
                    ].map(connector => (
                        <div key={connector.id} className="provider-item">
                            <div className="provider-icon">{connector.initials}</div>
                            <div className="provider-info">
                                <div className="provider-name">{connector.name}</div>
                                <div className="provider-status">{connector.status}</div>
                            </div>
                            <button className="provider-toggle" />
                        </div>
                    ))}
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
