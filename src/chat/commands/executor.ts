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
            const projectPath = initParts[1] || '~/OniProjects';

            if (isElectron) {
                addAIMessage(ctx, `Creating project **${projectName}**...`);
                const result = await window.onicode!.initProject({
                    name: projectName,
                    projectPath,  // ~ expansion handled in main process
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

                    // Activate project mode
                    window.dispatchEvent(new CustomEvent('onicode-project-activate', {
                        detail: {
                            id: result.project.id,
                            name: result.project.name,
                            path: result.project.path,
                        }
                    }));
                } else {
                    addAIMessage(ctx, `Failed to create project: ${result.error}`);
                }
            } else {
                addAIMessage(ctx, 'Project creation requires the Electron desktop app.');
            }
            return { handled: true };
        }

        case '/openproject': {
            if (!args) {
                addAIMessage(ctx, 'Usage: `/openproject <path>`\n\nExample: `/openproject ~/OniProjects/my-app`\n\nScans the folder, detects tech stack & git, creates `.onidocs/` if missing, and registers it as an Onicode project.');
                return { handled: true };
            }

            if (isElectron) {
                addAIMessage(ctx, `Scanning **${args}**...`);
                const result = await window.onicode!.scanProject(args);

                if (result.success && result.scan) {
                    const s = result.scan;
                    const lines: string[] = [];
                    lines.push(`## Project Scanned: **${s.name}**\n`);
                    lines.push(`**Path:** \`${s.path}\``);
                    lines.push(`**Files:** ${s.fileCount} top-level items`);

                    if (s.detectedTech.length > 0) {
                        lines.push(`**Tech Stack:** ${s.detectedTech.join(', ')}`);
                    }

                    if (s.hasGit) {
                        lines.push(`**Git:** Active (branch: \`${s.gitBranch}\`)`);
                    } else {
                        lines.push(`**Git:** Not initialized`);
                    }

                    if (s.createdOnidocs) {
                        lines.push(`\n**Created \`.onidocs/\`** with project.md, tasks.md, changelog.md`);
                    } else if (s.hasOnidocs) {
                        lines.push(`**Onidocs:** Already present`);
                    }

                    if (s.alreadyRegistered) {
                        lines.push(`\n*Project was already registered in Onicode.*`);
                    } else if (s.registered) {
                        lines.push(`\n**Registered** as Onicode project. View it in the **Projects** tab.`);
                    }

                    addAIMessage(ctx, lines.join('\n'));

                    // Activate project mode
                    window.dispatchEvent(new CustomEvent('onicode-project-activate', {
                        detail: {
                            id: s.projectId,
                            name: s.name,
                            path: s.path,
                            gitBranch: s.hasGit ? s.gitBranch : undefined,
                        }
                    }));
                } else {
                    addAIMessage(ctx, `Failed to scan project: ${result.error}`);
                }
            } else {
                addAIMessage(ctx, 'Project scanning requires the Electron desktop app.');
            }
            return { handled: true };
        }

        case '/switch': {
            if (!args) {
                if (isElectron) {
                    const result = await window.onicode!.listProjects();
                    if (result.projects.length === 0) {
                        addAIMessage(ctx, 'No projects yet. Use `/init <name>` to create one.');
                    } else {
                        const list = result.projects.map((p) =>
                            `- \`/switch ${p.name}\` — ${p.path}`
                        ).join('\n');
                        addAIMessage(ctx, `Usage: \`/switch <project-name>\`\n\n**Available projects:**\n${list}`);
                    }
                } else {
                    addAIMessage(ctx, 'Usage: `/switch <project-name>`');
                }
                return { handled: true };
            }

            if (isElectron) {
                const result = await window.onicode!.listProjects();
                const query = args.toLowerCase().trim();
                const found = result.projects.find((p) => {
                    const pName = p.name.toLowerCase();
                    return pName === query || pName.includes(query) || query.includes(pName);
                });
                if (found) {
                    window.dispatchEvent(new CustomEvent('onicode-project-activate', {
                        detail: { id: found.id, name: found.name, path: found.path },
                    }));
                    addAIMessage(ctx, `Switched to project **${found.name}** at \`${found.path}\``);
                } else {
                    addAIMessage(ctx, `Project "${args}" not found. Use \`/switch\` to see available projects.`);
                }
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

        case '/git':
            if (isElectron) {
                const subCmd = args || 'status';
                const projStr = localStorage.getItem('onicode-active-project');
                if (!projStr) {
                    addAIMessage(ctx, 'No active project. Open or create one first.');
                    return { handled: true };
                }
                const proj = JSON.parse(projStr);
                if (subCmd === 'status') {
                    const res = await window.onicode!.gitStatus(proj.path);
                    if (res.success) {
                        addAIMessage(ctx, `**Git Status** for ${proj.name}\n\n\`\`\`\n${JSON.stringify(res, null, 2)}\n\`\`\``);
                    } else {
                        addAIMessage(ctx, `Git error: ${res.error}`);
                    }
                }
            }
            return { handled: true };

        default: {
            // Try custom commands (loaded from .onicode/commands/*.md)
            if (command.startsWith('/') && isElectron) {
                try {
                    const projStr = localStorage.getItem('onicode-active-project');
                    const projPath = projStr ? JSON.parse(projStr).path : undefined;
                    const cmds = await window.onicode!.customCommandsList(projPath);
                    const customCmd = cmds.find((c: CustomCommand) => `/${c.name}` === command);
                    if (customCmd) {
                        // Replace $ARGUMENTS and return as unhandled so it gets sent to AI
                        const expandedPrompt = customCmd.prompt.replace(/\$ARGUMENTS/g, args || '');
                        // Add the expanded prompt as a user message that will be processed by AI
                        ctx.setMessages(prev => [...prev, {
                            id: Math.random().toString(36).substring(2, 12),
                            role: 'user' as const,
                            content: `[/${customCmd.name}] ${expandedPrompt}`,
                            timestamp: Date.now(),
                        }]);
                        return { handled: true };
                    }
                } catch { /* custom commands not available */ }
            }
            return { handled: false };
        }
    }
}
