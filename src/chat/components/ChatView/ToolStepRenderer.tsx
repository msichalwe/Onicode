import React from 'react';
import type { ToolStep, ToolStepRendererProps, GroupedStep } from './types';
import ScreenshotImage from './ScreenshotImage';

// ── Tool display label ──
export function toolIcon(name: string): string {
    const icons: Record<string, string> = {
        read_file: 'Read', edit_file: 'Edit', multi_edit: 'Edit', create_file: 'Created',
        delete_file: 'Deleted', list_directory: 'Listed', search_files: 'Searched',
        run_command: 'Ran', check_terminal: 'Terminal', list_terminals: 'Terminals',
        init_project: 'Init', task_add: 'Task', task_update: 'Task',
        task_list: 'Tasks', milestone_create: 'Milestone', browser_navigate: 'Browser', browser_screenshot: 'Screenshot',
        browser_evaluate: 'Browser JS', browser_click: 'Clicked', browser_type: 'Typed',
        browser_console_logs: 'Console', browser_close: 'Browser',
        orchestrate: 'Orchestration', spawn_specialist: 'Specialist',
        spawn_sub_agent: 'Sub-agent', get_agent_status: 'Agent',
        get_orchestration_status: 'Orchestration',
        glob_files: 'Found', explore_codebase: 'Explored', memory_write: 'Memory',
        memory_append: 'Memory', memory_search: 'Memory Search', memory_save_fact: 'Remembered',
        memory_smart_search: 'Smart Search', memory_get_related: 'Related Memories', memory_hot_list: 'Hot Memories',
        conversation_search: 'Recalled', conversation_recall: 'Loaded Context',
        webfetch: 'Fetched', websearch: 'Searched',
        get_context_summary: 'Context', get_system_logs: 'Logs', get_changelog: 'Changelog',
        git_commit: 'Committed', git_push: 'Pushed', git_status: 'Git Status',
        find_symbol: 'Def', find_references: 'Refs', list_symbols: 'Symbols',
        get_type_info: 'Type', semantic_search: 'Search', index_codebase: 'Index',
        git_diff: 'Diff', git_log: 'Log', git_branches: 'Branch',
        git_checkout: 'Checkout', git_stash: 'Stash', git_pull: 'Pull',
        git_stage: 'Staged', git_unstage: 'Unstaged', git_merge: 'Merged',
        git_reset: 'Reset', git_tag: 'Tag', git_remotes: 'Remotes', git_show: 'Show',
        find_implementation: 'Found', impact_analysis: 'Impact', prepare_edit_context: 'Context',
        smart_read: 'Smart Read', batch_search: 'Batch Search',
        verify_project: 'Verified',
        git_create_pr: 'PR Created', git_list_prs: 'PRs', git_publish: 'Published',
        gh_cli: 'GitHub', gws_cli: 'Workspace',
        ask_user_question: 'Question',
        sequential_thinking: 'Thinking',
        trajectory_search: 'History Search',
        find_by_name: 'Found Files',
        read_url_content: 'Web Fetch',
        view_content_chunk: 'Reading',
        read_notebook: 'Notebook',
        edit_notebook: 'Edit Notebook',
        read_deployment_config: 'Deploy Config',
        deploy_web_app: 'Deploying',
        check_deploy_status: 'Deploy Status',
        create_schedule: 'Scheduled', list_schedules: 'Schedules', delete_schedule: 'Unscheduled',
        set_timer: 'Timer Set',
        create_workflow: 'Workflow Created', run_workflow: 'Workflow Run', list_workflows: 'Workflows', delete_workflow: 'Workflow Deleted',
        configure_heartbeat: 'Heartbeat',
        ctx_execute: 'Executed', ctx_search: 'KB Search', ctx_index: 'Indexed',
        ctx_batch: 'Batch', ctx_stats: 'Context Stats', ctx_fetch: 'Fetched & Indexed',
        mcp_search: 'MCP Search',
        show_widget: 'Widget',
    };
    return icons[name] || name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Build rich detail from step result ──
function getDetail(step: ToolStep): string {
    const a = step.args;
    const r = step.result as Record<string, unknown> | undefined;

    switch (step.name) {
        case 'create_file': {
            const fname = String(a.file_path || '').split('/').pop();
            const lines = r?.lines ?? (typeof a.content === 'string' ? (a.content as string).split('\n').length : '?');
            return `${fname} (${lines} lines)`;
        }
        case 'edit_file': case 'multi_edit': {
            const fname = String(a.file_path || '').split('/').pop();
            const added = r?.lines_added ?? '?';
            const removed = r?.lines_removed ?? '?';
            return `${fname} (+${added} -${removed})`;
        }
        case 'read_file': {
            const fname = String(a.file_path || '').split('/').pop();
            const total = r?.total_lines ?? '';
            return `${fname}${total ? ` (${total} lines)` : ''}`;
        }
        case 'delete_file':
            return String(a.file_path || '').split('/').pop() || '';
        case 'run_command': {
            const cmd = String(a.command || '').slice(0, 80);
            const exit = r?.exitCode != null ? ` [exit ${r.exitCode}]` : '';
            const bg = r?.background ? ' (background)' : '';
            return `\`${cmd}\`${exit}${bg}`;
        }
        case 'init_project':
            return String(a.name || r?.project_name || '');
        case 'task_add':
            return String(a.content || '').slice(0, 60);
        case 'task_update': {
            const status = a.status || '';
            return `#${a.id} → ${status}`;
        }
        case 'task_list': {
            if (r && typeof r === 'object' && 'total' in r) return `${r.done}/${r.total} done`;
            return '';
        }
        case 'create_plan':
            return String(a.title || '').slice(0, 60);
        case 'update_plan':
            return String(a.title || a.status || 'updated').slice(0, 40);
        case 'get_plan': {
            if (r && typeof r === 'object' && 'plan' in r && r.plan) return String((r.plan as Record<string, unknown>).title || '');
            return 'No active plan';
        }
        case 'search_files': case 'websearch':
            return `"${String(a.query || '').slice(0, 50)}"`;
        case 'browser_navigate':
            return String(a.url || '').replace(/^https?:\/\//, '').slice(0, 50);
        case 'browser_screenshot': {
            return String(a.name || '');
        }
        case 'list_directory':
            return String(a.dir_path || '').split('/').pop() || '';
        case 'glob_files':
            return String(a.pattern || '');
        case 'explore_codebase':
            return String(a.project_path || '').split('/').pop() || '';
        case 'verify_project':
            return String(a.project_path || '').split('/').pop() || '';
        case 'spawn_sub_agent':
        case 'spawn_specialist':
            return String(a.task || '').slice(0, 60);
        case 'orchestrate':
            return String(a.description || '').slice(0, 60);
        case 'get_orchestration_status':
            return String(a.orchestration_id || '');
        case 'git_commit':
            return String(a.message || '').slice(0, 60);
        case 'git_push':
            return r?.success ? 'success' : '';
        case 'git_status': {
            const files = (r as Record<string, unknown>)?.files;
            return Array.isArray(files) ? `${files.length} changed` : '';
        }
        case 'find_symbol': {
            const sym = String(a.symbol || a.name || '');
            const loc = r?.file ? String(r.file).split('/').pop() : '';
            return loc ? `${sym} → ${loc}` : sym;
        }
        case 'find_references': {
            const sym = String(a.symbol || a.name || '');
            const refs = Array.isArray(r?.references) ? (r.references as unknown[]).length : r?.count ?? '?';
            return `${sym} (${refs} refs)`;
        }
        case 'list_symbols': {
            const fname = String(a.file_path || a.file || '').split('/').pop() || '';
            const count = Array.isArray(r?.symbols) ? (r.symbols as unknown[]).length : r?.count ?? '?';
            return `${fname} (${count} symbols)`;
        }
        case 'get_type_info': {
            const typeStr = String(r?.type || r?.type_string || a.symbol || '');
            return typeStr.slice(0, 80);
        }
        case 'semantic_search': {
            const query = String(a.query || '').slice(0, 40);
            const count = Array.isArray(r?.results) ? (r.results as unknown[]).length : r?.count ?? '?';
            return `"${query}" (${count} results)`;
        }
        case 'index_codebase': {
            const indexed = r?.files_indexed ?? r?.count ?? '?';
            return `${indexed} files indexed`;
        }
        case 'git_diff': {
            const files = Array.isArray(r?.files) ? (r.files as unknown[]).length : r?.file_count;
            return files ? `${files} files changed` : r?.summary ? String(r.summary).slice(0, 60) : 'no changes';
        }
        case 'git_log': {
            const commits = Array.isArray(r?.commits) ? (r.commits as unknown[]).length : r?.count ?? '?';
            return `${commits} commits`;
        }
        case 'git_branches': {
            const current = r?.current || r?.current_branch || '';
            return current ? `on ${current}` : '';
        }
        case 'git_checkout': {
            const branch = String(a.branch || r?.branch || '');
            const created = r?.created ? ' (new)' : '';
            return `${branch}${created}`;
        }
        case 'git_stash': {
            const action = String(a.action || a.command || 'push');
            return action;
        }
        case 'git_pull': {
            const ok = r?.success;
            const summary = r?.summary || r?.output;
            return ok ? (summary ? String(summary).slice(0, 60) : 'success') : 'failed';
        }
        case 'git_stage': {
            const files = Array.isArray(a.files) ? a.files as string[] : [];
            return files.length > 0 ? `${files.length} file(s)` : String(a.files || '.');
        }
        case 'git_unstage': {
            const files = Array.isArray(a.files) ? a.files as string[] : [];
            return files.length > 0 ? `${files.length} file(s)` : '';
        }
        case 'git_merge': {
            const branch = String(a.branch || '');
            const ok = r?.success;
            const conflicts = r?.conflicts;
            return conflicts ? `${branch} (conflicts!)` : ok ? branch : `${branch} (failed)`;
        }
        case 'git_reset': {
            const mode = String(a.mode || 'mixed');
            const target = a.target ? String(a.target).slice(0, 10) : 'HEAD';
            return `--${mode} ${target}`;
        }
        case 'git_tag': {
            const action = String(a.action || 'list');
            if (action === 'list') {
                const tags = Array.isArray(r?.tags) ? (r.tags as unknown[]).length : '?';
                return `${tags} tags`;
            }
            return `${action} ${a.name || ''}`;
        }
        case 'git_remotes': {
            const remotes = Array.isArray(r?.remotes) ? (r.remotes as unknown[]).length : '?';
            return `${remotes} remote(s)`;
        }
        case 'git_show': {
            const ref = String(a.ref || r?.hash || 'HEAD').slice(0, 10);
            return ref;
        }
        case 'find_implementation': {
            const desc = String(a.description || '').slice(0, 50);
            const total = r?.total ?? '?';
            return `"${desc}" (${total} results)`;
        }
        case 'impact_analysis': {
            const fname = String(a.file_path || '').split('/').pop();
            return r?.impactSummary ? `${fname}: ${r.impactSummary}` : fname || '';
        }
        case 'prepare_edit_context': {
            const fname = String(a.file_path || '').split('/').pop();
            const outline = Array.isArray(r?.outline) ? (r.outline as unknown[]).length : '?';
            return `${fname} (${outline} symbols)`;
        }
        case 'smart_read': {
            const fname = String(a.file_path || '').split('/').pop();
            const mode = r?.mode || '';
            return `${fname} [${mode}]`;
        }
        case 'batch_search': {
            const total = r?.total ?? '?';
            const qCount = Array.isArray(a.queries) ? (a.queries as unknown[]).length : '?';
            return `${qCount} queries → ${total} results`;
        }
        case 'ask_user_question': {
            const answer = r?.answer;
            return answer ? `→ ${String(answer).slice(0, 60)}` : '(waiting...)';
        }
        case 'sequential_thinking': {
            const num = a.thought_number ?? '?';
            const total = a.total_thoughts ?? '?';
            const isRev = a.is_revision ? ' (revision)' : '';
            const branch = a.branch_id ? ` [${a.branch_id}]` : '';
            return `Step ${num}/${total}${isRev}${branch}`;
        }
        case 'trajectory_search': {
            const total = r?.total ?? '?';
            return `"${String(a.query || '').slice(0, 40)}" (${total} results)`;
        }
        case 'find_by_name': {
            const total = r?.total ?? '?';
            return `"${String(a.pattern || '')}" (${total} found)`;
        }
        case 'read_url_content': {
            const url = String(a.url || '');
            const domain = url.replace(/^https?:\/\//, '').split('/')[0];
            const chunks = r?.total_chunks ?? '?';
            return `${domain} (${chunks} chunks)`;
        }
        case 'view_content_chunk': {
            const pos = a.position ?? '?';
            const total = r?.total_chunks ?? '?';
            return `Chunk ${pos}/${total}`;
        }
        case 'read_notebook': {
            const fname = String(a.file_path || '').split('/').pop();
            const cells = r?.total_cells ?? '?';
            return `${fname} (${cells} cells)`;
        }
        case 'edit_notebook': {
            const fname = String(a.file_path || '').split('/').pop();
            const mode = a.edit_mode || 'replace';
            return `${fname} (${mode} cell ${a.cell_number ?? 0})`;
        }
        case 'read_deployment_config': {
            const framework = r?.framework ?? 'unknown';
            const ready = r?.ready ? 'ready' : 'not ready';
            return `${framework} — ${ready}`;
        }
        case 'deploy_web_app': {
            const provider = a.provider || 'netlify';
            const url = r?.url ? String(r.url) : 'deploying...';
            return `${provider}: ${url}`;
        }
        case 'check_deploy_status': {
            const status = r?.status ?? 'checking';
            return `Status: ${status}`;
        }
        case 'gh_cli': {
            const cmd = String(a.command || '').slice(0, 60);
            const ok = r?.success;
            return ok ? `gh ${cmd}` : `gh ${cmd} (failed)`;
        }
        case 'gws_cli': {
            const cmd = String(a.command || '').slice(0, 60);
            const ok = r?.success;
            return ok ? `gws ${cmd}` : `gws ${cmd} (failed)`;
        }
        case 'memory_search': {
            const q = String(a.query || '').slice(0, 40);
            const total = r?.totalResults ?? r?.totalMatches ?? '?';
            return `"${q}" (${total} results)`;
        }
        case 'memory_save_fact': {
            const factText = String(a.fact || '').slice(0, 60);
            const cat = String(a.category || 'general');
            return `[${cat}] ${factText}`;
        }
        case 'memory_smart_search': {
            const sq = String(a.query || '').slice(0, 40);
            const sTotal = r?.totalResults ?? '?';
            return `"${sq}" (${sTotal} results, hotness-ranked)`;
        }
        case 'memory_get_related': {
            const rTotal = r?.totalRelated ?? '?';
            return `memory #${a.memory_id} → ${rTotal} related`;
        }
        case 'memory_hot_list': {
            const hCat = String(a.category || 'all');
            const hTotal = r?.total ?? '?';
            return `${hCat} (${hTotal} memories)`;
        }
        case 'conversation_search': {
            const cq = String(a.query || '').slice(0, 40);
            const cTotal = r?.totalResults ?? '?';
            return `"${cq}" (${cTotal} conversations)`;
        }
        case 'conversation_recall': {
            const cConv = r?.conversation as Record<string, unknown> | undefined;
            const cTitle = String(cConv?.title || 'past conversation');
            return cTitle.slice(0, 60);
        }
        case 'create_schedule': {
            const sName = String(a.name || '');
            const sCron = String(a.cron || '');
            const sType = a.one_time ? 'one-time' : 'recurring';
            return `"${sName}" (${sCron}, ${sType})`;
        }
        case 'list_schedules': {
            const sCount = (r as Record<string, unknown>)?.schedules;
            return `${Array.isArray(sCount) ? sCount.length : '?'} schedule(s)`;
        }
        case 'create_workflow': {
            const wName = String(a.name || '');
            const wSteps = Array.isArray(a.steps) ? a.steps.length : '?';
            return `"${wName}" (${wSteps} steps)`;
        }
        case 'run_workflow': {
            const wStatus = String(r?.status || 'running');
            const wDur = r?.duration ? `${r.duration}ms` : '';
            return `${wStatus} ${wDur}`.trim();
        }
        case 'list_workflows': {
            const wCount = (r as Record<string, unknown>)?.workflows;
            return `${Array.isArray(wCount) ? wCount.length : '?'} workflow(s)`;
        }
        case 'set_timer': {
            const tMsg = String(a.message || '');
            const tSec = String(a.seconds || '');
            return `"${tMsg}" (${tSec}s)`;
        }
        case 'configure_heartbeat': {
            const hEnabled = (r as Record<string, unknown>)?.current_config as Record<string, unknown> | undefined;
            return hEnabled?.enabled ? 'Enabled' : 'Updated';
        }
        case 'ctx_execute': {
            const lang = (a as Record<string, unknown>)?.language || 'shell';
            const savings = (r as Record<string, unknown>)?.context_savings;
            return savings ? `${lang} (${savings})` : `${lang}`;
        }
        case 'ctx_search': {
            const queries = (a as Record<string, unknown>)?.queries as string[] | undefined;
            const total = (r as Record<string, unknown>)?.total_results;
            return queries ? `"${queries[0]}"${queries.length > 1 ? ` +${queries.length - 1}` : ''} → ${total || 0} results` : '';
        }
        case 'ctx_index': {
            const src = (a as Record<string, unknown>)?.source || (a as Record<string, unknown>)?.path || 'content';
            const chunks = (r as Record<string, unknown>)?.chunk_count;
            return `${src} (${chunks || 0} chunks)`;
        }
        case 'ctx_batch': {
            const cmds = ((a as Record<string, unknown>)?.commands as unknown[])?.length || 0;
            const qs = ((a as Record<string, unknown>)?.queries as unknown[])?.length || 0;
            return `${cmds} commands, ${qs} queries`;
        }
        case 'ctx_stats': {
            const cs = (r as Record<string, unknown>)?.context_savings as Record<string, unknown> | undefined;
            return cs ? `${cs.savings_ratio} saved (${cs.bytes_saved} bytes)` : '';
        }
        case 'ctx_fetch': {
            const fetchUrl = (a as Record<string, unknown>)?.url as string || '';
            const indexed = (r as Record<string, unknown>)?.chunks_indexed;
            return `${fetchUrl.slice(0, 50)} → ${indexed || 0} chunks`;
        }
        case 'mcp_search': {
            const mcpQ = (a as Record<string, unknown>)?.query as string || '';
            const mcpFound = (r as Record<string, unknown>)?.found as number || 0;
            return `"${mcpQ}" → ${mcpFound} server${mcpFound !== 1 ? 's' : ''}`;
        }
        default:
            return '';
    }
}

// ── Check if a step has expandable content ──
function hasExpandableContent(step: ToolStep): boolean {
    if (step.status !== 'done' || !step.result) return false;
    const r = step.result as Record<string, unknown>;
    switch (step.name) {
        case 'run_command': return !!(r.stdout || r.stderr);
        case 'edit_file': case 'multi_edit': return true;
        case 'create_file': return true;
        case 'search_files': return !!(r.matches && Array.isArray(r.matches) && (r.matches as unknown[]).length > 0);
        case 'git_status': return !!(r.files && Array.isArray(r.files) && (r.files as unknown[]).length > 0);
        case 'find_references': return !!(r.references && Array.isArray(r.references) && (r.references as unknown[]).length > 0);
        case 'list_symbols': return !!(r.symbols && Array.isArray(r.symbols) && (r.symbols as unknown[]).length > 0);
        case 'semantic_search': return !!(r.results && Array.isArray(r.results) && (r.results as unknown[]).length > 0);
        case 'git_diff': return !!(r.diff || r.output);
        case 'git_log': return !!(r.commits && Array.isArray(r.commits) && (r.commits as unknown[]).length > 0);
        case 'git_branches': return !!(r.branches && Array.isArray(r.branches) && (r.branches as unknown[]).length > 0);
        case 'git_merge': return !!(r.output || r.conflicts);
        case 'git_show': return !!(r.diff || r.output || r.message);
        case 'git_tag': return !!(r.tags && Array.isArray(r.tags) && (r.tags as unknown[]).length > 0);
        case 'git_remotes': return !!(r.remotes && Array.isArray(r.remotes) && (r.remotes as unknown[]).length > 0);
        case 'orchestrate': return !!(r.summary || r.report);
        case 'spawn_specialist': return !!(r.result || r.content);
        case 'verify_project': return !!(r.issues || r.summary);
        case 'sequential_thinking': return true;
        case 'trajectory_search': return !!(r.results && Array.isArray(r.results) && (r.results as unknown[]).length > 0);
        case 'find_by_name': return !!(r.results && Array.isArray(r.results) && (r.results as unknown[]).length > 0);
        case 'read_url_content': return !!(r.first_chunk);
        case 'read_notebook': return !!(r.cells && Array.isArray(r.cells) && (r.cells as unknown[]).length > 0);
        case 'read_deployment_config': return true;
        case 'deploy_web_app': return !!(r.output || r.url);
        case 'gh_cli': return !!(r.output || r.data || r.error);
        case 'gws_cli': return !!(r.output || r.data || r.error);
        case 'memory_search': return !!(r.results && Array.isArray(r.results) && (r.results as unknown[]).length > 0);
        case 'conversation_search': return !!(r.results && Array.isArray(r.results) && (r.results as unknown[]).length > 0);
        case 'conversation_recall': return !!(r.context);
        case 'create_plan': return true;
        case 'get_plan': return !!(r.plan);
        case 'ctx_execute': return !!(r.stdout || r.stderr);
        case 'ctx_search': return !!(r.results && Array.isArray(r.results) && (r.results as unknown[]).length > 0);
        case 'ctx_index': return !!(r.indexed);
        case 'ctx_batch': return !!(r.executions || r.searches);
        case 'ctx_stats': return !!(r.context_savings);
        case 'ctx_fetch': return !!(r.preview);
        default: return false;
    }
}

// ── Render expandable content for a step ──
function renderExpandedContent(step: ToolStep) {
    const r = step.result as Record<string, unknown>;
    const a = step.args;

    switch (step.name) {
        case 'run_command': {
            const stdout = String(r.stdout || '').trim();
            const stderr = String(r.stderr || '').trim();
            const exitCode = r.exitCode as number | null;
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-terminal">
                        <div className="tool-step-terminal-header">
                            <span className="tool-step-terminal-prompt">$ {String(a.command || '').slice(0, 120)}</span>
                            {exitCode != null && (
                                <span className={`tool-step-exit-code ${exitCode === 0 ? 'success' : 'error'}`}>
                                    exit {exitCode}
                                </span>
                            )}
                        </div>
                        {stdout && <pre className="tool-step-stdout">{stdout.slice(0, 3000)}{stdout.length > 3000 ? '\n... (truncated)' : ''}</pre>}
                        {stderr && <pre className="tool-step-stderr">{stderr.slice(0, 1500)}{stderr.length > 1500 ? '\n... (truncated)' : ''}</pre>}
                    </div>
                </div>
            );
        }
        case 'edit_file': case 'multi_edit': {
            const oldStr = String(a.old_string || '').trim();
            const newStr = String(a.new_string || '').trim();
            const linesRemoved = r.lines_removed as number || 0;
            const linesAdded = r.lines_added as number || 0;
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-diff">
                        <div className="tool-step-diff-header">
                            <span>{String(a.file_path || '').split('/').pop()}</span>
                            <span className="tool-step-diff-stats">
                                <span className="diff-added">+{linesAdded}</span>
                                <span className="diff-removed">-{linesRemoved}</span>
                            </span>
                        </div>
                        {oldStr && (
                            <div className="tool-step-diff-block removed">
                                {oldStr.split('\n').slice(0, 10).map((line, i) => (
                                    <div key={i} className="diff-line diff-line-removed">
                                        <span className="diff-sign">-</span>
                                        <span>{line}</span>
                                    </div>
                                ))}
                                {oldStr.split('\n').length > 10 && <div className="diff-line diff-truncated">... +{oldStr.split('\n').length - 10} more lines</div>}
                            </div>
                        )}
                        {newStr && (
                            <div className="tool-step-diff-block added">
                                {newStr.split('\n').slice(0, 10).map((line, i) => (
                                    <div key={i} className="diff-line diff-line-added">
                                        <span className="diff-sign">+</span>
                                        <span>{line}</span>
                                    </div>
                                ))}
                                {newStr.split('\n').length > 10 && <div className="diff-line diff-truncated">... +{newStr.split('\n').length - 10} more lines</div>}
                            </div>
                        )}
                    </div>
                </div>
            );
        }
        case 'create_file': {
            const content = String(a.content || '');
            const lines = content.split('\n');
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-diff">
                        <div className="tool-step-diff-header">
                            <span>{String(a.file_path || '').split('/').pop()}</span>
                            <span className="tool-step-diff-stats"><span className="diff-added">+{lines.length} lines</span></span>
                        </div>
                        <div className="tool-step-diff-block added">
                            {lines.slice(0, 15).map((line, i) => (
                                <div key={i} className="diff-line diff-line-added">
                                    <span className="diff-sign">+</span>
                                    <span>{line}</span>
                                </div>
                            ))}
                            {lines.length > 15 && <div className="diff-line diff-truncated">... +{lines.length - 15} more lines</div>}
                        </div>
                    </div>
                </div>
            );
        }
        case 'search_files': {
            const matches = r.matches as Array<{ file?: string; line?: number; content?: string }>;
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-search-results">
                        {matches.slice(0, 8).map((m, i) => (
                            <div key={i} className="search-result-line">
                                <span className="search-result-file">{String(m.file || '').split('/').pop()}</span>
                                {m.line && <span className="search-result-lineno">:{m.line}</span>}
                                <span className="search-result-content">{String(m.content || '').slice(0, 80)}</span>
                            </div>
                        ))}
                        {matches.length > 8 && <div className="diff-line diff-truncated">... +{matches.length - 8} more results</div>}
                    </div>
                </div>
            );
        }
        case 'git_status': {
            const files = r.files as Array<{ path: string; status: string; staged: boolean }>;
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-git-status">
                        {files.slice(0, 10).map((f, i) => (
                            <div key={i} className={`git-status-file git-status-${f.status}`}>
                                <span className="git-status-indicator">{f.staged ? 'S' : ' '}{f.status[0].toUpperCase()}</span>
                                <span>{f.path}</span>
                            </div>
                        ))}
                        {files.length > 10 && <div className="diff-line diff-truncated">... +{files.length - 10} more files</div>}
                    </div>
                </div>
            );
        }
        case 'find_references': {
            const refs = r.references as Array<{ file?: string; line?: number; content?: string }>;
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-search-results">
                        {refs.slice(0, 10).map((ref, i) => (
                            <div key={i} className="search-result-line">
                                <span className="search-result-file">{String(ref.file || '').split('/').pop()}</span>
                                {ref.line && <span className="search-result-lineno">:{ref.line}</span>}
                                {ref.content && <span className="search-result-content">{String(ref.content).slice(0, 80)}</span>}
                            </div>
                        ))}
                        {refs.length > 10 && <div className="diff-line diff-truncated">... +{refs.length - 10} more references</div>}
                    </div>
                </div>
            );
        }
        case 'list_symbols': {
            const symbols = r.symbols as Array<{ name?: string; kind?: string; line?: number }>;
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-search-results">
                        {symbols.slice(0, 15).map((sym, i) => (
                            <div key={i} className="search-result-line">
                                <span className="search-result-file">{sym.kind || 'symbol'}</span>
                                <span className="search-result-content">{sym.name}</span>
                                {sym.line && <span className="search-result-lineno">:{sym.line}</span>}
                            </div>
                        ))}
                        {symbols.length > 15 && <div className="diff-line diff-truncated">... +{symbols.length - 15} more symbols</div>}
                    </div>
                </div>
            );
        }
        case 'semantic_search': {
            const results = r.results as Array<{ file?: string; score?: number; snippet?: string; content?: string }>;
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-search-results">
                        {results.slice(0, 8).map((res, i) => (
                            <div key={i} className="search-result-line">
                                <span className="search-result-file">{String(res.file || '').split('/').pop()}</span>
                                {res.score != null && <span className="search-result-lineno"> ({(res.score as number).toFixed(2)})</span>}
                                <span className="search-result-content">{String(res.snippet || res.content || '').slice(0, 80)}</span>
                            </div>
                        ))}
                        {results.length > 8 && <div className="diff-line diff-truncated">... +{results.length - 8} more results</div>}
                    </div>
                </div>
            );
        }
        case 'git_diff': {
            const diffText = String(r.diff || r.output || '');
            const diffLines = diffText.split('\n');
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-terminal">
                        <pre className="tool-step-stdout">
                            {diffLines.slice(0, 30).map((line, i) => (
                                <div key={i} className={line.startsWith('+') ? 'diff-line diff-line-added' : line.startsWith('-') ? 'diff-line diff-line-removed' : line.startsWith('@@') ? 'diff-line diff-hunk' : ''}>
                                    {line}
                                </div>
                            ))}
                            {diffLines.length > 30 && <div className="diff-line diff-truncated">{`... +${diffLines.length - 30} more lines`}</div>}
                        </pre>
                    </div>
                </div>
            );
        }
        case 'git_log': {
            const commits = r.commits as Array<{ hash?: string; message?: string; author?: string; date?: string }>;
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-git-status">
                        {commits.slice(0, 10).map((c, i) => (
                            <div key={i} className="git-status-file">
                                <span className="git-status-indicator">{String(c.hash || '').slice(0, 7)}</span>
                                <span>{String(c.message || '').slice(0, 60)}</span>
                            </div>
                        ))}
                        {commits.length > 10 && <div className="diff-line diff-truncated">... +{commits.length - 10} more commits</div>}
                    </div>
                </div>
            );
        }
        case 'git_branches': {
            const branches = r.branches as Array<{ name?: string; current?: boolean } | string>;
            const currentBranch = r.current || r.current_branch || '';
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-git-status">
                        {branches.slice(0, 15).map((b, i) => {
                            const name = typeof b === 'string' ? b : (b.name || '');
                            const isCurrent = typeof b === 'string' ? b === currentBranch : !!b.current;
                            return (
                                <div key={i} className={`git-status-file${isCurrent ? ' git-status-modified' : ''}`}>
                                    <span className="git-status-indicator">{isCurrent ? '*' : ' '}</span>
                                    <span>{name}</span>
                                </div>
                            );
                        })}
                        {branches.length > 15 && <div className="diff-line diff-truncated">... +{branches.length - 15} more branches</div>}
                    </div>
                </div>
            );
        }
        case 'git_merge': {
            const output = String(r.output || r.message || '');
            const conflicts = r.conflicts;
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-terminal">
                        <div className="tool-step-terminal-header">
                            <span className="tool-step-terminal-prompt">$ git merge {String(step.args.branch || '')}</span>
                            <span className={`tool-step-exit-code ${conflicts ? 'error' : 'success'}`}>
                                {conflicts ? 'CONFLICTS' : 'OK'}
                            </span>
                        </div>
                        {output && <pre className="tool-step-stdout">{output.slice(0, 2000)}</pre>}
                    </div>
                </div>
            );
        }
        case 'git_show': {
            const diffText = String(r.diff || r.output || '');
            const msg = String(r.message || '');
            const diffLines = diffText.split('\n');
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-terminal">
                        {msg && <div className="tool-step-terminal-header"><span className="tool-step-terminal-prompt">{msg.slice(0, 120)}</span></div>}
                        <pre className="tool-step-stdout">
                            {diffLines.slice(0, 30).map((line, i) => (
                                <div key={i} className={line.startsWith('+') ? 'diff-line diff-line-added' : line.startsWith('-') ? 'diff-line diff-line-removed' : line.startsWith('@@') ? 'diff-line diff-hunk' : ''}>
                                    {line}
                                </div>
                            ))}
                            {diffLines.length > 30 && <div className="diff-line diff-truncated">{`... +${diffLines.length - 30} more lines`}</div>}
                        </pre>
                    </div>
                </div>
            );
        }
        case 'git_tag': {
            const tags = r.tags as Array<string | { name?: string; message?: string }>;
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-git-status">
                        {tags.slice(0, 15).map((t, i) => {
                            const name = typeof t === 'string' ? t : (t.name || '');
                            return (
                                <div key={i} className="git-status-file">
                                    <span className="git-status-indicator">{'\uD83C\uDFF7'}</span>
                                    <span>{name}</span>
                                </div>
                            );
                        })}
                        {tags.length > 15 && <div className="diff-line diff-truncated">... +{tags.length - 15} more tags</div>}
                    </div>
                </div>
            );
        }
        case 'git_remotes': {
            const remotes = r.remotes as Array<{ name?: string; url?: string; type?: string } | string>;
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-git-status">
                        {remotes.map((rem, i) => {
                            const name = typeof rem === 'string' ? rem : (rem.name || '');
                            const url = typeof rem === 'string' ? '' : (rem.url || '');
                            return (
                                <div key={i} className="git-status-file">
                                    <span className="git-status-indicator">{name}</span>
                                    <span>{url}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }
        case 'orchestrate': {
            const summary = r.summary as { total?: number; done?: number; failed?: number; nodes?: Array<{ id: string; task: string; role: string; status: string; rounds?: number }> };
            const report = String(r.report || '');
            const duration = r.duration_ms ? Math.round(Number(r.duration_ms) / 1000) : null;
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-terminal">
                        <div className="tool-step-terminal-header">
                            <span className="tool-step-terminal-prompt">Orchestration: {String(a.description || '')}</span>
                            {duration != null && <span className="tool-step-exit-code success">{duration}s</span>}
                        </div>
                        {summary?.nodes && (
                            <div style={{ padding: '4px 8px' }}>
                                {summary.nodes.map((n, i) => {
                                    const badge = { researcher: '\uD83D\uDD0D', implementer: '\uD83D\uDD28', reviewer: '\uD83D\uDC41\uFE0F', tester: '\uD83E\uDDEA', planner: '\uD83D\uDCCB' }[n.role] || '\u26A1';
                                    const statusIcon = n.status === 'done' ? '\u2705' : n.status === 'failed' ? '\u274C' : n.status === 'skipped' ? '\u23ED\uFE0F' : '\u23F3';
                                    return (
                                        <div key={i} style={{ padding: '2px 0', fontSize: '0.8rem', display: 'flex', gap: 6, alignItems: 'center' }}>
                                            <span>{statusIcon}</span>
                                            <span>{badge} {n.role}</span>
                                            <span style={{ opacity: 0.7 }}>{n.task.slice(0, 50)}</span>
                                            {n.rounds && <span style={{ opacity: 0.5, fontSize: '0.7rem' }}>({n.rounds} rounds)</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        {report && <pre className="tool-step-stdout" style={{ maxHeight: 300, overflow: 'auto' }}>{report.slice(0, 5000)}</pre>}
                    </div>
                </div>
            );
        }
        case 'spawn_specialist': {
            const result = String(r.result || r.content || '');
            const role = String(r.role || a.role || '');
            const rounds = r.rounds as number;
            const status = String(r.status || '');
            const badge = { researcher: '\uD83D\uDD0D', implementer: '\uD83D\uDD28', reviewer: '\uD83D\uDC41\uFE0F', tester: '\uD83E\uDDEA', planner: '\uD83D\uDCCB' }[role] || '\u26A1';
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-terminal">
                        <div className="tool-step-terminal-header">
                            <span className="tool-step-terminal-prompt">{badge} {role} — {String(a.task || '').slice(0, 80)}</span>
                            <span className={`tool-step-exit-code ${status === 'done' ? 'success' : 'error'}`}>
                                {status} ({rounds || 0} rounds)
                            </span>
                        </div>
                        {result && <pre className="tool-step-stdout" style={{ maxHeight: 300, overflow: 'auto' }}>{result.slice(0, 5000)}</pre>}
                    </div>
                </div>
            );
        }
        case 'verify_project': {
            const summary = r.summary as { critical?: number; high?: number; medium?: number; low?: number; total_issues?: number; verdict?: string } | undefined;
            const issues = (r.issues || []) as Array<{ severity: string; type: string; file?: string; message: string }>;
            const filesScanned = r.files_scanned as number;
            const severityColor: Record<string, string> = { critical: 'var(--error, #ff4444)', high: 'var(--warning, #ff8800)', medium: 'var(--warning-light, #ffcc00)', low: 'var(--text-muted, #888)' };
            const verdictColor = summary?.critical ? 'var(--error, #ff4444)' : summary?.high ? 'var(--warning, #ff8800)' : 'var(--success, #44cc44)';
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-terminal">
                        <div className="tool-step-terminal-header">
                            <span className="tool-step-terminal-prompt">Verify: {String(a.project_path || '').split('/').pop()}</span>
                            <span className="tool-step-exit-code" style={{ color: verdictColor }}>
                                {filesScanned} files · {summary?.total_issues || 0} issues
                            </span>
                        </div>
                        {summary?.verdict && (
                            <div style={{ padding: '6px 8px', fontWeight: 'bold', color: verdictColor, fontSize: '0.85rem' }}>
                                {summary.verdict}
                            </div>
                        )}
                        {issues.length > 0 && (
                            <div style={{ padding: '4px 8px' }}>
                                {issues.slice(0, 20).map((issue, i) => (
                                    <div key={i} style={{ padding: '2px 0', fontSize: '0.8rem', display: 'flex', gap: 6 }}>
                                        <span style={{ color: severityColor[issue.severity] || 'var(--text-muted, #888)', fontWeight: 'bold', minWidth: 60 }}>
                                            {issue.severity.toUpperCase()}
                                        </span>
                                        {issue.file && <span style={{ opacity: 0.6 }}>{issue.file}:</span>}
                                        <span>{issue.message.slice(0, 200)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            );
        }
        case 'sequential_thinking': {
            const thought = String(a.thought || r?.thought || '');
            const num = Number(a.thought_number || r?.thought_number || 0);
            const total = Number(a.total_thoughts || r?.total_thoughts || 0);
            const isRev = a.is_revision || false;
            const branch = a.branch_id as string || null;
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-terminal" style={{ borderLeft: `3px solid ${isRev ? 'var(--warning-light, #ffcc00)' : branch ? 'var(--accent-secondary, #88aaff)' : 'var(--text-muted)'}` }}>
                        <div className="tool-step-terminal-header">
                            <span className="tool-step-terminal-prompt">
                                Thought {num}/{total}{isRev ? ' (revision)' : ''}{branch ? ` [${branch}]` : ''}
                            </span>
                        </div>
                        <div style={{ padding: '6px 8px', fontSize: '0.85rem', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                            {thought}
                        </div>
                    </div>
                </div>
            );
        }
        case 'trajectory_search': {
            const results = (r.results || []) as Array<{ conversation_title: string; role: string; score: number; snippet: string }>;
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-terminal">
                        <div className="tool-step-terminal-header">
                            <span className="tool-step-terminal-prompt">History: &quot;{String(a.query || '').slice(0, 40)}&quot;</span>
                            <span className="tool-step-exit-code">{results.length} matches</span>
                        </div>
                        {results.slice(0, 10).map((res, i) => (
                            <div key={i} style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', fontSize: '0.8rem' }}>
                                <div style={{ display: 'flex', gap: 8, opacity: 0.7, marginBottom: 2 }}>
                                    <span>{res.conversation_title}</span>
                                    <span>({res.role})</span>
                                    <span style={{ marginLeft: 'auto' }}>score: {res.score}</span>
                                </div>
                                <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.78rem' }}>{String(res.snippet || '').slice(0, 300)}</div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        case 'find_by_name': {
            const results = (r.results || []) as Array<{ path: string; name: string; type: string; size: number | null }>;
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-terminal">
                        <div className="tool-step-terminal-header">
                            <span className="tool-step-terminal-prompt">Find: &quot;{String(a.pattern || '')}&quot;</span>
                            <span className="tool-step-exit-code">{results.length} results</span>
                        </div>
                        <div style={{ padding: '4px 8px', fontSize: '0.8rem' }}>
                            {results.slice(0, 30).map((res, i) => (
                                <div key={i} style={{ padding: '1px 0', display: 'flex', gap: 8 }}>
                                    <span style={{ color: res.type === 'directory' ? 'var(--accent-secondary, #88aaff)' : 'inherit' }}>
                                        {res.type === 'directory' ? '\uD83D\uDCC1' : '\uD83D\uDCC4'} {res.path}
                                    </span>
                                    {res.size != null && <span style={{ opacity: 0.5, marginLeft: 'auto' }}>{(res.size / 1024).toFixed(1)}KB</span>}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            );
        }
        case 'read_url_content': {
            const content = String(r.first_chunk || '');
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-terminal">
                        <div className="tool-step-terminal-header">
                            <span className="tool-step-terminal-prompt">{String(r.url || a.url || '')}</span>
                            <span className="tool-step-exit-code">{String(r.total_chunks)} chunks, {String(r.total_chars)} chars</span>
                        </div>
                        <div className="tool-step-terminal-text" style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                            {content.slice(0, 2000)}
                            {content.length > 2000 && '\n... (truncated)'}
                        </div>
                    </div>
                </div>
            );
        }
        case 'read_notebook': {
            const cells = (r.cells || []) as Array<{ cell_number: number; cell_type: string; source: string; execution_count: number | null }>;
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-terminal">
                        <div className="tool-step-terminal-header">
                            <span className="tool-step-terminal-prompt">{String(a.file_path || '').split('/').pop()}</span>
                            <span className="tool-step-exit-code">{cells.length} cells ({String(r.kernel || 'unknown')})</span>
                        </div>
                        {cells.slice(0, 20).map((cell, i) => (
                            <div key={i} style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', gap: 8, fontSize: '0.75rem', opacity: 0.6, marginBottom: 2 }}>
                                    <span>[{cell.cell_number}]</span>
                                    <span style={{ color: cell.cell_type === 'code' ? 'var(--accent)' : 'var(--text-secondary)' }}>
                                        {cell.cell_type}
                                    </span>
                                    {cell.execution_count != null && <span>exec: {cell.execution_count}</span>}
                                </div>
                                <pre style={{ margin: 0, fontSize: '0.78rem', whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto' }}>
                                    {String(cell.source || '').slice(0, 500)}
                                </pre>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        case 'read_deployment_config': {
            const issues = (r.issues || []) as string[];
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-terminal">
                        <div className="tool-step-terminal-header">
                            <span className="tool-step-terminal-prompt">Deploy Config</span>
                            <span className="tool-step-exit-code">{r.ready ? 'READY' : 'NOT READY'}</span>
                        </div>
                        <div style={{ padding: '4px 8px', fontSize: '0.8rem' }}>
                            <div>Framework: {String(r.framework || 'unknown')}</div>
                            <div>Build script: {r.has_build ? 'yes' : 'no'}</div>
                            {r.config_files != null && <div>Config: {(r.config_files as string[]).join(', ') || 'none'}</div>}
                            {issues.length > 0 && (
                                <div style={{ color: 'var(--error, #ff4444)', marginTop: 4 }}>
                                    {issues.map((issue, i) => <div key={i}>- {issue}</div>)}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }
        case 'deploy_web_app': {
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-terminal">
                        <div className="tool-step-terminal-header">
                            <span className="tool-step-terminal-prompt">Deploy ({String(a.provider || 'netlify')})</span>
                            <span className="tool-step-exit-code">{r.success ? 'SUCCESS' : 'FAILED'}</span>
                        </div>
                        {r.url != null && <div style={{ padding: '4px 8px', fontSize: '0.85rem', color: 'var(--accent)' }}>{String(r.url)}</div>}
                        {r.output != null && <div className="tool-step-terminal-text">{String(r.output).slice(0, 500)}</div>}
                    </div>
                </div>
            );
        }
        case 'gh_cli': {
            const output = String(r.output || r.data || r.error || '');
            const cmd = String(a.command || '');
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-terminal">
                        <div className="tool-step-terminal-header">
                            <span className="tool-step-terminal-prompt">$ gh {cmd}</span>
                            <span className={`tool-step-exit-code ${r.success ? 'success' : 'error'}`}>
                                {r.success ? 'OK' : 'FAILED'}
                            </span>
                        </div>
                        <pre className="tool-step-stdout" style={{ maxHeight: 300, overflow: 'auto' }}>
                            {output.slice(0, 5000)}
                            {output.length > 5000 && '\n... (truncated)'}
                        </pre>
                    </div>
                </div>
            );
        }
        case 'gws_cli': {
            const output = String(r.output || r.data || r.error || '');
            const cmd = String(a.command || '');
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-terminal">
                        <div className="tool-step-terminal-header">
                            <span className="tool-step-terminal-prompt">$ gws {cmd}</span>
                            <span className={`tool-step-exit-code ${r.success ? 'success' : 'error'}`}>
                                {r.success ? 'OK' : 'FAILED'}
                            </span>
                        </div>
                        <pre className="tool-step-stdout" style={{ maxHeight: 300, overflow: 'auto' }}>
                            {output.slice(0, 5000)}
                            {output.length > 5000 && '\n... (truncated)'}
                        </pre>
                    </div>
                </div>
            );
        }
        case 'memory_search': {
            const memResults = r.results as Array<{ file: string; category: string; snippet: string }>;
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-search-results">
                        {(memResults || []).slice(0, 8).map((res, i) => (
                            <div key={i} style={{ marginBottom: 8 }}>
                                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 2 }}>
                                    {res.file} <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>({res.category})</span>
                                </div>
                                <div className="search-result-line">
                                    <span className="search-result-content">{(res.snippet || '').slice(0, 200)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        case 'conversation_search': {
            const convResults = r.results as Array<{ id: string; title: string; project: string | null; date: string | null; snippet: string }>;
            return (
                <div className="tool-step-expanded">
                    <div className="tool-step-search-results">
                        {(convResults || []).slice(0, 5).map((res, i) => (
                            <div key={i} style={{ marginBottom: 8 }}>
                                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 2 }}>
                                    {res.title} {res.date && <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>({res.date})</span>}
                                    {res.project && <span style={{ fontSize: '0.65rem', opacity: 0.7 }}> &bull; {res.project}</span>}
                                </div>
                                <div className="search-result-line">
                                    <span className="search-result-content">{(res.snippet || '').slice(0, 200)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        case 'conversation_recall': {
            const convContext = String(r.context || '');
            const convInfo = r.conversation as Record<string, unknown> | undefined;
            return (
                <div className="tool-step-expanded">
                    {convInfo && (
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                            {String(convInfo.title || '')} ({String(convInfo.messageCount || '?')} messages)
                            {convInfo.project ? <span> &bull; {String(convInfo.project)}</span> : null}
                        </div>
                    )}
                    <pre className="tool-step-terminal" style={{ maxHeight: 200, overflow: 'auto', fontSize: '0.7rem' }}>
                        {convContext.slice(0, 2000)}
                    </pre>
                </div>
            );
        }
        case 'create_plan': case 'get_plan': {
            const rawPlan = step.name === 'create_plan'
                ? { title: a.title, overview: a.overview, architecture: a.architecture, components: a.components || [], fileMap: a.file_map || [], designDecisions: a.design_decisions || [] }
                : (r.plan as Record<string, unknown> | null);
            if (!rawPlan) return <div className="tool-step-expanded"><em>No active plan</em></div>;
            const planOverview = String(rawPlan.overview || '');
            const comps = (rawPlan.components as Array<{ name: string; purpose: string }>) || [];
            const files = ((rawPlan.fileMap || rawPlan.file_map) as Array<{ path: string; purpose: string }>) || [];
            const decisions = ((rawPlan.designDecisions || rawPlan.design_decisions) as string[]) || [];
            return (
                <div className="tool-step-expanded">
                    <div style={{ padding: '8px 12px', fontSize: '0.78rem', lineHeight: 1.6 }}>
                        {planOverview && <p style={{ color: 'var(--text-secondary)', margin: '0 0 8px 0' }}>{planOverview.slice(0, 300)}</p>}
                        {comps.length > 0 && (
                            <div style={{ marginBottom: 6 }}>
                                <strong style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>Components:</strong>
                                {comps.map((c, i) => (
                                    <div key={i} style={{ paddingLeft: 8, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                        <span style={{ color: 'var(--accent-primary)' }}>{c.name}</span> — {c.purpose}
                                    </div>
                                ))}
                            </div>
                        )}
                        {files.length > 0 && (
                            <div style={{ marginBottom: 6 }}>
                                <strong style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>Files ({files.length}):</strong>
                                {files.slice(0, 10).map((f, i) => (
                                    <div key={i} style={{ paddingLeft: 8, fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-secondary)' }}>
                                        {f.path} — <span style={{ opacity: 0.7 }}>{f.purpose}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {decisions.length > 0 && (
                            <div>
                                <strong style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>Decisions:</strong>
                                {decisions.slice(0, 5).map((d, i) => (
                                    <div key={i} style={{ paddingLeft: 8, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{'\u2022'} {d}</div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            );
        }
        case 'ctx_execute': {
            const ctxOut = String(r.stdout || '');
            const ctxErr = String(r.stderr || '');
            const ctxSav = r.context_savings as string | undefined;
            const ctxFiltered = r.filtered_by_intent as string | undefined;
            return (
                <div className="tool-step-expanded">
                    {ctxSav && <div className="ctx-savings-badge">{ctxSav}</div>}
                    {ctxFiltered && <div style={{ padding: '4px 12px', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>Filtered by intent: {ctxFiltered}</div>}
                    <div className="tool-step-terminal">
                        {ctxOut && <pre className="tool-step-stdout">{ctxOut.slice(0, 3000)}</pre>}
                        {ctxErr && <pre className="tool-step-stderr">{ctxErr.slice(0, 1000)}</pre>}
                    </div>
                </div>
            );
        }
        case 'ctx_search': {
            const ctxResults = (r.results as Array<{ title: string; snippet: string; score: number }>) || [];
            return (
                <div className="tool-step-expanded">
                    {ctxResults.slice(0, 5).map((res, i) => (
                        <div key={i} style={{ padding: '4px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--accent-primary)', fontWeight: 600 }}>{res.title || 'Untitled'}</div>
                            <pre style={{ fontSize: '0.7rem', margin: '2px 0', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>{(res.snippet || '').slice(0, 500)}</pre>
                        </div>
                    ))}
                </div>
            );
        }
        case 'ctx_index': {
            const ctxTerms = String(r.searchable_terms || '');
            return (
                <div className="tool-step-expanded">
                    <div style={{ padding: '6px 12px', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                        {r.chunk_count as number} chunks, {r.bytes_indexed as number} bytes indexed
                        {ctxTerms && <div style={{ marginTop: 4, color: 'var(--text-tertiary)' }}>Terms: {ctxTerms.slice(0, 200)}</div>}
                    </div>
                </div>
            );
        }
        case 'ctx_batch': {
            const execs = (r.executions as Array<{ label: string; exit_code: number; summary: string; error?: string }>) || [];
            const searches = (r.searches as Array<{ query: string; results: Array<{ title: string; snippet: string }> }>) || [];
            return (
                <div className="tool-step-expanded">
                    {execs.map((ex, i) => (
                        <div key={`e${i}`} style={{ padding: '4px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
                            <div style={{ fontSize: '0.72rem', color: ex.error ? 'var(--error)' : 'var(--accent-primary)', fontWeight: 600 }}>{ex.label} (exit: {ex.exit_code})</div>
                            <pre style={{ fontSize: '0.7rem', margin: '2px 0', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>{(ex.summary || ex.error || '').slice(0, 500)}</pre>
                        </div>
                    ))}
                    {searches.map((s, i) => (
                        <div key={`s${i}`} style={{ padding: '4px 12px' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>Search: "{s.query}" ({s.results?.length || 0} results)</div>
                        </div>
                    ))}
                </div>
            );
        }
        case 'ctx_stats': {
            const savings = r.context_savings as Record<string, unknown> | undefined;
            const kb = r.knowledge_base as Record<string, unknown> | undefined;
            return (
                <div className="tool-step-expanded">
                    <div style={{ padding: '6px 12px', fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        {savings && <div><strong>{savings.savings_ratio as string}</strong> saved ({savings.bytes_saved as number} bytes), {savings.total_bytes_processed as number} processed</div>}
                        {kb && <div>{kb.totalSources as number} sources, {kb.totalChunks as number} chunks, {kb.totalVocabulary as number} vocabulary</div>}
                    </div>
                </div>
            );
        }
        case 'ctx_fetch': {
            const ctxPreview = String(r.preview || '');
            return (
                <div className="tool-step-expanded">
                    <div style={{ padding: '4px 12px', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{r.bytes_fetched as number} bytes fetched, {r.chunks_indexed as number} chunks indexed</div>
                    {ctxPreview && <div className="tool-step-terminal"><pre className="tool-step-stdout">{ctxPreview.slice(0, 2000)}</pre></div>}
                </div>
            );
        }
        default:
            return null;
    }
}

// ── Grouping constants ──
const alwaysSingle = new Set(['run_command', 'init_project', 'spawn_sub_agent', 'orchestrate', 'spawn_specialist', 'ask_user_question', 'sequential_thinking', 'show_widget', 'deploy_web_app', 'configure_heartbeat']);

const groupLabels: Record<string, { single: string; plural: string }> = {
    create_file: { single: 'Created', plural: 'Created' },
    edit_file: { single: 'Edited', plural: 'Edited' },
    multi_edit: { single: 'Edited', plural: 'Edited' },
    read_file: { single: 'Read', plural: 'Read' },
    search_files: { single: 'Searched', plural: 'Searched' },
    glob_files: { single: 'Found', plural: 'Found' },
    task_add: { single: 'Task', plural: 'Tasks' },
    task_update: { single: 'Task', plural: 'Tasks' },
    task_list: { single: 'Tasks', plural: 'Tasks' },
    create_plan: { single: 'Plan', plural: 'Plans' },
    update_plan: { single: 'Plan Updated', plural: 'Plans Updated' },
    get_plan: { single: 'Plan', plural: 'Plans' },
    delete_file: { single: 'Deleted', plural: 'Deleted' },
    list_directory: { single: 'Listed', plural: 'Listed' },
    find_references: { single: 'Refs', plural: 'Refs' },
    list_symbols: { single: 'Symbols', plural: 'Symbols' },
    semantic_search: { single: 'Search', plural: 'Searched' },
    find_implementation: { single: 'Found', plural: 'Found' },
    smart_read: { single: 'Smart Read', plural: 'Smart Read' },
    batch_search: { single: 'Batch Search', plural: 'Batch Search' },
    // Git operations
    git_commit: { single: 'Committed', plural: 'Committed' },
    git_push: { single: 'Pushed', plural: 'Pushed' },
    git_status: { single: 'Git Status', plural: 'Git Status' },
    git_diff: { single: 'Diff', plural: 'Diffs' },
    git_log: { single: 'Log', plural: 'Logs' },
    git_checkout: { single: 'Checkout', plural: 'Checkouts' },
    git_pull: { single: 'Pull', plural: 'Pulls' },
    git_branches: { single: 'Branch', plural: 'Branches' },
    git_merge: { single: 'Merged', plural: 'Merged' },
    git_reset: { single: 'Reset', plural: 'Reset' },
    git_tag: { single: 'Tag', plural: 'Tags' },
    git_show: { single: 'Show', plural: 'Show' },
    git_remotes: { single: 'Remotes', plural: 'Remotes' },
    git_stage: { single: 'Staged', plural: 'Staged' },
    git_unstage: { single: 'Unstaged', plural: 'Unstaged' },
    // CLI tools
    gh_cli: { single: 'GitHub', plural: 'GitHub' },
    gws_cli: { single: 'Workspace', plural: 'Workspace' },
    // Context engine
    ctx_execute: { single: 'Executed', plural: 'Executed' },
    ctx_batch: { single: 'Batch', plural: 'Batched' },
    ctx_stats: { single: 'Context Stats', plural: 'Context Stats' },
    ctx_fetch: { single: 'Fetched', plural: 'Fetched' },
    // Browser
    browser_navigate: { single: 'Browser', plural: 'Browser' },
    browser_screenshot: { single: 'Screenshot', plural: 'Screenshots' },
    browser_click: { single: 'Clicked', plural: 'Clicked' },
    browser_type: { single: 'Typed', plural: 'Typed' },
    browser_evaluate: { single: 'Browser JS', plural: 'Browser JS' },
    // Other
    get_orchestration_status: { single: 'Orchestration', plural: 'Orchestration' },
    index_codebase: { single: 'Index', plural: 'Indexed' },
    detect_project: { single: 'Detected', plural: 'Detected' },
    impact_analysis: { single: 'Impact', plural: 'Impact' },
    prepare_edit_context: { single: 'Context', plural: 'Context' },
    verify_project: { single: 'Verified', plural: 'Verified' },
    trajectory_search: { single: 'History Search', plural: 'History Search' },
    read_url_content: { single: 'Web Fetch', plural: 'Web Fetch' },
    read_notebook: { single: 'Notebook', plural: 'Notebooks' },
    read_deployment_config: { single: 'Deploy Config', plural: 'Deploy Config' },
    check_deploy_status: { single: 'Deploy Status', plural: 'Deploy Status' },
    mcp_search: { single: 'MCP Search', plural: 'MCP Search' },
    memory_write: { single: 'Memory', plural: 'Memory' },
    memory_append: { single: 'Memory', plural: 'Memory' },
    memory_search: { single: 'Memory Search', plural: 'Memory Search' },
    webfetch: { single: 'Fetched', plural: 'Fetched' },
    websearch: { single: 'Searched', plural: 'Searched' },
};

function groupKey(name: string) {
    if (name === 'multi_edit') return 'edit_file';
    // Group MCP tools by server prefix (mcp_servername__toolname → mcp_servername)
    if (name.startsWith('mcp_')) {
        const sep = name.indexOf('__');
        if (sep > 0) return name.slice(0, sep);
    }
    return name;
}

// ── Main Component ──
export default function ToolStepRenderer({ steps, expandedSteps, onToggleStepExpand }: ToolStepRendererProps) {
    if (!steps || steps.length === 0) return null;

    // Group consecutive same-type tool calls into action groups
    const grouped: GroupedStep[] = [];
    for (const step of steps) {
        const key = groupKey(step.name);
        const last = grouped[grouped.length - 1];
        if (last && last.key === key && !alwaysSingle.has(step.name)) {
            last.steps.push(step);
            last.count++;
            last.allDone = last.allDone && step.status === 'done';
            last.anyRunning = last.anyRunning || step.status === 'running';
            last.anyError = last.anyError || step.status === 'error';
        } else {
            grouped.push({ key, name: step.name, steps: [step], count: 1, allDone: step.status === 'done', anyRunning: step.status === 'running', anyError: step.status === 'error' });
        }
    }

    return (
        <div className="tool-steps">
            {grouped.map((group, gi) => {
                // Multi-item group -- accordion style
                if (group.count > 1) {
                    const status = group.anyRunning ? 'running' : group.anyError ? 'error' : group.allDone ? 'done' : 'running';
                    const label = groupLabels[group.key] || groupLabels[group.name]
                        || (group.key.startsWith('mcp_')
                            ? { single: group.key.slice(4).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), plural: group.key.slice(4).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }
                            : { single: toolIcon(group.name), plural: toolIcon(group.name) });
                    const isGroupExpanded = expandedSteps.has(`group-${gi}`);
                    return (
                        <div key={gi} className={`tool-step tool-step-${status}`}>
                            <div
                                className="tool-step-group-header"
                                onClick={(e) => onToggleStepExpand(`group-${gi}`, e)}
                            >
                                <span className={`tool-step-chevron${isGroupExpanded ? ' expanded' : ''}`}>&#9656;</span>
                                <span className="tool-step-label">{label.plural}</span>
                                <span className="tool-step-group-count">{group.count}</span>
                                <span className={`tool-step-status ${status}`}>
                                    {status === 'running' ? <span className="tool-spinner" /> : status === 'done' ? '\u2713' : '\u2717'}
                                </span>
                            </div>
                            {isGroupExpanded && (
                                <div className="tool-step-group-items">
                                    {group.steps.map((step) => {
                                        const detail = getDetail(step);
                                        const isItemExpandable = hasExpandableContent(step);
                                        const isItemExpanded = expandedSteps.has(step.id);
                                        return (
                                            <div key={step.id}>
                                                <div
                                                    className="tool-step-group-item"
                                                    onClick={isItemExpandable ? (e) => onToggleStepExpand(step.id, e) : undefined}
                                                >
                                                    {isItemExpandable && <span className={`tool-step-chevron${isItemExpanded ? ' expanded' : ''}`}>&#9656;</span>}
                                                    <span className="file-name">{detail}</span>
                                                    <span className={`tool-step-status ${step.status}`}>
                                                        {step.status === 'running' ? <span className="tool-spinner" /> : step.status === 'done' ? '\u2713' : '\u2717'}
                                                    </span>
                                                </div>
                                                {isItemExpanded && renderExpandedContent(step)}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                }

                // Single step -- rich display
                const step = group.steps[0];
                const detail = getDetail(step);
                const hasError = step.result && 'error' in step.result;
                const isScreenshot = step.name === 'browser_screenshot' && step.status === 'done' && step.result && 'path' in step.result;
                const isExpandable = hasExpandableContent(step);
                const isExpanded = expandedSteps.has(step.id);

                return (
                    <div key={step.id} className={`tool-step tool-step-${step.status}${hasError ? ' tool-step-has-error' : ''}${isExpanded ? ' tool-step-expanded-active' : ''}`}>
                        <div
                            className={`tool-step-header${isExpandable ? ' tool-step-clickable' : ''}`}
                            onClick={isExpandable ? (e) => onToggleStepExpand(step.id, e) : undefined}
                        >
                            {isExpandable && (
                                <span className={`tool-step-chevron${isExpanded ? ' expanded' : ''}`}>&#9656;</span>
                            )}
                            <span className="tool-step-label">{toolIcon(step.name)}</span>
                            {detail && <span className="tool-step-detail">{detail}</span>}
                            <span className={`tool-step-status ${step.status}`}>
                                {step.status === 'running' ? <span className="tool-spinner" /> : step.status === 'done' ? '\u2713' : '\u2717'}
                            </span>
                        </div>
                        {isScreenshot && (
                            <div className="tool-step-screenshot">
                                <ScreenshotImage
                                    filePath={String((step.result as Record<string, unknown>).path)}
                                    alt={String(step.args.name || 'Screenshot')}
                                    onClick={() => window.onicode?.openExternal?.(`file://${String((step.result as Record<string, unknown>).path)}`)}
                                />
                            </div>
                        )}
                        {hasError && (
                            <div className="tool-step-error">{String((step.result as Record<string, unknown>).error)}</div>
                        )}
                        {isExpanded && renderExpandedContent(step)}
                    </div>
                );
            })}
        </div>
    );
}
