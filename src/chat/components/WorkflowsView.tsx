import React, { useState, useEffect, useCallback } from 'react';
import { isElectron, generateId } from '../utils';

// ══════════════════════════════════════════
//  Tab Definitions
// ══════════════════════════════════════════

type WVTab = 'workflows' | 'schedules' | 'heartbeat';

const TABS: { id: WVTab; label: string }[] = [
    { id: 'workflows', label: 'Workflows' },
    { id: 'schedules', label: 'Schedules' },
    { id: 'heartbeat', label: 'Heartbeat' },
];

// ══════════════════════════════════════════
//  Step type options
// ══════════════════════════════════════════

const STEP_TYPES: WorkflowStep['type'][] = ['ai_prompt', 'command', 'tool_call', 'condition', 'notify', 'wait', 'webhook'];

const STEP_TYPE_LABELS: Record<WorkflowStep['type'], string> = {
    ai_prompt: 'AI Prompt',
    command: 'Command',
    tool_call: 'Tool Call',
    condition: 'Condition',
    notify: 'Notify',
    wait: 'Wait',
    webhook: 'Webhook',
};

// ══════════════════════════════════════════
//  Cron helpers
// ══════════════════════════════════════════

const CRON_EXAMPLES: { label: string; cron: string }[] = [
    { label: 'Every minute', cron: '* * * * *' },
    { label: 'Every 5 minutes', cron: '*/5 * * * *' },
    { label: 'Every hour', cron: '0 * * * *' },
    { label: 'Every day at 9am', cron: '0 9 * * *' },
    { label: 'Every Monday at 9am', cron: '0 9 * * 1' },
    { label: 'Every 1st of month', cron: '0 0 1 * *' },
];

function describeCron(expr: string): string {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return expr;
    const [min, hour, dom, mon, dow] = parts;

    if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every minute';
    if (min?.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `Every ${min.slice(2)} minutes`;
    if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every hour';
    if (min === '0' && hour !== '*' && dom === '*' && mon === '*' && dow === '*') return `Daily at ${hour}:00`;
    if (min === '0' && hour !== '*' && dom === '*' && mon === '*' && dow !== '*') {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const d = days[Number(dow)] || dow;
        return `${d} at ${hour}:00`;
    }
    if (min === '0' && hour === '0' && dom === '1' && mon === '*' && dow === '*') return '1st of every month at midnight';
    return expr;
}

function formatTime(ts: number | null): string {
    if (!ts) return '--';
    return new Date(ts).toLocaleString();
}

function formatDuration(ms: number | null): string {
    if (!ms) return '--';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
}

function isOneTimeSchedule(sch: ScheduleDef): boolean {
    try {
        const action = typeof sch.action === 'string' ? JSON.parse(sch.action) : sch.action;
        return !!action?.one_time;
    } catch { return false; }
}

// ══════════════════════════════════════════
//  Inline SVG Icons
// ══════════════════════════════════════════

function PlayIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
    );
}

function ChevronIcon({ open }: { open: boolean }) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
            <polyline points="9 18 15 12 9 6" />
        </svg>
    );
}

function PlusIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    );
}

function PauseIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
        </svg>
    );
}

function HeartIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
    );
}

// ══════════════════════════════════════════
//  Status dot helper
// ══════════════════════════════════════════

function StatusDot({ status }: { status: string }) {
    const color =
        status === 'completed' ? 'var(--success, #22c55e)' :
        status === 'running' ? 'var(--accent)' :
        status === 'failed' ? 'var(--error, #ef4444)' :
        'var(--text-tertiary)';
    return <span className="wv-status-dot" style={{ background: color }} />;
}

// ══════════════════════════════════════════
//  Empty step factory
// ══════════════════════════════════════════

function emptyStep(): WorkflowStep {
    return { name: '', type: 'command', command: '' };
}

// ══════════════════════════════════════════
//  Component
// ══════════════════════════════════════════

