import React, { useState, useEffect } from 'react';
import { isElectron } from '../utils';

type View = 'chat' | 'projects' | 'attachments' | 'memories' | 'settings' | 'todo' | 'workflows';

interface SidebarProps {
    currentView: View;
    onViewChange: (view: View) => void;
    unreadChatCount?: number;
}

export default function Sidebar({ currentView, onViewChange, unreadChatCount = 0 }: SidebarProps) {
    const [automationCount, setAutomationCount] = useState(0);

    // Poll for workflow/schedule counts to show badge
    useEffect(() => {
        if (!isElectron || !window.onicode) return;

        const refresh = async () => {
            try {
                let count = 0;
                const [wfRes, schRes] = await Promise.allSettled([
                    window.onicode!.workflowList?.() ?? { success: false },
                    window.onicode!.schedulerList?.() ?? { success: false },
                ]);
                if (wfRes.status === 'fulfilled' && wfRes.value.success && wfRes.value.workflows) {
                    count += wfRes.value.workflows.length;
                }
                if (schRes.status === 'fulfilled' && schRes.value.success && schRes.value.schedules) {
                    count += schRes.value.schedules.filter((s: { enabled: boolean }) => s.enabled).length;
                }
                setAutomationCount(count);
            } catch { /* ignore */ }
        };

        refresh();
        // Refresh every 30s to stay up to date
        const iv = setInterval(refresh, 30_000);

        // Also listen for scheduler/workflow events
        const unsubs: Array<(() => void) | undefined> = [];
        unsubs.push(window.onicode!.onSchedulerStatus?.(() => refresh()));
        unsubs.push(window.onicode!.onWorkflowRunCompleted?.(() => refresh()));

        return () => {
            clearInterval(iv);
            unsubs.forEach(fn => fn?.());
        };
    }, []);
    return (
        <aside className="sidebar">
            <div className="sidebar-logo">
                <svg width="28" height="28" viewBox="0 0 48 48" fill="none">
                    <rect width="48" height="48" rx="12" fill="var(--accent)" />
                    <path d="M16 32V20l8-6 8 6v12l-8-4-8 4z" fill="var(--text-on-accent)" opacity="0.9" />
                    <path d="M24 14l8 6v12l-8-4V14z" fill="var(--text-on-accent)" opacity="0.6" />
                </svg>
            </div>

            <nav className="sidebar-nav">
                <button
                    className={`sidebar-btn ${currentView === 'chat' ? 'active' : ''}`}
                    onClick={() => onViewChange('chat')}
                    title="Chat"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                    </svg>
                    Chat
                    {unreadChatCount > 0 && <span className="sidebar-badge">{unreadChatCount > 99 ? '99+' : unreadChatCount}</span>}
                </button>

                <button
                    className={`sidebar-btn ${currentView === 'projects' ? 'active' : ''}`}
                    onClick={() => onViewChange('projects')}
                    title="Projects"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                    </svg>
                    Projects
                </button>

                <button
                    className={`sidebar-btn ${currentView === 'attachments' ? 'active' : ''}`}
                    onClick={() => onViewChange('attachments')}
                    title="Attachments Gallery"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                    </svg>
                    Files
                </button>

                <button
                    className={`sidebar-btn ${currentView === 'memories' ? 'active' : ''}`}
                    onClick={() => onViewChange('memories')}
                    title="Agent Runtime"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                    </svg>
                    Agents
                </button>

                <button
                    className={`sidebar-btn ${currentView === 'todo' ? 'active' : ''}`}
                    onClick={() => onViewChange('todo')}
                    title="Tasks"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 11l3 3L22 4" />
                        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                    </svg>
                    Tasks
                </button>

                <button
                    className={`sidebar-btn ${currentView === 'workflows' ? 'active' : ''}`}
                    onClick={() => onViewChange('workflows')}
                    title="Workflows & Schedules"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                        <circle cx="12" cy="12" r="4" />
                    </svg>
                    Workflows
                    {automationCount > 0 && <span className="sidebar-badge">{automationCount}</span>}
                </button>
            </nav>

            <div className="sidebar-spacer" />

            <div className="sidebar-bottom">
                <button
                    className={`sidebar-btn ${currentView === 'settings' ? 'active' : ''}`}
                    onClick={() => onViewChange('settings')}
                    title="Settings"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
                    </svg>
                    Settings
                </button>
            </div>
        </aside>
    );
}
