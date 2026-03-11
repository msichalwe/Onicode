import React, { useState, useEffect, useCallback } from 'react';
import { isElectron } from '../utils';

interface TaskEntry {
    id: number;
    content: string;
    status: string;
    priority: string;
    createdAt?: string;
    completedAt?: string | null;
}

/**
 * Unified Tasks View — replaces the old standalone TodoApp.
 * Backed by TaskManager + SQLite. Shows all tasks for the current session/project.
 * Users can create, update status, and delete tasks. AI-created and user-created
 * tasks live in the same system.
 */
export default function TasksView() {
    const [tasks, setTasks] = useState<TaskEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [done, setDone] = useState(0);
    const [inProgress, setInProgress] = useState(0);
    const [input, setInput] = useState('');
    const [priority, setPriority] = useState<string>('medium');
    const [filter, setFilter] = useState<string>('all');
    const [projectName, setProjectName] = useState<string | null>(null);

    const applyTaskSummary = useCallback((data: { total: number; done: number; inProgress: number; tasks: TaskEntry[] }) => {
        setTotal(data.total);
        setDone(data.done);
        setInProgress(data.inProgress);
        setTasks(data.tasks || []);
    }, []);

    const loadTasks = useCallback(async () => {
        if (!isElectron || !window.onicode?.tasksList) return;
        try {
            const summary = await window.onicode.tasksList();
            if (summary) applyTaskSummary(summary as { total: number; done: number; inProgress: number; tasks: TaskEntry[] });
        } catch { /* ignore */ }
    }, [applyTaskSummary]);

    useEffect(() => {
        // Check for active project
        try {
            const stored = localStorage.getItem('onicode-active-project');
            if (stored) {
                const proj = JSON.parse(stored);
                setProjectName(proj.name || null);
                if (window.onicode?.loadProjectTasks) {
                    window.onicode.loadProjectTasks(proj.path).then((res) => {
                        if (res.success && res.summary) applyTaskSummary(res.summary as { total: number; done: number; inProgress: number; tasks: TaskEntry[] });
                    });
                } else {
                    loadTasks();
                }
            } else {
                setProjectName(null);
                loadTasks();
            }
        } catch {
            loadTasks();
        }

        // Live updates
        if (!window.onicode?.onTasksUpdated) return;
        const unsub = window.onicode.onTasksUpdated((data) => {
            applyTaskSummary(data as { total: number; done: number; inProgress: number; tasks: TaskEntry[] });
        });

        // Listen for project switches
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.name) setProjectName(detail.name);
            if (detail?.path && window.onicode?.loadProjectTasks) {
                window.onicode.loadProjectTasks(detail.path).then((res) => {
                    if (res.success && res.summary) applyTaskSummary(res.summary as { total: number; done: number; inProgress: number; tasks: TaskEntry[] });
                });
            }
        };
        window.addEventListener('onicode-project-activate', handler);

        return () => {
            unsub?.();
            window.removeEventListener('onicode-project-activate', handler);
        };
    }, [loadTasks, applyTaskSummary]);

    const addTask = useCallback(async () => {
        const content = input.trim();
        if (!content || !isElectron) return;
        await window.onicode!.taskCreate(content, priority);
        setInput('');
    }, [input, priority]);

    const updateStatus = useCallback(async (id: number, status: string) => {
        if (!isElectron) return;
        await window.onicode!.taskUpdate(id, { status });
    }, []);

    const deleteTask = useCallback(async (id: number) => {
        if (!isElectron) return;
        await window.onicode!.taskDelete(id);
    }, []);

    const archiveCompleted = useCallback(async () => {
        if (!isElectron) return;
        await window.onicode!.archiveCompletedTasks();
        loadTasks();
    }, [loadTasks]);

    // Filter tasks
    const filteredTasks = filter === 'all'
        ? tasks
        : tasks.filter(t => t.status === filter);

    const inProgressTasks = filteredTasks.filter(t => t.status === 'in_progress');
    const pendingTasks = filteredTasks.filter(t => t.status === 'pending');
    const doneTasks = filteredTasks.filter(t => t.status === 'done');
    const skippedTasks = filteredTasks.filter(t => t.status === 'skipped');

    const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

    const statusActions = (task: TaskEntry) => {
        const s = task.status;
        return (
            <div className="task-status-actions">
                {s === 'pending' && (
                    <button className="task-action-btn task-action-start" onClick={() => updateStatus(task.id, 'in_progress')} title="Start">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                    </button>
                )}
                {s === 'in_progress' && (
                    <button className="task-action-btn task-action-done" onClick={() => updateStatus(task.id, 'done')} title="Complete">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    </button>
                )}
                {(s === 'pending' || s === 'in_progress') && (
                    <button className="task-action-btn task-action-skip" onClick={() => updateStatus(task.id, 'skipped')} title="Skip">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    </button>
                )}
                {(s === 'done' || s === 'skipped') && (
                    <button className="task-action-btn task-action-reopen" onClick={() => updateStatus(task.id, 'pending')} title="Reopen">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" /></svg>
                    </button>
                )}
                <button className="task-action-btn task-action-delete" onClick={() => deleteTask(task.id)} title="Delete">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
            </div>
        );
    };

    const renderTaskSection = (label: string, items: TaskEntry[], className: string) => {
        if (items.length === 0) return null;
        return (
            <div className="tasks-view-section">
                <div className="tasks-view-section-label">{label} ({items.length})</div>
                {items.map(t => (
                    <div key={t.id} className={`tasks-view-item ${className}`}>
                        <div className="tasks-view-item-left">
                            <span className={`task-item-icon task-icon-${t.status === 'in_progress' ? 'progress' : t.status}`} />
                            <span className="tasks-view-item-text">{t.content}</span>
                        </div>
                        <div className="tasks-view-item-right">
                            <span className={`task-item-priority priority-${t.priority}`}>{t.priority}</span>
                            {statusActions(t)}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="tasks-view">
            <div className="tasks-view-header">
                <div>
                    <h2>Tasks</h2>
                    {projectName && <span className="tasks-view-project">Project: {projectName}</span>}
                </div>
                {doneTasks.length > 0 && (
                    <button className="task-archive-btn" onClick={archiveCompleted}>Archive completed</button>
                )}
            </div>

            {/* Progress bar */}
            {total > 0 && (
                <div className="tasks-view-progress">
                    <div className="tasks-summary-text">
                        <span className="tasks-summary-count">{done}/{total}</span> completed
                        {inProgress > 0 && <span className="tasks-summary-active"> · {inProgress} active</span>}
                        <span className="tasks-summary-pct">{progressPct}%</span>
                    </div>
                    <div className="tasks-progress-bar">
                        <div className="tasks-progress-fill" style={{ width: `${progressPct}%` }} />
                    </div>
                </div>
            )}

            {/* Add task form */}
            <div className="tasks-view-add">
                <input
                    className="tasks-view-input"
                    placeholder="Add a task..."
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addTask(); }}
                />
                <select className="tasks-view-priority" value={priority} onChange={e => setPriority(e.target.value)} title="Priority">
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                </select>
                <button className="test-btn" onClick={addTask} disabled={!input.trim()}>Add</button>
            </div>

            {/* Filter tabs */}
            <div className="tasks-view-filters">
                {[
                    { key: 'all', label: 'All' },
                    { key: 'pending', label: 'Pending' },
                    { key: 'in_progress', label: 'Active' },
                    { key: 'done', label: 'Done' },
                    { key: 'skipped', label: 'Skipped' },
                ].map(f => (
                    <button
                        key={f.key}
                        className={`tasks-view-filter ${filter === f.key ? 'active' : ''}`}
                        onClick={() => setFilter(f.key)}
                    >
                        {f.label}
                        {f.key !== 'all' && (
                            <span className="tasks-view-filter-count">
                                {tasks.filter(t => t.status === f.key).length}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Task list */}
            <div className="tasks-view-body">
                {renderTaskSection('In Progress', inProgressTasks, 'task-active')}
                {renderTaskSection('Pending', pendingTasks, 'task-pending')}
                {renderTaskSection('Completed', doneTasks, 'task-done')}
                {renderTaskSection('Skipped', skippedTasks, 'task-skipped')}

                {total === 0 && (
                    <div className="tasks-view-empty">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5">
                            <path d="M9 11l3 3L22 4" />
                            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                        </svg>
                        <p>No tasks yet</p>
                        <span>Add tasks manually above, or let the AI create them during work sessions.</span>
                    </div>
                )}
            </div>
        </div>
    );
}
