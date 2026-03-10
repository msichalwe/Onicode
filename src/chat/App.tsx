import React, { useState, useCallback, useEffect, useRef } from 'react';
import hljs from 'highlight.js/lib/core';
import 'highlight.js/styles/github-dark.css';
// Register common languages for syntax highlighting
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import sql from 'highlight.js/lib/languages/sql';
import diff from 'highlight.js/lib/languages/diff';
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('jsx', javascript);
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import SettingsPanel from './components/SettingsPanel';
import ProjectsView from './components/ProjectsView';
import AttachmentGallery from './components/AttachmentGallery';
import TasksView from './components/TodoApp';
import MemoriesView from './components/MemoriesView';
import OnboardingDialog from './components/OnboardingDialog';
import RightPanel, { type PanelState, type WidgetType } from './components/RightPanel';
import { type ActiveProject } from './components/ProjectModeBar';
import { ThemeProvider, useTheme } from './hooks/useTheme';

export type ChatScope = 'general' | 'project' | 'documents';
export type View = 'chat' | 'projects' | 'attachments' | 'memories' | 'settings' | 'todo';

const isElectron = typeof window !== 'undefined' && !!window.onicode;

interface FloatingFile {
    path: string;
    name: string;
    content: string;
    language: string;
    dirty: boolean;
    editing: boolean;
}

interface FloatingPosition {
    x: number;
    y: number;
    w: number;
    h: number;
    snapped: 'left' | 'right' | null;
}

