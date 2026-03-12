/**
 * Orchestrator — Multi-Agent Orchestration Engine
 *
 * Lead Agent + Specialist Subagents with:
 * - Role-based tool access (researcher, implementer, reviewer, tester, planner)
 * - Parallel execution of independent work nodes
 * - File lock registry (prevent conflicts)
 * - Work graph with dependency tracking
 * - Structured markdown reports
 * - Heartbeat monitoring
 * - Merge layer for the lead agent
 */

const { logger } = require('./logger');

// ══════════════════════════════════════════
//  Agent Roles — Scoped Tool Access
// ══════════════════════════════════════════

const AGENT_ROLES = {
    researcher: {
        label: 'Researcher',
        icon: '🔍',
        tools: [
            'read_file', 'search_files', 'list_directory', 'glob_files',
            'explore_codebase', 'index_project', 'semantic_search',
            'find_symbol', 'find_references', 'list_symbols', 'get_type_info',
            'webfetch', 'websearch', 'get_context_summary',
        ],
        canWrite: false,
        maxRounds: 15,
        description: 'Research, explore, and analyze code. Read-only access with web search.',
    },
    implementer: {
        label: 'Implementer',
        icon: '🔨',
        tools: [
            'read_file', 'search_files', 'list_directory', 'glob_files',
            'create_file', 'edit_file', 'multi_edit', 'delete_file',
            'run_command', 'task_update',
        ],
        canWrite: true,
        maxRounds: 25,
        description: 'Create and modify files within assigned file scope.',
    },
    reviewer: {
        label: 'Reviewer',
        icon: '👁️',
        tools: [
            'read_file', 'search_files', 'list_directory', 'glob_files',
            'list_symbols', 'find_references', 'find_symbol', 'get_type_info',
            'run_command', 'git_diff', 'git_log',
        ],
        canWrite: false,
        maxRounds: 10,
        description: 'Review code quality, find bugs, suggest improvements. Read-only.',
    },
    tester: {
        label: 'Tester',
        icon: '🧪',
        tools: [
            'read_file', 'search_files', 'list_directory', 'glob_files',
            'create_file', 'edit_file', 'run_command',
            'browser_navigate', 'browser_screenshot', 'browser_console_logs',
            'browser_evaluate', 'browser_click', 'browser_type', 'browser_close',
        ],
        canWrite: true,
        maxRounds: 15,
        description: 'Write and run tests, browser verification, quality assurance.',
    },
    planner: {
        label: 'Planner',
        icon: '📋',
        tools: [
            'read_file', 'search_files', 'list_directory', 'glob_files',
            'explore_codebase', 'index_project', 'semantic_search',
            'task_add', 'task_list', 'milestone_create',
        ],
        canWrite: false,
        maxRounds: 10,
        description: 'Analyze codebase, create task plans, define milestones.',
    },
};

function getRole(roleName) {
    return AGENT_ROLES[roleName] || AGENT_ROLES.researcher;
}

function getRoleToolNames(roleName) {
    return getRole(roleName).tools;
}

// ══════════════════════════════════════════
//  File Lock Registry
// ══════════════════════════════════════════

class FileLockRegistry {
    constructor() {
        this.locks = new Map(); // filepath -> { agentId, acquiredAt, role }
    }

    /**
     * Acquire a lock on a file path for a specific agent.
     * Returns { acquired: true } or { acquired: false, owner: agentId }
     */
    acquire(filepath, agentId, role) {
        const existing = this.locks.get(filepath);
        if (existing && existing.agentId !== agentId) {
            return { acquired: false, owner: existing.agentId, role: existing.role };
        }
        this.locks.set(filepath, { agentId, acquiredAt: Date.now(), role });
        return { acquired: true };
    }

    /**
     * Acquire locks on a glob pattern (e.g., "src/components/**")
     */
    acquireScope(patterns, agentId, role) {
        const results = [];
        for (const pattern of patterns) {
            results.push({ pattern, ...this.acquire(pattern, agentId, role) });
        }
        return results;
    }

