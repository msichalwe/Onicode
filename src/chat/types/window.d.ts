interface FileTreeItem {
    name: string;
    path: string;
    type: 'file' | 'directory';
    children?: FileTreeItem[];
}

interface ProjectMeta {
    id: string;
    name: string;
    path: string;
    description: string;
    techStack: string;
    scope: string;
    createdAt: number;
    updatedAt: number;
}

interface ProjectDoc {
    name: string;
    path: string;
    content: string;
}

interface OnicodeAPI {
    getAppInfo: () => Promise<{ name: string; version: string; platform: string }>;
    getTheme: () => Promise<{ theme: string }>;
    setTheme: (theme: string) => Promise<{ success: boolean; theme: string }>;

    // AI Chat
    sendMessage: (
        messages: Array<{ role: string; content: string }>,
        providerConfig: {
            id: string;
            apiKey: string;
            baseUrl?: string;
            selectedModel?: string;
            projectPath?: string;
        }
    ) => Promise<{ success?: boolean; error?: string }>;
    onStreamChunk: (callback: (chunk: string) => void) => () => void;
    onStreamDone: (callback: (error: string | null) => void) => () => void;
    abortAI: () => Promise<{ success: boolean }>;
    openExternal: (url: string) => Promise<void>;

    // Message break — finalize current bubble, start new one
    onMessageBreak: (callback: (data: Record<string, unknown>) => void) => () => void;

    // AI Agentic Events
    onToolCall: (callback: (data: { id: string; name: string; args: Record<string, unknown>; round: number }) => void) => () => void;
    onToolResult: (callback: (data: { id: string; name: string; result: Record<string, unknown>; round: number }) => void) => () => void;
    onAgentStep: (callback: (data: { round: number; status: string; agentId?: string; task?: string }) => void) => () => void;
    onPanelOpen: (callback: (data: { type: string }) => void) => () => void;

    // Agent & Process Runtime
    listAgents: () => Promise<Array<{ id: string; task: string; status: string; createdAt: number; result?: string; role?: string }>>;
    listBackgroundProcesses: () => Promise<Array<{ id: string; command: string; status: string; pid?: number; port?: number; startedAt?: number }>>;
    killBackgroundProcess: (processId: string) => Promise<{ success?: boolean; error?: string }>;

    // Multi-Agent Orchestration
    orchestrationList: () => Promise<Array<OrchestrationSummary>>;
    orchestrationGet: (id: string) => Promise<OrchestrationDetail | null>;
    onOrchestrationStart: (callback: (data: { id: string; description: string; nodeCount: number; graph: WorkGraphSummary }) => void) => () => void;
    onOrchestrationProgress: (callback: (data: { id: string; graph: WorkGraphSummary; completedBatch: Array<{ nodeId: string; agentId: string; success: boolean }> }) => void) => () => void;
    onOrchestrationDone: (callback: (data: { id: string; summary: WorkGraphSummary; report: string; duration: number }) => void) => () => void;
    readFileContent: (filePath: string) => Promise<{ content?: string; size?: number; modified?: string; error?: string }>;
    readScreenshotBase64: (filePath: string) => Promise<{ dataUri?: string; error?: string }>;

    // Task Management (extended)
    listProjectTasks: (projectPath: string) => Promise<{ pending: Array<unknown>; inProgress: Array<unknown>; done: Array<unknown>; archived: Array<unknown>; skipped: Array<unknown> }>;
    archiveCompletedTasks: () => Promise<{ success?: boolean; error?: string }>;

    onTerminalSession: (callback: (data: {
        id: string;
        command: string;
        cwd: string;
        startedAt: number;
        status: 'running' | 'done' | 'error';
        exitCode?: number;
        finishedAt?: number;
        duration?: number;
    }) => void) => () => void;
    onAITerminalOutput: (callback: (data: {
        sessionId: string;
        type: 'prompt' | 'stdout' | 'stderr' | 'exit';
        data: string;
        cwd?: string;
    }) => void) => () => void;

