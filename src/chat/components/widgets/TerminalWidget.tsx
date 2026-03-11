import React, { useState, useEffect, useRef, useCallback } from 'react';
import { isElectron, stripAnsi } from '../../utils';

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

export default TerminalWidget;
