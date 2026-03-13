/**
 * Memory persistence — unified memory system with FTS5, hotness scoring, relations.
 */

const { getDB } = require('./db');
const { logger } = require('../logger');

const memoryStorage = {
    upsert(category, key, content, projectId) {
        const d = getDB();
        d.prepare(`
            INSERT INTO memories (category, key, content, project_id, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(category, key) DO UPDATE SET content = excluded.content, updated_at = datetime('now')
        `).run(category, key || null, content, projectId || null);
    },

    append(category, key, content, projectId) {
        const d = getDB();
        const existing = d.prepare('SELECT id, content FROM memories WHERE category = ? AND key = ?').get(category, key);
        if (existing) {
            d.prepare("UPDATE memories SET content = content || ?, updated_at = datetime('now') WHERE id = ?")
                .run('\n' + content, existing.id);
        } else {
            this.upsert(category, key, content, projectId);
        }
    },

    get(category, key) {
        const d = getDB();
        return d.prepare('SELECT * FROM memories WHERE category = ? AND key = ?').get(category, key);
    },

    getById(id) {
        const d = getDB();
        return d.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    },

    list(category, projectId, limit = 100) {
        const d = getDB();
        if (category && projectId) {
            return d.prepare('SELECT * FROM memories WHERE category = ? AND project_id = ? ORDER BY updated_at DESC LIMIT ?').all(category, projectId, limit);
        }
        if (category) {
            return d.prepare('SELECT * FROM memories WHERE category = ? ORDER BY updated_at DESC LIMIT ?').all(category, limit);
        }
        if (projectId) {
            return d.prepare('SELECT * FROM memories WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?').all(projectId, limit);
        }
        return d.prepare('SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?').all(limit);
    },

    search(query, category, projectId, limit = 20) {
        const d = getDB();
        try {
            const ftsQuery = query.replace(/['"]/g, '').split(/\s+/).filter(Boolean).map(t => `"${t}"*`).join(' OR ');
            if (!ftsQuery) return [];

            let sql = `
                SELECT m.*, rank
                FROM memories_fts fts
                JOIN memories m ON m.id = fts.rowid
                WHERE memories_fts MATCH ?
            `;
            const params = [ftsQuery];

            if (category) { sql += ' AND m.category = ?'; params.push(category); }
            if (projectId) { sql += ' AND m.project_id = ?'; params.push(projectId); }

            sql += ' ORDER BY rank LIMIT ?';
            params.push(limit);

            return d.prepare(sql).all(...params);
        } catch (err) {
            logger.warn('storage', `FTS search failed, using LIKE fallback: ${err.message}`);
            let sql = 'SELECT * FROM memories WHERE content LIKE ?';
            const params = [`%${query}%`];
            if (category) { sql += ' AND category = ?'; params.push(category); }
            if (projectId) { sql += ' AND project_id = ?'; params.push(projectId); }
            sql += ' ORDER BY updated_at DESC LIMIT ?';
            params.push(limit);
            return d.prepare(sql).all(...params);
        }
    },

    delete(id) {
        const d = getDB();
        d.prepare('DELETE FROM memories WHERE id = ?').run(id);
    },

    deleteByKey(category, key) {
        const d = getDB();
        d.prepare('DELETE FROM memories WHERE category = ? AND key = ?').run(category, key);
    },

    loadCore(projectId) {
        const d = getDB();
        const soul = d.prepare("SELECT content FROM memories WHERE category = 'soul' AND key = 'soul'").get();
        const user = d.prepare("SELECT content FROM memories WHERE category = 'user' AND key = 'profile'").get();
        const longTerm = d.prepare("SELECT content FROM memories WHERE category = 'long-term' AND key = 'MEMORY'").get();
        const projectMem = projectId
            ? d.prepare("SELECT content FROM memories WHERE category = 'project' AND project_id = ? ORDER BY updated_at DESC LIMIT 1").get(projectId)
            : null;

        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const dailyToday = d.prepare("SELECT content FROM memories WHERE category = 'daily' AND key = ?").get(today);
        const dailyYesterday = d.prepare("SELECT content FROM memories WHERE category = 'daily' AND key = ?").get(yesterday);

        const recentFacts = d.prepare(`
            SELECT content, abstract, access_count,
                   COALESCE(last_accessed_at, updated_at) as last_touch
            FROM memories WHERE category = 'fact'
            ORDER BY (
                0.6 * MIN(COALESCE(access_count, 0), 50) / 50.0 +
                0.4 * MAX(0, 1.0 - (julianday('now') - julianday(COALESCE(last_accessed_at, updated_at))) / 30.0)
            ) DESC
            LIMIT 25
        `).all();

        return {
            soul: soul?.content || null,
            user: user?.content || null,
            longTerm: longTerm?.content || null,
            projectMemory: projectMem?.content || null,
            dailyToday: dailyToday?.content || null,
            dailyYesterday: dailyYesterday?.content || null,
            recentFacts: recentFacts.map(f => f.abstract || f.content),
            hasSoul: !!soul,
            hasUserProfile: !!user,
        };
    },

    // Access Tracking (OpenViking hotness)

    trackAccess(id) {
        const d = getDB();
        d.prepare(`
            UPDATE memories SET access_count = COALESCE(access_count, 0) + 1,
                                last_accessed_at = datetime('now')
            WHERE id = ?
        `).run(id);
    },

    trackAccessBulk(ids) {
        if (!ids || ids.length === 0) return;
        const d = getDB();
        const stmt = d.prepare(`
            UPDATE memories SET access_count = COALESCE(access_count, 0) + 1,
                                last_accessed_at = datetime('now')
            WHERE id = ?
        `);
        const tx = d.transaction(() => { for (const id of ids) stmt.run(id); });
        tx();
    },

    setAbstract(id, abstract) {
        const d = getDB();
        d.prepare("UPDATE memories SET abstract = ? WHERE id = ?").run(abstract, id);
    },

    setSource(id, sessionId) {
        const d = getDB();
        d.prepare("UPDATE memories SET source_session = ? WHERE id = ?").run(sessionId, id);
    },

    // Relations (bidirectional links)

    addRelation(sourceId, targetId, relationType = 'related') {
        const d = getDB();
        try {
            d.prepare(`
                INSERT OR IGNORE INTO memory_relations (source_id, target_id, relation_type)
                VALUES (?, ?, ?)
            `).run(sourceId, targetId, relationType);
            d.prepare(`
                INSERT OR IGNORE INTO memory_relations (source_id, target_id, relation_type)
                VALUES (?, ?, ?)
            `).run(targetId, sourceId, relationType);
        } catch { /* ignore constraint violations */ }
    },

    getRelated(memoryId) {
        const d = getDB();
        return d.prepare(`
            SELECT m.*, mr.relation_type FROM memory_relations mr
            JOIN memories m ON m.id = mr.target_id
            WHERE mr.source_id = ?
            ORDER BY m.updated_at DESC LIMIT 20
        `).all(memoryId);
    },

    deleteRelations(memoryId) {
        const d = getDB();
        d.prepare('DELETE FROM memory_relations WHERE source_id = ? OR target_id = ?').run(memoryId, memoryId);
    },

    // Similar Memory Search (for deduplication)

    findSimilar(content, category, limit = 5) {
        const d = getDB();
        try {
            const terms = content.toLowerCase()
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/)
                .filter(t => t.length > 3)
                .slice(0, 8);
            if (terms.length === 0) return [];
            const ftsQuery = terms.map(t => `"${t}"*`).join(' OR ');
            return d.prepare(`
                SELECT m.*, rank FROM memories_fts fts
                JOIN memories m ON m.id = fts.rowid
                WHERE memories_fts MATCH ? AND m.category = ?
                ORDER BY rank LIMIT ?
            `).all(ftsQuery, category, limit);
        } catch {
            return [];
        }
    },

    // Hotness-Ranked Listing

    listByHotness(category, limit = 20) {
        const d = getDB();
        let sql = `
            SELECT *, (
                0.6 * MIN(COALESCE(access_count, 0), 50) / 50.0 +
                0.4 * MAX(0, 1.0 - (julianday('now') - julianday(COALESCE(last_accessed_at, updated_at))) / 30.0)
            ) as hotness FROM memories
        `;
        const params = [];
        if (category) { sql += ' WHERE category = ?'; params.push(category); }
        sql += ' ORDER BY hotness DESC LIMIT ?';
        params.push(limit);
        return d.prepare(sql).all(...params);
    },

    stats() {
        const d = getDB();
        const total = d.prepare('SELECT COUNT(*) as count FROM memories').get();
        const byCategory = d.prepare('SELECT category, COUNT(*) as count FROM memories GROUP BY category').all();
        return { total: total?.count || 0, byCategory };
    },

    migrateFromFiles(memoriesDir, projectsDir) {
        const d = getDB();
        const existing = d.prepare('SELECT COUNT(*) as count FROM memories').get();
        if (existing?.count > 0) return { migrated: 0, message: 'Memories already exist in SQLite' };

        let migrated = 0;
        const _fs = require('fs');
        const _path = require('path');

        if (_fs.existsSync(memoriesDir)) {
            const files = _fs.readdirSync(memoriesDir).filter(f => f.endsWith('.md'));
            for (const file of files) {
                try {
                    const content = _fs.readFileSync(_path.join(memoriesDir, file), 'utf-8');
                    if (!content.trim()) continue;

                    if (file === 'soul.md') {
                        this.upsert('soul', 'soul', content);
                    } else if (file === 'user.md') {
                        this.upsert('user', 'profile', content);
                    } else if (file === 'MEMORY.md') {
                        this.upsert('long-term', 'MEMORY', content);
                    } else if (/^\d{4}-\d{2}-\d{2}\.md$/.test(file)) {
                        this.upsert('daily', file.replace('.md', ''), content);
                    }
                    migrated++;
                } catch { /* skip unreadable */ }
            }
        }

        if (_fs.existsSync(projectsDir)) {
            const projFiles = _fs.readdirSync(projectsDir).filter(f => f.endsWith('.md'));
            for (const file of projFiles) {
                try {
                    const content = _fs.readFileSync(_path.join(projectsDir, file), 'utf-8');
                    if (!content.trim()) continue;
                    const projId = file.replace('.md', '');
                    this.upsert('project', projId, content, projId);
                    migrated++;
                } catch { /* skip */ }
            }
        }

        logger.info('storage', `Migrated ${migrated} memory files to SQLite`);
        return { migrated };
    },
};

module.exports = { memoryStorage };
