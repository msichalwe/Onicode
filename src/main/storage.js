/**
 * SQLite Storage Layer — Persistent storage for tasks, conversations, sessions
 *
 * Replaces in-memory TaskManager storage and localStorage conversations.
 * Database: ~/.onicode/onicode.db
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { logger } = require('./logger');

const DB_PATH = path.join(os.homedir(), '.onicode', 'onicode.db');

let db = null;

function getDB() {
    if (db) return db;

    // Ensure directory exists
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    try {
        const Database = require('better-sqlite3');
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        initSchema();
        logger.info('storage', `SQLite database opened: ${DB_PATH}`);
    } catch (err) {
        logger.error('storage', `Failed to open SQLite: ${err.message}`);
        // Return a mock that does nothing — graceful degradation
        db = createFallback();
        return db;
    }
    return db;
}

function initSchema() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY,
            session_id TEXT NOT NULL,
            content TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            priority TEXT NOT NULL DEFAULT 'medium',
            created_at TEXT NOT NULL,
            completed_at TEXT,
            project_id TEXT,
            project_path TEXT,
            milestone_id TEXT
        );

        CREATE TABLE IF NOT EXISTS milestones (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'open',
            due_date INTEGER,
            project_id TEXT,
            project_path TEXT,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            messages TEXT NOT NULL,
            scope TEXT DEFAULT 'general',
            project_id TEXT,
            project_name TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            started_at INTEGER NOT NULL,
            ended_at INTEGER,
            project_id TEXT,
            project_path TEXT,
            tool_calls INTEGER DEFAULT 0,
            files_created INTEGER DEFAULT 0,
            files_modified INTEGER DEFAULT 0,
            commands_run INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active',
            summary TEXT
        );

        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'file',
            size INTEGER,
            mime_type TEXT,
            url TEXT,
            content TEXT,
            data_url TEXT,
            conversation_id TEXT,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            key TEXT,
            content TEXT NOT NULL,
            project_id TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(category, key)
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_attachments_project ON attachments(project_id);
        CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
        CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
    `);

    // FTS5 virtual table for memory search (created separately — can't be in IF NOT EXISTS block with other tables)
    try {
        db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                content, category, key,
                content='memories', content_rowid='id'
            );
        `);
        // Triggers to keep FTS in sync
        db.exec(`
            CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
                INSERT INTO memories_fts(rowid, content, category, key) VALUES (new.id, new.content, new.category, new.key);
            END;
            CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, content, category, key) VALUES ('delete', old.id, old.content, old.category, old.key);
            END;
            CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, content, category, key) VALUES ('delete', old.id, old.content, old.category, old.key);
                INSERT INTO memories_fts(rowid, content, category, key) VALUES (new.id, new.content, new.category, new.key);
            END;
        `);
    } catch (ftsErr) {
        // FTS5 triggers may already exist — that's fine
        if (!ftsErr.message.includes('already exists')) {
            logger.warn('storage', `FTS5 setup warning: ${ftsErr.message}`);
        }
    }
}

/**
 * Fallback when SQLite is unavailable — stores in-memory with no persistence
 */
function createFallback() {
    logger.warn('storage', 'Using in-memory fallback (no persistence)');
    return {
        _fallback: true,
        prepare: () => ({
            run: () => ({ changes: 0 }),
            get: () => null,
            all: () => [],
        }),
        exec: () => {},
        pragma: () => {},
    };
}

// ══════════════════════════════════════════
//  Task Storage
// ══════════════════════════════════════════

