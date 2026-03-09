import React, { useState, useEffect, useCallback } from 'react';
import { useTheme, type ThemeName } from '../hooks/useTheme';
import ProviderSettings from './ProviderSettings';
import { loadSkills, saveSkills, getSkillCategories, type Skill } from '../commands/skills';

const isElectron = typeof window !== 'undefined' && !!window.onicode;

// ══════════════════════════════════════════
//  Theme Definitions
// ══════════════════════════════════════════

const THEMES: { id: ThemeName; name: string; previewClass: string; type: 'light' | 'dark' | 'neutral' }[] = [
    { id: 'default-light', name: 'Default Light', previewClass: 'theme-preview-default-light', type: 'light' },
    { id: 'sand', name: 'Oni Sand', previewClass: 'theme-preview-sand', type: 'light' },
    { id: 'neutral', name: 'Neutral', previewClass: 'theme-preview-neutral', type: 'neutral' },
    { id: 'default-dark', name: 'Default Dark', previewClass: 'theme-preview-default-dark', type: 'dark' },
    { id: 'midnight', name: 'Oni Midnight', previewClass: 'theme-preview-midnight', type: 'dark' },
    { id: 'obsidian', name: 'Oni Obsidian', previewClass: 'theme-preview-obsidian', type: 'dark' },
    { id: 'ocean', name: 'Oni Ocean', previewClass: 'theme-preview-ocean', type: 'dark' },
    { id: 'aurora', name: 'Aurora', previewClass: 'theme-preview-aurora', type: 'dark' },
    { id: 'monokai', name: 'Monokai', previewClass: 'theme-preview-monokai', type: 'dark' },
    { id: 'rosepine', name: 'Rosé Pine', previewClass: 'theme-preview-rosepine', type: 'dark' },
    { id: 'nord', name: 'Nord', previewClass: 'theme-preview-nord', type: 'dark' },
    { id: 'catppuccin', name: 'Catppuccin', previewClass: 'theme-preview-catppuccin', type: 'dark' },
];

// ══════════════════════════════════════════
//  Tab Definitions
// ══════════════════════════════════════════

type SettingsTab = 'appearance' | 'providers' | 'skills' | 'hooks' | 'mcp' | 'connectors' | 'data';

const TABS: { id: SettingsTab; label: string }[] = [
    { id: 'appearance', label: 'Appearance' },
    { id: 'providers', label: 'Providers' },
    { id: 'skills', label: 'Skills' },
    { id: 'hooks', label: 'Hooks' },
    { id: 'mcp', label: 'MCP' },
    { id: 'connectors', label: 'Connectors' },
    { id: 'data', label: 'Data' },
];

// ══════════════════════════════════════════
//  Connector Types
// ══════════════════════════════════════════

interface ConnectorState {
    connected: boolean;
    username?: string;
    avatarUrl?: string;
    loading?: boolean;
    error?: string;
    userCode?: string;
    verificationUri?: string;
    polling?: boolean;
}

// ══════════════════════════════════════════
//  Component
// ══════════════════════════════════════════

