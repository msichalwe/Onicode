import React, { useState, useEffect, useCallback } from 'react';

const isElectron = typeof window !== 'undefined' && !!window.onicode;

interface Project {
    id: string;
    name: string;
    path: string;
    description: string;
    techStack: string;
    createdAt: number;
    updatedAt: number;
}

interface ProjectDoc {
    name: string;
    path: string;
    content: string;
}

interface FileItem {
    name: string;
    path: string;
    type: 'file' | 'directory';
    children?: FileItem[];
}

interface TaskItem {
    id: string;
    title: string;
    description: string;
    status: 'backlog' | 'todo' | 'in-progress' | 'done';
    priority: 'low' | 'medium' | 'high' | 'critical';
    type: 'task' | 'story' | 'bug';
    createdAt: number;
}

interface Milestone {
    id: string;
    title: string;
    description: string;
    dueDate: number | null;
    status: 'open' | 'closed';
    createdAt: number;
}

type ProjectTab = 'overview' | 'git' | 'tasks' | 'milestones';

const EDITORS = [
    { id: 'vscode', name: 'VS Code', icon: 'VS' },
    { id: 'cursor', name: 'Cursor', icon: 'Cu' },
    { id: 'windsurf', name: 'Windsurf', icon: 'Ws' },
    { id: 'finder', name: 'Finder', icon: 'Fi' },
];

const KANBAN_COLS: { key: TaskItem['status']; label: string }[] = [
    { key: 'backlog', label: 'Backlog' },
    { key: 'todo', label: 'To Do' },
    { key: 'in-progress', label: 'In Progress' },
    { key: 'done', label: 'Done' },
];

const PRIORITIES: TaskItem['priority'][] = ['critical', 'high', 'medium', 'low'];

function generateId() { return Math.random().toString(36).substring(2, 10); }

function getTasksKey(projectId: string) { return `onicode-tasks-${projectId}`; }
function getMilestonesKey(projectId: string) { return `onicode-milestones-${projectId}`; }

function loadTasks(projectId: string): TaskItem[] {
    try { return JSON.parse(localStorage.getItem(getTasksKey(projectId)) || '[]'); } catch { return []; }
}
function saveTasks(projectId: string, tasks: TaskItem[]) {
    localStorage.setItem(getTasksKey(projectId), JSON.stringify(tasks));
}
function loadMilestones(projectId: string): Milestone[] {
    try { return JSON.parse(localStorage.getItem(getMilestonesKey(projectId)) || '[]'); } catch { return []; }
}
function saveMilestones(projectId: string, milestones: Milestone[]) {
    localStorage.setItem(getMilestonesKey(projectId), JSON.stringify(milestones));
}

// ══════════════════════════════════════════
//  Git Tab
// ══════════════════════════════════════════

