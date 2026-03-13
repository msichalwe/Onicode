/**
 * Agent Runtime & Memory Intelligence View
 *
 * Shows active agents, terminals, and the OpenViking-inspired memory system:
 * - Core memories (soul, user, MEMORY.md)
 * - Facts ranked by hotness (access frequency × recency)
 * - Memory relations graph
 * - Smart search with intent analysis
 * - Memory stats dashboard
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { isElectron } from '../utils';

interface MemoryFile {
    name: string;
    size: number;
    modified: string;
    scope?: string;
    category?: string;
    id?: number;
}

interface MemoryEntry {
    id: number;
    category: string;
    key: string;
    abstract: string;
    hotness: string;
    access_count: number;
    last_accessed: string;
}

interface RelatedMemory {
    id: number;
    category: string;
    relation_type: string;
    content: string;
    updated_at: string;
}

interface SmartResult {
    id: number;
    category: string;
    file: string;
    content: string;
    hotness: string;
    score: string;
    updated_at: string;
}

interface AgentInfo {
    id: string;
    task: string;
    status: 'running' | 'done' | 'error';
    startedAt: number;
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

type RuntimeTab = 'memory' | 'agents' | 'terminals';
type MemorySubTab = 'overview' | 'facts' | 'search';

const CORE_FILES = ['soul.md', 'user.md', 'MEMORY.md'];

const CATEGORY_LABELS: Record<string, string> = {
    preference: 'Preference',
    personal: 'Personal',
    decision: 'Decision',
    correction: 'Correction',
    technical: 'Technical',
    general: 'General',
    entity: 'Entity',
    event: 'Event',
    pattern: 'Pattern',
};

const CATEGORY_COLORS: Record<string, string> = {
    preference: 'var(--accent)',
    personal: '#e67e22',
    decision: '#27ae60',
    correction: '#e74c3c',
    technical: '#8e44ad',
    general: 'var(--text-secondary)',
    entity: '#2980b9',
    event: '#f39c12',
    pattern: '#16a085',
};

export default function MemoriesView() {
    const [activeTab, setActiveTab] = useState<RuntimeTab>('memory');
    const [memSubTab, setMemSubTab] = useState<MemorySubTab>('overview');
    const [agents, setAgents] = useState<AgentInfo[]>([]);
    const [terminals, setTerminals] = useState<TerminalSessionInfo[]>([]);
    const [memFiles, setMemFiles] = useState<MemoryFile[]>([]);
    const [hotMemories, setHotMemories] = useState<MemoryEntry[]>([]);
    const [editing, setEditing] = useState<{ name: string; content: string } | null>(null);
    const [selectedMemory, setSelectedMemory] = useState<number | null>(null);
    const [relatedMemories, setRelatedMemories] = useState<RelatedMemory[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SmartResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [memStats, setMemStats] = useState<{ total: number; byCategory: Array<{ category: string; count: number }> } | null>(null);

    // Agent events
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
                    if (idx >= 0) { const u = [...prev]; u[idx] = agent; return u; }
                    return [...prev, agent];
                });
            }
        });
        return unsub;
    }, []);

    // Terminal events
    useEffect(() => {
        if (!window.onicode?.onTerminalSession) return;
        const unsub = window.onicode.onTerminalSession((session) => {
            setTerminals(prev => {
                const idx = prev.findIndex(t => t.id === session.id);
                if (idx >= 0) { const u = [...prev]; u[idx] = session as TerminalSessionInfo; return u; }
                return [...prev, session as TerminalSessionInfo];
            });
        });
        return unsub;
    }, []);

    // Load all memory data
    const loadAll = useCallback(async () => {
        if (!isElectron) { setLoading(false); return; }
        try {
            const [filesRes, hotRes, statsRes] = await Promise.allSettled([
                window.onicode!.memoryList(),
                window.onicode!.memoryHotList?.(undefined, 30) ?? { success: false },
                window.onicode!.memoryStats(),
            ]);
            if (filesRes.status === 'fulfilled' && filesRes.value.success && filesRes.value.files) {
                setMemFiles(filesRes.value.files);
            }
            if (hotRes.status === 'fulfilled' && hotRes.value.success && hotRes.value.memories) {
                setHotMemories(hotRes.value.memories as MemoryEntry[]);
            }
            if (statsRes.status === 'fulfilled' && statsRes.value.success) {
                setMemStats({
                    total: statsRes.value.total || 0,
                    byCategory: (statsRes.value.byCategory || []) as Array<{ category: string; count: number }>,
                });
            }
        } catch { /* ignore */ }
        setLoading(false);
    }, []);

    useEffect(() => { loadAll(); }, [loadAll]);

    // Memory change listener
    useEffect(() => {
        if (!window.onicode?.onMemoryChanged) return;
        const unsub = window.onicode.onMemoryChanged(() => loadAll());
        return unsub;
    }, [loadAll]);

    // Auto-refresh
    useEffect(() => {
        if (activeTab !== 'memory') return;
        const iv = setInterval(loadAll, 15000);
        return () => clearInterval(iv);
    }, [activeTab, loadAll]);

    // Load related memories when selecting a fact
    useEffect(() => {
        if (selectedMemory === null || !window.onicode?.memoryRelated) {
            setRelatedMemories([]);
            return;
        }
        window.onicode.memoryRelated(selectedMemory).then(res => {
            if (res.success && res.related) setRelatedMemories(res.related as RelatedMemory[]);
        }).catch(() => setRelatedMemories([]));
    }, [selectedMemory]);

    const openFile = useCallback(async (name: string) => {
        if (!isElectron) return;
        const result = await window.onicode!.memoryRead(name);
        if (result.success) setEditing({ name, content: result.content || '' });
    }, []);

    const saveFile = useCallback(async () => {
        if (!isElectron || !editing) return;
        setSaving(true);
        await window.onicode!.memoryWrite(editing.name, editing.content);
        setSaving(false);
        setEditing(null);
        loadAll();
    }, [editing, loadAll]);

    const deleteFile = useCallback(async (name: string) => {
        if (!isElectron || CORE_FILES.includes(name)) return;
        await window.onicode!.memoryDelete(name);
        loadAll();
    }, [loadAll]);

    const runSmartSearch = useCallback(async () => {
        if (!searchQuery.trim() || !window.onicode?.memorySmartSearch) return;
        setSearching(true);
        try {
            const res = await window.onicode.memorySmartSearch(searchQuery.trim());
            if (res.success && res.results) setSearchResults(res.results as SmartResult[]);
        } catch { /* ignore */ }
        setSearching(false);
    }, [searchQuery]);

    // Derived data
    const coreFiles = useMemo(() => memFiles.filter(f => CORE_FILES.includes(f.name) && f.scope !== 'project'), [memFiles]);
    const projectFiles = useMemo(() => memFiles.filter(f => f.scope === 'project'), [memFiles]);
    const dailyFiles = useMemo(() => memFiles.filter(f => !CORE_FILES.includes(f.name) && f.scope !== 'project' && f.category !== 'fact'), [memFiles]);

    // Group hot memories by category tag extracted from content
    const categorizedFacts = useMemo(() => {
        const groups: Record<string, MemoryEntry[]> = {};
        for (const m of hotMemories) {
            if (m.category !== 'fact') continue;
            // Extract category tag from content like "[preference]..."
            const tagMatch = (m.abstract || '').match(/^\[(\w+)\]\s*/i);
            const tag = tagMatch ? tagMatch[1].toLowerCase() : 'general';
            if (!groups[tag]) groups[tag] = [];
            groups[tag].push(m);
        }
        return groups;
    }, [hotMemories]);

    const formatSize = (b: number) => b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`;

    const formatDate = (iso: string) => {
        if (!iso) return '';
        const d = new Date(iso);
        const diff = Date.now() - d.getTime();
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

    const formatDuration = (ms?: number) => {
        if (!ms) return '';
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
    };

    const hotnessBar = (score: string | number) => {
        const val = typeof score === 'string' ? parseFloat(score) : score;
        const pct = Math.min(100, Math.max(0, val * 100));
        return (
            <div className="mv-hotness-bar" title={`Hotness: ${(val * 100).toFixed(0)}%`}>
                <div className="mv-hotness-fill" style={{ width: `${pct}%` }} />
            </div>
        );
    };

    // ── Editor view ──
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

            {/* Main tabs */}
            <div className="runtime-tabs">
                <button className={`runtime-tab ${activeTab === 'memory' ? 'active' : ''}`} onClick={() => setActiveTab('memory')}>
                    Memory {memStats && <span className="runtime-tab-count">{memStats.total}</span>}
                </button>
                <button className={`runtime-tab ${activeTab === 'agents' ? 'active' : ''}`} onClick={() => setActiveTab('agents')}>
                    Agents {agents.length > 0 && <span className="runtime-tab-count">{agents.length}</span>}
                </button>
                <button className={`runtime-tab ${activeTab === 'terminals' ? 'active' : ''}`} onClick={() => setActiveTab('terminals')}>
                    Terminals {terminals.length > 0 && <span className="runtime-tab-count">{terminals.length}</span>}
                </button>
            </div>

            {/* ══════════ Memory Tab ══════════ */}
            {activeTab === 'memory' && (
                <div className="runtime-section">
                    {loading ? (
                        <div className="memories-loading">Loading memories...</div>
                    ) : !isElectron ? (
                        <div className="runtime-empty"><p>Memory system requires the Electron desktop app.</p></div>
                    ) : (
                        <>
                            {/* Memory sub-tabs */}
                            <div className="mv-subtabs">
                                <button className={`mv-subtab ${memSubTab === 'overview' ? 'active' : ''}`} onClick={() => setMemSubTab('overview')}>Overview</button>
                                <button className={`mv-subtab ${memSubTab === 'facts' ? 'active' : ''}`} onClick={() => setMemSubTab('facts')}>
                                    Facts {hotMemories.filter(m => m.category === 'fact').length > 0 && <span className="mv-subtab-count">{hotMemories.filter(m => m.category === 'fact').length}</span>}
                                </button>
                                <button className={`mv-subtab ${memSubTab === 'search' ? 'active' : ''}`} onClick={() => setMemSubTab('search')}>Search</button>
                            </div>

                            {/* ── Overview Sub-tab ── */}
                            {memSubTab === 'overview' && (
                                <>
                                    {/* Stats banner */}
                                    {memStats && (
                                        <div className="mv-stats-row">
                                            <div className="mv-stat">
                                                <div className="mv-stat-value">{memStats.total}</div>
                                                <div className="mv-stat-label">Memories</div>
                                            </div>
                                            {memStats.byCategory.map(c => (
                                                <div className="mv-stat" key={c.category}>
                                                    <div className="mv-stat-value">{c.count}</div>
                                                    <div className="mv-stat-label">{c.category}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Core memories */}
                                    <div className="memories-section">
                                        <div className="memories-section-title">Core Memories</div>
                                        {CORE_FILES.map(name => {
                                            const file = coreFiles.find(f => f.name === name);
                                            const labels: Record<string, string> = { 'soul.md': 'AI Personality', 'user.md': 'User Profile', 'MEMORY.md': 'Long-Term Index' };
                                            const icons: Record<string, string> = { 'soul.md': 'ghost', 'user.md': 'user', 'MEMORY.md': 'brain' };
                                            return (
                                                <div key={name} className={`memory-card ${file ? '' : 'memory-card-missing'}`} onClick={() => file && openFile(name)}>
                                                    <div className="mv-core-icon">
                                                        {icons[name] === 'ghost' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2a8 8 0 00-8 8v12l3-3 2 3 3-3 3 3 2-3 3 3V10a8 8 0 00-8-8z" /><circle cx="9" cy="10" r="1.5" fill="currentColor" /><circle cx="15" cy="10" r="1.5" fill="currentColor" /></svg>}
                                                        {icons[name] === 'user' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>}
                                                        {icons[name] === 'brain' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z" /><path d="M9 21h6M10 17v4M14 17v4" /></svg>}
                                                    </div>
                                                    <div className="memory-card-info">
                                                        <div className="memory-card-name">{labels[name]}</div>
                                                        <div className="memory-card-meta">
                                                            {file ? `${formatSize(file.size)} · ${formatDate(file.modified)}` : 'Not created yet'}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Top hottest facts */}
                                    {hotMemories.filter(m => m.category === 'fact').length > 0 && (
                                        <div className="memories-section">
                                            <div className="memories-section-title">Hottest Facts</div>
                                            {hotMemories.filter(m => m.category === 'fact').slice(0, 5).map(m => (
                                                <div key={m.id} className="mv-fact-card" onClick={() => setSelectedMemory(selectedMemory === m.id ? null : m.id)}>
                                                    <div className="mv-fact-top">
                                                        <span className="mv-fact-abstract">{m.abstract || '(no abstract)'}</span>
                                                        <span className="mv-fact-access" title={`Accessed ${m.access_count} times`}>{m.access_count}x</span>
                                                    </div>
                                                    {hotnessBar(m.hotness)}
                                                    {selectedMemory === m.id && relatedMemories.length > 0 && (
                                                        <div className="mv-related">
                                                            <div className="mv-related-title">Related memories</div>
                                                            {relatedMemories.map(r => (
                                                                <div key={r.id} className="mv-related-item">
                                                                    <span className="mv-related-type">{r.relation_type}</span>
                                                                    <span className="mv-related-content">{r.content.slice(0, 100)}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Project memories */}
                                    {projectFiles.length > 0 && (
                                        <div className="memories-section">
                                            <div className="memories-section-title">Project Memories</div>
                                            {projectFiles.map(file => (
                                                <div key={file.name} className="memory-card" onClick={() => openFile(file.name)}>
                                                    <div className="memory-card-info">
                                                        <div className="memory-card-name">{file.name.replace('.md', '')}</div>
                                                        <div className="memory-card-meta">{formatSize(file.size)} · {formatDate(file.modified)}</div>
                                                    </div>
                                                    <button className="memory-card-delete" onClick={(e) => { e.stopPropagation(); deleteFile(file.name); }} title="Delete">
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Daily logs */}
                                    {dailyFiles.length > 0 && (
                                        <div className="memories-section">
                                            <div className="memories-section-title">Daily Logs</div>
                                            {dailyFiles.slice(0, 7).map(file => (
                                                <div key={file.name} className="memory-card" onClick={() => openFile(file.name)}>
                                                    <div className="memory-card-info">
                                                        <div className="memory-card-name">{file.name.replace('.md', '')}</div>
                                                        <div className="memory-card-meta">{formatSize(file.size)} · {formatDate(file.modified)}</div>
                                                    </div>
                                                    <button className="memory-card-delete" onClick={(e) => { e.stopPropagation(); deleteFile(file.name); }} title="Delete">
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}

                            {/* ── Facts Sub-tab ── */}
                            {memSubTab === 'facts' && (
                                <>
                                    {Object.keys(categorizedFacts).length === 0 ? (
                                        <div className="runtime-empty">
                                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                <path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z" />
                                                <path d="M9 21h6" />
                                            </svg>
                                            <p>No learned facts yet</p>
                                            <span>The AI automatically extracts and deduplicates facts from your conversations.</span>
                                        </div>
                                    ) : (
                                        Object.entries(categorizedFacts).map(([tag, facts]) => (
                                            <div className="memories-section" key={tag}>
                                                <div className="memories-section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <span className="mv-cat-dot" style={{ background: CATEGORY_COLORS[tag] || 'var(--text-secondary)' }} />
                                                    {CATEGORY_LABELS[tag] || tag} <span style={{ opacity: 0.5, fontWeight: 400 }}>({facts.length})</span>
                                                </div>
                                                {facts.map(m => (
                                                    <div key={m.id} className="mv-fact-card" onClick={() => setSelectedMemory(selectedMemory === m.id ? null : m.id)}>
                                                        <div className="mv-fact-top">
                                                            <span className="mv-fact-abstract">
                                                                {(m.abstract || '').replace(/^\[\w+\]\s*/, '')}
                                                            </span>
                                                            <span className="mv-fact-access" title={`Accessed ${m.access_count} times`}>{m.access_count}x</span>
                                                        </div>
                                                        <div className="mv-fact-bottom">
                                                            {hotnessBar(m.hotness)}
                                                            <span className="mv-fact-date">{formatDate(m.last_accessed)}</span>
                                                        </div>
                                                        {selectedMemory === m.id && relatedMemories.length > 0 && (
                                                            <div className="mv-related">
                                                                <div className="mv-related-title">Related</div>
                                                                {relatedMemories.map(r => (
                                                                    <div key={r.id} className="mv-related-item">
                                                                        <span className="mv-related-type">{r.relation_type}</span>
                                                                        <span className="mv-related-content">{r.content.slice(0, 120)}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        ))
                                    )}
                                </>
                            )}

                            {/* ── Search Sub-tab ── */}
                            {memSubTab === 'search' && (
                                <>
                                    <div className="mv-search-box">
                                        <input
                                            className="mv-search-input"
                                            type="text"
                                            placeholder="Smart search across all memories..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && runSmartSearch()}
                                        />
                                        <button className="mv-search-btn" onClick={runSmartSearch} disabled={searching || !searchQuery.trim()}>
                                            {searching ? 'Searching...' : 'Search'}
                                        </button>
                                    </div>
                                    <div className="mv-search-hint">
                                        Uses intent analysis + FTS5 + TF-IDF + hotness ranking
                                    </div>
                                    {searchResults.length > 0 && (
                                        <div className="memories-section">
                                            <div className="memories-section-title">Results ({searchResults.length})</div>
                                            {searchResults.map((r, i) => (
                                                <div key={r.id || i} className="mv-search-result">
                                                    <div className="mv-search-result-top">
                                                        <span className="mv-cat-badge" style={{ background: CATEGORY_COLORS[r.category] || 'var(--bg-tertiary)' }}>
                                                            {r.category}
                                                        </span>
                                                        <span className="mv-search-score">score: {r.score}</span>
                                                    </div>
                                                    <div className="mv-search-result-content">{r.content}</div>
                                                    <div className="mv-search-result-meta">
                                                        hotness: {r.hotness} · {formatDate(r.updated_at)}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {searchResults.length === 0 && searchQuery && !searching && (
                                        <div className="runtime-empty" style={{ marginTop: 32 }}>
                                            <p>No results</p>
                                            <span>Try different keywords or a more natural query.</span>
                                        </div>
                                    )}
                                </>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* ══════════ Agents Tab ══════════ */}
            {activeTab === 'agents' && (
                <div className="runtime-section">
                    {agents.length === 0 ? (
                        <div className="runtime-empty">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                            </svg>
                            <p>No active agents</p>
                            <span>Agents will appear here when the AI spawns them during complex tasks.</span>
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
                                    {agent.result && <div className="runtime-item-result">{agent.result.slice(0, 200)}</div>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ══════════ Terminals Tab ══════════ */}
            {activeTab === 'terminals' && (
                <div className="runtime-section">
                    {terminals.length === 0 ? (
                        <div className="runtime-empty">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                            </svg>
                            <p>No terminal sessions</p>
                            <span>Terminal sessions from AI commands will appear here.</span>
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
        </div>
    );
}
