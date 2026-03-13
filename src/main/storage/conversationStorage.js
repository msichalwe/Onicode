/**
 * Conversation persistence — save, load, search (FTS5), migrate from localStorage.
 */

const { getDB } = require('./db');
const { logger } = require('../logger');

/**
 * Extract plain text from a messages array for FTS5 indexing.
 */
function extractConversationText(messages) {
    if (!Array.isArray(messages)) return '';
    return messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => {
            const content = typeof m.content === 'string' ? m.content : '';
            return content.slice(0, 500);
        })
        .filter(Boolean)
        .join(' ')
        .slice(0, 10000);
}

/**
 * Extract a snippet from conversation text around matching query terms.
 */
function extractConversationSnippet(text, query) {
    if (!text || !query) return text?.slice(0, 200) || '';
    const lower = text.toLowerCase();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    for (const term of terms) {
        const idx = lower.indexOf(term);
        if (idx >= 0) {
            const start = Math.max(0, idx - 100);
            const end = Math.min(text.length, idx + term.length + 100);
            return (start > 0 ? '...' : '') + text.slice(start, end).trim() + (end < text.length ? '...' : '');
        }
    }
    return text.slice(0, 200) + (text.length > 200 ? '...' : '');
}

const conversationStorage = {
    save(conv) {
        const d = getDB();
        const messagesText = extractConversationText(conv.messages);
        const stmt = d.prepare(`
            INSERT OR REPLACE INTO conversations (id, title, messages, messages_text, scope, project_id, project_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(conv.id, conv.title, JSON.stringify(conv.messages), messagesText, conv.scope || 'general', conv.projectId || null, conv.projectName || null, conv.createdAt, conv.updatedAt);
    },

    get(id) {
        const d = getDB();
        const row = d.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
        if (!row) return null;
        return { ...row, messages: JSON.parse(row.messages) };
    },

    list(limit = 50, offset = 0) {
        const d = getDB();
        return d.prepare('SELECT id, title, scope, project_id, project_name, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT ? OFFSET ?').all(limit, offset);
    },

    listFull(limit = 50) {
        const d = getDB();
        const rows = d.prepare('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?').all(limit);
        return rows.map(r => ({ ...r, messages: JSON.parse(r.messages) }));
    },

    delete(id) {
        const d = getDB();
        d.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    },

    getLatestForProject(projectId) {
        const d = getDB();
        const row = d.prepare('SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1').get(projectId);
        if (!row) return null;
        return { ...row, messages: JSON.parse(row.messages) };
    },

    search(query, limit = 20) {
        const d = getDB();
        try {
            const ftsQuery = query.replace(/['"]/g, '').split(/\s+/).filter(Boolean).map(t => `"${t}"*`).join(' OR ');
            if (ftsQuery) {
                const rows = d.prepare(`
                    SELECT c.id, c.title, c.scope, c.project_id, c.project_name, c.updated_at, rank
                    FROM conversations_fts fts
                    JOIN conversations c ON c.rowid = fts.rowid
                    WHERE conversations_fts MATCH ?
                    ORDER BY rank
                    LIMIT ?
                `).all(ftsQuery, limit);
                if (rows.length > 0) return rows;
            }
        } catch { /* FTS not available, fall through */ }
        return d.prepare('SELECT id, title, scope, project_id, project_name, updated_at FROM conversations WHERE title LIKE ? OR messages_text LIKE ? OR messages LIKE ? ORDER BY updated_at DESC LIMIT ?')
            .all(`%${query}%`, `%${query}%`, `%${query}%`, limit);
    },

    searchWithSnippets(query, limit = 10) {
        const d = getDB();
        const results = this.search(query, limit);
        return results.map(r => {
            const full = d.prepare('SELECT messages_text, messages FROM conversations WHERE id = ?').get(r.id);
            const text = full?.messages_text || '';
            const snippet = extractConversationSnippet(text, query);
            return { ...r, snippet };
        });
    },

    getSummary(id) {
        const d = getDB();
        const row = d.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
        if (!row) return null;
        const messages = JSON.parse(row.messages);
        const summary = messages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => {
                const content = typeof m.content === 'string' ? m.content : '';
                const prefix = m.role === 'user' ? 'User' : 'AI';
                return `${prefix}: ${content.slice(0, 300)}`;
            })
            .slice(-20)
            .join('\n');
        return {
            id: row.id,
            title: row.title,
            scope: row.scope,
            projectId: row.project_id,
            projectName: row.project_name,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            messageCount: messages.length,
            summary: summary.slice(0, 3000),
        };
    },

    count() {
        const d = getDB();
        const row = d.prepare('SELECT COUNT(*) as count FROM conversations').get();
        return row?.count || 0;
    },

    migrateFromLocalStorage(conversations) {
        const d = getDB();
        const existingCount = this.count();
        if (existingCount > 0) return { migrated: 0, message: 'Database already has conversations' };

        const stmt = d.prepare(`
            INSERT OR IGNORE INTO conversations (id, title, messages, scope, project_id, project_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const migrate = d.transaction((convs) => {
            let count = 0;
            for (const conv of convs) {
                stmt.run(conv.id, conv.title, JSON.stringify(conv.messages), conv.scope || 'general', conv.projectId || null, conv.projectName || null, conv.createdAt, conv.updatedAt);
                count++;
            }
            return count;
        });

        const migrated = migrate(conversations);
        logger.info('storage', `Migrated ${migrated} conversations from localStorage to SQLite`);
        return { migrated };
    },
};

module.exports = { conversationStorage };
