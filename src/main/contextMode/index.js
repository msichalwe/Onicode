/**
 * Context Mode — Orchestrator, IPC registration, integration hooks.
 *
 * Deeply integrates context-mode concepts (sandboxed execution, FTS5 knowledge base,
 * session event tracking, resume snapshots) into Onicode's AI pipeline.
 *
 * Inspired by https://github.com/mksglu/context-mode
 */

const { logger } = require('../logger');

// ── Lazy module references (avoid circular deps) ──
let _store = null;
let _executor = null;
let _tracker = null;

function getStore() {
    if (!_store) _store = require('./store');
    return _store;
}
function getExecutor() {
    if (!_executor) _executor = require('./executor');
    return _executor;
}
function getTracker() {
    if (!_tracker) _tracker = require('./tracker');
    return _tracker;
}

// ── State ──
let _mainWindow = null;
let _sessionId = null;
let _searchCallCount = 0;  // Progressive throttling

// Context savings tracking
const _savings = {
    totalBytesIn: 0,
    totalBytesOut: 0,
    perTool: {},  // { toolName: { calls, bytesIn, bytesOut } }
};

function setMainWindow(win) { _mainWindow = win; }

function setSessionId(id) {
    _sessionId = id;
    _searchCallCount = 0;  // Reset throttling on new session
}

// ══════════════════════════════════════════
//  Tool Definitions (OpenAI function format)
// ══════════════════════════════════════════

