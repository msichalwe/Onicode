/**
 * Command Executor — handles slash command execution
 */

import { SLASH_COMMANDS, getCommandsByCategory } from './registry';
import type { Message } from '../components/ChatView';
import { isElectron, generateId, requestPanel } from '../utils';

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

function addAIMessage(ctx: CommandContext, content: string) {
    ctx.setMessages((prev) => [...prev, {
        id: generateId(),
        role: 'ai' as const,
        content,
        timestamp: Date.now(),
    }]);
}

function getActiveProjectPath(): { path: string; name: string; id: string } | null {
    try {
        const stored = localStorage.getItem('onicode-active-project');
        return stored ? JSON.parse(stored) : null;
    } catch { return null; }
}

export async function executeCommand(input: string, ctx: CommandContext): Promise<CommandResult> {
    const parts = input.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (command) {
        // ══════════════════════════════════════════
        //  Chat
        // ══════════════════════════════════════════

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

        case '/compact': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            addAIMessage(ctx, 'Compacting conversation...');
            const result = await window.onicode!.compactMessages(ctx.messages);
            if (result.compacted && result.summary) {
                addAIMessage(ctx, `Conversation compacted. ${result.summary.length > 0 ? 'Summary preserved.' : ''}`);
            } else {
                addAIMessage(ctx, 'Conversation too short to compact.');
            }
            return { handled: true };
        }

        case '/search': {
            if (!args) { addAIMessage(ctx, 'Usage: `/search <query>`\n\nSearch past conversations by keyword.'); return { handled: true }; }
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const res = await window.onicode!.conversationSearch(args);
            if (res.success && res.results && res.results.length > 0) {
                const list = res.results.slice(0, 10).map(r =>
                    `- **${r.title}** *(${new Date(r.updated_at).toLocaleDateString()})*`
                ).join('\n');
                addAIMessage(ctx, `**Search results for "${args}":**\n\n${list}`);
            } else {
                addAIMessage(ctx, `No conversations found for "${args}".`);
            }
            return { handled: true };
        }

        // ══════════════════════════════════════════
        //  Mode Switching
        // ══════════════════════════════════════════

        case '/switchmode': {
            const validModes = ['onichat', 'workmate', 'projects'];
            const target = args?.toLowerCase().trim();
            if (target && validModes.includes(target)) {
                window.dispatchEvent(new CustomEvent('onicode-mode-switch', { detail: target }));
                addAIMessage(ctx, `Switching to **${target}** mode...`);
                return { handled: true };
            }
            addAIMessage(ctx, `Usage: \`/switchmode <onichat|workmate|projects>\`\nCurrent mode: **${localStorage.getItem('onicode-mode') || 'onichat'}**`);
            return { handled: true };
        }

        // ══════════════════════════════════════════
        //  AI
        // ══════════════════════════════════════════

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
                try {
                    const saved = localStorage.getItem('onicode-providers');
                    if (saved) {
                        const providers = JSON.parse(saved);
                        const active = providers.find((p: { enabled: boolean; connected: boolean }) => p.enabled && p.connected);
                        if (active?.models?.length) {
                            const current = active.selectedModel || 'default';
                            const list = active.models.map((m: string) => `- \`${m}\`${m === current ? ' **(current)**' : ''}`).join('\n');
                            addAIMessage(ctx, `**Current model:** ${current}\n\n**Available models:**\n${list}\n\nUsage: \`/model <name>\``);
                        } else {
                            addAIMessage(ctx, 'Usage: `/model <name>` — e.g. `/model gpt-4o`');
                        }
                    }
                } catch {
                    addAIMessage(ctx, 'Usage: `/model <name>`');
                }
            }
            return { handled: true };

        case '/thinklevel': {
            const levels = ['low', 'medium', 'high'];
            if (args && levels.includes(args.toLowerCase())) {
                const level = args.toLowerCase();
                localStorage.setItem('onicode-thinking-level', level);
                addAIMessage(ctx, `Thinking level set to **${level}**${level === 'high' ? ' (extended thinking enabled for supported models)' : ''}`);
            } else {
                const current = localStorage.getItem('onicode-thinking-level') || 'medium';
                addAIMessage(ctx, `Current thinking level: **${current}**\n\nUsage: \`/thinklevel <low|medium|high>\`\n- **low** — faster, less reasoning\n- **medium** — balanced (default)\n- **high** — deep reasoning, extended thinking`);
            }
            return { handled: true };
        }

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

            const proj = getActiveProjectPath();
            const thinkLevel = localStorage.getItem('onicode-thinking-level') || 'medium';
            const permMode = localStorage.getItem('onicode-agent-mode') || 'auto-allow';

            const contextInfo = [
                `**Provider:** ${providerName}`,
                `**Model:** ${modelName}`,
                `**Thinking:** ${thinkLevel}`,
                `**Permission mode:** ${permMode}`,
                `**Messages in chat:** ${ctx.messages.length}`,
                proj ? `**Active project:** ${proj.name} (\`${proj.path}\`)` : '**Project:** None',
                `**Environment:** ${isElectron ? 'Electron (Desktop)' : 'Browser'}`,
            ].join('\n');
            addAIMessage(ctx, `**Current AI Context:**\n\n${contextInfo}`);
            return { handled: true };
        }

        case '/agents': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const [agentResult, orchResult] = await Promise.allSettled([
                window.onicode!.listAgents(),
                window.onicode!.orchestrationList(),
            ]);
            const lines: string[] = ['**Active Agents & Orchestrations:**\n'];
            if (agentResult.status === 'fulfilled' && agentResult.value.length > 0) {
                for (const a of agentResult.value) {
                    lines.push(`- **${a.role || 'Agent'}** [${a.status}] — ${a.task}`);
                }
            } else {
                lines.push('No active agents.');
            }
            if (orchResult.status === 'fulfilled' && orchResult.value.length > 0) {
                lines.push('\n**Orchestrations:**');
                for (const o of orchResult.value) {
                    lines.push(`- ${o.description} [${o.status}] — ${o.nodeCount} nodes`);
                }
            }
            addAIMessage(ctx, lines.join('\n'));
            return { handled: true };
        }

        case '/skills': {
            const saved = localStorage.getItem('onicode-skills');
            const states = saved ? JSON.parse(saved) : {};
            // Import skill names from defaults
            const skillNames = ['Code Review', 'Smart Refactor', 'Test Generator', 'Documentation', 'Debugger', 'Git Workflow', 'Performance', 'Security Audit', 'API Builder', 'Accessibility', 'CI/CD Setup', 'Database Design', 'Frontend Design', 'Web Research', 'Screenshot to Code', 'Responsive Layout', 'Animation & Motion', 'Fullstack Scaffold'];
            const skillIds = ['code-review', 'refactor', 'test-gen', 'doc-gen', 'debug', 'git-workflow', 'perf-optimize', 'security-audit', 'api-builder', 'accessibility', 'ci-cd', 'database', 'frontend-design', 'web-research', 'screenshot-to-code', 'responsive-layout', 'animation-design', 'fullstack-scaffold'];
            const lines = skillIds.map((id, i) => {
                const enabled = states[id] !== undefined ? states[id] : (i < 14); // first 14 enabled by default
                return `${enabled ? '**ON**' : 'OFF'} — ${skillNames[i]}`;
            });
            addAIMessage(ctx, `**AI Skills:**\n\n${lines.join('\n')}\n\nManage in **Settings > Skills**.`);
            return { handled: true };
        }

        case '/permission': {
            const modes = ['auto-allow', 'ask-destructive', 'plan-only'];
            if (args && modes.includes(args)) {
                if (isElectron) {
                    await window.onicode!.agentSetMode(args);
                }
                localStorage.setItem('onicode-agent-mode', args);
                addAIMessage(ctx, `Permission mode set to **${args}**`);
            } else {
                const current = localStorage.getItem('onicode-agent-mode') || 'auto-allow';
                addAIMessage(ctx, `Current mode: **${current}**\n\nUsage: \`/permission <mode>\`\n- **auto-allow** — all tools run automatically\n- **ask-destructive** — confirm before file writes, deletes, commands\n- **plan-only** — AI can only plan, you approve execution`);
            }
            return { handled: true };
        }

        case '/system':
            if (args === 'clear') {
                localStorage.removeItem('onicode-custom-system-prompt');
                addAIMessage(ctx, 'Custom system prompt cleared.');
            } else if (args) {
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
            return { handled: true };

        // ══════════════════════════════════════════
        //  Project
        // ══════════════════════════════════════════

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
                    projectPath,
                });

                if (result.success && result.project) {
                    addAIMessage(ctx, [
                        `Project **${projectName}** created!\n`,
                        `**Path:** \`${result.project.path}\`\n`,
                        '**Generated files:** architecture.md, scope.md, changelog.md, tasks.md, README.md\n',
                        'Use `/open vscode` to open in VS Code.',
                    ].join('\n'));

                    window.dispatchEvent(new CustomEvent('onicode-project-activate', {
                        detail: { id: result.project.id, name: result.project.name, path: result.project.path }
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
                addAIMessage(ctx, 'Usage: `/openproject <path>`\n\nExample: `/openproject ~/Projects/my-app`\n\nScans the folder, detects tech stack & git, creates onidocs if missing, and registers as a project.');
                return { handled: true };
            }

            if (isElectron) {
                addAIMessage(ctx, `Scanning **${args}**...`);
                const result = await window.onicode!.scanProject(args);

                if (result.success && result.scan) {
                    const s = result.scan;
                    const lines: string[] = [`## Project: **${s.name}**\n`];
                    lines.push(`**Path:** \`${s.path}\` · **Files:** ${s.fileCount}`);
                    if (s.detectedTech.length > 0) lines.push(`**Tech:** ${s.detectedTech.join(', ')}`);
                    if (s.hasGit) lines.push(`**Git:** \`${s.gitBranch}\``);
                    if (s.createdOnidocs) lines.push('**Created onidocs/** for this project.');
                    if (s.alreadyRegistered) lines.push('*Already registered.*');

                    addAIMessage(ctx, lines.join('\n'));

                    window.dispatchEvent(new CustomEvent('onicode-project-activate', {
                        detail: { id: s.projectId, name: s.name, path: s.path, gitBranch: s.hasGit ? s.gitBranch : undefined }
                    }));
                } else {
                    addAIMessage(ctx, `Failed to scan: ${result.error}`);
                }
            } else {
                addAIMessage(ctx, 'Requires Electron.');
            }
            return { handled: true };
        }

        case '/switch': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const projList = await window.onicode!.listProjects();
            if (!args) {
                if (projList.projects.length === 0) {
                    addAIMessage(ctx, 'No projects yet. Use `/init <name>` to create one.');
                } else {
                    const list = projList.projects.map((p) => `- \`/switch ${p.name}\` — ${p.path}`).join('\n');
                    addAIMessage(ctx, `Usage: \`/switch <project-name>\`\n\n**Available projects:**\n${list}`);
                }
                return { handled: true };
            }
            const query = args.toLowerCase().trim();
            const found = projList.projects.find((p) => {
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
            return { handled: true };
        }

        case '/projects': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const result = await window.onicode!.listProjects();
            if (result.projects.length === 0) {
                addAIMessage(ctx, 'No projects yet. Use `/init <name>` to create one or `/openproject <path>` to register an existing one.');
            } else {
                const list = result.projects.map((p) =>
                    `- **${p.name}** — \`${p.path}\` *(${new Date(p.createdAt).toLocaleDateString()})*`
                ).join('\n');
                addAIMessage(ctx, `**Your Projects (${result.projects.length}):**\n\n${list}`);
            }
            return { handled: true };
        }

        case '/open': {
            const editor = args || 'vscode';
            const proj = getActiveProjectPath();
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            if (!proj) { addAIMessage(ctx, 'No active project. Use `/switch <name>` first.'); return { handled: true }; }
            const result = await window.onicode!.openProjectIn(proj.path, editor);
            if (result.success) {
                addAIMessage(ctx, `Opened **${proj.name}** in ${editor}`);
            } else {
                addAIMessage(ctx, `Failed: ${result.error}\n\nSupported: vscode, cursor, windsurf, finder`);
            }
            return { handled: true };
        }

        case '/status': {
            const statusLines = ['**System Status:**\n'];
            try {
                const saved = localStorage.getItem('onicode-providers');
                if (saved) {
                    const providers = JSON.parse(saved);
                    const active = providers.find((p: { enabled: boolean; connected: boolean }) => p.enabled && p.connected);
                    statusLines.push(`**AI:** ${active ? (active.name || active.id) + ' (' + (active.selectedModel || 'default') + ')' : 'Not connected'}`);
                }
            } catch {}
            const proj = getActiveProjectPath();
            if (proj) statusLines.push(`**Project:** ${proj.name} (\`${proj.path}\`)`);
            if (isElectron) {
                const { projects } = await window.onicode!.listProjects();
                statusLines.push(`**Projects:** ${projects.length}`);
                try {
                    const tasks = await window.onicode!.tasksList();
                    statusLines.push(`**Tasks:** ${tasks.done}/${tasks.total} done, ${tasks.inProgress} in progress`);
                } catch {}
                try {
                    const memStats = await window.onicode!.memoryStats();
                    if (memStats.success) statusLines.push(`**Memories:** ${memStats.total}`);
                } catch {}
            }
            statusLines.push(`**Chat messages:** ${ctx.messages.length}`);
            statusLines.push(`**Mode:** ${localStorage.getItem('onicode-agent-mode') || 'auto-allow'}`);
            addAIMessage(ctx, statusLines.join('\n'));
            return { handled: true };
        }

        case '/archive': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const res = await window.onicode!.archiveCompletedTasks();
            addAIMessage(ctx, res.success ? 'Completed tasks archived.' : `Archive failed: ${res.error}`);
            return { handled: true };
        }

        case '/exitproject': {
            window.dispatchEvent(new CustomEvent('onicode-new-chat'));
            localStorage.removeItem('onicode-active-project');
            localStorage.setItem('onicode-chat-scope', 'general');
            addAIMessage(ctx, 'Exited project mode.');
            return { handled: true };
        }

        case '/index': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const proj2 = getActiveProjectPath();
            if (!proj2) { addAIMessage(ctx, 'No active project.'); return { handled: true }; }
            addAIMessage(ctx, 'Building code search index...');
            const indexResult = await window.onicode!.codeIndexBuild(proj2.path);
            addAIMessage(ctx, `Index built: **${indexResult.files} files**, ${indexResult.uniqueTokens} unique tokens.`);
            return { handled: true };
        }

        // ══════════════════════════════════════════
        //  Git
        // ══════════════════════════════════════════

        case '/git': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const proj3 = getActiveProjectPath();
            if (!proj3) { addAIMessage(ctx, 'No active project. Use `/switch <name>` first.'); return { handled: true }; }
            const subCmd = (args || 'status').toLowerCase();
            if (subCmd === 'status') {
                const res = await window.onicode!.gitStatus(proj3.path);
                if (res.success) {
                    const files = res.files || [];
                    const staged = files.filter(f => f.staged);
                    const unstaged = files.filter(f => !f.staged);
                    const lines = [`**Git Status** — \`${res.branch}\``];
                    if (res.ahead) lines.push(`↑ ${res.ahead} ahead`);
                    if (res.behind) lines.push(`↓ ${res.behind} behind`);
                    if (staged.length) lines.push(`\n**Staged (${staged.length}):**\n${staged.map(f => `- ${f.status} \`${f.path}\``).join('\n')}`);
                    if (unstaged.length) lines.push(`\n**Unstaged (${unstaged.length}):**\n${unstaged.map(f => `- ${f.status} \`${f.path}\``).join('\n')}`);
                    if (files.length === 0) lines.push('\nWorking tree clean.');
                    addAIMessage(ctx, lines.join('\n'));
                } else {
                    addAIMessage(ctx, `Git error: ${res.error}`);
                }
            } else if (subCmd === 'log') {
                const res = await window.onicode!.gitLog(proj3.path, 10);
                if (res.success && res.commits) {
                    const list = res.commits.map(c => `- \`${c.shortHash}\` ${c.message} *(${c.author})*`).join('\n');
                    addAIMessage(ctx, `**Recent Commits:**\n\n${list}`);
                } else {
                    addAIMessage(ctx, `Git log error: ${res.error}`);
                }
            } else if (subCmd === 'branches') {
                const res = await window.onicode!.gitBranches(proj3.path);
                if (res.success && res.branches) {
                    const list = res.branches.filter(b => !b.remote).map(b => `- ${b.current ? '**' : ''}\`${b.name}\`${b.current ? '** (current)' : ''}`).join('\n');
                    addAIMessage(ctx, `**Branches:**\n\n${list}`);
                } else {
                    addAIMessage(ctx, `Git branches error: ${res.error}`);
                }
            } else if (subCmd === 'diff' || subCmd.startsWith('diff')) {
                const res = await window.onicode!.gitDiff(proj3.path);
                if (res.success) {
                    addAIMessage(ctx, res.output ? `\`\`\`diff\n${res.output.slice(0, 3000)}\n\`\`\`` : 'No diff (clean).');
                } else {
                    addAIMessage(ctx, `Git diff error: ${res.error}`);
                }
            } else {
                addAIMessage(ctx, 'Usage: `/git [status|log|branches|diff]`');
            }
            return { handled: true };
        }

        case '/commit': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const proj4 = getActiveProjectPath();
            if (!proj4) { addAIMessage(ctx, 'No active project.'); return { handled: true }; }
            if (!args) { addAIMessage(ctx, 'Usage: `/commit <message>`'); return { handled: true }; }
            // Stage all, then commit
            await window.onicode!.gitStage(proj4.path, '.');
            const commitRes = await window.onicode!.gitCommit(proj4.path, args);
            addAIMessage(ctx, commitRes.success ? `Committed: **${args}**` : `Commit failed: ${commitRes.error}`);
            return { handled: true };
        }

        case '/push': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const proj5 = getActiveProjectPath();
            if (!proj5) { addAIMessage(ctx, 'No active project.'); return { handled: true }; }
            addAIMessage(ctx, 'Pushing...');
            const pushRes = await window.onicode!.gitPushAuth(proj5.path);
            addAIMessage(ctx, pushRes.success ? 'Push successful.' : `Push failed: ${pushRes.error}`);
            return { handled: true };
        }

        case '/pull': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const proj6 = getActiveProjectPath();
            if (!proj6) { addAIMessage(ctx, 'No active project.'); return { handled: true }; }
            addAIMessage(ctx, 'Pulling...');
            const pullRes = await window.onicode!.gitPullAuth(proj6.path);
            addAIMessage(ctx, pullRes.success ? `Pull successful.${pullRes.output ? '\n```\n' + pullRes.output + '\n```' : ''}` : `Pull failed: ${pullRes.error}`);
            return { handled: true };
        }

        case '/branch': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const proj7 = getActiveProjectPath();
            if (!proj7) { addAIMessage(ctx, 'No active project.'); return { handled: true }; }
            if (!args) {
                const brRes = await window.onicode!.gitBranches(proj7.path);
                if (brRes.success && brRes.branches) {
                    const list = brRes.branches.filter(b => !b.remote).map(b => `${b.current ? '**' : ''}\`${b.name}\`${b.current ? '** ← current' : ''}`).join(', ');
                    addAIMessage(ctx, `Branches: ${list}\n\nUsage: \`/branch <name>\` to create & switch`);
                }
                return { handled: true };
            }
            const checkoutRes = await window.onicode!.gitCheckout(proj7.path, args, true);
            addAIMessage(ctx, checkoutRes.success ? `Switched to branch **${args}**` : `Failed: ${checkoutRes.error}`);
            return { handled: true };
        }

        case '/stash': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const proj8 = getActiveProjectPath();
            if (!proj8) { addAIMessage(ctx, 'No active project.'); return { handled: true }; }
            const stashAction = args || 'push';
            if (stashAction === 'list') {
                const res = await window.onicode!.gitStash(proj8.path, 'list');
                addAIMessage(ctx, res.stashes?.length ? `**Stashes:**\n${res.stashes.join('\n')}` : 'No stashes.');
            } else if (stashAction === 'pop') {
                const res = await window.onicode!.gitStash(proj8.path, 'pop');
                addAIMessage(ctx, res.success ? 'Stash popped.' : `Failed: ${res.error}`);
            } else if (stashAction === 'drop') {
                const res = await window.onicode!.gitStash(proj8.path, 'drop');
                addAIMessage(ctx, res.success ? 'Stash dropped.' : `Failed: ${res.error}`);
            } else {
                const res = await window.onicode!.gitStash(proj8.path, 'push', args !== 'push' ? args : undefined);
                addAIMessage(ctx, res.success ? 'Changes stashed.' : `Failed: ${res.error}`);
            }
            return { handled: true };
        }

        case '/pr': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const proj9 = getActiveProjectPath();
            if (!proj9) { addAIMessage(ctx, 'No active project.'); return { handled: true }; }
            if (!args) { addAIMessage(ctx, 'Usage: `/pr <title>`\n\nCreates a GitHub PR from the current branch.'); return { handled: true }; }
            addAIMessage(ctx, 'Creating pull request...');
            const prRes = await window.onicode!.gitGithubCreatePR(proj9.path, args);
            if (prRes.success && prRes.pr) {
                addAIMessage(ctx, `PR #${prRes.pr.number} created: [${prRes.pr.title}](${prRes.pr.url})`);
            } else {
                addAIMessage(ctx, `PR creation failed: ${prRes.error}`);
            }
            return { handled: true };
        }

        // ══════════════════════════════════════════
        //  Terminal
        // ══════════════════════════════════════════

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
                addAIMessage(ctx, `\`\`\`\n${output.trim().slice(0, 3000)}\n\`\`\`\n\n${result.success ? 'Done.' : `Exit code ${result.code}`}`);
            } else {
                addAIMessage(ctx, 'Terminal requires Electron.');
            }
            return { handled: true };
        }

        case '/terminal':
            requestPanel('terminal');
            return { handled: true };

        // ══════════════════════════════════════════
        //  Panels
        // ══════════════════════════════════════════

        case '/attachments':
            requestPanel('attachments');
            return { handled: true };

        case '/files':
            requestPanel('files', args ? { path: args } : undefined);
            return { handled: true };

        case '/tasks':
            requestPanel('tasks');
            return { handled: true };

        case '/browser': {
            requestPanel('browser');
            if (args && isElectron) {
                // Navigate to URL
                await window.onicode!.browserLaunch();
                await window.onicode!.browserNavigate(args);
                addAIMessage(ctx, `Browser navigated to \`${args}\``);
            }
            return { handled: true };
        }

        case '/workflows':
            window.dispatchEvent(new CustomEvent('onicode-navigate', { detail: 'workflows' }));
            return { handled: true };

        case '/gitpanel':
            requestPanel('git');
            return { handled: true };

        // ══════════════════════════════════════════
        //  Automation
        // ══════════════════════════════════════════

        case '/timer': {
            if (!args) { addAIMessage(ctx, 'Usage: `/timer <seconds> <message>`\n\nExample: `/timer 300 Take a break!`'); return { handled: true }; }
            // Let the AI handle this by sending as a user message
            return { handled: false };
        }

        case '/schedule': {
            if (!args) { addAIMessage(ctx, 'Usage: `/schedule <cron> <action>`\n\nExample: `/schedule "0 9 * * *" check my email`\n\nThe AI will create the schedule for you.'); return { handled: true }; }
            return { handled: false }; // Let AI handle
        }

        case '/workflow': {
            if (!args) { addAIMessage(ctx, 'Usage: `/workflow <name|id>`\n\nRun a workflow by name or ID.'); return { handled: true }; }
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            // Try to find by name first
            const wfRes = await window.onicode!.workflowList();
            if (wfRes.success && wfRes.workflows) {
                const wf = wfRes.workflows.find(w => w.name.toLowerCase() === args.toLowerCase() || w.id === args);
                if (wf) {
                    addAIMessage(ctx, `Running workflow **${wf.name}**...`);
                    const runRes = await window.onicode!.workflowRun(wf.id);
                    addAIMessage(ctx, runRes.success
                        ? `Workflow completed in ${runRes.duration}ms.`
                        : `Workflow failed: ${runRes.error}`);
                } else {
                    addAIMessage(ctx, `Workflow "${args}" not found. Use \`/listworkflows\` to see available.`);
                }
            }
            return { handled: true };
        }

        case '/listschedules': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const schRes = await window.onicode!.schedulerList();
            if (schRes.success && schRes.schedules && schRes.schedules.length > 0) {
                const list = schRes.schedules.map(s =>
                    `- ${s.enabled ? '**ON**' : 'OFF'} **${s.name}** — \`${s.cron_expression}\`${s.next_run_at ? ` (next: ${new Date(s.next_run_at).toLocaleTimeString()})` : ''}`
                ).join('\n');
                addAIMessage(ctx, `**Schedules (${schRes.schedules.length}):**\n\n${list}`);
            } else {
                addAIMessage(ctx, 'No schedules. Ask the AI to create one, e.g. "run tests every hour".');
            }
            return { handled: true };
        }

        case '/listworkflows': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const wfListRes = await window.onicode!.workflowList();
            if (wfListRes.success && wfListRes.workflows && wfListRes.workflows.length > 0) {
                const list = wfListRes.workflows.map(w =>
                    `- **${w.name}** (\`${w.id}\`) — ${w.steps.length} steps${w.description ? ' — ' + w.description : ''}`
                ).join('\n');
                addAIMessage(ctx, `**Workflows (${wfListRes.workflows.length}):**\n\n${list}\n\nRun with \`/workflow <name>\``);
            } else {
                addAIMessage(ctx, 'No workflows. Ask the AI to create one, e.g. "create a workflow to check my email and summarize".');
            }
            return { handled: true };
        }

        case '/heartbeat': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const hbRes = await window.onicode!.heartbeatConfig();
            if (hbRes.success && hbRes.config) {
                const c = hbRes.config;
                const checks = c.checklist.map(ch => `- ${ch.enabled ? '**ON**' : 'OFF'} ${ch.name} (${ch.type})`).join('\n');
                addAIMessage(ctx, [
                    `**Heartbeat ${c.enabled ? 'Active' : 'Inactive'}**`,
                    `Interval: ${c.interval_minutes} min`,
                    `Quiet hours: ${c.quiet_hours_start}–${c.quiet_hours_end}`,
                    c.last_beat_at ? `Last beat: ${new Date(c.last_beat_at).toLocaleTimeString()}` : '',
                    checks ? `\n**Checks:**\n${checks}` : 'No checks configured.',
                ].filter(Boolean).join('\n'));
            } else {
                addAIMessage(ctx, 'Heartbeat not configured.');
            }
            return { handled: true };
        }

        // ══════════════════════════════════════════
        //  Memory
        // ══════════════════════════════════════════

        case '/remember': {
            if (!args) { addAIMessage(ctx, 'Usage: `/remember <fact>`\n\nSaves a fact to memory so the AI can recall it later.'); return { handled: true }; }
            // Let the AI handle this — it has the memory_save_fact tool
            return { handled: false };
        }

        case '/recall': {
            if (!args) { addAIMessage(ctx, 'Usage: `/recall <query>`\n\nSearch AI memory for relevant facts.'); return { handled: true }; }
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const memRes = await window.onicode!.memorySearch(args);
            if (memRes.success && memRes.results && memRes.results.length > 0) {
                const list = memRes.results.slice(0, 8).map(r =>
                    `- **${r.category}/${r.key}:** ${r.snippet || r.content?.slice(0, 100) || '...'}`
                ).join('\n');
                addAIMessage(ctx, `**Memory results for "${args}":**\n\n${list}`);
            } else {
                addAIMessage(ctx, `No memories found for "${args}".`);
            }
            return { handled: true };
        }

        case '/memories':
            // Switch to memories view
            window.dispatchEvent(new CustomEvent('onicode-panel', { detail: { type: 'memories' } }));
            return { handled: true };

        case '/forget': {
            if (!args) { addAIMessage(ctx, 'Usage: `/forget <filename>`\n\nDelete a memory file.'); return { handled: true }; }
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const delRes = await window.onicode!.memoryDelete(args);
            addAIMessage(ctx, delRes.success ? `Memory \`${args}\` deleted.` : `Failed: ${delRes.error}`);
            return { handled: true };
        }

        // ══════════════════════════════════════════
        //  System
        // ══════════════════════════════════════════

        case '/help': {
            const categories = ['chat', 'ai', 'project', 'git', 'terminal', 'panel', 'automation', 'memory', 'system'] as const;
            const sections = categories.map((cat) => {
                const cmds = getCommandsByCategory(cat);
                if (cmds.length === 0) return '';
                const label = cat.charAt(0).toUpperCase() + cat.slice(1);
                return `**${label}**\n${cmds.map((c) => `\`${c.usage}\` — ${c.description}`).join('\n')}`;
            }).filter(Boolean);
            addAIMessage(ctx, `**Onicode Commands (${SLASH_COMMANDS.length})**\n\n${sections.join('\n\n')}\n\nAlso: \`@\` to mention files/projects/tools.`);
            return { handled: true };
        }

        case '/version': {
            const lines = ['**Onicode** v0.2.0 — AI Development Environment'];
            if (isElectron) {
                try {
                    const env = await window.onicode!.getEnvironment();
                    lines.push(`Electron ${env.electronVersion} · Node ${env.nodeVersion}`);
                    lines.push(`${env.osType} ${env.osVersion} (${env.arch})`);
                } catch {}
            }
            addAIMessage(ctx, lines.join('\n'));
            return { handled: true };
        }

        case '/settings':
            // This triggers a view change via custom event
            window.dispatchEvent(new CustomEvent('onicode-panel', { detail: { type: 'settings' } }));
            return { handled: true };

        case '/logs': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const logRes = await window.onicode!.loggerGetRecent({ category: args || undefined, limit: 20 });
            if (logRes.success && logRes.entries.length > 0) {
                const list = logRes.entries.map(e =>
                    `\`${e.ts.slice(11, 19)}\` [${e.level}] **${e.category}:** ${e.message.slice(0, 120)}`
                ).join('\n');
                addAIMessage(ctx, `**Recent Logs${args ? ` (${args})` : ''}:**\n\n${list}`);
            } else {
                addAIMessage(ctx, 'No recent logs.');
            }
            return { handled: true };
        }

        case '/env': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const env = await window.onicode!.getEnvironment();
            addAIMessage(ctx, [
                '**Environment:**',
                `Platform: ${env.platform} (${env.arch})`,
                `OS: ${env.osType} ${env.osVersion}`,
                `Node: ${env.nodeVersion} · Electron: ${env.electronVersion}`,
                `Shell: ${env.shell}`,
                `User: ${env.username}@${env.hostname}`,
                `CPUs: ${env.cpus} · RAM: ${env.totalMemoryGB.toFixed(1)} GB`,
                `CWD: \`${env.cwd}\``,
            ].join('\n'));
            return { handled: true };
        }

        case '/keys': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const ksStatus = await window.onicode!.keystoreStatus();
            const ksList = await window.onicode!.keystoreList();
            addAIMessage(ctx, [
                '**Key Vault Status:**',
                `Encrypted: ${ksStatus.encrypted ? 'Yes' : 'No'} · SafeStorage: ${ksStatus.safeStorage ? 'Yes' : 'No'}`,
                `Keys stored: ${ksStatus.keyCount}`,
                ksList.keys.length > 0 ? '\n' + ksList.keys.map(k => `- **${k.name}** (${k.provider}) — ${k.maskedValue}`).join('\n') : '',
                '\nManage in **Settings > Connectors > Key Vault**.',
            ].filter(Boolean).join('\n'));
            return { handled: true };
        }

        case '/mcp': {
            if (!isElectron) { addAIMessage(ctx, 'Requires Electron.'); return { handled: true }; }
            const mcpRes = await window.onicode!.mcpListServers();
            if (mcpRes.servers.length === 0) {
                addAIMessage(ctx, 'No MCP servers configured. Add them in **Settings > MCP**.');
            } else {
                const list = mcpRes.servers.map(s =>
                    `- ${s.status === 'connected' ? '**ON**' : s.status === 'error' ? 'ERR' : 'OFF'} **${s.name}** — ${s.toolCount} tools${s.error ? ` (${s.error})` : ''}`
                ).join('\n');
                addAIMessage(ctx, `**MCP Servers (${mcpRes.servers.length}):**\n\n${list}`);
            }
            return { handled: true };
        }

        default: {
            // Try custom commands (loaded from .onicode/commands/*.md)
            if (command.startsWith('/') && isElectron) {
                try {
                    const projStr = localStorage.getItem('onicode-active-project');
                    const projPath = projStr ? JSON.parse(projStr).path : undefined;
                    const cmds = await window.onicode!.customCommandsList(projPath);
                    const customCmd = cmds.find((c: CustomCommand) => `/${c.name}` === command);
                    if (customCmd) {
                        const expandedPrompt = customCmd.prompt.replace(/\$ARGUMENTS/g, args || '');
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
