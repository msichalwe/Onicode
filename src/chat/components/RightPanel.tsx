import React, { useState, useEffect, useRef, useCallback } from 'react';

const isElectron = typeof window !== 'undefined' && !!window.onicode;

/** Strip ANSI escape codes for plain-text display */
function stripAnsi(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// ══════════════════════════════════════════
//  Widget Types (kernel layer)
// ══════════════════════════════════════════

export type WidgetType = 'terminal' | 'files' | 'agents' | 'project' | 'tasks' | 'git' | 'attachments';

export interface PanelState {
    widget: WidgetType | null;
    data?: Record<string, unknown>;
}

interface WidgetDef {
    id: WidgetType;
    label: string;
    icon: React.ReactNode;
}

const WIDGETS: WidgetDef[] = [
    { id: 'terminal', label: 'Terminal', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg> },
    { id: 'project', label: 'Project', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" /></svg> },
    { id: 'files', label: 'Files', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg> },
    { id: 'agents', label: 'Agents', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" /></svg> },
    { id: 'tasks', label: 'Tasks', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg> },
    { id: 'git', label: 'Git', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 012 2v7" /><line x1="6" y1="9" x2="6" y2="21" /></svg> },
    { id: 'attachments', label: 'Attachments', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></svg> },
];

// ══════════════════════════════════════════
//  Terminal Widget (real shell via IPC)
// ══════════════════════════════════════════

interface TerminalSession {
    id: string;
    command: string;
    cwd: string;
    startedAt: number;
    status: 'running' | 'done' | 'error';
    exitCode?: number;
    finishedAt?: number;
    duration?: number;
}

function TerminalWidget() {
    const [output, setOutput] = useState<string[]>([]);
    const [currentInput, setCurrentInput] = useState('');
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [cmdHistory, setCmdHistory] = useState<string[]>([]);
    const [historyIdx, setHistoryIdx] = useState(-1);
    const [aiSessions, setAiSessions] = useState<TerminalSession[]>([]);
    const [aiSessionOutput, setAiSessionOutput] = useState<Record<string, string[]>>({});
    const [activeAiSession, setActiveAiSession] = useState<string | null>(null);
    const [showSessions, setShowSessions] = useState(true);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const cleanupRef = useRef<Array<() => void>>([]);

    // Create terminal on mount
    useEffect(() => {
        if (!isElectron) {
            setOutput(['Terminal requires Electron desktop app.']);
            return;
        }

        let mounted = true;

        (async () => {
            const result = await window.onicode!.createTerminal();
            if (!mounted) return;
            if (result.sessionId) {
                setSessionId(result.sessionId);
                setOutput((prev) => [...prev, `$ Terminal session started (${result.sessionId})\n`]);
            } else {
                setOutput((prev) => [...prev, `Error: ${result.error}\n`]);
            }
        })();

        // Listen for output
        const removeOutput = window.onicode!.onTerminalOutput((data) => {
            if (!mounted) return;
            setOutput((prev) => [...prev, data.data]);
        });
        cleanupRef.current.push(removeOutput);

        const removeExit = window.onicode!.onTerminalExit((data) => {
            if (!mounted) return;
            setOutput((prev) => [...prev, `\n[Process exited with code ${data.code}]\n`]);
            setSessionId(null);
        });
        cleanupRef.current.push(removeExit);

        // Listen for AI terminal sessions (Cascade-like tracking)
        if (window.onicode?.onTerminalSession) {
            const removeSession = window.onicode.onTerminalSession((session) => {
                if (!mounted) return;
                setAiSessions((prev) => {
                    const idx = prev.findIndex(s => s.id === session.id);
                    if (idx >= 0) {
                        const updated = [...prev];
                        updated[idx] = session;
                        return updated;
                    }
                    return [...prev, session];
                });
            });
            cleanupRef.current.push(removeSession);
        }

        // Listen for real-time AI command output (routed by session ID)
        if (window.onicode?.onAITerminalOutput) {
            const removeAIOutput = window.onicode.onAITerminalOutput((chunk: { sessionId?: string; data: string }) => {
                if (!mounted) return;
                const text = stripAnsi(chunk.data);
                if (!text.trim()) return;
                if (chunk.sessionId) {
                    // Route output to the specific session
                    setAiSessionOutput((prev) => ({
                        ...prev,
                        [chunk.sessionId!]: [...(prev[chunk.sessionId!] || []), text],
                    }));
                    // Auto-select the latest active session
                    setActiveAiSession(chunk.sessionId);
                } else {
                    // Fallback: append to main terminal output
                    setOutput((prev) => [...prev, text]);
                }
            });
            cleanupRef.current.push(removeAIOutput);
        }

        return () => {
            mounted = false;
            cleanupRef.current.forEach((fn) => fn());
            cleanupRef.current = [];
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-scroll
    useEffect(() => {
        containerRef.current?.scrollTo(0, containerRef.current.scrollHeight);
    }, [output]);

    const sendCommand = useCallback(async (cmd: string) => {
        if (!sessionId || !isElectron) return;
        setCmdHistory((prev) => [...prev, cmd]);
        setHistoryIdx(-1);
        setOutput((prev) => [...prev, `$ ${cmd}\n`]);
        await window.onicode!.writeTerminal(sessionId, cmd + '\n');
        setCurrentInput('');
    }, [sessionId]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && currentInput.trim()) {
            sendCommand(currentInput.trim());
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (cmdHistory.length > 0) {
                const newIdx = historyIdx < cmdHistory.length - 1 ? historyIdx + 1 : historyIdx;
                setHistoryIdx(newIdx);
                setCurrentInput(cmdHistory[cmdHistory.length - 1 - newIdx] || '');
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIdx > 0) {
                const newIdx = historyIdx - 1;
                setHistoryIdx(newIdx);
                setCurrentInput(cmdHistory[cmdHistory.length - 1 - newIdx] || '');
            } else {
                setHistoryIdx(-1);
                setCurrentInput('');
            }
        }
    }, [currentInput, sendCommand, cmdHistory, historyIdx]);

    const formatDuration = (ms?: number) => {
        if (!ms) return '';
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    };

    const runningSessions = aiSessions.filter(s => s.status === 'running');
    const completedSessions = aiSessions.filter(s => s.status !== 'running');

    // Determine what to show in the main output area
    const activeOutput = activeAiSession && aiSessionOutput[activeAiSession]
        ? aiSessionOutput[activeAiSession]
        : output;
    const activeLabel = activeAiSession
        ? aiSessions.find(s => s.id === activeAiSession)?.command
        : null;

    return (
        <div className="widget-terminal-container">
            {/* Compact status bar: running processes + session count */}
            {aiSessions.length > 0 && (
                <div className="terminal-statusbar">
                    {runningSessions.length > 0 && (
                        <div className="terminal-statusbar-running">
                            <span className="tool-spinner" />
                            <span>{runningSessions.length} running</span>
                            {runningSessions.map(s => (
                                <button
                                    key={s.id}
                                    className={`terminal-statusbar-proc${activeAiSession === s.id ? ' active' : ''}`}
                                    onClick={() => setActiveAiSession(activeAiSession === s.id ? null : s.id)}
                                    title={s.command}
                                >
                                    <code>{s.command.length > 20 ? s.command.slice(0, 20) + '…' : s.command}</code>
                                </button>
                            ))}
                        </div>
                    )}
                    <button
                        className="terminal-statusbar-toggle"
                        onClick={() => setShowSessions(!showSessions)}
                    >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            {showSessions ? <polyline points="6 9 12 15 18 9" /> : <polyline points="9 18 15 12 9 6" />}
                        </svg>
                        <span>{completedSessions.length} completed</span>
                    </button>
                </div>
            )}

            {/* Collapsible completed sessions list */}
            {showSessions && completedSessions.length > 0 && (
                <div className="terminal-sessions-list">
                    {completedSessions.slice(-10).reverse().map((s) => (
                        <div
                            key={s.id}
                            className={`terminal-session-item terminal-session-${s.status}${activeAiSession === s.id ? ' terminal-session-active' : ''}`}
                            onClick={() => setActiveAiSession(activeAiSession === s.id ? null : s.id)}
                        >
                            <span className={`terminal-session-status ${s.status}`}>
                                {s.status === 'done' ? '✓' : '✗'}
                            </span>
                            <code className="terminal-session-cmd">{s.command}</code>
                            {s.duration !== undefined && (
                                <span className="terminal-session-duration">{formatDuration(s.duration)}</span>
                            )}
                            {s.exitCode !== undefined && s.exitCode !== 0 && (
                                <span className="terminal-session-exit">exit {s.exitCode}</span>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Main output area — shows shell output OR selected AI session output */}
            <div className="widget-terminal" ref={containerRef} onClick={() => inputRef.current?.focus()}>
                {activeLabel && (
                    <div className="terminal-viewing-label">
                        <code>{activeLabel}</code>
                        <button onClick={() => setActiveAiSession(null)} title="Back to shell">×</button>
                    </div>
                )}
                <div className="terminal-output">
                    {activeOutput.map((line, i) => (
                        <span key={i}>{line}</span>
                    ))}
                </div>
                {!activeAiSession && sessionId && (
                    <div className="terminal-input-line">
                        <span className="terminal-prompt">$ </span>
                        <input
                            ref={inputRef}
                            className="terminal-input"
                            value={currentInput}
                            onChange={(e) => setCurrentInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            spellCheck={false}
                            title="Terminal input"
                            placeholder="Type a command..."
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  File Viewer Widget
// ══════════════════════════════════════════

interface TreeNode { name: string; path: string; type: string; children?: TreeNode[] }

function FileViewerWidget({ data }: { data?: Record<string, unknown> }) {
    const [tree, setTree] = useState<TreeNode[]>([]);
    const [refreshKey, setRefreshKey] = useState(0);
    const [currentPath, setCurrentPath] = useState((data?.path as string) || '');
    const [rootPath, setRootPath] = useState('');
    const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
    // viewingFile state removed — files open in floating editor via onicode-open-file event

    // Resolve root path from active project
    useEffect(() => {
        const explicit = data?.path as string;
        if (explicit) { setRootPath(explicit); setCurrentPath(explicit); return; }
        try {
            const stored = localStorage.getItem('onicode-active-project');
            if (stored) { const p = JSON.parse(stored).path; setRootPath(p); setCurrentPath(p); return; }
        } catch {}
        setRootPath(''); setCurrentPath('');
    }, [data?.path]);

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.path) { setRootPath(detail.path); setCurrentPath(detail.path); setExpandedDirs(new Set()); }
        };
        window.addEventListener('onicode-project-activate', handler);
        return () => window.removeEventListener('onicode-project-activate', handler);
    }, []);

    // Load file tree for current path
    useEffect(() => {
        if (!isElectron || !currentPath) return;
        window.onicode!.readDir(currentPath, 2).then((res) => {
            if (res.tree) setTree(res.tree as TreeNode[]);
        });
    }, [currentPath, refreshKey]);

    // Auto-refresh when AI modifies files
    useEffect(() => {
        if (!isElectron || !currentPath || !window.onicode?.onFileChanged) return;
        const unsub = window.onicode.onFileChanged(() => setRefreshKey(k => k + 1));
        return unsub;
    }, [currentPath]);

    const toggleDir = useCallback((dirPath: string) => {
        setExpandedDirs(prev => {
            const next = new Set(prev);
            if (next.has(dirPath)) next.delete(dirPath);
            else next.add(dirPath);
            return next;
        });
    }, []);

    const openFile = useCallback((filePath: string, fileName: string) => {
        // Dispatch event to App.tsx to open floating editor
        window.dispatchEvent(new CustomEvent('onicode-open-file', { detail: { path: filePath, name: fileName } }));
    }, []);

    const navigateUp = useCallback(() => {
        if (currentPath === rootPath || !currentPath) return;
        const parent = currentPath.split('/').slice(0, -1).join('/');
        if (parent && parent.length >= rootPath.length) {
            setCurrentPath(parent);
            setExpandedDirs(new Set());
        }
    }, [currentPath, rootPath]);

    if (!rootPath) {
        return (
            <div className="widget-placeholder">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                </svg>
                <p>No project open</p>
                <span>Use <code>/init</code> or <code>/openproject</code> to start</span>
            </div>
        );
    }

    const renderItem = (item: TreeNode, depth: number) => {
        const isDir = item.type === 'directory';
        const isExpanded = expandedDirs.has(item.path);

        return (
            <div key={item.path}>
                <div
                    className={`file-tree-item ${item.type}`}
                    style={{ paddingLeft: `${8 + depth * 14}px` }}
                    onClick={() => isDir ? toggleDir(item.path) : openFile(item.path, item.name)}
                >
                    {isDir ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }}>
                            <polyline points="9 18 15 12 9 6" />
                        </svg>
                    ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                        </svg>
                    )}
                    <span className="file-tree-name">{item.name}</span>
                </div>
                {isDir && isExpanded && item.children && (
                    <div className="file-tree-children">
                        {(item.children as TreeNode[]).map(child => renderItem(child, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="widget-files">
            <div className="widget-files-header">
                {currentPath !== rootPath && (
                    <button className="file-viewer-back" onClick={navigateUp} title="Go up">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
                    </button>
                )}
                <span className="widget-files-path">{currentPath.split('/').pop()}</span>
                <button className="file-viewer-refresh" onClick={() => setRefreshKey(k => k + 1)} title="Refresh">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
                </button>
            </div>
            <div className="widget-files-tree">
                {tree.map(item => renderItem(item, 0))}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  Browser Widget
// ══════════════════════════════════════════

// ══════════════════════════════════════════
//  Agent Runtime Widget
// ══════════════════════════════════════════

interface AgentEntry { id: string; task: string; status: string; createdAt: number; result?: string; }
interface BgProcess { id: string; command: string; status: string; pid?: number; port?: number; startedAt?: number; }

const ROLE_BADGES: Record<string, { icon: string; color: string }> = {
    researcher: { icon: '🔍', color: '#60a5fa' },
    implementer: { icon: '🔨', color: '#f59e0b' },
    reviewer: { icon: '👁️', color: '#a78bfa' },
    tester: { icon: '🧪', color: '#34d399' },
    planner: { icon: '📋', color: '#fb923c' },
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

// ══════════════════════════════════════════
//  Project Widget
// ══════════════════════════════════════════

function ProjectWidget() {
    const [project, setProject] = useState<{
        name: string; path: string; techStack?: string; description?: string;
        gitBranch?: string; hasGit?: boolean;
    } | null>(null);
    const [docs, setDocs] = useState<Array<{ name: string; content: string }>>([]);
    const [fileTree, setFileTree] = useState<Array<{ name: string; path: string; type: string; children?: unknown[] }>>([]);
    const [showFiles, setShowFiles] = useState(true);

    // Load file tree for the active project
    const loadFileTree = useCallback((projectPath: string) => {
        if (!isElectron || !projectPath) return;
        window.onicode!.readDir(projectPath, 2).then((res) => {
            if (res.tree) setFileTree(res.tree as typeof fileTree);
        }).catch(() => { });
    }, []);

    useEffect(() => {
        try {
            const stored = localStorage.getItem('onicode-active-project');
            if (stored) {
                const p = JSON.parse(stored);
                setProject(p);
                loadFileTree(p.path);
                // Load project docs if electron
                if (isElectron && p.id) {
                    window.onicode!.getProject(p.id).then((result) => {
                        if (result.docs) setDocs(result.docs);
                        if (result.project) {
                            setProject((prev) => prev ? { ...prev, ...result.project } : prev);
                        }
                    });
                }
            }
        } catch { /* ignore */ }

        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.name) {
                setProject(detail);
                loadFileTree(detail.path);
            }
        };
        window.addEventListener('onicode-project-activate', handler);
        return () => {
            window.removeEventListener('onicode-project-activate', handler);
        };
    }, [loadFileTree]);

    // Auto-refresh file tree when AI creates/edits files
    useEffect(() => {
        if (!isElectron || !project?.path || !window.onicode?.onFileChanged) return;
        const unsub = window.onicode.onFileChanged((change) => {
            if (change.path?.startsWith(project.path) || change.dir?.startsWith(project.path)) {
                loadFileTree(project.path);
            }
        });
        return unsub;
    }, [project?.path, loadFileTree]);

    if (!project) {
        return (
            <div className="widget-placeholder">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5">
                    <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
                </svg>
                <p>No active project</p>
                <span>Use <code>/init</code> or <code>/openproject</code> to start</span>
            </div>
        );
    }

    return (
        <div className="project-widget">
            <div className="project-widget-header">
                <h3>{project.name}</h3>
                <span className="project-widget-path">{project.path}</span>
            </div>
            {project.techStack && (
                <div className="project-widget-section">
                    <div className="project-widget-label">Tech Stack</div>
                    <div className="project-widget-tags">
                        {project.techStack.split(',').map((t, i) => (
                            <span key={i} className="project-widget-tag">{t.trim()}</span>
                        ))}
                    </div>
                </div>
            )}
            {project.gitBranch && (
                <div className="project-widget-section">
                    <div className="project-widget-label">Git</div>
                    <span className="project-widget-value">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 01-9 9" /></svg>
                        {project.gitBranch}
                    </span>
                </div>
            )}
            {docs.length > 0 && (
                <div className="project-widget-section">
                    <div className="project-widget-label">Docs</div>
                    <div className="project-widget-docs">
                        {docs.map((doc, i) => (
                            <div key={i} className="project-widget-doc">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                {doc.name}
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {fileTree.length > 0 && (
                <div className="project-widget-section">
                    <div className="project-widget-label project-widget-label-toggle" onClick={() => setShowFiles(f => !f)}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: showFiles ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}><polyline points="9 18 15 12 9 6" /></svg>
                        Files ({fileTree.length})
                    </div>
                    {showFiles && (
                        <div className="project-widget-files">
                            {fileTree.map((item) => (
                                <div key={item.path} className={`project-file-item ${item.type}`}>
                                    {item.type === 'directory' ? (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                                    ) : (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                    )}
                                    <span>{item.name}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ══════════════════════════════════════════
//  Tasks Widget
// ══════════════════════════════════════════

interface TaskEntry {
    id: number;
    content: string;
    status: string;
    priority: string;
    createdAt?: string;
    completedAt?: string | null;
}

function TasksWidget() {
    const [tasks, setTasks] = useState<TaskEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [done, setDone] = useState(0);
    const [inProgress, setInProgress] = useState(0);

    const applyTaskSummary = useCallback((data: { total: number; done: number; inProgress: number; tasks: TaskEntry[] }) => {
        setTotal(data.total);
        setDone(data.done);
        setInProgress(data.inProgress);
        setTasks(data.tasks || []);
    }, []);

    const loadTasks = useCallback(async () => {
        if (!isElectron || !window.onicode?.tasksList) return;
        try {
            const summary = await window.onicode.tasksList();
            if (summary) applyTaskSummary(summary as { total: number; done: number; inProgress: number; tasks: TaskEntry[] });
        } catch { /* ignore */ }
    }, [applyTaskSummary]);

    useEffect(() => {
        // Load tasks for the active project from SQLite
        try {
            const stored = localStorage.getItem('onicode-active-project');
            if (stored && window.onicode?.loadProjectTasks) {
                const proj = JSON.parse(stored);
                window.onicode.loadProjectTasks(proj.path).then((res) => {
                    if (res.success && res.summary) applyTaskSummary(res.summary as { total: number; done: number; inProgress: number; tasks: TaskEntry[] });
                });
            } else {
                loadTasks();
            }
        } catch {
            loadTasks();
        }

        // Listen for live updates
        if (!window.onicode?.onTasksUpdated) return;
        const unsub = window.onicode.onTasksUpdated((data) => {
            applyTaskSummary(data as { total: number; done: number; inProgress: number; tasks: TaskEntry[] });
        });

        // Reload when project changes
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.path && window.onicode?.loadProjectTasks) {
                window.onicode.loadProjectTasks(detail.path).then((res) => {
                    if (res.success && res.summary) applyTaskSummary(res.summary as { total: number; done: number; inProgress: number; tasks: TaskEntry[] });
                });
            }
        };
        window.addEventListener('onicode-project-activate', handler);

        return () => {
            unsub?.();
            window.removeEventListener('onicode-project-activate', handler);
        };
    }, [loadTasks, applyTaskSummary]);

    const archiveCompleted = useCallback(async () => {
        if (!isElectron) return;
        await window.onicode!.archiveCompletedTasks();
        loadTasks();
    }, [loadTasks]);

    const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
    const pendingTasks = tasks.filter(t => t.status === 'pending');
    const doneTasks = tasks.filter(t => t.status === 'done');
    const skippedTasks = tasks.filter(t => t.status === 'skipped');

    if (total === 0) {
        return (
            <div className="widget-placeholder">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
                    <path d="M9 11l3 3L22 4" />
                    <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                </svg>
                <p>No tasks</p>
                <span>Tasks appear here when the AI creates them during work sessions</span>
            </div>
        );
    }

    return (
        <div className="widget-tasks">
            {/* Progress summary */}
            <div className="tasks-summary">
                <div className="tasks-summary-text">
                    <span className="tasks-summary-count">{done}/{total}</span> done
                    {inProgress > 0 && <span className="tasks-summary-active"> · {inProgress} active</span>}
                </div>
                <div className="tasks-progress-bar">
                    <div className="tasks-progress-fill" style={{ width: `${total > 0 ? Math.round((done / total) * 100) : 0}%` }} />
                </div>
            </div>

            <div className="tasks-list">
                {/* In Progress */}
                {inProgressTasks.length > 0 && (
                    <div className="task-section">
                        <div className="task-section-label">In Progress</div>
                        {inProgressTasks.map(t => (
                            <div key={t.id} className="task-item task-item-active">
                                <span className="task-item-icon task-icon-progress" />
                                <span className="task-item-text">{t.content}</span>
                                <span className={`task-item-priority priority-${t.priority}`}>{t.priority}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Pending */}
                {pendingTasks.length > 0 && (
                    <div className="task-section">
                        <div className="task-section-label">Pending</div>
                        {pendingTasks.map(t => (
                            <div key={t.id} className="task-item">
                                <span className="task-item-icon task-icon-pending" />
                                <span className="task-item-text">{t.content}</span>
                                <span className={`task-item-priority priority-${t.priority}`}>{t.priority}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Completed */}
                {doneTasks.length > 0 && (
                    <div className="task-section">
                        <div className="task-section-label">
                            Completed ({doneTasks.length})
                            <button className="task-archive-btn" onClick={archiveCompleted}>Archive all</button>
                        </div>
                        {doneTasks.map(t => (
                            <div key={t.id} className="task-item task-item-done">
                                <span className="task-item-icon task-icon-done" />
                                <span className="task-item-text">{t.content}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Skipped */}
                {skippedTasks.length > 0 && (
                    <div className="task-section">
                        <div className="task-section-label">Skipped</div>
                        {skippedTasks.map(t => (
                            <div key={t.id} className="task-item task-item-skipped">
                                <span className="task-item-icon task-icon-skipped" />
                                <span className="task-item-text">{t.content}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  Git Widget
// ══════════════════════════════════════════

interface GitFile { path: string; status: string; staged: boolean }
interface GitBranch { name: string; current: boolean; remote: boolean; hash?: string; upstream?: string | null }
interface GitGraphEntry { hash: string; shortHash: string; author: string; timestamp: number; message: string; parents: string[]; refs: string[] }

type GitTab = 'changes' | 'graph' | 'stash';

function GitWidget() {
    const [branch, setBranch] = useState('');
    const [files, setFiles] = useState<GitFile[]>([]);
    const [branches, setBranches] = useState<GitBranch[]>([]);
    const [ahead, setAhead] = useState(0);
    const [behind, setBehind] = useState(0);
    const [commitMsg, setCommitMsg] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showBranches, setShowBranches] = useState(false);
    const [repoPath, setRepoPath] = useState('');
    const [isRepo, setIsRepo] = useState(false);
    const [actionLog, setActionLog] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState<GitTab>('changes');
    const [graphCommits, setGraphCommits] = useState<GitGraphEntry[]>([]);
    const [stashes, setStashes] = useState<string[]>([]);
    const [newBranchName, setNewBranchName] = useState('');
    const [showNewBranch, setShowNewBranch] = useState(false);
    const [mergeBranch, setMergeBranch] = useState('');
    const [showMerge, setShowMerge] = useState(false);
    const [stashMsg, setStashMsg] = useState('');

    const addLog = useCallback((msg: string) => {
        setActionLog(prev => [...prev.slice(-10), `${new Date().toLocaleTimeString()} — ${msg}`]);
    }, []);

    // Get active project path
    const getProjectPath = useCallback(() => {
        try {
            const stored = localStorage.getItem('onicode-active-project');
            if (stored) {
                const proj = JSON.parse(stored);
                return proj.path || '';
            }
        } catch {}
        return '';
    }, []);

    // Refresh git status
    const refreshStatus = useCallback(async () => {
        const projPath = repoPath || getProjectPath();
        if (!projPath || !isElectron || !window.onicode?.gitStatus) return;
        setRepoPath(projPath);

        try {
            // Check if it's a repo
            const repoCheck = await window.onicode.gitIsRepo(projPath);
            setIsRepo(repoCheck.isRepo);
            if (!repoCheck.isRepo) return;

            const status = await window.onicode.gitStatus(projPath);
            if (status.success) {
                setBranch(status.branch || 'unknown');
                setFiles(status.files || []);
                setAhead(status.ahead || 0);
                setBehind(status.behind || 0);
                setError('');
            } else if (status.error) {
                setError(status.error);
            }
        } catch (err) {
            setError('Failed to get git status');
        }
    }, [repoPath, getProjectPath]);

    // Load branches
    const loadBranches = useCallback(async () => {
        const projPath = repoPath || getProjectPath();
        if (!projPath || !window.onicode?.gitBranches) return;
        const result = await window.onicode.gitBranches(projPath);
        if (result.success) setBranches(result.branches || []);
    }, [repoPath, getProjectPath]);

    // Init
    useEffect(() => {
        refreshStatus();
        const interval = setInterval(refreshStatus, 10000); // Auto-refresh every 10s
        return () => clearInterval(interval);
    }, [refreshStatus]);

    // Listen for project changes
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.path) {
                setRepoPath(detail.path);
                setTimeout(refreshStatus, 500);
            }
        };
        window.addEventListener('onicode-project-activate', handler);
        return () => window.removeEventListener('onicode-project-activate', handler);
    }, [refreshStatus]);

    // Stage file
    const stageFile = useCallback(async (filePath: string) => {
        if (!window.onicode?.gitStage) return;
        await window.onicode.gitStage(repoPath, [filePath]);
        addLog(`Staged: ${filePath}`);
        refreshStatus();
    }, [repoPath, refreshStatus, addLog]);

    // Unstage file
    const unstageFile = useCallback(async (filePath: string) => {
        if (!window.onicode?.gitUnstage) return;
        await window.onicode.gitUnstage(repoPath, [filePath]);
        addLog(`Unstaged: ${filePath}`);
        refreshStatus();
    }, [repoPath, refreshStatus, addLog]);

    // Stage all
    const stageAll = useCallback(async () => {
        if (!window.onicode?.gitStage) return;
        await window.onicode.gitStage(repoPath, ['.']);
        addLog('Staged all files');
        refreshStatus();
    }, [repoPath, refreshStatus, addLog]);

    // Commit
    const doCommit = useCallback(async () => {
        if (!commitMsg.trim() || !window.onicode?.gitCommit) return;
        setLoading(true);
        try {
            const result = await window.onicode.gitCommit(repoPath, commitMsg.trim());
            if (result.success) {
                addLog(`Committed: ${commitMsg.trim()}`);
                setCommitMsg('');
                refreshStatus();
            } else {
                setError(result.error || 'Commit failed');
                addLog(`Commit failed: ${result.error}`);
            }
        } catch (err) {
            setError('Commit failed');
        }
        setLoading(false);
    }, [repoPath, commitMsg, refreshStatus, addLog]);

    // Push
    const doPush = useCallback(async () => {
        if (!window.onicode?.gitPush) return;
        setLoading(true);
        try {
            const result = await window.onicode.gitPush(repoPath);
            if (result.success) {
                addLog('Pushed to remote');
                refreshStatus();
            } else {
                setError(result.error || 'Push failed');
                addLog(`Push failed: ${result.error}`);
            }
        } catch {
            setError('Push failed');
        }
        setLoading(false);
    }, [repoPath, refreshStatus, addLog]);

    // Pull
    const doPull = useCallback(async () => {
        if (!window.onicode?.gitPull) return;
        setLoading(true);
        try {
            const result = await window.onicode.gitPull(repoPath);
            if (result.success) {
                addLog('Pulled from remote');
                refreshStatus();
            } else {
                setError(result.error || 'Pull failed');
                addLog(`Pull failed: ${result.error}`);
            }
        } catch {
            setError('Pull failed');
        }
        setLoading(false);
    }, [repoPath, refreshStatus, addLog]);

    // Checkout branch
    const checkoutBranch = useCallback(async (branchName: string) => {
        if (!window.onicode?.gitCheckout) return;
        setLoading(true);
        const result = await window.onicode.gitCheckout(repoPath, branchName, false);
        if (result.success) {
            addLog(`Switched to branch: ${branchName}`);
            setShowBranches(false);
            refreshStatus();
        } else {
            setError(result.error || 'Checkout failed');
        }
        setLoading(false);
    }, [repoPath, refreshStatus, addLog]);

    // Init repo
    const initRepo = useCallback(async () => {
        const projPath = getProjectPath();
        if (!projPath || !window.onicode?.gitInit) return;
        const result = await window.onicode.gitInit(projPath);
        if (result.success) {
            setRepoPath(projPath);
            addLog('Initialized git repository');
            refreshStatus();
        }
    }, [getProjectPath, refreshStatus, addLog]);

    // Load git graph
    const loadGraph = useCallback(async () => {
        const projPath = repoPath || getProjectPath();
        if (!projPath || !window.onicode?.gitLogGraph) return;
        try {
            const result = await window.onicode.gitLogGraph(projPath, 50);
            if (result.success && result.commits) setGraphCommits(result.commits);
        } catch {}
    }, [repoPath, getProjectPath]);

    // Load stashes
    const loadStashes = useCallback(async () => {
        const projPath = repoPath || getProjectPath();
        if (!projPath || !window.onicode?.gitStash) return;
        try {
            const result = await window.onicode.gitStash(projPath, 'list');
            if (result.success) setStashes(result.stashes || []);
        } catch {}
    }, [repoPath, getProjectPath]);

    // Create new branch
    const createBranch = useCallback(async () => {
        if (!newBranchName.trim() || !window.onicode?.gitCheckout) return;
        setLoading(true);
        const result = await window.onicode.gitCheckout(repoPath, newBranchName.trim(), true);
        if (result.success) {
            addLog(`Created branch: ${newBranchName.trim()}`);
            setNewBranchName('');
            setShowNewBranch(false);
            refreshStatus();
            loadBranches();
        } else {
            setError(result.error || 'Branch creation failed');
        }
        setLoading(false);
    }, [repoPath, newBranchName, refreshStatus, loadBranches, addLog]);

    // Merge branch
    const doMerge = useCallback(async () => {
        if (!mergeBranch || !window.onicode?.gitMerge) return;
        setLoading(true);
        try {
            const result = await window.onicode.gitMerge(repoPath, mergeBranch);
            if (result.success) {
                addLog(`Merged: ${mergeBranch} → ${branch}`);
                setMergeBranch('');
                setShowMerge(false);
                refreshStatus();
                loadGraph();
            } else {
                setError(result.error || 'Merge failed');
                addLog(`Merge failed: ${result.error}`);
            }
        } catch {
            setError('Merge failed');
        }
        setLoading(false);
    }, [repoPath, mergeBranch, branch, refreshStatus, loadGraph, addLog]);

    // Stash push
    const doStashPush = useCallback(async () => {
        if (!window.onicode?.gitStash) return;
        setLoading(true);
        const result = await window.onicode.gitStash(repoPath, 'push', stashMsg || undefined);
        if (result.success) {
            addLog(`Stashed changes${stashMsg ? `: ${stashMsg}` : ''}`);
            setStashMsg('');
            refreshStatus();
            loadStashes();
        } else {
            setError(result.error || 'Stash failed');
        }
        setLoading(false);
    }, [repoPath, stashMsg, refreshStatus, loadStashes, addLog]);

    // Stash pop
    const doStashPop = useCallback(async () => {
        if (!window.onicode?.gitStash) return;
        setLoading(true);
        const result = await window.onicode.gitStash(repoPath, 'pop');
        if (result.success) {
            addLog('Applied and removed latest stash');
            refreshStatus();
            loadStashes();
        } else {
            setError(result.error || 'Stash pop failed');
        }
        setLoading(false);
    }, [repoPath, refreshStatus, loadStashes, addLog]);

    // Stash drop
    const doStashDrop = useCallback(async (index: number) => {
        if (!window.onicode?.gitStashDrop) return;
        const result = await window.onicode.gitStashDrop(repoPath, index);
        if (result.success) {
            addLog(`Dropped stash@{${index}}`);
            loadStashes();
        } else {
            setError(result.error || 'Stash drop failed');
        }
    }, [repoPath, loadStashes, addLog]);

    // Load tab-specific data when switching
    useEffect(() => {
        if (activeTab === 'graph') loadGraph();
        if (activeTab === 'stash') loadStashes();
    }, [activeTab, loadGraph, loadStashes]);

    const stagedFiles = files.filter(f => f.staged);
    const unstagedFiles = files.filter(f => !f.staged);

    if (!repoPath && !getProjectPath()) {
        return (
            <div className="widget-git">
                <div className="git-empty">No project selected. Open a project to use Git.</div>
            </div>
        );
    }

    if (!isRepo) {
        return (
            <div className="widget-git">
                <div className="git-empty">
                    <p>Not a git repository</p>
                    <button className="git-action-btn" onClick={initRepo}>Initialize Repository</button>
                </div>
            </div>
        );
    }

    const formatTimeAgo = (ts: number) => {
        const d = Date.now() - ts;
        if (d < 60000) return 'just now';
        if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
        if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
        return `${Math.floor(d / 86400000)}d ago`;
    };

    return (
        <div className="widget-git">
            {/* Branch bar */}
            <div className="git-branch-bar">
                <button className="git-branch-btn" onClick={() => { setShowBranches(!showBranches); if (!showBranches) loadBranches(); }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 01-9 9" />
                    </svg>
                    {branch || 'main'}
                </button>
                <div className="git-sync-info">
                    {ahead > 0 && <span className="git-ahead" title={`${ahead} commits ahead`}>{ahead}↑</span>}
                    {behind > 0 && <span className="git-behind" title={`${behind} commits behind`}>{behind}↓</span>}
                </div>
                <div className="git-sync-actions">
                    <button className="git-icon-btn" onClick={doPull} disabled={loading} title="Pull">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="8 17 12 21 16 17" /><line x1="12" y1="12" x2="12" y2="21" /><path d="M20.88 18.09A5 5 0 0018 9h-1.26A8 8 0 103 16.29" /></svg>
                    </button>
                    <button className="git-icon-btn" onClick={doPush} disabled={loading} title="Push">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" /><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" /></svg>
                    </button>
                    <button className="git-icon-btn" onClick={() => { setShowMerge(!showMerge); if (!showMerge) loadBranches(); }} disabled={loading} title="Merge">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M6 21V9a9 9 0 009 9" /></svg>
                    </button>
                    <button className="git-icon-btn" onClick={refreshStatus} title="Refresh">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
                    </button>
                </div>
            </div>

            {/* Branch dropdown */}
            {showBranches && (
                <div className="git-branches-dropdown">
                    {branches.filter(b => !b.remote).map(b => (
                        <button key={b.name} className={`git-branch-option ${b.current ? 'current' : ''}`} onClick={() => checkoutBranch(b.name)}>
                            {b.current && <span className="git-branch-current-dot" />}
                            {b.name}
                        </button>
                    ))}
                    <div className="git-branch-new">
                        {showNewBranch ? (
                            <div className="git-new-branch-form">
                                <input
                                    className="git-new-branch-input"
                                    value={newBranchName}
                                    onChange={e => setNewBranchName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') createBranch(); if (e.key === 'Escape') setShowNewBranch(false); }}
                                    placeholder="new-branch-name"
                                    autoFocus
                                />
                                <button className="git-new-branch-ok" onClick={createBranch} disabled={!newBranchName.trim()}>Create</button>
                            </div>
                        ) : (
                            <button className="git-branch-option git-new-branch-btn" onClick={() => setShowNewBranch(true)}>
                                + New Branch
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Merge panel */}
            {showMerge && (
                <div className="git-merge-panel">
                    <div className="git-merge-label">Merge into <strong>{branch}</strong>:</div>
                    <select className="git-merge-select" value={mergeBranch} onChange={e => setMergeBranch(e.target.value)}>
                        <option value="">Select branch...</option>
                        {branches.filter(b => !b.current && !b.remote).map(b => (
                            <option key={b.name} value={b.name}>{b.name}</option>
                        ))}
                    </select>
                    <div className="git-merge-actions">
                        <button className="git-action-btn" onClick={doMerge} disabled={!mergeBranch || loading}>Merge</button>
                        <button className="git-action-btn git-action-secondary" onClick={() => setShowMerge(false)}>Cancel</button>
                    </div>
                </div>
            )}

            {error && <div className="git-error">{error} <button className="git-error-dismiss" onClick={() => setError('')}>×</button></div>}

            {/* Tab bar */}
            <div className="git-tabs">
                <button className={`git-tab ${activeTab === 'changes' ? 'active' : ''}`} onClick={() => setActiveTab('changes')}>
                    Changes {files.length > 0 && <span className="git-tab-badge">{files.length}</span>}
                </button>
                <button className={`git-tab ${activeTab === 'graph' ? 'active' : ''}`} onClick={() => setActiveTab('graph')}>
                    Graph
                </button>
                <button className={`git-tab ${activeTab === 'stash' ? 'active' : ''}`} onClick={() => setActiveTab('stash')}>
                    Stash {stashes.length > 0 && <span className="git-tab-badge">{stashes.length}</span>}
                </button>
            </div>

            {/* Changes tab */}
            {activeTab === 'changes' && (
                <>
                    <div className="git-commit-area">
                        <input
                            className="git-commit-input"
                            value={commitMsg}
                            onChange={e => setCommitMsg(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doCommit(); } }}
                            placeholder="Commit message..."
                            disabled={loading}
                        />
                        <div className="git-commit-actions">
                            <button className="git-stage-all-btn" onClick={stageAll} disabled={loading || unstagedFiles.length === 0}>
                                Stage All
                            </button>
                            <button className="git-commit-btn" onClick={doCommit} disabled={loading || !commitMsg.trim() || stagedFiles.length === 0}>
                                {loading ? 'Working...' : `Commit (${stagedFiles.length})`}
                            </button>
                        </div>
                    </div>

                    <div className="git-files-section">
                        {stagedFiles.length > 0 && (
                            <div className="git-file-group">
                                <div className="git-file-group-label">Staged ({stagedFiles.length})</div>
                                {stagedFiles.map(f => (
                                    <div key={f.path} className={`git-file-item git-file-${f.status}`}>
                                        <span className="git-file-status">{f.status[0].toUpperCase()}</span>
                                        <span className="git-file-path">{f.path}</span>
                                        <button className="git-file-action" onClick={() => unstageFile(f.path)} title="Unstage">−</button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {unstagedFiles.length > 0 && (
                            <div className="git-file-group">
                                <div className="git-file-group-label">Changes ({unstagedFiles.length})</div>
                                {unstagedFiles.map(f => (
                                    <div key={f.path} className={`git-file-item git-file-${f.status}`}>
                                        <span className="git-file-status">{f.status[0].toUpperCase()}</span>
                                        <span className="git-file-path">{f.path}</span>
                                        <button className="git-file-action" onClick={() => stageFile(f.path)} title="Stage">+</button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {files.length === 0 && <div className="git-clean">Working tree clean</div>}
                    </div>
                </>
            )}

            {/* Graph tab — commit history with branch/merge visualization */}
            {activeTab === 'graph' && (
                <div className="git-graph-section">
                    {graphCommits.length === 0 ? (
                        <div className="git-clean">No commits yet</div>
                    ) : (
                        <div className="git-graph-list">
                            {graphCommits.map((c, i) => {
                                const isMerge = c.parents.length > 1;
                                const branchRefs = c.refs.filter(r => !r.startsWith('tag:'));
                                const tagRefs = c.refs.filter(r => r.startsWith('tag:')).map(r => r.replace('tag: ', ''));
                                return (
                                    <div key={c.hash} className={`git-graph-commit ${i === 0 ? 'git-graph-head' : ''}`}>
                                        <div className="git-graph-line">
                                            <div className={`git-graph-dot ${isMerge ? 'git-graph-merge-dot' : ''}`} />
                                            {i < graphCommits.length - 1 && <div className="git-graph-connector" />}
                                        </div>
                                        <div className="git-graph-content">
                                            <div className="git-graph-msg">
                                                <span className="git-graph-hash">{c.shortHash}</span>
                                                {branchRefs.length > 0 && branchRefs.map(r => (
                                                    <span key={r} className={`git-graph-ref ${r.includes('HEAD') ? 'git-graph-ref-head' : ''}`}>{r.replace('HEAD -> ', '')}</span>
                                                ))}
                                                {tagRefs.length > 0 && tagRefs.map(t => (
                                                    <span key={t} className="git-graph-tag">{t}</span>
                                                ))}
                                                <span className="git-graph-text">{c.message}</span>
                                            </div>
                                            <div className="git-graph-meta">
                                                <span>{c.author}</span>
                                                <span>{formatTimeAgo(c.timestamp)}</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Stash tab */}
            {activeTab === 'stash' && (
                <div className="git-stash-section">
                    <div className="git-stash-form">
                        <input
                            className="git-stash-input"
                            value={stashMsg}
                            onChange={e => setStashMsg(e.target.value)}
                            placeholder="Stash message (optional)..."
                            disabled={loading}
                        />
                        <div className="git-stash-actions">
                            <button className="git-action-btn" onClick={doStashPush} disabled={loading || files.length === 0}>
                                Stash Changes
                            </button>
                            <button className="git-action-btn git-action-secondary" onClick={doStashPop} disabled={loading || stashes.length === 0}>
                                Pop Latest
                            </button>
                        </div>
                    </div>
                    {stashes.length > 0 ? (
                        <div className="git-stash-list">
                            {stashes.map((s, i) => (
                                <div key={i} className="git-stash-item">
                                    <span className="git-stash-text">{s}</span>
                                    <button className="git-file-action" onClick={() => doStashDrop(i)} title="Drop">×</button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="git-clean">No stashes</div>
                    )}
                </div>
            )}

            {/* Action log */}
            {actionLog.length > 0 && (
                <div className="git-log">
                    {actionLog.map((msg, i) => (
                        <div key={i} className="git-log-entry">{msg}</div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ══════════════════════════════════════════
//  Attachments Widget (project-scoped)
// ══════════════════════════════════════════

interface ProjectAttachment {
    id: string;
    name: string;
    type: string;
    size?: number;
    mime_type?: string;
    url?: string;
    content?: string;
    data_url?: string;
    created_at: number;
}

function AttachmentsWidget() {
    const [atts, setAtts] = useState<ProjectAttachment[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    const [selectedAtt, setSelectedAtt] = useState<ProjectAttachment | null>(null);

    const loadAttachments = useCallback(async () => {
        if (!isElectron || !window.onicode?.attachmentList) {
            setLoading(false);
            return;
        }
        try {
            const stored = localStorage.getItem('onicode-active-project');
            if (!stored) { setAtts([]); setLoading(false); return; }
            const project = JSON.parse(stored);
            const result = await window.onicode.attachmentList(project.id);
            if (result.success && result.attachments) {
                setAtts(result.attachments);
            }
        } catch { /* ignore */ }
        setLoading(false);
    }, []);

    useEffect(() => { loadAttachments(); }, [loadAttachments]);

    const handleDelete = async (id: string) => {
        if (!window.onicode?.attachmentDelete) return;
        await window.onicode.attachmentDelete(id);
        setAtts(prev => prev.filter(a => a.id !== id));
        if (selectedAtt?.id === id) setSelectedAtt(null);
    };

    const filtered = filter
        ? atts.filter(a => a.name.toLowerCase().includes(filter.toLowerCase()))
        : atts;

    const typeIcon = (type: string) => {
        switch (type) {
            case 'image': return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>;
            case 'link': return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>;
            case 'doc': return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>;
            default: return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>;
        }
    };

    return (
        <div className="widget-attachments" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '8px', padding: '12px' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                    type="text"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    placeholder="Filter attachments..."
                    style={{
                        flex: 1, padding: '5px 10px', borderRadius: '6px',
                        border: '1px solid var(--border)', background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)', fontSize: '12px', outline: 'none',
                    }}
                />
                <button onClick={loadAttachments} title="Refresh" style={{
                    padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--border)',
                    background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
                    fontSize: '11px', cursor: 'pointer',
                }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                    </svg>
                </button>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                {atts.length} attachment{atts.length !== 1 ? 's' : ''} in project
            </div>

            {/* List */}
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {loading ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '12px' }}>Loading...</div>
                ) : filtered.length === 0 ? (
                    <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, marginBottom: '8px' }}>
                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                        </svg>
                        <div style={{ fontSize: '12px', fontWeight: 500 }}>No attachments</div>
                        <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.6 }}>
                            Attach files in chat to add them here. Use <code style={{ fontSize: '10px' }}>@</code> to reference.
                        </div>
                    </div>
                ) : filtered.map(att => (
                    <div
                        key={att.id}
                        onClick={() => setSelectedAtt(att)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '6px 8px', borderRadius: '6px', cursor: 'pointer',
                            background: selectedAtt?.id === att.id ? 'var(--bg-tertiary)' : 'transparent',
                            transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => { if (selectedAtt?.id !== att.id) (e.currentTarget as HTMLElement).style.background = 'var(--bg-secondary)'; }}
                        onMouseLeave={e => { if (selectedAtt?.id !== att.id) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                        <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>{typeIcon(att.type)}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '12px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name}</div>
                            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', display: 'flex', gap: '6px' }}>
                                <span className={`gallery-type-badge gallery-type-${att.type}`} style={{ padding: '1px 4px', borderRadius: '3px', fontSize: '9px' }}>{att.type}</span>
                                {att.size && <span>{att.size < 1024 ? `${att.size}B` : `${Math.round(att.size / 1024)}KB`}</span>}
                            </div>
                        </div>
                        <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(att.id); }}
                            title="Remove"
                            style={{
                                padding: '2px', background: 'none', border: 'none',
                                color: 'var(--text-tertiary)', cursor: 'pointer', opacity: 0.5,
                                flexShrink: 0,
                            }}
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>
                ))}
            </div>

            {/* Preview pane */}
            {selectedAtt && (
                <div style={{
                    borderTop: '1px solid var(--border)', paddingTop: '8px',
                    maxHeight: '40%', overflow: 'auto',
                }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                        {selectedAtt.name}
                    </div>
                    {selectedAtt.type === 'image' && selectedAtt.data_url && (
                        <img src={selectedAtt.data_url} alt={selectedAtt.name} style={{ maxWidth: '100%', borderRadius: '6px', maxHeight: '200px', objectFit: 'contain' }} />
                    )}
                    {selectedAtt.type === 'link' && selectedAtt.url && (
                        <div style={{ fontSize: '11px', color: 'var(--accent)', wordBreak: 'break-all' }}>{selectedAtt.url}</div>
                    )}
                    {selectedAtt.content && (
                        <pre style={{
                            fontSize: '10px', color: 'var(--text-secondary)',
                            background: 'var(--bg-code)', padding: '6px 8px',
                            borderRadius: '4px', overflow: 'auto', maxHeight: '150px',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            margin: '4px 0 0',
                        }}>
                            <code>{selectedAtt.content.slice(0, 5000)}</code>
                        </pre>
                    )}
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                        {selectedAtt.mime_type && <span>{selectedAtt.mime_type} · </span>}
                        {new Date(selectedAtt.created_at).toLocaleDateString()}
                    </div>
                </div>
            )}

            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', borderTop: '1px solid var(--border)', paddingTop: '6px' }}>
                Type <code style={{ fontSize: '9px', background: 'var(--bg-tertiary)', padding: '1px 3px', borderRadius: '2px' }}>@</code> in chat to reference attachments
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  Right Panel
// ══════════════════════════════════════════

interface RightPanelProps {
    panel: PanelState;
    onClose: () => void;
    onChangeWidget: (widget: WidgetType) => void;
}

// Track which widgets have been opened so they stay mounted (preserves terminal state)
export default function RightPanel({ panel, onClose, onChangeWidget }: RightPanelProps) {
    const [collapsed, setCollapsed] = useState(false);
    const [mountedWidgets, setMountedWidgets] = useState<Set<WidgetType>>(new Set());

    // Track mounted widgets so terminal etc. stay alive across tab switches AND panel close/open
    useEffect(() => {
        if (panel.widget) {
            setMountedWidgets(prev => {
                if (prev.has(panel.widget!)) return prev;
                const next = new Set(prev);
                next.add(panel.widget!);
                return next;
            });
        }
    }, [panel.widget]);

    // When panel is closed (widget is null), hide but keep persistent widgets alive
    const isVisible = !!panel.widget;
    const activeWidget = WIDGETS.find((w) => w.id === panel.widget);

    const renderNonPersistentWidget = (type: WidgetType) => {
        switch (type) {
            case 'project': return <ProjectWidget />;
            case 'files': return <FileViewerWidget data={panel.data} />;
            case 'agents': return <AgentsWidget />;
            case 'tasks': return <TasksWidget />;
            case 'git': return <GitWidget />;
            case 'attachments': return <AttachmentsWidget />;
            default: return null;
        }
    };

    // If terminal has been mounted, always render the panel wrapper to keep terminal alive
    if (!isVisible && !mountedWidgets.has('terminal')) return null;

    return (
        <div className={`right-panel ${collapsed ? 'right-panel-collapsed' : ''}`} style={{ display: isVisible ? undefined : 'none' }}>
            <div className="right-panel-header">
                <div className="right-panel-tabs">
                    {WIDGETS.map((w) => (
                        <button key={w.id} className={`panel-tab ${panel.widget === w.id ? 'active' : ''}`} onClick={() => onChangeWidget(w.id)} title={w.label}>
                            {w.icon}
                        </button>
                    ))}
                </div>
                {!collapsed && activeWidget && <div className="right-panel-title">{activeWidget.label}</div>}
                <div className="right-panel-actions">
                    <button className="panel-collapse" onClick={() => setCollapsed(!collapsed)} title={collapsed ? 'Expand panel' : 'Collapse panel'}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            {collapsed
                                ? <polyline points="15 18 9 12 15 6" />
                                : <polyline points="9 18 15 12 9 6" />
                            }
                        </svg>
                    </button>
                    <button className="panel-close" onClick={onClose} title="Close panel">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>
            </div>
            {!collapsed && (
                <div className="right-panel-body">
                    {/* Terminal stays mounted once opened — survives tab switches AND panel close/open */}
                    {mountedWidgets.has('terminal') && (
                        <div style={{ display: panel.widget === 'terminal' ? 'contents' : 'none' }}>
                            <TerminalWidget />
                        </div>
                    )}
                    {/* Other widgets render normally */}
                    {panel.widget && panel.widget !== 'terminal' && renderNonPersistentWidget(panel.widget)}
                </div>
            )}
        </div>
    );
}
