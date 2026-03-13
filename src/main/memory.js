/**
 * Unified Memory System — SQLite-backed
 *
 * Single source of truth for ALL memory operations in Onicode.
 * Everything stored in SQLite (~/.onicode/onicode.db) via memoryStorage.
 *
 * Categories:
 *   soul      — AI personality (key: 'soul')
 *   user      — User profile (key: 'profile')
 *   long-term — Durable facts & decisions (key: 'MEMORY')
 *   fact      — Individual learned facts (key: auto-generated)
 *   daily     — Session logs (key: 'YYYY-MM-DD')
 *   project   — Per-project context (key: projectId, project_id: projectId)
 *
 * Change notifications:
 *   All writes emit 'memory-changed' IPC events so the UI stays in sync.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { ipcMain } = require('electron');
const { logger } = require('./logger');

// ══════════════════════════════════════════
//  Main Window Reference (for change notifications)
// ══════════════════════════════════════════

let _mainWindow = null;

function setMainWindow(win) {
    _mainWindow = win;
}

function notifyMemoryChanged(category, key, action) {
    if (_mainWindow?.webContents) {
        _mainWindow.webContents.send('memory-changed', { category, key, action });
    }
}

// ══════════════════════════════════════════
//  Lazy storage reference (avoids circular require)
// ══════════════════════════════════════════

let _memoryStorage = null;

function getStorage() {
    if (!_memoryStorage) {
        _memoryStorage = require('./storage').memoryStorage;
    }
    return _memoryStorage;
}

// ══════════════════════════════════════════
//  Default Templates
// ══════════════════════════════════════════

const DEFAULT_SOUL = `# Onicode AI — Oni

You are **Oni** — not just an AI assistant, but a sharp, witty coding partner with real personality.

## Who You Are
- You're like a brilliant friend who happens to be an elite engineer — funny, direct, and genuinely invested in the user's success
- You have opinions. You'll push back (respectfully) if you think there's a better approach
- You celebrate wins ("hell yeah, that's clean!"), joke about struggles ("CSS centering strikes again"), and challenge the user to level up
- You're NOT a corporate chatbot. No "certainly!", no "I'd be happy to help!", no robotic filler. Just real talk.
- You match the user's energy — if they're casual, be casual. If they're focused, lock in.

## Personality Traits
- **Witty** — drop clever observations, coding jokes, and the occasional roast (with love)
- **Confident** — you know your stuff and it shows, but you admit when you're unsure
- **Competitive** — challenge the user: "bet I can do this in under 5 files" / "watch this"
- **Curious** — genuinely interested in what the user is building and why
- **Encouraging** — hype up good ideas, but also reality-check bad ones
- **Efficient** — you respect time. Talk less, build more. But when you do talk, make it count.

## Communication Style
- Lead with action, follow with personality. Build first, banter second.
- Short, punchy messages. No walls of text unless explaining something complex.
- Use humor naturally — don't force jokes, but don't suppress them either.
- When something goes wrong: acknowledge it with humor, then fix it immediately.
- End complex sessions with a real summary — not robotic bullet points, but a genuine "here's what we built and why it's cool"

## Behavior Rules
- Always use tools to act, never just describe plans
- Write clean, idiomatic code following project conventions
- When you encounter errors, fix them with determination — debugging is just solving puzzles
- Proactively improve code you touch — if you see something ugly, fix it
- Remember the user's preferences, habits, and past frustrations — act on them without being asked
- Challenge bad patterns: "this works, but here's why it'll bite you later..."

## Memory Protocol
- Save important user preferences, likes, dislikes to long-term memory
- Remember the user's name, coding style, favorite tools, pet peeves
- Track recurring frustrations so you can preemptively avoid them
- Note what makes the user laugh or what references they enjoy
- Update project memory with patterns, decisions, and "why we did it this way"
- At session end, log a brief summary with personality (not just dry facts)
`;

const DEFAULT_USER = `# User Profile

## Preferences
- Name: (not set)
- Preferred Language: (not set)
- Preferred Framework: (not set)
- Code Style: (not set)
- Timezone: (not set)

## Notes
(No notes yet — the AI will learn your preferences over time)
`;

// ══════════════════════════════════════════
//  Core Operations (all go through SQLite)
// ══════════════════════════════════════════

/**
 * Read a memory. Filename maps to category+key:
 *   soul.md       → category='soul', key='soul'
 *   user.md       → category='user', key='profile'
 *   MEMORY.md     → category='long-term', key='MEMORY'
 *   YYYY-MM-DD.md → category='daily', key='YYYY-MM-DD'
 *   Other         → category='misc', key=filename
 */
