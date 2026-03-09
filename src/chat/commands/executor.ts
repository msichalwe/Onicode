/**
 * Command Executor — handles slash command execution
 */

import { SLASH_COMMANDS, getCommandsByCategory } from './registry';
import type { Message } from '../components/ChatView';
import { requestPanel } from '../components/ChatView';

const isElectron = typeof window !== 'undefined' && !!window.onicode;

export interface CommandContext {
    messages: Message[];
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    newChat: () => void;
    stopGeneration: () => void;
    setShowHistory: (show: boolean) => void;
    activeConvId: string | null;
}

export interface CommandResult {
    handled: boolean;
}

function generateId() {
    return Math.random().toString(36).substring(2, 12);
}

function addAIMessage(ctx: CommandContext, content: string) {
    ctx.setMessages((prev) => [...prev, {
        id: generateId(),
        role: 'ai' as const,
        content,
        timestamp: Date.now(),
    }]);
}

export async function executeCommand(input: string, ctx: CommandContext): Promise<CommandResult> {
    const parts = input.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (command) {
        // ── Chat ──
        case '/new':
        case '/clear':
            ctx.newChat();
            return { handled: true };

        case '/chathistory':
        case '/history':
            ctx.setShowHistory(true);
            return { handled: true };

        case '/export': {
            const md = ctx.messages.map((m) =>
                `### ${m.role === 'user' ? 'You' : 'Onicode AI'}\n${m.content}`
            ).join('\n\n---\n\n');
            const blob = new Blob([md], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'onicode-chat.md';
            a.click();
            URL.revokeObjectURL(url);
            addAIMessage(ctx, 'Conversation exported as markdown.');
            return { handled: true };
        }

        // ── AI ──
        case '/model':
            if (args) {
                try {
                    const saved = localStorage.getItem('onicode-providers');
                    if (saved) {
                        const providers = JSON.parse(saved);
                        const active = providers.find((p: { enabled: boolean; connected: boolean }) => p.enabled && p.connected);
                        if (active) {
                            active.selectedModel = args;
                            localStorage.setItem('onicode-providers', JSON.stringify(providers));
                            addAIMessage(ctx, `Model switched to **${args}**`);
                        } else {
                            addAIMessage(ctx, 'No active provider. Go to **Settings** to connect one.');
                        }
                    }
                } catch {
                    addAIMessage(ctx, 'Failed to switch model.');
                }
            } else {
                addAIMessage(ctx, 'Usage: `/model <name>` — e.g. `/model gpt-4o`\n\nAvailable models depend on your connected provider.');
            }
            return { handled: true };

        case '/stop':
            ctx.stopGeneration();
            addAIMessage(ctx, 'Generation stopped.');
            return { handled: true };

        case '/context': {
            let modelName = 'Unknown';
            let providerName = 'None';
            try {
                const saved = localStorage.getItem('onicode-providers');
                if (saved) {
                    const providers = JSON.parse(saved);
                    const active = providers.find((p: { enabled: boolean; connected: boolean }) => p.enabled && p.connected);
                    if (active) {
                        providerName = active.name || active.id;
                        modelName = active.selectedModel || 'default';
                    }
                }
            } catch {}

            const contextInfo = [
                `**Provider:** ${providerName}`,
                `**Model:** ${modelName}`,
                `**Messages in chat:** ${ctx.messages.length}`,
                `**Environment:** ${isElectron ? 'Electron (Desktop)' : 'Browser'}`,
            ].join('\n');
            addAIMessage(ctx, `Current AI Context:\n\n${contextInfo}`);
            return { handled: true };
        }

        case '/agents': {
            const agentsInfo = [
                '**Available AI Agents:**\n',
                '**Core Agent** — General-purpose assistant with full command access',
                '- Can execute terminal commands via `/run`',
                '- Can create and manage projects via `/init`',
                '- Has context of all files and docs in active project',
                '- Can open panels (terminal, browser, files)',
                '',
                '**Code Agent** *(coming soon)* — Specialized for code generation and review',
                '**Doc Agent** *(coming soon)* — Specialized for documentation writing',
                '**Debug Agent** *(coming soon)* — Specialized for debugging and error analysis',
            ].join('\n');
            addAIMessage(ctx, agentsInfo);
            return { handled: true };
        }

        case '/system':
            if (args) {
                localStorage.setItem('onicode-custom-system-prompt', args);
                addAIMessage(ctx, 'Custom system prompt set. It will be included in future messages.');
            } else {
                const current = localStorage.getItem('onicode-custom-system-prompt');
                if (current) {
                    addAIMessage(ctx, `Current custom system prompt:\n\n> ${current}\n\nUse \`/system <prompt>\` to change or \`/system clear\` to remove.`);
                } else {
                    addAIMessage(ctx, 'No custom system prompt set. Use `/system <prompt>` to set one.');
                }
            }
            if (args === 'clear') {
                localStorage.removeItem('onicode-custom-system-prompt');
                addAIMessage(ctx, 'Custom system prompt cleared.');
            }
            return { handled: true };

        // ── Project ──
        case '/init': {
            if (!args) {
                addAIMessage(ctx, 'Usage: `/init <project-name> [path]`\n\nExample: `/init my-app ~/Projects`\n\nThis creates a project folder with onidocs (architecture.md, scope.md, changelog.md, tasks.md).');
                return { handled: true };
            }

            const initParts = args.split(/\s+/);
            const projectName = initParts[0];
            const projectPath = initParts[1] || '~/Projects';
            const expandedPath = projectPath.replace(/^~/, process.env?.HOME || '/Users');

            if (isElectron) {
                addAIMessage(ctx, `Creating project **${projectName}**...`);
                const result = await window.onicode!.initProject({
                    name: projectName,
                    projectPath: expandedPath,
                });

                if (result.success && result.project) {
                    addAIMessage(ctx, [
                        `Project **${projectName}** created successfully!\n`,
                        `**Path:** \`${result.project.path}\`\n`,
                        '**Generated files:**',
                        '- `onidocs/architecture.md`',
                        '- `onidocs/scope.md`',
                        '- `onidocs/changelog.md`',
                        '- `onidocs/tasks.md`',
                        '- `README.md`',
                        '',
                        'View it in the **Projects** tab or use `/open vscode` to open in VS Code.',
                    ].join('\n'));
                } else {
                    addAIMessage(ctx, `Failed to create project: ${result.error}`);
                }
            } else {
                addAIMessage(ctx, 'Project creation requires the Electron desktop app.');
            }
            return { handled: true };
        }

        case '/projects': {
            if (isElectron) {
                const result = await window.onicode!.listProjects();
                if (result.projects.length === 0) {
                    addAIMessage(ctx, 'No projects yet. Use `/init <name>` to create one.');
                } else {
                    const list = result.projects.map((p) =>
                        `- **${p.name}** — \`${p.path}\` *(${new Date(p.createdAt).toLocaleDateString()})*`
                    ).join('\n');
                    addAIMessage(ctx, `**Your Projects:**\n\n${list}\n\nOpen the **Projects** tab to manage them.`);
                }
            } else {
                addAIMessage(ctx, 'Projects require the Electron desktop app.');
            }
            return { handled: true };
        }

        case '/open': {
            const editor = args || 'vscode';
            if (isElectron) {
                // Get active project path from localStorage or use home
                const projectsResult = await window.onicode!.listProjects();
                const firstProject = projectsResult.projects[0];
                if (firstProject) {
                    const result = await window.onicode!.openProjectIn(firstProject.path, editor);
                    if (result.success) {
                        addAIMessage(ctx, `Opened **${firstProject.name}** in ${editor}`);
                    } else {
                        addAIMessage(ctx, `Failed to open: ${result.error}\n\nMake sure \`${editor}\` CLI is installed.`);
                    }
                } else {
                    addAIMessage(ctx, 'No projects to open. Use `/init <name>` to create one first.');
                }
            }
            return { handled: true };
        }

        case '/status': {
            const statusLines = ['**System Status:**\n'];

            // Provider
            try {
                const saved = localStorage.getItem('onicode-providers');
                if (saved) {
                    const providers = JSON.parse(saved);
                    const active = providers.find((p: { enabled: boolean; connected: boolean }) => p.enabled && p.connected);
                    statusLines.push(`**AI Provider:** ${active ? (active.name + ' (' + (active.selectedModel || 'default') + ')') : 'Not connected'}`);
                }
            } catch {}

            // Projects
            if (isElectron) {
                const { projects } = await window.onicode!.listProjects();
                statusLines.push(`**Projects:** ${projects.length}`);
            }

            // Chat
            statusLines.push(`**Messages in chat:** ${ctx.messages.length}`);
            statusLines.push(`**Environment:** ${isElectron ? 'Electron Desktop' : 'Browser'}`);

            addAIMessage(ctx, statusLines.join('\n'));
            return { handled: true };
        }

        // ── Terminal ──
        case '/run': {
            if (!args) {
                addAIMessage(ctx, 'Usage: `/run <command>`\n\nExample: `/run ls -la`');
                return { handled: true };
            }

            requestPanel('terminal');

            if (isElectron) {
                addAIMessage(ctx, `Running: \`${args}\``);
                const result = await window.onicode!.terminalExec(args);
                const output = result.stdout || result.stderr || '(no output)';
                addAIMessage(ctx, `\`\`\`\n${output.trim()}\n\`\`\`\n\n${result.success ? 'Command completed successfully.' : `Exited with code ${result.code}`}`);
            } else {
                addAIMessage(ctx, 'Terminal requires the Electron desktop app.');
            }
            return { handled: true };
        }

        case '/terminal':
            requestPanel('terminal');
            return { handled: true };

        // ── Panels ──
        case '/browser':
            requestPanel('browser', args ? { url: args } : undefined);
            return { handled: true };

        case '/files':
            requestPanel('files', args ? { path: args } : undefined);
            return { handled: true };

        // ── System ──
        case '/help': {
            const categories = ['chat', 'ai', 'project', 'terminal', 'panel', 'system'] as const;
            const sections = categories.map((cat) => {
                const cmds = getCommandsByCategory(cat);
                const label = cat.charAt(0).toUpperCase() + cat.slice(1);
                return `**${label}**\n${cmds.map((c) => `\`${c.usage}\` — ${c.description}`).join('\n')}`;
            });
            addAIMessage(ctx, `**Onicode Commands**\n\n${sections.join('\n\n')}`);
            return { handled: true };
        }

        case '/version':
            addAIMessage(ctx, `**Onicode** v0.1.0\nElectron desktop AI development environment`);
            return { handled: true };

        default:
            return { handled: false };
    }
}
