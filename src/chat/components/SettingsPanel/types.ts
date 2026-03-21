import type React from 'react';
import type { ThemeName } from '../../hooks/useTheme';
import type { Skill } from '../../commands/skills';

// ══════════════════════════════════════════
//  Tab Definitions
// ══════════════════════════════════════════

export type SettingsTab = 'profile' | 'general' | 'appearance' | 'providers' | 'skills' | 'hooks' | 'mcp' | 'channels' | 'connectors' | 'vault' | 'memory' | 'data';

export const TABS: { id: SettingsTab; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'general', label: 'General' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'providers', label: 'Providers' },
    { id: 'skills', label: 'Skills' },
    { id: 'hooks', label: 'Hooks' },
    { id: 'mcp', label: 'MCP' },
    { id: 'channels', label: 'Channels' },
    { id: 'connectors', label: 'Connectors' },
    { id: 'vault', label: 'Vault' },
    { id: 'memory', label: 'Memory' },
    { id: 'data', label: 'Data' },
];

// ══════════════════════════════════════════
//  Theme Definitions
// ══════════════════════════════════════════

export const THEMES: { id: ThemeName; name: string; previewClass: string; type: 'light' | 'dark' | 'neutral' }[] = [
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
//  Connector Types
// ══════════════════════════════════════════

export interface ConnectorState {
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
//  Key Vault Types
// ══════════════════════════════════════════

export interface VaultKey {
    id: string;
    name: string;
    provider: string;
    notes?: string;
    maskedValue: string;
    createdAt: number;
    updatedAt: number;
}

// ══════════════════════════════════════════
//  Hook Categories
// ══════════════════════════════════════════

export const HOOK_CATEGORIES: Record<string, { label: string; types: Array<{ type: string; desc: string; blocking: boolean }> }> = {
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

// ══════════════════════════════════════════
//  Shared Prop Types
// ══════════════════════════════════════════

export interface SaveSettingFn {
    (key: string, value: unknown): void;
}

export interface GeneralTabProps {
    permissionMode: string;
    setPermissionMode: (v: string) => void;
    dangerousCommandProtection: boolean;
    setDangerousCommandProtection: (v: boolean) => void;
    autoCommit: boolean;
    setAutoCommit: (v: boolean) => void;
    sendOnEnter: boolean;
    setSendOnEnter: (v: boolean) => void;
    autoTitle: boolean;
    setAutoTitle: (v: boolean) => void;
    showToolDetails: boolean;
    setShowToolDetails: (v: boolean) => void;
    notifications: boolean;
    setNotifications: (v: boolean) => void;
    chatHistoryLimit: number;
    setChatHistoryLimit: (v: number) => void;
    maxAutoContinues: number;
    setMaxAutoContinues: (v: number) => void;
    compactThreshold: number;
    setCompactThreshold: (v: number) => void;
    fontSize: number;
    setFontSize: (v: number) => void;
    defaultProjectPath: string;
    setDefaultProjectPath: (v: string) => void;
    panelMode: string;
    changePanelMode: (mode: string) => void;
    saveSetting: SaveSettingFn;
}

export interface AppearanceTabProps {
    theme: ThemeName;
    setTheme: (t: ThemeName) => void;
}

export interface SkillsTabProps {
    skills: Skill[];
    expandedSkills: Set<string>;
    setExpandedSkills: React.Dispatch<React.SetStateAction<Set<string>>>;
    toggleSkill: (skillId: string) => void;
    enabledCount: number;
    categories: Array<{ id: string; label: string }>;
}

export interface HooksTabProps {
    hooks: Record<string, HookDefinition[]>;
    customCommands: CustomCommand[];
    newHookType: string;
    setNewHookType: (v: string) => void;
    newHookCmd: string;
    setNewHookCmd: (v: string) => void;
    newHookMatcher: string;
    setNewHookMatcher: (v: string) => void;
    hookPresets: Array<{ id: string; name: string; description: string; hookTypes: string[] }>;
    hookTestResult: { success: boolean; stdout?: string; stderr?: string; exitCode?: number } | null;
    setHookTestResult: (v: { success: boolean; stdout?: string; stderr?: string; exitCode?: number } | null) => void;
    testingHook: string | null;
    addHook: () => void;
    removeHook: (type: string, index: number) => void;
    applyPreset: (presetId: string) => void;
    testHook: (command: string, hookType: string) => void;
}

export interface McpTabProps {
    mcpServers: MCPServerInfo[];
    showAddMCP: boolean;
    setShowAddMCP: (v: boolean) => void;
    mcpName: string;
    setMcpName: (v: string) => void;
    mcpCommand: string;
    setMcpCommand: (v: string) => void;
    mcpArgs: string;
    setMcpArgs: (v: string) => void;
    mcpEnv: string;
    setMcpEnv: (v: string) => void;
    mcpLoading: Set<string>;
    handleMCPConnect: (name: string) => void;
    handleMCPDisconnect: (name: string) => void;
    handleMCPRemove: (name: string) => void;
    handleMCPAdd: () => void;
    installFromCatalog: (entry: MCPCatalogEntry) => void;
}

export interface ConnectorsTabProps {
    github: ConnectorState;
    gmail: ConnectorState;
    connectGithub: () => void;
    disconnectGithub: () => void;
    verifyGws: () => void;
    disconnectGmail: () => void;
    vaultKeys: VaultKey[];
    vaultStatus: { safeStorage: boolean; keyCount: number } | null;
    showAddKey: boolean;
    setShowAddKey: (v: boolean) => void;
    newKeyName: string;
    setNewKeyName: (v: string) => void;
    newKeyValue: string;
    setNewKeyValue: (v: string) => void;
    newKeyProvider: string;
    setNewKeyProvider: (v: string) => void;
    newKeyNotes: string;
    setNewKeyNotes: (v: string) => void;
    addVaultKey: () => void;
    deleteVaultKey: (id: string) => void;
}

export interface MemoryTabProps {
    soulContent: string;
    userContent: string;
    longTermContent: string;
    memoryFiles: Array<{ name: string; size: number; modified: string; scope: string; category: string; id?: number }>;
    editingMemory: string | null;
    setEditingMemory: (v: string | null) => void;
    editingContent: string;
    setEditingContent: (v: string) => void;
    memorySaving: boolean;
    memoryStats: { total: number; byCategory?: Record<string, number> } | null;
    memorySearchQuery: string;
    setMemorySearchQuery: (v: string) => void;
    memorySearchResults: Array<{ file: string; category: string; snippet: string; updated_at: string }>;
    memorySearching: boolean;
    saveMemoryFile: (filename: string, content: string) => void;
    deleteMemoryFile: (filename: string) => void;
    searchMemories: (query: string) => void;
}

export interface ChannelsTabProps {
    // Channels tab manages its own state internally via useState + IPC
}

export interface DataTabProps {
    // No props needed — DataTab uses isElectron + window.onicode directly
}