    release(filepath, agentId) {
        const existing = this.locks.get(filepath);
        if (existing && existing.agentId === agentId) {
            this.locks.delete(filepath);
            return true;
        }
        return false;
    }

    releaseAll(agentId) {
        let released = 0;
        for (const [fp, lock] of this.locks) {
            if (lock.agentId === agentId) {
                this.locks.delete(fp);
                released++;
            }
        }
        return released;
    }

    isLocked(filepath) {
        return this.locks.has(filepath);
    }

    getOwner(filepath) {
        // Exact match
        const exact = this.locks.get(filepath);
        if (exact) return exact;

        // Check if any pattern lock covers this file
        for (const [pattern, lock] of this.locks) {
            if (this._matchesPattern(filepath, pattern)) {
                return lock;
            }
        }
        return null;
    }

    /**
     * Check if a file write is allowed for a given agent.
     * Returns { allowed: true } or { allowed: false, owner, reason }
     */
    checkWrite(filepath, agentId) {
        const owner = this.getOwner(filepath);
        if (!owner) return { allowed: true };
        if (owner.agentId === agentId) return { allowed: true };
        return {
            allowed: false,
            owner: owner.agentId,
            reason: `File "${filepath}" is locked by agent ${owner.agentId} (${owner.role})`,
        };
    }

    getAll() {
        return [...this.locks.entries()].map(([fp, lock]) => ({
            path: fp,
            agentId: lock.agentId,
            role: lock.role,
            acquiredAt: lock.acquiredAt,
        }));
    }

    clear() {
        this.locks.clear();
    }

    _matchesPattern(filepath, pattern) {
        // Simple glob matching: "src/components/**" matches "src/components/Button.tsx"
        if (pattern.endsWith('/**')) {
            const prefix = pattern.slice(0, -3);
            return filepath.startsWith(prefix);
        }
        if (pattern.endsWith('/*')) {
            const prefix = pattern.slice(0, -2);
            const rest = filepath.slice(prefix.length);
            return filepath.startsWith(prefix) && !rest.includes('/');
        }
        return filepath === pattern;
    }
}

// ══════════════════════════════════════════
//  Work Graph — Dependency-Aware Scheduling
// ══════════════════════════════════════════

class WorkGraph {
    constructor() {
        this.nodes = new Map(); // nodeId -> WorkNode
    }

    /**
     * Add a work node to the graph.
     * @param {string} id - Unique node ID
     * @param {string} task - Task description
     * @param {string} role - Agent role (researcher, implementer, etc.)
     * @param {string[]} deps - Array of node IDs this depends on
     * @param {string[]} fileScope - Files/patterns this node owns
     * @param {string[]} contextFiles - Files to pass as context
     */
    addNode(id, task, role, deps = [], fileScope = [], contextFiles = []) {
        this.nodes.set(id, {
            id,
            task,
            role,
            deps,
            fileScope,
            contextFiles,
            status: 'pending',  // pending | running | done | failed | skipped
            agentId: null,
            result: null,
            error: null,
            startedAt: null,
            completedAt: null,
            rounds: 0,
        });
        return this;
    }

    /**
     * Get nodes that are ready to execute (all deps satisfied).
     */
    getReady() {
        const ready = [];
        for (const node of this.nodes.values()) {
            if (node.status !== 'pending') continue;
            const depsOk = node.deps.every(depId => {
                const dep = this.nodes.get(depId);
                return dep && (dep.status === 'done' || dep.status === 'skipped');
            });
            if (depsOk) ready.push(node);
        }
        return ready;
    }

    markRunning(id, agentId) {
        const node = this.nodes.get(id);
        if (node) {
            node.status = 'running';
            node.agentId = agentId;
            node.startedAt = Date.now();
        }
    }

    markDone(id, result, rounds = 0) {
        const node = this.nodes.get(id);
        if (node) {
            node.status = 'done';
            node.result = result;
            node.completedAt = Date.now();
            node.rounds = rounds;
        }
    }

    markFailed(id, error) {
        const node = this.nodes.get(id);
        if (node) {
            node.status = 'failed';
            node.error = error;
            node.completedAt = Date.now();
        }
    }