const CTX_TOOL_DEFINITIONS = [
    {
        type: 'function',
        function: {
            name: 'ctx_execute',
            description: 'Run code in an isolated sandbox. Only stdout summary enters your context (94-99% savings). Use instead of run_command for large-output tasks (test suites, log analysis, API calls, data processing). Supports: javascript, typescript, python, shell, ruby, go, rust, php, perl, r, elixir.',
            parameters: {
                type: 'object',
                properties: {
                    language: {
                        type: 'string',
                        enum: ['javascript', 'typescript', 'python', 'shell', 'ruby', 'go', 'rust', 'php', 'perl', 'r', 'elixir'],
                        description: 'Programming language to execute',
                    },
                    code: { type: 'string', description: 'Code to execute in the sandbox' },
                    timeout: { type: 'integer', description: 'Timeout in ms (default 30000)' },
                    intent: { type: 'string', description: 'What you are looking for. If output > 5KB, only matching sections are returned.' },
                    background: { type: 'boolean', description: 'Run in background (default false)' },
                },
                required: ['language', 'code'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'ctx_search',
            description: 'Search the session knowledge base. Content indexed by ctx_execute, ctx_index, and ctx_fetch is searchable. 3-layer fuzzy search: Porter stemmer → trigram → Levenshtein correction.',
            parameters: {
                type: 'object',
                properties: {
                    queries: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Search queries (multiple for broader coverage)',
                    },
                    limit: { type: 'integer', description: 'Max results per query (default 5)' },
                    source: { type: 'string', description: 'Filter by source label' },
                },
                required: ['queries'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'ctx_index',
            description: 'Index content into the session knowledge base for later search. Use for large documents, API responses, log files.',
            parameters: {
                type: 'object',
                properties: {
                    content: { type: 'string', description: 'Content to index (text, markdown, or JSON)' },
                    path: { type: 'string', description: 'File path to read and index (alternative to content)' },
                    source: { type: 'string', description: 'Label for this content (e.g., "api-response", "test-output")' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'ctx_batch',
            description: 'Execute multiple commands AND search multiple queries in one call. More efficient than separate ctx_execute + ctx_search calls. All outputs are indexed and searched together.',
            parameters: {
                type: 'object',
                properties: {
                    commands: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                language: { type: 'string' },
                                code: { type: 'string' },
                                label: { type: 'string' },
                            },
                            required: ['language', 'code'],
                        },
                        description: 'Commands to execute',
                    },
                    queries: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Queries to search after execution',
                    },
                    timeout: { type: 'integer', description: 'Per-command timeout in ms (default 30000)' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'ctx_stats',
            description: 'Show context savings statistics for this session: bytes indexed, bytes returned, savings ratio, per-tool breakdown.',
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function',
        function: {
            name: 'ctx_fetch',
            description: 'Fetch a URL, convert HTML to readable text, index into knowledge base, return preview. Useful for documentation, issues, API docs.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'URL to fetch' },
                    source: { type: 'string', description: 'Label for indexed content' },
                },
                required: ['url'],
            },
        },
    },
];

function getContextModeToolDefinitions() {
    return CTX_TOOL_DEFINITIONS;
}

// ══════════════════════════════════════════
//  Tool Execution
// ══════════════════════════════════════════

const INTENT_SEARCH_THRESHOLD = 5000; // 5KB — above this, use intent filtering

async function executeContextModeTool(name, args) {
    switch (name) {
        case 'ctx_execute': return handleExecute(args);
        case 'ctx_search': return handleSearch(args);
        case 'ctx_index': return handleIndex(args);
        case 'ctx_batch': return handleBatch(args);
        case 'ctx_stats': return handleStats();
        case 'ctx_fetch': return handleFetch(args);
        default: return { error: `Unknown context mode tool: ${name}` };
    }
}

async function handleExecute(args) {
    const { language, code, timeout, intent, background } = args;
    if (!language || !code) return { error: 'language and code are required' };

    const executor = getExecutor();
    const store = getStore();
    const start = Date.now();

    try {
        const result = await executor.execute({
            language, code, timeout, background,
            cwd: _getCurrentProjectPath(),
        });

        const rawBytes = Buffer.byteLength(result.stdout || '') + Buffer.byteLength(result.stderr || '');
        let output = result.stdout || '';
        let filtered = false;
        let vocabulary = null;

        // Intent-driven filtering: if output is large and intent provided,
        // index the full output and return only matching sections
        if (intent && rawBytes > INTENT_SEARCH_THRESHOLD) {
            const sourceLabel = `exec_${language}_${Date.now()}`;
            store.index({ content: output, label: sourceLabel, source: sourceLabel, sessionId: _sessionId });

            const searchResults = store.search([intent], { limit: 3, source: sourceLabel });
            if (searchResults.length > 0) {
                output = searchResults.map(r => r.snippet || r.content).join('\n---\n');
                filtered = true;
                vocabulary = store.getDistinctiveTerms(sourceLabel, 30);
            }
        } else if (rawBytes > INTENT_SEARCH_THRESHOLD) {
            // No intent but large output — index for later search
            const sourceLabel = `exec_${language}_${Date.now()}`;
            store.index({ content: output, label: sourceLabel, source: sourceLabel, sessionId: _sessionId });
        }

        // Truncate if still too large
        if (Buffer.byteLength(output) > 100 * 1024) {
            output = executor.smartTruncate(output, 100 * 1024);
        }

        const outBytes = Buffer.byteLength(output);
        trackSavings('ctx_execute', rawBytes, outBytes);

        const response = {
            stdout: output,
            stderr: result.stderr ? result.stderr.slice(0, 2000) : '',
            exit_code: result.exitCode,
            duration_ms: result.duration || (Date.now() - start),
            language,
            truncated: result.truncated || false,
            backgrounded: result.backgrounded || false,
        };

        if (filtered) {
            response.filtered_by_intent = intent;
            response.full_output_indexed = true;
            response.savings_percent = rawBytes > 0 ? Math.round((1 - outBytes / rawBytes) * 100) : 0;
            if (vocabulary) response.searchable_terms = vocabulary.slice(0, 20).join(', ');
        }

        if (rawBytes > 0 && outBytes < rawBytes) {
            response.context_savings = `${Math.round((1 - outBytes / rawBytes) * 100)}% (${rawBytes} → ${outBytes} bytes)`;
        }

        return response;
    } catch (err) {
        return { error: err.message, language };
    }
}

async function handleSearch(args) {
    const { queries, limit = 5, source } = args;
    if (!queries || !Array.isArray(queries) || queries.length === 0) {
        return { error: 'queries array is required' };
    }

    // Progressive throttling
    _searchCallCount++;
    if (_searchCallCount > 8) {
        return {
            error: 'Too many individual search calls. Use ctx_batch instead for multiple searches.',
            hint: 'ctx_batch({ commands: [], queries: [...] }) combines execution and search in one call',
        };
    }

    const effectiveLimit = _searchCallCount > 3 ? 1 : limit;
    const store = getStore();

    try {
        const allResults = [];
        for (const query of queries) {
            const results = store.search([query], {
                limit: effectiveLimit,
                source,
                sessionId: _sessionId,
            });
            allResults.push(...results);
        }

        const response = {
            results: allResults.slice(0, limit * queries.length),
            total_results: allResults.length,
            queries_searched: queries.length,
        };

        if (_searchCallCount > 3) {
            response.throttle_warning = `Search call ${_searchCallCount}/8. Use ctx_batch for efficiency.`;
        }

        return response;
    } catch (err) {
        return { error: err.message };
    }
}

async function handleIndex(args) {
    const { content, path: filePath, source } = args;
    const store = getStore();

    try {
        let textToIndex = content;
        if (!textToIndex && filePath) {
            const fs = require('fs');
            if (!fs.existsSync(filePath)) return { error: `File not found: ${filePath}` };
            textToIndex = fs.readFileSync(filePath, 'utf-8');
        }
        if (!textToIndex) return { error: 'content or path is required' };

        const label = source || filePath || `manual_${Date.now()}`;
        const result = store.index({
            content: textToIndex,
            label,
            source: label,
            sessionId: _sessionId,
        });

        return {
            indexed: true,
            source: label,
            chunk_count: result.chunkCount,
            bytes_indexed: result.bytesIndexed,
            searchable_terms: (store.getDistinctiveTerms(result.sourceId, 20) || []).join(', '),
        };
    } catch (err) {
        return { error: err.message };
    }
}

async function handleBatch(args) {
    const { commands = [], queries = [], timeout } = args;
    const executor = getExecutor();
    const store = getStore();
    const results = [];

    // Execute all commands
    for (const cmd of commands) {
        try {
            const result = await executor.execute({
                language: cmd.language || 'shell',
                code: cmd.code,
                timeout,
                cwd: _getCurrentProjectPath(),
            });

            const rawBytes = Buffer.byteLength(result.stdout || '');
            const label = cmd.label || `batch_${cmd.language}_${Date.now()}`;

            // Index output for searching
            if (result.stdout && rawBytes > 500) {
                store.index({
                    content: result.stdout,
                    label,
                    source: label,
                    sessionId: _sessionId,
                });
            }

            const summary = result.stdout
                ? executor.smartTruncate(result.stdout, 1000)
                : '(no output)';

            trackSavings('ctx_batch', rawBytes, Buffer.byteLength(summary));

            results.push({
                label,
                exit_code: result.exitCode,
                summary,
                bytes_raw: rawBytes,
                indexed: rawBytes > 500,
            });
        } catch (err) {
            results.push({ label: cmd.label || cmd.language, error: err.message });
        }
    }

    // Search across all indexed content
    let searchResults = [];
    if (queries.length > 0) {
        for (const query of queries) {
            const hits = store.search([query], { limit: 3, sessionId: _sessionId });
            searchResults.push({ query, results: hits });
        }
    }

    return {
        executions: results,
        searches: searchResults,
        total_commands: commands.length,
        total_queries: queries.length,
    };
}

function handleStats() {
    const store = getStore();
    const storeStats = store.stats(_sessionId);

    const totalIn = _savings.totalBytesIn;
    const totalOut = _savings.totalBytesOut;
    const ratio = totalIn > 0 ? (1 - totalOut / totalIn) : 0;

    return {
        context_savings: {
            total_bytes_processed: totalIn,
            total_bytes_in_context: totalOut,
            savings_ratio: Math.round(ratio * 100) + '%',
            bytes_saved: totalIn - totalOut,
        },
        knowledge_base: storeStats,
        per_tool: _savings.perTool,
        session_id: _sessionId,
        search_calls_this_session: _searchCallCount,
    };
}

async function handleFetch(args) {
    const { url, source } = args;
    if (!url) return { error: 'url is required' };

    const executor = getExecutor();
    const store = getStore();

    try {
        // Use shell to fetch URL and strip HTML
        const fetchCode = `
const https = require('https');
const http = require('http');
const url = new URL(${JSON.stringify(url)});
const mod = url.protocol === 'https:' ? https : http;
mod.get(url, { headers: { 'User-Agent': 'Onicode/1.0' } }, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
        // Strip HTML to readable text
        let text = data
            .replace(/<script[^>]*>[\\s\\S]*?<\\/script>/gi, '')
            .replace(/<style[^>]*>[\\s\\S]*?<\\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\\s+/g, ' ')
            .trim();
        console.log(text);
    });
}).on('error', e => { console.error(e.message); process.exit(1); });
`;
        const result = await executor.execute({ language: 'javascript', code: fetchCode, timeout: 15000 });

        if (result.exitCode !== 0) {
            return { error: `Fetch failed: ${result.stderr || 'unknown error'}` };
        }

        const content = result.stdout || '';
        const label = source || new URL(url).hostname;
        const rawBytes = Buffer.byteLength(content);

        // Index the content
        const indexResult = store.index({
            content,
            label,
            source: label,
            sessionId: _sessionId,
        });

        // Return preview
        const preview = content.slice(0, 2000);
        trackSavings('ctx_fetch', rawBytes, Buffer.byteLength(preview));

        return {
            fetched: true,
            url,
            source: label,
            bytes_fetched: rawBytes,
            chunks_indexed: indexResult.chunkCount,
            preview: preview + (rawBytes > 2000 ? '\n... [indexed for search]' : ''),
            searchable_terms: (store.getDistinctiveTerms(indexResult.sourceId, 20) || []).join(', '),
        };
    } catch (err) {
        return { error: err.message };
    }
}

// ══════════════════════════════════════════
//  Integration Hooks
// ══════════════════════════════════════════

/**
 * Called after every tool execution in the agentic loop.
 * Extracts session events and auto-indexes large outputs.
 */
function onToolComplete(toolName, toolArgs, toolResult, sessionId) {
    if (!sessionId) return;
    try {
        const tracker = getTracker();
        const events = tracker.extractEvents(toolName, toolArgs, toolResult);
        for (const event of events) {
            tracker.insertEvent(sessionId, event, 'tool');
        }

        // Auto-index large tool outputs into knowledge base
        const resultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
        const resultBytes = Buffer.byteLength(resultStr);
        if (resultBytes > INTENT_SEARCH_THRESHOLD && !toolName.startsWith('ctx_')) {
            try {
                const store = getStore();
                store.index({
                    content: resultStr.slice(0, 500000), // Cap at 500KB for indexing
                    label: `${toolName}_output`,
                    source: `auto_${toolName}_${Date.now()}`,
                    sessionId,
                });
                logger.info('context-mode', `Auto-indexed ${toolName} output (${resultBytes} bytes)`);
            } catch { /* non-critical */ }
        }
    } catch (err) {
        logger.warn('context-mode', `onToolComplete error: ${err.message}`);
    }
}

/**
 * Called on each user message to extract decisions, intent, corrections.
 */
function onUserMessage(message, sessionId) {
    if (!sessionId || !message) return;
    try {
        const tracker = getTracker();
        const events = tracker.extractUserEvents(message);
        for (const event of events) {
            tracker.insertEvent(sessionId, event, 'user');
        }
    } catch (err) {
        logger.warn('context-mode', `onUserMessage error: ${err.message}`);
    }
}

/**
 * Called before context compaction. Builds and stores a resume snapshot.
 */
function onPreCompact(sessionId) {
    if (!sessionId) return;
    try {
        const tracker = getTracker();
        const result = tracker.saveSnapshot(sessionId);
        if (result?.snapshot) {
            logger.info('context-mode', `Saved resume snapshot (${result.eventCount} events, ${Buffer.byteLength(result.snapshot)} bytes)`);
        }
    } catch (err) {
        logger.warn('context-mode', `onPreCompact error: ${err.message}`);
    }
}

/**
 * Called on session resume (after compaction or --continue).
 * Returns session guide for injection into context.
 */
function onSessionResume(sessionId) {
    if (!sessionId) return null;
    try {
        const tracker = getTracker();
        const resume = tracker.getSnapshot(sessionId);
        if (!resume || resume.consumed) return null;

        tracker.markSnapshotConsumed(sessionId);
        return resume.snapshot;
    } catch (err) {
        logger.warn('context-mode', `onSessionResume error: ${err.message}`);
        return null;
    }
}

/**
 * Get context savings for UI display.
 */
function getContextSavings() {
    const totalIn = _savings.totalBytesIn;
    const totalOut = _savings.totalBytesOut;
    return {
        totalBytesIn: totalIn,
        totalBytesOut: totalOut,
        bytesSaved: totalIn - totalOut,
        savingsPercent: totalIn > 0 ? Math.round((1 - totalOut / totalIn) * 100) : 0,
        perTool: { ..._savings.perTool },
    };
}

// ══════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════

function registerContextModeIPC(ipcMain, getWindow) {
    ipcMain.handle('ctx-stats', async () => {
        try {
            return { success: true, ...handleStats() };
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('ctx-search', async (_event, queries, limit, source) => {
        try {
            const store = getStore();
            const results = store.search(queries || [], { limit: limit || 5, source, sessionId: _sessionId });
            return { success: true, results };
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('ctx-sources', async () => {
        try {
            const store = getStore();
            return { success: true, sources: store.listSources(_sessionId) };
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('ctx-clear-session', async () => {
        try {
            const store = getStore();
            const tracker = getTracker();
            store.clearSession(_sessionId);
            tracker.clearSession(_sessionId);
            _savings.totalBytesIn = 0;
            _savings.totalBytesOut = 0;
            _savings.perTool = {};
            _searchCallCount = 0;
            return { success: true };
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('ctx-event-list', async (_event, limit) => {
        try {
            const tracker = getTracker();
            const events = tracker.getEvents(_sessionId, { limit: limit || 50 });
            return { success: true, events };
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('ctx-snapshot', async () => {
        try {
            const tracker = getTracker();
            const result = tracker.saveSnapshot(_sessionId);
            return { success: true, ...result };
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('ctx-savings', async () => {
        return { success: true, ...getContextSavings() };
    });
}

// ══════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════

function trackSavings(toolName, bytesIn, bytesOut) {
    _savings.totalBytesIn += bytesIn;
    _savings.totalBytesOut += bytesOut;
    if (!_savings.perTool[toolName]) {
        _savings.perTool[toolName] = { calls: 0, bytesIn: 0, bytesOut: 0 };
    }
    _savings.perTool[toolName].calls++;
    _savings.perTool[toolName].bytesIn += bytesIn;
    _savings.perTool[toolName].bytesOut += bytesOut;

    // Notify renderer of savings update
    if (_mainWindow && !_mainWindow.isDestroyed()) {
        _mainWindow.webContents.send('ctx-savings-update', {
            tool: toolName,
            bytesIn,
            bytesOut,
            savingsPercent: bytesIn > 0 ? Math.round((1 - bytesOut / bytesIn) * 100) : 0,
        });
    }
}

function _getCurrentProjectPath() {
    try {
        const { getCurrentProjectPath } = require('./aiTools');
        return getCurrentProjectPath() || process.cwd();
    } catch {
        return process.cwd();
    }
}

module.exports = {
    registerContextModeIPC,
    getContextModeToolDefinitions,
    executeContextModeTool,
    onToolComplete,
    onUserMessage,
    onPreCompact,
    onSessionResume,
    setMainWindow,
    setSessionId,
    getContextSavings,
};