function filenameToKey(filename) {
    if (filename === 'soul.md') return { category: 'soul', key: 'soul' };
    if (filename === 'user.md') return { category: 'user', key: 'profile' };
    if (filename === 'MEMORY.md') return { category: 'long-term', key: 'MEMORY' };
    if (/^\d{4}-\d{2}-\d{2}\.md$/.test(filename)) return { category: 'daily', key: filename.replace('.md', '') };
    return { category: 'misc', key: filename.replace('.md', '') };
}

function readMemory(filename) {
    const { category, key } = filenameToKey(filename);
    const row = getStorage().get(category, key);
    return row?.content || null;
}

function writeMemory(filename, content) {
    const { category, key } = filenameToKey(filename);
    getStorage().upsert(category, key, content);
    notifyMemoryChanged(category, key, 'write');
}

function appendMemory(filename, content) {
    const { category, key } = filenameToKey(filename);
    getStorage().append(category, key, content);
    notifyMemoryChanged(category, key, 'append');
}

function listMemories() {
    const rows = getStorage().list(null, null, 200);
    return rows.map(r => ({
        name: keyToFilename(r.category, r.key),
        size: (r.content || '').length,
        modified: r.updated_at,
        scope: r.project_id ? 'project' : 'global',
        category: r.category,
        id: r.id,
    }));
}

function keyToFilename(category, key) {
    if (category === 'soul') return 'soul.md';
    if (category === 'user') return 'user.md';
    if (category === 'long-term') return 'MEMORY.md';
    if (category === 'daily') return `${key}.md`;
    if (category === 'project') return `projects/${key}.md`;
    if (category === 'fact') return `fact-${key}`;
    return `${key}.md`;
}

function deleteMemory(filename) {
    const { category, key } = filenameToKey(filename);
    getStorage().deleteByKey(category, key);
    notifyMemoryChanged(category, key, 'delete');
    return true;
}

// ══════════════════════════════════════════
//  Project-Scoped Memory
// ══════════════════════════════════════════

function readProjectMemory(projectId) {
    const row = getStorage().get('project', projectId);
    return row?.content || null;
}

function writeProjectMemory(projectId, content) {
    getStorage().upsert('project', projectId, content, projectId);
    notifyMemoryChanged('project', projectId, 'write');
}

function appendProjectMemory(projectId, content) {
    getStorage().append('project', projectId, content, projectId);
    notifyMemoryChanged('project', projectId, 'append');
}

function listProjectMemories() {
    const rows = getStorage().list('project');
    return rows.map(r => ({
        name: `${r.key}.md`,
        size: (r.content || '').length,
        modified: r.updated_at,
        scope: 'project',
    }));
}

// ══════════════════════════════════════════
//  Search (FTS5 + TF-IDF semantic fallback)
// ══════════════════════════════════════════

/**
 * Search memory using FTS5 first, then TF-IDF similarity for semantic matching.
 * Returns combined results ranked by relevance.
 */
function searchMemory(query, scope) {
    const category = scope === 'global' ? null : scope === 'project' ? 'project' : null;

    // Phase 1: FTS5 exact/prefix matching
    const ftsResults = getStorage().search(query, category, null, 15);

    // Phase 2: TF-IDF similarity search (catches semantic matches FTS5 misses)
    const tfidfResults = tfidfSearch(query, category, 10);

    // Merge and deduplicate (FTS results first, then TF-IDF additions)
    const seen = new Set(ftsResults.map(r => r.id));
    const merged = [...ftsResults];
    for (const r of tfidfResults) {
        if (!seen.has(r.id)) {
            seen.add(r.id);
            merged.push(r);
        }
    }

    return merged.slice(0, 20).map(r => ({
        id: r.id,
        category: r.category,
        key: r.key,
        file: keyToFilename(r.category, r.key),
        content: r.content,
        snippet: extractSnippet(r.content, query),
        updated_at: r.updated_at,
        score: r._score || 0,
    }));
}

/**
 * TF-IDF based similarity search across memory entries.
 * Tokenizes query and all memories, computes cosine similarity.
 * Lightweight — no external dependencies, runs in <50ms for typical memory sizes.
 */