const taskStorage = {
    save(task, sessionId, projectId, projectPath) {
        const d = getDB();
        const stmt = d.prepare(`
            INSERT OR REPLACE INTO tasks (id, session_id, content, status, priority, created_at, completed_at, project_id, project_path, milestone_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(task.id, sessionId, task.content, task.status, task.priority, task.createdAt, task.completedAt, projectId || null, projectPath || null, task.milestoneId || null);
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
        if (fields.length === 0) return;
        values.push(taskId, sessionId);
        d.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ? AND session_id = ?`).run(...values);
    },

    loadSession(sessionId) {
        const d = getDB();
        return d.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY id').all(sessionId);
    },

    /** Load tasks for a project (across ALL sessions), most recent first */
    loadProject(projectPath) {
        const d = getDB();
        return d.prepare(
            'SELECT * FROM tasks WHERE project_path = ? ORDER BY created_at DESC'
        ).all(projectPath);
    },

    /** Load the latest session's tasks for a project.
     *  Searches by task project_path first, then falls back to session project_path. */
    loadLatestProjectSession(projectPath) {
        const d = getDB();
        // Primary: find by task-level project_path
        let row = d.prepare(
            'SELECT session_id FROM tasks WHERE project_path = ? ORDER BY created_at DESC LIMIT 1'
        ).get(projectPath);
        // Fallback: find by session-level project_path (covers tasks saved before project_path was set on them)
        if (!row) {
            row = d.prepare(
                'SELECT t.session_id FROM tasks t INNER JOIN sessions s ON t.session_id = s.id WHERE s.project_path = ? ORDER BY t.created_at DESC LIMIT 1'
            ).get(projectPath);
        }
        if (!row) return [];
        return d.prepare("SELECT * FROM tasks WHERE session_id = ? AND status != 'archived' ORDER BY id").all(row.session_id);
    },

    /** Retroactively update project_path on all tasks in a session (used when init_project runs mid-session) */
    updateSessionProjectPath(sessionId, projectPath, projectId) {
        const d = getDB();
        d.prepare('UPDATE tasks SET project_path = ?, project_id = ? WHERE session_id = ? AND project_path IS NULL')
            .run(projectPath, projectId || null, sessionId);
    },

    /** Archive completed tasks — move done/skipped tasks to an archive flag */
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

    /** Get all tasks for a project grouped by status */
    getProjectTaskSummary(projectPath) {
        const d = getDB();
        const tasks = d.prepare('SELECT * FROM tasks WHERE project_path = ? ORDER BY created_at DESC').all(projectPath);
        return {
            pending: tasks.filter(t => t.status === 'pending'),
            inProgress: tasks.filter(t => t.status === 'in_progress'),
            done: tasks.filter(t => t.status === 'done'),
            archived: tasks.filter(t => t.status === 'archived'),
            skipped: tasks.filter(t => t.status === 'skipped'),
        };
    },
};

// ══════════════════════════════════════════
//  Milestone Storage
// ══════════════════════════════════════════

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
        // Unlink tasks from this milestone
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

    /** Get milestones with task counts */
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

// ══════════════════════════════════════════
//  Conversation Storage
// ══════════════════════════════════════════

