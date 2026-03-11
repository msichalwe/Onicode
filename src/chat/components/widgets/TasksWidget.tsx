import React, { useState, useEffect, useCallback } from 'react';
import { isElectron } from '../../utils';

interface TaskEntry {
    id: number;
    content: string;
    status: string;
    priority: string;
    createdAt?: string;
    completedAt?: string | null;
}

function TasksWidget() {
    const [tasks, setTasks] = useState<TaskEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [done, setDone] = useState(0);
    const [inProgress, setInProgress] = useState(0);

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
        // Load tasks for the active project from SQLite
        try {
            const stored = localStorage.getItem('onicode-active-project');
            if (stored && window.onicode?.loadProjectTasks) {
                const proj = JSON.parse(stored);
                window.onicode.loadProjectTasks(proj.path).then((res) => {
                    if (res.success && res.summary) applyTaskSummary(res.summary as { total: number; done: number; inProgress: number; tasks: TaskEntry[] });
                });
            } else {
                loadTasks();
            }
        } catch {
            loadTasks();
        }

        // Listen for live updates
        if (!window.onicode?.onTasksUpdated) return;
        const unsub = window.onicode.onTasksUpdated((data) => {
            applyTaskSummary(data as { total: number; done: number; inProgress: number; tasks: TaskEntry[] });
        });

        // Reload when project changes
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
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

    const archiveCompleted = useCallback(async () => {
        if (!isElectron) return;
        await window.onicode!.archiveCompletedTasks();
        loadTasks();
    }, [loadTasks]);

    const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
    const pendingTasks = tasks.filter(t => t.status === 'pending');
    const doneTasks = tasks.filter(t => t.status === 'done');
    const skippedTasks = tasks.filter(t => t.status === 'skipped');

    if (total === 0) {
        return (
            <div className="widget-placeholder">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
                    <path d="M9 11l3 3L22 4" />
                    <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                </svg>
                <p>No tasks</p>
                <span>Tasks appear here when the AI creates them during work sessions</span>
            </div>
        );
    }

    return (
        <div className="widget-tasks">
            {/* Progress summary */}
            <div className="tasks-summary">
                <div className="tasks-summary-text">
                    <span className="tasks-summary-count">{done}/{total}</span> done
                    {inProgress > 0 && <span className="tasks-summary-active"> · {inProgress} active</span>}
                </div>
                <div className="tasks-progress-bar">
                    <div className="tasks-progress-fill" style={{ width: `${total > 0 ? Math.round((done / total) * 100) : 0}%` }} />
                </div>
            </div>

            <div className="tasks-list">
                {/* In Progress */}
                {inProgressTasks.length > 0 && (
                    <div className="task-section">
                        <div className="task-section-label">In Progress</div>
                        {inProgressTasks.map(t => (
                            <div key={t.id} className="task-item task-item-active">
                                <span className="task-item-icon task-icon-progress" />
                                <span className="task-item-text">{t.content}</span>
                                <span className={`task-item-priority priority-${t.priority}`}>{t.priority}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Pending */}
                {pendingTasks.length > 0 && (
                    <div className="task-section">
                        <div className="task-section-label">Pending</div>
                        {pendingTasks.map(t => (
                            <div key={t.id} className="task-item">
                                <span className="task-item-icon task-icon-pending" />
                                <span className="task-item-text">{t.content}</span>
                                <span className={`task-item-priority priority-${t.priority}`}>{t.priority}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Completed */}
                {doneTasks.length > 0 && (
                    <div className="task-section">
                        <div className="task-section-label">
                            Completed ({doneTasks.length})
                            <button className="task-archive-btn" onClick={archiveCompleted}>Archive all</button>
                        </div>
                        {doneTasks.map(t => (
                            <div key={t.id} className="task-item task-item-done">
                                <span className="task-item-icon task-icon-done" />
                                <span className="task-item-text">{t.content}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Skipped */}
                {skippedTasks.length > 0 && (
                    <div className="task-section">
                        <div className="task-section-label">Skipped</div>
                        {skippedTasks.map(t => (
                            <div key={t.id} className="task-item task-item-skipped">
                                <span className="task-item-icon task-icon-skipped" />
                                <span className="task-item-text">{t.content}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default TasksWidget;