function tfidfSearch(query, category, limit = 10) {
    if (!query || !query.trim()) return [];

    try {
        const storage = getStorage();
        // Get all memories (or filtered by category)
        let rows;
        if (category) {
            rows = storage.list(category, null, 500);
        } else {
            rows = storage.list(null, null, 500);
        }
        if (!rows || rows.length === 0) return [];

        // Tokenize
        const queryTokens = tokenize(query);
        if (queryTokens.length === 0) return [];

        // Build document frequency map
        const docFreq = {};
        const docTokens = rows.map(row => {
            const tokens = tokenize(row.content || '');
            for (const t of new Set(tokens)) {
                docFreq[t] = (docFreq[t] || 0) + 1;
            }
            return tokens;
        });

        const N = rows.length;

        // Compute TF-IDF vectors and score each document against query
        const scored = rows.map((row, i) => {
            const tokens = docTokens[i];
            if (tokens.length === 0) return { ...row, _score: 0 };

            // Term frequency in document
            const tf = {};
            for (const t of tokens) tf[t] = (tf[t] || 0) + 1;

            // Cosine similarity between query and document TF-IDF vectors
            let dotProduct = 0;
            let docMag = 0;
            let queryMag = 0;

            const queryTf = {};
            for (const t of queryTokens) queryTf[t] = (queryTf[t] || 0) + 1;

            const allTerms = new Set([...queryTokens, ...Object.keys(tf)]);
            for (const term of allTerms) {
                const idf = Math.log(1 + N / (1 + (docFreq[term] || 0)));
                const qTfidf = (queryTf[term] || 0) * idf;
                const dTfidf = (tf[term] || 0) / tokens.length * idf;
                dotProduct += qTfidf * dTfidf;
                queryMag += qTfidf * qTfidf;
                docMag += dTfidf * dTfidf;
            }

            const magnitude = Math.sqrt(queryMag) * Math.sqrt(docMag);
            const score = magnitude > 0 ? dotProduct / magnitude : 0;
            return { ...row, _score: score };
        });

        // Return top results with meaningful scores
        return scored
            .filter(r => r._score > 0.05)
            .sort((a, b) => b._score - a._score)
            .slice(0, limit);
    } catch (err) {
        logger.warn('memory', `TF-IDF search error: ${err.message}`);
        return [];
    }
}

/** Tokenize text into lowercase words, removing stop words and short tokens. */
const STOP_WORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'because', 'if', 'when', 'where', 'how', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'it', 'its']);

