/**
 * Slash Command Registry — all available commands in Onicode
 */

export interface SlashCommand {
    name: string;
    description: string;
    usage: string;
    category: 'chat' | 'project' | 'terminal' | 'panel' | 'ai' | 'system';
}

export const SLASH_COMMANDS: SlashCommand[] = [
    // ── Chat ──
    { name: '/new', description: 'Start a new conversation', usage: '/new', category: 'chat' },
    { name: '/clear', description: 'Clear current conversation', usage: '/clear', category: 'chat' },
    { name: '/chathistory', description: 'Browse all past conversations', usage: '/chathistory', category: 'chat' },
    { name: '/export', description: 'Export chat as markdown file', usage: '/export', category: 'chat' },

    // ── AI ──
    { name: '/model', description: 'Switch AI model', usage: '/model <name>', category: 'ai' },
    { name: '/system', description: 'Set custom system prompt', usage: '/system <prompt>', category: 'ai' },
    { name: '/context', description: 'Show current AI context (model, project, history)', usage: '/context', category: 'ai' },
    { name: '/stop', description: 'Stop current AI generation', usage: '/stop', category: 'ai' },
    { name: '/agents', description: 'List available AI agents and capabilities', usage: '/agents', category: 'ai' },

    // ── Project ──
    { name: '/init', description: 'Create a new project with onidocs', usage: '/init <name> [path]', category: 'project' },
    { name: '/projects', description: 'List all projects', usage: '/projects', category: 'project' },
    { name: '/open', description: 'Open project in external editor', usage: '/open <editor>', category: 'project' },
    { name: '/status', description: 'Show project and system status', usage: '/status', category: 'project' },

    // ── Terminal ──
    { name: '/run', description: 'Execute a command in AI terminal', usage: '/run <command>', category: 'terminal' },
    { name: '/terminal', description: 'Open terminal panel', usage: '/terminal', category: 'terminal' },

    // ── Panels ──
    { name: '/browser', description: 'Open browser panel', usage: '/browser [url]', category: 'panel' },
    { name: '/files', description: 'Open file viewer panel', usage: '/files [path]', category: 'panel' },

    // ── System ──
    { name: '/help', description: 'Show all available commands', usage: '/help', category: 'system' },
    { name: '/version', description: 'Show Onicode version info', usage: '/version', category: 'system' },
];

export function getCommandsByCategory(category: SlashCommand['category']): SlashCommand[] {
    return SLASH_COMMANDS.filter((c) => c.category === category);
}
