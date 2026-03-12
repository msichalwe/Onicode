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

        CREATE TABLE IF NOT EXISTS plans (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            title TEXT NOT NULL,
            overview TEXT DEFAULT '',
            architecture TEXT DEFAULT '',
            components TEXT DEFAULT '[]',
            design_decisions TEXT DEFAULT '[]',
            file_map TEXT DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'draft',
            project_id TEXT,
            project_path TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_plans_session ON plans(session_id);
        CREATE INDEX IF NOT EXISTS idx_plans_project ON plans(project_path);

        -- Workflow definitions
        CREATE TABLE IF NOT EXISTS workflows (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            steps TEXT NOT NULL DEFAULT '[]',
            trigger_config TEXT NOT NULL DEFAULT '{}',
            enabled INTEGER NOT NULL DEFAULT 1,
            project_id TEXT,
            project_path TEXT,
            tags TEXT DEFAULT '[]',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        -- Scheduler entries (cron jobs)
        CREATE TABLE IF NOT EXISTS schedules (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            cron_expression TEXT NOT NULL,
            workflow_id TEXT,
            action TEXT NOT NULL DEFAULT '{}',
            enabled INTEGER NOT NULL DEFAULT 1,
            timezone TEXT DEFAULT 'local',
            last_run_at INTEGER,
            next_run_at INTEGER,
            max_concurrent INTEGER DEFAULT 1,
            rate_limit_seconds INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE SET NULL
        );

        -- Workflow execution history
        CREATE TABLE IF NOT EXISTS workflow_runs (
            id TEXT PRIMARY KEY,
            workflow_id TEXT,
            schedule_id TEXT,
            trigger_type TEXT NOT NULL,
            trigger_data TEXT DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'pending',
            current_step INTEGER DEFAULT 0,
            steps_completed INTEGER DEFAULT 0,
            steps_total INTEGER DEFAULT 0,
            result TEXT DEFAULT '{}',
            error TEXT,
            started_at INTEGER,
            completed_at INTEGER,
            duration_ms INTEGER,
            FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
            FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL
        );

        -- Step-level execution logs
        CREATE TABLE IF NOT EXISTS workflow_step_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            step_index INTEGER NOT NULL,
            step_name TEXT NOT NULL,
            step_type TEXT NOT NULL,
            input TEXT DEFAULT '{}',
            output TEXT DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'pending',
            error TEXT,
            started_at INTEGER,
            completed_at INTEGER,
            duration_ms INTEGER,
            FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
        );

        -- Heartbeat configuration
        CREATE TABLE IF NOT EXISTS heartbeat_config (
            id TEXT PRIMARY KEY DEFAULT 'default',
            enabled INTEGER NOT NULL DEFAULT 0,
            interval_minutes INTEGER NOT NULL DEFAULT 30,
            checklist TEXT NOT NULL DEFAULT '[]',
            last_beat_at INTEGER,
            next_beat_at INTEGER,
            quiet_hours_start TEXT DEFAULT '22:00',
            quiet_hours_end TEXT DEFAULT '08:00',
            max_actions_per_beat INTEGER DEFAULT 3,
            updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run_at);
        CREATE INDEX IF NOT EXISTS idx_schedules_workflow ON schedules(workflow_id);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_started ON workflow_runs(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_step_runs_run ON workflow_step_runs(run_id);
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

    // FTS5 for conversation search (searches across titles and message content)
    try {
        db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
                title, messages_text,
                content='conversations', content_rowid='rowid'
            );
        `);
        // Add a helper column for plain text extraction from JSON messages
        // We'll populate this on save via the conversationStorage.save method
        try {
            db.exec(`ALTER TABLE conversations ADD COLUMN messages_text TEXT DEFAULT ''`);
        } catch { /* column may already exist */ }

        db.exec(`
            CREATE TRIGGER IF NOT EXISTS conversations_ai AFTER INSERT ON conversations BEGIN
                INSERT INTO conversations_fts(rowid, title, messages_text) VALUES (new.rowid, new.title, new.messages_text);
            END;
            CREATE TRIGGER IF NOT EXISTS conversations_ad AFTER DELETE ON conversations BEGIN
                INSERT INTO conversations_fts(conversations_fts, rowid, title, messages_text) VALUES ('delete', old.rowid, old.title, old.messages_text);
            END;
            CREATE TRIGGER IF NOT EXISTS conversations_au AFTER UPDATE ON conversations BEGIN
                INSERT INTO conversations_fts(conversations_fts, rowid, title, messages_text) VALUES ('delete', old.rowid, old.title, old.messages_text);
                INSERT INTO conversations_fts(rowid, title, messages_text) VALUES (new.rowid, new.title, new.messages_text);
            END;
        `);
    } catch (ftsErr) {
        if (!ftsErr.message.includes('already exists')) {
            logger.warn('storage', `Conversations FTS5 setup warning: ${ftsErr.message}`);
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
//  Plan Storage
// ══════════════════════════════════════════

const planStorage = {
    save(plan, sessionId, projectId, projectPath) {
        const d = getDB();
        const now = new Date().toISOString();
        d.prepare(`
            INSERT OR REPLACE INTO plans (id, session_id, title, overview, architecture, components, design_decisions, file_map, status, project_id, project_path, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            plan.id, sessionId, plan.title, plan.overview || '', plan.architecture || '',
            JSON.stringify(plan.components || []), JSON.stringify(plan.designDecisions || []),
            JSON.stringify(plan.fileMap || []), plan.status || 'draft',
            projectId || null, projectPath || null,
            plan.createdAt || now, now,
        );
    },

    update(id, updates) {
        const d = getDB();
        const fields = [];
        const values = [];
        if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
        if (updates.overview !== undefined) { fields.push('overview = ?'); values.push(updates.overview); }
        if (updates.architecture !== undefined) { fields.push('architecture = ?'); values.push(updates.architecture); }
        if (updates.components !== undefined) { fields.push('components = ?'); values.push(JSON.stringify(updates.components)); }
        if (updates.designDecisions !== undefined) { fields.push('design_decisions = ?'); values.push(JSON.stringify(updates.designDecisions)); }
        if (updates.fileMap !== undefined) { fields.push('file_map = ?'); values.push(JSON.stringify(updates.fileMap)); }
        if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
        if (fields.length === 0) return null;
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        d.prepare(`UPDATE plans SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return planStorage.get(id);
    },

    get(id) {
        const d = getDB();
        const row = d.prepare('SELECT * FROM plans WHERE id = ?').get(id);
        if (!row) return null;
        return {
            ...row,
            components: JSON.parse(row.components || '[]'),
            designDecisions: JSON.parse(row.design_decisions || '[]'),
            fileMap: JSON.parse(row.file_map || '[]'),
        };
    },

    getActiveForSession(sessionId) {
        const d = getDB();
        const row = d.prepare("SELECT * FROM plans WHERE session_id = ? AND status != 'archived' ORDER BY updated_at DESC LIMIT 1").get(sessionId);
        if (!row) return null;
        return {
            ...row,
            components: JSON.parse(row.components || '[]'),
            designDecisions: JSON.parse(row.design_decisions || '[]'),
            fileMap: JSON.parse(row.file_map || '[]'),
        };
    },

    listForProject(projectPath) {
        const d = getDB();
        const rows = d.prepare('SELECT id, title, status, overview, created_at, updated_at FROM plans WHERE project_path = ? ORDER BY updated_at DESC').all(projectPath);
        return rows;
    },

    delete(id) {
        const d = getDB();
        d.prepare('DELETE FROM plans WHERE id = ?').run(id);
    },
};

// ══════════════════════════════════════════
//  Conversation Storage
// ══════════════════════════════════════════

/**
 * Extract plain text from a messages array for FTS5 indexing.
 * Pulls out user and assistant text content, strips tool call noise.
 */
function extractConversationText(messages) {
    if (!Array.isArray(messages)) return '';
    return messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => {
            const content = typeof m.content === 'string' ? m.content : '';
            return content.slice(0, 500); // Cap per message to keep index lean
        })
        .filter(Boolean)
        .join(' ')
        .slice(0, 10000); // Max 10K per conversation
}

/**
 * Extract a snippet from conversation text around the matching query terms.
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
        // Extract plain text from messages for FTS indexing
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
        // Try FTS5 first for ranked results
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
        // Fallback to LIKE
        return d.prepare('SELECT id, title, scope, project_id, project_name, updated_at FROM conversations WHERE title LIKE ? OR messages_text LIKE ? OR messages LIKE ? ORDER BY updated_at DESC LIMIT ?')
            .all(`%${query}%`, `%${query}%`, `%${query}%`, limit);
    },

    /** Full search returning conversation snippets (for AI tool use) */
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

    /** Get conversation summary (user messages only, for context recall) */
    getSummary(id) {
        const d = getDB();
        const row = d.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
        if (!row) return null;
        const messages = JSON.parse(row.messages);
        // Extract user + assistant text messages (skip system, skip long tool results)
        const summary = messages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => {
                const content = typeof m.content === 'string' ? m.content : '';
                const prefix = m.role === 'user' ? 'User' : 'AI';
                return `${prefix}: ${content.slice(0, 300)}`;
            })
            .slice(-20) // Last 20 messages
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
//  Workflow Storage
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
//  Schedule Storage
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
//  Workflow Run Storage
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
//  Heartbeat Storage
// ══════════════════════════════════════════

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
        const d = getDB();
        const existing = this.get();
        if (!existing) { this.save({ ...updates }); return; }
        const merged = { ...existing, ...updates };
        if (updates.checklist) merged.checklist = updates.checklist;
        this.save(merged);
    },
};

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
    planStorage,
    conversationStorage,
    sessionStorage,
    attachmentStorage,
    memoryStorage,
    workflowStorage,
    scheduleStorage,
    workflowRunStorage,
    heartbeatStorage,
};