function tokenize(text) {
    if (!text) return [];
    return text
        .toLowerCase()
        .replace(/[^a-z0-9_\-]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

function extractSnippet(content, query) {
    if (!content || !query) return '';
    const lower = content.toLowerCase();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    for (const term of terms) {
        const idx = lower.indexOf(term);
        if (idx >= 0) {
            const start = Math.max(0, idx - 80);
            const end = Math.min(content.length, idx + term.length + 80);
            return (start > 0 ? '...' : '') + content.slice(start, end).trim() + (end < content.length ? '...' : '');
        }
    }
    return content.slice(0, 160) + (content.length > 160 ? '...' : '');
}

// ══════════════════════════════════════════
//  Fact Storage (individual learned facts)
// ══════════════════════════════════════════

function addFact(content, projectId) {
    const key = `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    getStorage().upsert('fact', key, content, projectId || null);
    notifyMemoryChanged('fact', key, 'write');
    return key;
}

// ══════════════════════════════════════════
//  Date Helpers
// ══════════════════════════════════════════

function todayString() {
    return new Date().toISOString().slice(0, 10);
}

function yesterdayString() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
}

// ══════════════════════════════════════════
//  Load Core Memories (for system prompt injection)
// ══════════════════════════════════════════

function loadCoreMemories(projectId) {
    return getStorage().loadCore(projectId);
}

// ══════════════════════════════════════════
//  Defaults & Migration
// ══════════════════════════════════════════

function ensureDefaults() {
    const storage = getStorage();
    const created = [];

    if (!storage.get('soul', 'soul')) {
        storage.upsert('soul', 'soul', DEFAULT_SOUL);
        created.push('soul');
    }

    const hasUser = !!storage.get('user', 'profile');

    // One-time migration from markdown files
    const memoriesDir = path.join(os.homedir(), '.onicode', 'memories');
    const projectsDir = path.join(memoriesDir, 'projects');
    const stats = storage.stats();
    if (stats.total <= 1) { // Only the soul we just created
        const result = storage.migrateFromFiles(memoriesDir, projectsDir);
        if (result.migrated > 0) {
            logger.info('memory', `Migrated ${result.migrated} markdown files to SQLite`);
            created.push(`${result.migrated} files migrated`);
        }
    }

    return { created, needsOnboarding: !hasUser };
}

function saveOnboarding(answers) {
    const lines = ['# User Profile\n'];
    lines.push('## Preferences');
    if (answers.name) lines.push(`- Name: ${answers.name}`);
    if (answers.language) lines.push(`- Preferred Language: ${answers.language}`);
    if (answers.framework) lines.push(`- Preferred Framework: ${answers.framework}`);
    if (answers.codeStyle) lines.push(`- Code Style: ${answers.codeStyle}`);
    if (answers.extras) lines.push(`\n## Notes\n${answers.extras}`);
    getStorage().upsert('user', 'profile', lines.join('\n'));
}

// ══════════════════════════════════════════
//  Compaction → Memory Bridge
// ══════════════════════════════════════════

function saveCompactionToMemory(summary, compactedCount) {
    const dailyKey = todayString();
    const entry = `\n---\n### Context Compaction at ${new Date().toLocaleTimeString()}\n(${compactedCount} messages compacted)\n${summary}\n`;
    getStorage().append('daily', dailyKey, entry);
}

// ══════════════════════════════════════════
//  Memory Intelligence Layer (OpenViking-inspired)
// ══════════════════════════════════════════

let _aiCallFn = null;

/**
 * Set the AI call function for LLM-based memory operations.
 * @param {Function} fn — async (messages, options) => string
 */
function setAICallFunction(fn) { _aiCallFn = fn; }

/**
 * LLM-based memory extraction from a conversation.
 * Sends recent messages to the AI to extract structured memories across categories.
 * Falls back gracefully if AI is unavailable.
 *
 * @param {Array} messages — conversation messages
 * @param {string} [sessionId] — optional session identifier
 * @returns {Promise<Array<{category: string, key: string, content: string, abstract: string}>>}
 */
async function extractMemoriesWithAI(messages, sessionId) {
    if (!_aiCallFn || messages.length < 2) return [];

    try {
        // Build a condensed conversation transcript (last 20 messages, 300 chars each)
        const transcript = messages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .slice(-20)
            .map(m => {
                const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                return `[${m.role}]: ${content.slice(0, 300)}`;
            })
            .join('\n');

        const extractionPrompt = [
            {
                role: 'system',
                content: `You are a memory extraction system. Analyze the conversation and extract important facts worth remembering for future sessions.

For each memory, output a JSON object on its own line with these fields:
- "category": one of "preference", "personal", "entity", "event", "decision", "pattern", "correction"
- "content": the full memory text (be specific, include names/values/details)
- "abstract": a one-sentence summary under 100 characters

Categories:
- preference: user likes/dislikes, coding style, tools they prefer
- personal: name, role, company, timezone, location
- entity: specific projects, people, technologies they work with
- event: decisions made, milestones reached, problems solved
- decision: technical choices (frameworks, patterns, approaches)
- pattern: recurring workflows, habits, common requests
- correction: things the user corrected the AI about

Rules:
- Only extract information explicitly stated or strongly implied
- Be specific — "user prefers tabs" not "user has formatting preferences"
- Skip trivial or single-use information
- Output ONLY JSON lines, no other text. If nothing worth extracting, output nothing.`
            },
            {
                role: 'user',
                content: `Extract memories from this conversation:\n\n${transcript}`
            }
        ];

        const response = await _aiCallFn(extractionPrompt, { maxTokens: 1500, noStream: true });
        if (!response || response.length < 10) return [];

        // Parse JSON lines
        const memories = [];
        for (const line of response.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('{')) continue;
            try {
                const mem = JSON.parse(trimmed);
                if (mem.category && mem.content) {
                    memories.push({
                        category: mem.category,
                        key: `ai_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                        content: mem.content.slice(0, 500),
                        abstract: (mem.abstract || mem.content.slice(0, 80)).slice(0, 100),
                    });
                }
            } catch { /* skip malformed lines */ }
        }

        logger.info('memory', `LLM extraction: ${memories.length} memories from ${messages.length} messages`);
        return memories;
    } catch (err) {
        logger.warn('memory', `LLM extraction failed: ${err.message}`);
        return [];
    }
}

/**
 * LLM-based memory deduplication.
 * Given a candidate memory, searches for similar existing memories and asks the AI
 * whether to skip, create, merge, or delete.
 *
 * @param {object} candidate — { category, content, abstract }
 * @returns {Promise<{action: 'skip'|'create'|'merge'|'delete', mergeIntoId?: number, deleteIds?: number[]}>}
 */
async function deduplicateMemory(candidate) {
    const storage = getStorage();

    // Phase 1: Find similar memories via FTS5
    const similar = storage.findSimilar(candidate.content, 'fact', 5);
    if (similar.length === 0) return { action: 'create' };

    // Phase 2: If AI is available, ask it to decide
    if (_aiCallFn) {
        try {
            const existingList = similar.map((m, i) =>
                `[${i}] (id=${m.id}) ${(m.abstract || m.content).slice(0, 150)}`
            ).join('\n');

            const dedupPrompt = [
                {
                    role: 'system',
                    content: `You are a memory deduplication system. Given a new candidate memory and existing similar memories, decide what to do.

Respond with a single JSON object:
- {"action": "skip"} — candidate is a duplicate, don't save it
- {"action": "create"} — candidate is new information, save it
- {"action": "merge", "merge_into": <index>} — merge candidate into existing memory at index
- {"action": "create", "delete": [<index>, ...]} — save candidate and delete stale entries

Rules:
- SKIP if the exact same fact already exists (even if worded differently)
- MERGE if the candidate adds detail to an existing memory
- CREATE + DELETE if the candidate supersedes/updates an older memory
- CREATE if it's genuinely new information
Output ONLY the JSON object.`
                },
                {
                    role: 'user',
                    content: `Candidate: ${candidate.content}\n\nExisting memories:\n${existingList}`
                }
            ];

            const response = await _aiCallFn(dedupPrompt, { maxTokens: 200, noStream: true });
            if (response) {
                const jsonMatch = response.match(/\{[^}]+\}/);
                if (jsonMatch) {
                    const decision = JSON.parse(jsonMatch[0]);
                    const result = { action: decision.action || 'create' };

                    if (decision.action === 'merge' && typeof decision.merge_into === 'number') {
                        result.mergeIntoId = similar[decision.merge_into]?.id;
                    }
                    if (decision.action === 'create' && Array.isArray(decision.delete)) {
                        result.deleteIds = decision.delete
                            .filter(i => typeof i === 'number' && similar[i])
                            .map(i => similar[i].id);
                    }

                    logger.info('memory', `Dedup decision: ${result.action} for "${candidate.content.slice(0, 60)}..."`);
                    return result;
                }
            }
        } catch (err) {
            logger.warn('memory', `LLM dedup failed: ${err.message}`);
        }
    }

    // Fallback: simple string-similarity check (no AI)
    const candidateLower = candidate.content.toLowerCase();
    for (const existing of similar) {
        const existingLower = (existing.content || '').toLowerCase();
        // If >60% of candidate words appear in an existing memory, skip
        const candidateWords = new Set(candidateLower.split(/\s+/).filter(w => w.length > 3));
        const matchCount = [...candidateWords].filter(w => existingLower.includes(w)).length;
        if (candidateWords.size > 0 && matchCount / candidateWords.size > 0.6) {
            return { action: 'skip' };
        }
    }

    return { action: 'create' };
}

/**
 * Generate an L0 abstract for a memory.
 * Uses AI if available, otherwise truncates mechanically.
 *
 * @param {string} content — full memory content
 * @returns {Promise<string>} — abstract (~100 chars)
 */
async function generateAbstract(content) {
    if (!content) return '';

    // Short content IS the abstract
    if (content.length <= 100) return content;

    // Try AI summarization
    if (_aiCallFn) {
        try {
            const response = await _aiCallFn([
                { role: 'system', content: 'Summarize this memory in one sentence, under 80 characters. Output ONLY the summary.' },
                { role: 'user', content: content.slice(0, 500) }
            ], { maxTokens: 50, noStream: true });

            if (response && response.length > 5 && response.length <= 120) {
                return response.trim();
            }
        } catch { /* fallback below */ }
    }

    // Mechanical fallback: first sentence or truncation
    const firstSentence = content.match(/^[^.!?\n]+[.!?]?/);
    if (firstSentence && firstSentence[0].length <= 100) return firstSentence[0].trim();
    return content.slice(0, 97) + '...';
}

/**
 * Session commit — orchestrates the full memory pipeline:
 * 1. LLM extraction (structured memories from conversation)
 * 2. Deduplication (skip/create/merge/delete decisions)
 * 3. Save with abstracts
 * 4. Link relations to session
 *
 * @param {Array} messages — conversation messages
 * @param {string} [sessionId] — optional session identifier
 * @returns {Promise<{extracted: number, saved: number, merged: number, skipped: number, deleted: number}>}
 */
async function commitSession(messages, sessionId) {
    const stats = { extracted: 0, saved: 0, merged: 0, skipped: 0, deleted: 0 };
    const storage = getStorage();

    try {
        // Step 1: Extract memories with AI
        const candidates = await extractMemoriesWithAI(messages, sessionId);
        stats.extracted = candidates.length;

        if (candidates.length === 0) return stats;

        // Step 2: Process each candidate through dedup pipeline
        const savedIds = [];

        for (const candidate of candidates) {
            const decision = await deduplicateMemory(candidate);

            switch (decision.action) {
                case 'skip':
                    stats.skipped++;
                    break;

                case 'merge':
                    if (decision.mergeIntoId) {
                        const existing = storage.getById(decision.mergeIntoId);
                        if (existing) {
                            const merged = `${existing.content}\n${candidate.content}`;
                            storage.upsert(existing.category, existing.key, merged);
                            // Regenerate abstract for merged content
                            const abstract = await generateAbstract(merged);
                            storage.setAbstract(existing.id, abstract);
                            savedIds.push(existing.id);
                            stats.merged++;
                        }
                    }
                    break;

                case 'create':
                default:
                    // Delete superseded memories
                    if (decision.deleteIds?.length) {
                        for (const id of decision.deleteIds) {
                            storage.delete(id);
                            stats.deleted++;
                        }
                    }
                    // Save the new memory
                    storage.upsert('fact', candidate.key, candidate.content);
                    const row = storage.get('fact', candidate.key);
                    if (row) {
                        storage.setAbstract(row.id, candidate.abstract);
                        if (sessionId) storage.setSource(row.id, sessionId);
                        savedIds.push(row.id);
                    }
                    stats.saved++;
                    break;
            }
        }

        // Step 3: Create relations between all memories extracted in the same session
        if (savedIds.length > 1) {
            for (let i = 0; i < savedIds.length - 1; i++) {
                for (let j = i + 1; j < savedIds.length; j++) {
                    storage.addRelation(savedIds[i], savedIds[j], 'co-extracted');
                }
            }
        }

        logger.info('memory', `Session commit: ${stats.extracted} extracted, ${stats.saved} saved, ${stats.merged} merged, ${stats.skipped} skipped, ${stats.deleted} deleted`);
    } catch (err) {
        logger.warn('memory', `Session commit error: ${err.message}`);
    }

    return stats;
}

/**
 * Track access to memories returned by search (for hotness scoring).
 * Call this when memories are retrieved and injected into context.
 */
function trackMemoryAccess(memoryIds) {
    if (!memoryIds || memoryIds.length === 0) return;
    try {
        getStorage().trackAccessBulk(memoryIds);
    } catch (err) {
        logger.warn('memory', `Access tracking error: ${err.message}`);
    }
}

/**
 * Smart retrieval — intent-aware memory search.
 * Analyzes the query context, searches across categories, ranks by hotness.
 *
 * @param {string} query — the user's message or search query
 * @param {object} [context] — optional { projectId, recentTopics }
 * @returns {Promise<Array<{id, category, content, abstract, score, hotness}>>}
 */
async function smartRetrieve(query, context = {}) {
    const storage = getStorage();

    // Phase 1: Intent analysis — extract search terms
    let searchTerms = [query];

    if (_aiCallFn && query.length > 30) {
        try {
            const response = await _aiCallFn([
                {
                    role: 'system',
                    content: 'Extract 1-3 concise search queries from this user message for searching a memory database. Output one query per line, nothing else.'
                },
                { role: 'user', content: query.slice(0, 300) }
            ], { maxTokens: 100, noStream: true });

            if (response) {
                const terms = response.split('\n').map(l => l.trim()).filter(l => l.length > 2);
                if (terms.length > 0) searchTerms = terms.slice(0, 3);
            }
        } catch { /* use original query */ }
    }

    // Phase 2: Search across all terms, merge results
    const seen = new Set();
    const allResults = [];

    for (const term of searchTerms) {
        const results = searchMemory(term, context.projectId ? 'project' : 'global');
        for (const r of results) {
            if (!seen.has(r.id)) {
                seen.add(r.id);
                allResults.push(r);
            }
        }
    }

    // Phase 3: Boost by hotness
    const hotMemories = storage.listByHotness(null, 50);
    const hotnessMap = new Map(hotMemories.map(m => [m.id, m.hotness || 0]));

    for (const r of allResults) {
        r.hotness = hotnessMap.get(r.id) || 0;
        r.combinedScore = 0.7 * (r.score || 0) + 0.3 * r.hotness;
    }

    // Sort by combined score
    allResults.sort((a, b) => b.combinedScore - a.combinedScore);

    // Track access for returned results
    const resultIds = allResults.slice(0, 10).map(r => r.id).filter(Boolean);
    if (resultIds.length > 0) trackMemoryAccess(resultIds);

    return allResults.slice(0, 15);
}

/**
 * Get related memories for a given memory ID (graph traversal).
 */
function getRelatedMemories(memoryId) {
    try {
        return getStorage().getRelated(memoryId);
    } catch {
        return [];
    }
}

// ══════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════

function registerMemoryIPC(ipcMainArg) {
    const ipc = ipcMainArg || ipcMain;

    ipc.handle('memory-load-core', async (_event, projectId) => {
        try {
            return { success: true, memories: loadCoreMemories(projectId) };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-ensure-defaults', async () => {
        try {
            return { success: true, ...ensureDefaults() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-save-onboarding', async (_event, answers) => {
        try {
            saveOnboarding(answers);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-read', async (_event, filename) => {
        try {
            const content = readMemory(filename);
            return { success: true, content };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-write', async (_event, filename, content) => {
        try {
            writeMemory(filename, content);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-append', async (_event, filename, content) => {
        try {
            appendMemory(filename, content);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-list', async () => {
        try {
            const files = listMemories();
            return { success: true, files };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-delete', async (_event, filename) => {
        try {
            deleteMemory(filename);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-search', async (_event, query, scope) => {
        try {
            const results = searchMemory(query, scope);
            return { success: true, results };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-stats', async () => {
        try {
            return { success: true, ...getStorage().stats() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-compact', async (_event, messages, keepRecent) => {
        // Legacy compaction — delegate to compactor.js
        return { success: true, result: null };
    });

    // ── Memory Intelligence IPC ──

    ipc.handle('memory-smart-retrieve', async (_event, query, context) => {
        try {
            const results = await smartRetrieve(query, context || {});
            return { success: true, results };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-related', async (_event, memoryId) => {
        try {
            const related = getRelatedMemories(memoryId);
            return { success: true, related };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-hotness-list', async (_event, category, limit) => {
        try {
            const memories = getStorage().listByHotness(category || null, limit || 20);
            return { success: true, memories };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-commit-session', async (_event, messages) => {
        try {
            const stats = await commitSession(messages);
            return { success: true, ...stats };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // Project memory IPC
    ipc.handle('memory-project-read', async (_event, projectId) => {
        try {
            return { success: true, content: readProjectMemory(projectId) };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-project-write', async (_event, projectId, content) => {
        try {
            writeProjectMemory(projectId, content);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipc.handle('memory-project-append', async (_event, projectId, content) => {
        try {
            appendProjectMemory(projectId, content);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
}

// ══════════════════════════════════════════
//  Exports
// ══════════════════════════════════════════

module.exports = {
    registerMemoryIPC,
    setMainWindow,

    // Core operations
    readMemory,
    writeMemory,
    appendMemory,
    listMemories,
    deleteMemory,
    searchMemory,
    loadCoreMemories,

    // Facts
    addFact,

    // Project memory
    readProjectMemory,
    writeProjectMemory,
    appendProjectMemory,
    listProjectMemories,

    // Compaction bridge
    saveCompactionToMemory,

    // Defaults
    ensureDefaults,
    saveOnboarding,

    // Helpers
    todayString,

    // Memory Intelligence (OpenViking-inspired)
    setAICallFunction,
    extractMemoriesWithAI,
    deduplicateMemory,
    generateAbstract,
    commitSession,
    trackMemoryAccess,
    smartRetrieve,
    getRelatedMemories,
};
