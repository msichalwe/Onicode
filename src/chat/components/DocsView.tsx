import React, { useState, useEffect, useCallback } from 'react';
import { isElectron } from '../utils';

interface Project {
    id: string;
    name: string;
    path: string;
}

interface DocFile {
    name: string;
    path: string;
    content: string;
    projectName: string;
    projectId: string;
}

export default function DocsView() {
    const [docs, setDocs] = useState<DocFile[]>([]);
    const [viewingDoc, setViewingDoc] = useState<DocFile | null>(null);
    const [loading, setLoading] = useState(true);

    const loadAllDocs = useCallback(async () => {
        if (!isElectron) { setLoading(false); return; }

        setLoading(true);
        const { projects } = await window.onicode!.listProjects();
        const allDocs: DocFile[] = [];

        for (const project of projects) {
            const result = await window.onicode!.getProject(project.id);
            if (result.docs) {
                for (const doc of result.docs) {
                    allDocs.push({
                        ...doc,
                        projectName: project.name,
                        projectId: project.id,
                    });
                }
            }
        }

        setDocs(allDocs);
        setLoading(false);
    }, []);

    useEffect(() => { loadAllDocs(); }, [loadAllDocs]);

    // Group docs by project
    const grouped = docs.reduce<Record<string, { projectName: string; docs: DocFile[] }>>((acc, doc) => {
        if (!acc[doc.projectId]) {
            acc[doc.projectId] = { projectName: doc.projectName, docs: [] };
        }
        acc[doc.projectId].docs.push(doc);
        return acc;
    }, {});

    if (!isElectron) {
        return (
            <div className="welcome">
                <h2>Documents</h2>
                <p>Documents require the Onicode desktop app.</p>
            </div>
        );
    }

    if (viewingDoc) {
        return (
            <div className="docs-view">
                <div className="doc-viewer">
                    <div className="doc-viewer-header">
                        <button className="header-action-btn" onClick={() => setViewingDoc(null)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="15 18 9 12 15 6" />
                            </svg>
                        </button>
                        <div>
                            <h3>{viewingDoc.name}</h3>
                            <span className="doc-viewer-project">{viewingDoc.projectName}</span>
                        </div>
                    </div>
                    <div className="doc-viewer-content">
                        <pre className="doc-markdown">{viewingDoc.content}</pre>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="docs-view">
            <div className="docs-header">
                <h2>Documents</h2>
                <p>Project documentation from all your onidocs folders</p>
            </div>

            {loading ? (
                <div className="docs-loading">Loading documentation...</div>
            ) : Object.keys(grouped).length === 0 ? (
                <div className="welcome">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <h2>No Documents Yet</h2>
                    <p>Create a project with <code>/init</code> to generate documentation.</p>
                </div>
            ) : (
                <div className="docs-groups">
                    {Object.entries(grouped).map(([projectId, group]) => (
                        <div key={projectId} className="docs-group">
                            <h3 className="docs-group-title">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                                </svg>
                                {group.projectName}
                            </h3>
                            <div className="doc-cards">
                                {group.docs.map((doc) => (
                                    <div key={doc.path} className="doc-card" onClick={() => setViewingDoc(doc)}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                                            <polyline points="14 2 14 8 20 8" />
                                        </svg>
                                        <div>
                                            <div className="doc-card-name">{doc.name}</div>
                                            <div className="doc-card-preview">{doc.content.slice(0, 80).replace(/[#*`\n]/g, ' ').trim()}...</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
