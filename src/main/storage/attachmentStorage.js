/**
 * Attachment persistence — project-scoped file/link attachments.
 */

const { getDB } = require('./db');

const attachmentStorage = {
    save(att) {
        const d = getDB();
        d.prepare(`
            INSERT OR REPLACE INTO attachments (id, project_id, name, type, size, mime_type, url, content, data_url, conversation_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(att.id, att.projectId, att.name, att.type || 'file', att.size || null, att.mimeType || null, att.url || null, att.content || null, att.dataUrl || null, att.conversationId || null, att.createdAt || Date.now());
    },

    listByProject(projectId) {
        const d = getDB();
        return d.prepare('SELECT * FROM attachments WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
    },

    get(id) {
        const d = getDB();
        return d.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
    },

    delete(id) {
        const d = getDB();
        d.prepare('DELETE FROM attachments WHERE id = ?').run(id);
    },

    deleteByProject(projectId) {
        const d = getDB();
        d.prepare('DELETE FROM attachments WHERE project_id = ?').run(projectId);
    },
};

module.exports = { attachmentStorage };