    // Codex OAuth
    codexOAuthGetAuthUrl: () => Promise<{ success?: boolean; error?: string; authUrl?: string }>;
    codexOAuthExchange: (redirectUrl: string) => Promise<{
        success?: boolean;
        error?: string;
        accessToken?: string;
        refreshToken?: string;
        expiresIn?: number;
    }>;
    codexOAuthCancel: () => Promise<{ success: boolean }>;

    // Test provider
    testProvider: (providerConfig: {
        id: string;
        apiKey?: string;
        baseUrl?: string;
    }) => Promise<{
        success?: boolean;
        error?: string;
        models?: string[];
        modelCount?: number;
    }>;

    // Terminal
    createTerminal: (cwd?: string) => Promise<{ success?: boolean; sessionId?: string; error?: string }>;
    writeTerminal: (sessionId: string, data: string) => Promise<{ success?: boolean; error?: string }>;
    killTerminal: (sessionId: string) => Promise<{ success: boolean }>;
    terminalStatus: (sessionId: string) => Promise<{
        exists: boolean;
        cwd?: string;
        historyCount?: number;
        lastCommands?: string[];
    }>;
    terminalExec: (command: string, cwd?: string) => Promise<{
        success: boolean;
        code: number;
        stdout: string;
        stderr: string;
    }>;
    onTerminalOutput: (callback: (data: { sessionId: string; data: string; stream: string }) => void) => () => void;
    onTerminalExit: (callback: (data: { sessionId: string; code: number; error?: string }) => void) => () => void;

    // Projects
    initProject: (opts: {
        name: string;
        projectPath: string;
        description?: string;
        techStack?: string;
        scope?: string;
    }) => Promise<{ success?: boolean; project?: ProjectMeta; error?: string }>;
    scanProject: (folderPath: string) => Promise<{
        success?: boolean;
        error?: string;
        scan?: {
            name: string;
            path: string;
            hasGit: boolean;
            gitBranch?: string;
            hasOnidocs: boolean;
            createdOnidocs?: boolean;
            detectedTech: string[];
            fileCount: number;
            topLevelFiles: string[];
            alreadyRegistered?: boolean;
            registered?: boolean;
            projectId: string;
        };
    }>;
    listProjects: () => Promise<{ projects: ProjectMeta[] }>;
    getProject: (projectId: string) => Promise<{ project?: ProjectMeta; docs?: ProjectDoc[]; error?: string }>;
    deleteProject: (projectId: string) => Promise<{ success: boolean }>;
    openProjectIn: (projectPath: string, editor: string) => Promise<{ success?: boolean; error?: string }>;

    // File System
    readDir: (dirPath: string, maxDepth?: number) => Promise<{ success?: boolean; tree?: FileTreeItem[]; error?: string }>;
    readFile: (filePath: string) => Promise<{ success?: boolean; content?: string; error?: string }>;
    writeFile: (filePath: string, content: string) => Promise<{ success?: boolean; error?: string }>;

    // Connectors
    connectorList: () => Promise<{ connectors: Record<string, { connected: boolean; username: string; avatarUrl: string; connectedAt: number }> }>;
    connectorGet: (connectorId: string) => Promise<{ connected: boolean; username?: string; email?: string; avatarUrl?: string; picture?: string; connectedAt?: number }>;
    connectorDisconnect: (connectorId: string) => Promise<{ success: boolean }>;
    connectorGithubStart: () => Promise<{ success?: boolean; error?: string; deviceCode?: string; userCode?: string; verificationUri?: string; expiresIn?: number; interval?: number }>;
    connectorGithubPoll: (deviceCode: string, interval?: number) => Promise<{ success?: boolean; error?: string; username?: string; avatarUrl?: string }>;
    connectorGithubCancel: () => Promise<{ success: boolean }>;
    connectorGoogleStart: () => Promise<{ success?: boolean; error?: string; authUrl?: string }>;
    connectorGoogleCancel: () => Promise<{ success: boolean }>;
    onConnectorGoogleResult: (callback: (result: { success?: boolean; error?: string; email?: string; name?: string; picture?: string }) => void) => () => void;

