import React, { useState, useEffect, useCallback, useRef } from 'react';
import { isElectron } from '../../utils';

// ══════════════════════════════════════════
//  Local types
// ══════════════════════════════════════════

interface ActiveRun {
    runId: string;
    workflowId: string;
    workflowName: string;
    currentStep: number;
    totalSteps: number;
    currentStepName: string;
    agentRound?: number;
    agentMaxRounds?: number;
    agentStatus?: string;
    lastToolName?: string;
    lastToolStatus?: string;
}

interface RecentRun {
    runId: string;
    workflowName: string;
    status: 'completed' | 'failed';
    duration: number;
    completedAt: number;
}

interface HeartbeatState {
    enabled: boolean;
    lastBeatAt: number | null;
    intervalMinutes: number;
    nextBeatAt: number | null;
}

// ══════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════

function relativeTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 0) return 'now';
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    return `${d}d ago`;
}

function timeUntil(ts: number): string {
    const diff = ts - Date.now();
    if (diff <= 0) return 'now';
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ${min % 60}m`;
    const d = Math.floor(hr / 24);
    return `${d}d`;
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    return `${min}m${remSec > 0 ? ` ${remSec}s` : ''}`;
}

// ══════════════════════════════════════════
//  WorkflowWidget
// ══════════════════════════════════════════

function WorkflowWidget() {
    const [activeRuns, setActiveRuns] = useState<ActiveRun[]>([]);
    const [schedules, setSchedules] = useState<ScheduleDef[]>([]);
    const [heartbeat, setHeartbeat] = useState<HeartbeatState | null>(null);
    const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);
    const [loading, setLoading] = useState(true);
    const tickRef = useRef(0);

    // Force re-render every 30s to keep relative times fresh
    const [, setTick] = useState(0);
    useEffect(() => {
        const iv = setInterval(() => setTick(t => t + 1), 30_000);
        return () => clearInterval(iv);
    }, []);

    // ── Initial data load ──────────────────
    const loadData = useCallback(async () => {
        if (!isElectron || !window.onicode) return;
        try {
            const [schedRes, hbRes, runsRes] = await Promise.all([
                window.onicode.schedulerList?.() ?? { success: false },
                window.onicode.heartbeatConfig?.() ?? { success: false },
                window.onicode.workflowAllRuns?.(10) ?? { success: false },
            ]);

            if (schedRes.success && schedRes.schedules) {
                setSchedules(schedRes.schedules.filter(s => s.enabled));
            }
            if (hbRes.success && hbRes.config) {
                const cfg = hbRes.config;
                const nextBeat = cfg.last_beat_at
                    ? cfg.last_beat_at + cfg.interval_minutes * 60_000
                    : null;
                setHeartbeat({
                    enabled: cfg.enabled,
                    lastBeatAt: cfg.last_beat_at,
                    intervalMinutes: cfg.interval_minutes,
                    nextBeatAt: nextBeat,
                });
            }
            if (runsRes.success && runsRes.runs) {
                const running = runsRes.runs
                    .filter(r => r.status === 'running')
                    .map(r => ({
                        runId: r.id,
                        workflowId: r.workflow_id || '',
                        workflowName: (r as unknown as Record<string, unknown>).workflow_name as string || r.workflow_id || 'Workflow',
                        currentStep: r.current_step,
                        totalSteps: r.steps_total,
                        currentStepName: '',
                    }));
                setActiveRuns(running);

                const finished: RecentRun[] = runsRes.runs
                    .filter(r => r.status === 'completed' || r.status === 'failed')
                    .slice(0, 5)
                    .map(r => ({
                        runId: r.id,
                        workflowName: (r as unknown as Record<string, unknown>).workflow_name as string || r.workflow_id || 'Workflow',
                        status: r.status as 'completed' | 'failed',
                        duration: r.duration_ms || 0,
                        completedAt: r.completed_at || r.started_at || 0,
                    }));
                setRecentRuns(finished);
            }
        } catch { /* ignore */ }
        setLoading(false);
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // ── IPC event subscriptions ────────────
    useEffect(() => {
        if (!isElectron || !window.onicode) return;
        const unsubs: Array<(() => void) | undefined> = [];

        // Run started
        unsubs.push(window.onicode.onWorkflowRunStarted?.((data) => {
            setActiveRuns(prev => {
                if (prev.find(r => r.runId === data.runId)) return prev;
                return [...prev, {
                    runId: data.runId,
                    workflowId: data.workflowId,
                    workflowName: data.workflowName,
                    currentStep: 0,
                    totalSteps: 0,
                    currentStepName: 'Starting...',
                }];
            });
        }));

        // Run completed
        unsubs.push(window.onicode.onWorkflowRunCompleted?.((data) => {
            setActiveRuns(prev => prev.filter(r => r.runId !== data.runId));
            setRecentRuns(prev => {
                const entry: RecentRun = {
                    runId: data.runId,
                    workflowName: data.workflowName,
                    status: data.status as 'completed' | 'failed',
                    duration: data.duration,
                    completedAt: Date.now(),
                };
                return [entry, ...prev].slice(0, 5);
            });
        }));

        // Step started
        unsubs.push(window.onicode.onWorkflowStepStarted?.((data) => {
            setActiveRuns(prev => prev.map(r => {
                if (r.runId !== data.runId) return r;
                return {
                    ...r,
                    currentStep: data.stepIndex + 1,
                    totalSteps: data.total,
                    currentStepName: data.stepName || `Step ${data.stepIndex + 1}`,
                };
            }));
        }));

        // Step completed
        unsubs.push(window.onicode.onWorkflowStepCompleted?.((data) => {
            setActiveRuns(prev => prev.map(r => {
                if (r.runId !== data.runId) return r;
                return { ...r, totalSteps: data.total };
            }));
        }));

        // Scheduler status (schedule fired / run status)
        unsubs.push(window.onicode.onSchedulerStatus?.(() => {
            // Refresh schedules to get updated last_run_at / next_run_at
            window.onicode?.schedulerList?.().then(res => {
                if (res.success && res.schedules) {
                    setSchedules(res.schedules.filter(s => s.enabled));
                }
            });
        }));

        // Agent round updates (agentic workflow steps)
        unsubs.push(window.onicode.onWorkflowAgentRound?.((data) => {
            setActiveRuns(prev => prev.map(r => ({
                ...r,
                currentStepName: data.stepName || r.currentStepName,
                agentRound: data.round,
                agentMaxRounds: data.maxRounds,
                agentStatus: data.status,
            })));
        }));

        // Agent tool calls (agentic workflow steps)
        unsubs.push(window.onicode.onWorkflowAgentTool?.((data) => {
            setActiveRuns(prev => prev.map(r => ({
                ...r,
                lastToolName: data.toolName,
                lastToolStatus: data.status,
            })));
        }));

        // Heartbeat tick
        unsubs.push(window.onicode.onHeartbeatTick?.((data) => {
            tickRef.current++;
            setHeartbeat(prev => {
                if (!prev) return prev;
                const nextBeat = data.timestamp + prev.intervalMinutes * 60_000;
                return { ...prev, lastBeatAt: data.timestamp, nextBeatAt: nextBeat };
            });
        }));

        return () => { unsubs.forEach(fn => fn?.()); };
    }, []);

    // ── Render ─────────────────────────────

    if (loading) {
        return (
            <div className="ww-container">
                <div className="ww-loading">Loading...</div>
            </div>
        );
    }

    const isEmpty = activeRuns.length === 0
        && schedules.length === 0
        && !heartbeat
        && recentRuns.length === 0;

    if (isEmpty) {
        return (
            <div className="widget-placeholder">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
                <p>No workflows</p>
                <span>Create workflows and schedules to see status here</span>
            </div>
        );
    }

    const upcomingSchedules = [...schedules]
        .filter(s => s.next_run_at)
        .sort((a, b) => (a.next_run_at || 0) - (b.next_run_at || 0))
        .slice(0, 3);

    return (
        <div className="ww-container">

            {/* ── Active Runs ── */}
            {activeRuns.length > 0 && (
                <div className="ww-section">
                    <div className="ww-section-label">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                        Active Runs
                    </div>
                    {activeRuns.map(run => (
                        <div key={run.runId} className="ww-active-run">
                            <div className="ww-run-header">
                                <span className="ww-pulse-dot" />
                                <span className="ww-run-name">{run.workflowName}</span>
                                {run.totalSteps > 0 && (
                                    <span className="ww-run-step">{run.currentStep}/{run.totalSteps}</span>
                                )}
                            </div>
                            {run.totalSteps > 0 && (
                                <div className="ww-progress-bar">
                                    <div
                                        className="ww-progress-fill"
                                        style={{ width: `${Math.round((run.currentStep / run.totalSteps) * 100)}%` }}
                                    />
                                </div>
                            )}
                            {run.currentStepName && (
                                <div className="ww-step-name">{run.currentStepName}</div>
                            )}
                            {run.agentRound != null && (
                                <div className="ww-agent-info">
                                    <span className="ww-agent-round">Round {run.agentRound}/{run.agentMaxRounds || '?'}</span>
                                    {run.lastToolName && (
                                        <span className="ww-agent-tool">
                                            {run.lastToolStatus === 'running' && <span className="ww-mini-spinner" />}
                                            {run.lastToolName}
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* ── Upcoming Schedules ── */}
            {upcomingSchedules.length > 0 && (
                <div className="ww-section">
                    <div className="ww-section-label">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                        </svg>
                        Upcoming
                    </div>
                    {upcomingSchedules.map(sched => (
                        <div key={sched.id} className="ww-schedule-row">
                            <span className="ww-schedule-name">{sched.name}</span>
                            <span className="ww-schedule-time">
                                in {timeUntil(sched.next_run_at!)}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Heartbeat Status ── */}
            {heartbeat && (
                <div className="ww-section">
                    <div className="ww-section-label">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                        </svg>
                        Heartbeat
                    </div>
                    <div className="ww-heartbeat-row">
                        <span className={`ww-hb-dot ${heartbeat.enabled ? 'ww-hb-on' : 'ww-hb-off'}`} />
                        <span className="ww-hb-status">
                            {heartbeat.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                        {heartbeat.enabled && heartbeat.lastBeatAt && (
                            <span className="ww-hb-detail">
                                last {relativeTime(heartbeat.lastBeatAt)}
                            </span>
                        )}
                        {heartbeat.enabled && heartbeat.nextBeatAt && heartbeat.nextBeatAt > Date.now() && (
                            <span className="ww-hb-detail">
                                next in {timeUntil(heartbeat.nextBeatAt)}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* ── Recent Activity ── */}
            {recentRuns.length > 0 && (
                <div className="ww-section">
                    <div className="ww-section-label">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="1 4 1 10 7 10" />
                            <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
                        </svg>
                        Recent
                    </div>
                    {recentRuns.map(run => (
                        <div key={run.runId} className="ww-recent-row">
                            <span className={`ww-status-dot ${run.status === 'completed' ? 'ww-dot-ok' : 'ww-dot-err'}`} />
                            <span className="ww-recent-name">{run.workflowName}</span>
                            <span className="ww-recent-dur">{formatDuration(run.duration)}</span>
                            <span className="ww-recent-time">{relativeTime(run.completedAt)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default WorkflowWidget;
