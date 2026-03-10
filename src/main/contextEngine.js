/**
 * Context Engine — Fast local retrieval layer for Onicode
 *
 * Provides pre-retrieval intelligence: dependency graphs, file outlines,
 * multi-signal file ranking, working set tracking, and parallel search.
 * Designed to be called BEFORE the frontier model, so the model receives
 * curated context instead of discovering code via serial tool calls.
 *
 * Architecture:
 *   Layer A (this file): fast deterministic retrieval
 *   Layer B (injected in index.js): pre-retrieval pipeline
 *   Layer C (tools in aiTools.js): high-level composite tools
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { logger } = require('./logger');
const { walkDir, SKIP_DIRS, INDEXABLE_EXTENSIONS, tokenize, getIndex, rankSearchResults } = require('./codeIndex');
const { getSymbols, getProjectSymbolTable } = require('./lsp');

// ══════════════════════════════════════════════════════════════════
//  Caches
// ══════════════════════════════════════════════════════════════════

const _importGraph = new Map();   // filePath -> Set<resolvedImportPath>
const _exportGraph = new Map();   // filePath -> Set<importerPath> (reverse index)
const _symbolMap = new Map();     // symbolName -> [{ file, kind, line, exported }]
const _fileOutlines = new Map();  // filePath -> { symbols: [], mtime, size }
const _searchCache = new Map();   // cacheKey -> { result, timestamp }
const _gitRecencyCache = { files: [], timestamp: 0, projectPath: null };

let _graphProjectPath = null;
let _graphTimestamp = 0;
let _watcher = null;
let _watchDebounce = null;
let _watchProjectPath = null;

const GRAPH_TTL = 120000;    // 2 min
const SEARCH_CACHE_TTL = 30000; // 30s
const GIT_CACHE_TTL = 30000;    // 30s
const MAX_GRAPH_FILES = 3000;

// ══════════════════════════════════════════════════════════════════
//  A1. Dependency Graph Builder (regex-based, fast)
// ══════════════════════════════════════════════════════════════════

const IMPORT_PATTERNS = [
    // ES6: import X from './foo'  /  import { X } from './foo'
    /(?:import\s+(?:[\w*{}\s,]+)\s+from\s+['"])(\.\.?\/[^'"]+)['"]/g,
    // require: const x = require('./foo')
    /require\s*\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g,
    // Dynamic import: import('./foo')
    /import\s*\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g,
];

const EXPORT_PATTERNS = [
    // export function/class/const/default
    /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g,
    // module.exports = X  /  exports.X =
    /(?:module\.exports\s*=\s*(\w+)|exports\.(\w+)\s*=)/g,
];

function resolveImportPath(importerDir, importSpec) {
    // Try exact, then with extensions
    const resolved = path.resolve(importerDir, importSpec);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;

    const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    for (const ext of exts) {
        const withExt = resolved + ext;
        if (fs.existsSync(withExt)) return withExt;
    }
    // Try /index.ts, /index.js etc.
    for (const ext of exts) {
        const indexPath = path.join(resolved, 'index' + ext);
        if (fs.existsSync(indexPath)) return indexPath;
    }
    return null;
}

/**
 * Build or refresh the dependency graph for a project.
 * Fast: regex-based scanning, no full AST parse.
 */
function buildDependencyGraph(projectPath) {
    const now = Date.now();
    if (_graphProjectPath === projectPath && (now - _graphTimestamp) < GRAPH_TTL) {
        return {
            files: _importGraph.size,
            symbols: _symbolMap.size,
            cached: true,
        };
    }

    const start = Date.now();
    _importGraph.clear();
    _exportGraph.clear();
    _symbolMap.clear();

    const files = walkDir(projectPath, [], 0);
    const jsFiles = files.filter(f => /\.(js|jsx|ts|tsx|mjs|cjs|vue|svelte)$/.test(f.path));

    for (const fileInfo of jsFiles.slice(0, MAX_GRAPH_FILES)) {
        const filePath = fileInfo.path;
        const fileDir = path.dirname(filePath);
        const relPath = path.relative(projectPath, filePath);

        let content;
        try {
            content = fs.readFileSync(filePath, 'utf-8');
        } catch { continue; }

        // Only scan first 500 lines for imports/exports (speed)
        const lines = content.split('\n');
        const scanContent = lines.slice(0, 500).join('\n');

        // Extract imports
        const imports = new Set();
        for (const pattern of IMPORT_PATTERNS) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(scanContent)) !== null) {
                const importSpec = match[1];
                const resolved = resolveImportPath(fileDir, importSpec);
                if (resolved) {
                    imports.add(resolved);
                    // Build reverse index
                    if (!_exportGraph.has(resolved)) _exportGraph.set(resolved, new Set());
                    _exportGraph.get(resolved).add(filePath);
                }
            }
        }
        _importGraph.set(filePath, imports);

        // Extract exported symbols
        for (const pattern of EXPORT_PATTERNS) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(scanContent)) !== null) {
                const name = match[1] || match[2];
                if (name && name.length > 1 && name.length < 80) {
                    if (!_symbolMap.has(name)) _symbolMap.set(name, []);
                    _symbolMap.get(name).push({
                        file: relPath,
                        absFile: filePath,
                        kind: 'export',
                        line: scanContent.substring(0, match.index).split('\n').length,
                        exported: true,
                    });
                }
            }
        }
    }

    _graphProjectPath = projectPath;
    _graphTimestamp = now;

    const duration = Date.now() - start;
    logger.info('context-engine', `Dependency graph built: ${_importGraph.size} files, ${_symbolMap.size} symbols in ${duration}ms`);

    return {
        files: _importGraph.size,
        symbols: _symbolMap.size,
        cached: false,
        duration,
    };
}

