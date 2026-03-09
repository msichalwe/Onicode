import React, { useState, useCallback, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import SettingsPanel from './components/SettingsPanel';
import ProjectsView from './components/ProjectsView';
import DocsView from './components/DocsView';
import TodoApp from './components/TodoApp';
import MemoriesView from './components/MemoriesView';
import OnboardingDialog from './components/OnboardingDialog';
import RightPanel, { type PanelState, type WidgetType } from './components/RightPanel';
import ProjectModeBar, { type ActiveProject } from './components/ProjectModeBar';
import { ThemeProvider, useTheme } from './hooks/useTheme';

export type ChatScope = 'general' | 'project' | 'documents';
export type View = 'chat' | 'projects' | 'documents' | 'memories' | 'settings' | 'todo';

function AppContent() {
    const [currentView, setCurrentView] = useState<View>('chat');
    const [panel, setPanel] = useState<PanelState>({ widget: null });
    const [activeProject, setActiveProject] = useState<ActiveProject | null>(null);
    const [chatScope, setChatScope] = useState<ChatScope>('general');
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [showExitWarning, setShowExitWarning] = useState(false);
    const { theme } = useTheme();

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
                setCurrentView('chat');
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
            case 'documents':
                return <DocsView />;
            case 'memories':
                return <MemoriesView />;
            case 'todo':
                return <TodoApp />;
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
        setCurrentView('chat');
        // Signal ChatView to start a new project-scoped chat
        window.dispatchEvent(new CustomEvent('onicode-new-chat'));
    }, []);

    // Change chat scope (from scope tag)
    const changeChatScope = useCallback((scope: ChatScope) => {
        if (scope === 'project' && !activeProject) return;
        setChatScope(scope);
        localStorage.setItem('onicode-chat-scope', scope);
    }, [activeProject]);

    return (
        <div className="app" data-theme={theme}>
            <div className="titlebar-drag" />
            {showOnboarding && (
                <OnboardingDialog
                    onComplete={() => setShowOnboarding(false)}
                    onSkip={() => setShowOnboarding(false)}
                />
            )}
            {activeProject && (
                <ProjectModeBar
                    project={activeProject}
                    onClose={requestExitProject}
                    onSwitchProject={switchProject}
                    onCommit={() => {
                        window.dispatchEvent(new CustomEvent('onicode-panel', {
                            detail: { type: 'terminal', data: { cwd: activeProject.path } }
                        }));
                    }}
                />
            )}

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

            <div className={`app-body ${activeProject ? 'with-project-bar' : ''}`}>
                <Sidebar currentView={currentView} onViewChange={setCurrentView} />
                <div className={`main-content ${panel.widget ? 'with-panel' : ''}`}>
                    {/* ChatView is ALWAYS mounted — never unmounted during tab switches.
                        This preserves AI streaming, state, and tool execution. */}
                    <div className={`view-layer ${currentView === 'chat' ? 'view-active' : 'view-hidden'}`}>
                        <ChatView
                            scope={chatScope}
                            activeProject={activeProject}
                            onChangeScope={changeChatScope}
                        />
                    </div>
                    {currentView !== 'chat' && (
                        <div className="view-layer view-active">
                            {renderSecondaryView()}
                        </div>
                    )}
                </div>
                {panel.widget && (
                    <RightPanel
                        panel={panel}
                        onClose={closePanel}
                        onChangeWidget={changeWidget}
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