    // Memory
    memoryLoadCore: (projectId?: string) => Promise<{
        success: boolean;
        memories?: {
            soul: string | null;
            user: string | null;
            longTerm: string | null;
            dailyToday: string | null;
            dailyYesterday: string | null;
            projectMemory: string | null;
            hasUserProfile: boolean;
            hasSoul: boolean;
        };
        error?: string;
    }>;
    memoryEnsureDefaults: () => Promise<{ success: boolean; created?: string[]; needsOnboarding?: boolean; error?: string }>;
    memorySaveOnboarding: (answers: { name?: string; language?: string; framework?: string; codeStyle?: string; extras?: string }) => Promise<{ success: boolean; error?: string }>;
    memoryRead: (filename: string) => Promise<{ success: boolean; content?: string | null; error?: string }>;
    memoryWrite: (filename: string, content: string) => Promise<{ success: boolean; error?: string }>;
    memoryAppend: (filename: string, content: string) => Promise<{ success: boolean; error?: string }>;
    memoryList: () => Promise<{ success: boolean; files?: Array<{ name: string; size: number; modified: string; scope: string }>; error?: string }>;
    memoryDelete: (filename: string) => Promise<{ success: boolean; error?: string }>;
    memoryCompact: (messages: unknown[], keepRecent?: number) => Promise<{ success: boolean; result?: { summary: string; recentMessages: unknown[]; compactedCount: number } | null; error?: string }>;

    // Project-scoped memory
    memoryProjectRead: (projectId: string) => Promise<{ success: boolean; content?: string | null; error?: string }>;
    memoryProjectWrite: (projectId: string, content: string) => Promise<{ success: boolean; error?: string }>;
    memoryProjectAppend: (projectId: string, content: string) => Promise<{ success: boolean; error?: string }>;

    // Memory change notifications
    onMemoryChanged: (callback: (data: { filename: string; action: string; scope: string }) => void) => () => void;

    // Browser / Puppeteer
    browserLaunch: (opts?: { headless?: boolean; width?: number; height?: number }) => Promise<{ success?: boolean; error?: string; reused?: boolean; message?: string }>;
    browserClose: () => Promise<{ success: boolean }>;
    browserNavigate: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<{ success?: boolean; url?: string; status?: number | null; title?: string; error?: string }>;
    browserScreenshot: (opts: { name: string; selector?: string; fullPage?: boolean }) => Promise<{ success?: boolean; path?: string; name?: string; size?: number; error?: string }>;
    browserEvaluate: (script: string) => Promise<{ success?: boolean; result?: string; error?: string }>;
    browserClick: (selector: string) => Promise<{ success?: boolean; selector?: string; error?: string }>;
    browserType: (selector: string, text: string) => Promise<{ success?: boolean; selector?: string; typed?: number; error?: string }>;
    browserWait: (selector: string, opts?: { timeout?: number }) => Promise<{ success?: boolean; selector?: string; error?: string }>;
    browserContent: () => Promise<{ success?: boolean; url?: string; title?: string; html?: string; length?: number; error?: string }>;
    browserConsoleLogs: (opts?: { type?: string; limit?: number }) => Promise<{ success: boolean; logs: Array<{ type: string; text: string; ts: string }> }>;
    browserConsoleClear: () => Promise<{ success: boolean }>;

    // Attachments (project-scoped)
    attachmentSave: (att: {
        id: string; projectId: string; name: string; type: string;
        size?: number; mimeType?: string; url?: string; content?: string;
        dataUrl?: string; conversationId?: string; createdAt?: number;
    }) => Promise<{ success?: boolean; error?: string }>;
    attachmentList: (projectId: string) => Promise<{
        success?: boolean;
        attachments?: Array<{
            id: string; project_id: string; name: string; type: string;
            size?: number; mime_type?: string; url?: string; content?: string;
            data_url?: string; conversation_id?: string; created_at: number;
        }>;
        error?: string;
    }>;
    attachmentDelete: (id: string) => Promise<{ success?: boolean; error?: string }>;

