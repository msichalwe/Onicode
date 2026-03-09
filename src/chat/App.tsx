import React, { useState, useCallback, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import SettingsPanel from './components/SettingsPanel';
import ProjectsView from './components/ProjectsView';
import DocsView from './components/DocsView';
import RightPanel, { type PanelState, type WidgetType } from './components/RightPanel';
import { ThemeProvider, useTheme } from './hooks/useTheme';

type View = 'chat' | 'projects' | 'documents' | 'settings';

function AppContent() {
    const [currentView, setCurrentView] = useState<View>('chat');
    const [panel, setPanel] = useState<PanelState>({ widget: null });
    const { theme } = useTheme();

    // Listen for panel requests from ChatView (slash commands, AI actions)
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

    const closePanel = useCallback(() => setPanel({ widget: null }), []);
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
            default:
                return <ChatView />;
        }
    }, [currentView]);

    return (
        <div className="app" data-theme={theme}>
            <div className="titlebar-drag" />
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
    );
}

export default function App() {
    return (
        <ThemeProvider>
            <AppContent />
        </ThemeProvider>
    );
}
