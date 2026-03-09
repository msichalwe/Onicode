import React, { useState, useEffect, useRef, useCallback } from 'react';

const isElectron = typeof window !== 'undefined' && !!window.onicode;

// ══════════════════════════════════════════
//  Widget Types (kernel layer)
// ══════════════════════════════════════════

export type WidgetType = 'terminal' | 'files' | 'browser' | 'pdf' | 'excel' | 'word' | 'camera' | 'image';

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
    { id: 'files', label: 'Files', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg> },
    { id: 'browser', label: 'Browser', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg> },
    { id: 'pdf', label: 'PDF', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg> },
    { id: 'image', label: 'Image', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg> },
    { id: 'camera', label: 'Camera', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg> },
];

// ══════════════════════════════════════════
//  Terminal Widget (real shell via IPC)
// ══════════════════════════════════════════

function TerminalWidget() {
    const [output, setOutput] = useState<string[]>([]);
    const [currentInput, setCurrentInput] = useState('');
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [cmdHistory, setCmdHistory] = useState<string[]>([]);
    const [historyIdx, setHistoryIdx] = useState(-1);
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

    return (
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
                    />
                </div>
            )}
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
                <div key={item.path} className={`file-tree-item ${item.type}`} style={{ paddingLeft: '12px' }}>
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
//  Placeholder
// ══════════════════════════════════════════

function PlaceholderWidget({ type }: { type: WidgetType }) {
    const labels: Record<WidgetType, string> = { terminal: 'Terminal', files: 'File Viewer', browser: 'Browser', pdf: 'PDF Viewer', excel: 'Spreadsheet', word: 'Document', camera: 'Camera', image: 'Image Viewer' };
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
    if (!panel.widget) return null;
    const activeWidget = WIDGETS.find((w) => w.id === panel.widget);

    const renderWidget = () => {
        switch (panel.widget) {
            case 'terminal': return <TerminalWidget />;
            case 'files': return <FileViewerWidget data={panel.data} />;
            case 'browser': return <BrowserWidget data={panel.data} />;
            default: return <PlaceholderWidget type={panel.widget!} />;
        }
    };

    return (
        <div className="right-panel">
            <div className="right-panel-header">
                <div className="right-panel-tabs">
                    {WIDGETS.slice(0, 5).map((w) => (
                        <button key={w.id} className={`panel-tab ${panel.widget === w.id ? 'active' : ''}`} onClick={() => onChangeWidget(w.id)} title={w.label}>
                            {w.icon}
                        </button>
                    ))}
                </div>
                <div className="right-panel-title">{activeWidget?.label}</div>
                <button className="panel-close" onClick={onClose} title="Close panel">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>
            <div className="right-panel-body">
                {renderWidget()}
            </div>
        </div>
    );
}
