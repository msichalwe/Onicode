/**
 * Context-Mode Knowledge Base — FTS5-backed indexing and fuzzy search.
 *
 * Indexes markdown, JSON, and plain-text documents into an FTS5 full-text
 * search engine with three retrieval layers:
 *   1. Porter-stemmed BM25 (exact/inflected matches)
 *   2. Trigram substring matching (partial/mid-word hits)
 *   3. Levenshtein-corrected re-search (typo tolerance via vocabulary)
 *
 * Uses the shared better-sqlite3 database from ../storage.
 */

const { logger } = require('../logger');

// ══════════════════════════════════════════
//  Stop Words
// ══════════════════════════════════════════

const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
    'nor', 'not', 'so', 'yet', 'both', 'either', 'neither', 'each',
    'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such',
    'no', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'because',
    'if', 'when', 'where', 'how', 'what', 'which', 'who', 'whom', 'this',
    'that', 'these', 'those', 'it', 'its', 'about', 'also', 'then', 'there',
    'here', 'out', 'up', 'down', 'over', 'under', 'again', 'further',
    'once', 'while', 'until', 'since', 'now', 'well', 'back', 'even',
    'still', 'already', 'much', 'many', 'such', 'like', 'get', 'got',
    'make', 'made', 'take', 'took', 'come', 'came', 'go', 'went', 'see',
    'saw', 'know', 'knew', 'think', 'thought', 'say', 'said', 'use', 'used',
]);

// ══════════════════════════════════════════
//  Lazy DB Access + Schema Init
// ══════════════════════════════════════════

let _db = null;
let _initialized = false;

function getDB() {
    if (!_db) {
        _db = require('../storage').getDB();
    }
    return _db;
}