    // Conversations (SQLite)
    conversationSave: (conv: {
        id: string; title: string; messages: Array<{ id: string; role: string; content: string; timestamp: number; toolSteps?: unknown[] }>;
        scope?: string; projectId?: string; projectName?: string; createdAt: number; updatedAt: number;
    }) => Promise<{ success?: boolean; error?: string }>;
    conversationGet: (id: string) => Promise<{ success?: boolean; conversation?: unknown; error?: string }>;
    conversationList: (limit?: number, offset?: number) => Promise<{ success?: boolean; conversations?: Array<{
        id: string; title: string; messages: unknown[]; scope?: string; project_id?: string; project_name?: string; created_at: number; updated_at: number;
    }>; error?: string }>;
    conversationDelete: (id: string) => Promise<{ success?: boolean; error?: string }>;
    conversationSearch: (query: string) => Promise<{ success?: boolean; results?: Array<{ id: string; title: string; scope?: string; updated_at: number }>; error?: string }>;
    conversationMigrate: (conversations: unknown[]) => Promise<{ success?: boolean; migrated?: number; error?: string }>;

    // Logger
    loggerGetRecent: (opts?: { level?: string; category?: string; limit?: number; since?: string }) => Promise<{ success: boolean; entries: Array<{ ts: string; level: string; category: string; message: string; data: string | null }> }>;
    loggerReadDay: (date: string) => Promise<{ success: boolean; entries: Array<{ ts: string; level: string; category: string; message: string; data: string | null }> }>;
    loggerListFiles: () => Promise<{ success: boolean; files: Array<{ name: string; date: string; size: number }> }>;

    // Tasks
    tasksList: () => Promise<TaskSummary>;
    loadProjectTasks: (projectPath: string) => Promise<{ success: boolean; summary?: TaskSummary; error?: string }>;
    taskCreate: (content: string, priority?: string) => Promise<{ success: boolean; task?: TaskItem; summary?: TaskSummary; error?: string }>;
    taskUpdate: (id: number, updates: { status?: string; content?: string; priority?: string }) => Promise<{ success: boolean; task?: TaskItem; summary?: TaskSummary; error?: string }>;
    taskDelete: (id: number) => Promise<{ success: boolean; summary?: TaskSummary; error?: string }>;
    taskSetMilestone: (taskId: number, milestoneId: string | null) => Promise<{ success: boolean; error?: string }>;
    onTasksUpdated: (callback: (data: TaskSummary) => void) => () => void;

    // Milestones
    milestoneList: (projectPath: string) => Promise<{ success: boolean; milestones: MilestoneItem[]; error?: string }>;
    milestoneCreate: (milestone: { id: string; title: string; description?: string; dueDate?: number | null; status?: string; createdAt: number }, projectId: string, projectPath: string) => Promise<{ success: boolean; error?: string }>;
    milestoneUpdate: (id: string, updates: { title?: string; description?: string; status?: string; dueDate?: number | null }) => Promise<{ success: boolean; error?: string }>;
    milestoneDelete: (id: string) => Promise<{ success: boolean; error?: string }>;

    // Live File Changes (from AI tool calls)
    onFileChanged: (callback: (data: { action: string; path: string; lines?: number; linesAdded?: number; linesRemoved?: number; dir?: string }) => void) => () => void;

    // Agent Mode & Permissions
    agentSetMode: (mode: string) => Promise<{ success: boolean; mode: string }>;
    agentGetMode: () => Promise<{ mode: string; permissions: Record<string, string> }>;
    setSetting: (key: string, value: unknown) => Promise<{ success: boolean }>;
    getSetting: (key: string) => Promise<unknown>;
    onAgentMode: (callback: (mode: string) => void) => () => void;

    // Session Title
    onSessionTitle: (callback: (title: string) => void) => () => void;

