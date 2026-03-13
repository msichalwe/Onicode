/**
 * Automation persistence — workflows, schedules, workflow runs, heartbeat config.
 */

const { getDB } = require('./db');

const workflowStorage = {
    save(wf) {
        const d = getDB();
        d.prepare(`INSERT OR REPLACE INTO workflows (id, name, description, steps, trigger_config, enabled, project_id, project_path, tags, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            wf.id, wf.name, wf.description || '', JSON.stringify(wf.steps || []), JSON.stringify(wf.trigger_config || {}),
            wf.enabled ? 1 : 0, wf.project_id || null, wf.project_path || null, JSON.stringify(wf.tags || []), wf.created_at || Date.now(), Date.now()
        );
    },
    get(id) {
        const d = getDB();
        const row = d.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
        if (!row) return null;
        return { ...row, steps: JSON.parse(row.steps), trigger_config: JSON.parse(row.trigger_config), tags: JSON.parse(row.tags), enabled: !!row.enabled };
    },
    list(limit = 50) {
        const d = getDB();
        return d.prepare('SELECT * FROM workflows ORDER BY updated_at DESC LIMIT ?').all(limit).map(r => ({
            ...r, steps: JSON.parse(r.steps), trigger_config: JSON.parse(r.trigger_config), tags: JSON.parse(r.tags), enabled: !!r.enabled,
        }));
    },
    update(id, updates) {
        const d = getDB();
        const fields = [];
        const vals = [];
        for (const [k, v] of Object.entries(updates)) {
            if (['name', 'description', 'project_id', 'project_path'].includes(k)) { fields.push(`${k} = ?`); vals.push(v); }
            else if (k === 'steps' || k === 'trigger_config' || k === 'tags') { fields.push(`${k} = ?`); vals.push(JSON.stringify(v)); }
            else if (k === 'enabled') { fields.push('enabled = ?'); vals.push(v ? 1 : 0); }
        }
        if (fields.length === 0) return;
        fields.push('updated_at = ?'); vals.push(Date.now());
        vals.push(id);
        d.prepare(`UPDATE workflows SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    },
    delete(id) { getDB().prepare('DELETE FROM workflows WHERE id = ?').run(id); },
};

const scheduleStorage = {
    save(s) {
        const d = getDB();
        d.prepare(`INSERT OR REPLACE INTO schedules (id, name, cron_expression, workflow_id, action, enabled, timezone, last_run_at, next_run_at, max_concurrent, rate_limit_seconds, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            s.id, s.name, s.cron_expression, s.workflow_id || null, JSON.stringify(s.action || {}),
            s.enabled ? 1 : 0, s.timezone || 'local', s.last_run_at || null, s.next_run_at || null,
            s.max_concurrent || 1, s.rate_limit_seconds || 0, s.created_at || Date.now(), Date.now()
        );
    },
    get(id) {
        const d = getDB();
        const row = d.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
        if (!row) return null;
        return { ...row, action: JSON.parse(row.action), enabled: !!row.enabled };
    },
    list(limit = 100) {
        const d = getDB();
        return d.prepare('SELECT * FROM schedules ORDER BY next_run_at ASC LIMIT ?').all(limit).map(r => ({
            ...r, action: JSON.parse(r.action), enabled: !!r.enabled,
        }));
    },
    update(id, updates) {
        const d = getDB();
        const fields = [];
        const vals = [];
        for (const [k, v] of Object.entries(updates)) {
            if (['name', 'cron_expression', 'workflow_id', 'timezone'].includes(k)) { fields.push(`${k} = ?`); vals.push(v); }
            else if (k === 'action') { fields.push('action = ?'); vals.push(JSON.stringify(v)); }
            else if (k === 'enabled') { fields.push('enabled = ?'); vals.push(v ? 1 : 0); }
            else if (['last_run_at', 'next_run_at', 'max_concurrent', 'rate_limit_seconds'].includes(k)) { fields.push(`${k} = ?`); vals.push(v); }
        }
        if (fields.length === 0) return;
        fields.push('updated_at = ?'); vals.push(Date.now());
        vals.push(id);
        d.prepare(`UPDATE schedules SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    },
    delete(id) { getDB().prepare('DELETE FROM schedules WHERE id = ?').run(id); },
    getEnabled() {
        const d = getDB();
        return d.prepare('SELECT * FROM schedules WHERE enabled = 1 ORDER BY next_run_at ASC').all().map(r => ({
            ...r, action: JSON.parse(r.action), enabled: true,
        }));
    },
};

const workflowRunStorage = {
    save(run) {
        const d = getDB();
        d.prepare(`INSERT OR REPLACE INTO workflow_runs (id, workflow_id, schedule_id, trigger_type, trigger_data, status, current_step, steps_completed, steps_total, result, error, started_at, completed_at, duration_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            run.id, run.workflow_id || null, run.schedule_id || null, run.trigger_type, JSON.stringify(run.trigger_data || {}),
            run.status, run.current_step || 0, run.steps_completed || 0, run.steps_total || 0,
            JSON.stringify(run.result || {}), run.error || null, run.started_at || null, run.completed_at || null, run.duration_ms || null
        );
    },
    get(id) {
        const d = getDB();
        const row = d.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id);
        if (!row) return null;
        return { ...row, trigger_data: JSON.parse(row.trigger_data || '{}'), result: JSON.parse(row.result || '{}') };
    },
    list(filters = {}) {
        const d = getDB();
        let sql = 'SELECT * FROM workflow_runs WHERE 1=1';
        const params = [];
        if (filters.workflow_id) { sql += ' AND workflow_id = ?'; params.push(filters.workflow_id); }
        if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
        sql += ' ORDER BY started_at DESC LIMIT ?';
        params.push(filters.limit || 50);
        return d.prepare(sql).all(...params).map(r => ({ ...r, trigger_data: JSON.parse(r.trigger_data || '{}'), result: JSON.parse(r.result || '{}') }));
    },
    update(id, updates) {
        const d = getDB();
        const fields = []; const vals = [];
        for (const [k, v] of Object.entries(updates)) {
            if (['status', 'error', 'current_step', 'steps_completed', 'steps_total', 'started_at', 'completed_at', 'duration_ms'].includes(k)) {
                fields.push(`${k} = ?`); vals.push(v);
            } else if (k === 'result' || k === 'trigger_data') { fields.push(`${k} = ?`); vals.push(JSON.stringify(v)); }
        }
        if (fields.length === 0) return;
        vals.push(id);
        d.prepare(`UPDATE workflow_runs SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    },
    saveStepRun(stepRun) {
        const d = getDB();
        d.prepare(`INSERT INTO workflow_step_runs (run_id, step_index, step_name, step_type, input, output, status, error, started_at, completed_at, duration_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            stepRun.run_id, stepRun.step_index, stepRun.step_name, stepRun.step_type,
            JSON.stringify(stepRun.input || {}), JSON.stringify(stepRun.output || {}),
            stepRun.status, stepRun.error || null, stepRun.started_at || null, stepRun.completed_at || null, stepRun.duration_ms || null
        );
    },
    getStepRuns(runId) {
        const d = getDB();
        return d.prepare('SELECT * FROM workflow_step_runs WHERE run_id = ? ORDER BY step_index ASC').all(runId).map(r => ({
            ...r, input: JSON.parse(r.input || '{}'), output: JSON.parse(r.output || '{}'),
        }));
    },
};

const heartbeatStorage = {
    get() {
        const d = getDB();
        const row = d.prepare("SELECT * FROM heartbeat_config WHERE id = 'default'").get();
        if (!row) return null;
        return { ...row, checklist: JSON.parse(row.checklist || '[]'), enabled: !!row.enabled };
    },
    save(config) {
        const d = getDB();
        d.prepare(`INSERT OR REPLACE INTO heartbeat_config (id, enabled, interval_minutes, checklist, last_beat_at, next_beat_at, quiet_hours_start, quiet_hours_end, max_actions_per_beat, updated_at)
            VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            config.enabled ? 1 : 0, config.interval_minutes || 30, JSON.stringify(config.checklist || []),
            config.last_beat_at || null, config.next_beat_at || null,
            config.quiet_hours_start || '22:00', config.quiet_hours_end || '08:00',
            config.max_actions_per_beat || 3, Date.now()
        );
    },
    update(updates) {
        const existing = this.get();
        if (!existing) { this.save({ ...updates }); return; }
        const merged = { ...existing, ...updates };
        if (updates.checklist) merged.checklist = updates.checklist;
        this.save(merged);
    },
};

module.exports = { workflowStorage, scheduleStorage, workflowRunStorage, heartbeatStorage };
