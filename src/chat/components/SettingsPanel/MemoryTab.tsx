import React from 'react';
import type { MemoryTabProps } from './types';

export default function MemoryTab({
    soulContent, userContent, longTermContent,
    memoryFiles,
    editingMemory, setEditingMemory,
    editingContent, setEditingContent,
    memorySaving,
    memoryStats,
    memorySearchQuery, setMemorySearchQuery,
    memorySearchResults, memorySearching,
    saveMemoryFile, deleteMemoryFile, searchMemories,
}: MemoryTabProps) {
    return (
        <div className="settings-tab-content">
            {/* Stats Banner */}
            {memoryStats && (
                <div className="memory-stats-banner">
                    <div className="memory-stats-total">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
                        <span>{memoryStats.total} memories</span>
                        <span className="memory-stats-storage">SQLite</span>
                    </div>
                    {memoryStats.byCategory && (
                        <div className="memory-stats-categories">
                            {Object.entries(memoryStats.byCategory).map(([cat, count]) => (
                                <span key={cat} className="memory-stats-cat">
                                    {cat}: {count as number}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Search */}
            <div className="settings-section">
                <h3>Search Memories</h3>
                <p className="settings-section-desc">Full-text search across all memories (FTS5-powered).</p>
                <div className="memory-search-bar">
                    <input
                        type="text"
                        className="memory-search-input"
                        placeholder="Search memories..."
                        value={memorySearchQuery}
                        onChange={(e) => setMemorySearchQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') searchMemories(memorySearchQuery); }}
                    />
                    <button className="settings-btn settings-btn-primary" onClick={() => searchMemories(memorySearchQuery)} disabled={memorySearching}>
                        {memorySearching ? 'Searching...' : 'Search'}
                    </button>
                </div>
                {memorySearchResults.length > 0 && (
                    <div className="memory-search-results">
                        {memorySearchResults.map((r, i) => (
                            <div key={i} className="memory-search-result">
                                <div className="memory-search-result-header">
                                    <span className="memory-file-name">{r.file}</span>
                                    <span className="memory-file-scope">{r.category}</span>
                                </div>
                                <pre className="memory-search-snippet">{r.snippet}</pre>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* AI Personality (soul) */}
            <div className="settings-section">
                <h3>AI Personality</h3>
                <p className="settings-section-desc">Define how Oni behaves — personality, humor, tone, rules. Injected into every conversation.</p>
                {editingMemory === 'soul.md' ? (
                    <div className="memory-editor">
                        <textarea
                            className="memory-editor-textarea"
                            value={editingContent}
                            onChange={(e) => setEditingContent(e.target.value)}
                            rows={14}
                            spellCheck={false}
                        />
                        <div className="memory-editor-actions">
                            <button className="settings-btn settings-btn-primary" onClick={() => saveMemoryFile('soul.md', editingContent)} disabled={memorySaving}>
                                {memorySaving ? 'Saving...' : 'Save'}
                            </button>
                            <button className="settings-btn" onClick={() => setEditingMemory(null)}>Cancel</button>
                        </div>
                    </div>
                ) : (
                    <div className="memory-preview" onClick={() => { setEditingMemory('soul.md'); setEditingContent(soulContent); }}>
                        <pre className="memory-preview-content">{soulContent || '(empty — click to edit)'}</pre>
                        <span className="memory-preview-hint">Click to edit</span>
                    </div>
                )}
            </div>

            {/* User Profile */}
            <div className="settings-section">
                <h3>User Profile</h3>
                <p className="settings-section-desc">Your preferences, coding style, and info the AI remembers about you.</p>
                {editingMemory === 'user.md' ? (
                    <div className="memory-editor">
                        <textarea
                            className="memory-editor-textarea"
                            value={editingContent}
                            onChange={(e) => setEditingContent(e.target.value)}
                            rows={10}
                            spellCheck={false}
                        />
                        <div className="memory-editor-actions">
                            <button className="settings-btn settings-btn-primary" onClick={() => saveMemoryFile('user.md', editingContent)} disabled={memorySaving}>
                                {memorySaving ? 'Saving...' : 'Save'}
                            </button>
                            <button className="settings-btn" onClick={() => setEditingMemory(null)}>Cancel</button>
                        </div>
                    </div>
                ) : (
                    <div className="memory-preview" onClick={() => { setEditingMemory('user.md'); setEditingContent(userContent); }}>
                        <pre className="memory-preview-content">{userContent || '(empty — click to edit)'}</pre>
                        <span className="memory-preview-hint">Click to edit</span>
                    </div>
                )}
            </div>

            {/* Long-term Memory */}
            <div className="settings-section">
                <h3>Long-term Memory</h3>
                <p className="settings-section-desc">Durable facts and decisions the AI has learned across sessions.</p>
                {editingMemory === 'MEMORY.md' ? (
                    <div className="memory-editor">
                        <textarea
                            className="memory-editor-textarea"
                            value={editingContent}
                            onChange={(e) => setEditingContent(e.target.value)}
                            rows={12}
                            spellCheck={false}
                        />
                        <div className="memory-editor-actions">
                            <button className="settings-btn settings-btn-primary" onClick={() => saveMemoryFile('MEMORY.md', editingContent)} disabled={memorySaving}>
                                {memorySaving ? 'Saving...' : 'Save'}
                            </button>
                            <button className="settings-btn" onClick={() => setEditingMemory(null)}>Cancel</button>
                        </div>
                    </div>
                ) : (
                    <div className="memory-preview" onClick={() => { setEditingMemory('MEMORY.md'); setEditingContent(longTermContent); }}>
                        <pre className="memory-preview-content">{longTermContent || '(empty — click to edit)'}</pre>
                        <span className="memory-preview-hint">Click to edit</span>
                    </div>
                )}
            </div>

            {/* All Memory Entries */}
            <div className="settings-section">
                <h3>All Memory Entries</h3>
                <p className="settings-section-desc">All entries stored in SQLite — daily logs, project memories, learned facts.</p>
                <div className="memory-files-list">
                    {memoryFiles.filter(f => f.name !== 'soul.md' && f.name !== 'user.md' && f.name !== 'MEMORY.md').map(f => (
                        <div key={f.name} className={`memory-file-item ${editingMemory === f.name ? 'memory-file-item-active' : ''}`}>
                            <div className="memory-file-info" onClick={() => {
                                if (editingMemory === f.name) { setEditingMemory(null); return; }
                                window.onicode?.memoryRead(f.name).then(r => {
                                    if (r?.content != null) { setEditingMemory(f.name); setEditingContent(r.content); }
                                });
                            }}>
                                <span className="memory-file-name">{f.name}</span>
                                <span className="memory-file-meta">
                                    <span className="memory-file-size">{f.size < 1024 ? `${f.size}B` : `${(f.size / 1024).toFixed(1)}KB`}</span>
                                    <span className="memory-file-scope">{f.category}</span>
                                    {f.modified && <span className="memory-file-date">{new Date(f.modified).toLocaleDateString()}</span>}
                                </span>
                            </div>
                            <button className="memory-file-delete" title="Delete" onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`Delete memory "${f.name}"?`)) deleteMemoryFile(f.name);
                            }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            </button>
                        </div>
                    ))}
                    {editingMemory && !['soul.md', 'user.md', 'MEMORY.md'].includes(editingMemory) && (
                        <div className="memory-editor" style={{ marginTop: 8 }}>
                            <textarea
                                className="memory-editor-textarea"
                                value={editingContent}
                                onChange={(e) => setEditingContent(e.target.value)}
                                rows={10}
                                spellCheck={false}
                            />
                            <div className="memory-editor-actions">
                                <button className="settings-btn settings-btn-primary" onClick={() => saveMemoryFile(editingMemory!, editingContent)} disabled={memorySaving}>
                                    {memorySaving ? 'Saving...' : 'Save'}
                                </button>
                                <button className="settings-btn" onClick={() => setEditingMemory(null)}>Cancel</button>
                            </div>
                        </div>
                    )}
                    {memoryFiles.filter(f => f.name !== 'soul.md' && f.name !== 'user.md' && f.name !== 'MEMORY.md').length === 0 && (
                        <div className="memory-files-empty">No additional memories yet. The AI creates these as it learns.</div>
                    )}
                </div>
            </div>
        </div>
    );
}