    // Git
    gitIsRepo: (repoPath: string) => Promise<{ isRepo: boolean }>;
    gitInit: (repoPath: string) => Promise<{ success?: boolean; output?: string; error?: string }>;
    gitStatus: (repoPath: string) => Promise<{
        success?: boolean; error?: string;
        branch?: string; files?: GitStatusFile[];
        ahead?: number; behind?: number; clean?: boolean;
    }>;
    gitBranches: (repoPath: string) => Promise<{ success?: boolean; branches?: GitBranch[]; error?: string }>;
    gitLog: (repoPath: string, count?: number) => Promise<{ success?: boolean; commits?: GitCommit[]; error?: string }>;
    gitDiff: (repoPath: string, filePath?: string, staged?: boolean) => Promise<{ success?: boolean; output?: string; error?: string }>;
    gitStage: (repoPath: string, files: string | string[]) => Promise<{ success?: boolean; error?: string }>;
    gitUnstage: (repoPath: string, files: string | string[]) => Promise<{ success?: boolean; error?: string }>;
    gitCommit: (repoPath: string, message: string) => Promise<{ success?: boolean; output?: string; error?: string }>;
    gitCheckout: (repoPath: string, branch: string, create?: boolean) => Promise<{ success?: boolean; error?: string }>;
    gitStash: (repoPath: string, action?: string, message?: string) => Promise<{ success?: boolean; stashes?: string[]; error?: string }>;
    gitRemotes: (repoPath: string) => Promise<{ success?: boolean; remotes?: GitRemote[]; error?: string }>;
    gitPull: (repoPath: string) => Promise<{ success?: boolean; output?: string; error?: string }>;
    gitPush: (repoPath: string) => Promise<{ success?: boolean; output?: string; error?: string }>;
    gitShow: (repoPath: string, ref: string, filePath: string) => Promise<{ success?: boolean; output?: string; error?: string }>;

    // Hooks
    hooksList: () => Promise<{ hooks: Record<string, HookDefinition[]> }>;
    hooksSave: (hooks: Record<string, HookDefinition[]>) => Promise<{ success: boolean; error?: string }>;
    hooksTest: (hookType: string, context: Record<string, unknown>) => Promise<{ allowed: boolean; reason?: string; outputs: string[] }>;

    // Custom Commands
    customCommandsList: (projectPath?: string) => Promise<CustomCommand[]>;
    customCommandsCreate: (name: string, content: string, scope: 'global' | 'project', projectPath?: string) => Promise<{ success: boolean; error?: string }>;
    customCommandsDelete: (name: string, scope: 'global' | 'project', projectPath?: string) => Promise<{ success: boolean; error?: string }>;

    // Context Compaction
    compactMessages: (messages: Array<{ role: string; content: string; toolSteps?: unknown[] }>) => Promise<{ messages: Array<{ role: string; content: string }>; compacted: boolean; summary?: string }>;
    estimateTokens: (messages: Array<{ role: string; content: string }>) => Promise<{ tokens: number; messageCount: number }>;

    // Code Intelligence (LSP)
    lspSymbols: (projectPath: string, filePath: string) => Promise<Array<{ name: string; kind: string; line: number; exported: boolean; signature?: string }>>;
    lspDefinition: (projectPath: string, filePath: string, line: number, column: number) => Promise<{ file: string; line: number; column: number; name: string; kind: string; preview: string } | null>;
    lspReferences: (projectPath: string, filePath: string, symbolName: string) => Promise<Array<{ file: string; line: number; column: number; preview: string }>>;
    lspHover: (projectPath: string, filePath: string, line: number, column: number) => Promise<{ type: string; documentation?: string; signature?: string } | null>;
    lspProjectSymbols: (projectPath: string) => Promise<Record<string, Array<{ name: string; kind: string; line: number; exported: boolean }>>>;
    lspInvalidate: () => Promise<void>;

    // Code Index (Semantic Search)
    codeIndexBuild: (projectPath: string) => Promise<{ files: number; uniqueTokens: number; projectPath: string }>;
    codeIndexSearch: (query: string, maxResults?: number) => Promise<Array<{ file: string; score: number; matchedTokens: string[]; preview: string }>>;
    codeIndexStats: () => Promise<{ files: number; uniqueTokens: number; projectPath: string | null }>;
    codeIndexUpdate: () => Promise<{ updated: number; removed: number; added: number }>;