    markSkipped(id, reason) {
        const node = this.nodes.get(id);
        if (node) {
            node.status = 'skipped';
            node.error = reason;
            node.completedAt = Date.now();
        }
    }

    isComplete() {
        for (const node of this.nodes.values()) {
            if (node.status === 'pending' || node.status === 'running') return false;
        }
        return true;
    }

    getSummary() {
        const nodes = [...this.nodes.values()];
        return {
            total: nodes.length,
            pending: nodes.filter(n => n.status === 'pending').length,
            running: nodes.filter(n => n.status === 'running').length,
            done: nodes.filter(n => n.status === 'done').length,
            failed: nodes.filter(n => n.status === 'failed').length,
            skipped: nodes.filter(n => n.status === 'skipped').length,
            nodes: nodes.map(n => ({
                id: n.id,
                task: n.task,
                role: n.role,
                status: n.status,
                agentId: n.agentId,
                deps: n.deps,
                rounds: n.rounds,
                duration: n.completedAt && n.startedAt ? n.completedAt - n.startedAt : null,
            })),
        };
    }

    toJSON() {
        return this.getSummary();
    }
}

// ══════════════════════════════════════════
//  Specialist Agent Executor
// ══════════════════════════════════════════

let _mainWindow = null;
let _makeAICall = null;
let _executeTool = null;
let _TOOL_DEFINITIONS = [];
let _activeAgentMap = null;

function setOrchestratorDeps({ mainWindow, makeAICall, executeTool, TOOL_DEFINITIONS, activeAgents }) {
    _mainWindow = mainWindow;
    _makeAICall = makeAICall;
    _executeTool = executeTool;
    _TOOL_DEFINITIONS = TOOL_DEFINITIONS;
    _activeAgentMap = activeAgents;
}

function sendToRenderer(channel, data) {
    if (_mainWindow?.webContents) {
        _mainWindow.webContents.send(channel, data);
    }
}

/**
 * Execute a specialist agent with role-scoped tools and file scope.
 */
