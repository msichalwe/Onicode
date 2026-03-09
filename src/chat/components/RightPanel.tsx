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

export type WidgetType = 'terminal' | 'files' | 'browser' | 'project' | 'pdf' | 'excel' | 'word' | 'camera' | 'image';

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
    { id: 'browser', label: 'Browser', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg> },
    { id: 'pdf', label: 'PDF', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg> },
    { id: 'image', label: 'Image', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg> },
    { id: 'camera', label: 'Camera', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg> },
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

function FileViewerWidget({ data }: { data?: Record<string, unknown> }) {
    const [tree, setTree] = useState<Array<{ name: string; path: string; type: string; children?: unknown[] }>>([]);
    const targetPath = (data?.path as string) || '';

    useEffect(() => {
        if (!isElectron || !targetPath) return;
        window.onicode!.readDir(targetPath, 2).then((res) => {
            if (res.tree) setTree(res.tree as typeof tree);
        });
    }, [targetPath]);

    if (!targetPath) {
        return (
            <div className="widget-placeholder">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                </svg>
                <p>Open a project folder to browse files</p>
                <span>Use /files &lt;path&gt; to browse</span>
            </div>
        );
    }

    return (
        <div className="widget-files">
            <div className="widget-files-path">{targetPath}</div>
            {tree.map((item) => (
                <div key={item.path} className={`file-tree-item file-tree-indent ${item.type}`}>
                    {item.type === 'directory' ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                    ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                    )}
                    <span>{item.name}</span>
                </div>
            ))}
        </div>
    );
}

// ══════════════════════════════════════════
//  Browser Widget
// ══════════════════════════════════════════

function BrowserWidget({ data }: { data?: Record<string, unknown> }) {
    const [url, setUrl] = useState((data?.url as string) || '');
    return (
        <div className="widget-browser">
            <div className="browser-toolbar">
                <input className="browser-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Enter URL..." spellCheck={false} />
            </div>
            <div className="widget-placeholder">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5">
                    <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                </svg>
                <p>Mini browser preview</p>
                <span>Enter a URL above to preview</span>
            </div>
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
    const [tasks, setTasks] = useState<TaskSummary | null>(null);

    useEffect(() => {
        try {
            const stored = localStorage.getItem('onicode-active-project');
            if (stored) {
                const p = JSON.parse(stored);
                setProject(p);
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

        // Load initial tasks
        if (isElectron) {
            window.onicode!.tasksList().then(setTasks).catch(() => { });
        }

        // Listen for real-time task updates from main process
        let unsubTasks: (() => void) | undefined;
        if (isElectron) {
            unsubTasks = window.onicode!.onTasksUpdated((data) => setTasks(data));
        }

        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.name) setProject(detail);
        };
        window.addEventListener('onicode-project-activate', handler);
        return () => {
            window.removeEventListener('onicode-project-activate', handler);
            unsubTasks?.();
        };
    }, []);

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

    const statusIcon = (status: string) => {
        switch (status) {
            case 'done': return <span className="task-status-icon task-done">✓</span>;
            case 'in_progress': return <span className="task-status-icon task-progress">▶</span>;
            case 'skipped': return <span className="task-status-icon task-skipped">–</span>;
            default: return <span className="task-status-icon task-pending">○</span>;
        }
    };

    const priorityClass = (p: string) => p === 'high' ? 'task-high' : p === 'low' ? 'task-low' : '';

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
            {tasks && tasks.total > 0 && (
                <div className="project-widget-section">
                    <div className="project-widget-label">
                        Tasks ({tasks.done}/{tasks.total})
                    </div>
                    <div className="project-widget-progress">
                        <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${tasks.total > 0 ? (tasks.done / tasks.total) * 100 : 0}%` }} />
                        </div>
                        <span className="progress-text">{Math.round((tasks.done / tasks.total) * 100)}%</span>
                    </div>
                    <div className="project-widget-tasks">
                        {tasks.tasks.map((task: TaskItem) => (
                            <div key={task.id} className={`project-widget-task ${priorityClass(task.priority)}`}>
                                {statusIcon(task.status)}
                                <span className={task.status === 'done' ? 'task-content-done' : ''}>{task.content}</span>
                            </div>
                        ))}
                    </div>
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
        </div>
    );
}

// ══════════════════════════════════════════
//  Placeholder
// ══════════════════════════════════════════

function PlaceholderWidget({ type }: { type: WidgetType }) {
    const labels: Record<WidgetType, string> = { terminal: 'Terminal', project: 'Project', files: 'File Viewer', browser: 'Browser', pdf: 'PDF Viewer', excel: 'Spreadsheet', word: 'Document', camera: 'Camera', image: 'Image Viewer' };
    return (
        <div className="widget-placeholder">
            <p>{labels[type]} widget</p>
            <span>Coming soon</span>
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

export default function RightPanel({ panel, onClose, onChangeWidget }: RightPanelProps) {
    const [collapsed, setCollapsed] = useState(false);

    if (!panel.widget) return null;
    const activeWidget = WIDGETS.find((w) => w.id === panel.widget);

    const renderWidget = () => {
        switch (panel.widget) {
            case 'terminal': return <TerminalWidget />;
            case 'project': return <ProjectWidget />;
            case 'files': return <FileViewerWidget data={panel.data} />;
            case 'browser': return <BrowserWidget data={panel.data} />;
            default: return <PlaceholderWidget type={panel.widget!} />;
        }
    };

    return (
        <div className={`right-panel ${collapsed ? 'right-panel-collapsed' : ''}`}>
            <div className="right-panel-header">
                <div className="right-panel-tabs">
                    {WIDGETS.slice(0, 5).map((w) => (
                        <button key={w.id} className={`panel-tab ${panel.widget === w.id ? 'active' : ''}`} onClick={() => onChangeWidget(w.id)} title={w.label}>
                            {w.icon}
                        </button>
                    ))}
                </div>
                {!collapsed && <div className="right-panel-title">{activeWidget?.label}</div>}
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
                    {renderWidget()}
                </div>
            )}
        </div>
    );
}
