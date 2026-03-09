/**
 * Code Indexer — TF-IDF based code search with persistent index
 *
 * Provides semantic-ish search: "find authentication logic" returns
 * files about auth even if they don't contain the exact word.
 *
 * Index stored in ~/.onicode/code-index/<project-hash>.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { logger } = require('./logger');

// ══════════════════════════════════════════════════════════════════
//  Constants
// ══════════════════════════════════════════════════════════════════

const INDEX_DIR = path.join(os.homedir(), '.onicode', 'code-index');

const MAX_FILES = 2000;
const MAX_FILE_SIZE = 500 * 1024; // 500KB

const SKIP_DIRS = new Set([
    'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out',
    '.next', '.nuxt', '.output', '__pycache__', '.cache', '.parcel-cache',
    'vendor', 'target', 'coverage', '.nyc_output', '.turbo',
    '.vscode', '.idea', '.DS_Store', 'tmp', 'temp',
]);

const SKIP_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
    '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.exe', '.dll', '.so', '.dylib', '.bin',
    '.lock', '.map', '.min.js', '.min.css',
    '.pyc', '.pyo', '.class', '.o', '.obj',
]);

const INDEXABLE_EXTENSIONS = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
    '.py', '.rb', '.go', '.rs', '.java', '.kt', '.scala',
    '.c', '.cpp', '.cc', '.h', '.hpp',
    '.cs', '.swift', '.m', '.mm',
    '.php', '.lua', '.r', '.jl',
    '.html', '.htm', '.css', '.scss', '.sass', '.less',
    '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg',
    '.xml', '.graphql', '.gql', '.prisma',
    '.sql', '.sh', '.bash', '.zsh', '.fish', '.ps1',
    '.md', '.mdx', '.txt', '.rst', '.tex',
    '.env.example', '.gitignore', '.dockerignore',
    '.dockerfile', '.makefile',
    '.vue', '.svelte', '.astro',
]);

const STOPWORDS = new Set([
    'the', 'is', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at',
    'to', 'for', 'of', 'with', 'by', 'from', 'as', 'into', 'through',
    'this', 'that', 'it', 'its', 'be', 'are', 'was', 'were', 'been',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'not', 'no', 'nor',
    'if', 'then', 'else', 'when', 'while', 'so', 'up', 'out', 'about',
    'which', 'what', 'who', 'how', 'where', 'there', 'here', 'all',
    'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
    'such', 'only', 'own', 'same', 'than', 'too', 'very', 'just',
    'because', 'also', 'between', 'after', 'before',
    // code-specific stopwords
    'var', 'let', 'const', 'new', 'null', 'undefined', 'true', 'false',
    'return', 'void', 'else', 'case', 'break', 'continue', 'default',
]);

// ══════════════════════════════════════════════════════════════════
//  Text Processing
// ══════════════════════════════════════════════════════════════════

/**
 * Split on non-alphanumeric, camelCase boundaries, underscores.
 * "getUserById"   → ["get", "user", "by", "id"]
 * "AUTH_TOKEN_KEY" → ["auth", "token", "key"]
 * Removes stopwords and stems basic suffixes.
 */
function tokenize(text) {
    if (!text || typeof text !== 'string') return [];

    // Insert space at camelCase boundaries: "getUserById" → "get User By Id"
    let expanded = text.replace(/([a-z])([A-Z])/g, '$1 $2');
    // Split acronym runs: "HTMLParser" → "HTML Parser"
    expanded = expanded.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

    // Split on non-alphanumeric
    const raw = expanded.split(/[^a-zA-Z0-9]+/).filter(Boolean);

    const tokens = [];
    for (const word of raw) {
        const lower = word.toLowerCase();
        if (lower.length < 2) continue;
        if (STOPWORDS.has(lower)) continue;
        tokens.push(stem(lower));
    }
    return tokens;
}

/**
 * Basic suffix stemmer. Strips common English suffixes.
 * Not Porter — just enough to conflate "authentication" → "authent",
 * "running" → "run", "connected" → "connect".
 */