async function executeSpecialist(agentId, task, role, fileScope, contextFiles, providerConfig) {
    const roleConfig = getRole(role);
    if (!_makeAICall) {
        return { error: 'AI call function not configured' };
    }

    // Build role-specific tool set
    const allowedToolNames = new Set(roleConfig.tools);
    const roleTools = _TOOL_DEFINITIONS.filter(t => allowedToolNames.has(t.function.name));

    // Build context from files
    const fs = require('fs');
    const os = require('os');
    let fileContextStr = '';
    if (contextFiles && contextFiles.length > 0) {
        for (const fp of contextFiles) {
            try {
                const expanded = fp.replace(/^~/, os.homedir());
                if (fs.existsSync(expanded)) {
                    const content = fs.readFileSync(expanded, 'utf-8');
                    fileContextStr += `\n\n--- File: ${fp} ---\n${content.slice(0, 8000)}`;
                }
            } catch { /* skip */ }
        }
    }

    const systemPrompt = `You are a specialized ${roleConfig.label} agent in the Onicode multi-agent system.

## Your Role: ${roleConfig.label}
${roleConfig.description}

## Your Task
${task}

## Rules
- Focus ONLY on your assigned task. Do not deviate.
- Complete the task and return a clear, structured report.
${roleConfig.canWrite ? `- You may create/modify files ONLY within your assigned scope: ${fileScope.length > 0 ? fileScope.join(', ') : 'any files related to your task'}` : '- You are READ-ONLY. Do not attempt to create or modify files.'}
- Be efficient: batch operations where possible.
- Return your findings in a structured markdown format with sections.

## Report Format
When done, respond with a markdown report:
### Summary
Brief description of what you did/found.

### Findings / Changes
Detailed results, file paths, code snippets, or changes made.

### Issues
Any problems encountered or concerns.

### Recommendations
Suggestions for next steps.
${fileContextStr ? `\n## Context Files\n${fileContextStr}` : ''}`;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task },
    ];

    const MAX_ROUNDS = roleConfig.maxRounds;
    const toolsUsed = [];
    let lastHeartbeat = Date.now();

    try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
            // Heartbeat
            if (Date.now() - lastHeartbeat > 2000) {
                sendToRenderer('ai-agent-step', {
                    round,
                    status: 'specialist',
                    agentId,
                    task: task.slice(0, 80),
                    role,
                    progress: `Round ${round + 1}/${MAX_ROUNDS}`,
                });
                lastHeartbeat = Date.now();
            }

            const result = await _makeAICall(messages, providerConfig, roleTools);

            if (result.error) {
                return { error: result.error, toolsUsed, rounds: round + 1 };
            }

            // No tool calls — agent is done
            if (!result.hasToolCalls && !(result.functionCalls?.length > 0)) {
                return {
                    content: result.textContent || result.content || '',
                    toolsUsed,
                    rounds: round + 1,
                    role,
                };
            }

            // Execute tool calls
            const toolCalls = result.toolCalls || result.functionCalls || [];
            const assistantMsg = { role: 'assistant', content: result.textContent || null };
            if (toolCalls.length > 0) {
                assistantMsg.tool_calls = toolCalls.map(tc => ({
                    id: tc.id || tc.call_id,
                    type: 'function',
                    function: { name: tc.name, arguments: tc.arguments },
                }));
            }
            messages.push(assistantMsg);

            for (const tc of toolCalls) {
                let args;
                try { args = JSON.parse(tc.arguments); } catch { args = {}; }

                toolsUsed.push(tc.name);

                // Enforce role tool whitelist
                if (!allowedToolNames.has(tc.name)) {
                    messages.push({
                        role: 'tool',
                        tool_call_id: tc.id || tc.call_id,
                        content: JSON.stringify({
                            error: `Tool "${tc.name}" is not available to ${roleConfig.label} agents. Available tools: ${roleConfig.tools.join(', ')}`,
                        }),
                    });
                    continue;
                }

                // Enforce file scope for write operations
                if (roleConfig.canWrite && fileScope.length > 0) {
                    const filePath = args.file_path || args.path;
                    if (filePath && ['create_file', 'edit_file', 'multi_edit', 'delete_file'].includes(tc.name)) {
                        const inScope = fileScope.some(pattern => {
                            if (pattern.endsWith('/**')) return filePath.startsWith(pattern.slice(0, -3));
                            if (pattern.endsWith('/*')) {
                                const prefix = pattern.slice(0, -2);
                                return filePath.startsWith(prefix) && !filePath.slice(prefix.length).includes('/');
                            }
                            return filePath === pattern || filePath.startsWith(pattern);
                        });
                        if (!inScope) {
                            messages.push({
                                role: 'tool',
                                tool_call_id: tc.id || tc.call_id,
                                content: JSON.stringify({
                                    error: `File "${filePath}" is outside your assigned scope: ${fileScope.join(', ')}. Only modify files within your scope.`,
                                }),
                            });
                            continue;
                        }
                    }
                }

                // Execute the tool
                const toolResult = await _executeTool(tc.name, args);

                // Notify renderer of specialist tool activity
                sendToRenderer('ai-tool-call', {
                    id: tc.id || tc.call_id,
                    name: tc.name,
                    args,
                    round,
                    agentId,
                    role,
                });
                sendToRenderer('ai-tool-result', {
                    id: tc.id || tc.call_id,
                    name: tc.name,
                    result: toolResult,
                    round,
                    agentId,
                    role,
                });

                messages.push({
                    role: 'tool',
                    tool_call_id: tc.id || tc.call_id,
                    content: JSON.stringify(toolResult).slice(0, 16000),
                });
            }
        }

        return {
            content: `Specialist agent (${role}) reached max rounds (${MAX_ROUNDS}).`,
            toolsUsed,
            rounds: MAX_ROUNDS,
            role,
        };
    } catch (err) {
        return { error: err.message, toolsUsed, rounds: 0, role };
    }
}

// ══════════════════════════════════════════
//  Subagent Orchestrator
// ══════════════════════════════════════════

// Active orchestration sessions
const activeOrchestrations = new Map();

