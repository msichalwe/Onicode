import React, { useState, useEffect, useCallback, useRef } from 'react';
import { isElectron } from '../utils';

type View = 'chat' | 'projects' | 'attachments' | 'memories' | 'settings' | 'todo' | 'workflows';
type OnicodeMode = 'onichat' | 'workpal' | 'projects';

interface SidebarProps {
    currentView: View;
    onViewChange: (view: View) => void;
    unreadChatCount?: number;
    mode?: OnicodeMode;
}

export default function Sidebar({ currentView, onViewChange, unreadChatCount = 0, mode = 'onichat' }: SidebarProps) {
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
            <nav className="sidebar-nav">
                {/* New Chat — always visible, above Chat */}
                <button className="sidebar-btn sidebar-btn-new" onClick={() => { onViewChange('chat'); window.dispatchEvent(new CustomEvent('onicode-new-chat')); }} title="New chat">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    New Chat
                </button>

                {/* Chat — always visible */}
                <button className={`sidebar-btn ${currentView === 'chat' ? 'active' : ''}`} onClick={() => onViewChange('chat')} title="Chat">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
                    Chat
                    {unreadChatCount > 0 && <span className="sidebar-badge">{unreadChatCount > 99 ? '99+' : unreadChatCount}</span>}
                </button>

                {/* Projects — projects mode only */}
                {mode === 'projects' && (
                    <button className={`sidebar-btn ${currentView === 'projects' ? 'active' : ''}`} onClick={() => onViewChange('projects')} title="Projects">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                        Projects
                    </button>
                )}

                {/* Files — workpal + projects */}
                {mode !== 'onichat' && (
                    <button className={`sidebar-btn ${currentView === 'attachments' ? 'active' : ''}`} onClick={() => onViewChange('attachments')} title="Files">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></svg>
                        Files
                    </button>
                )}

                {/* Agents — projects only */}
                {mode === 'projects' && (
                    <button className={`sidebar-btn ${currentView === 'memories' ? 'active' : ''}`} onClick={() => onViewChange('memories')} title="Agents">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" /></svg>
                        Agents
                    </button>
                )}

                {/* Tasks — projects only */}
                {mode === 'projects' && (
                    <button className={`sidebar-btn ${currentView === 'todo' ? 'active' : ''}`} onClick={() => onViewChange('todo')} title="Tasks">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>
                        Tasks
                    </button>
                )}
            </nav>

            {/* ── Recents: per-mode chat history (max 15) ── */}
            <RecentChats mode={mode} onViewChange={onViewChange} />

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

// ══════════════════════════════════════════
//  Recent Chats — per-mode conversation history
// ══════════════════════════════════════════

const MAX_RECENTS = 15;
const CACHE_KEY = 'onicode-conversations';

interface CachedConv {
    id: string;
    title?: string;
    updatedAt?: number;
    createdAt?: number;
    scope?: string;
    projectName?: string;
    projectId?: string;
    messages?: unknown[];
}

function readFromCache(): CachedConv[] {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return [];
        return JSON.parse(raw) as CachedConv[];
    } catch { return []; }
}

function RecentChats({ mode, onViewChange }: { mode: OnicodeMode; onViewChange: (v: View) => void }) {
    const [chats, setChats] = useState<CachedConv[]>([]);
    const [tick, setTick] = useState(0);

    // Read from cache, filter by mode
    useEffect(() => {
        const all = readFromCache();
        const withMessages = all.filter(c => c.messages && Array.isArray(c.messages) && c.messages.length > 0);

        // Filter by mode using scope field
        const filtered = withMessages.filter(c => {
            const scope = c.scope || 'general';
            const hasProject = !!(c.projectName || c.projectId);

            if (mode === 'projects') return hasProject || scope === 'project';
            if (mode === 'workpal') return scope === 'workpal' || scope === 'workmate';
            // OniChat: general scope without project
            return (scope === 'general' || !scope) && !hasProject;
        });

        const sorted = filtered
            .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
            .slice(0, MAX_RECENTS);
        setChats(sorted);
    }, [mode, tick]);

    // Refresh on events + periodic
    useEffect(() => {
        const bump = () => setTick(t => t + 1);
        const handler = () => setTimeout(bump, 200);
        const events = ['onicode-new-chat', 'onicode-conversation-saved', 'onicode-conversation-deleted', 'onicode-conversations-cleared'];
        events.forEach(e => window.addEventListener(e, handler));
        const iv = setInterval(bump, 5000);
        return () => { events.forEach(e => window.removeEventListener(e, handler)); clearInterval(iv); };
    }, []);

    const handleClick = (chatId: string) => {
        onViewChange('chat');
        window.dispatchEvent(new CustomEvent('onicode-load-conversation', { detail: chatId }));
    };

    const timeAgo = (ts: number) => {
        const diff = Date.now() - ts;
        if (diff < 60000) return 'now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
        return `${Math.floor(diff / 86400000)}d`;
    };

    if (chats.length === 0) return null;

    const openFullHistory = () => {
        onViewChange('chat');
        window.dispatchEvent(new CustomEvent('onicode-show-history'));
    };

    return (
        <div className="sidebar-recents">
            <div className="sidebar-recents-header">
                <span>Recents</span>
                <button className="sidebar-recents-all" onClick={openFullHistory} title="View all chats">All</button>
            </div>
            <div className="sidebar-recents-list">
                {chats.map(c => (
                    <button key={c.id} className="sidebar-recent-item" onClick={() => handleClick(c.id)} title={c.title || 'Chat'}>
                        <div className="sidebar-recent-title">{c.title || (c.messages && Array.isArray(c.messages) && c.messages.length > 0 ? String((c.messages[0] as Record<string, unknown>)?.content || '').slice(0, 40) : 'Chat')}</div>
                        <span className="sidebar-recent-time">{timeAgo(c.updatedAt || c.createdAt || 0)}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
