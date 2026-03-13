/**
 * Milestone persistence — project-scoped milestones with task counts.
 */

const { getDB } = require('./db');

const milestoneStorage = {
    save(milestone, projectId, projectPath) {
        const d = getDB();
        d.prepare(`
            INSERT OR REPLACE INTO milestones (id, title, description, status, due_date, project_id, project_path, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(milestone.id, milestone.title, milestone.description || '', milestone.status || 'open', milestone.dueDate || null, projectId || null, projectPath || null, milestone.createdAt || Date.now());
    },

    update(id, updates) {
        const d = getDB();
        const fields = [];
        const values = [];
        if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
        if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
        if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
        if (updates.dueDate !== undefined) { fields.push('due_date = ?'); values.push(updates.dueDate); }
        if (fields.length === 0) return;
        values.push(id);
        d.prepare(`UPDATE milestones SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    },

    delete(id) {
        const d = getDB();
        d.prepare('UPDATE tasks SET milestone_id = NULL WHERE milestone_id = ?').run(id);
        d.prepare('DELETE FROM milestones WHERE id = ?').run(id);
    },

    loadProject(projectPath) {
        const d = getDB();
        return d.prepare('SELECT * FROM milestones WHERE project_path = ? ORDER BY created_at').all(projectPath);
    },

    get(id) {
        const d = getDB();
        return d.prepare('SELECT * FROM milestones WHERE id = ?').get(id);
    },

    getProjectSummary(projectPath) {
        const d = getDB();
        const milestones = d.prepare('SELECT * FROM milestones WHERE project_path = ? ORDER BY created_at').all(projectPath);
        return milestones.map(ms => {
            const tasks = d.prepare('SELECT status FROM tasks WHERE milestone_id = ?').all(ms.id);
            return {
                ...ms,
                dueDate: ms.due_date,
                taskCount: tasks.length,
                tasksDone: tasks.filter(t => t.status === 'done').length,
                tasksInProgress: tasks.filter(t => t.status === 'in_progress').length,
            };
        });
    },
};

module.exports = { milestoneStorage };