export default function WorkflowsView({ isVisible = true }: { isVisible?: boolean }) {
    console.log('[WorkflowsView] render, isElectron:', isElectron);
    const [activeTab, setActiveTab] = useState<WVTab>('workflows');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // ── Workflows state ──
    const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
    const [workflowRuns, setWorkflowRuns] = useState<Record<string, WorkflowRunSummary[]>>({});
    const [expandedWorkflow, setExpandedWorkflow] = useState<string | null>(null);
    const [runningWorkflow, setRunningWorkflow] = useState<string | null>(null);
    const [showCreateWorkflow, setShowCreateWorkflow] = useState(false);
    const [newWfName, setNewWfName] = useState('');
    const [newWfDesc, setNewWfDesc] = useState('');
    const [newWfTags, setNewWfTags] = useState('');
    const [newWfSteps, setNewWfSteps] = useState<WorkflowStep[]>([emptyStep()]);
    const [creatingWorkflow, setCreatingWorkflow] = useState(false);

    // ── Schedules state ──
    const [schedules, setSchedules] = useState<ScheduleDef[]>([]);
    const [showCreateSchedule, setShowCreateSchedule] = useState(false);
    const [newSchName, setNewSchName] = useState('');
    const [newSchCron, setNewSchCron] = useState('0 * * * *');
    const [newSchActionType, setNewSchActionType] = useState<'ai_prompt' | 'workflow' | 'command'>('ai_prompt');
    const [newSchPayload, setNewSchPayload] = useState('');
    const [newSchWorkflowId, setNewSchWorkflowId] = useState('');
    const [newSchOneTime, setNewSchOneTime] = useState(false);
    const [creatingSchedule, setCreatingSchedule] = useState(false);

    // ── Heartbeat state ──
    const [hbConfig, setHbConfig] = useState<HeartbeatConfig | null>(null);
    const [showAddCheck, setShowAddCheck] = useState(false);
    const [newCheckName, setNewCheckName] = useState('');
    const [newCheckType, setNewCheckType] = useState<HeartbeatCheck['type']>('ai_eval');
    const [newCheckPrompt, setNewCheckPrompt] = useState('');
    const [newCheckCommand, setNewCheckCommand] = useState('');
    const [newCheckWorkflowId, setNewCheckWorkflowId] = useState('');
    const [triggeringHeartbeat, setTriggeringHeartbeat] = useState(false);
    const [hbUpdating, setHbUpdating] = useState(false);

    // ── Queue status ──
    const [queueStatus, setQueueStatus] = useState<{ running: number; queued: number; maxConcurrent: number } | null>(null);

    // Listen for queue updates
    useEffect(() => {
        if (!isElectron || !window.onicode?.onWorkflowQueueUpdated) return;
        // Load initial status
        window.onicode.workflowQueueStatus?.().then(res => {
            if (res.success) setQueueStatus({ running: res.running, queued: res.queued, maxConcurrent: res.maxConcurrent });
        }).catch(() => {});
        const unsub = window.onicode.onWorkflowQueueUpdated((data) => {
            setQueueStatus({ running: data.running, queued: data.queued, maxConcurrent: data.maxConcurrent });
        });
        return unsub;
    }, []);

    // ══════════════════════════════════════════
    //  Data Loaders
    // ══════════════════════════════════════════

    const loadWorkflows = useCallback(async () => {
        if (!isElectron) return;
        try {
            const res = await window.onicode!.workflowList();
            if (res.success && res.workflows) {
                setWorkflows(res.workflows);
                // Load recent runs for each
                const runsMap: Record<string, WorkflowRunSummary[]> = {};
                await Promise.all(res.workflows.map(async (wf) => {
                    try {
                        const runsRes = await window.onicode!.workflowRuns(wf.id, 3);
                        if (runsRes.success && runsRes.runs) {
                            runsMap[wf.id] = runsRes.runs;
                        }
                    } catch { /* ignore individual run load failures */ }
                }));
                setWorkflowRuns(runsMap);
            }
        } catch (err) {
            setError((err as Error).message);
        }
    }, []);

    const loadSchedules = useCallback(async () => {
        if (!isElectron) return;
        try {
            const res = await window.onicode!.schedulerList();
            if (res.success && res.schedules) {
                setSchedules(res.schedules);
            }
        } catch (err) {
            setError((err as Error).message);
        }
    }, []);

    const loadHeartbeat = useCallback(async () => {
        if (!isElectron) return;
        try {
            const res = await window.onicode!.heartbeatConfig();
            if (res.success && res.config) {
                setHbConfig(res.config);
            }
        } catch (err) {
            setError((err as Error).message);
        }
    }, []);

    const loadAll = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            await Promise.allSettled([loadWorkflows(), loadSchedules(), loadHeartbeat()]);
        } catch (err) {
            console.error('[WorkflowsView] loadAll error:', err);
            setError((err as Error).message);
        }
        setLoading(false);
    }, [loadWorkflows, loadSchedules, loadHeartbeat]);

    useEffect(() => { loadAll(); }, [loadAll]);

    // Reload data when view becomes visible (user switches to Workflows tab)
    useEffect(() => {
        if (isVisible) loadAll();
    }, [isVisible]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Subscribe to real-time events ──
    useEffect(() => {
        if (!isElectron) return;
        const cleanups: (() => void)[] = [];
        cleanups.push(window.onicode!.onWorkflowRunCompleted(() => { loadWorkflows(); }));
        cleanups.push(window.onicode!.onSchedulerStatus(() => { loadSchedules(); }));
        cleanups.push(window.onicode!.onHeartbeatTick(() => { loadHeartbeat(); }));
        return () => cleanups.forEach(fn => fn());
    }, [loadWorkflows, loadSchedules, loadHeartbeat]);

    // ══════════════════════════════════════════
    //  Workflow Actions
    // ══════════════════════════════════════════

    const createWorkflow = useCallback(async () => {
        if (!isElectron || !newWfName.trim() || newWfSteps.length === 0) return;
        setCreatingWorkflow(true);
        try {
            const tags = newWfTags.split(',').map(t => t.trim()).filter(Boolean);
            const res = await window.onicode!.workflowCreate({
                name: newWfName.trim(),
                description: newWfDesc.trim(),
                steps: newWfSteps,
                tags,
            });
            if (res.success) {
                setShowCreateWorkflow(false);
                setNewWfName('');
                setNewWfDesc('');
                setNewWfTags('');
                setNewWfSteps([emptyStep()]);
                loadWorkflows();
            } else {
                setError(res.error || 'Failed to create workflow');
            }
        } catch (err) {
            setError((err as Error).message);
        }
        setCreatingWorkflow(false);
    }, [newWfName, newWfDesc, newWfTags, newWfSteps, loadWorkflows]);

    const runWorkflow = useCallback(async (id: string) => {
        if (!isElectron) return;
        setRunningWorkflow(id);
        try {
            await window.onicode!.workflowRun(id);
            loadWorkflows();
        } catch (err) {
            setError((err as Error).message);
        }
        setRunningWorkflow(null);
    }, [loadWorkflows]);

    const deleteWorkflow = useCallback(async (id: string) => {
        if (!isElectron) return;
        if (!confirm('Delete this workflow?')) return;
        try {
            await window.onicode!.workflowDelete(id);
            loadWorkflows();
        } catch (err) {
            setError((err as Error).message);
        }
    }, [loadWorkflows]);

    const toggleWorkflowEnabled = useCallback(async (wf: WorkflowDef) => {
        if (!isElectron) return;
        try {
            await window.onicode!.workflowUpdate(wf.id, { enabled: !wf.enabled });
            loadWorkflows();
        } catch (err) {
            setError((err as Error).message);
        }
    }, [loadWorkflows]);

    // ── Step builder helpers ──
    const updateStep = useCallback((index: number, updates: Partial<WorkflowStep>) => {
        setNewWfSteps(prev => prev.map((s, i) => i === index ? { ...s, ...updates } : s));
    }, []);

    const removeStep = useCallback((index: number) => {
        setNewWfSteps(prev => prev.filter((_, i) => i !== index));
    }, []);

    const addStep = useCallback(() => {
        setNewWfSteps(prev => [...prev, emptyStep()]);
    }, []);

    // ══════════════════════════════════════════
    //  Schedule Actions
    // ══════════════════════════════════════════

    const createSchedule = useCallback(async () => {
        if (!isElectron || !newSchName.trim() || !newSchCron.trim()) return;
        setCreatingSchedule(true);
        try {
            const action: Record<string, unknown> = { type: newSchActionType };
            if (newSchActionType === 'ai_prompt') action.prompt = newSchPayload;
            else if (newSchActionType === 'command') action.command = newSchPayload;
            else if (newSchActionType === 'workflow') action.workflow_id = newSchWorkflowId || newSchPayload;
            if (newSchOneTime) action.one_time = true;

            const res = await window.onicode!.schedulerCreate({
                name: newSchName.trim(),
                cron_expression: newSchCron.trim(),
                action,
                workflow_id: newSchActionType === 'workflow' ? (newSchWorkflowId || newSchPayload || undefined) : undefined,
            });
            if (res.success) {
                setShowCreateSchedule(false);
                setNewSchName('');
                setNewSchCron('0 * * * *');
                setNewSchActionType('ai_prompt');
                setNewSchPayload('');
                setNewSchWorkflowId('');
                setNewSchOneTime(false);
                loadSchedules();
            } else {
                setError(res.error || 'Failed to create schedule');
            }
        } catch (err) {
            setError((err as Error).message);
        }
        setCreatingSchedule(false);
    }, [newSchName, newSchCron, newSchActionType, newSchPayload, newSchWorkflowId, newSchOneTime, loadSchedules]);

    const toggleSchedule = useCallback(async (sch: ScheduleDef) => {
        if (!isElectron) return;
        try {
            if (sch.enabled) {
                await window.onicode!.schedulerPause(sch.id);
            } else {
                await window.onicode!.schedulerResume(sch.id);
            }
            loadSchedules();
        } catch (err) {
            setError((err as Error).message);
        }
    }, [loadSchedules]);

    const runScheduleNow = useCallback(async (id: string) => {
        if (!isElectron) return;
        try {
            await window.onicode!.schedulerRunNow(id);
            loadSchedules();
        } catch (err) {
            setError((err as Error).message);
        }
    }, [loadSchedules]);

    const deleteSchedule = useCallback(async (id: string) => {
        if (!isElectron) return;
        if (!confirm('Delete this schedule?')) return;
        try {
            await window.onicode!.schedulerDelete(id);
            loadSchedules();
        } catch (err) {
            setError((err as Error).message);
        }
    }, [loadSchedules]);

    // ══════════════════════════════════════════
    //  Heartbeat Actions
    // ══════════════════════════════════════════

    const updateHeartbeatConfig = useCallback(async (updates: Partial<HeartbeatConfig>) => {
        if (!isElectron) return;
        setHbUpdating(true);
        try {
            const res = await window.onicode!.heartbeatUpdate(updates);
            if (res.success && res.config) setHbConfig(res.config);
        } catch (err) {
            setError((err as Error).message);
        }
        setHbUpdating(false);
    }, []);

    const addHeartbeatCheck = useCallback(async () => {
        if (!isElectron || !newCheckName.trim()) return;
        try {
            const check: Partial<HeartbeatCheck> = {
                id: generateId(),
                name: newCheckName.trim(),
                type: newCheckType,
                enabled: true,
                priority: 5,
            };
            if (newCheckType === 'ai_eval') check.prompt = newCheckPrompt;
            else if (newCheckType === 'command_check') check.command = newCheckCommand;
            else if (newCheckType === 'workflow_trigger') check.trigger_workflow_id = newCheckWorkflowId;

            const res = await window.onicode!.heartbeatAddCheck(check);
            if (res.success) {
                setShowAddCheck(false);
                setNewCheckName('');
                setNewCheckPrompt('');
                setNewCheckCommand('');
                setNewCheckWorkflowId('');
                loadHeartbeat();
            } else {
                setError(res.error || 'Failed to add check');
            }
        } catch (err) {
            setError((err as Error).message);
        }
    }, [newCheckName, newCheckType, newCheckPrompt, newCheckCommand, newCheckWorkflowId, loadHeartbeat]);

    const removeHeartbeatCheck = useCallback(async (checkId: string) => {
        if (!isElectron) return;
        try {
            await window.onicode!.heartbeatRemoveCheck(checkId);
            loadHeartbeat();
        } catch (err) {
            setError((err as Error).message);
        }
    }, [loadHeartbeat]);

    const toggleHeartbeatCheck = useCallback(async (check: HeartbeatCheck) => {
        if (!isElectron) return;
        try {
            await window.onicode!.heartbeatUpdateCheck(check.id, { enabled: !check.enabled });
            loadHeartbeat();
        } catch (err) {
            setError((err as Error).message);
        }
    }, [loadHeartbeat]);

    const triggerHeartbeat = useCallback(async () => {
        if (!isElectron) return;
        setTriggeringHeartbeat(true);
        try {
            await window.onicode!.heartbeatTrigger();
            loadHeartbeat();
        } catch (err) {
            setError((err as Error).message);
        }
        setTriggeringHeartbeat(false);
    }, [loadHeartbeat]);

    // ══════════════════════════════════════════
    //  Render: Step Builder
    // ══════════════════════════════════════════

    const renderStepBuilder = (step: WorkflowStep, index: number) => (
        <div key={index} className="wv-step-row">
            <div className="wv-step-header">
                <span className="wv-step-num">{index + 1}</span>
                <input
                    className="wv-input wv-input-sm"
                    placeholder="Step name"
                    value={step.name || ''}
                    onChange={e => updateStep(index, { name: e.target.value })}
                />
                <select
                    className="wv-select wv-select-sm"
                    value={step.type}
                    onChange={e => updateStep(index, { type: e.target.value as WorkflowStep['type'] })}
                >
                    {STEP_TYPES.map(t => (
                        <option key={t} value={t}>{STEP_TYPE_LABELS[t]}</option>
                    ))}
                </select>
                <button className="wv-btn-icon wv-btn-danger-icon" onClick={() => removeStep(index)} title="Remove step">
                    <TrashIcon />
                </button>
            </div>
            <div className="wv-step-fields">
                {step.type === 'ai_prompt' && (
                    <>
                        <textarea
                            className="wv-textarea"
                            placeholder="Goal — what should the AI achieve? (enables agentic mode with tool access)"
                            rows={3}
                            value={(step as WorkflowStep & { goal?: string }).goal || step.prompt || ''}
                            onChange={e => {
                                const val = e.target.value;
                                updateStep(index, { goal: val, prompt: val });
                            }}
                        />
                        <div className="wv-step-agentic-row">
                            <label className="wv-label-sm">Tool Set</label>
                            <select
                                className="wv-select-sm"
                                value={(step as WorkflowStep & { tool_set?: string }).tool_set || ''}
                                onChange={e => updateStep(index, { tool_set: e.target.value || undefined } as Partial<WorkflowStep>)}
                            >
                                <option value="">None (legacy single-call)</option>
                                <option value="read-only">Read Only</option>
                                <option value="search">Search</option>
                                <option value="file-ops">File Operations</option>
                                <option value="git">Git</option>
                                <option value="browser">Browser</option>
                                <option value="workspace">Workspace</option>
                                <option value="research">Research</option>
                            </select>
                            <label className="wv-label-sm">Complexity</label>
                            <select
                                className="wv-select-sm"
                                value={(step as WorkflowStep & { complexity?: string }).complexity || ''}
                                onChange={e => updateStep(index, { complexity: e.target.value || undefined } as Partial<WorkflowStep>)}
                            >
                                <option value="">Default</option>
                                <option value="simple">Simple (10 rounds)</option>
                                <option value="moderate">Moderate (25 rounds)</option>
                                <option value="complex">Complex (40 rounds)</option>
                            </select>
                            <label className="wv-label-sm">Max Rounds</label>
                            <input
                                className="wv-input-sm"
                                type="number"
                                min={1}
                                max={30}
                                placeholder="10"
                                value={(step as WorkflowStep & { max_rounds?: number }).max_rounds || ''}
                                onChange={e => updateStep(index, { max_rounds: Number(e.target.value) || undefined } as Partial<WorkflowStep>)}
                                style={{ width: 60 }}
                            />
                        </div>
                        <input
                            className="wv-input"
                            placeholder="Tool priority (comma-separated, e.g. search_files,read_file)"
                            value={((step as WorkflowStep & { tool_priority?: string[] }).tool_priority || []).join(', ')}
                            onChange={e => updateStep(index, { tool_priority: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } as Partial<WorkflowStep>)}
                        />
                        <input
                            className="wv-input"
                            placeholder="Context files (comma-separated paths)"
                            value={((step as WorkflowStep & { context?: { files?: string[] } }).context?.files || []).join(', ')}
                            onChange={e => updateStep(index, {
                                context: {
                                    ...((step as WorkflowStep & { context?: Record<string, unknown> }).context || {}),
                                    files: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
                                },
                            } as Partial<WorkflowStep>)}
                        />
                        <div className="wv-step-agentic-row">
                            <label className="wv-checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={(step as WorkflowStep & { context?: { previous_steps?: boolean } }).context?.previous_steps !== false}
                                    onChange={e => updateStep(index, {
                                        context: {
                                            ...((step as WorkflowStep & { context?: Record<string, unknown> }).context || {}),
                                            previous_steps: e.target.checked,
                                        },
                                    } as Partial<WorkflowStep>)}
                                />
                                Include previous step outputs
                            </label>
                            <label className="wv-checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={!!(step as WorkflowStep & { context?: { project_docs?: boolean } }).context?.project_docs}
                                    onChange={e => updateStep(index, {
                                        context: {
                                            ...((step as WorkflowStep & { context?: Record<string, unknown> }).context || {}),
                                            project_docs: e.target.checked,
                                        },
                                    } as Partial<WorkflowStep>)}
                                />
                                Include project docs
                            </label>
                        </div>
                    </>
                )}
                {step.type === 'command' && (
                    <input
                        className="wv-input"
                        placeholder="Shell command..."
                        value={step.command || ''}
                        onChange={e => updateStep(index, { command: e.target.value })}
                    />
                )}
                {step.type === 'tool_call' && (
                    <>
                        <input
                            className="wv-input"
                            placeholder="Tool name"
                            value={step.tool || ''}
                            onChange={e => updateStep(index, { tool: e.target.value })}
                        />
                        <input
                            className="wv-input"
                            placeholder='Args JSON, e.g. {"path": "/tmp"}'
                            value={step.args ? JSON.stringify(step.args) : ''}
                            onChange={e => {
                                try { updateStep(index, { args: JSON.parse(e.target.value) }); } catch { /* ignore parse errors while typing */ }
                            }}
                        />
                    </>
                )}
                {step.type === 'condition' && (
                    <input
                        className="wv-input"
                        placeholder="Condition expression..."
                        value={step.condition || ''}
                        onChange={e => updateStep(index, { condition: e.target.value })}
                    />
                )}
                {step.type === 'notify' && (
                    <>
                        <input
                            className="wv-input"
                            placeholder="Notification title"
                            value={step.title || ''}
                            onChange={e => updateStep(index, { title: e.target.value })}
                        />
                        <input
                            className="wv-input"
                            placeholder="Notification body"
                            value={step.body || ''}
                            onChange={e => updateStep(index, { body: e.target.value })}
                        />
                    </>
                )}
                {step.type === 'wait' && (
                    <input
                        className="wv-input wv-input-sm"
                        type="number"
                        placeholder="Seconds"
                        min={1}
                        value={step.seconds || ''}
                        onChange={e => updateStep(index, { seconds: Number(e.target.value) || undefined })}
                    />
                )}
                {step.type === 'webhook' && (
                    <input
                        className="wv-input"
                        placeholder="Webhook URL"
                        value={step.url || ''}
                        onChange={e => updateStep(index, { url: e.target.value })}
                    />
                )}
            </div>
        </div>
    );

    // ══════════════════════════════════════════
    //  Render: Workflows Tab
    // ══════════════════════════════════════════

    const renderWorkflowsTab = () => (
        <div className="wv-tab-content">
            {/* Queue status bar */}
            {queueStatus && (queueStatus.running > 0 || queueStatus.queued > 0) && (
                <div className="wv-queue-bar">
                    <span className="wv-queue-running">{queueStatus.running}/{queueStatus.maxConcurrent} running</span>
                    {queueStatus.queued > 0 && <span className="wv-queue-queued">{queueStatus.queued} queued</span>}
                </div>
            )}
            {/* Create workflow form */}
            {!showCreateWorkflow ? (
                <button className="wv-btn wv-btn-primary" onClick={() => setShowCreateWorkflow(true)}>
                    <PlusIcon /> Create Workflow
                </button>
            ) : (
                <div className="wv-form-card">
                    <h4 className="wv-form-title">New Workflow</h4>
                    <input
                        className="wv-input"
                        placeholder="Workflow name"
                        value={newWfName}
                        onChange={e => setNewWfName(e.target.value)}
                    />
                    <input
                        className="wv-input"
                        placeholder="Description (optional)"
                        value={newWfDesc}
                        onChange={e => setNewWfDesc(e.target.value)}
                    />
                    <input
                        className="wv-input"
                        placeholder="Tags (comma-separated)"
                        value={newWfTags}
                        onChange={e => setNewWfTags(e.target.value)}
                    />

                    <div className="wv-steps-section">
                        <h5 className="wv-steps-title">Steps</h5>
                        {newWfSteps.map((step, i) => renderStepBuilder(step, i))}
                        <button className="wv-btn wv-btn-sm" onClick={addStep}>
                            <PlusIcon /> Add Step
                        </button>
                    </div>

                    <div className="wv-form-actions">
                        <button className="wv-btn wv-btn-primary" onClick={createWorkflow} disabled={creatingWorkflow || !newWfName.trim()}>
                            {creatingWorkflow ? 'Creating...' : 'Create'}
                        </button>
                        <button className="wv-btn" onClick={() => { setShowCreateWorkflow(false); setNewWfSteps([emptyStep()]); }}>
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Workflow list */}
            {workflows.length === 0 && !showCreateWorkflow && (
                <div className="wv-empty">No workflows yet. Create one to get started.</div>
            )}

            <div className="wv-list">
                {workflows.map(wf => {
                    const isExpanded = expandedWorkflow === wf.id;
                    const runs = workflowRuns[wf.id] || [];
                    return (
                        <div key={wf.id} className="wv-card">
                            <div className="wv-card-header">
                                <button className="wv-btn-icon" onClick={() => setExpandedWorkflow(isExpanded ? null : wf.id)}>
                                    <ChevronIcon open={isExpanded} />
                                </button>
                                <div className="wv-card-info">
                                    <span className="wv-card-name">{wf.name}</span>
                                    {wf.description && <span className="wv-card-desc">{wf.description}</span>}
                                    <div className="wv-card-meta">
                                        <span className="wv-meta-item">{wf.steps.length} step{wf.steps.length !== 1 ? 's' : ''}</span>
                                        {wf.tags.map(tag => (
                                            <span key={tag} className="wv-tag">{tag}</span>
                                        ))}
                                    </div>
                                </div>
                                <div className="wv-card-actions">
                                    <span className={`wv-enabled-badge ${wf.enabled ? 'wv-enabled' : 'wv-disabled'}${wf.id.startsWith('system_') ? ' wv-system-badge' : ''}`}
                                        onClick={() => !wf.id.startsWith('system_') && toggleWorkflowEnabled(wf)}
                                        title={wf.id.startsWith('system_') ? 'System workflow (always enabled)' : wf.enabled ? 'Click to disable' : 'Click to enable'}
                                        style={wf.id.startsWith('system_') ? { cursor: 'default' } : undefined}>
                                        {wf.id.startsWith('system_') ? 'System' : wf.enabled ? 'Enabled' : 'Disabled'}
                                    </span>
                                    <button className="wv-btn wv-btn-sm" onClick={() => runWorkflow(wf.id)}
                                        disabled={runningWorkflow === wf.id} title="Run">
                                        <PlayIcon /> {runningWorkflow === wf.id ? 'Running...' : 'Run'}
                                    </button>
                                    {!wf.id.startsWith('system_') && (
                                        <button className="wv-btn-icon wv-btn-danger-icon" onClick={() => deleteWorkflow(wf.id)} title="Delete">
                                            <TrashIcon />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Expanded: show steps */}
                            {isExpanded && (
                                <div className="wv-card-expanded">
                                    <div className="wv-steps-list">
                                        {wf.steps.map((step, i) => (
                                            <div key={i} className="wv-step-display">
                                                <span className="wv-step-num">{i + 1}</span>
                                                <span className="wv-step-type-badge">{STEP_TYPE_LABELS[step.type]}</span>
                                                <span className="wv-step-label">{step.name || step.prompt?.slice(0, 60) || step.command || step.url || `Step ${i + 1}`}</span>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Recent runs */}
                                    {runs.length > 0 && (
                                        <div className="wv-runs-section">
                                            <h5 className="wv-runs-title">Recent Runs</h5>
                                            {runs.map(run => (
                                                <div key={run.id} className="wv-run-row">
                                                    <StatusDot status={run.status} />
                                                    <span className="wv-run-status">{run.status}</span>
                                                    <span className="wv-run-time">{formatTime(run.started_at)}</span>
                                                    <span className="wv-run-duration">{formatDuration(run.duration_ms)}</span>
                                                    <span className="wv-run-steps">{run.steps_completed}/{run.steps_total} steps</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );

    // ══════════════════════════════════════════
    //  Render: Schedules Tab
    // ══════════════════════════════════════════

    const renderSchedulesTab = () => (
        <div className="wv-tab-content">
            {/* Create schedule form */}
            {!showCreateSchedule ? (
                <button className="wv-btn wv-btn-primary" onClick={() => setShowCreateSchedule(true)}>
                    <PlusIcon /> Create Schedule
                </button>
            ) : (
                <div className="wv-form-card">
                    <h4 className="wv-form-title">New Schedule</h4>
                    <input
                        className="wv-input"
                        placeholder="Schedule name"
                        value={newSchName}
                        onChange={e => setNewSchName(e.target.value)}
                    />
                    <div className="wv-cron-section">
                        <input
                            className="wv-input"
                            placeholder="Cron expression"
                            value={newSchCron}
                            onChange={e => setNewSchCron(e.target.value)}
                        />
                        <span className="wv-cron-desc">{describeCron(newSchCron)}</span>
                        <div className="wv-cron-examples">
                            {CRON_EXAMPLES.map(ex => (
                                <button key={ex.cron} className="wv-btn wv-btn-xs" onClick={() => setNewSchCron(ex.cron)}>
                                    {ex.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="wv-field-group">
                        <label className="wv-label">Action Type</label>
                        <select
                            className="wv-select"
                            value={newSchActionType}
                            onChange={e => setNewSchActionType(e.target.value as 'ai_prompt' | 'workflow' | 'command')}
                        >
                            <option value="ai_prompt">AI Prompt</option>
                            <option value="workflow">Workflow</option>
                            <option value="command">Command</option>
                        </select>
                    </div>

                    {newSchActionType === 'workflow' && workflows.length > 0 && (
                        <div className="wv-field-group">
                            <label className="wv-label">Workflow</label>
                            <select
                                className="wv-select"
                                value={newSchWorkflowId}
                                onChange={e => setNewSchWorkflowId(e.target.value)}
                            >
                                <option value="">Select a workflow...</option>
                                {workflows.map(wf => (
                                    <option key={wf.id} value={wf.id}>{wf.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <textarea
                        className="wv-textarea"
                        placeholder={newSchActionType === 'ai_prompt' ? 'Enter AI prompt...' : newSchActionType === 'command' ? 'Enter command...' : 'Workflow ID (or select above)'}
                        rows={3}
                        value={newSchPayload}
                        onChange={e => setNewSchPayload(e.target.value)}
                    />

                    <label className="wv-checkbox-label">
                        <input
                            type="checkbox"
                            checked={newSchOneTime}
                            onChange={e => setNewSchOneTime(e.target.checked)}
                        />
                        One-time (fires once then auto-disables)
                    </label>

                    <div className="wv-form-actions">
                        <button className="wv-btn wv-btn-primary" onClick={createSchedule} disabled={creatingSchedule || !newSchName.trim() || !newSchCron.trim()}>
                            {creatingSchedule ? 'Creating...' : 'Create'}
                        </button>
                        <button className="wv-btn" onClick={() => setShowCreateSchedule(false)}>Cancel</button>
                    </div>
                </div>
            )}

            {/* Schedule list */}
            {schedules.length === 0 && !showCreateSchedule && (
                <div className="wv-empty">No schedules yet. Create one to automate recurring tasks.</div>
            )}

            <div className="wv-list">
                {schedules.map(sch => (
                    <div key={sch.id} className="wv-card">
                        <div className="wv-card-header">
                            <div className="wv-card-info">
                                <span className="wv-card-name">
                                    {sch.name}
                                    {isOneTimeSchedule(sch) && <span className="wv-badge wv-badge-once">once</span>}
                                    {!isOneTimeSchedule(sch) && <span className="wv-badge wv-badge-recurring">recurring</span>}
                                </span>
                                <div className="wv-card-meta">
                                    <span className="wv-meta-item wv-mono">{sch.cron_expression}</span>
                                    <span className="wv-meta-item wv-cron-human">{describeCron(sch.cron_expression)}</span>
                                </div>
                                <div className="wv-schedule-times">
                                    <span className="wv-time-label">Last: <span className="wv-time-value">{formatTime(sch.last_run_at)}</span></span>
                                    <span className="wv-time-label">Next: <span className="wv-time-value">{formatTime(sch.next_run_at)}</span></span>
                                </div>
                            </div>
                            <div className="wv-card-actions">
                                <span className={`wv-enabled-badge ${sch.enabled ? 'wv-enabled' : 'wv-disabled'}`}
                                    onClick={() => toggleSchedule(sch)} title={sch.enabled ? 'Pause' : 'Resume'}>
                                    {sch.enabled ? (
                                        <><PauseIcon /> Active</>
                                    ) : (
                                        <><PlayIcon /> Paused</>
                                    )}
                                </span>
                                <button className="wv-btn wv-btn-sm" onClick={() => runScheduleNow(sch.id)} title="Run now">
                                    <PlayIcon /> Run Now
                                </button>
                                <button className="wv-btn-icon wv-btn-danger-icon" onClick={() => deleteSchedule(sch.id)} title="Delete">
                                    <TrashIcon />
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    // ══════════════════════════════════════════
    //  Render: Heartbeat Tab
    // ══════════════════════════════════════════

    const renderHeartbeatTab = () => {
        if (!hbConfig) return <div className="wv-empty">Loading heartbeat configuration...</div>;

        return (
            <div className="wv-tab-content">
                {/* Config section */}
                <div className="wv-hb-config">
                    <div className="wv-hb-row">
                        <div className="wv-hb-label">
                            <HeartIcon />
                            <span className="wv-hb-name">Heartbeat</span>
                        </div>
                        <label className="wv-toggle">
                            <input
                                type="checkbox"
                                checked={hbConfig.enabled}
                                onChange={() => updateHeartbeatConfig({ enabled: !hbConfig.enabled })}
                                disabled={hbUpdating}
                            />
                            <span className="wv-toggle-slider" />
                        </label>
                    </div>

                    <div className="wv-hb-row">
                        <span className="wv-hb-label">Interval: {hbConfig.interval_minutes} min</span>
                        <input
                            type="range"
                            className="wv-slider"
                            min={5}
                            max={240}
                            step={5}
                            value={hbConfig.interval_minutes}
                            onChange={e => updateHeartbeatConfig({ interval_minutes: Number(e.target.value) })}
                            disabled={hbUpdating}
                        />
                    </div>

                    <div className="wv-hb-row">
                        <span className="wv-hb-label">Quiet Hours</span>
                        <div className="wv-hb-quiet">
                            <input
                                type="time"
                                className="wv-input wv-input-sm"
                                value={hbConfig.quiet_hours_start}
                                onChange={e => updateHeartbeatConfig({ quiet_hours_start: e.target.value })}
                                disabled={hbUpdating}
                            />
                            <span className="wv-hb-quiet-sep">to</span>
                            <input
                                type="time"
                                className="wv-input wv-input-sm"
                                value={hbConfig.quiet_hours_end}
                                onChange={e => updateHeartbeatConfig({ quiet_hours_end: e.target.value })}
                                disabled={hbUpdating}
                            />
                        </div>
                    </div>

                    <div className="wv-hb-times">
                        <span>Last beat: {formatTime(hbConfig.last_beat_at)}</span>
                        <span>Next beat: {hbConfig.enabled && hbConfig.last_beat_at
                            ? formatTime(hbConfig.last_beat_at + hbConfig.interval_minutes * 60000)
                            : '--'}</span>
                    </div>

                    <button className="wv-btn wv-btn-primary" onClick={triggerHeartbeat} disabled={triggeringHeartbeat}>
                        <HeartIcon /> {triggeringHeartbeat ? 'Running...' : 'Trigger Now'}
                    </button>
                </div>

                {/* Checklist */}
                <div className="wv-hb-checks">
                    <div className="wv-section-header">
                        <h4 className="wv-section-title">Checks</h4>
                        <button className="wv-btn wv-btn-sm" onClick={() => setShowAddCheck(true)}>
                            <PlusIcon /> Add Check
                        </button>
                    </div>

                    {showAddCheck && (
                        <div className="wv-form-card">
                            <input
                                className="wv-input"
                                placeholder="Check name"
                                value={newCheckName}
                                onChange={e => setNewCheckName(e.target.value)}
                            />
                            <div className="wv-field-group">
                                <label className="wv-label">Type</label>
                                <select
                                    className="wv-select"
                                    value={newCheckType}
                                    onChange={e => setNewCheckType(e.target.value as HeartbeatCheck['type'])}
                                >
                                    <option value="ai_eval">AI Evaluation</option>
                                    <option value="command_check">Command Check</option>
                                    <option value="workflow_trigger">Workflow Trigger</option>
                                </select>
                            </div>

                            {newCheckType === 'ai_eval' && (
                                <textarea
                                    className="wv-textarea"
                                    placeholder="AI evaluation prompt..."
                                    rows={3}
                                    value={newCheckPrompt}
                                    onChange={e => setNewCheckPrompt(e.target.value)}
                                />
                            )}
                            {newCheckType === 'command_check' && (
                                <input
                                    className="wv-input"
                                    placeholder="Shell command to run..."
                                    value={newCheckCommand}
                                    onChange={e => setNewCheckCommand(e.target.value)}
                                />
                            )}
                            {newCheckType === 'workflow_trigger' && (
                                <select
                                    className="wv-select"
                                    value={newCheckWorkflowId}
                                    onChange={e => setNewCheckWorkflowId(e.target.value)}
                                >
                                    <option value="">Select a workflow...</option>
                                    {workflows.map(wf => (
                                        <option key={wf.id} value={wf.id}>{wf.name}</option>
                                    ))}
                                </select>
                            )}

                            <div className="wv-form-actions">
                                <button className="wv-btn wv-btn-primary" onClick={addHeartbeatCheck} disabled={!newCheckName.trim()}>
                                    Add Check
                                </button>
                                <button className="wv-btn" onClick={() => setShowAddCheck(false)}>Cancel</button>
                            </div>
                        </div>
                    )}

                    {hbConfig.checklist.length === 0 && !showAddCheck && (
                        <div className="wv-empty">No checks configured. Add one to monitor your projects.</div>
                    )}

                    <div className="wv-check-list">
                        {hbConfig.checklist.map(check => (
                            <div key={check.id} className="wv-check-row">
                                <label className="wv-toggle wv-toggle-sm">
                                    <input
                                        type="checkbox"
                                        checked={check.enabled}
                                        onChange={() => toggleHeartbeatCheck(check)}
                                    />
                                    <span className="wv-toggle-slider" />
                                </label>
                                <div className="wv-check-info">
                                    <span className="wv-check-name">{check.name}</span>
                                    <div className="wv-check-meta">
                                        <span className="wv-check-type-badge">{check.type.replace('_', ' ')}</span>
                                        <span className="wv-check-priority">Priority: {check.priority}</span>
                                        {check.last_checked_at && (
                                            <span className="wv-check-last">Last: {formatTime(check.last_checked_at)}</span>
                                        )}
                                    </div>
                                </div>
                                <button className="wv-btn-icon wv-btn-danger-icon" onClick={() => removeHeartbeatCheck(check.id)} title="Remove">
                                    <TrashIcon />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    // ══════════════════════════════════════════
    //  Main Render
    // ══════════════════════════════════════════

    return (
        <div className="wv-container">
            <h2 className="wv-title">Workflows</h2>

            {/* Error banner */}
            {error && (
                <div className="wv-error">
                    <span>{error}</span>
                    <button className="wv-btn-icon" onClick={() => setError(null)}>&times;</button>
                </div>
            )}

            {/* Tab bar */}
            <div className="wv-tabs">
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        className={`wv-tab ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                        {tab.id === 'workflows' && workflows.length > 0 && (
                            <span className="wv-tab-badge">{workflows.length}</span>
                        )}
                        {tab.id === 'schedules' && schedules.length > 0 && (
                            <span className="wv-tab-badge">{schedules.length}</span>
                        )}
                        {tab.id === 'heartbeat' && hbConfig?.enabled && (
                            <span className="wv-tab-badge wv-tab-badge-active">ON</span>
                        )}
                    </button>
                ))}
            </div>

            {/* Loading state */}
            {loading ? (
                <div className="wv-loading">Loading...</div>
            ) : (
                <>
                    {activeTab === 'workflows' && renderWorkflowsTab()}
                    {activeTab === 'schedules' && renderSchedulesTab()}
                    {activeTab === 'heartbeat' && renderHeartbeatTab()}
                </>
            )}
        </div>
    );
}
