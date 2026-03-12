import React, { useState, useEffect, useCallback } from 'react';
import { isElectron, requestPanel } from '../../utils';

function ProjectWidget() {
    const [project, setProject] = useState<{
        name: string; path: string; techStack?: string; description?: string;
        gitBranch?: string; hasGit?: boolean;
    } | null>(null);
    const [docs, setDocs] = useState<Array<{ name: string; content: string }>>([]);
    const [fileTree, setFileTree] = useState<Array<{ name: string; path: string; type: string; children?: unknown[] }>>([]);
    const [showFiles, setShowFiles] = useState(true);

    // Load file tree for the active project
    const loadFileTree = useCallback((projectPath: string) => {
        if (!isElectron || !projectPath) return;
        window.onicode!.readDir(projectPath, 2).then((res) => {
            if (res.tree) setFileTree(res.tree as typeof fileTree);
        }).catch(() => { });
    }, []);

    useEffect(() => {
        try {
            const stored = localStorage.getItem('onicode-active-project');
            if (stored) {
                const p = JSON.parse(stored);
                setProject(p);
                loadFileTree(p.path);
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

        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.name) {
                setProject(detail);
                loadFileTree(detail.path);
            }
        };
        window.addEventListener('onicode-project-activate', handler);
        return () => {
            window.removeEventListener('onicode-project-activate', handler);
        };
    }, [loadFileTree]);

    // Auto-refresh file tree when AI creates/edits files
    useEffect(() => {
        if (!isElectron || !project?.path || !window.onicode?.onFileChanged) return;
        const unsub = window.onicode.onFileChanged((change) => {
            if (change.path?.startsWith(project.path) || change.dir?.startsWith(project.path)) {
                loadFileTree(project.path);
            }
        });
        return unsub;
    }, [project?.path, loadFileTree]);

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
            {fileTree.length > 0 && (
                <div className="project-widget-section">
                    <div className="project-widget-label project-widget-label-toggle" onClick={() => setShowFiles(f => !f)}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: showFiles ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}><polyline points="9 18 15 12 9 6" /></svg>
                        Files ({fileTree.length})
                    </div>
                    {showFiles && (
                        <div className="project-widget-files">
                            {fileTree.map((item) => (
                                <div
                                    key={item.path}
                                    className={`project-file-item ${item.type}${item.type === 'file' ? ' project-file-clickable' : ''}`}
                                    onClick={() => {
                                        if (item.type === 'file') {
                                            requestPanel('viewer', { path: item.path, name: item.name });
                                        }
                                    }}
                                >
                                    {item.type === 'directory' ? (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                                    ) : (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                    )}
                                    <span>{item.name}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default ProjectWidget;