/**
 * Orchestrate a multi-agent workflow.
 *
 * @param {Object} plan - The work plan
 * @param {Array} plan.nodes - Array of work nodes: { id, task, role, deps, fileScope, contextFiles }
 * @param {number} plan.maxParallel - Max concurrent agents (default 3)
 * @param {string} plan.description - Overall task description
 * @param {Object} providerConfig - AI provider config
 * @returns {Object} Merged results from all agents
 */
async function orchestrate(plan, providerConfig) {
    const orchestrationId = `orch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const maxParallel = plan.maxParallel || 3;
    const graph = new WorkGraph();
    const fileLocks = new FileLockRegistry();

    // Build work graph
    for (const node of plan.nodes) {
        graph.addNode(
            node.id,
            node.task,
            node.role || 'researcher',
            node.deps || [],
            node.fileScope || [],
            node.contextFiles || [],
        );
    }

    const orchestration = {
        id: orchestrationId,
        description: plan.description || 'Multi-agent orchestration',
        graph,
        fileLocks,
        startedAt: Date.now(),
        completedAt: null,
        status: 'running',
    };
    activeOrchestrations.set(orchestrationId, orchestration);

    logger.info('orchestrator', `Starting orchestration ${orchestrationId}: ${plan.nodes.length} nodes, max ${maxParallel} parallel`);
    sendToRenderer('ai-orchestration-start', {
        id: orchestrationId,
        description: orchestration.description,
        nodeCount: plan.nodes.length,
        graph: graph.getSummary(),
    });
    // Also send agent-step so ChatView auto-opens the Agents panel
    sendToRenderer('ai-agent-step', { round: 0, status: 'orchestration-start', orchestrationId });

    try {
        // Process work graph in dependency order with parallelism
        while (!graph.isComplete()) {
            const ready = graph.getReady();
            if (ready.length === 0) {
                // Check for deadlock (no ready nodes but graph not complete)
                const summary = graph.getSummary();
                if (summary.running === 0) {
                    logger.error('orchestrator', `Deadlock detected in orchestration ${orchestrationId}`);
                    break;
                }
                // Wait for running agents to complete
                await new Promise(r => setTimeout(r, 500));
                continue;
            }

            // Take up to maxParallel ready nodes
            const batch = ready.slice(0, maxParallel);

            logger.info('orchestrator', `Executing batch of ${batch.length} agents: ${batch.map(n => `${n.id}(${n.role})`).join(', ')}`);

            // Acquire file locks for the batch
            for (const node of batch) {
                if (node.fileScope.length > 0) {
                    const lockResults = fileLocks.acquireScope(node.fileScope, node.id, node.role);
                    const blocked = lockResults.filter(r => !r.acquired);
                    if (blocked.length > 0) {
                        logger.warn('orchestrator', `Agent ${node.id} blocked on file locks: ${blocked.map(b => b.pattern).join(', ')}`);
                        graph.markSkipped(node.id, `File lock conflict: ${blocked.map(b => `${b.pattern} owned by ${b.owner}`).join(', ')}`);
                        continue;
                    }
                }
            }

            // Execute batch in parallel
            const activeBatch = batch.filter(n => n.status !== 'skipped');
            const promises = activeBatch.map(async (node) => {
                const agentId = `specialist_${node.id}_${Date.now()}`;
                graph.markRunning(node.id, agentId);

                // Register in global agent tracking
                if (_activeAgentMap) {
                    _activeAgentMap.set(agentId, {
                        id: agentId,
                        task: node.task,
                        status: 'running',
                        createdAt: Date.now(),
                        messages: [],
                        result: null,
                        parentContext: { orchestrationId, nodeId: node.id, role: node.role },
                        toolsUsed: [],
                        role: node.role,
                    });
                }

                sendToRenderer('ai-agent-step', {
                    round: 0,
                    status: 'specialist',
                    agentId,
                    task: node.task,
                    role: node.role,
                    orchestrationId,
                });

                try {
                    const result = await executeSpecialist(
                        agentId,
                        node.task,
                        node.role,
                        node.fileScope,
                        node.contextFiles,
                        providerConfig,
                    );

                    if (result.error) {
                        graph.markFailed(node.id, result.error);
                        if (_activeAgentMap) {
                            const agent = _activeAgentMap.get(agentId);
                            if (agent) { agent.status = 'error'; agent.result = { error: result.error }; }
                        }
                    } else {
                        graph.markDone(node.id, result.content, result.rounds);
                        if (_activeAgentMap) {
                            const agent = _activeAgentMap.get(agentId);
                            if (agent) { agent.status = 'done'; agent.result = { content: result.content }; }
                        }
                    }

                    // Release file locks
                    fileLocks.releaseAll(node.id);

                    return { nodeId: node.id, agentId, result };
                } catch (err) {
                    graph.markFailed(node.id, err.message);
                    fileLocks.releaseAll(node.id);
                    if (_activeAgentMap) {
                        const agent = _activeAgentMap.get(agentId);
                        if (agent) { agent.status = 'error'; agent.result = { error: err.message }; }
                    }
                    return { nodeId: node.id, agentId, result: { error: err.message } };
                }
            });

            // Wait for all agents in this batch to complete
            const results = await Promise.all(promises);

            // Notify renderer of batch completion
            sendToRenderer('ai-orchestration-progress', {
                id: orchestrationId,
                graph: graph.getSummary(),
                completedBatch: results.map(r => ({
                    nodeId: r.nodeId,
                    agentId: r.agentId,
                    success: !r.result.error,
                })),
            });
        }

        // Build merged report (pass full graph so we can include result content)
        const summary = graph.getSummary();
        const report = buildMergedReport(orchestrationId, orchestration.description, summary, graph);

        orchestration.status = 'done';
        orchestration.completedAt = Date.now();

        logger.info('orchestrator', `Orchestration ${orchestrationId} complete: ${summary.done}/${summary.total} done, ${summary.failed} failed`);
        sendToRenderer('ai-orchestration-done', {
            id: orchestrationId,
            summary,
            report,
            duration: orchestration.completedAt - orchestration.startedAt,
        });

        const orchResult = {
            orchestration_id: orchestrationId,
            status: summary.failed > 0 ? 'partial' : 'done',
            summary,
            report,
            duration_ms: orchestration.completedAt - orchestration.startedAt,
        };

        if (summary.failed > 0) {
            const failedNodes = summary.nodes.filter(n => n.status === 'failed');
            const failedDetails = failedNodes.map(n => {
                const fullNode = graph.nodes.get(n.id);
                return `- "${n.task}" (${n.role}): ${fullNode?.error || 'unknown error'}`;
            }).join('\n');
            orchResult.IMPORTANT = `Orchestration had ${summary.failed} FAILED agent(s):\n${failedDetails}\n\nYou must handle these failures — either do the work yourself, retry with a different approach, or explain to the user why it failed.`;
        }

        return orchResult;

    } catch (err) {
        orchestration.status = 'error';
        orchestration.completedAt = Date.now();
        logger.error('orchestrator', `Orchestration ${orchestrationId} failed: ${err.message}`);
        return { orchestration_id: orchestrationId, status: 'error', error: err.message };
    }
}

/**
 * Build a merged markdown report from all agent results.
 * @param {string} orchestrationId
 * @param {string} description
 * @param {Object} summary - From graph.getSummary()
 * @param {WorkGraph} graph - Full graph for accessing result content
 */
function buildMergedReport(orchestrationId, description, summary, graph) {
    const parts = [`# Orchestration Report: ${description}\n`];
    parts.push(`**ID:** ${orchestrationId}`);
    parts.push(`**Status:** ${summary.done}/${summary.total} nodes completed, ${summary.failed} failed\n`);

    // Group by role
    const byRole = {};
    for (const node of summary.nodes) {
        if (!byRole[node.role]) byRole[node.role] = [];
        byRole[node.role].push(node);
    }

    for (const [role, nodes] of Object.entries(byRole)) {
        const roleConfig = getRole(role);
        parts.push(`## ${roleConfig.icon} ${roleConfig.label} Agents\n`);
        for (const node of nodes) {
            const statusIcon = node.status === 'done' ? '✅' : node.status === 'failed' ? '❌' : node.status === 'skipped' ? '⏭️' : '⏳';
            parts.push(`### ${statusIcon} ${node.id}: ${node.task}`);
            parts.push(`- **Status:** ${node.status}`);
            if (node.rounds > 0) parts.push(`- **Rounds:** ${node.rounds}`);
            if (node.duration) parts.push(`- **Duration:** ${Math.round(node.duration / 1000)}s`);

            // Include actual result content from the graph
            if (graph) {
                const fullNode = graph.nodes.get(node.id);
                if (fullNode?.result) {
                    // Truncate long results to keep the report manageable
                    const content = String(fullNode.result).slice(0, 3000);
                    parts.push(`\n**Result:**\n${content}`);
                }
                if (fullNode?.error) {
                    parts.push(`\n**Error:** ${fullNode.error}`);
                }
            }
            parts.push('');
        }
    }

    return parts.join('\n');
}