function AppContent() {
    const [currentView, setCurrentView] = useState<View>('chat');
    const [panel, setPanel] = useState<PanelState>({ widget: null });
    const [activeProject, setActiveProject] = useState<ActiveProject | null>(null);
    const [chatScope, setChatScope] = useState<ChatScope>('general');
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [showExitWarning, setShowExitWarning] = useState(false);
    const [projectDropdown, setProjectDropdown] = useState(false);
    const [projects, setProjects] = useState<ActiveProject[]>([]);
    const [floatingFile, setFloatingFile] = useState<FloatingFile | null>(null);
    const [floatPos, setFloatPos] = useState<FloatingPosition>({ x: 100, y: 60, w: 700, h: 500, snapped: null });
    const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; mode: 'move' | 'resize' } | null>(null);
    const codeRef = useRef<HTMLElement>(null);
    const { theme } = useTheme();

    // Listen for file open requests (from side panel file viewer)
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.path && detail?.name) {
                // Load file content
                if (window.onicode?.readFileContent) {
                    window.onicode.readFileContent(detail.path).then(result => {
                        if (result.content !== undefined) {
                            const ext = detail.name.split('.').pop()?.toLowerCase() || '';
                            const langs: Record<string, string> = { ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', py: 'python', css: 'css', html: 'html', json: 'json', md: 'markdown', yml: 'yaml', yaml: 'yaml', sh: 'shell' };
                            setFloatingFile({
                                path: detail.path,
                                name: detail.name,
                                content: result.content,
                                language: langs[ext] || ext,
                                dirty: false,
                                editing: false,
                            });
                            // Center the editor in viewport
                            setFloatPos(p => ({
                                ...p,
                                x: Math.max(80, (window.innerWidth - p.w) / 2),
                                y: Math.max(40, (window.innerHeight - p.h) / 2 - 20),
                                snapped: null,
                            }));
                        }
                    });
                }
            }
        };
        window.addEventListener('onicode-open-file', handler);
        return () => window.removeEventListener('onicode-open-file', handler);
    }, []);

    // Keyboard shortcuts for floating editor (Cmd+S to save, Esc to close)
    useEffect(() => {
        if (!floatingFile) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { setFloatingFile(null); e.preventDefault(); }
            if ((e.metaKey || e.ctrlKey) && e.key === 's' && floatingFile.dirty) {
                e.preventDefault();
                if (window.onicode?.writeFile) {
                    window.onicode.writeFile(floatingFile.path, floatingFile.content).then(() => {
                        setFloatingFile(f => f ? { ...f, dirty: false } : null);
                    });
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [floatingFile]);

    // Syntax highlight when file content changes
    useEffect(() => {
        if (!floatingFile || floatingFile.editing || !codeRef.current) return;
        try {
            const lang = floatingFile.language;
            const highlighted = hljs.getLanguage(lang)
                ? hljs.highlight(floatingFile.content, { language: lang }).value
                : hljs.highlightAuto(floatingFile.content).value;
            codeRef.current.innerHTML = highlighted;
        } catch {
            if (codeRef.current) codeRef.current.textContent = floatingFile.content;
        }
    }, [floatingFile?.content, floatingFile?.language, floatingFile?.editing]);

    // Drag and resize handlers for floating editor
    useEffect(() => {
        if (!dragRef.current) return;
        const handleMouseMove = (e: MouseEvent) => {
            if (!dragRef.current) return;
            const dx = e.clientX - dragRef.current.startX;
            const dy = e.clientY - dragRef.current.startY;
            if (dragRef.current.mode === 'move') {
                const newX = dragRef.current.origX + dx;
                const newY = Math.max(0, dragRef.current.origY + dy);
                // Snap detection: snap to left/right when dragged to edge
                const snapThreshold = 20;
                if (newX < snapThreshold) {
                    setFloatPos(p => ({ ...p, x: 0, y: 0, w: window.innerWidth / 2, h: window.innerHeight - 40, snapped: 'left' }));
                } else if (newX + floatPos.w > window.innerWidth - snapThreshold) {
                    setFloatPos(p => ({ ...p, x: window.innerWidth / 2, y: 0, w: window.innerWidth / 2, h: window.innerHeight - 40, snapped: 'right' }));
                } else {
                    setFloatPos(p => ({ ...p, x: newX, y: newY, snapped: null }));
                }
            } else {
                setFloatPos(p => ({
                    ...p,
                    w: Math.max(400, dragRef.current!.origX + dx),
                    h: Math.max(300, dragRef.current!.origY + dy),
                    snapped: null,
                }));
            }
        };
        const handleMouseUp = () => { dragRef.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; };
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); };
    });

    const startDrag = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        dragRef.current = { startX: e.clientX, startY: e.clientY, origX: floatPos.x, origY: floatPos.y, mode: 'move' };
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
    }, [floatPos.x, floatPos.y]);

    const startResize = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragRef.current = { startX: e.clientX, startY: e.clientY, origX: floatPos.w, origY: floatPos.h, mode: 'resize' };
        document.body.style.cursor = 'nwse-resize';
        document.body.style.userSelect = 'none';
    }, [floatPos.w, floatPos.h]);

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
            case 'attachments':
                return <AttachmentGallery />;
            case 'memories':
                return <MemoriesView />;
            case 'todo':
                return <TasksView />;
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
        setCurrentView('chat');
        window.dispatchEvent(new CustomEvent('onicode-show-history'));
    }, []);

    const newChatFromHeader = useCallback(() => {
        setCurrentView('chat');
        window.dispatchEvent(new CustomEvent('onicode-new-chat'));
    }, []);

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
                {activeProject ? (
                    <div className="app-header-project">
                        <button
                            className="app-header-project-btn"
                            onClick={() => setProjectDropdown(!projectDropdown)}
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                            </svg>
                            <span>{activeProject.name}</span>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="6 9 12 15 18 9" />
                            </svg>
                        </button>
                        {activeProject.gitBranch && (
                            <span className="app-header-branch">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 01-9 9" />
                                </svg>
                                {activeProject.gitBranch}
                            </span>
                        )}
                        {projectDropdown && (
                            <div className="app-header-dropdown">
                                {projects.filter(p => p.id !== activeProject.id).length === 0 ? (
                                    <div className="app-header-dropdown-empty">No other projects</div>
                                ) : (
                                    projects.filter(p => p.id !== activeProject.id).map(p => (
                                        <button key={p.id} className="app-header-dropdown-item" onClick={() => { setProjectDropdown(false); switchProject(p); }}>
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                                            {p.name}
                                        </button>
                                    ))
                                )}
                                <div className="app-header-dropdown-divider" />
                                <button className="app-header-dropdown-item app-header-dropdown-exit" onClick={() => { setProjectDropdown(false); requestExitProject(); }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                    Exit Project
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="app-header-title">Onicode</div>
                )}

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
                <Sidebar currentView={currentView} onViewChange={setCurrentView} />
                <div className={`main-content ${panel.widget ? 'with-panel' : ''}`}>
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
                <RightPanel
                    panel={panel}
                    onClose={closePanel}
                    onChangeWidget={changeWidget}
                />
            </div>

            {/* Floating file editor — draggable, resizable, snappable */}
            {floatingFile && (
                <div
                    className={`floating-editor${floatPos.snapped ? ' floating-editor-snapped' : ''}`}
                    style={{
                        left: floatPos.x,
                        top: floatPos.y,
                        width: floatPos.w,
                        height: floatPos.h,
                    }}
                >
                    <div className="floating-editor-header" onMouseDown={startDrag}>
                        <div className="floating-editor-tabs">
                            <div className="floating-editor-tab active">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                <span>{floatingFile.name}</span>
                                {floatingFile.dirty && <span className="floating-editor-dot" />}
                            </div>
                        </div>
                        <div className="floating-editor-actions">
                            <span className="floating-editor-lang">{floatingFile.language}</span>
                            <span className="floating-editor-path" title={floatingFile.path}>{floatingFile.path.split('/').slice(-3).join('/')}</span>
                            {!floatingFile.editing ? (
                                <button
                                    className="floating-editor-edit-btn"
                                    onClick={() => setFloatingFile(f => f ? { ...f, editing: true } : null)}
                                    title="Edit file"
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                    Edit
                                </button>
                            ) : (
                                <button
                                    className="floating-editor-edit-btn"
                                    onClick={() => setFloatingFile(f => f ? { ...f, editing: false } : null)}
                                    title="View with highlighting"
                                >View</button>
                            )}
                            {floatingFile.dirty && (
                                <button
                                    className="floating-editor-save"
                                    onClick={async () => {
                                        if (window.onicode?.writeFile) {
                                            await window.onicode.writeFile(floatingFile.path, floatingFile.content);
                                            setFloatingFile(f => f ? { ...f, dirty: false } : null);
                                        }
                                    }}
                                >Save</button>
                            )}
                            <button className="floating-editor-close" onClick={() => setFloatingFile(null)}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            </button>
                        </div>
                    </div>
                    <div className="floating-editor-body">
                        {floatingFile.editing ? (
                            <textarea
                                className="floating-editor-textarea"
                                value={floatingFile.content}
                                onChange={(e) => setFloatingFile(f => f ? { ...f, content: e.target.value, dirty: true } : null)}
                                spellCheck={false}
                                autoFocus
                            />
                        ) : (
                            <pre className="floating-editor-code"><code ref={codeRef} className={`hljs language-${floatingFile.language}`} /></pre>
                        )}
                    </div>
                    {/* Resize handle */}
                    <div className="floating-editor-resize" onMouseDown={startResize} />
                </div>
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
