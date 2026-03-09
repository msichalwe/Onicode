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
    listProjects: () => Promise<{ projects: ProjectMeta[] }>;
    getProject: (projectId: string) => Promise<{ project?: ProjectMeta; docs?: ProjectDoc[]; error?: string }>;
    deleteProject: (projectId: string) => Promise<{ success: boolean }>;
    openProjectIn: (projectPath: string, editor: string) => Promise<{ success?: boolean; error?: string }>;

    // File System
    readDir: (dirPath: string, maxDepth?: number) => Promise<{ success?: boolean; tree?: FileTreeItem[]; error?: string }>;
    readFile: (filePath: string) => Promise<{ success?: boolean; content?: string; error?: string }>;
    writeFile: (filePath: string, content: string) => Promise<{ success?: boolean; error?: string }>;

    platform: string;
}

declare global {
    interface Window {
        onicode?: OnicodeAPI;
    }
}

export {};