/**
 * Get detailed results from an orchestration.
 */
function getOrchestrationResult(orchestrationId) {
    const orch = activeOrchestrations.get(orchestrationId);
    if (!orch) return null;
    return {
        id: orch.id,
        description: orch.description,
        status: orch.status,
        startedAt: orch.startedAt,
        completedAt: orch.completedAt,
        duration: orch.completedAt ? orch.completedAt - orch.startedAt : Date.now() - orch.startedAt,
        graph: orch.graph.getSummary(),
        fileLocks: orch.fileLocks.getAll(),
        nodeResults: [...orch.graph.nodes.values()].map(n => ({
            id: n.id,
            task: n.task,
            role: n.role,
            status: n.status,
            result: n.result,
            error: n.error,
            rounds: n.rounds,
        })),
    };
}

function listOrchestrations() {
    return [...activeOrchestrations.values()].map(o => ({
        id: o.id,
        description: o.description,
        status: o.status,
        startedAt: o.startedAt,
        completedAt: o.completedAt,
        nodeCount: o.graph.nodes.size,
        summary: o.graph.getSummary(),
    }));
}

// ══════════════════════════════════════════
//  Tool Definitions for AI
// ══════════════════════════════════════════

const ORCHESTRATOR_TOOL_DEFINITIONS = [
    {
        type: 'function',
        function: {
            name: 'orchestrate',
            description: 'Launch a multi-agent orchestration. Decomposes work into specialist agents that run in parallel with dependency tracking. Use for large tasks that benefit from specialization (e.g., research + implement + test). Returns a merged report from all agents.',
            parameters: {
                type: 'object',
                properties: {
                    description: {
                        type: 'string',
                        description: 'Overall description of the orchestration goal',
                    },
                    nodes: {
                        type: 'array',
                        description: 'Array of work nodes for specialist agents',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string', description: 'Unique node ID (short, like "research", "impl-auth", "test")' },
                                task: { type: 'string', description: 'Detailed task description for the specialist agent' },
                                role: {
                                    type: 'string',
                                    enum: ['researcher', 'implementer', 'reviewer', 'tester', 'planner'],
                                    description: 'Specialist role: researcher (read-only explore), implementer (create/edit files), reviewer (code review), tester (write/run tests), planner (create task plans)',
                                },
                                deps: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'Node IDs this depends on (will wait for them to complete first)',
                                },
                                file_scope: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'File paths/patterns this agent owns (e.g., ["src/auth/**", "src/types/auth.ts"]). Implementers can only write within their scope.',
                                },
                                context_files: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'File paths to read and inject as context for this agent',
                                },
                            },
                            required: ['id', 'task', 'role'],
                        },
                    },
                    max_parallel: {
                        type: 'number',
                        description: 'Maximum number of agents to run in parallel (default: 3)',
                    },
                },
                required: ['description', 'nodes'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'spawn_specialist',
            description: 'Spawn a single specialist agent with a specific role. More targeted than orchestrate — use for one-off specialized tasks like code review, research, or focused implementation.',
            parameters: {
                type: 'object',
                properties: {
                    task: { type: 'string', description: 'Detailed task description' },
                    role: {
                        type: 'string',
                        enum: ['researcher', 'implementer', 'reviewer', 'tester', 'planner'],
                        description: 'Specialist role for the agent',
                    },
                    file_scope: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'File paths/patterns this agent can write to (implementer/tester only)',
                    },
                    context_files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'File paths to inject as context',
                    },
                },
                required: ['task', 'role'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_orchestration_status',
            description: 'Get the status and results of a multi-agent orchestration, including all node results and the merged report.',
            parameters: {
                type: 'object',
                properties: {
                    orchestration_id: { type: 'string', description: 'ID of the orchestration to check' },
                },
                required: ['orchestration_id'],
            },
        },
    },
];

