import React, { useState, useEffect, useCallback } from 'react';
import { isElectron } from '../../utils';

interface AgentEntry { id: string; task: string; status: string; createdAt: number; result?: string; }
interface BgProcess { id: string; command: string; status: string; pid?: number; port?: number; startedAt?: number; }

const ROLE_BADGES: Record<string, { icon: string; color: string }> = {
    researcher: { icon: '🔍', color: 'var(--role-researcher, #60a5fa)' },
    implementer: { icon: '🔨', color: 'var(--role-implementer, #f59e0b)' },
    reviewer: { icon: '👁️', color: 'var(--role-reviewer, #a78bfa)' },
    tester: { icon: '🧪', color: 'var(--role-tester, #34d399)' },
    planner: { icon: '📋', color: 'var(--role-planner, #fb923c)' },
};

interface SubAgentToolCall {
    id: string;
    name: string;
    agentId: string;
    role?: string;
    status: 'running' | 'done';
    round: number;
}

function AgentsWidget() {
    const [agents, setAgents] = useState<AgentEntry[]>([]);
    const [bgProcesses, setBgProcesses] = useState<BgProcess[]>([]);
    const [agentStatus, setAgentStatus] = useState<{ round: number; status: string; role?: string } | null>(null);
    const [subAgentTools, setSubAgentTools] = useState<SubAgentToolCall[]>([]);
    const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
    const [orchestrations, setOrchestrations] = useState<Array<{
        id: string; description: string; status: string; nodeCount: number;
        summary?: { total: number; done: number; running: number; failed: number; nodes: Array<{ id: string; task: string; role: string; status: string }> };
    }>>([]);
    const [taskSummary, setTaskSummary] = useState<{ total: number; done: number; inProgress: number; pending: number } | null>(null);
    const [projectName, setProjectName] = useState<string | null>(null);

    // Load project context for idle display
    useEffect(() => {
        try {
            const stored = localStorage.getItem('onicode-active-project');
            if (stored) {
                const proj = JSON.parse(stored);
                setProjectName(proj.name || null);
            }
        } catch { /* ignore */ }
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.name) setProjectName(detail.name);
        };
        window.addEventListener('onicode-project-activate', handler);
        return () => window.removeEventListener('onicode-project-activate', handler);
    }, []);

    // Listen for task updates to show in idle state
    useEffect(() => {
        if (!window.onicode?.onTasksUpdated) return;
        const unsub = window.onicode.onTasksUpdated((data) => {
            const d = data as { total: number; done: number; inProgress: number; pending?: number; tasks?: unknown[] };
            setTaskSummary({ total: d.total, done: d.done, inProgress: d.inProgress, pending: d.pending ?? (d.total - d.done - d.inProgress) });
        });
        return unsub;
    }, []);

    // Poll agents + background processes + orchestrations
    const refresh = useCallback(async () => {
        if (!isElectron) return;
        try {
            const [agentList, procList] = await Promise.all([
                window.onicode!.listAgents(),
                window.onicode!.listBackgroundProcesses(),
            ]);
            setAgents(agentList || []);
            setBgProcesses(procList || []);
            // Poll orchestrations — wrapped separately so IPC errors don't break agent/process polling
            try {
                if (window.onicode?.orchestrationList) {
                    const orchList = await window.onicode.orchestrationList();
                    setOrchestrations(orchList || []);
                }
            } catch { /* orchestration IPC not registered yet — silent */ }
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        refresh();
        const interval = setInterval(refresh, 3000);
        return () => clearInterval(interval);
    }, [refresh]);

    // Real-time agent step events
    useEffect(() => {
        if (!window.onicode?.onAgentStep) return;
        const unsub = window.onicode.onAgentStep((data) => {
            setAgentStatus(data as { round: number; status: string; role?: string });
            if (data.agentId) refresh();
        });
        return unsub;
    }, [refresh]);

    // Real-time orchestration events
    useEffect(() => {
        if (!window.onicode?.onOrchestrationProgress) return;
        const unsub = window.onicode.onOrchestrationProgress(() => refresh());
        return unsub;
    }, [refresh]);

    useEffect(() => {
        if (!window.onicode?.onOrchestrationDone) return;
        const unsub = window.onicode.onOrchestrationDone(() => refresh());
        return unsub;
    }, [refresh]);

    // Real-time terminal session events
    useEffect(() => {
        if (!window.onicode?.onTerminalSession) return;
        const unsub = window.onicode.onTerminalSession(() => refresh());
        return unsub;
    }, [refresh]);

    // Track sub-agent tool calls (those with agentId)
    useEffect(() => {
        if (!window.onicode?.onToolCall) return;
        const unsubCall = window.onicode.onToolCall((data) => {
            const d = data as Record<string, unknown>;
            if (!d.agentId) return; // Only track sub-agent tool calls
            setSubAgentTools(prev => [...prev, {
                id: String(d.id),
                name: String(d.name),
                agentId: String(d.agentId),
                role: d.role ? String(d.role) : undefined,
                status: 'running',
                round: Number(d.round || 0),
            }]);
        });
        const unsubResult = window.onicode.onToolResult((data) => {
            const d = data as Record<string, unknown>;
            if (!d.agentId) return;
            setSubAgentTools(prev => prev.map(t =>
                t.id === String(d.id) ? { ...t, status: 'done' as const } : t
            ));
        });
        // Clear sub-agent tools when streaming ends
        const unsubDone = window.onicode.onStreamDone(() => {
            setSubAgentTools([]);
            setExpandedAgents(new Set());
        });
        return () => { unsubCall(); unsubResult(); unsubDone(); };
    }, []);

    const toggleAgentExpand = (agentId: string) => {
        setExpandedAgents(prev => {
            const next = new Set(prev);
            if (next.has(agentId)) next.delete(agentId);
            else next.add(agentId);
            return next;
        });
    };

    const killProcess = async (id: string) => {
        if (!isElectron) return;
        await window.onicode!.killBackgroundProcess(id);
        refresh();
    };

    const running = agents.filter(a => a.status === 'running').length + bgProcesses.filter(p => p.status === 'running').length;
    const activeOrchs = orchestrations.filter(o => o.status === 'running');
    const hasAnything = agents.length > 0 || bgProcesses.length > 0 || agentStatus || orchestrations.length > 0;

    return (
        <div className="widget-agents">
            <div className="agents-header">
                {(running > 0 || activeOrchs.length > 0) && (
                    <span className="agents-running-badge">
                        {running + activeOrchs.length} active
                    </span>
                )}
                {agentStatus && (
                    <span className="agents-current-status">
                        {agentStatus.status === 'thinking' && 'AI thinking...'}
                        {agentStatus.status === 'executing' && 'Executing tools...'}
                        {agentStatus.status === 'streaming' && 'Generating...'}
                        {agentStatus.status === 'continuing' && 'Auto-continuing...'}
                        {agentStatus.status === 'sub-agent' && 'Sub-agent working...'}
                        {agentStatus.status === 'specialist' && `${ROLE_BADGES[agentStatus.role || '']?.icon || '⚡'} Specialist working...`}
                        {agentStatus.round > 0 && ` (round ${agentStatus.round + 1})`}
                    </span>
                )}
            </div>

            {!hasAnything ? (
                <div className="widget-placeholder">
                    {projectName || taskSummary ? (
                        <>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5">
                                <circle cx="12" cy="12" r="3" />
                                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4" />
                            </svg>
                            <p style={{ marginBottom: 4 }}>Idle{projectName ? ` — ${projectName}` : ''}</p>
                            {taskSummary && taskSummary.total > 0 && (
                                <div style={{ fontSize: '0.8rem', opacity: 0.7, lineHeight: 1.5 }}>
                                    <span>{taskSummary.done}/{taskSummary.total} tasks done</span>
                                    {taskSummary.inProgress > 0 && <span> · {taskSummary.inProgress} active</span>}
                                    {taskSummary.pending > 0 && <span> · {taskSummary.pending} pending</span>}
                                </div>
                            )}
                            <span>Agents appear here during AI workflows</span>
                        </>
                    ) : (
                        <>
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
                                <circle cx="12" cy="12" r="3" />
                                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4" />
                            </svg>
                            <p>No active agents</p>
                            <span>Agents and processes appear here during AI workflows</span>
                        </>
                    )}
                </div>
            ) : (
                <div className="agents-list">
                    {/* Orchestrations */}
                    {orchestrations.length > 0 && (
                        <div className="agents-section">
                            <div className="agents-section-label">Orchestrations</div>
                            {orchestrations.map(o => (
                                <div key={o.id} className={`agent-item agent-item-${o.status}`}>
                                    <span className={`agent-dot ${o.status}`} />
                                    <div className="agent-item-info">
                                        <span className="agent-item-task">{o.description}</span>
                                        {o.summary && (
                                            <div className="orchestration-progress">
                                                <div className="orchestration-bar">
                                                    <div
                                                        className="orchestration-bar-fill"
                                                        style={{ width: `${o.summary.total > 0 ? (o.summary.done / o.summary.total) * 100 : 0}%` }}
                                                    />
                                                </div>
                                                <span className="orchestration-counts">
                                                    {o.summary.done}/{o.summary.total}
                                                    {o.summary.running > 0 && ` (${o.summary.running} running)`}
                                                    {o.summary.failed > 0 && ` (${o.summary.failed} failed)`}
                                                </span>
                                            </div>
                                        )}
                                        {o.summary?.nodes && (
                                            <div className="orchestration-nodes">
                                                {o.summary.nodes.map(n => {
                                                    const badge = ROLE_BADGES[n.role];
                                                    const statusClass = n.status === 'done' ? 'done' : n.status === 'running' ? 'running' : n.status === 'failed' ? 'error' : 'pending';
                                                    return (
                                                        <span key={n.id} className={`orch-node orch-node-${statusClass}`} title={`${n.task} (${n.role})`}>
                                                            {badge?.icon || '⚡'} {n.id}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Specialist & Sub-Agents */}
                    {agents.length > 0 && (
                        <div className="agents-section">
                            <div className="agents-section-label">Agents</div>
                            {agents.map(a => {
                                const role = (a as AgentEntry & { role?: string }).role;
                                const badge = role ? ROLE_BADGES[role] : null;
                                const agentTools = subAgentTools.filter(t => t.agentId === a.id);
                                const isExpanded = expandedAgents.has(a.id);
                                const runningTools = agentTools.filter(t => t.status === 'running').length;
                                const doneTools = agentTools.filter(t => t.status === 'done').length;
                                return (
                                    <div key={a.id} className={`agent-item agent-item-${a.status}`}>
                                        <span className={`agent-dot ${a.status}`} />
                                        <div className="agent-item-info">
                                            <div className="agent-item-header" onClick={() => agentTools.length > 0 && toggleAgentExpand(a.id)} style={{ cursor: agentTools.length > 0 ? 'pointer' : 'default' }}>
                                                {badge && (
                                                    <span className="agent-role-badge" style={{ color: badge.color }}>
                                                        {badge.icon} {role}
                                                    </span>
                                                )}
                                                <span className="agent-item-id">{a.id.slice(0, 12)}</span>
                                                {agentTools.length > 0 && (
                                                    <span className="agent-tool-count" style={{ marginLeft: 'auto', fontSize: '0.75rem', opacity: 0.7 }}>
                                                        {doneTools}/{agentTools.length} tools
                                                        {runningTools > 0 && <span className="agent-dot running" style={{ width: 6, height: 6, display: 'inline-block', marginLeft: 4 }} />}
                                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                                            style={{ marginLeft: 4, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
                                                            <polyline points="9 18 15 12 9 6" />
                                                        </svg>
                                                    </span>
                                                )}
                                            </div>
                                            <span className="agent-item-task">{a.task}</span>
                                            {isExpanded && agentTools.length > 0 && (
                                                <div className="agent-tools-list" style={{ marginTop: 4, paddingLeft: 8, borderLeft: '2px solid var(--border-primary)', fontSize: '0.75rem' }}>
                                                    {agentTools.map(t => (
                                                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 0', opacity: t.status === 'done' ? 0.6 : 1 }}>
                                                            <span className={`agent-dot ${t.status === 'done' ? 'done' : 'running'}`} style={{ width: 5, height: 5 }} />
                                                            <code style={{ fontSize: '0.7rem' }}>{t.name}</code>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            {a.result && !isExpanded && <span className="agent-item-result">{String(a.result).slice(0, 100)}</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Background Processes */}
                    {bgProcesses.length > 0 && (
                        <div className="agents-section">
                            <div className="agents-section-label">Background Processes</div>
                            {bgProcesses.map(p => (
                                <div key={p.id} className={`agent-item agent-item-${p.status}`}>
                                    <span className={`agent-dot ${p.status}`} />
                                    <div className="agent-item-info">
                                        <code className="agent-item-cmd">{p.command}</code>
                                        {p.port && <span className="agent-port">:{p.port}</span>}
                                    </div>
                                    {p.status === 'running' && (
                                        <button className="agent-kill-btn" onClick={() => killProcess(p.id)} title="Kill process">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                            </svg>
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default AgentsWidget;