function ensureSchema() {
    if (_initialized) return;
    const db = getDB();
    if (!db || db._fallback) {
        logger.warn('ctx-store', 'No SQLite available — context store disabled');
        _initialized = true;
        return;
    }

    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS ctx_sources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                label TEXT NOT NULL,
                source TEXT,
                session_id TEXT,
                chunk_count INTEGER DEFAULT 0,
                indexed_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS ctx_vocabulary (
                word TEXT PRIMARY KEY
            );
        `);

        // FTS5 virtual tables (must be separate exec calls)
        db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS ctx_chunks USING fts5(
                title, content, source_id UNINDEXED, content_type UNINDEXED,
                tokenize='porter unicode61'
            );
        `);

        db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS ctx_chunks_trigram USING fts5(
                title, content, source_id UNINDEXED, content_type UNINDEXED,
                tokenize='trigram'
            );
        `);

        _initialized = true;
        logger.info('ctx-store', 'Schema initialized');
    } catch (err) {
        // Tables may already exist — check for real errors
        if (!err.message.includes('already exists')) {
            logger.error('ctx-store', `Schema init error: ${err.message}`);
        }
        _initialized = true;
    }
}

// ══════════════════════════════════════════
//  Markdown Chunking
// ══════════════════════════════════════════

/**
 * Split markdown into heading-delimited chunks, keeping code blocks intact.
 * @param {string} content — raw markdown
 * @param {number} maxBytes — max chunk size (default 4096)
 * @returns {Array<{title: string, content: string}>}
 */
function chunkMarkdown(content, maxBytes = 4096) {
    if (!content) return [];

    const lines = content.split('\n');
    const chunks = [];
    let currentTitle = '';
    let currentLines = [];

    function flushCurrent() {
        const text = currentLines.join('\n').trim();
        if (!text) return;

        if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
            chunks.push({ title: currentTitle, content: text });
        } else {
            // Split oversized chunks at paragraph boundaries
            splitAtParagraphs(currentTitle, text, maxBytes, chunks);
        }
    }

    for (const line of lines) {
        // Detect headings (H1-H4)
        const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
        if (headingMatch) {
            flushCurrent();
            currentTitle = headingMatch[2].trim();
            currentLines = [line];
        } else {
            currentLines.push(line);
        }
    }

    flushCurrent();

    // If no heading-based chunks were created, treat whole content as one chunk
    if (chunks.length === 0 && content.trim()) {
        splitAtParagraphs('', content.trim(), maxBytes, chunks);
    }

    return chunks;
}

/**
 * Split text at paragraph boundaries (\n\n) into sub-chunks.
 */
function splitAtParagraphs(title, text, maxBytes, out) {
    const paragraphs = text.split(/\n\n+/);
    let accum = [];
    let accumSize = 0;
    let partIndex = 0;

    for (const para of paragraphs) {
        const paraSize = Buffer.byteLength(para, 'utf8');
        if (accumSize + paraSize > maxBytes && accum.length > 0) {
            const partTitle = partIndex > 0 ? `${title} (part ${partIndex + 1})` : title;
            out.push({ title: partTitle, content: accum.join('\n\n') });
            accum = [];
            accumSize = 0;
            partIndex++;
        }
        accum.push(para);
        accumSize += paraSize + 2; // +2 for \n\n separator
    }

    if (accum.length > 0) {
        const partTitle = partIndex > 0 ? `${title} (part ${partIndex + 1})` : title;
        out.push({ title: partTitle, content: accum.join('\n\n') });
    }
}

// ══════════════════════════════════════════
//  Content Type Detection & Chunking
// ══════════════════════════════════════════

function detectContentType(content) {
    if (!content) return 'plain';
    const trimmed = content.trim();

    // JSON detection
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try { JSON.parse(trimmed); return 'json'; } catch { /* not JSON */ }
    }

    // Markdown detection (has headings)
    if (/^#{1,6}\s+/m.test(trimmed)) return 'markdown';

    return 'plain';
}

function chunkContent(content, contentType, maxBytes = 4096) {
    switch (contentType) {
        case 'markdown':
            return chunkMarkdown(content, maxBytes);

        case 'json': {
            // Chunk JSON by top-level keys or array items
            const chunks = [];
            try {
                const parsed = JSON.parse(content);
                if (Array.isArray(parsed)) {
                    // Group array items into chunks
                    let batch = [];
                    for (let i = 0; i < parsed.length; i++) {
                        const itemStr = JSON.stringify(parsed[i], null, 2);
                        batch.push(itemStr);
                        if (Buffer.byteLength(batch.join('\n'), 'utf8') > maxBytes) {
                            chunks.push({
                                title: `Items ${i - batch.length + 2}-${i + 1}`,
                                content: batch.join('\n'),
                            });
                            batch = [];
                        }
                    }
                    if (batch.length > 0) {
                        chunks.push({
                            title: `Items (remaining)`,
                            content: batch.join('\n'),
                        });
                    }
                } else if (typeof parsed === 'object') {
                    // One chunk per top-level key
                    for (const [key, val] of Object.entries(parsed)) {
                        const valStr = JSON.stringify(val, null, 2);
                        chunks.push({ title: key, content: valStr });
                    }
                }
            } catch {
                chunks.push({ title: 'JSON', content: content.slice(0, maxBytes) });
            }
            return chunks.length > 0 ? chunks : [{ title: 'JSON', content }];
        }

        default: {
            // Plain text: split at paragraph boundaries
            const chunks = [];
            splitAtParagraphs('', content.trim(), maxBytes, chunks);
            return chunks;
        }
    }
}

// ══════════════════════════════════════════
//  Vocabulary & Tokenization
// ══════════════════════════════════════════

function tokenizeWords(text) {
    if (!text) return [];
    return text
        .toLowerCase()
        .replace(/[^a-z0-9_\-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

function populateVocabulary(db, chunks) {
    const words = new Set();
    for (const chunk of chunks) {
        for (const w of tokenizeWords(chunk.title + ' ' + chunk.content)) {
            words.add(w);
        }
    }

    if (words.size === 0) return;

    const insert = db.prepare('INSERT OR IGNORE INTO ctx_vocabulary (word) VALUES (?)');
    const insertMany = db.transaction((wordList) => {
        for (const w of wordList) insert.run(w);
    });
    insertMany([...words]);
}

// ══════════════════════════════════════════
//  Indexing
// ══════════════════════════════════════════

/**
 * Index content into the knowledge base.
 * @param {object} opts
 * @param {string} opts.content — the text to index
 * @param {string} opts.label — human-readable label for this source
 * @param {string} [opts.source] — origin identifier (URL, file path, etc.)
 * @param {string} [opts.sessionId] — session scope
 * @returns {{ sourceId: number, chunkCount: number, bytesIndexed: number }}
 */
function index({ content, label, source, sessionId }) {
    ensureSchema();
    const db = getDB();
    if (!db || db._fallback) {
        return { sourceId: -1, chunkCount: 0, bytesIndexed: 0 };
    }

    const contentType = detectContentType(content);
    const chunks = chunkContent(content, contentType);
    if (chunks.length === 0) {
        return { sourceId: -1, chunkCount: 0, bytesIndexed: 0 };
    }

    let sourceId;
    let bytesIndexed = 0;

    try {
        const insertSource = db.prepare(
            'INSERT INTO ctx_sources (label, source, session_id, chunk_count) VALUES (?, ?, ?, ?)'
        );
        const insertPorter = db.prepare(
            'INSERT INTO ctx_chunks (title, content, source_id, content_type) VALUES (?, ?, ?, ?)'
        );
        const insertTrigram = db.prepare(
            'INSERT INTO ctx_chunks_trigram (title, content, source_id, content_type) VALUES (?, ?, ?, ?)'
        );

        const doIndex = db.transaction(() => {
            const result = insertSource.run(label, source || null, sessionId || null, chunks.length);
            sourceId = result.lastInsertRowid;

            for (const chunk of chunks) {
                const sid = String(sourceId);
                insertPorter.run(chunk.title, chunk.content, sid, contentType);
                insertTrigram.run(chunk.title, chunk.content, sid, contentType);
                bytesIndexed += Buffer.byteLength(chunk.content, 'utf8');
            }

            populateVocabulary(db, chunks);
        });

        doIndex();
        logger.info('ctx-store', `Indexed "${label}": ${chunks.length} chunks, ${bytesIndexed} bytes (${contentType})`);
    } catch (err) {
        logger.error('ctx-store', `Index error for "${label}": ${err.message}`);
        return { sourceId: -1, chunkCount: 0, bytesIndexed: 0 };
    }

    return { sourceId: Number(sourceId), chunkCount: chunks.length, bytesIndexed };
}

// ══════════════════════════════════════════
//  Smart Snippet Extraction
// ══════════════════════════════════════════

/**
 * Extract relevant snippets around query term positions.
 * @param {string} content — full chunk content
 * @param {string} query — search query
 * @param {number} maxLen — max total snippet length
 * @returns {string}
 */
function extractSnippet(content, query, maxLen = 1500) {
    if (!content || !query) return content ? content.slice(0, maxLen) : '';

    const lower = content.toLowerCase();
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2 && !STOP_WORDS.has(t));
    if (terms.length === 0) return content.slice(0, maxLen);

    // Find all match positions
    const WINDOW = 300;
    const windows = [];

    for (const term of terms) {
        let searchFrom = 0;
        while (searchFrom < lower.length) {
            const idx = lower.indexOf(term, searchFrom);
            if (idx === -1) break;
            const start = Math.max(0, idx - Math.floor(WINDOW / 2));
            const end = Math.min(content.length, idx + term.length + Math.floor(WINDOW / 2));
            windows.push({ start, end });
            searchFrom = idx + term.length;
        }
    }

    if (windows.length === 0) return content.slice(0, maxLen);

    // Sort and merge overlapping windows
    windows.sort((a, b) => a.start - b.start);
    const merged = [windows[0]];
    for (let i = 1; i < windows.length; i++) {
        const prev = merged[merged.length - 1];
        if (windows[i].start <= prev.end) {
            prev.end = Math.max(prev.end, windows[i].end);
        } else {
            merged.push(windows[i]);
        }
    }

    // Build snippets up to maxLen
    const parts = [];
    let totalLen = 0;

    for (const w of merged) {
        if (totalLen >= maxLen) break;
        const slice = content.slice(w.start, w.end).trim();
        const prefix = w.start > 0 ? '...' : '';
        const suffix = w.end < content.length ? '...' : '';
        const snippet = prefix + slice + suffix;

        if (totalLen + snippet.length > maxLen) {
            parts.push(snippet.slice(0, maxLen - totalLen));
            break;
        }
        parts.push(snippet);
        totalLen += snippet.length;
    }

    return parts.join(' ');
}

// ══════════════════════════════════════════
//  Levenshtein Fuzzy Correction
// ══════════════════════════════════════════

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;

    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost,
            );
        }
    }
    return dp[m][n];
}

/**
 * Correct a word against the vocabulary table using Levenshtein distance.
 * @param {string} word
 * @returns {string} — corrected word or original if no close match
 */
function fuzzyCorrect(word) {
    ensureSchema();
    const db = getDB();
    if (!db || db._fallback) return word;

    const lower = word.toLowerCase();
    const maxDist = lower.length <= 4 ? 1 : lower.length <= 12 ? 2 : 3;

    try {
        // Fetch candidate words with similar length to narrow the comparison set
        const minLen = Math.max(1, lower.length - maxDist);
        const maxLen = lower.length + maxDist;
        const candidates = db.prepare(
            'SELECT word FROM ctx_vocabulary WHERE length(word) BETWEEN ? AND ?'
        ).all(minLen, maxLen);

        let bestWord = word;
        let bestDist = maxDist + 1;

        for (const row of candidates) {
            const dist = levenshtein(lower, row.word);
            if (dist < bestDist) {
                bestDist = dist;
                bestWord = row.word;
            }
            if (dist === 0) break; // exact match
        }

        return bestDist <= maxDist ? bestWord : word;
    } catch (err) {
        logger.warn('ctx-store', `Fuzzy correct error: ${err.message}`);
        return word;
    }
}

// ══════════════════════════════════════════
//  3-Layer Fuzzy Search
// ══════════════════════════════════════════

/**
 * Escape special FTS5 characters in a query term.
 */
function ftsEscape(term) {
    return term.replace(/["*():^{}[\]\\]/g, '');
}

/**
 * Search the knowledge base with 3-layer fuzzy matching.
 * @param {string|string[]} queries — one or more search queries
 * @param {object} [opts]
 * @param {number} [opts.limit=5]
 * @param {string} [opts.source] — filter by source
 * @param {string} [opts.sessionId] — filter by session
 * @returns {Array<{title: string, snippet: string, source: string, score: number, sourceId: number}>}
 */
function search(queries, opts = {}) {
    ensureSchema();
    const db = getDB();
    if (!db || db._fallback) return [];

    const limit = opts.limit || 5;
    const queryList = Array.isArray(queries) ? queries : [queries];
    const seen = new Map(); // rowid -> result
    let results = [];

    for (const query of queryList) {
        if (!query || !query.trim()) continue;

        const terms = query.trim().split(/\s+/).map(ftsEscape).filter(Boolean);
        if (terms.length === 0) continue;

        // ── Layer 1: Porter FTS5 MATCH (BM25) ──
        let layer1 = searchPorter(db, terms, limit, opts);
        for (const r of layer1) {
            if (!seen.has(r._rowid)) {
                seen.set(r._rowid, r);
                results.push(r);
            }
        }

        // ── Layer 2: Trigram (substring matching) ──
        if (results.length < limit) {
            const remaining = limit - results.length;
            const layer2 = searchTrigram(db, terms, remaining + 2, opts);
            for (const r of layer2) {
                if (!seen.has(r._rowid)) {
                    seen.set(r._rowid, r);
                    results.push(r);
                }
            }
        }

        // ── Layer 3: Levenshtein-corrected re-search ──
        if (results.length < limit) {
            const corrected = terms.map(t => fuzzyCorrect(t));
            const anyChanged = corrected.some((c, i) => c !== terms[i]);
            if (anyChanged) {
                const remaining = limit - results.length;
                const layer3 = searchPorter(db, corrected, remaining + 2, opts);
                for (const r of layer3) {
                    if (!seen.has(r._rowid)) {
                        seen.set(r._rowid, r);
                        results.push(r);
                    }
                }
                logger.debug('ctx-store', `Fuzzy corrected: [${terms.join(', ')}] -> [${corrected.join(', ')}]`);
            }
        }
    }

    // Sort by score descending, apply limit
    results.sort((a, b) => b.score - a.score);
    results = results.slice(0, limit);

    // Build final output with snippets
    const queryStr = queryList.join(' ');
    return results.map(r => ({
        title: r.title,
        snippet: extractSnippet(r.content, queryStr),
        source: r.source || '',
        score: r.score,
        sourceId: r.sourceId,
    }));
}

/**
 * Layer 1: Porter-stemmed FTS5 search with BM25 ranking.
 * Tries AND first, falls back to OR.
 */
function searchPorter(db, terms, limit, opts) {
    const escaped = terms.map(t => `"${t}"`);

    // Try AND first
    let ftsQuery = escaped.join(' AND ');
    let rows = runFTS(db, 'ctx_chunks', ftsQuery, limit, opts);

    // Fallback to OR
    if (rows.length === 0 && terms.length > 1) {
        ftsQuery = escaped.join(' OR ');
        rows = runFTS(db, 'ctx_chunks', ftsQuery, limit, opts);
    }

    return rows;
}

/**
 * Layer 2: Trigram-based substring search.
 */
function searchTrigram(db, terms, limit, opts) {
    // Trigram needs terms of at least 3 chars
    const valid = terms.filter(t => t.length >= 3);
    if (valid.length === 0) return [];

    const ftsQuery = valid.map(t => `"${t}"`).join(' OR ');
    return runFTS(db, 'ctx_chunks_trigram', ftsQuery, limit, opts);
}

/**
 * Execute an FTS5 MATCH query against the given table.
 */
function runFTS(db, table, ftsQuery, limit, opts) {
    try {
        let sql = `
            SELECT rowid, title, content, source_id, content_type,
                   bm25(${table}) AS score
            FROM ${table}
            WHERE ${table} MATCH ?
        `;
        const params = [ftsQuery];

        if (opts.source || opts.sessionId) {
            // Need to join with ctx_sources for filtering
            sql = `
                SELECT c.rowid, c.title, c.content, c.source_id, c.content_type,
                       bm25(${table}) AS score
                FROM ${table} c
                JOIN ctx_sources s ON s.id = CAST(c.source_id AS INTEGER)
                WHERE ${table} MATCH ?
            `;
            if (opts.source) {
                sql += ' AND s.source = ?';
                params.push(opts.source);
            }
            if (opts.sessionId) {
                sql += ' AND s.session_id = ?';
                params.push(opts.sessionId);
            }
        }

        sql += ' ORDER BY score LIMIT ?';
        params.push(limit);

        const rows = db.prepare(sql).all(...params);

        return rows.map(r => ({
            _rowid: `${table}:${r.rowid}`,
            title: r.title,
            content: r.content,
            sourceId: parseInt(r.source_id, 10) || 0,
            source: null, // Will be filled by lookup if needed
            score: Math.abs(r.score), // BM25 returns negative scores; lower = better
        }));
    } catch (err) {
        logger.debug('ctx-store', `FTS query failed on ${table}: ${err.message}`);
        return [];
    }
}

// ══════════════════════════════════════════
//  Utilities
// ══════════════════════════════════════════

/**
 * Get terms that are distinctive (unique) to a specific source.
 * @param {number} sourceId
 * @param {number} maxTerms
 * @returns {string[]}
 */
function getDistinctiveTerms(sourceId, maxTerms = 40) {
    ensureSchema();
    const db = getDB();
    if (!db || db._fallback) return [];

    try {
        // Get all chunks for this source
        const chunks = db.prepare(
            'SELECT title, content FROM ctx_chunks WHERE source_id = ?'
        ).all(String(sourceId));

        if (chunks.length === 0) return [];

        // Collect term frequencies for this source
        const sourceTF = {};
        for (const chunk of chunks) {
            for (const w of tokenizeWords(chunk.title + ' ' + chunk.content)) {
                sourceTF[w] = (sourceTF[w] || 0) + 1;
            }
        }

        // Get total chunk count across all sources for IDF
        const totalRow = db.prepare('SELECT count(*) AS cnt FROM ctx_chunks').get();
        const totalChunks = totalRow?.cnt || 1;

        // For each term, compute approximate IDF via total occurrences
        const scored = Object.entries(sourceTF).map(([word, tf]) => {
            // Count how many chunks globally contain this word (approximate via FTS)
            let globalCount = totalChunks; // fallback
            try {
                const r = db.prepare(
                    `SELECT count(*) AS cnt FROM ctx_chunks WHERE ctx_chunks MATCH ?`
                ).get(`"${ftsEscape(word)}"`);
                globalCount = r?.cnt || totalChunks;
            } catch { /* use fallback */ }

            const idf = Math.log(1 + totalChunks / (1 + globalCount));
            return { word, score: tf * idf };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, maxTerms).map(s => s.word);
    } catch (err) {
        logger.warn('ctx-store', `getDistinctiveTerms error: ${err.message}`);
        return [];
    }
}

/**
 * Remove all data associated with a session.
 * @param {string} sessionId
 */
function clearSession(sessionId) {
    ensureSchema();
    const db = getDB();
    if (!db || db._fallback) return;

    try {
        const sources = db.prepare(
            'SELECT id FROM ctx_sources WHERE session_id = ?'
        ).all(sessionId);

        const deleteChunks = db.prepare(
            'DELETE FROM ctx_chunks WHERE source_id = ?'
        );
        const deleteTrigramChunks = db.prepare(
            'DELETE FROM ctx_chunks_trigram WHERE source_id = ?'
        );
        const deleteSources = db.prepare(
            'DELETE FROM ctx_sources WHERE session_id = ?'
        );

        db.transaction(() => {
            for (const src of sources) {
                const sid = String(src.id);
                deleteChunks.run(sid);
                deleteTrigramChunks.run(sid);
            }
            deleteSources.run(sessionId);
        })();

        logger.info('ctx-store', `Cleared session "${sessionId}": ${sources.length} sources removed`);
    } catch (err) {
        logger.error('ctx-store', `clearSession error: ${err.message}`);
    }
}

/**
 * Delete a specific source and its chunks.
 * @param {number} sourceId
 */
function deleteSource(sourceId) {
    ensureSchema();
    const db = getDB();
    if (!db || db._fallback) return;

    try {
        const sid = String(sourceId);
        db.transaction(() => {
            db.prepare('DELETE FROM ctx_chunks WHERE source_id = ?').run(sid);
            db.prepare('DELETE FROM ctx_chunks_trigram WHERE source_id = ?').run(sid);
            db.prepare('DELETE FROM ctx_sources WHERE id = ?').run(sourceId);
        })();
        logger.info('ctx-store', `Deleted source ${sourceId}`);
    } catch (err) {
        logger.error('ctx-store', `deleteSource error: ${err.message}`);
    }
}

/**
 * Return aggregate stats.
 * @returns {{ totalSources: number, totalChunks: number, totalVocabulary: number }}
 */
function stats() {
    ensureSchema();
    const db = getDB();
    if (!db || db._fallback) {
        return { totalSources: 0, totalChunks: 0, totalVocabulary: 0 };
    }

    try {
        const sources = db.prepare('SELECT count(*) AS cnt FROM ctx_sources').get();
        const chunks = db.prepare('SELECT count(*) AS cnt FROM ctx_chunks').get();
        const vocab = db.prepare('SELECT count(*) AS cnt FROM ctx_vocabulary').get();
        return {
            totalSources: sources?.cnt || 0,
            totalChunks: chunks?.cnt || 0,
            totalVocabulary: vocab?.cnt || 0,
        };
    } catch (err) {
        logger.warn('ctx-store', `Stats error: ${err.message}`);
        return { totalSources: 0, totalChunks: 0, totalVocabulary: 0 };
    }
}

/**
 * List indexed sources, optionally filtered by session.
 * @param {string} [sessionId]
 * @returns {Array<{id: number, label: string, source: string, sessionId: string, chunkCount: number, indexedAt: string}>}
 */
function listSources(sessionId) {
    ensureSchema();
    const db = getDB();
    if (!db || db._fallback) return [];

    try {
        let sql = 'SELECT * FROM ctx_sources';
        const params = [];
        if (sessionId) {
            sql += ' WHERE session_id = ?';
            params.push(sessionId);
        }
        sql += ' ORDER BY indexed_at DESC';

        const rows = db.prepare(sql).all(...params);
        return rows.map(r => ({
            id: r.id,
            label: r.label,
            source: r.source,
            sessionId: r.session_id,
            chunkCount: r.chunk_count,
            indexedAt: r.indexed_at,
        }));
    } catch (err) {
        logger.warn('ctx-store', `listSources error: ${err.message}`);
        return [];
    }
}

// ══════════════════════════════════════════
//  Exports
// ══════════════════════════════════════════

module.exports = {
    index,
    search,
    extractSnippet,
    chunkMarkdown,
    fuzzyCorrect,
    getDistinctiveTerms,
    clearSession,
    deleteSource,
    stats,
    listSources,
};