/**
 * Get files that import the given file.
 */
function getImporters(filePath) {
    const abs = path.resolve(filePath);
    const importers = _exportGraph.get(abs);
    return importers ? [...importers] : [];
}

/**
 * Get files that this file imports.
 */
function getImportees(filePath) {
    const abs = path.resolve(filePath);
    const imports = _importGraph.get(abs);
    return imports ? [...imports] : [];
}

/**
 * Get related files: importers + importees, optionally walk deeper.
 */
function getRelatedFiles(filePath, depth = 1) {
    const abs = path.resolve(filePath);
    const related = new Set();
    const queue = [{ file: abs, d: 0 }];
    const visited = new Set([abs]);

    while (queue.length > 0) {
        const { file, d } = queue.shift();
        if (d >= depth) continue;

        const importers = _exportGraph.get(file) || new Set();
        const importees = _importGraph.get(file) || new Set();

        for (const f of [...importers, ...importees]) {
            if (!visited.has(f)) {
                visited.add(f);
                related.add(f);
                queue.push({ file: f, d: d + 1 });
            }
        }
    }

    return [...related];
}

/**
 * Look up a symbol name across the dependency graph.
 */
function lookupSymbol(name) {
    return _symbolMap.get(name) || [];
}

// ══════════════════════════════════════════════════════════════════
//  A2. File Outline Cache
// ══════════════════════════════════════════════════════════════════

/**
 * Get a lightweight outline (functions, classes, exports) for a file.
 * Uses LSP if available (JS/TS), falls back to regex.
 */
function getFileOutline(filePath, projectPath) {
    const abs = path.resolve(filePath);

    // Check cache
    const cached = _fileOutlines.get(abs);
    if (cached) {
        try {
            const stat = fs.statSync(abs);
            if (stat.mtimeMs === cached.mtime) return cached.symbols;
        } catch { /* file gone, re-extract */ }
    }

    let symbols = [];
    const ext = path.extname(filePath).toLowerCase();

    // For JS/TS, use the TypeScript compiler API (more accurate)
    if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) {
        try {
            const result = getSymbols(projectPath || path.dirname(filePath), filePath);
            if (result.symbols && result.symbols.length > 0) {
                symbols = result.symbols.map(s => ({
                    name: s.name,
                    kind: s.kind,
                    line: s.line,
                    exported: s.exported || false,
                    signature: s.signature || null,
                }));
            }
        } catch { /* fallback to regex */ }
    }

    // Regex fallback for non-JS/TS or when LSP fails
    if (symbols.length === 0) {
        symbols = extractOutlineRegex(abs);
    }

    // Cache it
    try {
        const stat = fs.statSync(abs);
        _fileOutlines.set(abs, { symbols, mtime: stat.mtimeMs });
    } catch { /* can't stat, still return */ }

    return symbols;
}

/**
 * Regex-based outline extraction (works on any language).
 */
function extractOutlineRegex(filePath) {
    let content;
    try {
        content = fs.readFileSync(filePath, 'utf-8');
    } catch { return []; }

    const symbols = [];
    const lines = content.split('\n');

    const patterns = [
        { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,           kind: 'function' },
        { regex: /^(?:export\s+)?class\s+(\w+)/,                            kind: 'class' },
        { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/,            kind: 'variable' },
        { regex: /^(?:export\s+)?interface\s+(\w+)/,                         kind: 'interface' },
        { regex: /^(?:export\s+)?type\s+(\w+)/,                             kind: 'type' },
        { regex: /^(?:export\s+)?enum\s+(\w+)/,                             kind: 'enum' },
        { regex: /^def\s+(\w+)\s*\(/,                                       kind: 'function' },  // Python
        { regex: /^class\s+(\w+)/,                                          kind: 'class' },     // Python
        { regex: /^func\s+(\w+)/,                                           kind: 'function' },  // Go
        { regex: /^type\s+(\w+)\s+struct/,                                  kind: 'struct' },    // Go
    ];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trimStart();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) continue;

        for (const { regex, kind } of patterns) {
            const match = trimmed.match(regex);
            if (match) {
                const exported = /^export\s/.test(trimmed) || /^module\.exports/.test(trimmed);
                symbols.push({
                    name: match[1],
                    kind,
                    line: i + 1,
                    exported,
                    signature: null,
                });
                break;
            }
        }
    }

    return symbols;
}

