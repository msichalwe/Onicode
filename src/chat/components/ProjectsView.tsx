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

type ProjectTab = 'overview' | 'git' | 'tasks' | 'milestones';

const EDITORS = [
    { id: 'vscode', name: 'VS Code', icon: 'VS' },
    { id: 'cursor', name: 'Cursor', icon: 'Cu' },
    { id: 'windsurf', name: 'Windsurf', icon: 'Ws' },
    { id: 'finder', name: 'Finder', icon: 'Fi' },
];

function generateId() { return Math.random().toString(36).substring(2, 10); }

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
//  Tasks Tab — Unified TaskManager-backed
// ══════════════════════════════════════════

interface UnifiedTask {
    id: number;
    content: string;
    status: string;
    priority: string;
    createdAt?: string;
    completedAt?: string | null;
}

function TasksTab({ projectId, projectPath }: { projectId: string; projectPath: string }) {
    const [tasks, setTasks] = useState<UnifiedTask[]>([]);
    const [total, setTotal] = useState(0);
    const [done, setDone] = useState(0);
    const [inProgress, setInProgress] = useState(0);
    const [showForm, setShowForm] = useState(false);
    const [formTitle, setFormTitle] = useState('');
    const [formPriority, setFormPriority] = useState<string>('medium');

    const applyTaskSummary = useCallback((data: { total: number; done: number; inProgress: number; tasks: UnifiedTask[] }) => {
        setTotal(data.total);
        setDone(data.done);
        setInProgress(data.inProgress);
        setTasks(data.tasks || []);
    }, []);

    // Load project tasks on mount + subscribe to real-time updates
    useEffect(() => {
        if (!isElectron) return;

        // Load tasks for this specific project
        if (window.onicode?.loadProjectTasks) {
            window.onicode.loadProjectTasks(projectPath).then((res) => {
                if (res.success && res.summary) {
                    applyTaskSummary(res.summary as { total: number; done: number; inProgress: number; tasks: UnifiedTask[] });
                }
            }).catch(() => {});
        }

        // Subscribe to real-time updates from TaskManager
        const cleanup = window.onicode!.onTasksUpdated((summary) => {
            applyTaskSummary(summary as { total: number; done: number; inProgress: number; tasks: UnifiedTask[] });
        });
        return cleanup;
    }, [projectId, projectPath, applyTaskSummary]);

    const addTask = async () => {
        if (!formTitle.trim() || !isElectron) return;
        await window.onicode!.taskCreate(formTitle.trim(), formPriority);
        setFormTitle('');
        setShowForm(false);
    };

    const updateStatus = async (id: number, status: string) => {
        if (!isElectron) return;
        await window.onicode!.taskUpdate(id, { status });
    };

    const deleteTask = async (id: number) => {
        if (!isElectron) return;
        await window.onicode!.taskDelete(id);
    };

    const archiveCompleted = async () => {
        if (!isElectron) return;
        await window.onicode!.archiveCompletedTasks();
        // Reload from project
        if (window.onicode?.loadProjectTasks) {
            const res = await window.onicode.loadProjectTasks(projectPath);
            if (res.success && res.summary) {
                applyTaskSummary(res.summary as { total: number; done: number; inProgress: number; tasks: UnifiedTask[] });
            }
        }
    };

    const priorityColor = (p: string) => {
        const c: Record<string, string> = { high: 'var(--warning)', medium: 'var(--accent)', low: 'var(--text-tertiary)' };
        return c[p] || 'var(--text-secondary)';
    };

    const statusIcon = (s: string) => {
        if (s === 'in_progress') return <span className="task-item-icon task-icon-progress" />;
        if (s === 'done') return <span className="task-item-icon task-icon-done" />;
        if (s === 'skipped') return <span className="task-item-icon task-icon-skipped" />;
        return <span className="task-item-icon task-icon-pending" />;
    };

    const nextStatusBtn = (task: UnifiedTask) => {
        if (task.status === 'pending') {
            return <button className="task-action-btn task-action-start" onClick={() => updateStatus(task.id, 'in_progress')} title="Start">Start</button>;
        }
        if (task.status === 'in_progress') {
            return <button className="task-action-btn task-action-done" onClick={() => updateStatus(task.id, 'done')} title="Done">Done</button>;
        }
        if (task.status === 'done' || task.status === 'skipped') {
            return <button className="task-action-btn task-action-reopen" onClick={() => updateStatus(task.id, 'pending')} title="Reopen">Reopen</button>;
        }
        return null;
    };

    const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

    const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
    const pendingTasks = tasks.filter(t => t.status === 'pending');
    const doneTasks = tasks.filter(t => t.status === 'done');
    const skippedTasks = tasks.filter(t => t.status === 'skipped');

    return (
        <div className="tasks-tab">
            <div className="tasks-header">
                <div className="tasks-header-left">
                    <span>{total} tasks</span>
                    {total > 0 && <span className="tasks-header-pct">{progressPct}% done</span>}
                </div>
                <div className="tasks-header-actions">
                    {doneTasks.length > 0 && <button className="task-archive-btn" onClick={archiveCompleted}>Archive</button>}
                    <button className="test-btn" onClick={() => setShowForm(!showForm)}>+ New</button>
                </div>
            </div>

            {/* Progress bar */}
            {total > 0 && (
                <div className="tasks-progress-bar" style={{ marginBottom: 12 }}>
                    <div className="tasks-progress-fill" style={{ width: `${progressPct}%` }} />
                </div>
            )}

            {showForm && (
                <div className="task-form">
                    <input className="git-commit-input" placeholder="Task description..." value={formTitle} onChange={e => setFormTitle(e.target.value)} autoFocus
                        onKeyDown={e => { if (e.key === 'Enter') addTask(); }}
                    />
                    <div className="task-form-row">
                        <select className="task-select" value={formPriority} onChange={e => setFormPriority(e.target.value)} title="Priority">
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                        </select>
                        <button className="test-btn" onClick={addTask} disabled={!formTitle.trim()}>Add</button>
                        <button className="disconnect-btn" onClick={() => setShowForm(false)}>Cancel</button>
                    </div>
                </div>
            )}

            <div className="tasks-tab-list">
                {/* In Progress */}
                {inProgressTasks.length > 0 && (
                    <div className="task-section">
                        <div className="task-section-label">In Progress ({inProgressTasks.length})</div>
                        {inProgressTasks.map(t => (
                            <div key={t.id} className="task-item task-item-active">
                                {statusIcon(t.status)}
                                <span className="task-item-text">{t.content}</span>
                                <span className="kanban-priority-dot" style={{ background: priorityColor(t.priority) }} title={t.priority} />
                                {nextStatusBtn(t)}
                                <button className="kanban-delete" onClick={() => deleteTask(t.id)} title="Delete">x</button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Pending */}
                {pendingTasks.length > 0 && (
                    <div className="task-section">
                        <div className="task-section-label">Pending ({pendingTasks.length})</div>
                        {pendingTasks.map(t => (
                            <div key={t.id} className="task-item">
                                {statusIcon(t.status)}
                                <span className="task-item-text">{t.content}</span>
                                <span className="kanban-priority-dot" style={{ background: priorityColor(t.priority) }} title={t.priority} />
                                {nextStatusBtn(t)}
                                <button className="kanban-delete" onClick={() => deleteTask(t.id)} title="Delete">x</button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Completed */}
                {doneTasks.length > 0 && (
                    <div className="task-section">
                        <div className="task-section-label">Completed ({doneTasks.length})</div>
                        {doneTasks.map(t => (
                            <div key={t.id} className="task-item task-item-done">
                                {statusIcon(t.status)}
                                <span className="task-item-text">{t.content}</span>
                                {nextStatusBtn(t)}
                            </div>
                        ))}
                    </div>
                )}

                {/* Skipped */}
                {skippedTasks.length > 0 && (
                    <div className="task-section">
                        <div className="task-section-label">Skipped ({skippedTasks.length})</div>
                        {skippedTasks.map(t => (
                            <div key={t.id} className="task-item task-item-skipped">
                                {statusIcon(t.status)}
                                <span className="task-item-text">{t.content}</span>
                                {nextStatusBtn(t)}
                            </div>
                        ))}
                    </div>
                )}

                {total === 0 && (
                    <div className="git-empty">
                        No tasks yet. Add tasks manually or let the AI agent create them.
                    </div>
                )}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  Milestones Tab — SQLite-backed, linked to tasks
// ══════════════════════════════════════════

interface MilestoneEntry {
    id: string;
    title: string;
    description: string;
    status: string;
    dueDate: number | null;
    due_date?: number | null;
    created_at?: number;
    createdAt: number;
    taskCount: number;
    tasksDone: number;
    tasksInProgress: number;
}

function MilestonesTab({ projectId, projectPath }: { projectId: string; projectPath: string }) {
    const [milestones, setMilestones] = useState<MilestoneEntry[]>([]);
    const [showForm, setShowForm] = useState(false);
    const [formTitle, setFormTitle] = useState('');
    const [formDesc, setFormDesc] = useState('');
    const [formDue, setFormDue] = useState('');

    const loadMilestones = useCallback(async () => {
        if (!isElectron || !window.onicode?.milestoneList) return;
        const res = await window.onicode.milestoneList(projectPath);
        if (res.success && res.milestones) {
            setMilestones(res.milestones.map(ms => ({
                ...ms,
                dueDate: ms.due_date ?? ms.dueDate ?? null,
                createdAt: ms.created_at ?? ms.createdAt ?? Date.now(),
                taskCount: ms.taskCount ?? 0,
                tasksDone: ms.tasksDone ?? 0,
                tasksInProgress: ms.tasksInProgress ?? 0,
            })));
        }
    }, [projectPath]);

    useEffect(() => { loadMilestones(); }, [loadMilestones]);

    // Refresh milestones when tasks change (progress may update)
    useEffect(() => {
        if (!isElectron || !window.onicode?.onTasksUpdated) return;
        const cleanup = window.onicode.onTasksUpdated(() => { loadMilestones(); });
        return cleanup;
    }, [loadMilestones]);

    const addMilestone = async () => {
        if (!formTitle.trim() || !isElectron) return;
        const ms = {
            id: generateId(),
            title: formTitle.trim(),
            description: formDesc.trim(),
            dueDate: formDue ? new Date(formDue).getTime() : null,
            status: 'open',
            createdAt: Date.now(),
        };
        await window.onicode!.milestoneCreate(ms, projectId, projectPath);
        setFormTitle(''); setFormDesc(''); setFormDue(''); setShowForm(false);
        loadMilestones();
    };

    const toggleStatus = async (id: string, current: string) => {
        if (!isElectron) return;
        await window.onicode!.milestoneUpdate(id, { status: current === 'open' ? 'closed' : 'open' });
        loadMilestones();
    };

    const deleteMilestone = async (id: string) => {
        if (!isElectron) return;
        await window.onicode!.milestoneDelete(id);
        loadMilestones();
    };

    const totalTasks = milestones.reduce((sum, m) => sum + m.taskCount, 0);
    const doneTasks = milestones.reduce((sum, m) => sum + m.tasksDone, 0);
    const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

    return (
        <div className="milestones-tab">
            <div className="milestones-header">
                <div className="milestones-summary">
                    <span>{milestones.filter(m => m.status === 'open').length} open</span>
                    <span>{milestones.filter(m => m.status === 'closed').length} closed</span>
                    {totalTasks > 0 && <span className="milestones-progress">Tasks: {progress}% ({doneTasks}/{totalTasks})</span>}
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
                {milestones.map(ms => {
                    const msPct = ms.taskCount > 0 ? Math.round((ms.tasksDone / ms.taskCount) * 100) : 0;
                    return (
                        <div key={ms.id} className={`milestone-card ${ms.status}`}>
                            <div className="milestone-card-left">
                                <button className={`milestone-check ${ms.status}`} onClick={() => toggleStatus(ms.id, ms.status)}>
                                    {ms.status === 'closed' ? '✓' : '○'}
                                </button>
                                <div style={{ flex: 1 }}>
                                    <div className="milestone-title">{ms.title}</div>
                                    {ms.description && <div className="milestone-desc">{ms.description}</div>}
                                    {ms.taskCount > 0 && (
                                        <div className="milestone-task-progress">
                                            <div className="tasks-progress-bar" style={{ height: 4 }}>
                                                <div className="tasks-progress-fill" style={{ width: `${msPct}%` }} />
                                            </div>
                                            <span className="milestone-task-count">{ms.tasksDone}/{ms.taskCount} tasks</span>
                                        </div>
                                    )}
                                    <div className="milestone-meta">
                                        {ms.dueDate && <span>Due: {new Date(ms.dueDate).toLocaleDateString()}</span>}
                                        <span>Created {new Date(ms.createdAt).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            </div>
                            <button className="kanban-delete" onClick={() => deleteMilestone(ms.id)}>x</button>
                        </div>
                    );
                })}
                {milestones.length === 0 && (
                    <div className="git-empty">No milestones yet. Create milestones to organize tasks into phases.</div>
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
                        {activeTab === 'tasks' && <TasksTab projectId={selectedProject.id} projectPath={selectedProject.path} />}
                        {activeTab === 'milestones' && <MilestonesTab projectId={selectedProject.id} projectPath={selectedProject.path} />}
                    </div>
                )}
            </div>
        </div>
    );
}
