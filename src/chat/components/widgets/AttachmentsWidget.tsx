import React, { useState, useEffect, useCallback } from 'react';
import { isElectron } from '../../utils';

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

export default AttachmentsWidget;
