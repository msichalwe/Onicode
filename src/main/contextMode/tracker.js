/**
 * Session Event Tracker — tracks tool calls, user actions, and session state
 * as structured events. Builds compact resume snapshots for session continuation.
 * Tables: ctx_session_events, ctx_session_resume, ctx_session_meta
 */
const crypto = require('crypto');
const { logger } = require('../logger');

// ── Constants ──
const MAX_EVENTS_PER_SESSION = 1000;
const DEDUP_WINDOW = 5;
const MAX_SNAPSHOT_BYTES = 2048;
const MAX_ACTIVE_FILES = 10;
const PRIORITY_BUDGET = { P1: 0.50, P2: 0.35, P3_P4: 0.15 };

// ── Priority & category mappings ──
const TYPE_PRIORITY = {
    file_read: 1, file_write: 1, file_create: 1, file_delete: 1,
    file_glob: 1, file_search: 1, task_create: 1, task_update: 1, rule: 1,
    decision: 2, git_commit: 2, git_checkout: 2, git_merge: 2,
    git_push: 2, git_pull: 2, error_tool: 2, cwd_change: 2, env_setup: 2,
    mcp_call: 3, subagent_launched: 3, subagent_completed: 3, skill_used: 3,
    session_intent: 4, large_data_ref: 4, role: 4,
};
const TYPE_CATEGORY = {
    file_read: 'file', file_write: 'file', file_create: 'file',
    file_delete: 'file', file_glob: 'file', file_search: 'file',
    task_create: 'task', task_update: 'task', rule: 'rule',
    decision: 'decision', git_commit: 'git', git_checkout: 'git',
    git_merge: 'git', git_push: 'git', git_pull: 'git',
    error_tool: 'error', cwd_change: 'cwd', env_setup: 'env',
    mcp_call: 'mcp', subagent_launched: 'subagent', subagent_completed: 'subagent',
    skill_used: 'skill', session_intent: 'intent', large_data_ref: 'data', role: 'intent',
};

// ── Lazy DB init ──
let _initialized = false;

function ensureSchema() {
    if (_initialized) return;
    try {
        const { getDB } = require('../storage');
        const d = getDB();
        if (d._fallback) { _initialized = true; return; }
        d.exec(`
            CREATE TABLE IF NOT EXISTS ctx_session_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL, type TEXT NOT NULL,
                category TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 2,
                data TEXT NOT NULL, source_hook TEXT NOT NULL DEFAULT 'tool',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                data_hash TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_ctx_events_session ON ctx_session_events(session_id);
            CREATE INDEX IF NOT EXISTS idx_ctx_events_priority ON ctx_session_events(session_id, priority);
            CREATE TABLE IF NOT EXISTS ctx_session_resume (
                session_id TEXT PRIMARY KEY, snapshot TEXT NOT NULL,
                event_count INTEGER DEFAULT 0, consumed INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS ctx_session_meta (
                session_id TEXT PRIMARY KEY, project_dir TEXT,
                started_at TEXT DEFAULT (datetime('now')), last_event_at TEXT,
                event_count INTEGER DEFAULT 0, compact_count INTEGER DEFAULT 0
            );
        `);
        _initialized = true;
        logger.debug('ctx-tracker', 'Schema initialized');
    } catch (err) {
        logger.error('ctx-tracker', `Schema init failed: ${err.message}`);
        _initialized = true;
    }
}

function db() {
    ensureSchema();
    const { getDB } = require('../storage');
    return getDB();
}

function hashEvent(type, data) {
    return crypto.createHash('sha256').update(`${type}:${data}`).digest('hex').slice(0, 16);
}

function makeEvent(type, data) {
    return {
        type,
        category: TYPE_CATEGORY[type] || 'data',
        priority: TYPE_PRIORITY[type] || 4,
        data: typeof data === 'string' ? data : JSON.stringify(data),
    };
}

// ── extractEvents — maps tool calls to event arrays ──

