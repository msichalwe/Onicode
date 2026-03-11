/**
 * Agent Runtime View — Shows active agents, sub-agents, terminal sessions,
 * background processes, and memory management.
 */

import React, { useState, useEffect, useCallback } from 'react';

interface MemoryFile {
    name: string;
    size: number;
    modified: string;
}

interface AgentInfo {
    id: string;
    task: string;
    status: 'running' | 'done' | 'error';
    startedAt: number;
    completedAt?: number;
    result?: string;
}

interface TerminalSessionInfo {
    id: string;
    command: string;
    cwd: string;
    startedAt: number;
    status: 'running' | 'done' | 'error';
    exitCode?: number;
    duration?: number;
    port?: number;
}

type RuntimeTab = 'agents' | 'terminals' | 'memory';

import { isElectron } from '../utils';

const CORE_FILES = ['soul.md', 'user.md', 'MEMORY.md'];

export default function MemoriesView() {
    const [activeTab, setActiveTab] = useState<RuntimeTab>('memory');
    const [agents, setAgents] = useState<AgentInfo[]>([]);
    const [terminals, setTerminals] = useState<TerminalSessionInfo[]>([]);
    const [memFiles, setMemFiles] = useState<MemoryFile[]>([]);
    const [editing, setEditing] = useState<{ name: string; content: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Listen for agent events
    useEffect(() => {
        if (!window.onicode?.onAgentStep) return;
        const unsub = window.onicode.onAgentStep((data: Record<string, unknown>) => {
            if (data.agentId && data.task) {
                setAgents(prev => {
                    const idx = prev.findIndex(a => a.id === data.agentId);
                    const agent: AgentInfo = {
                        id: data.agentId as string,
                        task: (data.task as string) || 'Working...',
                        status: (data.status as string) === 'done' ? 'done' : 'running',
                        startedAt: idx >= 0 ? prev[idx].startedAt : Date.now(),
                    };
                    if (idx >= 0) {
                        const updated = [...prev];
                        updated[idx] = agent;
                        return updated;
                    }
                    return [...prev, agent];
                });
            }
        });
        return unsub;
    }, []);

    // Listen for terminal sessions
    useEffect(() => {
        if (!window.onicode?.onTerminalSession) return;
        const unsub = window.onicode.onTerminalSession((session) => {
            setTerminals(prev => {
                const idx = prev.findIndex(t => t.id === session.id);
                if (idx >= 0) {
                    const updated = [...prev];
                    updated[idx] = session as TerminalSessionInfo;
                    return updated;
                }
                return [...prev, session as TerminalSessionInfo];
            });
        });
        return unsub;
    }, []);

    // Load memory files
    const loadMemFiles = useCallback(async () => {
        if (!isElectron) { setLoading(false); return; }
        const result = await window.onicode!.memoryList();
        if (result.success && result.files) {
            setMemFiles(result.files);
        }
        setLoading(false);
    }, []);

    useEffect(() => { loadMemFiles(); }, [loadMemFiles]);

    // Listen for memory change notifications (from AI tools, compaction, etc.)
    useEffect(() => {
        if (!window.onicode?.onMemoryChanged) return;
        const unsub = window.onicode.onMemoryChanged(() => {
            loadMemFiles();
        });
        return unsub;
    }, [loadMemFiles]);

    const openFile = useCallback(async (name: string) => {
        if (!isElectron) return;
        const result = await window.onicode!.memoryRead(name);
        if (result.success) {
            setEditing({ name, content: result.content || '' });
        }
    }, []);

    const saveFile = useCallback(async () => {
        if (!isElectron || !editing) return;
        setSaving(true);
        await window.onicode!.memoryWrite(editing.name, editing.content);
        setSaving(false);
        setEditing(null);
        loadMemFiles();
    }, [editing, loadMemFiles]);

    const deleteFile = useCallback(async (name: string) => {
        if (!isElectron || CORE_FILES.includes(name)) return;
        await window.onicode!.memoryDelete(name);
        loadMemFiles();
    }, [loadMemFiles]);

    const formatDuration = (ms?: number) => {
        if (!ms) return '';
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
    };

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        return `${(bytes / 1024).toFixed(1)} KB`;
    };

    const formatDate = (iso: string) => {
        const d = new Date(iso);
        const now = new Date();
        const diff = now.getTime() - d.getTime();
        if (diff < 60000) return 'just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return d.toLocaleDateString();
    };

    const timeAgo = (ts: number) => {
        const diff = Date.now() - ts;
        if (diff < 60000) return 'just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        return `${Math.floor(diff / 3600000)}h ago`;
    };

    // ── Memory editing view ──
    if (editing) {
        return (
            <div className="memories-view">
                <div className="memories-header">
                    <button className="memories-back" onClick={() => setEditing(null)} title="Back">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>
                    <h2>{editing.name}</h2>
                    <button className="memories-save-btn" onClick={saveFile} disabled={saving}>
                        {saving ? 'Saving...' : 'Save'}
                    </button>
                </div>
                <textarea
                    className="memories-editor"
                    value={editing.content}
                    onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                    spellCheck={false}
                    placeholder="Write memory content here..."
                />
            </div>
        );
    }

    const runningAgents = agents.filter(a => a.status === 'running');
    const runningTerminals = terminals.filter(t => t.status === 'running');
    const coreFiles = memFiles.filter(f => CORE_FILES.includes(f.name) && (f as MemoryFile & { scope?: string }).scope !== 'project');
    const projectFiles = memFiles.filter(f => (f as MemoryFile & { scope?: string }).scope === 'project');
    const dailyFiles = memFiles.filter(f => !CORE_FILES.includes(f.name) && (f as MemoryFile & { scope?: string }).scope !== 'project');

    // Auto-refresh memory files periodically
    useEffect(() => {
        if (activeTab !== 'memory') return;
        const interval = setInterval(loadMemFiles, 10000);
        return () => clearInterval(interval);
    }, [activeTab, loadMemFiles]);

    return (
        <div className="memories-view">
            <div className="memories-header">
                <h2>Agents & Memory</h2>
                {(runningAgents.length > 0 || runningTerminals.length > 0) && (
                    <span className="runtime-active-badge">
                        {runningAgents.length + runningTerminals.length} active
                    </span>
                )}
            </div>

            {/* Runtime tabs */}
            <div className="runtime-tabs">
                <button
                    className={`runtime-tab ${activeTab === 'memory' ? 'active' : ''}`}
                    onClick={() => setActiveTab('memory')}
                >
                    Memory {memFiles.length > 0 && <span className="runtime-tab-count">{memFiles.length}</span>}
                </button>
                <button
                    className={`runtime-tab ${activeTab === 'agents' ? 'active' : ''}`}
                    onClick={() => setActiveTab('agents')}
                >
                    Agents {agents.length > 0 && <span className="runtime-tab-count">{agents.length}</span>}
                </button>
                <button
                    className={`runtime-tab ${activeTab === 'terminals' ? 'active' : ''}`}
                    onClick={() => setActiveTab('terminals')}
                >
                    Terminals {terminals.length > 0 && <span className="runtime-tab-count">{terminals.length}</span>}
                </button>
            </div>

            {/* Agents Tab */}
            {activeTab === 'agents' && (
                <div className="runtime-section">
                    {agents.length === 0 ? (
                        <div className="runtime-empty">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <circle cx="12" cy="12" r="3" />
                                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                            </svg>
                            <p>No active agents</p>
                            <span>Agents and sub-agents will appear here when the AI spawns them during complex tasks.</span>
                        </div>
                    ) : (
                        <div className="runtime-list">
                            {agents.map(agent => (
                                <div key={agent.id} className={`runtime-item runtime-item-${agent.status}`}>
                                    <div className="runtime-item-header">
                                        <span className={`runtime-status-dot ${agent.status}`} />
                                        <span className="runtime-item-id">{agent.id.slice(0, 8)}</span>
                                        <span className="runtime-item-time">{timeAgo(agent.startedAt)}</span>
                                    </div>
                                    <div className="runtime-item-task">{agent.task}</div>
                                    {agent.result && (
                                        <div className="runtime-item-result">{agent.result.slice(0, 200)}</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Terminals Tab */}
            {activeTab === 'terminals' && (
                <div className="runtime-section">
                    {terminals.length === 0 ? (
                        <div className="runtime-empty">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <polyline points="4 17 10 11 4 5" />
                                <line x1="12" y1="19" x2="20" y2="19" />
                            </svg>
                            <p>No terminal sessions</p>
                            <span>Terminal sessions from AI commands will appear here. The AI can run dev servers, builds, and tests in parallel.</span>
                        </div>
                    ) : (
                        <div className="runtime-list">
                            {terminals.map(session => (
                                <div key={session.id} className={`runtime-item runtime-item-${session.status}`}>
                                    <div className="runtime-item-header">
                                        <span className={`runtime-status-dot ${session.status}`} />
                                        <code className="runtime-item-cmd">{session.command}</code>
                                    </div>
                                    <div className="runtime-item-meta">
                                        <span>{session.cwd}</span>
                                        {session.port && <span className="runtime-port">:{session.port}</span>}
                                        {session.duration && <span>{formatDuration(session.duration)}</span>}
                                        {session.exitCode !== undefined && <span>exit {session.exitCode}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Memory Tab */}
            {activeTab === 'memory' && (
                <div className="runtime-section">
                    {loading ? (
                        <div className="memories-loading">Loading memories...</div>
                    ) : !isElectron ? (
                        <div className="runtime-empty"><p>Memory system requires the Electron desktop app.</p></div>
                    ) : (
                        <>
                            <div className="memories-section">
                                <div className="memories-section-title">Core Memories</div>
                                {CORE_FILES.map(name => {
                                    const file = coreFiles.find(f => f.name === name);
                                    return (
                                        <div
                                            key={name}
                                            className={`memory-card ${file ? '' : 'memory-card-missing'}`}
                                            onClick={() => file ? openFile(name) : null}
                                        >
                                            <div className="memory-card-info">
                                                <div className="memory-card-name">
                                                    {name === 'soul.md' ? 'AI Personality' : name === 'user.md' ? 'User Profile' : 'Long-Term Memory'}
                                                </div>
                                                <div className="memory-card-meta">
                                                    {file ? `${formatSize(file.size)} · ${formatDate(file.modified)}` : 'Not created yet'}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            {projectFiles.length > 0 && (
                                <div className="memories-section">
                                    <div className="memories-section-title">Project Memories</div>
                                    {projectFiles.map(file => (
                                        <div key={file.name} className="memory-card" onClick={() => openFile(file.name)}>
                                            <div className="memory-card-info">
                                                <div className="memory-card-name">{file.name.replace('.md', '')}</div>
                                                <div className="memory-card-meta">{formatSize(file.size)} · {formatDate(file.modified)}</div>
                                            </div>
                                            <button
                                                className="memory-card-delete"
                                                onClick={(e) => { e.stopPropagation(); deleteFile(file.name); }}
                                                title="Delete"
                                            >
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <polyline points="3 6 5 6 21 6" />
                                                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                                </svg>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {dailyFiles.length > 0 && (
                                <div className="memories-section">
                                    <div className="memories-section-title">Daily Logs</div>
                                    {dailyFiles.map(file => (
                                        <div key={file.name} className="memory-card" onClick={() => openFile(file.name)}>
                                            <div className="memory-card-info">
                                                <div className="memory-card-name">{file.name.replace('.md', '')}</div>
                                                <div className="memory-card-meta">{formatSize(file.size)} · {formatDate(file.modified)}</div>
                                            </div>
                                            <button
                                                className="memory-card-delete"
                                                onClick={(e) => { e.stopPropagation(); deleteFile(file.name); }}
                                                title="Delete"
                                            >
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <polyline points="3 6 5 6 21 6" />
                                                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                                </svg>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