function stem(word) {
    if (word.length <= 3) return word;

    // Order matters: try longest suffixes first
    const suffixes = [
        { suffix: 'ization', replace: 'ize' },
        { suffix: 'isation', replace: 'ise' },
        { suffix: 'ation', replace: 'ate' },
        { suffix: 'tion', replace: '' },
        { suffix: 'sion', replace: '' },
        { suffix: 'ment', replace: '' },
        { suffix: 'ness', replace: '' },
        { suffix: 'able', replace: '' },
        { suffix: 'ible', replace: '' },
        { suffix: 'ence', replace: '' },
        { suffix: 'ance', replace: '' },
        { suffix: 'ious', replace: '' },
        { suffix: 'eous', replace: '' },
        { suffix: 'ful', replace: '' },
        { suffix: 'ous', replace: '' },
        { suffix: 'ive', replace: '' },
        { suffix: 'ing', replace: '' },
        { suffix: 'ied', replace: 'y' },
        { suffix: 'ies', replace: 'y' },
        { suffix: 'ed', replace: '' },
        { suffix: 'er', replace: '' },
        { suffix: 'ly', replace: '' },
        { suffix: 'es', replace: '' },
        { suffix: 's', replace: '' },
    ];

    for (const { suffix, replace } of suffixes) {
        if (word.endsWith(suffix) && word.length - suffix.length + replace.length >= 3) {
            return word.slice(0, word.length - suffix.length) + replace;
        }
    }
    return word;
}

/**
 * Extract meaningful tokens from code with weighted importance.
 *
 * @param {string} content - File content
 * @param {string} filePath - Absolute file path
 * @returns {{ tokens: string[], weights: Map<string, number> }}
 */
