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
            reasoningEffort?: string;
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
    onAgentStep: (callback: (data: { round: number; status: string; agentId?: string; task?: string; toolSet?: string; role?: string; orchestrationId?: string }) => void) => () => void;
    onPanelOpen: (callback: (data: { type: string }) => void) => () => void;

    // Ask User Question (Cascade-level)
    answerQuestion: (questionId: string, answer: string | string[]) => Promise<{ success: boolean }>;
    respondToPermission: (approvalId: string, approved: boolean) => Promise<{ success: boolean }>;
    onPermissionRequest: (callback: (data: {
        approvalId: string;
        tool: string;
        args: Record<string, unknown>;
        mode: string;
    }) => void) => () => void;
    onAskUser: (callback: (data: {
        questionId: string;
        question: string;
        options: Array<{ label: string; description?: string; preview?: string }>;
        allowMultiple: boolean;
    }) => void) => () => void;
    onThinkingStep: (callback: (data: {
        step: {
            number: number;
            total: number;
            thought: string;
            isRevision: boolean;
            revisesThought: number | null;
            branchFromThought: number | null;
            branchId: string | null;
            timestamp: number;
        };
        chainLength: number;
        nextNeeded: boolean;
    }) => void) => () => void;

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

    // Fetch available models from provider API
    fetchModels: (providerConfig: { id: string; apiKey?: string; baseUrl?: string }) => Promise<{ models?: string[]; error?: string }>;

    // Sync provider config to main process (for automation/workflows)
    syncProviderConfig: (config: { id: string; apiKey: string; baseUrl?: string; selectedModel?: string }) => Promise<{ success: boolean }>;

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
    connectorGoogleRefresh: () => Promise<{ success?: boolean; error?: string; accessToken?: string }>;
    connectorGwsStatus: () => Promise<{ installed: boolean; authenticated: boolean; email?: string; error?: string }>;
    connectorGwsLogin: () => Promise<{ success?: boolean; error?: string; message?: string }>;
    connectorGhEnsure: () => Promise<{ installed: boolean; error?: string }>;
    onConnectorGoogleResult: (callback: (result: { success?: boolean; error?: string; email?: string; name?: string; picture?: string }) => void) => () => void;

    // Key Store
    keystoreList: () => Promise<{ keys: Array<{ id: string; name: string; provider: string; notes?: string; maskedValue: string; createdAt: number; updatedAt: number }> }>;
    keystoreStore: (id: string, entry: { name: string; value: string; provider: string; notes?: string }) => Promise<{ success: boolean; key?: { id: string; name: string; provider: string } }>;
    keystoreGet: (id: string) => Promise<{ found: boolean; key?: { id: string; name: string; provider: string; notes?: string; maskedValue: string; createdAt: number; updatedAt: number } }>;
    keystoreDelete: (id: string) => Promise<{ success: boolean }>;
    keystoreStatus: () => Promise<{ encrypted: boolean; algorithm: string; keyDerivation: string; safeStorage: boolean; keyCount: number }>;

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
            recentFacts: string[];
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
    memoryList: () => Promise<{ success: boolean; files?: Array<{ name: string; size: number; modified: string; scope: string; category: string; id?: number }>; error?: string }>;
    memoryDelete: (filename: string) => Promise<{ success: boolean; error?: string }>;
    memorySearch: (query: string, scope?: string) => Promise<{ success: boolean; results?: Array<{ id: number; category: string; key: string; file: string; content: string; snippet: string; updated_at: string }>; error?: string }>;
    memoryStats: () => Promise<{ success: boolean; total?: number; byCategory?: Record<string, number>; error?: string }>;
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
    gitMerge: (repoPath: string, branch: string, noFf?: boolean) => Promise<{ success?: boolean; output?: string; error?: string }>;
    gitReset: (repoPath: string, mode?: string, ref?: string) => Promise<{ success?: boolean; output?: string; error?: string }>;
    gitTag: (repoPath: string, action?: string, tagName?: string, message?: string) => Promise<{ success?: boolean; tags?: string[]; output?: string; error?: string }>;
    gitLogGraph: (repoPath: string, count?: number) => Promise<{ success?: boolean; commits?: GitGraphCommit[]; error?: string }>;
    gitMergeAbort: (repoPath: string) => Promise<{ success?: boolean; error?: string }>;
    gitStashDrop: (repoPath: string, index?: number) => Promise<{ success?: boolean; error?: string }>;
    gitRemoteAdd: (repoPath: string, name: string, url: string) => Promise<{ success?: boolean; error?: string }>;
    gitRemoteRemove: (repoPath: string, name: string) => Promise<{ success?: boolean; error?: string }>;

    // Git GitHub Integration
    gitClone: (repoUrl: string, targetPath: string) => Promise<{ success?: boolean; error?: string }>;
    gitPushAuth: (repoPath: string, remote?: string, branch?: string) => Promise<{ success?: boolean; output?: string; error?: string }>;
    gitPullAuth: (repoPath: string, remote?: string, branch?: string) => Promise<{ success?: boolean; output?: string; error?: string }>;
    gitGithubRepos: (page?: number, perPage?: number, sort?: string) => Promise<{ success?: boolean; repos?: GithubRepo[]; error?: string }>;
    gitGithubCreatePR: (repoPath: string, title: string, body?: string, head?: string, base?: string) => Promise<{ success?: boolean; pr?: { number: number; url: string; title: string; state: string }; error?: string }>;
    gitGithubListPRs: (repoPath: string, state?: string) => Promise<{ success?: boolean; prs?: GithubPR[]; error?: string }>;
    gitGithubPRDetail: (repoPath: string, prNumber: number) => Promise<{ success?: boolean; pr?: GithubPRDetail; comments?: GithubComment[]; reviews?: GithubReview[]; error?: string }>;
    gitGithubMergePR: (repoPath: string, prNumber: number, mergeMethod?: string) => Promise<{ success?: boolean; sha?: string; message?: string; error?: string }>;
    gitGithubCreateRepo: (name: string, description?: string, isPrivate?: boolean) => Promise<{ success?: boolean; repo?: { name: string; fullName: string; cloneUrl: string; htmlUrl: string }; error?: string }>;
    gitGithubStatus: () => Promise<{ connected: boolean; username?: string; avatarUrl?: string; name?: string }>;

    // Hooks
    hooksList: (projectPath?: string) => Promise<{ hooks: Record<string, HookDefinition[]> }>;
    hooksSave: (hooks: Record<string, HookDefinition[]>, scope?: string, projectPath?: string) => Promise<{ success: boolean; error?: string }>;
    hooksTest: (hookType: string, context: Record<string, unknown>, command?: string) => Promise<{ success: boolean; exitCode?: number; stdout?: string; stderr?: string; error?: string }>;
    hooksPresets: () => Promise<Array<{ id: string; name: string; description: string; hookTypes: string[] }>>;
    hooksApplyPreset: (presetId: string, scope?: string, projectPath?: string) => Promise<{ success: boolean; preset?: string; error?: string }>;
    onHookExecuted: (callback: (data: { hookType: string; allowed: boolean; reason?: string; outputs: string[]; toolName?: string; timestamp: number }) => void) => () => void;
    onAutoCommit: (callback: (data: { message: string; taskId?: string }) => void) => () => void;

    // Custom Commands
    customCommandsList: (projectPath?: string) => Promise<CustomCommand[]>;
    customCommandsCreate: (name: string, content: string, scope: 'global' | 'project', projectPath?: string) => Promise<{ success: boolean; error?: string }>;
    customCommandsDelete: (name: string, scope: 'global' | 'project', projectPath?: string) => Promise<{ success: boolean; error?: string }>;

    // Context Compaction
    compactMessages: (messages: Array<{ role: string; content: string; toolSteps?: unknown[] }>) => Promise<{ messages: Array<{ role: string; content: string }>; compacted: boolean; summary?: string }>;
    estimateTokens: (messages: Array<{ role: string; content: string }>) => Promise<{ tokens: number }>;

    // Code Intelligence (LSP)
    lspSymbols: (projectPath: string, filePath: string) => Promise<Array<{ name: string; kind: string; line: number; exported: boolean; signature?: string }>>;
    lspDefinition: (projectPath: string, filePath: string, line: number, column: number) => Promise<{ file: string; line: number; column: number; name: string; kind: string; preview: string } | null>;
    lspReferences: (projectPath: string, filePath: string, symbolName: string) => Promise<Array<{ file: string; line: number; column: number; preview: string }>>;
    lspHover: (projectPath: string, filePath: string, line: number, column: number) => Promise<{ type: string; documentation?: string; signature?: string } | null>;
    lspProjectSymbols: (projectPath: string, options?: Record<string, unknown>) => Promise<Record<string, Array<{ name: string; kind: string; line: number; exported: boolean }>>>;
    lspInvalidate: (projectPath?: string) => Promise<{ success: boolean }>;

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

    // Scheduler
    schedulerList: () => Promise<{ success: boolean; schedules?: ScheduleDef[]; error?: string }>;
    schedulerGet: (id: string) => Promise<{ success: boolean; schedule?: ScheduleDef; error?: string }>;
    schedulerCreate: (opts: { name: string; cron_expression: string; action: Record<string, unknown>; workflow_id?: string; max_concurrent?: number; rate_limit_seconds?: number }) => Promise<{ success: boolean; schedule?: ScheduleDef; error?: string }>;
    schedulerUpdate: (id: string, updates: Partial<ScheduleDef>) => Promise<{ success: boolean; schedule?: ScheduleDef; error?: string }>;
    schedulerDelete: (id: string) => Promise<{ success: boolean; error?: string }>;
    schedulerPause: (id: string) => Promise<{ success: boolean; schedule?: ScheduleDef; error?: string }>;
    schedulerResume: (id: string) => Promise<{ success: boolean; schedule?: ScheduleDef; error?: string }>;
    schedulerRunNow: (id: string) => Promise<{ success: boolean; output?: string; error?: string }>;
    onSchedulerTick: (callback: (data: { timestamp: string; checked: number; fired: number }) => void) => () => void;
    onSchedulerStatus: (callback: (data: { scheduleId: string; runId: string; status: string; output?: string; error?: string; timestamp: string; manual?: boolean }) => void) => () => void;

    // Workflows
    workflowList: () => Promise<{ success: boolean; workflows?: WorkflowDef[]; error?: string }>;
    workflowGet: (id: string) => Promise<{ success: boolean; workflow?: WorkflowDef; error?: string }>;
    workflowCreate: (opts: { name: string; description?: string; steps: WorkflowStep[]; tags?: string[] }) => Promise<{ success: boolean; workflow?: WorkflowDef; error?: string }>;
    workflowUpdate: (id: string, updates: Partial<WorkflowDef>) => Promise<{ success: boolean; workflow?: WorkflowDef; error?: string }>;
    workflowDelete: (id: string) => Promise<{ success: boolean; error?: string }>;
    workflowRun: (id: string, params?: Record<string, unknown>) => Promise<{ success: boolean; runId?: string; status?: string; duration?: number; error?: string }>;
    workflowRuns: (workflowId: string, limit?: number) => Promise<{ success: boolean; runs?: WorkflowRunSummary[]; error?: string }>;
    workflowRunDetail: (runId: string) => Promise<{ success: boolean; run?: WorkflowRunDetail; error?: string }>;
    workflowAllRuns: (limit?: number) => Promise<{ success: boolean; runs?: WorkflowRunSummary[]; error?: string }>;
    workflowQueueStatus: () => Promise<{ success: boolean; running: number; queued: number; maxConcurrent: number; runningIds: string[]; queuedIds: string[] }>;
    onWorkflowQueueUpdated: (callback: (data: { running: number; queued: number; maxConcurrent: number; runningIds: string[]; queuedIds: string[] }) => void) => () => void;
    onWorkflowRunQueued: (callback: (data: { runId: string; workflowId: string; workflowName: string }) => void) => () => void;
    onWorkflowRunStarted: (callback: (data: { runId: string; workflowId: string; workflowName: string }) => void) => () => void;
    onWorkflowRunCompleted: (callback: (data: { runId: string; workflowId: string; workflowName: string; status: string; duration: number; error?: string }) => void) => () => void;
    onWorkflowStepStarted: (callback: (data: { runId: string; stepIndex: number; stepName: string; stepType: string; total: number }) => void) => () => void;
    onWorkflowStepCompleted: (callback: (data: { runId: string; stepIndex: number; stepName: string; success: boolean; duration: number; total: number }) => void) => () => void;
    onWorkflowAgentRound: (callback: (data: { stepName: string; round: number; maxRounds: number; status: string }) => void) => () => void;
    onWorkflowAgentTool: (callback: (data: { stepName: string; round: number; toolName: string; args?: string; status: string; success?: boolean }) => void) => () => void;

    // Automation Messages
    onAutomationMessage: (callback: (data: { id: string; content: string; source: string; title?: string; timestamp: number }) => void) => () => void;

    // Heartbeat
    heartbeatConfig: () => Promise<{ success: boolean; config?: HeartbeatConfig; error?: string }>;
    heartbeatUpdate: (updates: Partial<HeartbeatConfig>) => Promise<{ success: boolean; config?: HeartbeatConfig; error?: string }>;
    heartbeatAddCheck: (check: Partial<HeartbeatCheck>) => Promise<{ success: boolean; check?: HeartbeatCheck; error?: string }>;
    heartbeatRemoveCheck: (checkId: string) => Promise<{ success: boolean; removed?: string; error?: string }>;
    heartbeatUpdateCheck: (checkId: string, updates: Partial<HeartbeatCheck>) => Promise<{ success: boolean; check?: HeartbeatCheck; error?: string }>;
    heartbeatTrigger: () => Promise<{ success: boolean; result?: { checks_run: number; actions_needed: number; errors: number; results: unknown[] }; error?: string }>;
    onHeartbeatTick: (callback: (data: { timestamp: number; checks_run: number; actions_needed: number; errors: number }) => void) => () => void;
    onHeartbeatAction: (callback: (data: { check_id: string; check_name: string; type: string; reason: string; urgency: string; timestamp: number }) => void) => () => void;

    // Chat activity (for workflow result pipeline)
    chatActivityChange: (isActive: boolean) => Promise<{ success: boolean }>;

    // Plan Mode
    planModeEnter: (conversationId?: string) => Promise<{ success: boolean; planId?: string; planPath?: string; error?: string }>;
    planModeExit: (planId: string) => Promise<{ success: boolean; content?: string; error?: string }>;
    planModeGet: () => Promise<{ active: boolean; planId?: string; planPath?: string; content?: string }>;
    planModeUpdate: (planId: string, content: string) => Promise<{ success: boolean; error?: string }>;
    onPlanModeChange: (callback: (data: { active: boolean; planId?: string }) => void) => () => void;

    // Worktree Management
    worktreeCreate: (name?: string) => Promise<{ success: boolean; path?: string; branch?: string; error?: string }>;
    worktreeRemove: (path: string, force?: boolean) => Promise<{ success: boolean; error?: string }>;
    worktreeList: () => Promise<{ success: boolean; worktrees?: Array<{ path: string; branch: string; head: string; isMain: boolean }>; error?: string }>;
    worktreeGetCurrent: () => Promise<{ inWorktree: boolean; path?: string; branch?: string }>;

    // System Tray events
    onTrayNewChat: (callback: () => void) => () => void;

    platform: string;

    getEnvironment: () => Promise<{
        platform: string;
        arch: string;
        osVersion: string;
        osType: string;
        hostname: string;
        username: string;
        homeDir: string;
        cpus: number;
        totalMemoryGB: number;
        nodeVersion: string;
        electronVersion: string;
        shell: string;
        cwd: string;
    }>;
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
        blocks?: number[];
        blockedBy?: number[];
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

    interface GitGraphCommit {
        hash: string;
        shortHash: string;
        author: string;
        email: string;
        timestamp: number;
        message: string;
        parents: string[];
        refs: string[];
    }

    interface GitRemote {
        name: string;
        fetchUrl: string;
        pushUrl: string;
    }

    interface GithubRepo {
        id: number; name: string; fullName: string;
        description: string | null; private: boolean;
        htmlUrl: string; cloneUrl: string;
        language: string | null; stars: number;
        forks: number; updatedAt: string;
        defaultBranch: string;
    }

    interface GithubPR {
        number: number; title: string; state: string;
        url: string; author: string;
        head: string; base: string;
        createdAt: string; updatedAt: string;
        draft: boolean; mergeable: boolean | null;
        additions: number; deletions: number;
        labels: string[];
    }

    interface GithubPRDetail {
        number: number; title: string; body: string;
        state: string; url: string; author: string;
        head: string; base: string;
        mergeable: boolean | null; merged: boolean;
        additions: number; deletions: number; changedFiles: number;
        createdAt: string; updatedAt: string;
    }

    interface GithubComment {
        id: number; body: string; author: string; createdAt: string;
    }

    interface GithubReview {
        id: number; state: string; body: string;
        author: string; submittedAt: string;
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

    interface WorkflowStep {
        name?: string;
        type: 'ai_prompt' | 'command' | 'tool_call' | 'condition' | 'notify' | 'wait' | 'webhook';
        prompt?: string;
        command?: string;
        tool?: string;
        args?: Record<string, unknown>;
        condition?: string;
        title?: string;
        body?: string;
        message?: string;
        seconds?: number;
        url?: string;
        on_failure?: 'abort' | 'continue' | 'skip_rest';
        timeout?: number;
        cwd?: string;
        skip_if_false?: boolean;
        // Agentic step fields (Phase 3)
        goal?: string;
        tool_set?: 'read-only' | 'file-ops' | 'search' | 'git' | 'browser' | 'workspace' | 'research';
        complexity?: 'simple' | 'moderate' | 'complex';
        tool_priority?: string[];
        max_rounds?: number;
        context?: {
            files?: string[];
            previous_steps?: boolean;
            project_docs?: boolean;
        };
    }

    interface WorkflowDef {
        id: string;
        name: string;
        description: string;
        steps: WorkflowStep[];
        trigger_config: Record<string, unknown>;
        enabled: boolean;
        project_id: string | null;
        project_path: string | null;
        tags: string[];
        created_at: number;
        updated_at: number;
    }

    interface ScheduleDef {
        id: string;
        name: string;
        cron_expression: string;
        workflow_id: string | null;
        action: Record<string, unknown>;
        enabled: boolean;
        timezone: string;
        last_run_at: number | null;
        next_run_at: number | null;
        max_concurrent: number;
        rate_limit_seconds: number;
        created_at: number;
        updated_at: number;
    }

    interface WorkflowRunSummary {
        id: string;
        workflow_id: string | null;
        schedule_id: string | null;
        trigger_type: string;
        trigger_data: Record<string, unknown>;
        status: 'pending' | 'running' | 'completed' | 'failed';
        current_step: number;
        steps_completed: number;
        steps_total: number;
        result: Record<string, unknown>;
        error: string | null;
        started_at: number | null;
        completed_at: number | null;
        duration_ms: number | null;
    }

    interface WorkflowRunDetail extends WorkflowRunSummary {
        stepRuns: WorkflowStepRun[];
    }

    interface WorkflowStepRun {
        id: number;
        run_id: string;
        step_index: number;
        step_name: string;
        step_type: string;
        input: Record<string, unknown>;
        output: Record<string, unknown>;
        status: 'pending' | 'running' | 'completed' | 'failed';
        error: string | null;
        started_at: number | null;
        completed_at: number | null;
        duration_ms: number | null;
    }

    interface HeartbeatCheck {
        id: string;
        name: string;
        type: 'ai_eval' | 'command_check' | 'workflow_trigger';
        prompt?: string | null;
        command?: string | null;
        trigger_workflow_id?: string | null;
        priority: number;
        enabled: boolean;
        last_checked_at: number | null;
        created_at: number;
    }

    interface HeartbeatConfig {
        id: string;
        enabled: boolean;
        interval_minutes: number;
        checklist: HeartbeatCheck[];
        quiet_hours_start: string;
        quiet_hours_end: string;
        max_actions_per_beat: number;
        last_beat_at: number | null;
        updated_at: number;
    }

    interface Window {
        onicode?: OnicodeAPI;
    }
}

export {};
