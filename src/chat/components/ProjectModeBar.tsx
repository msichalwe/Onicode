/**
 * ProjectModeBar — Top bar shown when a project is active.
 * Displays project name, quick actions (Open, Hand off, Commit), and diff stats.
 */

import React, { useCallback } from 'react';

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
}

export default function ProjectModeBar({ project, onClose, onOpen, onCommit }: ProjectModeBarProps) {
    const isElectron = typeof window !== 'undefined' && window.onicode;

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
        // Open terminal panel for the project
        window.dispatchEvent(new CustomEvent('onicode-panel', {
            detail: { type: 'terminal', data: { cwd: project.path } }
        }));
    }, [project.path]);

    return (
        <div className="project-mode-bar">
            <span className="project-mode-name">{project.name}</span>
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
