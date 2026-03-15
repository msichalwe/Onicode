import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../../hooks/useTheme';
import { loadSkills, saveSkills, getSkillCategories, type Skill } from '../../commands/skills';
import { isElectron } from '../../utils';
import { TABS } from './types';
import type { SettingsTab, ConnectorState, VaultKey } from './types';

import GeneralTab from './GeneralTab';
import AppearanceTab from './AppearanceTab';
import ProvidersTab from './ProvidersTab';
import SkillsTab from './SkillsTab';
import ConnectorsTab from './ConnectorsTab';
import HooksTab from './HooksTab';
import McpTab from './McpTab';
import ChannelsTab from './ChannelsTab';
import MemoryTab from './MemoryTab';
import DataTab from './DataTab';

// Re-export types for consumers
export type { SettingsTab, ConnectorState, VaultKey } from './types';

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
    const [hookPresets, setHookPresets] = useState<Array<{ id: string; name: string; description: string; hookTypes: string[] }>>([]);
    const [hookTestResult, setHookTestResult] = useState<{ success: boolean; stdout?: string; stderr?: string; exitCode?: number } | null>(null);
    const [testingHook, setTestingHook] = useState<string | null>(null);
    const [panelMode, setPanelMode] = useState(() => localStorage.getItem('onicode-panel-mode') || 'always');
    const [permissionMode, setPermissionMode] = useState(() => localStorage.getItem('onicode-permission-mode') || 'auto-allow');
    const [autoCommit, setAutoCommit] = useState(() => localStorage.getItem('onicode-auto-commit') !== 'false');
    const [dangerousCommandProtection, setDangerousCommandProtection] = useState(() => localStorage.getItem('onicode-dangerous-cmd-protection') !== 'false');
    const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('onicode-font-size')) || 13);
    const [chatHistoryLimit, setChatHistoryLimit] = useState(() => Number(localStorage.getItem('onicode-chat-history-limit')) || 50);
    const [defaultProjectPath, setDefaultProjectPath] = useState(() => localStorage.getItem('onicode-default-project-path') || '~/OniProjects');
    const [showToolDetails, setShowToolDetails] = useState(() => localStorage.getItem('onicode-show-tool-details') !== 'false');
    const [autoTitle, setAutoTitle] = useState(() => localStorage.getItem('onicode-auto-title') !== 'false');
    const [sendOnEnter, setSendOnEnter] = useState(() => localStorage.getItem('onicode-send-on-enter') !== 'false');
    const [notifications, setNotifications] = useState(() => localStorage.getItem('onicode-notifications') !== 'false');
    const [maxAutoContinues, setMaxAutoContinues] = useState(() => Number(localStorage.getItem('onicode-max-auto-continues')) || 15);
    const [compactThreshold, setCompactThreshold] = useState(() => Number(localStorage.getItem('onicode-compact-threshold')) || 60000);

    // -- MCP State --
    const [mcpServers, setMcpServers] = useState<MCPServerInfo[]>([]);
    const [showAddMCP, setShowAddMCP] = useState(false);
    const [mcpName, setMcpName] = useState('');
    const [mcpCommand, setMcpCommand] = useState('');
    const [mcpArgs, setMcpArgs] = useState('');
    const [mcpEnv, setMcpEnv] = useState('');
    const [mcpLoading, setMcpLoading] = useState<Set<string>>(new Set());

    // -- Memory tab state --
    const [soulContent, setSoulContent] = useState('');
    const [userContent, setUserContent] = useState('');
    const [longTermContent, setLongTermContent] = useState('');
    const [memoryFiles, setMemoryFiles] = useState<Array<{ name: string; size: number; modified: string; scope: string; category: string; id?: number }>>([]);
    const [editingMemory, setEditingMemory] = useState<string | null>(null);
    const [editingContent, setEditingContent] = useState('');
    const [memorySaving, setMemorySaving] = useState(false);
    const [memoryStats, setMemoryStats] = useState<{ total: number; byCategory?: Record<string, number> } | null>(null);
    const [memorySearchQuery, setMemorySearchQuery] = useState('');
    const [memorySearchResults, setMemorySearchResults] = useState<Array<{ file: string; category: string; snippet: string; updated_at: string }>>([]);
    const [memorySearching, setMemorySearching] = useState(false);

    // -- Key Store State --
    const [vaultKeys, setVaultKeys] = useState<VaultKey[]>([]);
    const [vaultStatus, setVaultStatus] = useState<{ safeStorage: boolean; keyCount: number } | null>(null);
    const [showAddKey, setShowAddKey] = useState(false);
    const [newKeyName, setNewKeyName] = useState('');
    const [newKeyValue, setNewKeyValue] = useState('');
    const [newKeyProvider, setNewKeyProvider] = useState('openai');
    const [newKeyNotes, setNewKeyNotes] = useState('');

    // Helper: sync a setting to localStorage + main process
    const saveSetting = useCallback((key: string, value: unknown) => {
        localStorage.setItem(`onicode-${key}`, String(value));
        if (isElectron) window.onicode!.setSetting(key, value);
    }, []);

    // Load settings from main process on mount (source of truth)
    useEffect(() => {
        if (!isElectron || !window.onicode?.getAllSettings) return;
        window.onicode.getAllSettings().then((s: Record<string, unknown>) => {
            if (s['permission-mode']) setPermissionMode(s['permission-mode'] as string);
            if (typeof s['dangerous-cmd-protection'] === 'boolean') setDangerousCommandProtection(s['dangerous-cmd-protection']);
            if (typeof s['auto-commit'] === 'boolean') setAutoCommit(s['auto-commit']);
            if (typeof s['font-size'] === 'number') {
                setFontSize(s['font-size']);
                document.documentElement.style.setProperty('--user-font-size', `${s['font-size']}px`);
            }
            if (typeof s['chat-history-limit'] === 'number') setChatHistoryLimit(s['chat-history-limit']);
            if (typeof s['default-project-path'] === 'string') setDefaultProjectPath(s['default-project-path']);
            if (typeof s['show-tool-details'] === 'boolean') setShowToolDetails(s['show-tool-details']);
            if (typeof s['auto-title'] === 'boolean') setAutoTitle(s['auto-title']);
            if (typeof s['send-on-enter'] === 'boolean') setSendOnEnter(s['send-on-enter']);
            if (typeof s['notifications'] === 'boolean') setNotifications(s['notifications']);
            if (typeof s['max-auto-continues'] === 'number') setMaxAutoContinues(s['max-auto-continues']);
            if (typeof s['compact-threshold'] === 'number') setCompactThreshold(s['compact-threshold']);
            if (typeof s['panel-mode'] === 'string') setPanelMode(s['panel-mode']);
        }).catch(() => {});
    }, []);

    const loadVault = useCallback(async () => {
        if (!isElectron || !window.onicode?.keystoreList) return;
        const [keysRes, statusRes] = await Promise.all([
            window.onicode.keystoreList(),
            window.onicode.keystoreStatus(),
        ]);
        setVaultKeys(keysRes.keys || []);
        setVaultStatus(statusRes);
    }, []);

    useEffect(() => { loadVault(); }, [loadVault]);

    // -- Memory tab data loader --
    const loadMemoryData = useCallback(async () => {
        if (!isElectron) return;
        // Load core memory files (these always exist)
        try {
            const [soulRes, userRes, ltRes, listRes] = await Promise.all([
                window.onicode!.memoryRead('soul.md'),
                window.onicode!.memoryRead('user.md'),
                window.onicode!.memoryRead('MEMORY.md'),
                window.onicode!.memoryList(),
            ]);
            if (soulRes?.content) setSoulContent(soulRes.content); else setSoulContent('');
            if (userRes?.content) setUserContent(userRes.content); else setUserContent('');
            if (ltRes?.content) setLongTermContent(ltRes.content); else setLongTermContent('');
            if (listRes?.files) setMemoryFiles(listRes.files);
        } catch {}
        // Load stats separately (may not exist on older preload)
        try {
            if (window.onicode?.memoryStats) {
                const statsRes = await window.onicode.memoryStats();
                if (statsRes?.success) {
                    // byCategory comes as Array<{ category, count }> from SQLite -- convert to Record
                    const catMap: Record<string, number> = {};
                    if (Array.isArray(statsRes.byCategory)) {
                        for (const item of statsRes.byCategory as Array<{ category: string; count: number }>) {
                            catMap[item.category] = item.count;
                        }
                    } else if (statsRes.byCategory && typeof statsRes.byCategory === 'object') {
                        Object.assign(catMap, statsRes.byCategory);
                    }
                    setMemoryStats({ total: statsRes.total || 0, byCategory: catMap });
                }
            }
        } catch {}
    }, []);

    useEffect(() => {
        if (activeTab === 'memory') loadMemoryData();
    }, [activeTab, loadMemoryData]);

    const saveMemoryFile = useCallback(async (filename: string, content: string) => {
        if (!isElectron) return;
        setMemorySaving(true);
        try {
            await window.onicode!.memoryWrite(filename, content);
            if (filename === 'soul.md') setSoulContent(content);
            if (filename === 'user.md') setUserContent(content);
            if (filename === 'MEMORY.md') setLongTermContent(content);
            setEditingMemory(null);
            // Refresh stats
            window.onicode!.memoryStats().then(s => {
                if (s?.success) setMemoryStats({ total: s.total || 0, byCategory: s.byCategory });
            }).catch(() => {});
        } catch {}
        setMemorySaving(false);
    }, []);

    const deleteMemoryFile = useCallback(async (filename: string) => {
        if (!isElectron) return;
        try {
            await window.onicode!.memoryDelete(filename);
            setMemoryFiles(prev => prev.filter(f => f.name !== filename));
            if (editingMemory === filename) setEditingMemory(null);
            // Refresh stats
            window.onicode!.memoryStats().then(s => {
                if (s?.success) setMemoryStats({ total: s.total || 0, byCategory: s.byCategory });
            }).catch(() => {});
        } catch {}
    }, [editingMemory]);

    const searchMemories = useCallback(async (query: string) => {
        if (!isElectron || !query.trim()) {
            setMemorySearchResults([]);
            return;
        }
        if (!window.onicode?.memorySearch) return;
        setMemorySearching(true);
        try {
            const res = await window.onicode.memorySearch(query.trim());
            if (res?.results) setMemorySearchResults(res.results as Array<{ file: string; category: string; snippet: string; updated_at: string }>);
        } catch {}
        setMemorySearching(false);
    }, []);

    const addVaultKey = useCallback(async () => {
        if (!isElectron || !newKeyName.trim() || !newKeyValue.trim()) return;
        const id = newKeyName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        await window.onicode!.keystoreStore(id, { name: newKeyName, value: newKeyValue, provider: newKeyProvider, notes: newKeyNotes || undefined });
        setNewKeyName(''); setNewKeyValue(''); setNewKeyNotes('');
        setShowAddKey(false);
        loadVault();
    }, [newKeyName, newKeyValue, newKeyProvider, newKeyNotes, loadVault]);

    const deleteVaultKey = useCallback(async (id: string) => {
        if (!isElectron) return;
        await window.onicode!.keystoreDelete(id);
        loadVault();
    }, [loadVault]);

    const loadConnectors = useCallback(async () => {
        if (!isElectron) return;
        const res = await window.onicode!.connectorList();
        const c = res.connectors || {};
        if (c.github) setGithub({ connected: true, username: c.github.username, avatarUrl: c.github.avatarUrl });
        // Check gws auth status for Gmail/Google Workspace
        if (c.gmail) {
            setGmail({ connected: true, username: c.gmail.username || c.gmail.avatarUrl });
        } else {
            // No stored connector -- check if gws is already authenticated
            try {
                const gws = await window.onicode!.connectorGwsStatus();
                if (gws.authenticated && gws.email) {
                    setGmail({ connected: true, username: gws.email });
                }
            } catch {}
        }
    }, []);

    useEffect(() => { loadConnectors(); }, [loadConnectors]);

    // -- Load Hooks & Custom Commands --
    const loadHooksAndCommands = useCallback(async () => {
        if (!isElectron) return;
        try {
            const hooksRes = await window.onicode!.hooksList();
            const loadedHooks = hooksRes.merged;
            if (loadedHooks) setHooks(loadedHooks as Record<string, HookDefinition[]>);
        } catch { /* hooks module may not be ready */ }
        try {
            const cmds = await window.onicode!.customCommandsList();
            setCustomCommands(cmds);
        } catch { /* commands module may not be ready */ }
        try {
            const presets = await window.onicode!.hooksPresets();
            setHookPresets(presets || []);
        } catch { /* presets not available */ }
    }, []);

    useEffect(() => { loadHooksAndCommands(); }, [loadHooksAndCommands]);

    // -- Load MCP Servers --
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

    const installFromCatalog = useCallback(async (entry: MCPCatalogEntry) => {
        if (!isElectron) return;
        await window.onicode!.mcpAddServer(entry.id, {
            command: entry.command,
            args: entry.args,
            env: entry.env || {},
            enabled: true,
        });
        loadMCPServers();
    }, [loadMCPServers]);

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

    const applyPreset = useCallback(async (presetId: string) => {
        if (!isElectron) return;
        const res = await window.onicode!.hooksApplyPreset(presetId);
        if (res.success) {
            loadHooksAndCommands();
        }
    }, [loadHooksAndCommands]);

    const testHook = useCallback(async (command: string, hookType: string) => {
        if (!isElectron) return;
        setTestingHook(command);
        setHookTestResult(null);
        try {
            const res = await window.onicode!.hooksTest(hookType, {}, command);
            setHookTestResult(res as unknown as { success: boolean; stdout?: string; stderr?: string; exitCode?: number });
        } catch (err: unknown) {
            setHookTestResult({ success: false, stderr: (err as Error).message, exitCode: 1 });
        }
        setTestingHook(null);
    }, []);

    // -- GitHub Device Flow --
    const connectGithub = useCallback(async () => {
        if (!isElectron) return;
        setGithub(prev => ({ ...prev, loading: true, error: undefined }));
        // Auto-install gh CLI if missing
        const ghCheck = await window.onicode!.connectorGhEnsure();
        if (!ghCheck.installed) {
            setGithub(prev => ({ ...prev, loading: false, error: ghCheck.error || 'GitHub CLI (gh) not installed' }));
            return;
        }
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

    // -- Google Workspace (via gws CLI) --
    const verifyGws = useCallback(async () => {
        if (!isElectron) return;
        setGmail(prev => ({ ...prev, loading: true, error: undefined }));
        const status = await window.onicode!.connectorGwsStatus();
        if (status.authenticated && status.email) {
            setGmail({ connected: true, username: status.email });
        } else if (!status.installed) {
            setGmail(prev => ({ ...prev, loading: false, error: 'gws not installed. See setup instructions below.' }));
        } else {
            setGmail(prev => ({ ...prev, loading: false, error: 'Not authenticated. Complete the setup steps below, then verify again.' }));
        }
    }, []);

    const disconnectGmail = useCallback(async () => {
        if (!isElectron) return;
        await window.onicode!.connectorDisconnect('gmail');
        setGmail({ connected: false });
    }, []);

    const changePanelMode = useCallback((mode: string) => {
        setPanelMode(mode);
        saveSetting('panel-mode', mode);
        window.dispatchEvent(new CustomEvent('onicode-panel-mode', { detail: mode }));
    }, [saveSetting]);

    // -- Skills toggle --
    const toggleSkill = useCallback((skillId: string) => {
        setSkills(prev => {
            const updated = prev.map(s => s.id === skillId ? { ...s, enabled: !s.enabled } : s);
            saveSkills(updated);
            return updated;
        });
    }, []);

    const enabledCount = skills.filter(s => s.enabled).length;
    const categories = getSkillCategories();

    // ==============================
    //  Render
    // ==============================

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

            {activeTab === 'general' && (
                <GeneralTab
                    permissionMode={permissionMode} setPermissionMode={setPermissionMode}
                    dangerousCommandProtection={dangerousCommandProtection} setDangerousCommandProtection={setDangerousCommandProtection}
                    autoCommit={autoCommit} setAutoCommit={setAutoCommit}
                    sendOnEnter={sendOnEnter} setSendOnEnter={setSendOnEnter}
                    autoTitle={autoTitle} setAutoTitle={setAutoTitle}
                    showToolDetails={showToolDetails} setShowToolDetails={setShowToolDetails}
                    notifications={notifications} setNotifications={setNotifications}
                    chatHistoryLimit={chatHistoryLimit} setChatHistoryLimit={setChatHistoryLimit}
                    maxAutoContinues={maxAutoContinues} setMaxAutoContinues={setMaxAutoContinues}
                    compactThreshold={compactThreshold} setCompactThreshold={setCompactThreshold}
                    fontSize={fontSize} setFontSize={setFontSize}
                    defaultProjectPath={defaultProjectPath} setDefaultProjectPath={setDefaultProjectPath}
                    panelMode={panelMode} changePanelMode={changePanelMode}
                    saveSetting={saveSetting}
                />
            )}

            {activeTab === 'appearance' && (
                <AppearanceTab theme={theme} setTheme={setTheme} />
            )}

            {activeTab === 'providers' && (
                <ProvidersTab />
            )}

            {activeTab === 'skills' && (
                <SkillsTab
                    skills={skills} expandedSkills={expandedSkills} setExpandedSkills={setExpandedSkills}
                    toggleSkill={toggleSkill} enabledCount={enabledCount} categories={categories}
                />
            )}

            {activeTab === 'connectors' && (
                <ConnectorsTab
                    github={github} gmail={gmail}
                    connectGithub={connectGithub} disconnectGithub={disconnectGithub}
                    verifyGws={verifyGws} disconnectGmail={disconnectGmail}
                    vaultKeys={vaultKeys} vaultStatus={vaultStatus}
                    showAddKey={showAddKey} setShowAddKey={setShowAddKey}
                    newKeyName={newKeyName} setNewKeyName={setNewKeyName}
                    newKeyValue={newKeyValue} setNewKeyValue={setNewKeyValue}
                    newKeyProvider={newKeyProvider} setNewKeyProvider={setNewKeyProvider}
                    newKeyNotes={newKeyNotes} setNewKeyNotes={setNewKeyNotes}
                    addVaultKey={addVaultKey} deleteVaultKey={deleteVaultKey}
                />
            )}

            {activeTab === 'hooks' && (
                <HooksTab
                    hooks={hooks} customCommands={customCommands}
                    newHookType={newHookType} setNewHookType={setNewHookType}
                    newHookCmd={newHookCmd} setNewHookCmd={setNewHookCmd}
                    newHookMatcher={newHookMatcher} setNewHookMatcher={setNewHookMatcher}
                    hookPresets={hookPresets} hookTestResult={hookTestResult} setHookTestResult={setHookTestResult}
                    testingHook={testingHook}
                    addHook={addHook} removeHook={removeHook} applyPreset={applyPreset} testHook={testHook}
                />
            )}

            {activeTab === 'mcp' && (
                <McpTab
                    mcpServers={mcpServers} showAddMCP={showAddMCP} setShowAddMCP={setShowAddMCP}
                    mcpName={mcpName} setMcpName={setMcpName}
                    mcpCommand={mcpCommand} setMcpCommand={setMcpCommand}
                    mcpArgs={mcpArgs} setMcpArgs={setMcpArgs}
                    mcpEnv={mcpEnv} setMcpEnv={setMcpEnv}
                    mcpLoading={mcpLoading}
                    handleMCPConnect={handleMCPConnect} handleMCPDisconnect={handleMCPDisconnect}
                    handleMCPRemove={handleMCPRemove} handleMCPAdd={handleMCPAdd}
                    installFromCatalog={installFromCatalog}
                />
            )}

            {activeTab === 'channels' && <ChannelsTab />}

            {activeTab === 'memory' && (
                <MemoryTab
                    soulContent={soulContent} userContent={userContent} longTermContent={longTermContent}
                    memoryFiles={memoryFiles}
                    editingMemory={editingMemory} setEditingMemory={setEditingMemory}
                    editingContent={editingContent} setEditingContent={setEditingContent}
                    memorySaving={memorySaving}
                    memoryStats={memoryStats}
                    memorySearchQuery={memorySearchQuery} setMemorySearchQuery={setMemorySearchQuery}
                    memorySearchResults={memorySearchResults} memorySearching={memorySearching}
                    saveMemoryFile={saveMemoryFile} deleteMemoryFile={deleteMemoryFile} searchMemories={searchMemories}
                />
            )}

            {activeTab === 'data' && (
                <DataTab />
            )}
        </div>
    );
}