    // MCP (Model Context Protocol)
    mcpListServers: () => Promise<{ servers: MCPServerInfo[] }>;
    mcpConnectServer: (name: string) => Promise<{ success: boolean; error?: string; toolCount?: number }>;
    mcpDisconnectServer: (name: string) => Promise<{ success: boolean; error?: string }>;
    mcpAddServer: (name: string, serverDef: MCPServerDef) => Promise<{ success: boolean; error?: string }>;
    mcpRemoveServer: (name: string) => Promise<{ success: boolean; error?: string }>;
    mcpGetToolsForPrompt: () => Promise<{ tools: MCPToolInfo[] }>;
    onMcpServerStatus: (callback: (data: { name: string; status: string; toolCount?: number; error?: string }) => void) => () => void;

    platform: string;
}

declare global {
    interface MCPServerDef {
        command: string;
        args: string[];
        env?: Record<string, string>;
        enabled: boolean;
    }

    interface MCPServerInfo {
        name: string;
        config: MCPServerDef;
        status: 'disconnected' | 'connecting' | 'connected' | 'error';
        toolCount: number;
        tools: Array<{ name: string; description: string }>;
        error: string | null;
    }

    interface MCPToolInfo {
        serverName: string;
        toolName: string;
        fullName: string;
        description: string;
    }

    interface HookDefinition {
        matcher?: string;
        command: string;
        timeout?: number;
    }

    interface CustomCommand {
        name: string;
        description: string;
        prompt: string;
        source: 'global' | 'project';
    }

    interface TaskItem {
        id: number;
        content: string;
        status: 'pending' | 'in_progress' | 'done' | 'skipped';
        priority: 'high' | 'medium' | 'low';
        createdAt: string;
        completedAt: string | null;
        milestoneId?: string | null;
    }

    interface MilestoneItem {
        id: string;
        title: string;
        description: string;
        status: 'open' | 'closed';
        due_date?: number | null;
        dueDate?: number | null;
        project_id?: string | null;
        project_path?: string | null;
        created_at?: number;
        createdAt?: number;
        taskCount: number;
        tasksDone: number;
        tasksInProgress: number;
    }

    interface TaskSummary {
        total: number;
        done: number;
        pending: number;
        inProgress: number;
        allDone: boolean;
        nextTask: TaskItem | null;
        tasks: TaskItem[];
    }

    interface GitStatusFile {
        path: string;
        status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted';
        staged: boolean;
    }

    interface GitBranch {
        name: string;
        hash: string;
        upstream: string | null;
        current: boolean;
        remote: boolean;
    }

    interface GitCommit {
        hash: string;
        shortHash: string;
        author: string;
        email: string;
        timestamp: number;
        message: string;
    }

    interface GitRemote {
        name: string;
        fetchUrl: string;
        pushUrl: string;
    }

    interface WorkGraphNode {
        id: string;
        task: string;
        role: string;
        status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
        agentId: string | null;
        deps: string[];
        rounds: number;
        duration: number | null;
    }

    interface WorkGraphSummary {
        total: number;
        pending: number;
        running: number;
        done: number;
        failed: number;
        skipped: number;
        nodes: WorkGraphNode[];
    }

    interface OrchestrationSummary {
        id: string;
        description: string;
        status: string;
        startedAt: number;
        completedAt: number | null;
        nodeCount: number;
        summary: WorkGraphSummary;
    }

    interface OrchestrationDetail {
        id: string;
        description: string;
        status: string;
        startedAt: number;
        completedAt: number | null;
        duration: number;
        graph: WorkGraphSummary;
        fileLocks: Array<{ path: string; agentId: string; role: string; acquiredAt: number }>;
        nodeResults: Array<{
            id: string;
            task: string;
            role: string;
            status: string;
            result: string | null;
            error: string | null;
            rounds: number;
        }>;
    }

    interface Window {
        onicode?: OnicodeAPI;
    }
}

export {};
