/**
 * Database initialization, schema, and connection management.
 * Database: ~/.onicode/onicode.db
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { logger } = require('../logger');

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
            milestone_id TEXT,
            blocks TEXT DEFAULT '[]',
            blocked_by TEXT DEFAULT '[]'
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

        -- Conversation-scoped plans (lightweight)
        CREATE TABLE IF NOT EXISTS conversation_plans (
            id TEXT PRIMARY KEY,
            conversation_id TEXT,
            content TEXT NOT NULL DEFAULT '',
            status TEXT DEFAULT 'drafting',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_conversation_plans_conv ON conversation_plans(conversation_id);

        -- Agent conversations (sub-agent history)
        CREATE TABLE IF NOT EXISTS agent_conversations (
            agent_id TEXT PRIMARY KEY,
            parent_conversation_id TEXT,
            messages TEXT NOT NULL DEFAULT '[]',
            tool_set TEXT,
            agent_type TEXT DEFAULT 'general-purpose',
            status TEXT DEFAULT 'completed',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_conversations_parent ON agent_conversations(parent_conversation_id);

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

    // Migrations for existing databases — add new columns to tasks
    try { db.exec("ALTER TABLE tasks ADD COLUMN blocks TEXT DEFAULT '[]'"); } catch(e) {}
    try { db.exec("ALTER TABLE tasks ADD COLUMN blocked_by TEXT DEFAULT '[]'"); } catch(e) {}

    // OpenViking-inspired memory intelligence columns
    try { db.exec("ALTER TABLE memories ADD COLUMN abstract TEXT"); } catch(e) {}
    try { db.exec("ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0"); } catch(e) {}
    try { db.exec("ALTER TABLE memories ADD COLUMN last_accessed_at TEXT"); } catch(e) {}
    try { db.exec("ALTER TABLE memories ADD COLUMN source_session TEXT"); } catch(e) {}

    // Memory relations (bidirectional links between memories)
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS memory_relations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_id INTEGER NOT NULL,
                target_id INTEGER NOT NULL,
                relation_type TEXT NOT NULL DEFAULT 'related',
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(source_id, target_id, relation_type),
                FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
                FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_memory_relations_source ON memory_relations(source_id);
            CREATE INDEX IF NOT EXISTS idx_memory_relations_target ON memory_relations(target_id);
        `);
    } catch(e) {}

    try { db.exec("CREATE INDEX IF NOT EXISTS idx_memories_access ON memories(access_count DESC)"); } catch(e) {}
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_memories_accessed ON memories(last_accessed_at DESC)"); } catch(e) {}
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

function closeDB() {
    if (db && !db._fallback) {
        try { db.close(); } catch { }
        db = null;
    }
}

module.exports = { getDB, closeDB, DB_PATH };
