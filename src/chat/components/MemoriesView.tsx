/**
 * MemoriesView — Sidebar view for managing AI memories.
 * Shows soul.md, user.md, MEMORY.md, daily logs.
 * Supports viewing, editing, and creating memory files.
 */

import React, { useState, useEffect, useCallback } from 'react';

interface MemoryFile {
    name: string;
    size: number;
    modified: string;
}

type EditingState = { name: string; content: string } | null;

const isElectron = typeof window !== 'undefined' && !!window.onicode;

const CORE_FILES = ['soul.md', 'user.md', 'MEMORY.md'];

export default function MemoriesView() {
    const [files, setFiles] = useState<MemoryFile[]>([]);
    const [editing, setEditing] = useState<EditingState>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const loadFiles = useCallback(async () => {
        if (!isElectron) { setLoading(false); return; }
        const result = await window.onicode!.memoryList();
        if (result.success && result.files) {
            setFiles(result.files);
        }
        setLoading(false);
    }, []);

    useEffect(() => { loadFiles(); }, [loadFiles]);

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
        loadFiles();
    }, [editing, loadFiles]);

    const deleteFile = useCallback(async (name: string) => {
        if (!isElectron) return;
        if (CORE_FILES.includes(name)) return; // Don't allow deleting core files
        await window.onicode!.memoryDelete(name);
        loadFiles();
    }, [loadFiles]);

    const createNewMemory = useCallback(() => {
        const today = new Date().toISOString().slice(0, 10);
        setEditing({ name: `${today}.md`, content: `# Session Notes — ${today}\n\n` });
    }, []);

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

    const getCoreIcon = (name: string) => {
        if (name === 'soul.md') return (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                <path d="M12 6v6l4 2" />
            </svg>
        );
        if (name === 'user.md') return (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
            </svg>
        );
        if (name === 'MEMORY.md') return (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
                <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
            </svg>
        );
        return (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
            </svg>
        );
    };

    const getCoreLabel = (name: string) => {
        if (name === 'soul.md') return 'AI Personality';
        if (name === 'user.md') return 'User Profile';
        if (name === 'MEMORY.md') return 'Long-Term Memory';
        return name.replace('.md', '');
    };

    // ── Editing view ──
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
                    <button
                        className="memories-save-btn"
                        onClick={saveFile}
                        disabled={saving}
                        title="Save"
                    >
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

    // ── List view ──
    const coreFiles = files.filter(f => CORE_FILES.includes(f.name));
    const dailyFiles = files.filter(f => !CORE_FILES.includes(f.name));

    return (
        <div className="memories-view">
            <div className="memories-header">
                <h2>Memories</h2>
                <button className="memories-new-btn" onClick={createNewMemory} title="New daily note">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                </button>
            </div>

            {loading ? (
                <div className="memories-loading">Loading memories...</div>
            ) : !isElectron ? (
                <div className="memories-empty">
                    <p>Memory system requires the Electron desktop app.</p>
                </div>
            ) : (
                <>
                    {/* Core memories */}
                    <div className="memories-section">
                        <div className="memories-section-title">Core Memories</div>
                        <div className="memories-section-desc">Always injected into AI context</div>
                        {CORE_FILES.map(name => {
                            const file = coreFiles.find(f => f.name === name);
                            return (
                                <div
                                    key={name}
                                    className={`memory-card ${file ? '' : 'memory-card-missing'}`}
                                    onClick={() => file ? openFile(name) : null}
                                >
                                    <div className="memory-card-icon">{getCoreIcon(name)}</div>
                                    <div className="memory-card-info">
                                        <div className="memory-card-name">{getCoreLabel(name)}</div>
                                        <div className="memory-card-meta">
                                            {file
                                                ? `${formatSize(file.size)} · ${formatDate(file.modified)}`
                                                : 'Not created yet'
                                            }
                                        </div>
                                    </div>
                                    {file && (
                                        <button className="memory-card-edit" title="Edit">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                                            </svg>
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Daily logs */}
                    {dailyFiles.length > 0 && (
                        <div className="memories-section">
                            <div className="memories-section-title">Daily Logs</div>
                            <div className="memories-section-desc">Append-only session notes</div>
                            {dailyFiles.map(file => (
                                <div key={file.name} className="memory-card" onClick={() => openFile(file.name)}>
                                    <div className="memory-card-icon">{getCoreIcon(file.name)}</div>
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

                    {/* Info */}
                    <div className="memories-info">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="16" x2="12" y2="12" />
                            <line x1="12" y1="8" x2="12.01" y2="8" />
                        </svg>
                        <span>
                            Core memories are injected into every AI request.
                            Daily logs are loaded for today + yesterday.
                            Inspired by <strong>OpenClaw</strong>'s memory architecture.
                        </span>
                    </div>
                </>
            )}
        </div>
    );
}
