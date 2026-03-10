import React, { useState, useEffect, useMemo } from 'react';

// ══════════════════════════════════════════
//  Attachment Gallery — Browse project-scoped attachments
// ══════════════════════════════════════════

interface GalleryAttachment {
    id: string;
    name: string;
    type: 'file' | 'link' | 'image' | 'doc';
    size?: number;
    mimeType?: string;
    url?: string;
    content?: string;
    dataUrl?: string;
    projectName?: string;
    timestamp: number;
}

type FilterType = 'all' | 'image' | 'file' | 'doc' | 'link';

export default function AttachmentGallery() {
    const [attachments, setAttachments] = useState<GalleryAttachment[]>([]);
    const [filter, setFilter] = useState<FilterType>('all');
    const [search, setSearch] = useState('');
    const [selectedAttachment, setSelectedAttachment] = useState<GalleryAttachment | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeProjectName, setActiveProjectName] = useState('');

    // Load attachments from project-scoped SQLite storage
    useEffect(() => {
        loadProjectAttachments();
    }, []);

    const loadProjectAttachments = async () => {
        setLoading(true);
        const allAtts: GalleryAttachment[] = [];

        try {
            // Get active project
            const stored = localStorage.getItem('onicode-active-project');
            if (stored) {
                const project = JSON.parse(stored);
                setActiveProjectName(project.name || '');

                // Load from SQLite attachment storage (primary source)
                if (window.onicode?.attachmentList) {
                    const result = await window.onicode.attachmentList(project.id);
                    if (result.success && result.attachments) {
                        for (const att of result.attachments) {
                            allAtts.push({
                                id: att.id,
                                name: att.name,
                                type: (att.type as GalleryAttachment['type']) || 'file',
                                size: att.size || undefined,
                                mimeType: att.mime_type || undefined,
                                url: att.url || undefined,
                                content: att.content || undefined,
                                dataUrl: att.data_url || undefined,
                                projectName: project.name,
                                timestamp: att.created_at,
                            });
                        }
                    }
                }

                // Also scan conversations for this project's attachments
                const convStored = localStorage.getItem('onicode-conversations');
                if (convStored) {
                    const convs = JSON.parse(convStored) as Array<{
                        id: string;
                        title: string;
                        projectId?: string;
                        messages: Array<{
                            attachments?: Array<{
                                name: string;
                                type: string;
                                size?: number;
                                mimeType?: string;
                                url?: string;
                                content?: string;
                                dataUrl?: string;
                            }>;
                            timestamp: number;
                        }>;
                    }>;
                    const seen = new Set(allAtts.map(a => a.name));
                    for (const conv of convs) {
                        if (conv.projectId !== project.id) continue;
                        for (const msg of conv.messages) {
                            if (msg.attachments) {
                                for (const att of msg.attachments) {
                                    if (!seen.has(att.name)) {
                                        seen.add(att.name);
                                        allAtts.push({
                                            id: `conv-${conv.id}-${att.name}`,
                                            name: att.name,
                                            type: (att.type as GalleryAttachment['type']) || 'file',
                                            size: att.size,
                                            mimeType: att.mimeType,
                                            url: att.url,
                                            content: att.content,
                                            dataUrl: att.dataUrl,
                                            projectName: project.name,
                                            timestamp: msg.timestamp,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                setActiveProjectName('');
            }
        } catch { /* parsing error */ }

        setAttachments(allAtts.sort((a, b) => b.timestamp - a.timestamp));
        setLoading(false);
    };

    const handleDelete = async (att: GalleryAttachment) => {
        if (att.id.startsWith('conv-')) return; // Can't delete conversation-embedded attachments
        if (window.onicode?.attachmentDelete) {
            await window.onicode.attachmentDelete(att.id);
            setAttachments(prev => prev.filter(a => a.id !== att.id));
            if (selectedAttachment?.id === att.id) setSelectedAttachment(null);
        }
    };

    const filteredAttachments = useMemo(() => {
        let list = attachments;
        if (filter !== 'all') {
            list = list.filter(a => a.type === filter);
        }
        if (search) {
            const q = search.toLowerCase();
            list = list.filter(a => a.name.toLowerCase().includes(q));
        }
        return list;
    }, [attachments, filter, search]);

    const counts = useMemo(() => ({
        all: attachments.length,
        image: attachments.filter(a => a.type === 'image').length,
        file: attachments.filter(a => a.type === 'file').length,
        doc: attachments.filter(a => a.type === 'doc').length,
        link: attachments.filter(a => a.type === 'link').length,
    }), [attachments]);

    const typeIcon = (type: string) => {
        switch (type) {
            case 'image': return (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                </svg>
            );
            case 'link': return (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                </svg>
            );
            case 'doc': return (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                </svg>
            );
            default: return (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                </svg>
            );
        }
    };

    return (
        <div className="gallery-view">
            <div className="gallery-header">
                <h2>{activeProjectName ? `${activeProjectName} Files` : 'Attachments'}</h2>
                <span className="gallery-count">{attachments.length} files</span>
                <button className="gallery-refresh" onClick={loadProjectAttachments} title="Refresh">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                    </svg>
                </button>
            </div>

            {!activeProjectName && (
                <div className="gallery-empty">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                    </svg>
                    <p>No active project</p>
                    <p className="gallery-empty-hint">Open a project first to see its attachments. Attachments are project-scoped.</p>
                </div>
            )}

            {activeProjectName && (
                <>
                    <div className="gallery-search">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search attachments..."
                        />
                    </div>

                    <div className="gallery-filters">
                        {(['all', 'image', 'file', 'doc', 'link'] as FilterType[]).map(f => (
                            <button
                                key={f}
                                className={`gallery-filter ${filter === f ? 'active' : ''}`}
                                onClick={() => setFilter(f)}
                            >
                                {f === 'all' ? 'All' : f === 'image' ? 'Images' : f === 'doc' ? 'Docs' : f === 'link' ? 'Links' : 'Code'}
                                <span className="gallery-filter-count">{counts[f]}</span>
                            </button>
                        ))}
                    </div>

                    {loading ? (
                        <div className="gallery-empty">Loading attachments...</div>
                    ) : filteredAttachments.length === 0 ? (
                        <div className="gallery-empty">
                            {attachments.length === 0 ? (
                                <>
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                                    </svg>
                                    <p>No attachments yet</p>
                                    <p className="gallery-empty-hint">Attach files, images, or links in your chat conversations. Use the paperclip button or drag and drop.</p>
                                </>
                            ) : (
                                <p>No {filter} attachments found</p>
                            )}
                        </div>
                    ) : (
                        <div className="gallery-grid">
                            {filteredAttachments.map((att, i) => (
                                <div
                                    key={`${att.id}-${i}`}
                                    className={`gallery-item gallery-item-${att.type}`}
                                    onClick={() => setSelectedAttachment(att)}
                                >
                                    {att.type === 'image' && att.dataUrl ? (
                                        <div className="gallery-item-thumb">
                                            <img src={att.dataUrl} alt={att.name} />
                                        </div>
                                    ) : (
                                        <div className="gallery-item-icon">{typeIcon(att.type)}</div>
                                    )}
                                    <div className="gallery-item-info">
                                        <div className="gallery-item-name" title={att.name}>{att.name}</div>
                                        <div className="gallery-item-meta">
                                            <span className={`gallery-type-badge gallery-type-${att.type}`}>{att.type}</span>
                                            {att.size && <span>{att.size < 1024 ? `${att.size}B` : `${Math.round(att.size / 1024)}KB`}</span>}
                                        </div>
                                    </div>
                                    <div className="gallery-item-conv" title={new Date(att.timestamp).toLocaleDateString()}>
                                        {new Date(att.timestamp).toLocaleDateString()}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Attachment detail modal */}
                    {selectedAttachment && (
                        <div className="gallery-modal-overlay" onClick={() => setSelectedAttachment(null)}>
                            <div className="gallery-modal" onClick={e => e.stopPropagation()}>
                                <div className="gallery-modal-header">
                                    <div className="gallery-modal-title">
                                        {typeIcon(selectedAttachment.type)}
                                        <span>{selectedAttachment.name}</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                        {!selectedAttachment.id.startsWith('conv-') && (
                                            <button
                                                className="gallery-modal-close"
                                                onClick={() => handleDelete(selectedAttachment)}
                                                title="Delete attachment"
                                                style={{ color: 'var(--error)' }}
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                                </svg>
                                            </button>
                                        )}
                                        <button className="gallery-modal-close" onClick={() => setSelectedAttachment(null)}>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                                <div className="gallery-modal-body">
                                    {selectedAttachment.type === 'image' && selectedAttachment.dataUrl && (
                                        <img src={selectedAttachment.dataUrl} alt={selectedAttachment.name} className="gallery-modal-image" />
                                    )}
                                    {selectedAttachment.type === 'link' && selectedAttachment.url && (
                                        <div className="gallery-modal-link">
                                            <a href={selectedAttachment.url} target="_blank" rel="noopener noreferrer">{selectedAttachment.url}</a>
                                        </div>
                                    )}
                                    {selectedAttachment.content && (
                                        <pre className="gallery-modal-content"><code>{selectedAttachment.content.slice(0, 10000)}</code></pre>
                                    )}
                                    {!selectedAttachment.content && !selectedAttachment.dataUrl && !selectedAttachment.url && (
                                        <div className="gallery-modal-no-preview">No preview available for this file</div>
                                    )}
                                </div>
                                <div className="gallery-modal-footer">
                                    <span className={`gallery-type-badge gallery-type-${selectedAttachment.type}`}>{selectedAttachment.type}</span>
                                    {selectedAttachment.size && <span>{Math.round(selectedAttachment.size / 1024)}KB</span>}
                                    {selectedAttachment.mimeType && <span>{selectedAttachment.mimeType}</span>}
                                    <span>{new Date(selectedAttachment.timestamp).toLocaleDateString()}</span>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            <div className="gallery-tip">
                <strong>Tip:</strong> Type <code>@</code> in the chat input to reference any attachment by name
            </div>
        </div>
    );
}