function extractEvents(toolName, toolArgs, toolResult) {
    const args = toolArgs || {};
    const result = toolResult || {};
    const events = [];

    switch (toolName) {
        case 'read_file': {
            events.push(makeEvent('file_read', { path: args.path }));
            const name = (args.path || '').toLowerCase();
            if (name.endsWith('.claude.md') || name.endsWith('agents.md') || name.endsWith('.cursorrules'))
                events.push(makeEvent('rule', { path: args.path, source: toolName }));
            break;
        }
        case 'edit_file': case 'multi_edit':
            events.push(makeEvent('file_write', { path: args.path || args.file_path })); break;
        case 'create_file':
            events.push(makeEvent('file_create', { path: args.path || args.file_path })); break;
        case 'delete_file':
            events.push(makeEvent('file_delete', { path: args.path || args.file_path })); break;
        case 'search_files':
            events.push(makeEvent('file_search', { query: (args.query || args.pattern || '').slice(0, 120) })); break;
        case 'glob_files':
            events.push(makeEvent('file_glob', { pattern: (args.pattern || '').slice(0, 120) })); break;

        case 'run_command': {
            const cmd = (args.command || '').trim();
            if (/^git\s+commit/i.test(cmd)) {
                const m = cmd.match(/-m\s+["']([^"']+)/);
                events.push(makeEvent('git_commit', { message: m ? m[1].slice(0, 100) : '' }));
            } else if (/^git\s+checkout/i.test(cmd)) {
                events.push(makeEvent('git_checkout', { branch: cmd.split(/\s+/).pop() }));
            } else if (/^git\s+push/i.test(cmd))  events.push(makeEvent('git_push', { command: cmd.slice(0, 100) }));
            else if (/^git\s+pull/i.test(cmd))     events.push(makeEvent('git_pull', { command: cmd.slice(0, 100) }));
            else if (/^git\s+merge/i.test(cmd))    events.push(makeEvent('git_merge', { command: cmd.slice(0, 100) }));
            if (/^\s*cd\s+/.test(cmd))
                events.push(makeEvent('cwd_change', { dir: cmd.replace(/^\s*cd\s+/, '').replace(/["']/g, '').trim() }));
            if (/\b(nvm|conda|pip|npm\s+install|yarn\s+add|pnpm\s+add)\b/i.test(cmd))
                events.push(makeEvent('env_setup', { command: cmd.slice(0, 120) }));
            const exitCode = result.exit_code ?? result.exitCode;
            if (exitCode !== undefined && exitCode !== 0)
                events.push(makeEvent('error_tool', { command: cmd.slice(0, 80), exitCode, stderr: (result.stderr || result.error || '').slice(0, 200) }));
            break;
        }

        case 'task_add':
            events.push(makeEvent('task_create', { content: (args.content || '').slice(0, 120) })); break;
        case 'task_update':
            events.push(makeEvent('task_update', { taskId: args.task_id, status: args.status })); break;
        case 'git_commit':
            events.push(makeEvent('git_commit', { message: (args.message || '').slice(0, 100) })); break;
        case 'git_checkout':
            events.push(makeEvent('git_checkout', { branch: args.branch })); break;
        case 'git_push':
            events.push(makeEvent('git_push', {})); break;
        case 'git_pull':
            events.push(makeEvent('git_pull', {})); break;
        case 'git_merge':
            events.push(makeEvent('git_merge', { branch: args.branch })); break;
        case 'memory_save_fact':
            events.push(makeEvent('decision', { fact: (args.fact || '').slice(0, 150) })); break;
        case 'ask_user_question':
            events.push(makeEvent('decision', { question: (args.question || '').slice(0, 120), answer: (result.answer || '').slice(0, 80) })); break;
        case 'spawn_sub_agent':
            events.push(makeEvent('subagent_launched', { task: (args.task || '').slice(0, 120), role: args.role })); break;

        default:
            if (toolName.startsWith('mcp_'))
                events.push(makeEvent('mcp_call', { tool: toolName, args: JSON.stringify(args).slice(0, 100) }));
            break;
    }
    return events;
}

// ── extractUserEvents — parse user messages for implicit events ──

const CORRECTION_RE = /\b(instead|don't|dont|actually|prefer|stop\s+doing|not\s+that|wrong|no,?\s+use)\b/i;
const ROLE_RE = /\b(you\s+are|act\s+as|pretend|behave\s+like|your\s+role)\b/i;
const INTENT_MAP = {
    fix: 'fix', debug: 'fix', repair: 'fix',
    build: 'build', create: 'build', implement: 'build', add: 'build',
    refactor: 'refactor', clean: 'refactor', reorganize: 'refactor',
    test: 'test', spec: 'test', coverage: 'test',
    deploy: 'deploy', publish: 'deploy', release: 'deploy', ship: 'deploy',
    explain: 'explain', describe: 'explain', how: 'explain', why: 'explain',
};

function extractUserEvents(userMessage) {
    if (!userMessage || typeof userMessage !== 'string') return [];
    const text = userMessage.trim();
    if (!text) return [];
    const events = [];
    if (CORRECTION_RE.test(text))
        events.push(makeEvent('decision', { user_correction: text.slice(0, 150) }));
    if (ROLE_RE.test(text))
        events.push(makeEvent('role', { directive: text.slice(0, 150) }));
    const head = text.slice(0, 60).toLowerCase();
    for (const [keyword, intent] of Object.entries(INTENT_MAP)) {
        if (head.includes(keyword)) {
            events.push(makeEvent('session_intent', { intent, snippet: text.slice(0, 80) }));
            break;
        }
    }
    return events;
}

// ── insertEvent — dedup + eviction ──

function insertEvent(sessionId, event, sourceHook = 'tool') {
    try {
        const d = db();
        if (d._fallback) return;
        const dataStr = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
        const hash = hashEvent(event.type, dataStr);

        // Dedup check
        const recent = d.prepare(
            'SELECT data_hash FROM ctx_session_events WHERE session_id = ? ORDER BY id DESC LIMIT ?'
        ).all(sessionId, DEDUP_WINDOW);
        if (recent.some(r => r.data_hash === hash)) return;

        d.prepare(
            `INSERT INTO ctx_session_events (session_id, type, category, priority, data, source_hook, data_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(sessionId, event.type, event.category || TYPE_CATEGORY[event.type] || 'data',
              event.priority ?? TYPE_PRIORITY[event.type] ?? 2, dataStr, sourceHook, hash);

        // Evict lowest-priority oldest if over limit
        const { cnt } = d.prepare('SELECT COUNT(*) as cnt FROM ctx_session_events WHERE session_id = ?').get(sessionId);
        if (cnt > MAX_EVENTS_PER_SESSION) {
            d.prepare(
                `DELETE FROM ctx_session_events WHERE id = (
                    SELECT id FROM ctx_session_events WHERE session_id = ?
                    ORDER BY priority DESC, created_at ASC LIMIT 1)`
            ).run(sessionId);
        }

        // Update meta
        d.prepare(
            `INSERT INTO ctx_session_meta (session_id, last_event_at, event_count)
             VALUES (?, datetime('now'), 1)
             ON CONFLICT(session_id) DO UPDATE SET
                last_event_at = datetime('now'), event_count = event_count + 1`
        ).run(sessionId);
    } catch (err) {
        logger.error('ctx-tracker', `insertEvent failed: ${err.message}`);
    }
}

// ── getEvents — filtered retrieval ──

function getEvents(sessionId, opts = {}) {
    try {
        const d = db();
        if (d._fallback) return [];
        const clauses = ['session_id = ?'];
        const params = [sessionId];
        if (opts.type)        { clauses.push('type = ?');     params.push(opts.type); }
        if (opts.category)    { clauses.push('category = ?'); params.push(opts.category); }
        if (opts.minPriority) { clauses.push('priority <= ?'); params.push(opts.minPriority); }
        const limit = opts.limit || 100;
        params.push(limit);
        return d.prepare(
            `SELECT * FROM ctx_session_events WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
        ).all(...params);
    } catch (err) {
        logger.error('ctx-tracker', `getEvents failed: ${err.message}`);
        return [];
    }
}

// ── buildSnapshot — compact session state within byte budget ──

function safeParse(json) { try { return JSON.parse(json); } catch { return null; } }

function buildSnapshot(sessionId, maxBytes = MAX_SNAPSHOT_BYTES) {
    try {
        const d = db();
        if (d._fallback) return '<session_state />';
        const allEvents = d.prepare(
            'SELECT type, category, priority, data, created_at FROM ctx_session_events WHERE session_id = ? ORDER BY created_at ASC'
        ).all(sessionId);
        if (!allEvents.length) return '<session_state />';

        // Group by category
        const grouped = {};
        for (const ev of allEvents) {
            (grouped[ev.category] || (grouped[ev.category] = [])).push(ev);
        }
        const sections = [];

        // P1: Files — deduplicated, last MAX_ACTIVE_FILES, with op counts
        if (grouped.file) {
            const counts = {};
            for (const ev of grouped.file) {
                const p = safeParse(ev.data);
                if (!p) continue;
                const key = p.path || p.query || p.pattern || '?';
                if (!counts[key]) counts[key] = {};
                const op = ev.type.replace('file_', '');
                counts[key][op] = (counts[key][op] || 0) + 1;
            }
            const recent = Object.entries(counts).slice(-MAX_ACTIVE_FILES);
            const text = recent.map(([f, ops]) =>
                `${f} (${Object.entries(ops).map(([o, c]) => `${o}:${c}`).join(', ')})`
            ).join(', ');
            if (text) sections.push({ tag: 'files', text, priority: 1 });
        }

        // P1: Tasks
        if (grouped.task) {
            const taskMap = {};
            for (const ev of grouped.task) {
                const p = safeParse(ev.data);
                if (!p) continue;
                if (ev.type === 'task_create') {
                    const id = p.taskId || Object.keys(taskMap).length + 1;
                    taskMap[id] = { content: p.content, status: 'pending' };
                } else if (ev.type === 'task_update' && p.taskId && taskMap[p.taskId]) {
                    taskMap[p.taskId].status = p.status || taskMap[p.taskId].status;
                }
            }
            const text = Object.entries(taskMap).map(([id, t]) => `${id}. ${t.content} [${t.status}]`).join(', ');
            if (text) sections.push({ tag: 'tasks', text, priority: 1 });
        }

        // P1: Rules
        if (grouped.rule) {
            const rules = [...new Set(grouped.rule.map(ev => {
                const p = safeParse(ev.data); return p ? (p.path || p.source || 'rule') : null;
            }).filter(Boolean))];
            if (rules.length) sections.push({ tag: 'rules', text: rules.join(', '), priority: 1 });
        }

        // P2: Decisions
        if (grouped.decision) {
            const decs = grouped.decision.slice(-5).map(ev => {
                const p = safeParse(ev.data); return p ? (p.fact || p.user_correction || p.question || '') : '';
            }).filter(Boolean);
            if (decs.length) sections.push({ tag: 'decisions', text: decs.join('; '), priority: 2 });
        }

        // P2: Errors (unique)
        if (grouped.error) {
            const seen = new Set(), errs = [];
            for (const ev of grouped.error) {
                const p = safeParse(ev.data); if (!p) continue;
                const key = p.stderr || p.command || '';
                if (key && !seen.has(key)) { seen.add(key); errs.push(key.slice(0, 80)); }
            }
            if (errs.length) sections.push({ tag: 'errors', text: errs.slice(-3).join('; '), priority: 2 });
        }

        // P2: Git (last op)
        if (grouped.git) {
            const last = grouped.git[grouped.git.length - 1];
            const p = safeParse(last.data) || {};
            let info = last.type === 'git_commit' ? `commit "${p.message || ''}"`
                     : last.type === 'git_checkout' ? `branch: ${p.branch || '?'}`
                     : last.type.replace('git_', '');
            sections.push({ tag: 'git', text: `Last: ${info}`, priority: 2 });
        }

        // P2: Environment
        const envParts = [];
        if (grouped.cwd) {
            const p = safeParse(grouped.cwd[grouped.cwd.length - 1].data);
            if (p) envParts.push(`cwd: ${p.dir}`);
        }
        if (grouped.env) {
            const p = safeParse(grouped.env[grouped.env.length - 1].data);
            if (p && p.command) envParts.push(p.command);
        }
        if (envParts.length) sections.push({ tag: 'environment', text: envParts.join(', '), priority: 2 });

        // P3: MCP tools
        if (grouped.mcp) {
            const tools = [...new Set(grouped.mcp.map(ev => { const p = safeParse(ev.data); return p ? p.tool : ''; }).filter(Boolean))];
            if (tools.length) sections.push({ tag: 'mcp', text: tools.join(', '), priority: 3 });
        }

        // P3: Subagents
        if (grouped.subagent) {
            const agents = grouped.subagent.slice(-3).map(ev => { const p = safeParse(ev.data); return p ? (p.task || p.role || ev.type) : ev.type; });
            if (agents.length) sections.push({ tag: 'subagents', text: agents.join('; '), priority: 3 });
        }

        // P4: Intent
        if (grouped.intent) {
            const intents = grouped.intent.slice(-2).map(ev => { const p = safeParse(ev.data); return p ? (p.intent || p.directive || '') : ''; }).filter(Boolean);
            if (intents.length) sections.push({ tag: 'intent', text: intents.join(', '), priority: 4 });
        }

        return assembleSnapshot(sections, maxBytes);
    } catch (err) {
        logger.error('ctx-tracker', `buildSnapshot failed: ${err.message}`);
        return '<session_state />';
    }
}

/** Assemble sections into XML-like snapshot, dropping lowest-priority if over budget. */
function assembleSnapshot(sections, maxBytes) {
    sections.sort((a, b) => a.priority - b.priority);
    const WRAPPER = '<session_state>\n</session_state>\n'.length;
    let budget = maxBytes - WRAPPER;
    const included = [];
    for (const sec of sections) {
        const line = `<${sec.tag}>${sec.text}</${sec.tag}>\n`;
        if (line.length <= budget) {
            included.push(line);
            budget -= line.length;
        } else if (budget > 20) {
            const tagOH = `<${sec.tag}></${sec.tag}>\n`.length;
            const avail = budget - tagOH;
            if (avail > 10) included.push(`<${sec.tag}>${sec.text.slice(0, avail)}</${sec.tag}>\n`);
            break;
        } else break;
    }
    if (!included.length) return '<session_state />';
    return `<session_state>\n${included.join('')}</session_state>`;
}

// ── saveSnapshot / getSnapshot / markSnapshotConsumed ──

function saveSnapshot(sessionId) {
    try {
        const d = db();
        if (d._fallback) return { snapshot: '', eventCount: 0 };
        const snapshot = buildSnapshot(sessionId);
        const { cnt } = d.prepare('SELECT COUNT(*) as cnt FROM ctx_session_events WHERE session_id = ?').get(sessionId);
        d.prepare(
            `INSERT INTO ctx_session_resume (session_id, snapshot, event_count, consumed)
             VALUES (?, ?, ?, 0)
             ON CONFLICT(session_id) DO UPDATE SET
                snapshot = excluded.snapshot, event_count = excluded.event_count,
                consumed = 0, created_at = datetime('now')`
        ).run(sessionId, snapshot, cnt);
        logger.debug('ctx-tracker', `Snapshot saved: ${sessionId.slice(0, 8)}, ${snapshot.length}b, ${cnt} events`);
        return { snapshot, eventCount: cnt };
    } catch (err) {
        logger.error('ctx-tracker', `saveSnapshot failed: ${err.message}`);
        return { snapshot: '', eventCount: 0 };
    }
}

function getSnapshot(sessionId) {
    try {
        const d = db();
        if (d._fallback) return null;
        const row = d.prepare('SELECT snapshot, event_count, consumed FROM ctx_session_resume WHERE session_id = ?').get(sessionId);
        return row ? { snapshot: row.snapshot, eventCount: row.event_count, consumed: row.consumed } : null;
    } catch (err) {
        logger.error('ctx-tracker', `getSnapshot failed: ${err.message}`);
        return null;
    }
}

function markSnapshotConsumed(sessionId) {
    try {
        const d = db();
        if (d._fallback) return;
        d.prepare('UPDATE ctx_session_resume SET consumed = 1 WHERE session_id = ?').run(sessionId);
    } catch (err) {
        logger.error('ctx-tracker', `markSnapshotConsumed failed: ${err.message}`);
    }
}

// ── Session lifecycle ──

function initSession(sessionId, projectDir) {
    try {
        const d = db();
        if (d._fallback) return;
        d.prepare(
            `INSERT INTO ctx_session_meta (session_id, project_dir, started_at, event_count, compact_count)
             VALUES (?, ?, datetime('now'), 0, 0)
             ON CONFLICT(session_id) DO UPDATE SET
                project_dir = COALESCE(excluded.project_dir, project_dir)`
        ).run(sessionId, projectDir || null);
        logger.debug('ctx-tracker', `Session init: ${sessionId.slice(0, 8)}, project: ${projectDir || 'none'}`);
    } catch (err) {
        logger.error('ctx-tracker', `initSession failed: ${err.message}`);
    }
}

function getSessionMeta(sessionId) {
    try {
        const d = db();
        if (d._fallback) return null;
        return d.prepare('SELECT * FROM ctx_session_meta WHERE session_id = ?').get(sessionId) || null;
    } catch (err) {
        logger.error('ctx-tracker', `getSessionMeta failed: ${err.message}`);
        return null;
    }
}

function clearSession(sessionId) {
    try {
        const d = db();
        if (d._fallback) return;
        d.transaction(() => {
            d.prepare('DELETE FROM ctx_session_events WHERE session_id = ?').run(sessionId);
            d.prepare('DELETE FROM ctx_session_resume WHERE session_id = ?').run(sessionId);
            d.prepare('DELETE FROM ctx_session_meta WHERE session_id = ?').run(sessionId);
        })();
        logger.debug('ctx-tracker', `Session cleared: ${sessionId.slice(0, 8)}`);
    } catch (err) {
        logger.error('ctx-tracker', `clearSession failed: ${err.message}`);
    }
}

// ── Exports ──
module.exports = {
    extractEvents,
    extractUserEvents,
    insertEvent,
    getEvents,
    buildSnapshot,
    saveSnapshot,
    getSnapshot,
    markSnapshotConsumed,
    initSession,
    clearSession,
};