function extractCodeTokens(content, filePath) {
    const weights = new Map(); // token → cumulative weight
    const allTokens = [];

    function addTokens(text, weight) {
        const tokens = tokenize(text);
        for (const t of tokens) {
            allTokens.push(t);
            weights.set(t, (weights.get(t) || 0) + weight);
        }
    }

    // --- File path segments (weight 1.0) ---
    const pathSegments = filePath.split(path.sep).filter(Boolean);
    const fileName = path.basename(filePath, path.extname(filePath));
    addTokens(pathSegments.join(' '), 1.0);
    addTokens(fileName, 1.5);

    // --- Comments (weight 2.0) — developers describe intent here ---
    // Single-line comments: // ... or # ...
    const singleLineComments = content.match(/(?:\/\/|#)\s*(.+)/g) || [];
    for (const c of singleLineComments) {
        const text = c.replace(/^(?:\/\/|#)\s*/, '');
        addTokens(text, 2.0);
    }

    // Multi-line comments: /* ... */ or """ ... """ or ''' ... '''
    const multiLineComments = content.match(/\/\*[\s\S]*?\*\//g) || [];
    for (const c of multiLineComments) {
        const text = c.replace(/^\/\*\s*|\s*\*\/$/g, '').replace(/^\s*\*\s?/gm, '');
        addTokens(text, 2.0);
    }

    // JSDoc/TSDoc @tags
    const docTags = content.match(/@(?:param|returns?|throws|description|summary|example)\s+[^\n]+/g) || [];
    for (const tag of docTags) {
        addTokens(tag, 2.0);
    }

    // --- Function / class / variable names (weight 1.5) ---
    // JS/TS: function name, const name = (arrow), class Name
    const fnNames = content.match(/(?:function\s+|(?:const|let|var)\s+)([a-zA-Z_$][\w$]*)/g) || [];
    for (const fn of fnNames) {
        const name = fn.replace(/^(?:function|const|let|var)\s+/, '');
        addTokens(name, 1.5);
    }

    // class/interface/type/enum declarations
    const classNames = content.match(/(?:class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g) || [];
    for (const cls of classNames) {
        const name = cls.replace(/^(?:class|interface|type|enum)\s+/, '');
        addTokens(name, 1.5);
    }

    // Python: def name, class Name
    const pyNames = content.match(/(?:def|class)\s+([a-zA-Z_][\w]*)/g) || [];
    for (const py of pyNames) {
        const name = py.replace(/^(?:def|class)\s+/, '');
        addTokens(name, 1.5);
    }

    // Go: func (receiver) Name or func Name
    const goNames = content.match(/func\s+(?:\([^)]*\)\s+)?([A-Za-z_][\w]*)/g) || [];
    for (const go of goNames) {
        const match = go.match(/func\s+(?:\([^)]*\)\s+)?([A-Za-z_][\w]*)/);
        if (match) addTokens(match[1], 1.5);
    }

    // Rust: fn name, struct Name, impl Name, trait Name
    const rustNames = content.match(/(?:fn|struct|impl|trait|enum|mod)\s+([A-Za-z_][\w]*)/g) || [];
    for (const rs of rustNames) {
        const name = rs.replace(/^(?:fn|struct|impl|trait|enum|mod)\s+/, '');
        addTokens(name, 1.5);
    }

    // --- Imports (weight 1.0) ---
    // JS/TS: import ... from 'path' or require('path')
    const importPaths = content.match(/(?:from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"])/g) || [];
    for (const imp of importPaths) {
        const match = imp.match(/['"]([^'"]+)['"]/);
        if (match) addTokens(match[1], 1.0);
    }

    // Python: import x, from x import y
    const pyImports = content.match(/(?:from|import)\s+([\w.]+)/g) || [];
    for (const imp of pyImports) {
        const name = imp.replace(/^(?:from|import)\s+/, '');
        addTokens(name, 1.0);
    }

    // --- String literals (weight 0.8) — error messages, routes, etc. ---
    const strings = content.match(/['"`]([^'"`\n]{4,80})['"`]/g) || [];
    for (const s of strings) {
        const inner = s.slice(1, -1);
        // Skip things that look like paths with node_modules or URLs with protocols
        if (inner.includes('node_modules') || /^https?:\/\//.test(inner)) continue;
        addTokens(inner, 0.8);
    }

    // --- Remaining code tokens (weight 0.5) ---
    // Strip comments and strings, then tokenize the rest
    let stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ')
        .replace(/#[^\n]*/g, ' ')
        .replace(/(['"`])(?:(?!\1).)*\1/g, ' ');
    addTokens(stripped, 0.5);

    return { tokens: allTokens, weights };
}

// ══════════════════════════════════════════════════════════════════
//  Edit Distance (for fuzzy matching)
// ══════════════════════════════════════════════════════════════════

/**
 * Compute Levenshtein edit distance between two strings.
 * Optimized single-row DP.
 */
function editDistance(a, b) {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    // Ensure a is shorter for space optimization
    if (a.length > b.length) { const t = a; a = b; b = t; }

    const aLen = a.length;
    const bLen = b.length;
    const row = new Array(aLen + 1);

    for (let i = 0; i <= aLen; i++) row[i] = i;

    for (let j = 1; j <= bLen; j++) {
        let prev = row[0];
        row[0] = j;
        for (let i = 1; i <= aLen; i++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            const val = Math.min(
                row[i] + 1,       // deletion
                row[i - 1] + 1,   // insertion
                prev + cost        // substitution
            );
            prev = row[i];
            row[i] = val;
        }
    }
    return row[aLen];
}

// ══════════════════════════════════════════════════════════════════
//  File System Helpers
// ══════════════════════════════════════════════════════════════════

/**
 * Recursively walk a directory tree, yielding file paths.
 * Respects skip lists, max file count, and max file size.
 */
function walkDir(dir, files = [], depth = 0) {
    if (depth > 20) return files; // prevent runaway recursion
    if (files.length >= MAX_FILES) return files;

    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return files; // permission denied, etc.
    }

    for (const entry of entries) {
        if (files.length >= MAX_FILES) break;

        const name = entry.name;
        if (name.startsWith('.') && name !== '.env.example') continue;

        const fullPath = path.join(dir, name);

        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(name)) continue;
            walkDir(fullPath, files, depth + 1);
        } else if (entry.isFile()) {
            const ext = path.extname(name).toLowerCase();
            if (SKIP_EXTENSIONS.has(ext)) continue;

            // Check if extension is indexable, or if filename is special
            const baseLower = name.toLowerCase();
            const isIndexable = INDEXABLE_EXTENSIONS.has(ext)
                || baseLower === 'makefile'
                || baseLower === 'dockerfile'
                || baseLower === 'rakefile'
                || baseLower === 'gemfile'
                || baseLower === 'cmakelists.txt';

            if (!isIndexable) continue;

            try {
                const stat = fs.statSync(fullPath);
                if (stat.size > MAX_FILE_SIZE) continue;
                if (stat.size === 0) continue;
                files.push({ path: fullPath, size: stat.size, mtime: stat.mtimeMs });
            } catch {
                continue;
            }
        }
    }

    return files;
}

/**
 * Create a stable hash for a project path (used for index filename).
 */
function projectHash(projectPath) {
    return crypto.createHash('sha256').update(projectPath).digest('hex').slice(0, 16);
}

// ══════════════════════════════════════════════════════════════════
//  CodeIndex Class — TF-IDF Engine
// ══════════════════════════════════════════════════════════════════

class CodeIndex {
    constructor() {
        /** @type {Map<string, { tokens: string[], weights: Map<string, number>, lineCount: number, lastModified: number }>} */
        this.documents = new Map();
        /** @type {Map<string, number>} token → IDF score */
        this.idf = new Map();
        /** @type {string|null} */
        this.projectPath = null;
        /** @type {string|null} */
        this.indexPath = null;
        /** @type {boolean} */
        this.dirty = false;
    }

    /**
     * Index a single file.
     * @param {string} filePath - Absolute path to file
     * @param {string} content - File content
     */
    indexFile(filePath, content) {
        const { tokens, weights } = extractCodeTokens(content, filePath);
        const lineCount = content.split('\n').length;

        let mtime = 0;
        try {
            mtime = fs.statSync(filePath).mtimeMs;
        } catch {
            // file may have been removed
        }

        this.documents.set(filePath, {
            tokens,
            weights,
            lineCount,
            lastModified: mtime,
        });
        this.dirty = true;
    }

    /**
     * Index an entire project directory.
     * Skips node_modules, .git, etc. Max 2000 files, max 500KB per file.
     *
     * @param {string} projectPath - Root directory to index
     * @param {object} [options]
     * @param {boolean} [options.force=false] - Rebuild even if cached index exists
     * @returns {Promise<{ files: number, tokens: number, duration: number }>}
     */
    async indexProject(projectPath, options = {}) {
        const start = Date.now();
        const resolvedPath = path.resolve(projectPath);

        // Try loading cached index first
        if (!options.force) {
            const loaded = this.load(resolvedPath);
            if (loaded) {
                // Check if we can do incremental update instead
                const updated = await this.updateChanged();
                if (updated.reindexed === 0 && updated.removed === 0) {
                    logger.info('code-index', `Loaded cached index for ${resolvedPath}`, {
                        files: this.documents.size,
                    });
                    return {
                        files: this.documents.size,
                        tokens: this.idf.size,
                        duration: Date.now() - start,
                        cached: true,
                    };
                }
            }
        }

        this.projectPath = resolvedPath;
        this.indexPath = path.join(INDEX_DIR, `${projectHash(resolvedPath)}.json`);
        this.documents.clear();
        this.idf.clear();

        logger.info('code-index', `Indexing project: ${resolvedPath}`);

        const files = walkDir(resolvedPath);
        logger.info('code-index', `Found ${files.length} files to index`);

        // Index in batches to avoid blocking the event loop too long
        const BATCH_SIZE = 50;
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
            const batch = files.slice(i, i + BATCH_SIZE);
            for (const fileInfo of batch) {
                try {
                    const content = fs.readFileSync(fileInfo.path, 'utf-8');
                    this.indexFile(fileInfo.path, content);
                } catch {
                    // skip unreadable files
                }
            }
            // Yield to event loop between batches
            if (i + BATCH_SIZE < files.length) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }

        this.computeIDF();
        this.save();

        const duration = Date.now() - start;
        logger.info('code-index', `Indexing complete`, {
            files: this.documents.size,
            tokens: this.idf.size,
            duration: `${duration}ms`,
        });

        return {
            files: this.documents.size,
            tokens: this.idf.size,
            duration,
            cached: false,
        };
    }

    /**
     * Recalculate IDF scores: log(N / df) for each token.
     * Called after indexing completes.
     */
    computeIDF() {
        const N = this.documents.size;
        if (N === 0) return;

        // Count document frequency for each token
        const df = new Map();
        for (const [, doc] of this.documents) {
            // Use a set to count each token only once per document
            const seen = new Set(doc.tokens);
            for (const token of seen) {
                df.set(token, (df.get(token) || 0) + 1);
            }
        }

        this.idf.clear();
        for (const [token, count] of df) {
            // Standard IDF with smoothing: log((N + 1) / (df + 1)) + 1
            this.idf.set(token, Math.log((N + 1) / (count + 1)) + 1);
        }
    }

    /**
     * Search the index using natural language or code snippets.
     *
     * @param {string} query - Search query
     * @param {number} [maxResults=15] - Max results to return
     * @returns {Array<{ file: string, score: number, matchedTokens: string[], preview: string }>}
     */
    search(query, maxResults = 15) {
        if (!this.projectPath || this.documents.size === 0) {
            return [];
        }

        const queryTokens = tokenize(query);
        if (queryTokens.length === 0) return [];

        // Build a set of all indexed tokens for fuzzy matching
        const indexedTokens = [...this.idf.keys()];

        // For each query token, find fuzzy matches (edit distance 1-2 for tokens > 4 chars)
        const expandedQueryMap = new Map(); // queryToken → [{token, penalty}]
        for (const qt of queryTokens) {
            const matches = [{ token: qt, penalty: 1.0 }]; // exact match, no penalty

            // Also check prefix matches and fuzzy matches
            if (qt.length >= 3) {
                for (const it of indexedTokens) {
                    if (it === qt) continue;

                    // Prefix match: query "auth" matches "authent", "authoriz"
                    if (it.startsWith(qt) || qt.startsWith(it)) {
                        matches.push({ token: it, penalty: 0.8 });
                        continue;
                    }

                    // Fuzzy match: edit distance 1-2 for tokens > 4 chars
                    if (qt.length > 4 && it.length > 4) {
                        const dist = editDistance(qt, it);
                        if (dist === 1) {
                            matches.push({ token: it, penalty: 0.7 });
                        } else if (dist === 2 && qt.length > 5) {
                            matches.push({ token: it, penalty: 0.4 });
                        }
                    }
                }
            }
            expandedQueryMap.set(qt, matches);
        }

        const scores = new Map();

        for (const [filePath, doc] of this.documents) {
            let score = 0;
            const matched = new Set();
            const tokenCount = doc.tokens.length || 1;

            for (const qt of queryTokens) {
                const expansions = expandedQueryMap.get(qt) || [];
                let bestContrib = 0;

                for (const { token, penalty } of expansions) {
                    const weight = doc.weights.get(token) || 0;
                    if (weight === 0) continue;

                    const tf = weight / tokenCount;
                    const idf = this.idf.get(token) || 0;
                    const contrib = tf * idf * penalty;

                    if (contrib > bestContrib) {
                        bestContrib = contrib;
                    }
                    matched.add(qt);
                }

                score += bestContrib;
            }

            // Boost: more query tokens matched = higher relevance
            if (matched.size > 0) {
                const coverageBoost = matched.size / queryTokens.length;
                score *= (1 + coverageBoost);
            }

            if (score > 0) {
                scores.set(filePath, { score, matched: [...matched] });
            }
        }

        return [...scores.entries()]
            .sort((a, b) => b[1].score - a[1].score)
            .slice(0, maxResults)
            .map(([file, { score, matched }]) => ({
                file: path.relative(this.projectPath, file),
                score: Math.round(score * 1000) / 1000,
                matchedTokens: matched,
                preview: this.getFilePreview(file, matched),
            }));
    }

    /**
     * Get a 3-line preview around the first match in a file.
     *
     * @param {string} filePath - Absolute file path
     * @param {string[]} matchedTokens - Tokens to look for
     * @returns {string}
     */
    getFilePreview(filePath, matchedTokens) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');

            // Find the first line that contains any matched token
            for (let i = 0; i < lines.length && i < 500; i++) {
                const lineLower = lines[i].toLowerCase();
                const lineTokens = tokenize(lines[i]);
                const hasMatch = matchedTokens.some(t =>
                    lineTokens.includes(t) || lineLower.includes(t)
                );

                if (hasMatch) {
                    const start = Math.max(0, i - 1);
                    const end = Math.min(lines.length, i + 2);
                    return lines.slice(start, end)
                        .map(l => l.length > 120 ? l.slice(0, 117) + '...' : l)
                        .join('\n');
                }
            }

            // Fallback: first 3 non-empty lines
            const nonEmpty = lines.filter(l => l.trim()).slice(0, 3);
            return nonEmpty.join('\n');
        } catch {
            return '';
        }
    }

    /**
     * Save the index to disk for fast reload.
     */
    save() {
        if (!this.indexPath || !this.dirty) return;

        try {
            if (!fs.existsSync(INDEX_DIR)) {
                fs.mkdirSync(INDEX_DIR, { recursive: true });
            }

            // Serialize: convert Maps to JSON-safe structures
            const serialized = {
                version: 1,
                projectPath: this.projectPath,
                createdAt: new Date().toISOString(),
                documents: {},
                idf: {},
            };

            for (const [filePath, doc] of this.documents) {
                serialized.documents[filePath] = {
                    tokens: doc.tokens,
                    weights: Object.fromEntries(doc.weights),
                    lineCount: doc.lineCount,
                    lastModified: doc.lastModified,
                };
            }

            for (const [token, score] of this.idf) {
                serialized.idf[token] = Math.round(score * 10000) / 10000;
            }

            const json = JSON.stringify(serialized);
            fs.writeFileSync(this.indexPath, json, 'utf-8');
            this.dirty = false;

            logger.info('code-index', `Index saved to ${this.indexPath}`, {
                size: `${Math.round(json.length / 1024)}KB`,
            });
        } catch (err) {
            logger.error('code-index', `Failed to save index: ${err.message}`);
        }
    }

    /**
     * Load a cached index from disk.
     *
     * @param {string} projectPath - Project root directory
     * @returns {boolean} True if loaded successfully
     */
    load(projectPath) {
        const resolvedPath = path.resolve(projectPath);
        const idxPath = path.join(INDEX_DIR, `${projectHash(resolvedPath)}.json`);

        if (!fs.existsSync(idxPath)) return false;

        try {
            const json = fs.readFileSync(idxPath, 'utf-8');
            const data = JSON.parse(json);

            if (data.version !== 1) return false;
            if (data.projectPath !== resolvedPath) return false;

            this.projectPath = resolvedPath;
            this.indexPath = idxPath;
            this.documents.clear();
            this.idf.clear();

            for (const [filePath, doc] of Object.entries(data.documents)) {
                this.documents.set(filePath, {
                    tokens: doc.tokens,
                    weights: new Map(Object.entries(doc.weights).map(([k, v]) => [k, Number(v)])),
                    lineCount: doc.lineCount,
                    lastModified: doc.lastModified,
                });
            }

            for (const [token, score] of Object.entries(data.idf)) {
                this.idf.set(token, Number(score));
            }

            this.dirty = false;
            return true;
        } catch (err) {
            logger.warn('code-index', `Failed to load cached index: ${err.message}`);
            return false;
        }
    }

    /**
     * Incremental update: re-index only changed files and remove deleted ones.
     *
     * @returns {Promise<{ reindexed: number, removed: number, added: number }>}
     */
    async updateChanged() {
        if (!this.projectPath) return { reindexed: 0, removed: 0, added: 0 };

        const currentFiles = walkDir(this.projectPath);
        const currentPaths = new Set(currentFiles.map(f => f.path));
        const currentMap = new Map(currentFiles.map(f => [f.path, f]));

        let reindexed = 0;
        let removed = 0;
        let added = 0;

        // Remove files that no longer exist
        for (const filePath of this.documents.keys()) {
            if (!currentPaths.has(filePath)) {
                this.documents.delete(filePath);
                removed++;
            }
        }

        // Re-index changed files and add new ones
        for (const fileInfo of currentFiles) {
            const existing = this.documents.get(fileInfo.path);

            if (!existing) {
                // New file
                try {
                    const content = fs.readFileSync(fileInfo.path, 'utf-8');
                    this.indexFile(fileInfo.path, content);
                    added++;
                } catch {
                    // skip
                }
            } else if (fileInfo.mtime > existing.lastModified) {
                // Modified file
                try {
                    const content = fs.readFileSync(fileInfo.path, 'utf-8');
                    this.indexFile(fileInfo.path, content);
                    reindexed++;
                } catch {
                    // skip
                }
            }
        }

        if (reindexed > 0 || removed > 0 || added > 0) {
            this.computeIDF();
            this.save();

            logger.info('code-index', `Incremental update`, {
                reindexed, removed, added,
            });
        }

        return { reindexed, removed, added };
    }

    /**
     * Get index statistics.
     * @returns {{ files: number, uniqueTokens: number, projectPath: string|null }}
     */
    getStats() {
        return {
            files: this.documents.size,
            uniqueTokens: this.idf.size,
            projectPath: this.projectPath,
        };
    }
}

