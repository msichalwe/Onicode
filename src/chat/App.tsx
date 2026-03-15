import React, { useState, useCallback, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import SettingsPanel from './components/SettingsPanel';
import ProjectsView from './components/ProjectsView';
import AttachmentGallery from './components/AttachmentGallery';
import TasksView from './components/TodoApp';
import MemoriesView from './components/MemoriesView';
import OnboardingDialog from './components/OnboardingDialog';
import WorkflowsView from './components/WorkflowsView';
import RightPanel, { type PanelState, type WidgetType } from './components/RightPanel';
import { type ActiveProject } from './components/ProjectModeBar';
import { ThemeProvider, useTheme } from './hooks/useTheme';

export type ChatScope = 'general' | 'project' | 'workmate' | 'documents';
export type View = 'chat' | 'projects' | 'attachments' | 'memories' | 'settings' | 'todo' | 'workflows';
export type OnicodeMode = 'onichat' | 'workmate' | 'projects';

export interface WorkmateFolder {
    path: string;
    name: string;
}

import { isElectron } from './utils';

// Error boundary to catch render crashes in secondary views
class ViewErrorBoundary extends React.Component<
    { children: React.ReactNode; onReset?: () => void },
    { error: Error | null }
> {
    state: { error: Error | null } = { error: null };
    static getDerivedStateFromError(error: Error) { return { error }; }
    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('[ViewErrorBoundary] Render error:', error, info.componentStack);
    }
    render() {
        if (this.state.error) {
            return (
                <div style={{ padding: '32px', color: 'var(--text-primary)' }}>
                    <h3 style={{ color: 'var(--error, #ef4444)', marginBottom: 12 }}>View crashed</h3>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                        {this.state.error.message}
                    </p>
                    <pre style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                        {this.state.error.stack}
                    </pre>
                    <button
                        style={{ marginTop: 16, padding: '8px 16px', cursor: 'pointer', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6 }}
                        onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}
                    >
                        Retry
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

function AppContent() {
    const [currentView, setCurrentView] = useState<View>('chat');
    const [panel, setPanel] = useState<PanelState>({ widget: null });
    const [activeProject, setActiveProject] = useState<ActiveProject | null>(null);
    const [chatScope, setChatScope] = useState<ChatScope>('general');
    const [mode, setMode] = useState<OnicodeMode>(() => (localStorage.getItem('onicode-mode') as OnicodeMode) || 'onichat');
    const [workmateFolder, setWorkmateFolder] = useState<WorkmateFolder | null>(() => {
        try { const s = localStorage.getItem('onicode-workmate-folder'); return s ? JSON.parse(s) : null; } catch { return null; }
    });
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [showExitWarning, setShowExitWarning] = useState(false);
    const [projectDropdown, setProjectDropdown] = useState(false);
    const [projects, setProjects] = useState<ActiveProject[]>([]);
    const [unreadChatCount, setUnreadChatCount] = useState(0);
    const currentViewRef = useRef(currentView);
    const { theme } = useTheme();

    // Keep ref in sync so callbacks see the latest view
    useEffect(() => { currentViewRef.current = currentView; }, [currentView]);

    // Reset unread count when switching to chat
    const handleViewChange = useCallback((view: View) => {
        setCurrentView(view);
        if (view === 'chat') setUnreadChatCount(0);
    }, []);

    // Called by ChatView when a new AI/automation message arrives
    const handleNewChatMessage = useCallback(() => {
        if (currentViewRef.current !== 'chat') {
            setUnreadChatCount(prev => prev + 1);
        }
    }, []);

    // Listen for tray "New Chat" menu item
    useEffect(() => {
        if (!window.onicode?.onTrayNewChat) return;
        const cleanup = window.onicode.onTrayNewChat(() => {
            handleViewChange('chat');
            window.dispatchEvent(new CustomEvent('onicode-new-chat'));
        });
        return cleanup;
    }, [handleViewChange]);

    // Listen for file open requests — open in Document Viewer panel
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.path && detail?.name) {
                setPanel({ widget: 'viewer' as WidgetType, data: { path: detail.path, name: detail.name } });
            }
        };
        window.addEventListener('onicode-open-file', handler);
        return () => window.removeEventListener('onicode-open-file', handler);
    }, []);

    // Listen for view navigation from slash commands (e.g. /workflows)
    useEffect(() => {
        const handler = (e: Event) => {
            const view = (e as CustomEvent).detail as View;
            if (view) handleViewChange(view);
        };
        window.addEventListener('onicode-navigate', handler);
        return () => window.removeEventListener('onicode-navigate', handler);
    }, [handleViewChange]);

    // Listen for panel requests from ChatView (slash commands, AI actions, icon clicks)
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.type) {
                setPanel({ widget: detail.type as WidgetType, data: detail.data });
            }
        };
        window.addEventListener('onicode-panel', handler);
        return () => window.removeEventListener('onicode-panel', handler);
    }, []);

    // Listen for panel mode changes from Settings
    const [panelHidden, setPanelHidden] = useState(() => localStorage.getItem('onicode-panel-mode') === 'hidden');
    useEffect(() => {
        const handler = (e: Event) => {
            const mode = (e as CustomEvent).detail;
            setPanelHidden(mode === 'hidden');
            localStorage.setItem('onicode-panel-mode', mode);
            if (mode === 'hidden') setPanel({ widget: null });
        };
        window.addEventListener('onicode-panel-mode', handler);
        return () => window.removeEventListener('onicode-panel-mode', handler);
    }, []);

    // Listen for project activation (from /openproject, /init, or AI project creation)
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as ActiveProject;
            if (detail?.id && detail?.name) {
                setActiveProject(detail);
                setChatScope('project');
                localStorage.setItem('onicode-active-project', JSON.stringify(detail));
                localStorage.setItem('onicode-chat-scope', 'project');
                // Switch to chat view when a project is activated
                handleViewChange('chat');
            }
        };
        window.addEventListener('onicode-project-activate', handler);
        return () => window.removeEventListener('onicode-project-activate', handler);
    }, []);

    // Restore active project + scope from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem('onicode-active-project');
            if (stored) {
                setActiveProject(JSON.parse(stored));
                setChatScope('project');
            }
            const scope = localStorage.getItem('onicode-chat-scope') as ChatScope | null;
            if (scope) setChatScope(scope);
        } catch { /* ignore */ }
    }, []);

    // Check if onboarding is needed (no user.md yet)
    useEffect(() => {
        if (!window.onicode) return;
        window.onicode.memoryEnsureDefaults().then((result) => {
            if (result.success && result.needsOnboarding) {
                setShowOnboarding(true);
            }
        });
    }, []);

    // ── Mode switching ──
    const switchMode = useCallback(async (newMode: OnicodeMode) => {
        if (newMode === mode) return;

        // Workmate: prompt for folder if none selected
        if (newMode === 'workmate' && !workmateFolder) {
            if (isElectron && window.onicode?.selectFolder) {
                const result = await window.onicode.selectFolder();
                if (!result.success || !result.path) return; // cancelled
                const folder = { path: result.path, name: result.name || result.path.split('/').pop() || 'folder' };
                setWorkmateFolder(folder);
                localStorage.setItem('onicode-workmate-folder', JSON.stringify(folder));
            } else return;
        }

        // Projects: if no active project, switch to projects view to pick one
        if (newMode === 'projects' && !activeProject) {
            setMode('projects');
            localStorage.setItem('onicode-mode', 'projects');
            setChatScope('general');
            handleViewChange('projects');
            return;
        }

        setMode(newMode);
        localStorage.setItem('onicode-mode', newMode);

        // Derive scope from mode
        const newScope: ChatScope = newMode === 'onichat' ? 'general' : newMode === 'workmate' ? 'workmate' : 'project';
        setChatScope(newScope);
        localStorage.setItem('onicode-chat-scope', newScope);

        // OniChat: hide panel
        if (newMode === 'onichat') setPanel({ widget: null });
        // Workmate/Projects: open terminal if panel is closed
        if ((newMode === 'workmate' || newMode === 'projects') && !panel.widget) setPanel({ widget: 'terminal' });

        // Switch to chat view and start fresh conversation for new mode
        handleViewChange('chat');
        window.dispatchEvent(new CustomEvent('onicode-new-chat'));
    }, [mode, workmateFolder, activeProject, panel.widget, handleViewChange]);

    // Change workmate folder
    const changeWorkmateFolder = useCallback(async () => {
        if (!isElectron || !window.onicode?.selectFolder) return;
        const result = await window.onicode.selectFolder();
        if (!result.success || !result.path) return;
        const folder = { path: result.path, name: result.name || result.path.split('/').pop() || 'folder' };
        setWorkmateFolder(folder);
        localStorage.setItem('onicode-workmate-folder', JSON.stringify(folder));
        window.dispatchEvent(new CustomEvent('onicode-new-chat'));
    }, []);

    // Listen for mode switch events (from slash commands, keyboard, etc.)
    useEffect(() => {
        const handler = (e: Event) => {
            const newMode = (e as CustomEvent).detail as OnicodeMode;
            if (newMode && ['onichat', 'workmate', 'projects'].includes(newMode)) switchMode(newMode);
        };
        window.addEventListener('onicode-mode-switch', handler);
        return () => window.removeEventListener('onicode-mode-switch', handler);
    }, [switchMode]);

    // Keyboard shortcuts: Cmd+1/2/3 for mode switching
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey)) return;
            if (e.key === '1') { e.preventDefault(); switchMode('onichat'); }
            else if (e.key === '2') { e.preventDefault(); switchMode('workmate'); }
            else if (e.key === '3') { e.preventDefault(); switchMode('projects'); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [switchMode]);

    // When a project is activated, auto-switch to projects mode
    useEffect(() => {
        if (activeProject) {
            setMode('projects');
            localStorage.setItem('onicode-mode', 'projects');
        }
    }, [activeProject]);

    // Derive panelHidden: always hidden in onichat, user-controlled otherwise
    const effectivePanelHidden = mode === 'onichat' || panelHidden;

    const closePanel = useCallback(() => {
        setPanel({ widget: null });
    }, []);

    const changeWidget = useCallback((widget: WidgetType) => setPanel({ widget }), []);

    // Render non-chat views (chat is always mounted, hidden via CSS)
    const renderSecondaryView = useCallback(() => {
        switch (currentView) {
            case 'settings':
                return <SettingsPanel />;
            case 'projects':
                return <ProjectsView />;
            case 'attachments':
                return <AttachmentGallery />;
            case 'memories':
                return <MemoriesView />;
            case 'todo':
                return <TasksView />;
            case 'workflows':
                return <WorkflowsView />;
            default:
                return null;
        }
    }, [currentView]);

    // Request exit from project mode — show warning
    const requestExitProject = useCallback(() => {
        setShowExitWarning(true);
    }, []);

    // Confirm exit from project mode — clears project, starts new general chat
    const confirmExitProject = useCallback(() => {
        setActiveProject(null);
        setChatScope('general');
        localStorage.removeItem('onicode-active-project');
        localStorage.setItem('onicode-chat-scope', 'general');
        setShowExitWarning(false);
        // Signal ChatView to start a new chat
        window.dispatchEvent(new CustomEvent('onicode-new-chat'));
    }, []);

    // Switch project (from dropdown)
    const switchProject = useCallback((project: ActiveProject) => {
        setActiveProject(project);
        setChatScope('project');
        localStorage.setItem('onicode-active-project', JSON.stringify(project));
        localStorage.setItem('onicode-chat-scope', 'project');
        handleViewChange('chat');
        // Signal ChatView to start a new project-scoped chat
        window.dispatchEvent(new CustomEvent('onicode-new-chat'));
    }, []);

    // Change chat scope (from scope tag)
    const changeChatScope = useCallback((scope: ChatScope) => {
        if (scope === 'project' && !activeProject) return;
        setChatScope(scope);
        localStorage.setItem('onicode-chat-scope', scope);
    }, [activeProject]);

    // Load projects for dropdown
    useEffect(() => {
        if (!isElectron) return;
        window.onicode!.listProjects().then((result: unknown) => {
            const res = result as { projects?: Array<{ id: string; name: string; path: string }> };
            if (res.projects) setProjects(res.projects.map(p => ({ id: p.id, name: p.name, path: p.path })));
        }).catch(() => {});
    }, [activeProject?.id]);

    // Close project dropdown on outside click
    useEffect(() => {
        if (!projectDropdown) return;
        const handler = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.app-header-project')) setProjectDropdown(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [projectDropdown]);

    const togglePanel = useCallback(() => {
        if (panel.widget) {
            setPanel({ widget: null });
        } else {
            setPanel({ widget: 'terminal' });
        }
    }, [panel.widget]);

    const openHistory = useCallback(() => {
        handleViewChange('chat');
        window.dispatchEvent(new CustomEvent('onicode-show-history'));
    }, [handleViewChange]);

    const newChatFromHeader = useCallback(() => {
        handleViewChange('chat');
        window.dispatchEvent(new CustomEvent('onicode-new-chat'));
    }, [handleViewChange]);

    return (
        <div className="app" data-theme={theme}>
            {showOnboarding && (
                <OnboardingDialog
                    onComplete={() => setShowOnboarding(false)}
                    onSkip={() => setShowOnboarding(false)}
                />
            )}

            {/* ── Unified App Header ── */}
            <header className="app-header">
                {/* Mode Switcher */}
                <div className="mode-switcher">
                    {([
                        { id: 'onichat' as OnicodeMode, label: 'OniChat' },
                        { id: 'workmate' as OnicodeMode, label: 'Workmate' },
                        { id: 'projects' as OnicodeMode, label: 'Projects' },
                    ]).map(m => (
                        <button key={m.id} className={`mode-btn ${mode === m.id ? 'active' : ''}`} onClick={() => switchMode(m.id)} title={`${m.label} (${m.id === 'onichat' ? '⌘1' : m.id === 'workmate' ? '⌘2' : '⌘3'})`}>
                            <span className="mode-btn-label">{m.label}</span>
                        </button>
                    ))}
                </div>

                {/* Context indicator */}
                <div className="mode-context">
                    {mode === 'projects' && activeProject ? (
                        <div className="app-header-project">
                            <button className="app-header-project-btn" onClick={() => setProjectDropdown(!projectDropdown)}>
                                <span>{activeProject.name}</span>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                            </button>
                            {activeProject.gitBranch && (
                                <span className="app-header-branch">⑂ {activeProject.gitBranch}</span>
                            )}
                            {projectDropdown && (
                                <div className="app-header-dropdown">
                                    {projects.filter(p => p.id !== activeProject.id).map(p => (
                                        <button key={p.id} className="app-header-dropdown-item" onClick={() => { setProjectDropdown(false); switchProject(p); }}>
                                            {p.name}
                                        </button>
                                    ))}
                                    <div className="app-header-dropdown-divider" />
                                    <button className="app-header-dropdown-item app-header-dropdown-exit" onClick={() => { setProjectDropdown(false); requestExitProject(); }}>
                                        Exit Project
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : mode === 'workmate' && workmateFolder ? (
                        <button className="mode-context-folder" onClick={changeWorkmateFolder} title={workmateFolder.path}>
                            <span>{workmateFolder.name}</span>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                        </button>
                    ) : null}
                </div>

                <div className="app-header-actions">
                    <button className="app-header-btn" onClick={openHistory} title="History">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                        </svg>
                    </button>
                    <button className="app-header-btn" onClick={togglePanel} title={panel.widget ? 'Close panel' : 'Open panel'}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <line x1="15" y1="3" x2="15" y2="21" />
                        </svg>
                    </button>
                    <button className="app-header-btn app-header-new" onClick={newChatFromHeader} title="New chat">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                    </button>
                </div>
            </header>

            {/* Exit project warning dialog */}
            {showExitWarning && (
                <div className="exit-warning-overlay" onClick={() => setShowExitWarning(false)}>
                    <div className="exit-warning-dialog" onClick={(e) => e.stopPropagation()}>
                        <h3>Exit Project Mode?</h3>
                        <p>This will close <strong>{activeProject?.name}</strong> and start a new general chat. Your current project chat will be saved in history.</p>
                        <div className="exit-warning-actions">
                            <button className="exit-warning-cancel" onClick={() => setShowExitWarning(false)}>Cancel</button>
                            <button className="exit-warning-confirm" onClick={confirmExitProject}>Exit Project</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="app-body">
                <Sidebar currentView={currentView} onViewChange={handleViewChange} unreadChatCount={unreadChatCount} mode={mode} />
                <div className={`main-content ${panel.widget ? 'with-panel' : ''}`}>
                    <div className={`view-layer ${currentView === 'chat' ? 'view-active' : 'view-hidden'}`}>
                        <ChatView
                            scope={chatScope}
                            activeProject={activeProject}
                            onChangeScope={changeChatScope}
                            onNewMessage={handleNewChatMessage}
                            mode={mode}
                            workmateFolder={workmateFolder}
                        />
                    </div>
                    {/* Keep heavy views mounted to preserve state across tab switches */}
                    <div className={`view-layer ${currentView === 'workflows' ? 'view-active' : 'view-hidden'}`}>
                        <ViewErrorBoundary onReset={() => setCurrentView('chat')}>
                            <WorkflowsView isVisible={currentView === 'workflows'} />
                        </ViewErrorBoundary>
                    </div>
                    {/* Light views can remount — they reload quickly */}
                    {currentView !== 'chat' && currentView !== 'workflows' && (
                        <div className="view-layer view-active">
                            <ViewErrorBoundary key={currentView} onReset={() => setCurrentView('chat')}>
                                {renderSecondaryView()}
                            </ViewErrorBoundary>
                        </div>
                    )}
                </div>
                {!effectivePanelHidden && (
                    <RightPanel
                        panel={panel}
                        onClose={closePanel}
                        onChangeWidget={changeWidget}
                        mode={mode}
                    />
                )}
            </div>

        </div>
    );
}

export default function App() {
    return (
        <ThemeProvider>
            <AppContent />
        </ThemeProvider>
    );
}