// ══════════════════════════════════════════════════════════════════
//  A3. File Watcher (incremental reindex)
// ══════════════════════════════════════════════════════════════════

/**
 * Start watching a project directory for file changes.
 * Incrementally updates outlines and invalidates graph on changes.
 */
function startWatching(projectPath) {
    if (!projectPath) return;
    stopWatching(); // Clean up any previous watcher

    try {
        _watchProjectPath = projectPath;
        _watcher = fs.watch(projectPath, { recursive: true }, (eventType, filename) => {
            if (!filename) return;

            // Skip irrelevant files
            const ext = path.extname(filename).toLowerCase();
            if (!INDEXABLE_EXTENSIONS.has(ext)) return;

            // Check if in a skip directory
            const parts = filename.split(path.sep);
            if (parts.some(p => SKIP_DIRS.has(p))) return;

            // Debounce: batch changes over 500ms
            if (_watchDebounce) clearTimeout(_watchDebounce);
            _watchDebounce = setTimeout(() => {
                const fullPath = path.join(projectPath, filename);
                // Invalidate outline cache for changed file
                _fileOutlines.delete(path.resolve(fullPath));
                // Invalidate dependency graph (will be rebuilt on next access)
                _graphTimestamp = 0;
                // Invalidate search cache
                _searchCache.clear();

                logger.debug('context-engine', `File changed: ${filename}, caches invalidated`);
            }, 500);
        });

        _watcher.on('error', (err) => {
            logger.warn('context-engine', `File watcher error: ${err.message}`);
        });

        logger.info('context-engine', `Watching project: ${projectPath}`);
    } catch (err) {
        logger.warn('context-engine', `Could not start file watcher: ${err.message}`);
    }
}

function stopWatching() {
    if (_watcher) {
        try { _watcher.close(); } catch { /* ignore */ }
        _watcher = null;
    }
    if (_watchDebounce) {
        clearTimeout(_watchDebounce);
        _watchDebounce = null;
    }
    _watchProjectPath = null;
}

// ══════════════════════════════════════════════════════════════════
//  A4. Git Recency
// ══════════════════════════════════════════════════════════════════

/**
 * Get recently changed files from git log (cached for 30s).
 */
function getGitRecentFiles(projectPath, commitCount = 10) {
    const now = Date.now();
    if (_gitRecencyCache.projectPath === projectPath && (now - _gitRecencyCache.timestamp) < GIT_CACHE_TTL) {
        return _gitRecencyCache.files;
    }

    try {
        const output = execSync(
            `git log --name-only --pretty=format: -${commitCount}`,
            { cwd: projectPath, encoding: 'utf-8', timeout: 5000 }
        );
        const files = [...new Set(
            output.split('\n')
                .map(l => l.trim())
                .filter(l => l && !l.startsWith('commit '))
        )];

        _gitRecencyCache.files = files;
        _gitRecencyCache.timestamp = now;
        _gitRecencyCache.projectPath = projectPath;
        return files;
    } catch {
        return [];
    }
}

// ══════════════════════════════════════════════════════════════════
//  A5. Multi-Signal File Ranker
// ══════════════════════════════════════════════════════════════════

/**
 * Rank all known project files by relevance to a task description.
 * Uses multiple signals: filename match, TF-IDF, import proximity,
 * git recency, and path heuristics.
 */