// ══════════════════════════════════════════════════════════════════
//  Smart Context Selection Helper
// ══════════════════════════════════════════════════════════════════

/**
 * Re-rank grep/search results using TF-IDF relevance scores.
 * Called by search_files to sort grep matches by semantic relevance
 * instead of file order.
 *
 * @param {Array<{ file: string, line: number, content: string }>} grepResults
 * @param {string} userQuery - The user's original query
 * @returns {Array<{ file: string, line: number, content: string, relevance: number }>}
 */
function rankSearchResults(grepResults, userQuery) {
    if (!_index.projectPath || _index.documents.size === 0) {
        // No index available, return with uniform relevance
        return grepResults.map((r, i) => ({ ...r, relevance: 1 - i * 0.001 }));
    }

    const queryTokens = tokenize(userQuery);
    if (queryTokens.length === 0) {
        return grepResults.map((r, i) => ({ ...r, relevance: 1 - i * 0.001 }));
    }

    const rankedResults = grepResults.map(result => {
        const absPath = path.isAbsolute(result.file)
            ? result.file
            : path.join(_index.projectPath, result.file);

        const doc = _index.documents.get(absPath);
        let relevance = 0;

        if (doc) {
            const tokenCount = doc.tokens.length || 1;
            for (const qt of queryTokens) {
                const weight = doc.weights.get(qt) || 0;
                const tf = weight / tokenCount;
                const idf = _index.idf.get(qt) || 0;
                relevance += tf * idf;
            }
        }

        // Also score the matched line itself
        const lineTokens = tokenize(result.content || '');
        let lineScore = 0;
        for (const qt of queryTokens) {
            if (lineTokens.includes(qt)) lineScore += 1;
        }
        relevance += lineScore * 0.5;

        return { ...result, relevance: Math.round(relevance * 1000) / 1000 };
    });

    return rankedResults.sort((a, b) => b.relevance - a.relevance);
}