// ══════════════════════════════════════════
//  Tool Executor
// ══════════════════════════════════════════

async function executeOrchestratorTool(name, args, providerConfig) {
    switch (name) {
        case 'orchestrate': {
            const plan = {
                description: args.description,
                nodes: (args.nodes || []).map(n => ({
                    id: n.id,
                    task: n.task,
                    role: n.role || 'researcher',
                    deps: n.deps || [],
                    fileScope: n.file_scope || [],
                    contextFiles: n.context_files || [],
                })),
                maxParallel: args.max_parallel || 3,
            };
            return orchestrate(plan, providerConfig);
        }

        case 'spawn_specialist': {
            const agentId = `specialist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const role = args.role || 'researcher';
            const fileScope = args.file_scope || [];
            const contextFiles = args.context_files || [];

            // Register in global agent tracking
            if (_activeAgentMap) {
                _activeAgentMap.set(agentId, {
                    id: agentId,
                    task: args.task,
                    status: 'running',
                    createdAt: Date.now(),
                    messages: [],
                    result: null,
                    parentContext: { role },
                    toolsUsed: [],
                    role,
                });
            }

            sendToRenderer('ai-agent-step', {
                round: 0,
                status: 'specialist',
                agentId,
                task: args.task,
                role,
            });

            const result = await executeSpecialist(agentId, args.task, role, fileScope, contextFiles, providerConfig);

            // Update global tracking
            if (_activeAgentMap) {
                const agent = _activeAgentMap.get(agentId);
                if (agent) {
                    agent.status = result.error ? 'error' : 'done';
                    agent.result = result.error ? { error: result.error } : { content: result.content };
                }
            }

            const specialistResult = {
                agent_id: agentId,
                task: args.task,
                role,
                status: result.error ? 'error' : 'done',
                tools_used: result.toolsUsed || [],
                rounds: result.rounds || 0,
            };

            if (result.error) {
                specialistResult.error = result.error;
                specialistResult.IMPORTANT = `Specialist "${role}" FAILED: ${result.error}. You must handle this — retry with different approach, do it yourself, or skip.`;
            } else {
                specialistResult.findings = result.content || '(no output)';
                specialistResult.IMPORTANT = `Specialist "${role}" completed. READ the "findings" field — it contains the actual work output. Use it to inform your next steps.`;
            }

            return specialistResult;
        }

        case 'get_orchestration_status': {
            const result = getOrchestrationResult(args.orchestration_id);
            if (!result) return { error: `Orchestration ${args.orchestration_id} not found` };
            return result;
        }

        default:
            return { error: `Unknown orchestrator tool: ${name}` };
    }
}

// ══════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════

function registerOrchestratorIPC(ipcMain) {
    ipcMain.handle('orchestration-list', () => listOrchestrations());
    ipcMain.handle('orchestration-get', (_event, id) => getOrchestrationResult(id));
}

// ══════════════════════════════════════════
//  Exports
// ══════════════════════════════════════════

module.exports = {
    AGENT_ROLES,
    ORCHESTRATOR_TOOL_DEFINITIONS,
    FileLockRegistry,
    WorkGraph,
    setOrchestratorDeps,
    executeOrchestratorTool,
    executeSpecialist,
    orchestrate,
    getOrchestrationResult,
    listOrchestrations,
    registerOrchestratorIPC,
    getRole,
    getRoleToolNames,
};
