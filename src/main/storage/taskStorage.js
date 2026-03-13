/**
 * Task persistence — CRUD for tasks with session/project scoping.
 */

const { getDB } = require('./db');

function parseTaskRow(row) {
    if (!row) return null;
    return {
        ...row,
        blocks: JSON.parse(row.blocks || '[]'),
        blockedBy: JSON.parse(row.blocked_by || '[]'),
    };
}

const taskStorage = {
    save(task, sessionId, projectId, projectPath) {
        const d = getDB();
        const stmt = d.prepare(`
            INSERT OR REPLACE INTO tasks (id, session_id, content, status, priority, created_at, completed_at, project_id, project_path, milestone_id, blocks, blocked_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(task.id, sessionId, task.content, task.status, task.priority, task.createdAt, task.completedAt, projectId || null, projectPath || null, task.milestoneId || null, JSON.stringify(task.blocks || []), JSON.stringify(task.blockedBy || []));
    },

    update(taskId, updates, sessionId) {
        const d = getDB();
        const fields = [];
        const values = [];
        if (updates.status) { fields.push('status = ?'); values.push(updates.status); }
        if (updates.content) { fields.push('content = ?'); values.push(updates.content); }
        if (updates.priority) { fields.push('priority = ?'); values.push(updates.priority); }
        if (updates.completedAt) { fields.push('completed_at = ?'); values.push(updates.completedAt); }
        if (updates.milestoneId !== undefined) { fields.push('milestone_id = ?'); values.push(updates.milestoneId); }
        if (updates.blocks !== undefined) { fields.push('blocks = ?'); values.push(JSON.stringify(updates.blocks)); }
        if (updates.blockedBy !== undefined) { fields.push('blocked_by = ?'); values.push(JSON.stringify(updates.blockedBy)); }
        if (fields.length === 0) return;
        values.push(taskId, sessionId);
        d.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ? AND session_id = ?`).run(...values);
    },

    loadSession(sessionId) {
        const d = getDB();
        return d.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY id').all(sessionId).map(parseTaskRow);
    },

    loadProject(projectPath) {
        const d = getDB();
        return d.prepare(
            'SELECT * FROM tasks WHERE project_path = ? ORDER BY created_at DESC'
        ).all(projectPath).map(parseTaskRow);
    },

    loadLatestProjectSession(projectPath) {
        const d = getDB();
        let row = d.prepare(
            'SELECT session_id FROM tasks WHERE project_path = ? ORDER BY created_at DESC LIMIT 1'
        ).get(projectPath);
        if (!row) {
            row = d.prepare(
                'SELECT t.session_id FROM tasks t INNER JOIN sessions s ON t.session_id = s.id WHERE s.project_path = ? ORDER BY t.created_at DESC LIMIT 1'
            ).get(projectPath);
        }
        if (!row) return [];
        return d.prepare("SELECT * FROM tasks WHERE session_id = ? AND status != 'archived' ORDER BY id").all(row.session_id).map(parseTaskRow);
    },

    updateSessionProjectPath(sessionId, projectPath, projectId) {
        const d = getDB();
        d.prepare('UPDATE tasks SET project_path = ?, project_id = ? WHERE session_id = ? AND project_path IS NULL')
            .run(projectPath, projectId || null, sessionId);
    },

    archiveCompleted(sessionId) {
        const d = getDB();
        d.prepare("UPDATE tasks SET status = 'archived' WHERE session_id = ? AND (status = 'done' OR status = 'skipped')").run(sessionId);
    },

    deleteTask(taskId, sessionId) {
        const d = getDB();
        d.prepare('DELETE FROM tasks WHERE id = ? AND session_id = ?').run(taskId, sessionId);
    },

    clearSession(sessionId) {
        const d = getDB();
        d.prepare('DELETE FROM tasks WHERE session_id = ?').run(sessionId);
    },

    getRecentSessions(limit = 10) {
        const d = getDB();
        return d.prepare('SELECT DISTINCT session_id, MIN(created_at) as started, COUNT(*) as task_count FROM tasks GROUP BY session_id ORDER BY started DESC LIMIT ?').all(limit);
    },

    getProjectTaskSummary(projectPath) {
        const d = getDB();
        const tasks = d.prepare('SELECT * FROM tasks WHERE project_path = ? ORDER BY created_at DESC').all(projectPath).map(parseTaskRow);
        return {
            pending: tasks.filter(t => t.status === 'pending'),
            inProgress: tasks.filter(t => t.status === 'in_progress'),
            done: tasks.filter(t => t.status === 'done'),
            archived: tasks.filter(t => t.status === 'archived'),
            skipped: tasks.filter(t => t.status === 'skipped'),
        };
    },

    getById(taskId) {
        const d = getDB();
        const row = d.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
        if (!row) return null;
        return parseTaskRow(row);
    },

    getAll(limit = 500) {
        const d = getDB();
        return d.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?').all(limit).map(parseTaskRow);
    },

    addDependency(taskId, blocksId) {
        const d = getDB();
        const task = d.prepare('SELECT blocks FROM tasks WHERE id = ?').get(taskId);
        if (task) {
            const blocks = JSON.parse(task.blocks || '[]');
            if (!blocks.includes(blocksId)) {
                blocks.push(blocksId);
                d.prepare('UPDATE tasks SET blocks = ? WHERE id = ?').run(JSON.stringify(blocks), taskId);
            }
        }
        const blocked = d.prepare('SELECT blocked_by FROM tasks WHERE id = ?').get(blocksId);
        if (blocked) {
            const blockedBy = JSON.parse(blocked.blocked_by || '[]');
            if (!blockedBy.includes(taskId)) {
                blockedBy.push(taskId);
                d.prepare('UPDATE tasks SET blocked_by = ? WHERE id = ?').run(JSON.stringify(blockedBy), blocksId);
            }
        }
    },

    removeDependency(taskId, blocksId) {
        const d = getDB();
        const task = d.prepare('SELECT blocks FROM tasks WHERE id = ?').get(taskId);
        if (task) {
            const blocks = JSON.parse(task.blocks || '[]').filter(id => id !== blocksId);
            d.prepare('UPDATE tasks SET blocks = ? WHERE id = ?').run(JSON.stringify(blocks), taskId);
        }
        const blocked = d.prepare('SELECT blocked_by FROM tasks WHERE id = ?').get(blocksId);
        if (blocked) {
            const blockedBy = JSON.parse(blocked.blocked_by || '[]').filter(id => id !== taskId);
            d.prepare('UPDATE tasks SET blocked_by = ? WHERE id = ?').run(JSON.stringify(blockedBy), blocksId);
        }
    },
};

module.exports = { taskStorage };