function rankFilesForTask(taskDescription, options = {}) {
    const { projectPath, limit = 15, workingSetFiles = [] } = options;
    if (!projectPath) return [];

    // Ensure graph is built
    buildDependencyGraph(projectPath);

    const taskTokens = tokenize(taskDescription);
    const taskLower = taskDescription.toLowerCase();

    // Get TF-IDF results if index is available
    let tfidfResults = [];
    const index = getIndex();
    if (index && index._documents && index._documents.size > 0) {
        try {
            tfidfResults = index.search(taskDescription, 30);
        } catch { /* no index */ }
    }
    const tfidfMap = new Map(tfidfResults.map(r => [r.path, r.score / 1000])); // Normalize to 0-1

    // Get git-recent files
    const gitRecent = getGitRecentFiles(projectPath);
    const gitRecencyMap = new Map();
    gitRecent.forEach((f, i) => {
        gitRecencyMap.set(f, Math.max(0, 1 - (i * 0.05))); // First = 1.0, decays
    });

    // Working set as a Set for proximity
    const workingSet = new Set(workingSetFiles.map(f => path.resolve(f)));

    // Classify task for heuristic bonus
    const isTest = /\b(test|spec|coverage|unit|e2e)\b/i.test(taskLower);
    const isBugfix = /\b(fix|bug|error|crash|fail|broken)\b/i.test(taskLower);
    const isUI = /\b(ui|component|style|css|layout|design|frontend|render)\b/i.test(taskLower);
    const isConfig = /\b(config|setup|env|deploy|docker|build)\b/i.test(taskLower);

    // Score all known files
    const scored = [];
    const allFiles = walkDir(projectPath, [], 0);

    for (const fileInfo of allFiles.slice(0, 2000)) {
        const relPath = path.relative(projectPath, fileInfo.path);
        const basename = path.basename(fileInfo.path, path.extname(fileInfo.path)).toLowerCase();
        const absPath = fileInfo.path;

        const signals = {};

        // 1. Filename relevance: fuzzy match task tokens against basename
        const fileTokens = tokenize(basename);
        let nameMatchScore = 0;
        for (const taskToken of taskTokens) {
            for (const fileToken of fileTokens) {
                if (fileToken.includes(taskToken) || taskToken.includes(fileToken)) {
                    nameMatchScore += 1;
                }
            }
        }
        signals.filename = Math.min(1, nameMatchScore / Math.max(1, taskTokens.length));

        // 2. TF-IDF content relevance
        signals.tfidf = tfidfMap.get(relPath) || 0;

        // 3. Import proximity to working set
        let proxScore = 0;
        if (workingSet.size > 0) {
            const importers = _exportGraph.get(absPath) || new Set();
            const importees = _importGraph.get(absPath) || new Set();
            for (const f of [...importers, ...importees]) {
                if (workingSet.has(f)) { proxScore = 1; break; }
            }
            if (proxScore === 0) {
                // 2-hop check
                for (const f of [...importers, ...importees]) {
                    const secondHop = [...(_exportGraph.get(f) || []), ...(_importGraph.get(f) || [])];
                    if (secondHop.some(s => workingSet.has(s))) { proxScore = 0.5; break; }
                }
            }
        }
        signals.proximity = proxScore;

        // 4. Git recency
        signals.gitRecency = gitRecencyMap.get(relPath) || 0;

        // 5. Path heuristics
        let heuristicBonus = 0;
        const relLower = relPath.toLowerCase();
        if (isTest && (relLower.includes('test') || relLower.includes('spec') || relLower.includes('__tests__'))) {
            heuristicBonus += 0.3;
        }
        if (isBugfix && gitRecencyMap.has(relPath)) {
            heuristicBonus += 0.2;
        }
        if (isUI && (relLower.includes('component') || relLower.includes('view') || relLower.includes('.css') || relLower.includes('.scss'))) {
            heuristicBonus += 0.3;
        }
        if (isConfig && (relLower.includes('config') || relLower.includes('.env') || relLower.includes('docker'))) {
            heuristicBonus += 0.3;
        }
        signals.heuristic = heuristicBonus;

        // Weighted total
        const totalScore =
            signals.filename * 0.25 +
            signals.tfidf * 0.30 +
            signals.proximity * 0.15 +
            signals.gitRecency * 0.15 +
            signals.heuristic * 0.15;

        if (totalScore > 0.05) {
            scored.push({
                file: relPath,
                absFile: absPath,
                score: totalScore,
                signals,
                outline: null, // filled lazily below
            });
        }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Fill outlines for top results
    const topResults = scored.slice(0, limit);
    for (const result of topResults.slice(0, 8)) {
        try {
            result.outline = getFileOutline(result.absFile, projectPath).slice(0, 10);
        } catch { /* skip outline */ }
    }

    return topResults;
}

// ══════════════════════════════════════════════════════════════════
//  A6. Task Classifier (heuristic, no LLM)
// ══════════════════════════════════════════════════════════════════

function classifyTask(userMessage) {
    const lower = (userMessage || '').toLowerCase();
    if (/\b(fix|bug|error|crash|fail|broken|issue|wrong|not work|doesn't work|doesn.t work)\b/.test(lower)) return 'bugfix';
    if (/\b(add|create|build|implement|make|new feature|scaffold|set up|setup)\b/.test(lower)) return 'feature';
    if (/\b(refactor|rename|clean|reorganize|simplify|extract|move|restructure)\b/.test(lower)) return 'refactor';
    if (/\b(test|spec|coverage|unit test|e2e|integration test)\b/.test(lower)) return 'test';
    if (/\b(doc|readme|comment|explain|what does|how does|where is|what is|describe)\b/.test(lower)) return 'docs';
    if (/\b(style|css|design|layout|theme|color|font|responsive|ui)\b/.test(lower)) return 'ui';
    return 'general';
}

// ══════════════════════════════════════════════════════════════════
//  B. Pre-Retrieval Pipeline
// ══════════════════════════════════════════════════════════════════

/**
 * Extract likely-relevant nouns/identifiers from user message.
 * Used for symbol lookup pre-retrieval.
 */
function extractKeyTerms(message) {
    const words = message
        .replace(/[^a-zA-Z0-9_\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && w.length < 50);

    // Filter out common English words, keep identifiers
    const stopwords = new Set([
        'the', 'and', 'for', 'that', 'this', 'with', 'not', 'but', 'are', 'was',
        'have', 'has', 'had', 'from', 'can', 'been', 'would', 'could', 'should',
        'will', 'just', 'its', 'all', 'also', 'about', 'how', 'what', 'when',
        'where', 'why', 'which', 'some', 'any', 'more', 'other', 'than', 'very',
        'now', 'then', 'here', 'there', 'too', 'they', 'them', 'their', 'our',
        'your', 'you', 'make', 'like', 'use', 'get', 'set', 'add', 'fix',
        'please', 'need', 'want', 'does', 'look', 'see', 'way', 'new', 'old',
    ]);

    return [...new Set(words.filter(w => !stopwords.has(w.toLowerCase())))].slice(0, 8);
}

/**
 * Run parallel pre-retrieval for a user message.
 * Returns a context bundle to inject into the system prompt.
 */
async function preRetrieve(userMessage, projectPath, workingSetFiles = []) {
    if (!projectPath || !userMessage) return null;

    const start = Date.now();
    const taskType = classifyTask(userMessage);
    const keyTerms = extractKeyTerms(userMessage);

    try {
        const [ranked, symbolHits, gitRecent] = await Promise.all([
            // 1. Multi-signal file ranking
            Promise.resolve(rankFilesForTask(userMessage, {
                projectPath,
                limit: 15,
                workingSetFiles,
            })).catch(() => []),

            // 2. Symbol lookup for key terms
            Promise.resolve((() => {
                buildDependencyGraph(projectPath); // ensure graph exists
                const results = [];
                for (const term of keyTerms) {
                    const found = lookupSymbol(term);
                    if (found.length > 0) results.push(...found.slice(0, 3));
                    // Also try camelCase: e.g., "auth middleware" -> try "authMiddleware"
                }
                return results;
            })()).catch(() => []),

            // 3. Git recent changes (only for bugfixes)
            Promise.resolve(
                taskType === 'bugfix' ? getGitRecentFiles(projectPath, 5) : []
            ).catch(() => []),
        ]);

        const duration = Date.now() - start;
        logger.info('context-engine', `Pre-retrieval done in ${duration}ms: ${ranked.length} ranked, ${symbolHits.length} symbols, task=${taskType}`);

        return { ranked, symbolHits, gitRecent, taskType, duration };
    } catch (err) {
        logger.warn('context-engine', `Pre-retrieval failed: ${err.message}`);
        return null;
    }
}

/**
 * Assemble pre-retrieved results into a context string for injection.
 * Token budget: ~3000 tokens (~12000 chars).
 */
function assemblePreRetrievedContext(preResult) {
    if (!preResult) return '';
    const { ranked, symbolHits, gitRecent, taskType } = preResult;
    if (!ranked.length && !symbolHits.length && !gitRecent.length) return '';

    const parts = [];
    parts.push('## Pre-Retrieved Context');
    parts.push('Files and symbols pre-gathered as likely relevant. Use directly instead of searching. Request more with search tools if needed.\n');

    // Top-ranked files with outlines
    if (ranked.length > 0) {
        parts.push('### Relevant Files');
        for (const file of ranked.slice(0, 10)) {
            const scoreStr = file.score.toFixed(2);
            const topSignals = Object.entries(file.signals)
                .filter(([, v]) => v > 0.1)
                .map(([k, v]) => `${k}:${v.toFixed(1)}`)
                .join(' ');
            parts.push(`- \`${file.file}\` (${scoreStr}) [${topSignals}]`);
            if (file.outline && file.outline.length > 0) {
                for (const sym of file.outline.slice(0, 6)) {
                    parts.push(`  - ${sym.kind} \`${sym.name}\` L${sym.line}${sym.exported ? ' (exp)' : ''}`);
                }
            }
        }
    }

    // Symbol matches
    if (symbolHits.length > 0) {
        const deduped = [...new Map(symbolHits.map(s => [`${s.file}:${s.name}`, s])).values()];
        if (deduped.length > 0) {
            parts.push('\n### Symbol Matches');
            for (const sym of deduped.slice(0, 10)) {
                parts.push(`- \`${sym.name}\` (${sym.kind}) in \`${sym.file}\`:${sym.line}`);
            }
        }
    }

    // Git-recent for bugfixes
    if (gitRecent.length > 0 && taskType === 'bugfix') {
        parts.push('\n### Recently Changed (git)');
        for (const file of gitRecent.slice(0, 8)) {
            parts.push(`- \`${file}\``);
        }
    }

    const assembled = parts.join('\n');

    // Token budget: ~3000 tokens ≈ 12000 chars
    if (assembled.length > 12000) {
        return assembled.slice(0, 12000) + '\n... (truncated)';
    }

    return assembled;
}

// ══════════════════════════════════════════════════════════════════
//  C. High-Level Composite Tools
// ══════════════════════════════════════════════════════════════════

/**
 * Tool definitions for the 5 composite tools.
 */
function getContextEngineToolDefinitions() {
    return [
        {
            type: 'function',
            function: {
                name: 'find_implementation',
                description: 'Smart search: finds where a feature/concept is implemented by combining text search, symbol lookup, and import graph. Returns ranked files with outlines. Much faster than multiple search_files calls.',
                parameters: {
                    type: 'object',
                    properties: {
                        description: { type: 'string', description: 'What to find (e.g., "authentication middleware", "payment webhook handler")' },
                        project_path: { type: 'string', description: 'Project root (uses active project if omitted)' },
                    },
                    required: ['description'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'impact_analysis',
                description: 'Analyze the impact of changing a file or symbol. Returns importers, dependents, related tests, and configuration files.',
                parameters: {
                    type: 'object',
                    properties: {
                        file_path: { type: 'string', description: 'File to analyze' },
                        symbol_name: { type: 'string', description: 'Specific symbol (optional)' },
                        project_path: { type: 'string', description: 'Project root' },
                    },
                    required: ['file_path'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'prepare_edit_context',
                description: 'Prepare full context for editing a file: outline, imports/exports, dependents, recent git changes, related tests. Call BEFORE editing complex files.',
                parameters: {
                    type: 'object',
                    properties: {
                        file_path: { type: 'string', description: 'Absolute path to the file' },
                        project_path: { type: 'string', description: 'Project root' },
                    },
                    required: ['file_path'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'smart_read',
                description: 'Read a file intelligently: returns outline first, then expands the section matching your focus. Avoids reading huge files entirely when you only need one function.',
                parameters: {
                    type: 'object',
                    properties: {
                        file_path: { type: 'string', description: 'Absolute path to the file' },
                        focus: { type: 'string', description: 'What to find in this file (e.g., "handleLogin function", "database config")' },
                        project_path: { type: 'string', description: 'Project root' },
                    },
                    required: ['file_path'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'batch_search',
                description: 'Run multiple search queries in parallel. Returns merged, deduplicated, ranked results. Much faster than serial search_files calls.',
                parameters: {
                    type: 'object',
                    properties: {
                        queries: { type: 'array', items: { type: 'string' }, description: 'Search patterns to run in parallel' },
                        search_path: { type: 'string', description: 'Directory to search in' },
                        file_pattern: { type: 'string', description: 'Glob filter (e.g., "*.ts")' },
                        max_results: { type: 'integer', description: 'Max total results (default 30)' },
                    },
                    required: ['queries', 'search_path'],
                },
            },
        },
    ];
}

/**
 * Execute a composite tool.
 */
function executeContextEngineTool(name, args, projectPath) {
    const effectivePath = args.project_path || projectPath;

    switch (name) {
        case 'find_implementation':
            return executeFindImplementation(args.description, effectivePath);
        case 'impact_analysis':
            return executeImpactAnalysis(args.file_path, args.symbol_name, effectivePath);
        case 'prepare_edit_context':
            return executePrepareEditContext(args.file_path, effectivePath);
        case 'smart_read':
            return executeSmartRead(args.file_path, args.focus, effectivePath);
        case 'batch_search':
            return executeBatchSearch(args.queries, args.search_path, args.file_pattern, args.max_results);
        default:
            return { error: `Unknown context engine tool: ${name}` };
    }
}

// ── Tool Executors ──

function executeFindImplementation(description, projectPath) {
    if (!projectPath) return { error: 'No project path' };
    buildDependencyGraph(projectPath);

    const ranked = rankFilesForTask(description, { projectPath, limit: 12 });

    // For top 5, also read a snippet around the most relevant symbol
    const results = ranked.map((r, i) => {
        const entry = {
            file: r.file,
            score: r.score,
            signals: r.signals,
            outline: r.outline || [],
        };

        if (i < 5 && r.absFile) {
            try {
                const content = fs.readFileSync(r.absFile, 'utf-8');
                const lines = content.split('\n');
                // Find best matching line using task tokens
                const descTokens = tokenize(description);
                let bestLine = 0;
                let bestScore = 0;
                for (let l = 0; l < lines.length; l++) {
                    const lineTokens = tokenize(lines[l]);
                    let score = 0;
                    for (const t of descTokens) {
                        if (lineTokens.some(lt => lt.includes(t) || t.includes(lt))) score++;
                    }
                    if (score > bestScore) { bestScore = score; bestLine = l; }
                }
                // Extract snippet around best line (±15 lines)
                const start = Math.max(0, bestLine - 15);
                const end = Math.min(lines.length, bestLine + 15);
                entry.snippet = {
                    startLine: start + 1,
                    endLine: end,
                    content: lines.slice(start, end).join('\n'),
                };
            } catch { /* skip snippet */ }
        }

        return entry;
    });

    return { results, total: results.length };
}

function executeImpactAnalysis(filePath, symbolName, projectPath) {
    if (!projectPath) return { error: 'No project path' };
    const absPath = path.resolve(filePath);
    const relPath = path.relative(projectPath, absPath);

    buildDependencyGraph(projectPath);

    const importers = getImporters(absPath).map(f => path.relative(projectPath, f));
    const importees = getImportees(absPath).map(f => path.relative(projectPath, f));
    const related = getRelatedFiles(absPath, 2).map(f => path.relative(projectPath, f));

    // Find test files
    const basename = path.basename(absPath, path.extname(absPath));
    let testFiles = [];
    try {
        const allFiles = walkDir(projectPath, [], 0);
        testFiles = allFiles
            .filter(f => {
                const name = path.basename(f.path).toLowerCase();
                return (name.includes('.test.') || name.includes('.spec.') || name.includes('__test'))
                    && name.includes(basename.toLowerCase());
            })
            .map(f => path.relative(projectPath, f.path))
            .slice(0, 5);
    } catch { /* skip test scan */ }

    // Symbol references if provided
    let symbolRefs = [];
    if (symbolName) {
        const fromGraph = lookupSymbol(symbolName);
        symbolRefs = fromGraph.map(s => ({ file: s.file, line: s.line, kind: s.kind }));
    }

    const outline = getFileOutline(absPath, projectPath);

    return {
        file: relPath,
        outline: outline.slice(0, 15),
        importers,
        importees,
        relatedFiles: related.filter(f => !importers.includes(f) && !importees.includes(f)).slice(0, 10),
        testFiles,
        symbolRefs: symbolRefs.slice(0, 10),
        impactSummary: `${importers.length} files import this, ${testFiles.length} test files found`,
    };
}

function executePrepareEditContext(filePath, projectPath) {
    if (!projectPath) return { error: 'No project path' };
    const absPath = path.resolve(filePath);
    const relPath = path.relative(projectPath, absPath);

    buildDependencyGraph(projectPath);

    const outline = getFileOutline(absPath, projectPath);
    const importers = getImporters(absPath).map(f => path.relative(projectPath, f));
    const importees = getImportees(absPath).map(f => path.relative(projectPath, f));

    // Git recent changes for this file
    let recentChanges = [];
    try {
        const output = execSync(
            `git log --oneline -5 -- "${relPath}"`,
            { cwd: projectPath, encoding: 'utf-8', timeout: 3000 }
        );
        recentChanges = output.trim().split('\n').filter(Boolean);
    } catch { /* no git or no history */ }

    // Find test files
    const basename = path.basename(absPath, path.extname(absPath));
    let testFiles = [];
    try {
        const allFiles = walkDir(projectPath, [], 0);
        testFiles = allFiles
            .filter(f => {
                const name = path.basename(f.path).toLowerCase();
                return (name.includes('.test.') || name.includes('.spec.'))
                    && name.includes(basename.toLowerCase());
            })
            .map(f => path.relative(projectPath, f.path))
            .slice(0, 3);
    } catch { /* skip */ }

    // File stats
    let stats = {};
    try {
        const s = fs.statSync(absPath);
        const content = fs.readFileSync(absPath, 'utf-8');
        stats = { lines: content.split('\n').length, size: s.size };
    } catch { /* skip */ }

    return {
        file: relPath,
        stats,
        outline: outline.slice(0, 20),
        imports: importees.slice(0, 10),
        importedBy: importers.slice(0, 10),
        recentGitChanges: recentChanges,
        testFiles,
    };
}

function executeSmartRead(filePath, focus, projectPath) {
    const absPath = path.resolve(filePath);

    let content;
    try {
        content = fs.readFileSync(absPath, 'utf-8');
    } catch (err) {
        return { error: `Cannot read file: ${err.message}` };
    }

    const lines = content.split('\n');

    // Short files: return everything
    if (lines.length <= 200) {
        return {
            file: path.relative(projectPath || path.dirname(absPath), absPath),
            totalLines: lines.length,
            mode: 'full',
            content,
        };
    }

    // Get outline
    const outline = getFileOutline(absPath, projectPath);

    if (!focus) {
        // No focus: return outline + first 30 lines
        return {
            file: path.relative(projectPath || path.dirname(absPath), absPath),
            totalLines: lines.length,
            mode: 'outline',
            outline,
            preview: lines.slice(0, 30).join('\n'),
            hint: 'Provide a `focus` parameter to read a specific section, or use read_file for the full content.',
        };
    }

    // Find the outline entry that best matches the focus
    const focusTokens = tokenize(focus);
    let bestSymbol = null;
    let bestScore = 0;

    for (const sym of outline) {
        const symTokens = tokenize(sym.name);
        let score = 0;
        for (const ft of focusTokens) {
            for (const st of symTokens) {
                if (st.includes(ft) || ft.includes(st)) score += 2;
            }
        }
        // Also check if the focus words appear near this symbol's line
        const nearby = lines.slice(Math.max(0, sym.line - 3), sym.line + 3).join(' ').toLowerCase();
        for (const ft of focusTokens) {
            if (nearby.includes(ft.toLowerCase())) score += 1;
        }
        if (score > bestScore) {
            bestScore = score;
            bestSymbol = sym;
        }
    }

    if (bestSymbol) {
        // Find the end of this symbol's block (heuristic: next symbol at same level, or +80 lines)
        const startLine = Math.max(0, bestSymbol.line - 5);
        let endLine = bestSymbol.line + 80;
        for (const sym of outline) {
            if (sym.line > bestSymbol.line && sym.line < endLine) {
                endLine = sym.line - 1;
                break;
            }
        }
        endLine = Math.min(lines.length, endLine);

        return {
            file: path.relative(projectPath || path.dirname(absPath), absPath),
            totalLines: lines.length,
            mode: 'focused',
            matchedSymbol: bestSymbol,
            outline,
            content: lines.slice(startLine, endLine).join('\n'),
            startLine: startLine + 1,
            endLine,
            hint: `Showing L${startLine + 1}-${endLine} around \`${bestSymbol.name}\`. Use read_file for full content.`,
        };
    }

    // Fallback: text search for focus within file
    let bestLine = 0;
    let bestLineScore = 0;
    for (let i = 0; i < lines.length; i++) {
        const lineTokens = tokenize(lines[i]);
        let score = 0;
        for (const ft of focusTokens) {
            if (lineTokens.some(lt => lt.includes(ft))) score++;
        }
        if (score > bestLineScore) {
            bestLineScore = score;
            bestLine = i;
        }
    }

    const start = Math.max(0, bestLine - 30);
    const end = Math.min(lines.length, bestLine + 30);

    return {
        file: path.relative(projectPath || path.dirname(absPath), absPath),
        totalLines: lines.length,
        mode: 'search',
        outline,
        content: lines.slice(start, end).join('\n'),
        startLine: start + 1,
        endLine: end,
        hint: `Showing L${start + 1}-${end} around best match for "${focus}". Use read_file for full content.`,
    };
}

async function executeBatchSearch(queries, searchPath, filePattern, maxResults = 30) {
    if (!queries || queries.length === 0) return { error: 'No queries provided' };
    if (!searchPath) return { error: 'No search path' };

    const { execSync } = require('child_process');
    const allMatches = [];

    // Run all searches in parallel
    const results = await Promise.all(queries.map(query => {
        return new Promise(resolve => {
            try {
                let cmd;
                const escaped = query.replace(/"/g, '\\"');
                if (filePattern) {
                    cmd = `rg -n -C 1 --max-count 10 --glob "${filePattern}" "${escaped}" "${searchPath}" 2>/dev/null || grep -rn "${escaped}" "${searchPath}" --include="${filePattern}" 2>/dev/null | head -10`;
                } else {
                    cmd = `rg -n -C 1 --max-count 10 "${escaped}" "${searchPath}" 2>/dev/null || grep -rn "${escaped}" "${searchPath}" 2>/dev/null | head -10`;
                }
                const output = execSync(cmd, { encoding: 'utf-8', timeout: 10000, maxBuffer: 1024 * 1024 });
                const matches = parseGrepOutput(output, searchPath, query);
                resolve(matches);
            } catch {
                resolve([]);
            }
        });
    }));

    // Merge and deduplicate
    const seen = new Set();
    for (const matchList of results) {
        for (const match of matchList) {
            const key = `${match.file}:${match.line}`;
            if (!seen.has(key)) {
                seen.add(key);
                allMatches.push(match);
            }
        }
    }

    // Re-rank using TF-IDF if available
    const index = getIndex();
    if (index && allMatches.length > 0) {
        try {
            const reranked = rankSearchResults(allMatches, queries.join(' '), index);
            return { matches: reranked.slice(0, maxResults), total: allMatches.length, queries: queries.length };
        } catch { /* fall through */ }
    }

    return { matches: allMatches.slice(0, maxResults), total: allMatches.length, queries: queries.length };
}

function parseGrepOutput(output, searchPath, query) {
    const matches = [];
    const lines = output.split('\n');
    for (const line of lines) {
        if (!line.trim() || line === '--') continue;
        // Format: file:line:content or file-line-content (context lines)
        const match = line.match(/^(.+?)[:-](\d+)[:-](.*)$/);
        if (match) {
            matches.push({
                file: path.relative(searchPath, match[1]),
                line: parseInt(match[2]),
                content: match[3].trim().slice(0, 200),
                query,
            });
        }
    }
    return matches;
}

// ══════════════════════════════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════════════════════════════

function registerContextEngineIPC(ipcMain) {
    ipcMain.handle('context-engine-rank', async (_event, { taskDescription, projectPath, limit }) => {
        try {
            return { success: true, results: rankFilesForTask(taskDescription, { projectPath, limit }) };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('context-engine-outline', async (_event, { filePath, projectPath }) => {
        try {
            return { success: true, outline: getFileOutline(filePath, projectPath) };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('context-engine-related', async (_event, { filePath, projectPath }) => {
        try {
            buildDependencyGraph(projectPath);
            const importers = getImporters(filePath).map(f => path.relative(projectPath, f));
            const importees = getImportees(filePath).map(f => path.relative(projectPath, f));
            return { success: true, importers, importees };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('context-engine-graph-stats', async (_event, { projectPath }) => {
        try {
            const stats = buildDependencyGraph(projectPath);
            return { success: true, ...stats };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
}

// ══════════════════════════════════════════════════════════════════
//  Exports
// ══════════════════════════════════════════════════════════════════

module.exports = {
    // Graph
    buildDependencyGraph,
    getImporters,
    getImportees,
    getRelatedFiles,
    lookupSymbol,

    // Outlines
    getFileOutline,

    // Ranking
    rankFilesForTask,
    classifyTask,

    // Pre-retrieval pipeline
    preRetrieve,
    assemblePreRetrievedContext,
    extractKeyTerms,

    // Composite tools
    getContextEngineToolDefinitions,
    executeContextEngineTool,

    // File watcher
    startWatching,
    stopWatching,

    // IPC
    registerContextEngineIPC,
};
