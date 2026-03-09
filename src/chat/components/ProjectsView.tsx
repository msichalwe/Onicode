import React, { useState, useEffect, useCallback } from 'react';

const isElectron = typeof window !== 'undefined' && !!window.onicode;

interface Project {
    id: string;
    name: string;
    path: string;
    description: string;
    techStack: string;
    createdAt: number;
    updatedAt: number;
}

interface ProjectDoc {
    name: string;
    path: string;
    content: string;
}

interface FileItem {
    name: string;
    path: string;
    type: 'file' | 'directory';
    children?: FileItem[];
}

const EDITORS = [
    { id: 'vscode', name: 'VS Code', icon: 'VS' },
    { id: 'cursor', name: 'Cursor', icon: 'Cu' },
    { id: 'windsurf', name: 'Windsurf', icon: 'Ws' },
    { id: 'finder', name: 'Finder', icon: 'Fi' },
];

export default function ProjectsView() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);
    const [projectDocs, setProjectDocs] = useState<ProjectDoc[]>([]);
    const [fileTree, setFileTree] = useState<FileItem[]>([]);
    const [viewingDoc, setViewingDoc] = useState<ProjectDoc | null>(null);
    const [showNewProject, setShowNewProject] = useState(false);
    const [newName, setNewName] = useState('');
    const [newPath, setNewPath] = useState('~/Projects');
    const [newDesc, setNewDesc] = useState('');
    const [newTech, setNewTech] = useState('');
    const [creating, setCreating] = useState(false);
    const [showOpenIn, setShowOpenIn] = useState(false);

    const loadProjects = useCallback(async () => {
        if (!isElectron) return;
        const result = await window.onicode!.listProjects();
        setProjects(result.projects || []);
    }, []);

    useEffect(() => { loadProjects(); }, [loadProjects]);

    const selectProject = useCallback(async (project: Project) => {
        setSelectedProject(project);
        setViewingDoc(null);
        setShowOpenIn(false);
        if (isElectron) {
            const result = await window.onicode!.getProject(project.id);
            if (result.docs) setProjectDocs(result.docs);
            const dirResult = await window.onicode!.readDir(project.path, 3);
            if (dirResult.tree) setFileTree(dirResult.tree);
        }
    }, []);

    const createProject = useCallback(async () => {
        if (!newName.trim() || !isElectron) return;
        setCreating(true);
        const expandedPath = newPath.replace(/^~/, '');
        const result = await window.onicode!.initProject({
            name: newName,
            projectPath: newPath.startsWith('~') ? (process.env?.HOME || '/Users') + expandedPath : newPath,
            description: newDesc,
            techStack: newTech,
        });
        setCreating(false);
        if (result.success) {
            setShowNewProject(false);
            setNewName('');
            setNewDesc('');
            setNewTech('');
            await loadProjects();
            if (result.project) selectProject(result.project);
        }
    }, [newName, newPath, newDesc, newTech, loadProjects, selectProject]);

    const deleteProject = useCallback(async (id: string) => {
        if (!isElectron) return;
        await window.onicode!.deleteProject(id);
        if (selectedProject?.id === id) {
            setSelectedProject(null);
            setProjectDocs([]);
            setFileTree([]);
        }
        loadProjects();
    }, [selectedProject, loadProjects]);

    const openIn = useCallback(async (editor: string) => {
        if (!selectedProject || !isElectron) return;
        await window.onicode!.openProjectIn(selectedProject.path, editor);
        setShowOpenIn(false);
    }, [selectedProject]);

    // ── File tree renderer ──
    const renderFileTree = (items: FileItem[], depth = 0) => (
        <div className="file-tree-level">
            {items.map((item) => (
                <div key={item.path}>
                    <div
                        className={`file-tree-item ${item.type}`}
                        style={{ paddingLeft: `${12 + depth * 16}px` }}
                        onClick={() => {
                            if (item.type === 'file' && item.name.endsWith('.md')) {
                                // Load and view the file
                                if (isElectron) {
                                    window.onicode!.readFile(item.path).then((res) => {
                                        if (res.content) setViewingDoc({ name: item.name, path: item.path, content: res.content });
                                    });
                                }
                            }
                        }}
                    >
                        {item.type === 'directory' ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                            </svg>
                        ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                            </svg>
                        )}
                        <span>{item.name}</span>
                    </div>
                    {item.children && item.children.length > 0 && renderFileTree(item.children, depth + 1)}
                </div>
            ))}
        </div>
    );

    // ── No Electron fallback ──
    if (!isElectron) {
        return (
            <div className="welcome">
                <h2>Projects</h2>
                <p>Projects require the Onicode desktop app.</p>
            </div>
        );
    }

    return (
        <div className="projects-view">
            {/* Left: Project list */}
            <div className="projects-sidebar">
                <div className="projects-sidebar-header">
                    <h3>Projects</h3>
                    <button className="projects-new-btn" onClick={() => setShowNewProject(true)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                    </button>
                </div>

                {/* New project form */}
                {showNewProject && (
                    <div className="new-project-form">
                        <input className="field-input" placeholder="Project name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
                        <input className="field-input" placeholder="Path (~/Projects)" value={newPath} onChange={(e) => setNewPath(e.target.value)} />
                        <input className="field-input" placeholder="Description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
                        <input className="field-input" placeholder="Tech stack (optional)" value={newTech} onChange={(e) => setNewTech(e.target.value)} />
                        <div className="new-project-actions">
                            <button className="test-btn" onClick={createProject} disabled={!newName.trim() || creating}>
                                {creating ? 'Creating...' : 'Create Project'}
                            </button>
                            <button className="disconnect-btn" onClick={() => setShowNewProject(false)}>Cancel</button>
                        </div>
                    </div>
                )}

                <div className="projects-list">
                    {projects.length === 0 && !showNewProject && (
                        <div className="projects-empty">
                            <p>No projects yet</p>
                            <span>Use the + button or <code>/init</code> in chat</span>
                        </div>
                    )}
                    {projects.map((p) => (
                        <div
                            key={p.id}
                            className={`project-card ${selectedProject?.id === p.id ? 'active' : ''}`}
                            onClick={() => selectProject(p)}
                        >
                            <div className="project-card-icon">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                                </svg>
                            </div>
                            <div className="project-card-info">
                                <div className="project-card-name">{p.name}</div>
                                <div className="project-card-path">{p.path.replace(/^\/Users\/[^/]+/, '~')}</div>
                            </div>
                            <button className="project-delete-btn" onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }} title="Remove">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Right: Project detail */}
            <div className="project-detail">
                {!selectedProject ? (
                    <div className="welcome">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5">
                            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                        </svg>
                        <h2>Select a Project</h2>
                        <p>Choose a project from the sidebar or create a new one.</p>
                    </div>
                ) : viewingDoc ? (
                    <div className="doc-viewer">
                        <div className="doc-viewer-header">
                            <button className="header-action-btn" onClick={() => setViewingDoc(null)}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="15 18 9 12 15 6" />
                                </svg>
                            </button>
                            <h3>{viewingDoc.name}</h3>
                        </div>
                        <div className="doc-viewer-content">
                            <pre className="doc-markdown">{viewingDoc.content}</pre>
                        </div>
                    </div>
                ) : (
                    <div className="project-detail-content">
                        <div className="project-detail-header">
                            <div>
                                <h2>{selectedProject.name}</h2>
                                {selectedProject.description && <p className="project-desc">{selectedProject.description}</p>}
                                <div className="project-meta">
                                    <span>{selectedProject.path.replace(/^\/Users\/[^/]+/, '~')}</span>
                                    <span>Created {new Date(selectedProject.createdAt).toLocaleDateString()}</span>
                                </div>
                            </div>
                            <div className="project-actions">
                                <div className="open-in-group">
                                    <button className="test-btn" onClick={() => setShowOpenIn(!showOpenIn)}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                                            <polyline points="15 3 21 3 21 9" />
                                            <line x1="10" y1="14" x2="21" y2="3" />
                                        </svg>
                                        Open in...
                                    </button>
                                    {showOpenIn && (
                                        <div className="open-in-menu">
                                            {EDITORS.map((e) => (
                                                <button key={e.id} className="open-in-option" onClick={() => openIn(e.id)}>
                                                    <span className="open-in-icon">{e.icon}</span>
                                                    {e.name}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Docs section */}
                        {projectDocs.length > 0 && (
                            <div className="project-section">
                                <h4>Documentation</h4>
                                <div className="doc-cards">
                                    {projectDocs.map((doc) => (
                                        <div key={doc.name} className="doc-card" onClick={() => setViewingDoc(doc)}>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                                                <polyline points="14 2 14 8 20 8" />
                                            </svg>
                                            <span>{doc.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* File tree */}
                        <div className="project-section">
                            <h4>Files</h4>
                            {fileTree.length > 0 ? (
                                <div className="file-tree">
                                    {renderFileTree(fileTree)}
                                </div>
                            ) : (
                                <p className="project-empty-hint">No files found</p>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
