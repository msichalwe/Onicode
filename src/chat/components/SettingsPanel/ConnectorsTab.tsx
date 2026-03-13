import React, { useState } from 'react';
import type { ConnectorsTabProps } from './types';

export default function ConnectorsTab({
    github, gmail,
    connectGithub, disconnectGithub,
    verifyGws, disconnectGmail,
    vaultKeys, vaultStatus,
    showAddKey, setShowAddKey,
    newKeyName, setNewKeyName,
    newKeyValue, setNewKeyValue,
    newKeyProvider, setNewKeyProvider,
    newKeyNotes, setNewKeyNotes,
    addVaultKey, deleteVaultKey,
}: ConnectorsTabProps) {
    const [gwsSetupOpen, setGwsSetupOpen] = useState(false);

    return (
        <div className="settings-tab-content">
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
                            <div className="connector-device-code">{github.userCode}</div>
                            <p>Waiting for authorization...</p>
                        </div>
                    ) : (
                        <button className="connector-btn connect" onClick={connectGithub} disabled={github.loading}>
                            {github.loading ? 'Starting...' : 'Connect'}
                        </button>
                    )}
                </div>

                {/* Google Workspace (Gmail, Drive, Sheets, Calendar, Docs) */}
                <div className="connector-item" style={{ flexWrap: 'wrap' }}>
                    <div className="connector-icon gmail">Gm</div>
                    <div className="connector-info">
                        <div className="connector-name">Google Workspace</div>
                        <div className={`connector-status ${gmail.connected ? 'connected' : ''}`}>
                            {gmail.connected ? `Connected as ${gmail.username}` : gmail.loading ? 'Verifying...' : 'Not connected'}
                        </div>
                        <div className="connector-status" style={{ fontSize: '0.7rem', opacity: 0.6 }}>Gmail, Drive, Docs, Sheets, Calendar</div>
                        {gmail.error && <div className="connector-status connector-error">{gmail.error}</div>}
                    </div>
                    {gmail.connected ? (
                        <button className="connector-btn disconnect" onClick={disconnectGmail}>Disconnect</button>
                    ) : (
                        <div style={{ display: 'flex', gap: 6 }}>
                            <button className="connector-btn connect" onClick={() => setGwsSetupOpen(!gwsSetupOpen)}>
                                {gwsSetupOpen ? 'Hide Setup' : 'Setup'}
                            </button>
                            <button className="connector-btn connect" onClick={verifyGws} disabled={gmail.loading}>
                                {gmail.loading ? 'Checking...' : 'Verify'}
                            </button>
                        </div>
                    )}
                    {gwsSetupOpen && !gmail.connected && (
                        <div className="connector-expand" style={{ width: '100%', marginTop: 8 }}>
                            <p style={{ fontWeight: 600, marginBottom: 6 }}>Terminal Setup (one-time)</p>
                            <p style={{ fontSize: '0.78rem', opacity: 0.8, marginBottom: 8 }}>
                                Google Workspace requires interactive browser auth. Run these commands in your terminal:
                            </p>
                            <div className="connector-device-code" style={{ fontSize: '0.75rem', textAlign: 'left', padding: '8px 10px', lineHeight: 2 }}>
                                <div><span style={{ opacity: 0.5 }}>1.</span> npm install -g @googleworkspace/cli</div>
                                <div><span style={{ opacity: 0.5 }}>2.</span> gws auth setup</div>
                                <div><span style={{ opacity: 0.5 }}>  </span> <span style={{ opacity: 0.5 }}>Follow prompts, sign in with Google</span></div>
                                <div><span style={{ opacity: 0.5 }}>3.</span> Complete browser OAuth consent</div>
                            </div>
                            <p style={{ fontSize: '0.72rem', opacity: 0.6, marginTop: 6 }}>
                                <strong>gws auth setup</strong> creates a GCP project, enables APIs, and runs login automatically.
                                After setup completes, click <strong>Verify</strong> to confirm.
                                The AI can then use Gmail, Drive, Docs, Sheets, Calendar, and 30+ Google services.
                            </p>
                        </div>
                    )}
                </div>

                {/* Slack */}
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
                <h3>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6, verticalAlign: -2 }}>
                        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                    </svg>
                    API Key Vault
                    {vaultStatus && (
                        <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontWeight: 400, marginLeft: 8 }}>
                            AES-256-GCM {vaultStatus.safeStorage ? '+ OS Keychain' : '(machine key)'}
                        </span>
                    )}
                </h3>

                {vaultKeys.length === 0 && !showAddKey ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '12px' }}>
                        <div style={{ marginBottom: 8 }}>No keys stored yet</div>
                        <button className="connector-btn connect" onClick={() => setShowAddKey(true)}>Add Key</button>
                    </div>
                ) : (
                    <>
                        {vaultKeys.map(key => (
                            <div key={key.id} className="connector-item" style={{ padding: '8px 10px' }}>
                                <div className="connector-icon" style={{ fontSize: '9px', width: 28, height: 28, borderRadius: 6, background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', flexShrink: 0 }}>
                                    {key.provider.slice(0, 2).toUpperCase()}
                                </div>
                                <div className="connector-info" style={{ flex: 1, minWidth: 0 }}>
                                    <div className="connector-name" style={{ fontSize: '12px' }}>{key.name}</div>
                                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <code style={{ fontSize: '10px', letterSpacing: 1 }}>{key.maskedValue}</code>
                                        <span>{key.provider}</span>
                                        {key.notes && <span style={{ opacity: 0.6 }}>{key.notes}</span>}
                                    </div>
                                </div>
                                <button className="connector-btn disconnect" style={{ fontSize: '10px', padding: '3px 8px' }} onClick={() => deleteVaultKey(key.id)}>Remove</button>
                            </div>
                        ))}
                        {!showAddKey && (
                            <button className="connector-btn connect" style={{ marginTop: 8, fontSize: '11px' }} onClick={() => setShowAddKey(true)}>Add Key</button>
                        )}
                    </>
                )}

                {showAddKey && (
                    <div style={{ marginTop: 8, padding: '10px', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <input
                                type="text" placeholder="Key name (e.g. OpenAI Production)" value={newKeyName}
                                onChange={e => setNewKeyName(e.target.value)}
                                style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }}
                            />
                            <select value={newKeyProvider} onChange={e => setNewKeyProvider(e.target.value)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 11 }}>
                                <option value="openai">OpenAI</option>
                                <option value="anthropic">Anthropic</option>
                                <option value="ollama">Ollama</option>
                                <option value="github">GitHub</option>
                                <option value="other">Other</option>
                            </select>
                        </div>
                        <input
                            type="password" placeholder="API key or secret" value={newKeyValue}
                            onChange={e => setNewKeyValue(e.target.value)}
                            style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 11, outline: 'none', fontFamily: 'JetBrains Mono, monospace' }}
                        />
                        <input
                            type="text" placeholder="Notes (optional)" value={newKeyNotes}
                            onChange={e => setNewKeyNotes(e.target.value)}
                            style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }}
                        />
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button className="connector-btn" style={{ fontSize: '10px', padding: '4px 10px' }} onClick={() => { setShowAddKey(false); setNewKeyName(''); setNewKeyValue(''); setNewKeyNotes(''); }}>Cancel</button>
                            <button className="connector-btn connect" style={{ fontSize: '10px', padding: '4px 10px' }} onClick={addVaultKey} disabled={!newKeyName.trim() || !newKeyValue.trim()}>Save Key</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