// ══════════════════════════════════════════════════════════════════
//  Singleton Instance
// ══════════════════════════════════════════════════════════════════

let _index = new CodeIndex();

// ══════════════════════════════════════════════════════════════════
//  AI Tool Definitions
// ══════════════════════════════════════════════════════════════════

/**
 * Return tool definitions for AI agent integration.
 * @returns {Array<object>}
 */
function getCodeIndexToolDefinitions() {
    return [
        {
            type: 'function',
            function: {
                name: 'semantic_search',
                description:
                    'Search the codebase using natural language. Finds files related to a concept ' +
                    'even if they don\'t contain the exact words. Examples: "find authentication logic", ' +
                    '"database connection handling", "error boundary components". ' +
                    'Returns ranked list of relevant files with previews.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Natural language search query describing what you are looking for.',
                        },
                        projectPath: {
                            type: 'string',
                            description:
                                'Root directory of the project to search. If omitted, uses the currently indexed project.',
                        },
                        maxResults: {
                            type: 'number',
                            description: 'Maximum number of results to return (default 15).',
                        },
                    },
                    required: ['query'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'index_codebase',
                description:
                    'Build or rebuild the search index for a project directory. ' +
                    'This scans all source files and creates a TF-IDF index for fast semantic search. ' +
                    'Run this before using semantic_search on a new project, or to refresh after major changes.',
                parameters: {
                    type: 'object',
                    properties: {
                        projectPath: {
                            type: 'string',
                            description: 'Root directory of the project to index.',
                        },
                        force: {
                            type: 'boolean',
                            description: 'Force full rebuild even if a cached index exists (default false).',
                        },
                    },
                    required: ['projectPath'],
                },
            },
        },
    ];
}

