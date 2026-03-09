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

export type WidgetType = 'terminal' | 'files' | 'agents' | 'project' | 'tasks' | 'git';

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

        // Listen for real-time AI command output (streamed from spawn)
        if (window.onicode?.onAITerminalOutput) {
            const removeAIOutput = window.onicode.onAITerminalOutput((chunk) => {
                if (!mounted) return;
                const text = stripAnsi(chunk.data);
                if (text.trim()) {
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

    return (
        <div className="widget-terminal-container">
            {aiSessions.length > 0 && (
                <div className="terminal-sessions">
                    <div className="terminal-sessions-header">
                        <button
                            className="terminal-sessions-toggle"
                            onClick={() => setShowSessions(!showSessions)}
                            title="Toggle AI command history"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                {showSessions
                                    ? <polyline points="6 9 12 15 18 9" />
                                    : <polyline points="9 18 15 12 9 6" />
                                }
                            </svg>
                            <span>AI Commands ({aiSessions.length})</span>
                        </button>
                        {aiSessions.some(s => s.status === 'running') && (
                            <span className="terminal-sessions-running">
                                <span className="tool-spinner" />
                                Running
                            </span>
                        )}
                    </div>
                    {showSessions && (
                        <div className="terminal-sessions-list">
                            {aiSessions.slice(-20).reverse().map((s) => (
                                <div key={s.id} className={`terminal-session-item terminal-session-${s.status}`}>
                                    <span className={`terminal-session-status ${s.status}`}>
                                        {s.status === 'running' ? <span className="tool-spinner" />
                                            : s.status === 'done' ? '✓' : '✗'}
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
                </div>
            )}
            <div className="widget-terminal" ref={containerRef} onClick={() => inputRef.current?.focus()}>
                <div className="terminal-output">
                    {output.map((line, i) => (
                        <span key={i}>{line}</span>
                    ))}
                </div>
                {sessionId && (
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

function AgentsWidget() {
    const [agents, setAgents] = useState<AgentEntry[]>([]);
    const [bgProcesses, setBgProcesses] = useState<BgProcess[]>([]);
    const [agentStatus, setAgentStatus] = useState<{ round: number; status: string } | null>(null);

    // Poll agents + background processes
    const refresh = useCallback(async () => {
        if (!isElectron) return;
        try {
            const [agentList, procList] = await Promise.all([
                window.onicode!.listAgents(),
                window.onicode!.listBackgroundProcesses(),
            ]);
            setAgents(agentList || []);
            setBgProcesses(procList || []);
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
            setAgentStatus(data as { round: number; status: string });
            // Also refresh on sub-agent events
            if (data.agentId) refresh();
        });
        return unsub;
    }, [refresh]);

    // Real-time terminal session events
    useEffect(() => {
        if (!window.onicode?.onTerminalSession) return;
        const unsub = window.onicode.onTerminalSession(() => refresh());
        return unsub;
    }, [refresh]);

    const killProcess = async (id: string) => {
        if (!isElectron) return;
        await window.onicode!.killBackgroundProcess(id);
        refresh();
    };

    const running = agents.filter(a => a.status === 'running').length + bgProcesses.filter(p => p.status === 'running').length;
    const hasAnything = agents.length > 0 || bgProcesses.length > 0 || agentStatus;

    return (
        <div className="widget-agents">
            <div className="agents-header">
                {running > 0 && <span className="agents-running-badge">{running} active</span>}
                {agentStatus && (
                    <span className="agents-current-status">
                        {agentStatus.status === 'thinking' && 'AI thinking...'}
                        {agentStatus.status === 'executing' && 'Executing tools...'}
                        {agentStatus.status === 'streaming' && 'Generating...'}
                        {agentStatus.status === 'continuing' && 'Auto-continuing...'}
                        {agentStatus.status === 'sub-agent' && 'Sub-agent working...'}
                        {agentStatus.round > 0 && ` (round ${agentStatus.round + 1})`}
                    </span>
                )}
            </div>

            {!hasAnything ? (
                <div className="widget-placeholder">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4" />
                    </svg>
                    <p>No active agents</p>
                    <span>Agents, processes, and runtime status appear here during AI workflows</span>
                </div>
            ) : (
                <div className="agents-list">
                    {agents.length > 0 && (
                        <div className="agents-section">
                            <div className="agents-section-label">Sub-Agents</div>
                            {agents.map(a => (
                                <div key={a.id} className={`agent-item agent-item-${a.status}`}>
                                    <span className={`agent-dot ${a.status}`} />
                                    <div className="agent-item-info">
                                        <span className="agent-item-id">{a.id.slice(0, 8)}</span>
                                        <span className="agent-item-task">{a.task}</span>
                                        {a.result && <span className="agent-item-result">{String(a.result).slice(0, 100)}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
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
interface GitBranch { name: string; current: boolean; remote: boolean }

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
                </div>
            )}

            {error && <div className="git-error">{error}</div>}

            {/* Commit input */}
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

            {/* File changes */}
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
