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

type SettingsTab = 'general' | 'appearance' | 'providers' | 'skills' | 'hooks' | 'mcp' | 'connectors' | 'data';

const TABS: { id: SettingsTab; label: string }[] = [
    { id: 'general', label: 'General' },
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
    const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());
    const [hooks, setHooks] = useState<Record<string, HookDefinition[]>>({});
    const [customCommands, setCustomCommands] = useState<CustomCommand[]>([]);
    const [newHookType, setNewHookType] = useState('PreToolUse');
    const [newHookCmd, setNewHookCmd] = useState('');
    const [newHookMatcher, setNewHookMatcher] = useState('');
    const [panelMode, setPanelMode] = useState(() => localStorage.getItem('onicode-panel-mode') || 'always');
    const [permissionMode, setPermissionMode] = useState(() => localStorage.getItem('onicode-permission-mode') || 'auto-allow');
    const [autoCommit, setAutoCommit] = useState(() => localStorage.getItem('onicode-auto-commit') !== 'false');
    const [dangerousCommandProtection, setDangerousCommandProtection] = useState(() => localStorage.getItem('onicode-dangerous-cmd-protection') !== 'false');

    // ── MCP State ──
    const [mcpServers, setMcpServers] = useState<MCPServerInfo[]>([]);
    const [showAddMCP, setShowAddMCP] = useState(false);
    const [mcpName, setMcpName] = useState('');
    const [mcpCommand, setMcpCommand] = useState('');
    const [mcpArgs, setMcpArgs] = useState('');
    const [mcpEnv, setMcpEnv] = useState('');
    const [mcpLoading, setMcpLoading] = useState<Set<string>>(new Set());

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

    // ── Load MCP Servers ──
    const loadMCPServers = useCallback(async () => {
        if (!isElectron) return;
        try {
            const res = await window.onicode!.mcpListServers();
            setMcpServers(res.servers || []);
        } catch { /* MCP not ready */ }
    }, []);

    useEffect(() => { loadMCPServers(); }, [loadMCPServers]);

    // Subscribe to real-time MCP status updates
    useEffect(() => {
        if (!isElectron) return;
        const cleanup = window.onicode!.onMcpServerStatus(() => {
            loadMCPServers(); // Refresh the full list on any status change
        });
        return cleanup;
    }, [loadMCPServers]);

    const handleMCPConnect = useCallback(async (name: string) => {
        setMcpLoading(prev => new Set(prev).add(name));
        try {
            await window.onicode!.mcpConnectServer(name);
        } catch { /* handled via status event */ }
        setMcpLoading(prev => { const s = new Set(prev); s.delete(name); return s; });
        loadMCPServers();
    }, [loadMCPServers]);

    const handleMCPDisconnect = useCallback(async (name: string) => {
        await window.onicode!.mcpDisconnectServer(name);
        loadMCPServers();
    }, [loadMCPServers]);

    const handleMCPRemove = useCallback(async (name: string) => {
        if (!confirm(`Remove MCP server "${name}"?`)) return;
        await window.onicode!.mcpRemoveServer(name);
        loadMCPServers();
    }, [loadMCPServers]);

    const handleMCPAdd = useCallback(async () => {
        if (!mcpName.trim() || !mcpCommand.trim()) return;
        const args = mcpArgs.split(',').map(s => s.trim()).filter(Boolean);
        const env: Record<string, string> = {};
        mcpEnv.split('\n').forEach(line => {
            const [k, ...v] = line.split('=');
            if (k?.trim()) env[k.trim()] = v.join('=').trim();
        });
        await window.onicode!.mcpAddServer(mcpName.trim(), { command: mcpCommand.trim(), args, env, enabled: true });
        setShowAddMCP(false);
        setMcpName(''); setMcpCommand(''); setMcpArgs(''); setMcpEnv('');
        loadMCPServers();
    }, [mcpName, mcpCommand, mcpArgs, mcpEnv, loadMCPServers]);

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
            {activeTab === 'general' && (
                <div className="settings-tab-content">
                    <div className="settings-section">
                        <h3>Permissions</h3>
                        <p className="settings-section-desc">Control how much autonomy the AI has when working on your projects.</p>

                        <div className="setting-row">
                            <div className="setting-label">
                                <span className="setting-name">Permission Mode</span>
                                <span className="setting-desc">How the AI handles tool permissions. Since Oni works within project scope, auto-allow is recommended.</span>
                            </div>
                            <div className="setting-toggle-group">
                                <button className={`setting-toggle-btn ${permissionMode === 'auto-allow' ? 'active' : ''}`} onClick={() => {
                                    setPermissionMode('auto-allow');
                                    localStorage.setItem('onicode-permission-mode', 'auto-allow');
                                    if (isElectron) window.onicode!.agentSetMode('build');
                                }}>Auto Allow</button>
                                <button className={`setting-toggle-btn ${permissionMode === 'ask-destructive' ? 'active' : ''}`} onClick={() => {
                                    setPermissionMode('ask-destructive');
                                    localStorage.setItem('onicode-permission-mode', 'ask-destructive');
                                    if (isElectron) window.onicode!.agentSetMode('ask-destructive');
                                }}>Ask for Destructive</button>
                                <button className={`setting-toggle-btn ${permissionMode === 'plan-only' ? 'active' : ''}`} onClick={() => {
                                    setPermissionMode('plan-only');
                                    localStorage.setItem('onicode-permission-mode', 'plan-only');
                                    if (isElectron) window.onicode!.agentSetMode('plan');
                                }}>Plan Only</button>
                            </div>
                        </div>

                        <div className="permission-mode-info">
                            {permissionMode === 'auto-allow' && <span>The AI can read, write, delete files, run commands, and commit — no interruptions. Best for productive coding sessions.</span>}
                            {permissionMode === 'ask-destructive' && <span>The AI will ask before deleting files, restoring snapshots, or running destructive commands. Everything else is auto-allowed.</span>}
                            {permissionMode === 'plan-only' && <span>The AI can only read files and search. No writes, no commands, no commits. Use this for code review or planning.</span>}
                        </div>
                    </div>

                    <div className="settings-section">
                        <h3>Safety</h3>

                        <div className="setting-row">
                            <div className="setting-label">
                                <span className="setting-name">Dangerous Command Protection</span>
                                <span className="setting-desc">Auto-detect and block destructive commands like rm -rf, git reset --hard, DROP TABLE</span>
                            </div>
                            <label className="setting-switch">
                                <input type="checkbox" checked={dangerousCommandProtection} onChange={(e) => {
                                    setDangerousCommandProtection(e.target.checked);
                                    localStorage.setItem('onicode-dangerous-cmd-protection', String(e.target.checked));
                                    if (isElectron) window.onicode!.setSetting('dangerous-cmd-protection', e.target.checked);
                                }} />
                                <span className="setting-switch-slider" />
                            </label>
                        </div>

                        <div className="setting-row">
                            <div className="setting-label">
                                <span className="setting-name">Auto-Commit</span>
                                <span className="setting-desc">AI automatically commits at milestones, after builds, and at session end</span>
                            </div>
                            <label className="setting-switch">
                                <input type="checkbox" checked={autoCommit} onChange={(e) => {
                                    setAutoCommit(e.target.checked);
                                    localStorage.setItem('onicode-auto-commit', String(e.target.checked));
                                    if (isElectron) window.onicode!.setSetting('auto-commit', e.target.checked);
                                }} />
                                <span className="setting-switch-slider" />
                            </label>
                        </div>
                    </div>
                </div>
            )}

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
                        <p className="settings-section-desc">Skills inject specialized behavior into the AI system prompt. Enabled skills are applied proactively during conversations.</p>

                        {categories.map(cat => {
                            const catSkills = skills.filter(s => s.category === cat.id);
                            if (catSkills.length === 0) return null;
                            const catEnabled = catSkills.filter(s => s.enabled).length;
                            return (
                                <div key={cat.id} className="skill-category">
                                    <div className="skill-category-label">
                                        {cat.label}
                                        <span className="skill-category-count">{catEnabled}/{catSkills.length}</span>
                                    </div>
                                    {catSkills.map(skill => {
                                        const isExpanded = expandedSkills.has(skill.id);
                                        return (
                                            <div key={skill.id} className={`skill-item ${skill.enabled ? 'enabled' : ''}${isExpanded ? ' expanded' : ''}`}>
                                                <div className="skill-item-top">
                                                    <div
                                                        className="skill-item-info"
                                                        onClick={() => {
                                                            setExpandedSkills(prev => {
                                                                const next = new Set(prev);
                                                                if (next.has(skill.id)) next.delete(skill.id);
                                                                else next.add(skill.id);
                                                                return next;
                                                            });
                                                        }}
                                                    >
                                                        <div className="skill-item-header">
                                                            <span className={`skill-item-chevron${isExpanded ? ' expanded' : ''}`}>&#9656;</span>
                                                            <span className="skill-item-icon">{skill.icon}</span>
                                                            <span className="skill-item-name">{skill.name}</span>
                                                            {skill.enabled && <span className="skill-active-badge">Active</span>}
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
                                                {isExpanded && (
                                                    <div className="skill-item-expanded">
                                                        <div className="skill-prompt-label">System Prompt Injection:</div>
                                                        <pre className="skill-prompt-content">{skill.prompt}</pre>
                                                        <div className="skill-meta">
                                                            <span>Category: {cat.label}</span>
                                                            <span>Status: {skill.enabled ? 'Injected into every AI request' : 'Inactive'}</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}

                        <div className="skill-info-box">
                            <strong>How Skills Work</strong>
                            <p>Each enabled skill adds specialized instructions to the AI system prompt. The AI reads these instructions and applies them proactively when relevant to your conversation.</p>
                            <p>For example, with "Code Review" enabled, the AI will automatically check for bugs, security issues, and performance problems when reviewing code.</p>
                        </div>
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
            {activeTab === 'hooks' && (() => {
                const HOOK_CATEGORIES: Record<string, { label: string; types: Array<{ type: string; desc: string; blocking: boolean }> }> = {
                    tool: { label: 'Tool Lifecycle', types: [
                        { type: 'PreToolUse', desc: 'Before any AI tool call. Exit non-zero to BLOCK.', blocking: true },
                        { type: 'PostToolUse', desc: 'After any AI tool call completes.', blocking: false },
                        { type: 'ToolError', desc: 'When a tool call fails or errors.', blocking: false },
                    ]},
                    file: { label: 'File Operations', types: [
                        { type: 'PreEdit', desc: 'Before editing a file. Exit non-zero to BLOCK.', blocking: true },
                        { type: 'PostEdit', desc: 'After a file is edited. Run linters, tests, formatters.', blocking: false },
                    ]},
                    command: { label: 'Commands', types: [
                        { type: 'PreCommand', desc: 'Before running a shell command. Exit non-zero to BLOCK.', blocking: true },
                        { type: 'PostCommand', desc: 'After a command completes.', blocking: false },
                        { type: 'OnDangerousCommand', desc: 'Auto-detected destructive commands (rm -rf, git reset --hard). Exit non-zero to BLOCK.', blocking: true },
                    ]},
                    git: { label: 'Git / Version Control', types: [
                        { type: 'PreCommit', desc: 'Before git commit. Run lint + typecheck + format. Exit non-zero to BLOCK.', blocking: true },
                        { type: 'PostCommit', desc: 'After git commit succeeds.', blocking: false },
                    ]},
                    testing: { label: 'Testing', types: [
                        { type: 'OnTestFailure', desc: 'When a test command exits with non-zero code.', blocking: false },
                    ]},
                    task: { label: 'Tasks & Sessions', types: [
                        { type: 'OnTaskComplete', desc: 'When the AI marks a task as done.', blocking: false },
                        { type: 'SessionStart', desc: 'When a new AI session begins.', blocking: false },
                        { type: 'AIResponse', desc: 'After the AI finishes a full response.', blocking: false },
                        { type: 'Stop', desc: 'When the AI stops (max rounds reached).', blocking: false },
                    ]},
                    other: { label: 'Other', types: [
                        { type: 'UserPromptSubmit', desc: 'When user submits a message. Exit non-zero to BLOCK.', blocking: true },
                        { type: 'PreCompact', desc: 'Before context compaction.', blocking: false },
                        { type: 'SubagentStop', desc: 'When a sub-agent completes.', blocking: false },
                        { type: 'Notification', desc: 'When a notification event fires.', blocking: false },
                    ]},
                };

                const totalHooks = Object.values(hooks).reduce((sum, arr) => sum + arr.length, 0);

                return (
                <div className="settings-tab-content">
                    <div className="settings-section">
                        <h3>Lifecycle Hooks <span className="hook-total-badge">{totalHooks} registered</span></h3>
                        <p className="settings-section-desc">Shell commands that execute at lifecycle events. Blocking hooks (marked with a shield) can prevent operations when they exit non-zero.</p>

                        {/* Registered hooks grouped by category */}
                        {Object.entries(HOOK_CATEGORIES).map(([catId, cat]) => {
                            const catHooks = cat.types.filter(t => hooks[t.type]?.length > 0);
                            if (catHooks.length === 0) return null;
                            return (
                                <div key={catId} className="hook-category">
                                    <div className="hook-category-header">{cat.label}</div>
                                    {catHooks.map(hookType => (
                                        hooks[hookType.type]?.map((hook, idx) => (
                                            <div key={`${hookType.type}-${idx}`} className="hook-item">
                                                <div className="hook-item-header">
                                                    <span className={`hook-type-badge ${hookType.blocking ? 'hook-blocking' : ''}`}>
                                                        {hookType.blocking && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{marginRight: 3, verticalAlign: -1}}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>}
                                                        {hookType.type}
                                                    </span>
                                                    {hook.matcher && <span className="hook-matcher">/{hook.matcher}/</span>}
                                                </div>
                                                <code className="hook-command">{hook.command}</code>
                                                <button className="hook-remove" onClick={() => removeHook(hookType.type, idx)} title="Remove">
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                                    </svg>
                                                </button>
                                            </div>
                                        ))
                                    ))}
                                </div>
                            );
                        })}

                        {totalHooks === 0 && (
                            <div className="hook-empty">
                                <p>No hooks configured yet</p>
                                <span>Add hooks below to automate linting, testing, formatting, and safety checks during AI tool execution.</span>
                            </div>
                        )}

                        {/* Add hook form */}
                        <div className="hook-add-form">
                            <div className="hook-add-form-row">
                                <select className="hook-type-select" value={newHookType} onChange={e => setNewHookType(e.target.value)}>
                                    {Object.entries(HOOK_CATEGORIES).map(([catId, cat]) => (
                                        <optgroup key={catId} label={cat.label}>
                                            {cat.types.map(t => (
                                                <option key={t.type} value={t.type}>{t.type}{t.blocking ? ' (blocking)' : ''}</option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </select>
                                <input className="hook-input" placeholder="Matcher regex (optional)" value={newHookMatcher} onChange={e => setNewHookMatcher(e.target.value)} />
                            </div>
                            <div className="hook-add-form-row">
                                <input className="hook-input hook-input-cmd" placeholder="Shell command (e.g. npm run lint, npx tsc --noEmit)" value={newHookCmd} onChange={e => setNewHookCmd(e.target.value)} onKeyDown={e => e.key === 'Enter' && addHook()} />
                                <button className="hook-add-btn" onClick={addHook} disabled={!newHookCmd.trim()}>Add Hook</button>
                            </div>
                        </div>

                        {/* Hook type reference */}
                        <details className="hook-reference">
                            <summary className="hook-reference-title">All Hook Types Reference</summary>
                            <div className="hook-reference-content">
                                {Object.entries(HOOK_CATEGORIES).map(([catId, cat]) => (
                                    <div key={catId} className="hook-ref-category">
                                        <div className="hook-ref-category-label">{cat.label}</div>
                                        {cat.types.map(t => (
                                            <div key={t.type} className="hook-ref-item">
                                                <span className={`hook-ref-type ${t.blocking ? 'hook-blocking' : ''}`}>{t.type}</span>
                                                <span className="hook-ref-desc">{t.desc}</span>
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </details>

                        {/* Example hooks */}
                        <details className="hook-reference">
                            <summary className="hook-reference-title">Example Hooks</summary>
                            <div className="hook-reference-content hook-examples">
                                <div className="hook-example">
                                    <strong>PreCommit</strong> — Lint + typecheck before every commit
                                    <code>npm run lint && npx tsc --noEmit</code>
                                </div>
                                <div className="hook-example">
                                    <strong>PostEdit</strong> (matcher: <code>\.tsx?$</code>) — TypeScript check after editing .ts/.tsx
                                    <code>npx tsc --noEmit 2&gt;&amp;1 | head -20</code>
                                </div>
                                <div className="hook-example">
                                    <strong>PostEdit</strong> (matcher: <code>schema|migration</code>) — Check migrations after schema changes
                                    <code>npx prisma validate</code>
                                </div>
                                <div className="hook-example">
                                    <strong>OnDangerousCommand</strong> — Block all destructive commands
                                    <code>echo "Blocked: $ONICODE_COMMAND" &amp;&amp; exit 1</code>
                                </div>
                                <div className="hook-example">
                                    <strong>OnTestFailure</strong> — Log test failures
                                    <code>echo "FAIL: $ONICODE_COMMAND" &gt;&gt; ~/.onicode/test-failures.log</code>
                                </div>
                                <div className="hook-example">
                                    <strong>PostCommand</strong> (matcher: <code>npm run dev</code>) — Open browser after dev server starts
                                    <code>open http://localhost:3000</code>
                                </div>
                            </div>
                        </details>

                        <div className="hook-env-info">
                            <span className="hook-env-label">Available env vars:</span>
                            <code>$ONICODE_TOOL_NAME</code> <code>$ONICODE_TOOL_INPUT</code> <code>$ONICODE_TOOL_OUTPUT</code> <code>$ONICODE_PROJECT_DIR</code> <code>$ONICODE_SESSION_ID</code> <code>$ONICODE_COMMAND</code> <code>$ONICODE_FILE_PATH</code> <code>$ONICODE_COMMIT_MSG</code> <code>$ONICODE_ERROR</code> <code>$ONICODE_EXIT_CODE</code> <code>$ONICODE_TASK_CONTENT</code>
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
            )})()}

            {/* ── MCP Tab ── */}
            {activeTab === 'mcp' && (
                <div className="settings-tab-content">
                    <div className="settings-section">
                        <h3>Built-in Capabilities</h3>
                        <p className="settings-section-desc">Native tools bundled with Onicode — always available to the AI.</p>
                        <div className="mcp-server-list">
                            {[
                                { name: 'Filesystem', desc: '7 file operations — read, edit, create, delete, search, glob, list' },
                                { name: 'Browser', desc: '8 browser tools — navigate, screenshot, click, type, wait, evaluate, console, close' },
                                { name: 'Terminal', desc: 'Shell execution, background processes, dev server management' },
                                { name: 'Git', desc: '9 git tools — status, diff, log, branches, commit, push, pull, stash, checkout' },
                                { name: 'Memory', desc: 'Persistent cross-session memory — read, write, append' },
                                { name: 'Web Research', desc: 'Web fetch and search — fetch pages, search DuckDuckGo' },
                                { name: 'Code Intelligence', desc: 'LSP + semantic search — symbols, references, types, TF-IDF' },
                                { name: 'Orchestrator', desc: 'Multi-agent system — 5 specialist roles, parallel execution' },
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
                        <h3>MCP Servers</h3>
                        <p className="settings-section-desc">
                            Connect external MCP servers to extend the AI&apos;s capabilities. Tools from connected servers are automatically available.
                        </p>

                        {mcpServers.length > 0 && (
                            <div className="mcp-server-list">
                                {mcpServers.map(s => (
                                    <div key={s.name} className="mcp-server-item mcp-server-external">
                                        <div className="mcp-server-status-row">
                                            <div className={`mcp-server-status ${s.status}`} />
                                            <div className="mcp-server-info">
                                                <div className="mcp-server-name">{s.name}</div>
                                                <div className="mcp-server-command">{s.config.command} {(s.config.args || []).join(' ')}</div>
                                                {s.error && <div className="mcp-server-error">{s.error}</div>}
                                            </div>
                                        </div>
                                        <div className="mcp-server-actions">
                                            {s.status === 'connected' && s.toolCount > 0 && (
                                                <span className="mcp-server-tools-badge">{s.toolCount} tool{s.toolCount !== 1 ? 's' : ''}</span>
                                            )}
                                            {s.status === 'connected' ? (
                                                <button className="mcp-server-toggle disconnect" onClick={() => handleMCPDisconnect(s.name)}>
                                                    Disconnect
                                                </button>
                                            ) : s.status === 'connecting' || mcpLoading.has(s.name) ? (
                                                <button className="mcp-server-toggle" disabled>Connecting...</button>
                                            ) : (
                                                <button className="mcp-server-toggle connect" onClick={() => handleMCPConnect(s.name)}>
                                                    Connect
                                                </button>
                                            )}
                                            <button className="mcp-server-remove" onClick={() => handleMCPRemove(s.name)} title="Remove server">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {!showAddMCP ? (
                            <button className="mcp-add-btn" onClick={() => setShowAddMCP(true)}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                                Add MCP Server
                            </button>
                        ) : (
                            <div className="mcp-add-form">
                                <label>Name</label>
                                <input type="text" placeholder="e.g. postgres, github, slack" value={mcpName} onChange={e => setMcpName(e.target.value)} />
                                <label>Command</label>
                                <input type="text" placeholder="e.g. npx, node, python" value={mcpCommand} onChange={e => setMcpCommand(e.target.value)} />
                                <label>Arguments (comma-separated)</label>
                                <input type="text" placeholder="e.g. -y, @modelcontextprotocol/server-postgres, postgresql://localhost/mydb" value={mcpArgs} onChange={e => setMcpArgs(e.target.value)} />
                                <label>Environment Variables (optional, KEY=VALUE per line)</label>
                                <textarea rows={2} placeholder="DATABASE_URL=postgresql://..." value={mcpEnv} onChange={e => setMcpEnv(e.target.value)} />
                                <div className="mcp-add-form-actions">
                                    <button className="mcp-server-toggle" onClick={() => setShowAddMCP(false)}>Cancel</button>
                                    <button className="mcp-server-toggle connect" onClick={handleMCPAdd} disabled={!mcpName.trim() || !mcpCommand.trim()}>Add & Connect</button>
                                </div>
                            </div>
                        )}

                        <div className="mcp-examples">
                            <p className="settings-section-desc" style={{ marginTop: 12 }}>
                                Popular servers: <code>@modelcontextprotocol/server-postgres</code>, <code>@modelcontextprotocol/server-github</code>, <code>@modelcontextprotocol/server-puppeteer</code>, <code>@modelcontextprotocol/server-filesystem</code>
                            </p>
                            <p className="settings-section-desc">
                                Config file: <code>~/.onicode/mcp.json</code> — you can also edit this file directly.
                            </p>
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