/**
 * Execute a code index tool by name.
 *
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments
 * @returns {Promise<object>} - Tool result
 */
async function executeCodeIndexTool(name, args, defaultProjectPath) {
    try {
        switch (name) {
            case 'semantic_search': {
                const { query, maxResults } = args;
                const projectPath = args.projectPath || defaultProjectPath;

                // If a different project is requested, index it first
                if (projectPath && path.resolve(projectPath) !== _index.projectPath) {
                    await _index.indexProject(projectPath);
                } else if (_index.documents.size === 0 && projectPath) {
                    await _index.indexProject(projectPath);
                }

                if (_index.documents.size === 0) {
                    return {
                        error: 'No index available. Call index_codebase first or provide a projectPath.',
                    };
                }

                const results = _index.search(query, maxResults || 15);
                return {
                    results,
                    stats: _index.getStats(),
                };
            }

            case 'index_codebase': {
                const { force } = args;
                const projectPath = args.projectPath || defaultProjectPath;
                if (!projectPath) {
                    return { error: 'projectPath is required.' };
                }
                const result = await _index.indexProject(projectPath, { force: !!force });
                return {
                    message: `Indexed ${result.files} files (${result.tokens} unique tokens) in ${result.duration}ms`,
                    ...result,
                };
            }

            default:
                return { error: `Unknown tool: ${name}` };
        }
    } catch (err) {
        logger.error('code-index', `Tool ${name} failed: ${err.message}`);
        return { error: err.message };
    }
}