const conversationStorage = {
    save(conv) {
        const d = getDB();
        const stmt = d.prepare(`
            INSERT OR REPLACE INTO conversations (id, title, messages, scope, project_id, project_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(conv.id, conv.title, JSON.stringify(conv.messages), conv.scope || 'general', conv.projectId || null, conv.projectName || null, conv.createdAt, conv.updatedAt);
    },

    get(id) {
        const d = getDB();
        const row = d.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
        if (!row) return null;
        return { ...row, messages: JSON.parse(row.messages) };
    },

    list(limit = 50, offset = 0) {
        const d = getDB();
        const rows = d.prepare('SELECT id, title, scope, project_id, project_name, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT ? OFFSET ?').all(limit, offset);
        return rows;
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

    /** Get the most recent conversation for a project */
    getLatestForProject(projectId) {
        const d = getDB();
        const row = d.prepare('SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1').get(projectId);
        if (!row) return null;
        return { ...row, messages: JSON.parse(row.messages) };
    },

    search(query, limit = 20) {
        const d = getDB();
        return d.prepare('SELECT id, title, scope, project_id, updated_at FROM conversations WHERE title LIKE ? OR messages LIKE ? ORDER BY updated_at DESC LIMIT ?')
            .all(`%${query}%`, `%${query}%`, limit);
    },

    count() {
        const d = getDB();
        const row = d.prepare('SELECT COUNT(*) as count FROM conversations').get();
        return row?.count || 0;
    },

    /** Migrate conversations from localStorage JSON array */
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

// ══════════════════════════════════════════
//  Session Storage
// ══════════════════════════════════════════

const sessionStorage = {
    create(id, projectId, projectPath) {
        const d = getDB();
        d.prepare('INSERT INTO sessions (id, started_at, project_id, project_path) VALUES (?, ?, ?, ?)')
            .run(id, Date.now(), projectId || null, projectPath || null);
    },

    /** Update session's project info (used when init_project assigns a project mid-session) */
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
            const col = key.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase -> snake_case
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

// ══════════════════════════════════════════
//  Attachment Storage (project-scoped)
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
//  Memory Storage (unified — replaces markdown files)
// ══════════════════════════════════════════

const memoryStorage = {
    /** Upsert a memory by category+key. If key exists, update content. */
    upsert(category, key, content, projectId) {
        const d = getDB();
        d.prepare(`
            INSERT INTO memories (category, key, content, project_id, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(category, key) DO UPDATE SET content = excluded.content, updated_at = datetime('now')
        `).run(category, key || null, content, projectId || null);
    },

    /** Append content to an existing memory (or create it). */
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

    /** Get a single memory by category+key. */
    get(category, key) {
        const d = getDB();
        return d.prepare('SELECT * FROM memories WHERE category = ? AND key = ?').get(category, key);
    },

    /** Get a memory by ID. */
    getById(id) {
        const d = getDB();
        return d.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    },

    /** List memories by category (optional project filter). */
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

    /** Full-text search across all memories using FTS5. */
    search(query, category, projectId, limit = 20) {
        const d = getDB();
        try {
            // FTS5 query — escape special chars, use prefix matching
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
            // Fallback to LIKE search if FTS fails
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

    /** Delete a memory by ID. */
    delete(id) {
        const d = getDB();
        d.prepare('DELETE FROM memories WHERE id = ?').run(id);
    },

    /** Delete by category+key. */
    deleteByKey(category, key) {
        const d = getDB();
        d.prepare('DELETE FROM memories WHERE category = ? AND key = ?').run(category, key);
    },

    /** Load core memories for system prompt injection. */
    loadCore(projectId) {
        const d = getDB();
        const soul = d.prepare("SELECT content FROM memories WHERE category = 'soul' AND key = 'soul'").get();
        const user = d.prepare("SELECT content FROM memories WHERE category = 'user' AND key = 'profile'").get();
        const longTerm = d.prepare("SELECT content FROM memories WHERE category = 'long-term' AND key = 'MEMORY'").get();
        const projectMem = projectId
            ? d.prepare("SELECT content FROM memories WHERE category = 'project' AND project_id = ? ORDER BY updated_at DESC LIMIT 1").get(projectId)
            : null;

        // Daily logs: today + yesterday
        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const dailyToday = d.prepare("SELECT content FROM memories WHERE category = 'daily' AND key = ?").get(today);
        const dailyYesterday = d.prepare("SELECT content FROM memories WHERE category = 'daily' AND key = ?").get(yesterday);

        // Recent facts (last 20 individual facts/preferences)
        const recentFacts = d.prepare("SELECT content FROM memories WHERE category = 'fact' ORDER BY updated_at DESC LIMIT 20").all();

        return {
            soul: soul?.content || null,
            user: user?.content || null,
            longTerm: longTerm?.content || null,
            projectMemory: projectMem?.content || null,
            dailyToday: dailyToday?.content || null,
            dailyYesterday: dailyYesterday?.content || null,
            recentFacts: recentFacts.map(f => f.content),
            hasSoul: !!soul,
            hasUserProfile: !!user,
        };
    },

    /** Get summary stats. */
    stats() {
        const d = getDB();
        const total = d.prepare('SELECT COUNT(*) as count FROM memories').get();
        const byCategory = d.prepare('SELECT category, COUNT(*) as count FROM memories GROUP BY category').all();
        return { total: total?.count || 0, byCategory };
    },

    /** Migrate from markdown files (one-time). */
    migrateFromFiles(memoriesDir, projectsDir) {
        const d = getDB();
        const existing = d.prepare('SELECT COUNT(*) as count FROM memories').get();
        if (existing?.count > 0) return { migrated: 0, message: 'Memories already exist in SQLite' };

        let migrated = 0;
        const _fs = require('fs');
        const _path = require('path');

        // Migrate global files
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

        // Migrate project files
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

// ══════════════════════════════════════════
//  Close / Cleanup
// ══════════════════════════════════════════

function closeDB() {
    if (db && !db._fallback) {
        try { db.close(); } catch { }
        db = null;
    }
}

module.exports = {
    getDB,
    closeDB,
    taskStorage,
    milestoneStorage,
    conversationStorage,
    sessionStorage,
    attachmentStorage,
    memoryStorage,
};
