import React from 'react';
import { isElectron } from '../../utils';

export default function DataTab() {
    return (
        <div className="settings-tab-content">
            <div className="settings-section">
                <h3>Conversations</h3>
                <p className="settings-section-desc">Manage your chat history stored in localStorage and SQLite.</p>
                <div className="settings-data-actions">
                    <button className="settings-data-btn" onClick={() => {
                        if (confirm('Clear all conversations? This cannot be undone.')) {
                            const convs = JSON.parse(localStorage.getItem('onicode-conversations') || '[]');
                            localStorage.removeItem('onicode-conversations');
                            localStorage.removeItem('onicode-active-conversation');
                            // Delete each from SQLite
                            if (isElectron) {
                                for (const c of convs) {
                                    window.onicode?.conversationDelete(c.id).catch(() => {});
                                }
                            }
                            window.dispatchEvent(new CustomEvent('onicode-new-chat'));
                        }
                    }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                        Clear All Conversations
                    </button>
                    <button className="settings-data-btn" onClick={() => {
                        try {
                            const convs = JSON.parse(localStorage.getItem('onicode-conversations') || '[]');
                            const blob = new Blob([JSON.stringify(convs, null, 2)], { type: 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = `onicode-conversations-${new Date().toISOString().slice(0,10)}.json`;
                            a.click(); URL.revokeObjectURL(url);
                        } catch {}
                    }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                        Export Conversations
                    </button>
                </div>
            </div>

            <div className="settings-section">
                <h3>Memory</h3>
                <p className="settings-section-desc">AI memories stored in SQLite (<code>~/.onicode/onicode.db</code>).</p>
                <div className="settings-data-actions">
                    <button className="settings-data-btn" onClick={() => {
                        if (confirm('Clear all memories? The AI will lose all learned preferences, facts, and session logs.')) {
                            if (isElectron) {
                                // Delete all memory files listed
                                window.onicode?.memoryList().then(res => {
                                    if (res?.files) {
                                        for (const f of res.files) {
                                            window.onicode?.memoryDelete(f.name).catch(() => {});
                                        }
                                    }
                                    // Re-create defaults (soul, etc.)
                                    window.onicode?.memoryEnsureDefaults().catch(() => {});
                                }).catch(() => {});
                            }
                            alert('Memory reset to defaults.');
                        }
                    }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" /></svg>
                        Reset All Memories
                    </button>
                </div>
            </div>

            <div className="settings-section">
                <h3>Cache</h3>
                <p className="settings-section-desc">Clear cached data and reset the app state.</p>
                <div className="settings-data-actions">
                    <button className="settings-data-btn settings-data-btn-danger" onClick={() => {
                        if (confirm('Reset ALL app data? This clears conversations, settings, providers, and preferences.')) {
                            localStorage.clear();
                            window.location.reload();
                        }
                    }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                        Factory Reset
                    </button>
                </div>
            </div>
        </div>
    );
}