function GitTab({ projectPath }: { projectPath: string }) {
    const [isRepo, setIsRepo] = useState<boolean | null>(null);
    const [branch, setBranch] = useState('');
    const [files, setFiles] = useState<GitStatusFile[]>([]);
    const [ahead, setAhead] = useState(0);
    const [behind, setBehind] = useState(0);
    const [commits, setCommits] = useState<GitCommit[]>([]);
    const [branches, setBranches] = useState<GitBranch[]>([]);
    const [commitMsg, setCommitMsg] = useState('');
    const [diffContent, setDiffContent] = useState('');
    const [diffFile, setDiffFile] = useState('');
    const [gitSubTab, setGitSubTab] = useState<'status' | 'branches' | 'log'>('status');
    const [newBranch, setNewBranch] = useState('');
    const [loading, setLoading] = useState(false);

    const refresh = useCallback(async () => {
        if (!isElectron) return;
        setLoading(true);
        const repoCheck = await window.onicode!.gitIsRepo(projectPath);
        setIsRepo(repoCheck.isRepo);
        if (repoCheck.isRepo) {
            const status = await window.onicode!.gitStatus(projectPath);
            if (status.success) {
                setBranch(status.branch || '');
                setFiles(status.files || []);
                setAhead(status.ahead || 0);
                setBehind(status.behind || 0);
            }
            const logRes = await window.onicode!.gitLog(projectPath, 30);
            if (logRes.commits) setCommits(logRes.commits);
            const brRes = await window.onicode!.gitBranches(projectPath);
            if (brRes.branches) setBranches(brRes.branches);
        }
        setLoading(false);
    }, [projectPath]);

    useEffect(() => { refresh(); }, [refresh]);

    const initRepo = async () => {
        await window.onicode!.gitInit(projectPath);
        refresh();
    };

    const stageFile = async (filePath: string) => {
        await window.onicode!.gitStage(projectPath, filePath);
        refresh();
    };

    const unstageFile = async (filePath: string) => {
        await window.onicode!.gitUnstage(projectPath, filePath);
        refresh();
    };

    const stageAll = async () => {
        await window.onicode!.gitStage(projectPath, '.');
        refresh();
    };

    const doCommit = async () => {
        if (!commitMsg.trim()) return;
        await window.onicode!.gitCommit(projectPath, commitMsg);
        setCommitMsg('');
        refresh();
    };

    const checkoutBranch = async (name: string) => {
        await window.onicode!.gitCheckout(projectPath, name);
        refresh();
    };

    const createBranch = async () => {
        if (!newBranch.trim()) return;
        await window.onicode!.gitCheckout(projectPath, newBranch.trim(), true);
        setNewBranch('');
        refresh();
    };

    const showDiff = async (filePath: string, staged: boolean) => {
        const res = await window.onicode!.gitDiff(projectPath, filePath, staged);
        setDiffFile(filePath);
        setDiffContent(res.output || '(no diff)');
    };

    const doPull = async () => { setLoading(true); await window.onicode!.gitPull(projectPath); refresh(); };
    const doPush = async () => { setLoading(true); await window.onicode!.gitPush(projectPath); refresh(); };

    if (isRepo === null) return <div className="git-loading">Checking repository...</div>;

    if (!isRepo) {
        return (
            <div className="git-no-repo">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="3" /><line x1="3" y1="12" x2="9" y2="12" /><line x1="15" y1="12" x2="21" y2="12" />
                    <circle cx="12" cy="3" r="2" /><circle cx="12" cy="21" r="2" /><line x1="12" y1="5" x2="12" y2="9" /><line x1="12" y1="15" x2="12" y2="19" />
                </svg>
                <p>Not a git repository</p>
                <button className="test-btn" onClick={initRepo}>Initialize Git Repo</button>
            </div>
        );
    }

    const stagedFiles = files.filter(f => f.staged);
    const unstagedFiles = files.filter(f => !f.staged);

    const statusIcon = (s: string) => {
        const colors: Record<string, string> = { modified: 'var(--warning)', added: 'var(--success)', deleted: 'var(--error)', untracked: 'var(--text-tertiary)', conflicted: 'var(--error)' };
        const labels: Record<string, string> = { modified: 'M', added: 'A', deleted: 'D', untracked: '?', renamed: 'R', copied: 'C', conflicted: 'U' };
        return <span className="git-status-badge" style={{ color: colors[s] || 'var(--text-secondary)' }}>{labels[s] || s[0].toUpperCase()}</span>;
    };

    return (
        <div className="git-tab">
            <div className="git-header">
                <div className="git-branch-info">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 01-9 9" /></svg>
                    <strong>{branch}</strong>
                    {ahead > 0 && <span className="git-sync-badge">↑{ahead}</span>}
                    {behind > 0 && <span className="git-sync-badge">↓{behind}</span>}
                    {files.length === 0 && <span className="git-clean-badge">Clean</span>}
                </div>
                <div className="git-header-actions">
                    <button className="git-action-btn" onClick={doPull} title="Pull" disabled={loading}>↓ Pull</button>
                    <button className="git-action-btn" onClick={doPush} title="Push" disabled={loading}>↑ Push</button>
                    <button className="git-action-btn" onClick={refresh} title="Refresh" disabled={loading}>⟳</button>
                </div>
            </div>

            <div className="git-sub-tabs">
                {(['status', 'branches', 'log'] as const).map(t => (
                    <button key={t} className={`git-sub-tab ${gitSubTab === t ? 'active' : ''}`} onClick={() => setGitSubTab(t)}>
                        {t === 'status' ? `Changes (${files.length})` : t === 'branches' ? 'Branches' : 'History'}
                    </button>
                ))}
            </div>

            {gitSubTab === 'status' && (
                <div className="git-status-panel">
                    {stagedFiles.length > 0 && (
                        <div className="git-file-group">
                            <div className="git-group-header">
                                <span>Staged ({stagedFiles.length})</span>
                            </div>
                            {stagedFiles.map(f => (
                                <div key={f.path} className="git-file-row">
                                    {statusIcon(f.status)}
                                    <span className="git-file-path" onClick={() => showDiff(f.path, true)}>{f.path}</span>
                                    <button className="git-file-action" onClick={() => unstageFile(f.path)} title="Unstage">−</button>
                                </div>
                            ))}
                        </div>
                    )}
                    {unstagedFiles.length > 0 && (
                        <div className="git-file-group">
                            <div className="git-group-header">
                                <span>Changes ({unstagedFiles.length})</span>
                                <button className="git-file-action" onClick={stageAll} title="Stage all">+ All</button>
                            </div>
                            {unstagedFiles.map(f => (
                                <div key={f.path} className="git-file-row">
                                    {statusIcon(f.status)}
                                    <span className="git-file-path" onClick={() => showDiff(f.path, false)}>{f.path}</span>
                                    <button className="git-file-action" onClick={() => stageFile(f.path)} title="Stage">+</button>
                                </div>
                            ))}
                        </div>
                    )}
                    {files.length === 0 && <div className="git-empty">Working tree clean</div>}

                    {stagedFiles.length > 0 && (
                        <div className="git-commit-box">
                            <input
                                className="git-commit-input"
                                placeholder="Commit message..."
                                value={commitMsg}
                                onChange={e => setCommitMsg(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') doCommit(); }}
                            />
                            <button className="test-btn" onClick={doCommit} disabled={!commitMsg.trim()}>Commit</button>
                        </div>
                    )}

                    {diffContent && (
                        <div className="git-diff-viewer">
                            <div className="git-diff-header">
                                <span>{diffFile}</span>
                                <button className="git-file-action" onClick={() => { setDiffContent(''); setDiffFile(''); }}>✕</button>
                            </div>
                            <pre className="git-diff-content">{diffContent}</pre>
                        </div>
                    )}
                </div>
            )}

            {gitSubTab === 'branches' && (
                <div className="git-branches-panel">
                    <div className="git-new-branch">
                        <input className="git-commit-input" placeholder="New branch name..." value={newBranch} onChange={e => setNewBranch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') createBranch(); }} />
                        <button className="test-btn" onClick={createBranch} disabled={!newBranch.trim()}>Create</button>
                    </div>
                    <div className="git-branch-list">
                        {branches.filter(b => !b.remote).map(b => (
                            <div key={b.name} className={`git-branch-row ${b.current ? 'current' : ''}`} onClick={() => !b.current && checkoutBranch(b.name)}>
                                {b.current && <span className="git-current-dot" />}
                                <span className="git-branch-name">{b.name}</span>
                                <span className="git-branch-hash">{b.hash}</span>
                            </div>
                        ))}
                        {branches.filter(b => b.remote).length > 0 && (
                            <>
                                <div className="git-group-header"><span>Remote</span></div>
                                {branches.filter(b => b.remote).map(b => (
                                    <div key={b.name} className="git-branch-row remote">
                                        <span className="git-branch-name">{b.name}</span>
                                        <span className="git-branch-hash">{b.hash}</span>
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                </div>
            )}

            {gitSubTab === 'log' && (
                <div className="git-log-panel">
                    {commits.map(c => (
                        <div key={c.hash} className="git-commit-row">
                            <div className="git-commit-dot" />
                            <div className="git-commit-info">
                                <div className="git-commit-msg">{c.message}</div>
                                <div className="git-commit-meta">
                                    <span>{c.shortHash}</span>
                                    <span>{c.author}</span>
                                    <span>{new Date(c.timestamp).toLocaleDateString()}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                    {commits.length === 0 && <div className="git-empty">No commits yet</div>}
                </div>
            )}
        </div>
    );
}

// ══════════════════════════════════════════
//  Tasks / Kanban Tab
// ══════════════════════════════════════════

// Map AI TaskManager status to Kanban column status
function mapAIStatusToKanban(status: string): TaskItem['status'] {
    switch (status) {
        case 'in_progress': return 'in-progress';
        case 'done': return 'done';
        case 'skipped': return 'done';
        case 'pending':
        default: return 'todo';
    }
}

// Map AI TaskManager priority
function mapAIPriority(priority: string): TaskItem['priority'] {
    if (priority === 'high') return 'high';
    if (priority === 'low') return 'low';
    return 'medium';
}

// Convert AI TaskManager task to Kanban TaskItem
function aiTaskToKanban(aiTask: { id: number; content: string; status: string; priority: string; createdAt: string }): TaskItem {
    return {
        id: `ai-${aiTask.id}`,
        title: aiTask.content,
        description: '',
        status: mapAIStatusToKanban(aiTask.status),
        priority: mapAIPriority(aiTask.priority),
        type: 'task',
        createdAt: new Date(aiTask.createdAt).getTime(),
    };
}

function TasksTab({ projectId }: { projectId: string }) {
    const [manualTasks, setManualTasks] = useState<TaskItem[]>(() => loadTasks(projectId));
    const [aiTasks, setAiTasks] = useState<TaskItem[]>([]);
    const [showForm, setShowForm] = useState(false);
    const [formTitle, setFormTitle] = useState('');
    const [formDesc, setFormDesc] = useState('');
    const [formPriority, setFormPriority] = useState<TaskItem['priority']>('medium');
    const [formType, setFormType] = useState<TaskItem['type']>('task');
    const [dragItem, setDragItem] = useState<string | null>(null);

    // Merged view: AI tasks + manual tasks
    const tasks = [...aiTasks, ...manualTasks];

    useEffect(() => { setManualTasks(loadTasks(projectId)); }, [projectId]);

    // Fetch AI tasks from TaskManager and subscribe to updates
    useEffect(() => {
        if (!isElectron) return;
        // Initial fetch
        window.onicode!.tasksList().then((summary: TaskSummary) => {
            if (summary?.tasks) {
                setAiTasks(summary.tasks.map(aiTaskToKanban));
            }
        }).catch(() => { });
        // Subscribe to real-time updates
        const cleanup = window.onicode!.onTasksUpdated((summary: TaskSummary) => {
            if (summary?.tasks) {
                setAiTasks(summary.tasks.map(aiTaskToKanban));
            }
        });
        return cleanup;
    }, [projectId]);

    const persistManual = (updated: TaskItem[]) => { setManualTasks(updated); saveTasks(projectId, updated); };

    const addTask = () => {
        if (!formTitle.trim()) return;
        const task: TaskItem = {
            id: generateId(), title: formTitle.trim(), description: formDesc.trim(),
            status: 'backlog', priority: formPriority, type: formType, createdAt: Date.now(),
        };
        persistManual([...manualTasks, task]);
        setFormTitle(''); setFormDesc(''); setShowForm(false);
    };

    const moveTask = (taskId: string, newStatus: TaskItem['status']) => {
        // Only manual tasks can be moved via drag-drop (AI tasks are managed by the agent)
        if (taskId.startsWith('ai-')) return;
        persistManual(manualTasks.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    };

    const deleteTask = (taskId: string) => {
        // Only manual tasks can be deleted (AI tasks are managed by the agent)
        if (taskId.startsWith('ai-')) return;
        persistManual(manualTasks.filter(t => t.id !== taskId));
    };

    const priorityColor = (p: string) => {
        const c: Record<string, string> = { critical: 'var(--error)', high: 'var(--warning)', medium: 'var(--accent)', low: 'var(--text-tertiary)' };
        return c[p] || 'var(--text-secondary)';
    };

    const typeIcon = (t: string) => {
        if (t === 'story') return '📖';
        if (t === 'bug') return '🐛';
        return '✓';
    };

    return (
        <div className="tasks-tab">
            <div className="tasks-header">
                <span>{tasks.length} items</span>
                <button className="test-btn" onClick={() => setShowForm(!showForm)}>+ New</button>
            </div>

            {showForm && (
                <div className="task-form">
                    <input className="git-commit-input" placeholder="Title" value={formTitle} onChange={e => setFormTitle(e.target.value)} autoFocus />
                    <input className="git-commit-input" placeholder="Description (optional)" value={formDesc} onChange={e => setFormDesc(e.target.value)} />
                    <div className="task-form-row">
                        <select className="task-select" value={formType} onChange={e => setFormType(e.target.value as TaskItem['type'])} title="Type">
                            <option value="task">Task</option>
                            <option value="story">User Story</option>
                            <option value="bug">Bug</option>
                        </select>
                        <select className="task-select" value={formPriority} onChange={e => setFormPriority(e.target.value as TaskItem['priority'])} title="Priority">
                            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <button className="test-btn" onClick={addTask} disabled={!formTitle.trim()}>Add</button>
                        <button className="disconnect-btn" onClick={() => setShowForm(false)}>Cancel</button>
                    </div>
                </div>
            )}

            <div className="kanban-board">
                {KANBAN_COLS.map(col => (
                    <div
                        key={col.key}
                        className="kanban-column"
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => { if (dragItem) { moveTask(dragItem, col.key); setDragItem(null); } }}
                    >
                        <div className="kanban-col-header">
                            <span>{col.label}</span>
                            <span className="kanban-count">{tasks.filter(t => t.status === col.key).length}</span>
                        </div>
                        <div className="kanban-col-body">
                            {tasks.filter(t => t.status === col.key).map(task => (
                                <div
                                    key={task.id}
                                    className="kanban-card"
                                    draggable
                                    onDragStart={() => setDragItem(task.id)}
                                >
                                    <div className="kanban-card-header">
                                        <span className="kanban-type">{typeIcon(task.type)}</span>
                                        <span className="kanban-priority-dot" style={{ background: priorityColor(task.priority) }} title={task.priority} />
                                        <button className="kanban-delete" onClick={() => deleteTask(task.id)}>×</button>
                                    </div>
                                    <div className="kanban-card-title">{task.title}</div>
                                    {task.description && <div className="kanban-card-desc">{task.description}</div>}
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  Milestones Tab
// ══════════════════════════════════════════

function MilestonesTab({ projectId }: { projectId: string }) {
    const [milestones, setMilestones] = useState<Milestone[]>(() => loadMilestones(projectId));
    const [showForm, setShowForm] = useState(false);
    const [formTitle, setFormTitle] = useState('');
    const [formDesc, setFormDesc] = useState('');
    const [formDue, setFormDue] = useState('');
    const tasks = loadTasks(projectId);

    useEffect(() => { setMilestones(loadMilestones(projectId)); }, [projectId]);

    const persist = (updated: Milestone[]) => { setMilestones(updated); saveMilestones(projectId, updated); };

    const addMilestone = () => {
        if (!formTitle.trim()) return;
        const ms: Milestone = {
            id: generateId(), title: formTitle.trim(), description: formDesc.trim(),
            dueDate: formDue ? new Date(formDue).getTime() : null, status: 'open', createdAt: Date.now(),
        };
        persist([...milestones, ms]);
        setFormTitle(''); setFormDesc(''); setFormDue(''); setShowForm(false);
    };

    const toggleStatus = (id: string) => {
        persist(milestones.map(m => m.id === id ? { ...m, status: m.status === 'open' ? 'closed' as const : 'open' as const } : m));
    };

    const deleteMilestone = (id: string) => {
        persist(milestones.filter(m => m.id !== id));
    };

    const totalTasks = tasks.length;
    const doneTasks = tasks.filter(t => t.status === 'done').length;
    const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

    return (
        <div className="milestones-tab">
            <div className="milestones-header">
                <div className="milestones-summary">
                    <span>{milestones.filter(m => m.status === 'open').length} open</span>
                    <span>{milestones.filter(m => m.status === 'closed').length} closed</span>
                    <span className="milestones-progress">Overall: {progress}% ({doneTasks}/{totalTasks} tasks)</span>
                </div>
                <button className="test-btn" onClick={() => setShowForm(!showForm)}>+ Milestone</button>
            </div>

            {showForm && (
                <div className="task-form">
                    <input className="git-commit-input" placeholder="Milestone title" value={formTitle} onChange={e => setFormTitle(e.target.value)} autoFocus />
                    <input className="git-commit-input" placeholder="Description (optional)" value={formDesc} onChange={e => setFormDesc(e.target.value)} />
                    <div className="task-form-row">
                        <input className="git-commit-input" type="date" value={formDue} onChange={e => setFormDue(e.target.value)} title="Due date" placeholder="Due date" />
                        <button className="test-btn" onClick={addMilestone} disabled={!formTitle.trim()}>Add</button>
                        <button className="disconnect-btn" onClick={() => setShowForm(false)}>Cancel</button>
                    </div>
                </div>
            )}

            <div className="milestones-list">
                {milestones.map(ms => (
                    <div key={ms.id} className={`milestone-card ${ms.status}`}>
                        <div className="milestone-card-left">
                            <button className={`milestone-check ${ms.status}`} onClick={() => toggleStatus(ms.id)}>
                                {ms.status === 'closed' ? '✓' : '○'}
                            </button>
                            <div>
                                <div className="milestone-title">{ms.title}</div>
                                {ms.description && <div className="milestone-desc">{ms.description}</div>}
                                <div className="milestone-meta">
                                    {ms.dueDate && <span>Due: {new Date(ms.dueDate).toLocaleDateString()}</span>}
                                    <span>Created {new Date(ms.createdAt).toLocaleDateString()}</span>
                                </div>
                            </div>
                        </div>
                        <button className="kanban-delete" onClick={() => deleteMilestone(ms.id)}>×</button>
                    </div>
                ))}
                {milestones.length === 0 && (
                    <div className="git-empty">No milestones yet. Create one to track progress.</div>
                )}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  Main ProjectsView
// ══════════════════════════════════════════

export default function ProjectsView() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);
    const [projectDocs, setProjectDocs] = useState<ProjectDoc[]>([]);
    const [fileTree, setFileTree] = useState<FileItem[]>([]);
    const [viewingDoc, setViewingDoc] = useState<ProjectDoc | null>(null);
    const [showNewProject, setShowNewProject] = useState(false);
    const [newName, setNewName] = useState('');
    const [newPath, setNewPath] = useState('~/Projects');
    const [newDesc, setNewDesc] = useState('');
    const [newTech, setNewTech] = useState('');
    const [creating, setCreating] = useState(false);
    const [showOpenIn, setShowOpenIn] = useState(false);
    const [activeTab, setActiveTab] = useState<ProjectTab>('overview');

    const loadProjects = useCallback(async () => {
        if (!isElectron) return;
        const result = await window.onicode!.listProjects();
        setProjects(result.projects || []);
    }, []);

    useEffect(() => { loadProjects(); }, [loadProjects]);

    const selectProject = useCallback(async (project: Project) => {
        setSelectedProject(project);
        setViewingDoc(null);
        setShowOpenIn(false);
        setActiveTab('overview');
        if (isElectron) {
            const result = await window.onicode!.getProject(project.id);
            if (result.docs) setProjectDocs(result.docs);
            const dirResult = await window.onicode!.readDir(project.path, 3);
            if (dirResult.tree) setFileTree(dirResult.tree);
        }
    }, []);

    const createProject = useCallback(async () => {
        if (!newName.trim() || !isElectron) return;
        setCreating(true);
        const expandedPath = newPath.replace(/^~/, '');
        const result = await window.onicode!.initProject({
            name: newName,
            projectPath: newPath.startsWith('~') ? (process.env?.HOME || '/Users') + expandedPath : newPath,
            description: newDesc,
            techStack: newTech,
        });
        setCreating(false);
        if (result.success) {
            setShowNewProject(false);
            setNewName('');
            setNewDesc('');
            setNewTech('');
            await loadProjects();
            if (result.project) selectProject(result.project);
        }
    }, [newName, newPath, newDesc, newTech, loadProjects, selectProject]);

    const deleteProject = useCallback(async (id: string) => {
        if (!isElectron) return;
        await window.onicode!.deleteProject(id);
        if (selectedProject?.id === id) {
            setSelectedProject(null);
            setProjectDocs([]);
            setFileTree([]);
        }
        loadProjects();
    }, [selectedProject, loadProjects]);

    const openIn = useCallback(async (editor: string) => {
        if (!selectedProject || !isElectron) return;
        await window.onicode!.openProjectIn(selectedProject.path, editor);
        setShowOpenIn(false);
    }, [selectedProject]);

    const renderFileTree = (items: FileItem[], depth = 0) => (
        <div className="file-tree-level">
            {items.map((item) => (
                <div key={item.path}>
                    <div
                        className={`file-tree-item ${item.type}`}
                        style={{ paddingLeft: `${12 + depth * 16}px` }}
                        onClick={() => {
                            if (item.type === 'file' && item.name.endsWith('.md')) {
                                if (isElectron) {
                                    window.onicode!.readFile(item.path).then((res) => {
                                        if (res.content) setViewingDoc({ name: item.name, path: item.path, content: res.content });
                                    });
                                }
                            }
                        }}
                    >
                        {item.type === 'directory' ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                        ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                        )}
                        <span>{item.name}</span>
                    </div>
                    {item.children && item.children.length > 0 && renderFileTree(item.children, depth + 1)}
                </div>
            ))}
        </div>
    );

    if (!isElectron) {
        return <div className="welcome"><h2>Projects</h2><p>Projects require the Onicode desktop app.</p></div>;
    }

    return (
        <div className="projects-view">
            <div className="projects-sidebar">
                <div className="projects-sidebar-header">
                    <h3>Projects</h3>
                    <button className="projects-new-btn" onClick={() => setShowNewProject(true)} title="New project">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    </button>
                </div>

                {showNewProject && (
                    <div className="new-project-form">
                        <input className="field-input" placeholder="Project name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
                        <input className="field-input" placeholder="Path (~/Projects)" value={newPath} onChange={(e) => setNewPath(e.target.value)} />
                        <input className="field-input" placeholder="Description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
                        <input className="field-input" placeholder="Tech stack (optional)" value={newTech} onChange={(e) => setNewTech(e.target.value)} />
                        <div className="new-project-actions">
                            <button className="test-btn" onClick={createProject} disabled={!newName.trim() || creating}>{creating ? 'Creating...' : 'Create Project'}</button>
                            <button className="disconnect-btn" onClick={() => setShowNewProject(false)}>Cancel</button>
                        </div>
                    </div>
                )}

                <div className="projects-list">
                    {projects.length === 0 && !showNewProject && (
                        <div className="projects-empty"><p>No projects yet</p><span>Use the + button or <code>/init</code> in chat</span></div>
                    )}
                    {projects.map((p) => (
                        <div key={p.id} className={`project-card ${selectedProject?.id === p.id ? 'active' : ''}`} onClick={() => selectProject(p)}>
                            <div className="project-card-icon">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                            </div>
                            <div className="project-card-info">
                                <div className="project-card-name">{p.name}</div>
                                <div className="project-card-path">{p.path.replace(/^\/Users\/[^/]+/, '~')}</div>
                            </div>
                            <button className="project-delete-btn" onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }} title="Remove">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            <div className="project-detail">
                {!selectedProject ? (
                    <div className="welcome">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                        <h2>Select a Project</h2>
                        <p>Choose a project from the sidebar or create a new one.</p>
                    </div>
                ) : viewingDoc ? (
                    <div className="doc-viewer">
                        <div className="doc-viewer-header">
                            <button className="header-action-btn" onClick={() => setViewingDoc(null)} title="Back">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
                            </button>
                            <h3>{viewingDoc.name}</h3>
                        </div>
                        <div className="doc-viewer-content"><pre className="doc-markdown">{viewingDoc.content}</pre></div>
                    </div>
                ) : (
                    <div className="project-detail-content">
                        <div className="project-detail-header">
                            <div>
                                <h2>{selectedProject.name}</h2>
                                {selectedProject.description && <p className="project-desc">{selectedProject.description}</p>}
                                <div className="project-meta">
                                    <span>{selectedProject.path.replace(/^\/Users\/[^/]+/, '~')}</span>
                                    <span>Created {new Date(selectedProject.createdAt).toLocaleDateString()}</span>
                                </div>
                            </div>
                            <div className="project-actions">
                                <button className="test-btn project-work-btn" onClick={() => {
                                    window.dispatchEvent(new CustomEvent('onicode-project-activate', {
                                        detail: { id: selectedProject.id, name: selectedProject.name, path: selectedProject.path },
                                    }));
                                }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                                    Work on Project
                                </button>
                                <div className="open-in-group">
                                    <button className="test-btn" onClick={() => setShowOpenIn(!showOpenIn)}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                                        Open in...
                                    </button>
                                    {showOpenIn && (
                                        <div className="open-in-menu">
                                            {EDITORS.map((e) => (
                                                <button key={e.id} className="open-in-option" onClick={() => openIn(e.id)}>
                                                    <span className="open-in-icon">{e.icon}</span>{e.name}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="project-tabs">
                            {([
                                { key: 'overview' as ProjectTab, label: 'Overview', icon: '◈' },
                                { key: 'git' as ProjectTab, label: 'Git', icon: '⎇' },
                                { key: 'tasks' as ProjectTab, label: 'Tasks', icon: '☰' },
                                { key: 'milestones' as ProjectTab, label: 'Milestones', icon: '◎' },
                            ]).map(tab => (
                                <button key={tab.key} className={`project-tab ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>
                                    <span className="project-tab-icon">{tab.icon}</span> {tab.label}
                                </button>
                            ))}
                        </div>

                        {activeTab === 'overview' && (
                            <>
                                {projectDocs.length > 0 && (
                                    <div className="project-section">
                                        <h4>Documentation</h4>
                                        <div className="doc-cards">
                                            {projectDocs.map((doc) => (
                                                <div key={doc.name} className="doc-card" onClick={() => setViewingDoc(doc)}>
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                                    <span>{doc.name}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <div className="project-section">
                                    <h4>Files</h4>
                                    {fileTree.length > 0 ? (
                                        <div className="file-tree">{renderFileTree(fileTree)}</div>
                                    ) : (
                                        <p className="project-empty-hint">No files found</p>
                                    )}
                                </div>
                            </>
                        )}

                        {activeTab === 'git' && <GitTab projectPath={selectedProject.path} />}
                        {activeTab === 'tasks' && <TasksTab projectId={selectedProject.id} />}
                        {activeTab === 'milestones' && <MilestonesTab projectId={selectedProject.id} />}
                    </div>
                )}
            </div>
        </div>
    );
}
