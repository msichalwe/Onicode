import React, { useState, useCallback, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import SettingsPanel from './components/SettingsPanel';
import ProjectsView from './components/ProjectsView';
import DocsView from './components/DocsView';
import TodoApp from './components/TodoApp';
import RightPanel, { type PanelState, type WidgetType } from './components/RightPanel';
import ProjectModeBar, { type ActiveProject } from './components/ProjectModeBar';
import { ThemeProvider, useTheme } from './hooks/useTheme';

type View = 'chat' | 'projects' | 'documents' | 'settings' | 'todo';

function AppContent() {
    const [currentView, setCurrentView] = useState<View>('chat');
    const [panel, setPanel] = useState<PanelState>({ widget: null });
    const [activeProject, setActiveProject] = useState<ActiveProject | null>(null);
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
                localStorage.setItem('onicode-active-project', JSON.stringify(detail));
            }
        };
        window.addEventListener('onicode-project-activate', handler);
        return () => window.removeEventListener('onicode-project-activate', handler);
    }, []);

    // Restore active project from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem('onicode-active-project');
            if (stored) setActiveProject(JSON.parse(stored));
        } catch { /* ignore */ }
    }, []);

    const closePanel = useCallback(() => {
        setPanel({ widget: null });
    }, []);

    const changeWidget = useCallback((widget: WidgetType) => setPanel({ widget }), []);

    const renderView = useCallback(() => {
        switch (currentView) {
            case 'chat':
                return <ChatView />;
            case 'settings':
                return <SettingsPanel />;
            case 'projects':
                return <ProjectsView />;
            case 'documents':
                return <DocsView />;
            case 'todo':
                return <TodoApp />;
            default:
                return <ChatView />;
        }
    }, [currentView]);

    const clearProject = useCallback(() => {
        setActiveProject(null);
        localStorage.removeItem('onicode-active-project');
    }, []);

    return (
        <div className="app" data-theme={theme}>
            <div className="titlebar-drag" />
            {activeProject && (
                <ProjectModeBar
                    project={activeProject}
                    onClose={clearProject}
                    onCommit={() => {
                        window.dispatchEvent(new CustomEvent('onicode-panel', {
                            detail: { type: 'terminal', data: { cwd: activeProject.path } }
                        }));
                    }}
                />
            )}
            <div className={`app-body ${activeProject ? 'with-project-bar' : ''}`}>
                <Sidebar currentView={currentView} onViewChange={setCurrentView} />
                <div className={`main-content ${panel.widget ? 'with-panel' : ''}`}>
                    {renderView()}
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
