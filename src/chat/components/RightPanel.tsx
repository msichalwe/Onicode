import React, { useState, useEffect } from 'react';

import TerminalWidget from './widgets/TerminalWidget';
import AgentsWidget from './widgets/AgentsWidget';
import ProjectWidget from './widgets/ProjectWidget';
import TasksWidget from './widgets/TasksWidget';
import GitWidget from './widgets/GitWidget';
import DocumentViewerWidget from './widgets/DocumentViewerWidget';

// ══════════════════════════════════════════
//  Widget Types (kernel layer)
// ══════════════════════════════════════════

export type WidgetType = 'terminal' | 'agents' | 'project' | 'tasks' | 'git' | 'viewer';

export interface PanelState {
    widget: WidgetType | null;
    data?: Record<string, unknown>;
}

interface WidgetDef {
    id: WidgetType;
    label: string;
    icon: React.ReactNode;
}

const WIDGETS: WidgetDef[] = [
    { id: 'terminal', label: 'Terminal', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg> },
    { id: 'project', label: 'Project', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" /></svg> },
    { id: 'viewer', label: 'Viewer', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg> },
    { id: 'agents', label: 'Agents', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" /></svg> },
    { id: 'tasks', label: 'Tasks', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg> },
    { id: 'git', label: 'Git', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 012 2v7" /><line x1="6" y1="9" x2="6" y2="21" /></svg> },
];

// ══════════════════════════════════════════
//  Right Panel
// ══════════════════════════════════════════

interface RightPanelProps {
    panel: PanelState;
    onClose: () => void;
    onChangeWidget: (widget: WidgetType) => void;
}

// Track which widgets have been opened so they stay mounted (preserves terminal state)
export default function RightPanel({ panel, onClose, onChangeWidget }: RightPanelProps) {
    const [collapsed, setCollapsed] = useState(false);
    const [mountedWidgets, setMountedWidgets] = useState<Set<WidgetType>>(new Set());

    // Track mounted widgets so terminal etc. stay alive across tab switches AND panel close/open
    useEffect(() => {
        if (panel.widget) {
            setMountedWidgets(prev => {
                if (prev.has(panel.widget!)) return prev;
                const next = new Set(prev);
                next.add(panel.widget!);
                return next;
            });
        }
    }, [panel.widget]);

    // When panel is closed (widget is null), hide but keep persistent widgets alive
    const isVisible = !!panel.widget;
    const activeWidget = WIDGETS.find((w) => w.id === panel.widget);

    const renderNonPersistentWidget = (type: WidgetType) => {
        switch (type) {
            case 'project': return <ProjectWidget />;
            case 'viewer': return <DocumentViewerWidget data={panel.data} />;
            case 'agents': return <AgentsWidget />;
            case 'tasks': return <TasksWidget />;
            case 'git': return <GitWidget />;
            default: return null;
        }
    };

    // If terminal has been mounted, always render the panel wrapper to keep terminal alive
    if (!isVisible && !mountedWidgets.has('terminal')) return null;

    return (
        <div className={`right-panel ${collapsed ? 'right-panel-collapsed' : ''}`} style={{ display: isVisible ? undefined : 'none' }}>
            <div className="right-panel-header">
                <div className="right-panel-tabs">
                    {WIDGETS.map((w) => (
                        <button key={w.id} className={`panel-tab ${panel.widget === w.id ? 'active' : ''}`} onClick={() => onChangeWidget(w.id)} title={w.label}>
                            {w.icon}
                        </button>
                    ))}
                </div>
                {!collapsed && activeWidget && <div className="right-panel-title">{activeWidget.label}</div>}
                <div className="right-panel-actions">
                    <button className="panel-collapse" onClick={() => setCollapsed(!collapsed)} title={collapsed ? 'Expand panel' : 'Collapse panel'}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            {collapsed
                                ? <polyline points="15 18 9 12 15 6" />
                                : <polyline points="9 18 15 12 9 6" />
                            }
                        </svg>
                    </button>
                    <button className="panel-close" onClick={onClose} title="Close panel">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>
            </div>
            {!collapsed && (
                <div className="right-panel-body">
                    {/* Terminal stays mounted once opened — survives tab switches AND panel close/open */}
                    {mountedWidgets.has('terminal') && (
                        <div style={{ display: panel.widget === 'terminal' ? 'contents' : 'none' }}>
                            <TerminalWidget />
                        </div>
                    )}
                    {/* Other widgets render normally */}
                    {panel.widget && panel.widget !== 'terminal' && renderNonPersistentWidget(panel.widget)}
                </div>
            )}
        </div>
    );
}