export default function SettingsPanel() {
    const { theme, setTheme } = useTheme();
    const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
    const [github, setGithub] = useState<ConnectorState>({ connected: false });
    const [gmail, setGmail] = useState<ConnectorState>({ connected: false });
    const [skills, setSkills] = useState<Skill[]>(loadSkills);
    const [hooks, setHooks] = useState<Record<string, HookDefinition[]>>({});
    const [customCommands, setCustomCommands] = useState<CustomCommand[]>([]);
    const [newHookType, setNewHookType] = useState('PreToolUse');
    const [newHookCmd, setNewHookCmd] = useState('');
    const [newHookMatcher, setNewHookMatcher] = useState('');
    const [panelMode, setPanelMode] = useState(() => localStorage.getItem('onicode-panel-mode') || 'always');

    const loadConnectors = useCallback(async () => {
        if (!isElectron) return;
        const res = await window.onicode!.connectorList();
        const c = res.connectors || {};
        if (c.github) setGithub({ connected: true, username: c.github.username, avatarUrl: c.github.avatarUrl });
        if (c.gmail) setGmail({ connected: true, username: c.gmail.username, avatarUrl: c.gmail.avatarUrl });
    }, []);

    useEffect(() => { loadConnectors(); }, [loadConnectors]);

    // ── Load Hooks & Custom Commands ──
    const loadHooksAndCommands = useCallback(async () => {
        if (!isElectron) return;
        try {
            const hooksRes = await window.onicode!.hooksList();
            const loadedHooks = (hooksRes as Record<string, unknown>).merged || hooksRes.hooks;
            if (loadedHooks) setHooks(loadedHooks as Record<string, HookDefinition[]>);
        } catch { /* hooks module may not be ready */ }
        try {
            const cmds = await window.onicode!.customCommandsList();
            setCustomCommands(cmds);
        } catch { /* commands module may not be ready */ }
    }, []);

    useEffect(() => { loadHooksAndCommands(); }, [loadHooksAndCommands]);

    const addHook = useCallback(async () => {
        if (!newHookCmd.trim()) return;
        const updated = { ...hooks };
        if (!updated[newHookType]) updated[newHookType] = [];
        updated[newHookType].push({
            command: newHookCmd.trim(),
            ...(newHookMatcher.trim() ? { matcher: newHookMatcher.trim() } : {}),
        });
        setHooks(updated);
        setNewHookCmd('');
        setNewHookMatcher('');
        if (isElectron) await window.onicode!.hooksSave(updated);
    }, [hooks, newHookType, newHookCmd, newHookMatcher]);

    const removeHook = useCallback(async (type: string, index: number) => {
        const updated = { ...hooks };
        if (updated[type]) {
            updated[type] = updated[type].filter((_, i) => i !== index);
            if (updated[type].length === 0) delete updated[type];
        }
        setHooks(updated);
        if (isElectron) await window.onicode!.hooksSave(updated);
    }, [hooks]);

    // ── GitHub Device Flow ──
    const connectGithub = useCallback(async () => {
        if (!isElectron) return;
        setGithub(prev => ({ ...prev, loading: true, error: undefined }));
        const startRes = await window.onicode!.connectorGithubStart();
        if (startRes.error || !startRes.deviceCode) {
            setGithub(prev => ({ ...prev, loading: false, error: startRes.error || 'Failed to start' }));
            return;
        }
        setGithub(prev => ({ ...prev, loading: false, userCode: startRes.userCode, verificationUri: startRes.verificationUri, polling: true }));
        if (startRes.verificationUri) window.open(startRes.verificationUri, '_blank');
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
        const cleanup = window.onicode!.onConnectorGoogleResult((result) => {
            if (result.success) {
                setGmail({ connected: true, username: result.email || result.name });
            } else {
                setGmail(prev => ({ ...prev, loading: false, error: result.error }));
            }
            cleanup();
        });
        const res = await window.onicode!.connectorGoogleStart();
        if (res.error) { setGmail(prev => ({ ...prev, loading: false, error: res.error })); cleanup(); }
    }, []);

    const disconnectGmail = useCallback(async () => {
        if (!isElectron) return;
        await window.onicode!.connectorDisconnect('gmail');
        await window.onicode!.connectorGoogleCancel();
        setGmail({ connected: false });
    }, []);

    const changePanelMode = useCallback((mode: string) => {
        setPanelMode(mode);
        window.dispatchEvent(new CustomEvent('onicode-panel-mode', { detail: mode }));
    }, []);

    // ── Skills toggle ──
    const toggleSkill = useCallback((skillId: string) => {
        setSkills(prev => {
            const updated = prev.map(s => s.id === skillId ? { ...s, enabled: !s.enabled } : s);
            saveSkills(updated);
            return updated;
        });
    }, []);

    const enabledCount = skills.filter(s => s.enabled).length;
    const categories = getSkillCategories();

    // ══════════════════════════════════════════
    //  Render
    // ══════════════════════════════════════════

    return (
        <div className="settings-panel">
            <h2>Settings</h2>

            {/* Tab bar */}
            <div className="settings-tabs">
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                        {tab.id === 'skills' && <span className="settings-tab-badge">{enabledCount}</span>}
                    </button>
                ))}
            </div>

            {/* ── Appearance Tab ── */}
            {activeTab === 'appearance' && (
                <div className="settings-tab-content">
                    <div className="settings-section">
                        <h3>Theme</h3>
                        <div className="theme-grid">
                            {THEMES.map(t => (
                                <div
                                    key={t.id}
                                    className={`theme-card ${theme === t.id ? 'active' : ''}`}
                                    onClick={() => setTheme(t.id)}
                                >
                                    <div className={`theme-preview ${t.previewClass}`} />
                                    <div className="theme-card-name">{t.name}</div>
                                    <div className="theme-card-type">{t.type}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="settings-section">
                        <h3>Side Panel</h3>
                        <div className="setting-row">
                            <div className="setting-label">
                                <span className="setting-name">Panel Visibility</span>
                                <span className="setting-desc">Show or hide the right panel (terminal, files, browser)</span>
                            </div>
                            <div className="setting-toggle-group">
                                <button className={`setting-toggle-btn ${panelMode === 'always' ? 'active' : ''}`} onClick={() => changePanelMode('always')}>Always</button>
                                <button className={`setting-toggle-btn ${panelMode === 'hidden' ? 'active' : ''}`} onClick={() => changePanelMode('hidden')}>Hidden</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Providers Tab ── */}
            {activeTab === 'providers' && (
                <div className="settings-tab-content">
                    <div className="settings-section">
                        <h3>AI Providers</h3>
                        <ProviderSettings />
                    </div>
                </div>
            )}

            {/* ── Skills Tab ── */}
            {activeTab === 'skills' && (
                <div className="settings-tab-content">
                    <div className="settings-section">
                        <h3>AI Skills ({enabledCount}/{skills.length} enabled)</h3>
                        <p className="settings-section-desc">Skills enhance the AI with specialized capabilities. Enable the skills you want the AI to use proactively.</p>

                        {categories.map(cat => {
                            const catSkills = skills.filter(s => s.category === cat.id);
                            if (catSkills.length === 0) return null;
                            return (
                                <div key={cat.id} className="skill-category">
                                    <div className="skill-category-label">{cat.label}</div>
                                    {catSkills.map(skill => (
                                        <div key={skill.id} className={`skill-item ${skill.enabled ? 'enabled' : ''}`}>
                                            <div className="skill-item-info">
                                                <div className="skill-item-header">
                                                    <span className="skill-item-icon">{skill.icon}</span>
                                                    <span className="skill-item-name">{skill.name}</span>
                                                </div>
                                                <div className="skill-item-desc">{skill.description}</div>
                                            </div>
                                            <button
                                                className={`skill-toggle ${skill.enabled ? 'on' : 'off'}`}
                                                onClick={() => toggleSkill(skill.id)}
                                                title={skill.enabled ? 'Disable' : 'Enable'}
                                            >
                                                <div className="skill-toggle-track">
                                                    <div className="skill-toggle-thumb" />
                                                </div>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── Connectors Tab ── */}
            {activeTab === 'connectors' && (
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
            )}

            {/* ── Advanced Tab ── */}
            {/* ── Hooks Tab ── */}
            {activeTab === 'hooks' && (
                <div className="settings-tab-content">
                    <div className="settings-section">
                        <h3>Lifecycle Hooks</h3>
                        <p className="settings-section-desc">Shell commands that execute at lifecycle events. PreToolUse hooks can block dangerous operations.</p>

                        {Object.entries(hooks).map(([type, hookList]) => (
                            hookList.map((hook, idx) => (
                                <div key={`${type}-${idx}`} className="hook-item">
                                    <div className="hook-item-header">
                                        <span className="hook-type-badge">{type}</span>
                                        {hook.matcher && <span className="hook-matcher">/{hook.matcher}/</span>}
                                    </div>
                                    <code className="hook-command">{hook.command}</code>
                                    <button className="hook-remove" onClick={() => removeHook(type, idx)} title="Remove">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                        </svg>
                                    </button>
                                </div>
                            ))
                        ))}

                        <div className="hook-add-form">
                            <select className="hook-type-select" value={newHookType} onChange={e => setNewHookType(e.target.value)}>
                                {['PreToolUse','PostToolUse','Stop','SubagentStop','UserPromptSubmit','Notification','PreCompact','SessionStart','ToolError','AIResponse'].map(t => (
                                    <option key={t} value={t}>{t}</option>
                                ))}
                            </select>
                            <input className="hook-input" placeholder="Matcher regex (optional)" value={newHookMatcher} onChange={e => setNewHookMatcher(e.target.value)} />
                            <input className="hook-input hook-input-cmd" placeholder="Shell command" value={newHookCmd} onChange={e => setNewHookCmd(e.target.value)} onKeyDown={e => e.key === 'Enter' && addHook()} />
                            <button className="hook-add-btn" onClick={addHook} disabled={!newHookCmd.trim()}>Add</button>
                        </div>

                        <div className="hook-env-info">
                            <span className="hook-env-label">Env vars:</span>
                            <code>$ONICODE_TOOL_NAME</code> <code>$ONICODE_TOOL_INPUT</code> <code>$ONICODE_TOOL_OUTPUT</code> <code>$ONICODE_PROJECT_DIR</code> <code>$ONICODE_SESSION_ID</code>
                        </div>
                    </div>

                    <div className="settings-section">
                        <h3>Custom Commands ({customCommands.length})</h3>
                        <p className="settings-section-desc">Slash commands from <code>.onicode/commands/*.md</code>. Each file becomes a /command.</p>
                        {customCommands.length > 0 ? (
                            <div className="commands-list">
                                {customCommands.map(cmd => (
                                    <div key={`${cmd.source}-${cmd.name}`} className="command-item">
                                        <div className="command-item-name">
                                            <code>/{cmd.name}</code>
                                            <span className={`command-source-badge ${cmd.source}`}>{cmd.source}</span>
                                        </div>
                                        <div className="command-item-desc">{cmd.description}</div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="mcp-placeholder">
                                <span>No custom commands found</span>
                                <span className="mcp-placeholder-hint">Defaults: review, deploy, test, refactor, explain</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── MCP Tab ── */}
            {activeTab === 'mcp' && (
                <div className="settings-tab-content">
                    <div className="settings-section">
                        <h3>Built-in Servers</h3>
                        <p className="settings-section-desc">These MCP servers are bundled with Onicode and always available.</p>
                        <div className="mcp-server-list">
                            {[
                                { name: 'Sequential Thinking', desc: 'Step-by-step reasoning for complex problems' },
                                { name: 'Filesystem', desc: 'Enhanced file operations, search, and glob' },
                                { name: 'Web Fetch', desc: 'Fetch and parse web pages, APIs, documentation' },
                                { name: 'Puppeteer', desc: 'Browser automation, screenshots, testing' },
                                { name: 'Memory', desc: 'Persistent memory across sessions' },
                                { name: 'Git', desc: '15 git operations — status, branches, commits, diffs' },
                            ].map(s => (
                                <div key={s.name} className="mcp-server-item mcp-server-builtin">
                                    <div className="mcp-server-status connected" />
                                    <div className="mcp-server-info">
                                        <div className="mcp-server-name">{s.name}</div>
                                        <div className="mcp-server-desc">{s.desc}</div>
                                    </div>
                                    <span className="mcp-builtin-badge">Active</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="settings-section">
                        <h3>External Servers</h3>
                        <p className="settings-section-desc">Connect external MCP servers for additional capabilities.</p>
                        <div className="mcp-placeholder">
                            <div className="mcp-placeholder-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <rect x="2" y="2" width="20" height="20" rx="3" /><path d="M12 8v8M8 12h8" />
                                </svg>
                            </div>
                            <span>Add External MCP Server</span>
                            <span className="mcp-placeholder-hint">Configure in <code>~/.onicode/mcp.json</code> — supports PostgreSQL, Figma, Slack, etc.</span>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Data Tab (clear/archive conversations) ── */}
            {activeTab === 'data' && (
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
                        <p className="settings-section-desc">AI memory files stored in <code>~/.onicode/memories/</code>.</p>
                        <div className="settings-data-actions">
                            <button className="settings-data-btn" onClick={() => {
                                if (confirm('Clear all memory files? The AI will lose all learned preferences.')) {
                                    if (isElectron) {
                                        ['soul.md', 'user.md', 'MEMORY.md'].forEach(f => {
                                            window.onicode?.memoryDelete(f).catch(() => {});
                                        });
                                        window.onicode?.memoryEnsureDefaults().catch(() => {});
                                    }
                                    alert('Memory reset to defaults.');
                                }
                            }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" /></svg>
                                Reset Memory
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
            )}
        </div>
    );
}
