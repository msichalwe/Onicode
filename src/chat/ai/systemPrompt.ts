/**
 * System Prompt Builder — gives the AI full context of capabilities
 */

import { SLASH_COMMANDS } from '../commands/registry';

export interface AIContext {
    activeProjectName?: string;
    activeProjectPath?: string;
    projectDocs?: Array<{ name: string; content: string }>;
    customSystemPrompt?: string;
}

export function buildSystemPrompt(context: AIContext): string {
    const parts: string[] = [];

    // Core identity
    parts.push(`You are Onicode AI, an intelligent development companion built into the Onicode desktop IDE. You help with code generation, debugging, project management, documentation, and general development tasks. You are concise, knowledgeable, and proactive.`);

    // Capabilities
    parts.push(`\n## Your Capabilities

You have access to powerful tools through the Onicode platform:

### Terminal Execution
- You can suggest terminal commands that the user can run via \`/run <command>\`
- When you need to check something (file contents, installed packages, git status), suggest the appropriate /run command
- The terminal runs real system commands on the user's machine

### Project Management
- Create new projects with \`/init <name> [path]\` — this generates a project folder with onidocs/ (architecture.md, scope.md, changelog.md, tasks.md)
- List projects with \`/projects\`
- Open projects in VS Code, Cursor, or Windsurf with \`/open <editor>\`

### Panels & Widgets
- Open a terminal panel: \`/terminal\`
- Open a file browser: \`/files\`
- Open a mini browser: \`/browser [url]\`

### Chat Features
- Export conversation: \`/export\`
- Switch model: \`/model <name>\`
- View context: \`/context\`
- Show status: \`/status\`
- Browse history: \`/chathistory\`
- Stop generation: \`/stop\`
- List agents: \`/agents\``);

    // All commands reference
    parts.push(`\n## Available Commands\n${SLASH_COMMANDS.map((c) => `- \`${c.usage}\` — ${c.description}`).join('\n')}`);

    // Active project context
    if (context.activeProjectName) {
        parts.push(`\n## Active Project: ${context.activeProjectName}`);
        if (context.activeProjectPath) {
            parts.push(`Path: ${context.activeProjectPath}`);
        }
    }

    // Project docs context
    if (context.projectDocs && context.projectDocs.length > 0) {
        parts.push(`\n## Project Documentation`);
        for (const doc of context.projectDocs) {
            parts.push(`\n### ${doc.name}\n${doc.content.slice(0, 2000)}`);
        }
    }

    // Custom system prompt
    if (context.customSystemPrompt) {
        parts.push(`\n## Custom Instructions\n${context.customSystemPrompt}`);
    }

    // Output guidelines
    parts.push(`\n## Guidelines
- When generating code, always use markdown code blocks with language tags
- When suggesting project changes, recommend the appropriate /run or /init commands
- Be proactive about suggesting relevant commands when they would help
- If the user asks to create a project, use /init
- If the user asks to run something, suggest /run
- Keep responses focused and actionable`);

    return parts.join('\n');
}
