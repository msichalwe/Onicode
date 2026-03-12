/**
 * Slash Command Registry — all available commands in Onicode
 */

export interface SlashCommand {
    name: string;
    description: string;
    usage: string;
    category: 'chat' | 'project' | 'terminal' | 'panel' | 'ai' | 'system' | 'automation' | 'git' | 'memory';
}

export const SLASH_COMMANDS: SlashCommand[] = [
    // ── Chat ──
    { name: '/new', description: 'Start a new conversation', usage: '/new', category: 'chat' },
    { name: '/clear', description: 'Clear current conversation', usage: '/clear', category: 'chat' },
    { name: '/chathistory', description: 'Browse all past conversations', usage: '/chathistory', category: 'chat' },
    { name: '/export', description: 'Export chat as markdown file', usage: '/export', category: 'chat' },
    { name: '/compact', description: 'Compact conversation (summarize old messages)', usage: '/compact', category: 'chat' },
    { name: '/search', description: 'Search past conversations', usage: '/search <query>', category: 'chat' },

    // ── AI ──
    { name: '/model', description: 'Switch AI model', usage: '/model <name>', category: 'ai' },
    { name: '/thinklevel', description: 'Set thinking level (low, medium, high)', usage: '/thinklevel <level>', category: 'ai' },
    { name: '/system', description: 'Set custom system prompt', usage: '/system <prompt>', category: 'ai' },
    { name: '/context', description: 'Show current AI context (model, project, history)', usage: '/context', category: 'ai' },
    { name: '/stop', description: 'Stop current AI generation', usage: '/stop', category: 'ai' },
    { name: '/agents', description: 'List active agents and orchestrations', usage: '/agents', category: 'ai' },
    { name: '/skills', description: 'Show enabled AI skills', usage: '/skills', category: 'ai' },
    { name: '/permission', description: 'Set agent permission mode (auto, ask, plan)', usage: '/permission <mode>', category: 'ai' },

    // ── Project ──
    { name: '/init', description: 'Create a new project with onidocs', usage: '/init <name> [path]', category: 'project' },
    { name: '/openproject', description: 'Open and scan an existing project folder', usage: '/openproject <path>', category: 'project' },
    { name: '/projects', description: 'List all projects', usage: '/projects', category: 'project' },
    { name: '/switch', description: 'Switch to a registered project', usage: '/switch <name>', category: 'project' },
    { name: '/open', description: 'Open project in external editor', usage: '/open <editor>', category: 'project' },
    { name: '/status', description: 'Show project and system status', usage: '/status', category: 'project' },
    { name: '/archive', description: 'Archive completed tasks in project', usage: '/archive', category: 'project' },
    { name: '/exitproject', description: 'Exit current project mode', usage: '/exitproject', category: 'project' },
    { name: '/index', description: 'Build/update code search index for project', usage: '/index', category: 'project' },

    // ── Git ──
    { name: '/git', description: 'Show git status for current project', usage: '/git [status|log|branches|diff]', category: 'git' },
    { name: '/commit', description: 'Stage all and commit with message', usage: '/commit <message>', category: 'git' },
    { name: '/push', description: 'Push to remote', usage: '/push', category: 'git' },
    { name: '/pull', description: 'Pull from remote', usage: '/pull', category: 'git' },
    { name: '/branch', description: 'Create or switch branch', usage: '/branch <name>', category: 'git' },
    { name: '/stash', description: 'Stash current changes', usage: '/stash [pop|list|drop]', category: 'git' },
    { name: '/pr', description: 'Create a GitHub pull request', usage: '/pr <title>', category: 'git' },

    // ── Terminal ──
    { name: '/run', description: 'Execute a command in AI terminal', usage: '/run <command>', category: 'terminal' },
    { name: '/terminal', description: 'Open terminal panel', usage: '/terminal', category: 'terminal' },

    // ── Panels ──
    { name: '/attachments', description: 'Open attachments panel', usage: '/attachments', category: 'panel' },
    { name: '/files', description: 'Open file viewer panel', usage: '/files [path]', category: 'panel' },
    { name: '/tasks', description: 'Open tasks panel', usage: '/tasks', category: 'panel' },
    { name: '/browser', description: 'Open browser panel', usage: '/browser [url]', category: 'panel' },
    { name: '/workflows', description: 'Open workflows panel', usage: '/workflows', category: 'panel' },
    { name: '/gitpanel', description: 'Open git panel', usage: '/gitpanel', category: 'panel' },

    // ── Automation ──
    { name: '/timer', description: 'Set a reminder timer', usage: '/timer <seconds> <message>', category: 'automation' },
    { name: '/schedule', description: 'Create a cron schedule', usage: '/schedule <cron> <action>', category: 'automation' },
    { name: '/workflow', description: 'Run a workflow by name or ID', usage: '/workflow <name|id>', category: 'automation' },
    { name: '/listschedules', description: 'List all active schedules', usage: '/listschedules', category: 'automation' },
    { name: '/listworkflows', description: 'List all workflows', usage: '/listworkflows', category: 'automation' },
    { name: '/heartbeat', description: 'Show heartbeat monitoring status', usage: '/heartbeat', category: 'automation' },

    // ── Memory ──
    { name: '/remember', description: 'Save a fact to memory', usage: '/remember <fact>', category: 'memory' },
    { name: '/recall', description: 'Search memory for a topic', usage: '/recall <query>', category: 'memory' },
    { name: '/memories', description: 'Open memories view', usage: '/memories', category: 'memory' },
    { name: '/forget', description: 'Delete a memory by filename', usage: '/forget <filename>', category: 'memory' },

    // ── System ──
    { name: '/help', description: 'Show all available commands', usage: '/help', category: 'system' },
    { name: '/version', description: 'Show Onicode version info', usage: '/version', category: 'system' },
    { name: '/settings', description: 'Open settings', usage: '/settings', category: 'system' },
    { name: '/logs', description: 'Show recent system logs', usage: '/logs [category]', category: 'system' },
    { name: '/env', description: 'Show environment info', usage: '/env', category: 'system' },
    { name: '/keys', description: 'Show API key vault status', usage: '/keys', category: 'system' },
    { name: '/mcp', description: 'Show MCP server status', usage: '/mcp', category: 'system' },
];

export function getCommandsByCategory(category: SlashCommand['category']): SlashCommand[] {
    return SLASH_COMMANDS.filter((c) => c.category === category);
}
