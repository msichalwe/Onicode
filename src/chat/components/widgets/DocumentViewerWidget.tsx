import React, { useState, useEffect, useRef, useCallback } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import { isElectron } from '../../utils';

// Register common languages for syntax highlighting
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import shell from 'highlight.js/lib/languages/shell';
import bash from 'highlight.js/lib/languages/bash';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import sql from 'highlight.js/lib/languages/sql';
import diff from 'highlight.js/lib/languages/diff';
import plaintext from 'highlight.js/lib/languages/plaintext';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('plaintext', plaintext);

// ══════════════════════════════════════════
//  File type detection
// ══════════════════════════════════════════

const CODE_EXTENSIONS: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', css: 'css', html: 'html', xml: 'xml', json: 'json',
    md: 'markdown', yml: 'yaml', yaml: 'yaml', sh: 'shell', bash: 'bash',
    rust: 'rust', rs: 'rust', go: 'go', java: 'java', sql: 'sql',
    diff: 'diff', toml: 'yaml', ini: 'yaml', env: 'bash', gitignore: 'bash',
    dockerfile: 'bash', makefile: 'bash', txt: 'plaintext', log: 'plaintext',
    csv: 'plaintext', svg: 'xml', graphql: 'javascript', prisma: 'javascript',
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg']);
const PDF_EXTENSIONS = new Set(['pdf']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx']);
const OFFICE_EXTENSIONS = new Set(['pptx', 'ppt', 'docx', 'doc', 'xlsx', 'xls']);

type ViewerMode = 'code' | 'markdown' | 'image' | 'pdf' | 'office' | 'binary' | 'loading' | 'error';

interface ViewerFile {
    path: string;
    name: string;
    ext: string;
    mode: ViewerMode;
    content?: string;
    dataUri?: string;
    error?: string;
    size?: number;
}

function getExtension(name: string): string {
    const parts = name.split('.');
    return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

function getViewerMode(ext: string): ViewerMode {
    if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    if (PDF_EXTENSIONS.has(ext)) return 'pdf';
    if (OFFICE_EXTENSIONS.has(ext)) return 'office';
    if (CODE_EXTENSIONS[ext] || ext === '') return 'code';
    return 'binary';
}

// ══════════════════════════════════════════
//  Document Viewer Widget
// ══════════════════════════════════════════

interface DocumentViewerWidgetProps {
    data?: Record<string, unknown>;
}

export default function DocumentViewerWidget({ data }: DocumentViewerWidgetProps) {
    const [file, setFile] = useState<ViewerFile | null>(null);
    const [editing, setEditing] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchMatches, setSearchMatches] = useState(0);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [editContent, setEditContent] = useState('');
    const [dirty, setDirty] = useState(false);
    const codeRef = useRef<HTMLElement>(null);

    // Load file when data changes
    useEffect(() => {
        if (!data?.path || !data?.name) {
            setFile(null);
            return;
        }

        const filePath = data.path as string;
        const fileName = data.name as string;
        const ext = getExtension(fileName);
        const mode = getViewerMode(ext);

        setFile({ path: filePath, name: fileName, ext, mode: 'loading' });
        setEditing(false);
        setDirty(false);

        if (!isElectron) {
            setFile({ path: filePath, name: fileName, ext, mode: 'error', error: 'Not in Electron' });
            return;
        }

        if (mode === 'image') {
            // SVG can be read as text
            if (ext === 'svg') {
                window.onicode!.readFileContent(filePath).then(res => {
                    if (res.error) {
                        setFile({ path: filePath, name: fileName, ext, mode: 'error', error: res.error });
                    } else {
                        setFile({ path: filePath, name: fileName, ext, mode: 'image', content: res.content, size: res.size });
                    }
                });
            } else {
                window.onicode!.readFileBinary(filePath).then(res => {
                    if (res.error) {
                        setFile({ path: filePath, name: fileName, ext, mode: 'error', error: res.error });
                    } else {
                        setFile({ path: filePath, name: fileName, ext, mode: 'image', dataUri: res.dataUri, size: res.size });
                    }
                });
            }
        } else if (mode === 'pdf') {
            window.onicode!.readFileBinary(filePath).then(res => {
                if (res.error) {
                    setFile({ path: filePath, name: fileName, ext, mode: 'error', error: res.error });
                } else {
                    setFile({ path: filePath, name: fileName, ext, mode: 'pdf', dataUri: res.dataUri, size: res.size });
                }
            });
        } else if (mode === 'office') {
            // Office files — open externally, show info card
            setFile({ path: filePath, name: fileName, ext, mode: 'office', size: 0 });
        } else if (mode === 'code' || mode === 'markdown') {
            window.onicode!.readFileContent(filePath).then(res => {
                if (res.error) {
                    setFile({ path: filePath, name: fileName, ext, mode: 'error', error: res.error });
                } else {
                    setFile({ path: filePath, name: fileName, ext, mode, content: res.content, size: res.size });
                }
            });
        } else {
            // Binary files — show info + open externally
            setFile({ path: filePath, name: fileName, ext, mode: 'binary' });
        }
    }, [data?.path, data?.name]);

    // Syntax highlight code
    useEffect(() => {
        if (!file || file.mode !== 'code' || editing || !codeRef.current || !file.content) return;
        try {
            const lang = CODE_EXTENSIONS[file.ext] || '';
            const highlighted = lang && hljs.getLanguage(lang)
                ? hljs.highlight(file.content, { language: lang }).value
                : hljs.highlightAuto(file.content).value;
            codeRef.current.innerHTML = highlighted;
        } catch {
            if (codeRef.current) codeRef.current.textContent = file.content;
        }
    }, [file?.content, file?.ext, file?.mode, editing]);

    // Save file
    const saveFile = useCallback(async () => {
        if (!file || !dirty || !isElectron) return;
        try {
            await window.onicode!.writeFile(file.path, editContent);
            setFile(f => f ? { ...f, content: editContent } : null);
            setDirty(false);
        } catch { /* ignore */ }
    }, [file, editContent, dirty]);

    // Keyboard shortcuts
    useEffect(() => {
        if (!editing || !dirty) return;
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                saveFile();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [editing, dirty, saveFile]);

    // Search — Cmd+F opens, counts matches
    useEffect(() => {
        if (!searchOpen) return;
        searchInputRef.current?.focus();
    }, [searchOpen]);

    useEffect(() => {
        if (!searchQuery || !file?.content) { setSearchMatches(0); return; }
        try {
            const regex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            const matches = file.content.match(regex);
            setSearchMatches(matches ? matches.length : 0);
        } catch { setSearchMatches(0); }
    }, [searchQuery, file?.content]);

    // Cmd+F to toggle search
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'f' && file) {
                e.preventDefault();
                setSearchOpen(prev => !prev);
                if (!searchOpen) setTimeout(() => searchInputRef.current?.focus(), 50);
            }
            if (e.key === 'Escape' && searchOpen) {
                setSearchOpen(false);
                setSearchQuery('');
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [file, searchOpen]);

    // Open file externally
    const openExternal = useCallback(() => {
        if (file && isElectron && window.onicode?.terminalExec) {
            window.onicode.terminalExec(`open "${file.path}"`);
        }
    }, [file]);

    // Empty state
    if (!file) {
        return (
            <div className="widget-placeholder">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                </svg>
                <p>Document Viewer</p>
                <span>Click a file in the Project tab to preview</span>
            </div>
        );
    }

    // Loading state
    if (file.mode === 'loading') {
        return (
            <div className="docviewer">
                <div className="docviewer-header">
                    <span className="docviewer-name">{file.name}</span>
                </div>
                <div className="docviewer-loading">Loading...</div>
            </div>
        );
    }

    // Error state
    if (file.mode === 'error') {
        return (
            <div className="docviewer">
                <div className="docviewer-header">
                    <span className="docviewer-name">{file.name}</span>
                </div>
                <div className="docviewer-error">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                    <span>{file.error || 'Failed to load file'}</span>
                </div>
            </div>
        );
    }

    return (
        <div className="docviewer">
            {/* Header bar */}
            <div className="docviewer-header">
                <div className="docviewer-info">
                    <span className="docviewer-name" title={file.path}>{file.name}</span>
                    <span className="docviewer-meta">
                        {file.ext.toUpperCase()}{file.size ? ` \u00b7 ${formatSize(file.size)}` : ''}
                        {dirty && ' \u00b7 Modified'}
                    </span>
                </div>
                <div className="docviewer-actions">
                    {/* Search toggle */}
                    {(file.mode === 'code' || file.mode === 'markdown') && (
                        <button className={`docviewer-btn ${searchOpen ? 'active' : ''}`} onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setSearchQuery(''); }} title="Search (Cmd+F)">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                        </button>
                    )}
                    {(file.mode === 'code' || file.mode === 'markdown') && (
                        <>
                            {!editing ? (
                                <button className="docviewer-btn" onClick={() => { setEditing(true); setEditContent(file.content || ''); }} title="Edit">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                                    </svg>
                                </button>
                            ) : (
                                <button className="docviewer-btn" onClick={() => { setEditing(false); }} title="View">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                                    </svg>
                                </button>
                            )}
                            {dirty && (
                                <button className="docviewer-btn docviewer-save" onClick={saveFile} title="Save (Cmd+S)">Save</button>
                            )}
                        </>
                    )}
                    <button className="docviewer-btn" onClick={openExternal} title="Open externally">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                            <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Search bar */}
            {searchOpen && (
                <div className="docviewer-search">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    <input ref={searchInputRef} className="docviewer-search-input" placeholder="Find in file..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Escape' && (setSearchOpen(false), setSearchQuery(''))} />
                    {searchQuery && <span className="docviewer-search-count">{searchMatches} match{searchMatches !== 1 ? 'es' : ''}</span>}
                </div>
            )}

            {/* Content area */}
            <div className="docviewer-body">
                {file.mode === 'office' && (
                    <div className="docviewer-office">
                        <div className="docviewer-office-icon">
                            {file.ext.startsWith('ppt') ? '📊' : file.ext.startsWith('doc') ? '📄' : '📈'}
                        </div>
                        <p className="docviewer-office-name">{file.name}</p>
                        <p className="docviewer-office-hint">
                            {file.ext.startsWith('ppt') ? 'PowerPoint' : file.ext.startsWith('doc') ? 'Word Document' : 'Excel Spreadsheet'}
                        </p>
                        <button className="docviewer-btn docviewer-office-open" onClick={openExternal}>
                            Open in default app
                        </button>
                    </div>
                )}

                {file.mode === 'code' && !editing && (
                    <pre className="docviewer-code"><code ref={codeRef} className={`hljs language-${CODE_EXTENSIONS[file.ext] || ''}`} /></pre>
                )}

                {file.mode === 'code' && editing && (
                    <textarea
                        className="docviewer-textarea"
                        value={editContent}
                        onChange={(e) => { setEditContent(e.target.value); setDirty(true); }}
                        spellCheck={false}
                        autoFocus
                    />
                )}

                {file.mode === 'markdown' && !editing && (
                    <div
                        className="docviewer-markdown"
                        dangerouslySetInnerHTML={{ __html: marked(file.content || '') as string }}
                    />
                )}

                {file.mode === 'markdown' && editing && (
                    <textarea
                        className="docviewer-textarea"
                        value={editContent}
                        onChange={(e) => { setEditContent(e.target.value); setDirty(true); }}
                        spellCheck={false}
                        autoFocus
                    />
                )}

                {file.mode === 'image' && (
                    <div className="docviewer-image">
                        {file.ext === 'svg' && file.content ? (
                            <div dangerouslySetInnerHTML={{ __html: file.content }} />
                        ) : file.dataUri ? (
                            <img src={file.dataUri} alt={file.name} />
                        ) : (
                            <span>Unable to load image</span>
                        )}
                    </div>
                )}

                {file.mode === 'pdf' && file.dataUri && (
                    <iframe
                        className="docviewer-pdf"
                        src={file.dataUri}
                        title={file.name}
                    />
                )}

                {file.mode === 'binary' && (
                    <div className="docviewer-binary">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <p>{file.name}</p>
                        <span className="docviewer-binary-hint">.{file.ext} files cannot be previewed inline</span>
                        <button className="docviewer-open-btn" onClick={openExternal}>Open in Default App</button>
                    </div>
                )}
            </div>
        </div>
    );
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
