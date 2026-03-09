/**
 * ProjectModeBar — Top bar shown when a project is active.
 * Displays project name, quick actions (Open, Hand off, Commit), project switcher dropdown, and diff stats.
 */

import React, { useCallback, useState, useEffect, useRef } from 'react';

export interface ActiveProject {
    id: string;
    name: string;
    path: string;
    gitBranch?: string;
    addedLines?: number;
    removedLines?: number;
}

interface ProjectModeBarProps {
    project: ActiveProject;
    onClose: () => void;
    onOpen?: () => void;
    onCommit?: () => void;
    onSwitchProject?: (project: ActiveProject) => void;
}

export default function ProjectModeBar({ project, onClose, onOpen, onCommit, onSwitchProject }: ProjectModeBarProps) {
    const isElectron = typeof window !== 'undefined' && window.onicode;
    const [showDropdown, setShowDropdown] = useState(false);
    const [projects, setProjects] = useState<ActiveProject[]>([]);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Load available projects for dropdown
    useEffect(() => {
        if (!isElectron) return;
        window.onicode!.listProjects().then((result: unknown) => {
            const res = result as { projects?: Array<{ id: string; name: string; path: string }> };
            if (res.projects) {
                setProjects(res.projects.map(p => ({ id: p.id, name: p.name, path: p.path })));
            }
        }).catch(() => { });
    }, [isElectron, project.id]);

    // Close dropdown when clicking outside
    useEffect(() => {
        if (!showDropdown) return;
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showDropdown]);

    const handleOpen = useCallback(() => {
        if (onOpen) {
            onOpen();
        } else if (isElectron) {
            window.onicode!.openProjectIn(project.path, 'finder');
        }
    }, [onOpen, isElectron, project.path]);

    const handleCommit = useCallback(() => {
        if (onCommit) {
            onCommit();
        }
    }, [onCommit]);

    const handleHandOff = useCallback(() => {
        window.dispatchEvent(new CustomEvent('onicode-panel', {
            detail: { type: 'terminal', data: { cwd: project.path } }
        }));
    }, [project.path]);

    const handleSwitchProject = useCallback((p: ActiveProject) => {
        setShowDropdown(false);
        if (onSwitchProject && p.id !== project.id) {
            onSwitchProject(p);
        }
    }, [onSwitchProject, project.id]);

    return (
        <div className="project-mode-bar">
            {/* Project name with dropdown trigger */}
            <div className="project-mode-selector" ref={dropdownRef}>
                <button
                    className="project-mode-name-btn"
                    onClick={() => setShowDropdown(!showDropdown)}
                    title="Switch project"
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                    </svg>
                    <span className="project-mode-name">{project.name}</span>
                    <svg className="project-mode-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="6 9 12 15 18 9" />
                    </svg>
                </button>

                {showDropdown && (
                    <div className="project-dropdown">
                        <div className="project-dropdown-header">Switch Project</div>
                        {projects.filter(p => p.id !== project.id).length === 0 ? (
                            <div className="project-dropdown-empty">No other projects</div>
                        ) : (
                            projects.filter(p => p.id !== project.id).map(p => (
                                <button
                                    key={p.id}
                                    className="project-dropdown-item"
                                    onClick={() => handleSwitchProject(p)}
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                                    </svg>
                                    <span>{p.name}</span>
                                </button>
                            ))
                        )}
                        <div className="project-dropdown-divider" />
                        <button className="project-dropdown-item project-dropdown-exit" onClick={onClose}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                            <span>Exit Project Mode</span>
                        </button>
                    </div>
                )}
            </div>

            {project.gitBranch && (
                <span className="project-mode-id">{project.gitBranch}</span>
            )}

            <div className="project-mode-sep" />

            <button className="project-mode-action" onClick={handleOpen} title="Open in Finder">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                Open
            </button>

            <button className="project-mode-action" onClick={handleHandOff} title="Open terminal for project">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
                Hand off
            </button>

            {project.gitBranch && (
                <button className="project-mode-action primary" onClick={handleCommit} title="Commit changes">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="4" />
                        <line x1="1.05" y1="12" x2="7" y2="12" />
                        <line x1="17.01" y1="12" x2="22.96" y2="12" />
                    </svg>
                    Commit
                </button>
            )}

            <div className="project-mode-stats">
                {(project.addedLines != null && project.addedLines > 0) && (
                    <span className="project-mode-stat-add">+{project.addedLines.toLocaleString()}</span>
                )}
                {(project.removedLines != null && project.removedLines > 0) && (
                    <span className="project-mode-stat-del">-{project.removedLines.toLocaleString()}</span>
                )}
            </div>

            <button className="project-mode-action" onClick={onClose} title="Exit project mode">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
            </button>
        </div>
    );
}
