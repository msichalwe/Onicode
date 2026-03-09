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
        }
    ) => Promise<{ success?: boolean; error?: string }>;
    onStreamChunk: (callback: (chunk: string) => void) => () => void;
    onStreamDone: (callback: (error: string | null) => void) => () => void;
    abortAI: () => Promise<{ success: boolean }>;

    // AI Agentic Events
    onToolCall: (callback: (data: { id: string; name: string; args: Record<string, unknown>; round: number }) => void) => () => void;
    onToolResult: (callback: (data: { id: string; name: string; result: Record<string, unknown>; round: number }) => void) => () => void;
    onAgentStep: (callback: (data: { round: number; status: string }) => void) => () => void;
    onPanelOpen: (callback: (data: { type: string }) => void) => () => void;
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

    platform: string;
}

declare global {
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

    interface Window {
        onicode?: OnicodeAPI;
    }
}

export {};
