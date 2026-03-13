/**
 * Session persistence — track AI working sessions.
 */

const { getDB } = require('./db');

const sessionStorage = {
    create(id, projectId, projectPath) {
        const d = getDB();
        d.prepare('INSERT INTO sessions (id, started_at, project_id, project_path) VALUES (?, ?, ?, ?)')
            .run(id, Date.now(), projectId || null, projectPath || null);
    },

    updateProjectPath(id, projectId, projectPath) {
        const d = getDB();
        d.prepare('UPDATE sessions SET project_id = ?, project_path = ? WHERE id = ?')
            .run(projectId || null, projectPath || null, id);
    },

    update(id, updates) {
        const d = getDB();
        const fields = [];
        const values = [];
        for (const [key, val] of Object.entries(updates)) {
            const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
            fields.push(`${col} = ?`);
            values.push(val);
        }
        if (fields.length === 0) return;
        values.push(id);
        d.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    },

    end(id, summary) {
        const d = getDB();
        d.prepare('UPDATE sessions SET ended_at = ?, status = ?, summary = ? WHERE id = ?')
            .run(Date.now(), 'completed', summary || null, id);
    },

    getRecent(limit = 10) {
        const d = getDB();
        return d.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?').all(limit);
    },
};

module.exports = { sessionStorage };