// ══════════════════════════════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════════════════════════════

/**
 * Register IPC handlers for code indexing.
 * Follows the project pattern: registerXxxIPC(ipcMain, getWindow)
 *
 * @param {Electron.IpcMain} ipcMain
 */
function registerCodeIndexIPC(ipcMain) {
    ipcMain.handle('code-index-build', async (_event, projectPath, options) => {
        try {
            const result = await _index.indexProject(projectPath, options || {});
            return { success: true, ...result };
        } catch (err) {
            logger.error('code-index', `IPC build failed: ${err.message}`);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('code-index-search', async (_event, query, maxResults) => {
        try {
            const results = _index.search(query, maxResults || 15);
            return { success: true, results, stats: _index.getStats() };
        } catch (err) {
            logger.error('code-index', `IPC search failed: ${err.message}`);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('code-index-stats', async () => {
        try {
            return { success: true, ..._index.getStats() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('code-index-update', async () => {
        try {
            const result = await _index.updateChanged();
            return { success: true, ...result };
        } catch (err) {
            logger.error('code-index', `IPC update failed: ${err.message}`);
            return { success: false, error: err.message };
        }
    });
}

// ══════════════════════════════════════════════════════════════════
//  Exports
// ══════════════════════════════════════════════════════════════════

module.exports = {
    // Class (for testing)
    CodeIndex,

    // Text processing (for testing / reuse)
    tokenize,
    stem,
    extractCodeTokens,
    editDistance,

    // Singleton accessors
    getIndex: () => _index,
    resetIndex: () => { _index = new CodeIndex(); },

    // Smart context helper
    rankSearchResults,

    // AI tool integration
    getCodeIndexToolDefinitions,
    executeCodeIndexTool,

    // IPC registration
    registerCodeIndexIPC,
};
