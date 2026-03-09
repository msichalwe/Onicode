/**
 * Code Intelligence — Symbol analysis using TypeScript compiler API
 *
 * Provides: go-to-definition, find-references, list-symbols, hover-info
 * Works on JS/TS/JSX/TSX files without requiring a running language server.
 */

const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

// ══════════════════════════════════════════
//  Program Cache — avoid re-parsing on every query
// ══════════════════════════════════════════

let _programCache = null; // { program, projectPath, timestamp }
const CACHE_TTL = 30000;  // 30 seconds

// Symbol table cache (per-project, invalidated on demand or TTL)
let _symbolTableCache = null; // { table, projectPath, timestamp }
const SYMBOL_TABLE_TTL = 60000; // 60 seconds

function getProgram(projectPath) {
    const now = Date.now();
    if (
        _programCache &&
        _programCache.projectPath === projectPath &&
        (now - _programCache.timestamp) < CACHE_TTL
    ) {
        return _programCache.program;
    }

    logger.debug('lsp', `Creating TypeScript program for: ${projectPath}`);

    // Find tsconfig.json
    const tsconfigPath = ts.findConfigFile(projectPath, ts.sys.fileExists, 'tsconfig.json');
    let program;

    if (tsconfigPath) {
        logger.debug('lsp', `Using tsconfig: ${tsconfigPath}`);
        const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
        const parsed = ts.parseJsonConfigFileContent(
            configFile.config,
            ts.sys,
            path.dirname(tsconfigPath)
        );
        // Also include JS files not covered by tsconfig (e.g., CommonJS main process files)
        const jsFiles = findSourceFiles(projectPath, 500).filter(f => !parsed.fileNames.includes(f));
        const allFiles = [...parsed.fileNames, ...jsFiles];
        program = ts.createProgram(allFiles, { ...parsed.options, allowJs: true, checkJs: false });
    } else {
        // Fallback: glob for JS/TS files (max 500)
        logger.debug('lsp', 'No tsconfig found, scanning for source files');
        const files = findSourceFiles(projectPath, 500);
        program = ts.createProgram(files, {
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.React,
            allowJs: true,
            checkJs: false,
            noEmit: true,
        });
    }

    _programCache = { program, projectPath, timestamp: now };
    return program;
}

function findSourceFiles(dir, maxFiles, files = [], depth = 0) {
    if (depth > 6 || files.length >= maxFiles) return files;
    const SKIP = new Set([
        'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
        '__pycache__', '.venv', 'vendor', '.turbo', '.cache', 'out',
    ]);
    const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);

    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (files.length >= maxFiles) break;
            if (entry.isDirectory() && !SKIP.has(entry.name) && !entry.name.startsWith('.')) {
                findSourceFiles(path.join(dir, entry.name), maxFiles, files, depth + 1);
            } else if (entry.isFile() && EXTS.has(path.extname(entry.name))) {
                files.push(path.join(dir, entry.name));
            }
        }
    } catch (err) {
        logger.warn('lsp', `Error scanning directory: ${dir}`, err?.message);
    }
    return files;
}

/**
 * Invalidate all caches (program + symbol table).
 */
function invalidateCache(projectPath) {
    if (!projectPath || (_programCache && _programCache.projectPath === projectPath)) {
        _programCache = null;
    }
    if (!projectPath || (_symbolTableCache && _symbolTableCache.projectPath === projectPath)) {
        _symbolTableCache = null;
    }
    logger.debug('lsp', `Cache invalidated${projectPath ? ` for ${projectPath}` : ' (all)'}`);
}

// ══════════════════════════════════════════
//  Helper: Convert SyntaxKind to human-readable kind string
// ══════════════════════════════════════════

function nodeKindString(node) {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return 'function';
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return 'class';
    if (ts.isInterfaceDeclaration(node)) return 'interface';
    if (ts.isTypeAliasDeclaration(node)) return 'type';
    if (ts.isEnumDeclaration(node)) return 'enum';
    if (ts.isVariableDeclaration(node)) return 'variable';
    if (ts.isMethodDeclaration(node)) return 'method';
    if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) return 'property';
    if (ts.isModuleDeclaration(node)) return 'namespace';
    if (ts.isExportAssignment(node)) return 'export';
    return 'unknown';
}

/**
 * Check if a node is exported.
 */
function isExported(node) {
    if (!node.modifiers) return false;
    return node.modifiers.some(m =>
        m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword
    );
}

/**
 * Get a one-line signature preview from a node.
 */
function getSignature(node, sourceFile) {
    const start = node.getStart(sourceFile);
    const text = sourceFile.text.substring(start);
    // Take up to the first opening brace or end of line, max 200 chars
    const match = text.match(/^[^\n{;]{0,200}/);
    return match ? match[0].trim() : '';
}

/**
 * Convert a 0-indexed position to { line, column } (1-indexed).
 */
function posToLineCol(sourceFile, pos) {
    const lc = sourceFile.getLineAndCharacterOfPosition(pos);
    return { line: lc.line + 1, column: lc.character + 1 };
}

/**
 * Convert (1-indexed) line + column to a 0-indexed position.
 */
function lineColToPos(sourceFile, line, column) {
    return sourceFile.getPositionOfLineAndCharacter(line - 1, column - 1);
}

/**
 * Get the text of a specific line (1-indexed) from source file.
 */
function getLineText(sourceFile, line1) {
    const lineStarts = sourceFile.getLineStarts();
    const idx = line1 - 1;
    if (idx < 0 || idx >= lineStarts.length) return '';
    const start = lineStarts[idx];
    const end = idx + 1 < lineStarts.length ? lineStarts[idx + 1] : sourceFile.text.length;
    return sourceFile.text.substring(start, end).replace(/\n$/, '');
}

// ══════════════════════════════════════════
//  1. getSymbols — List all symbols in a file
// ══════════════════════════════════════════

/**
 * List all top-level and notable symbols in a file.
 * @param {string} projectPath - Root directory of the project
 * @param {string} filePath - Absolute path to the file
 * @returns {{ symbols: Array<{ name: string, kind: string, line: number, exported: boolean, signature: string }> }}
 */
function getSymbols(projectPath, filePath) {
    try {
        const program = getProgram(projectPath);
        const sourceFile = program.getSourceFile(filePath);
        if (!sourceFile) {
            // Try reading the file directly and creating a temporary source file
            if (!fs.existsSync(filePath)) {
                return { error: `File not found: ${filePath}`, symbols: [] };
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            const tmpSrc = ts.createSourceFile(filePath, content, ts.ScriptTarget.ESNext, true);
            return { symbols: extractSymbols(tmpSrc) };
        }
        return { symbols: extractSymbols(sourceFile) };
    } catch (err) {
        logger.error('lsp', `getSymbols failed: ${filePath}`, err?.message);
        return { error: err?.message || 'Unknown error', symbols: [] };
    }
}

function extractSymbols(sourceFile) {
    const symbols = [];

    function visit(node, depth = 0) {
        // Only go 2 levels deep (file-level + class/namespace members)
        if (depth > 2) return;

        let name = null;
        let kind = nodeKindString(node);

        // Extract name for declarations
        if (ts.isFunctionDeclaration(node) && node.name) {
            name = node.name.text;
        } else if (ts.isClassDeclaration(node) && node.name) {
            name = node.name.text;
        } else if (ts.isInterfaceDeclaration(node) && node.name) {
            name = node.name.text;
        } else if (ts.isTypeAliasDeclaration(node) && node.name) {
            name = node.name.text;
        } else if (ts.isEnumDeclaration(node) && node.name) {
            name = node.name.text;
        } else if (ts.isModuleDeclaration(node) && node.name) {
            name = node.name.text;
        } else if (ts.isVariableStatement(node)) {
            // Extract each variable declaration
            const exported = isExported(node);
            for (const decl of node.declarationList.declarations) {
                if (ts.isIdentifier(decl.name)) {
                    const lc = posToLineCol(sourceFile, decl.getStart(sourceFile));
                    // Determine if it's really a function (arrow / function expression)
                    let varKind = 'variable';
                    if (decl.initializer) {
                        if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
                            varKind = 'function';
                        } else if (ts.isClassExpression(decl.initializer)) {
                            varKind = 'class';
                        }
                    }
                    symbols.push({
                        name: decl.name.text,
                        kind: varKind,
                        line: lc.line,
                        exported,
                        signature: getSignature(decl, sourceFile),
                    });
                }
            }
            return; // Already handled children
        } else if (ts.isMethodDeclaration(node) && node.name) {
            name = ts.isIdentifier(node.name) ? node.name.text : node.name.getText(sourceFile);
            kind = 'method';
        } else if ((ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) && node.name) {
            name = ts.isIdentifier(node.name) ? node.name.text : node.name.getText(sourceFile);
            kind = 'property';
        } else if (ts.isExportAssignment(node)) {
            name = 'default';
            kind = 'export';
        }

        if (name && kind !== 'unknown') {
            const lc = posToLineCol(sourceFile, node.getStart(sourceFile));
            symbols.push({
                name,
                kind,
                line: lc.line,
                exported: isExported(node),
                signature: getSignature(node, sourceFile),
            });
        }

        // Recurse into class/interface/namespace bodies
        if (
            ts.isClassDeclaration(node) ||
            ts.isClassExpression(node) ||
            ts.isInterfaceDeclaration(node) ||
            ts.isModuleDeclaration(node)
        ) {
            ts.forEachChild(node, child => visit(child, depth + 1));
        }
    }

    ts.forEachChild(sourceFile, child => visit(child, 0));
    return symbols;
}

// ══════════════════════════════════════════
//  2. getDefinition — Go to definition
// ══════════════════════════════════════════

/**
 * Find the definition of the symbol at the given position.
 * @param {string} projectPath
 * @param {string} filePath
 * @param {number} line - 1-indexed
 * @param {number} column - 1-indexed
 * @returns {{ file: string, line: number, column: number, name: string, kind: string, preview: string } | { error: string }}
 */
function getDefinition(projectPath, filePath, line, column) {
    try {
        const program = getProgram(projectPath);
        const sourceFile = program.getSourceFile(filePath);
        if (!sourceFile) {
            return { error: `File not found in program: ${filePath}` };
        }

        const checker = program.getTypeChecker();
        const pos = lineColToPos(sourceFile, line, column);

        // Find the token at position
        const token = findTokenAtPosition(sourceFile, pos);
        if (!token) {
            return { error: `No token found at ${line}:${column}` };
        }

        // Get symbol for this token
        const symbol = checker.getSymbolAtLocation(token);
        if (!symbol) {
            return { error: `No symbol found at ${line}:${column}` };
        }

        // Resolve aliased symbols (imports)
        const resolvedSymbol = symbol.flags & ts.SymbolFlags.Alias
            ? checker.getAliasedSymbol(symbol)
            : symbol;

        // Get declarations
        const declarations = resolvedSymbol.getDeclarations();
        if (!declarations || declarations.length === 0) {
            return { error: `No declaration found for symbol '${symbol.getName()}'` };
        }

        // Use the first declaration
        const decl = declarations[0];
        const declSourceFile = decl.getSourceFile();
        const declPos = posToLineCol(declSourceFile, decl.getStart(declSourceFile));

        return {
            file: declSourceFile.fileName,
            line: declPos.line,
            column: declPos.column,
            name: resolvedSymbol.getName(),
            kind: nodeKindString(decl),
            preview: getLineText(declSourceFile, declPos.line),
        };
    } catch (err) {
        logger.error('lsp', `getDefinition failed: ${filePath}:${line}:${column}`, err?.message);
        return { error: err?.message || 'Unknown error' };
    }
}

/**
 * Find the innermost token at a given position in the AST.
 */
function findTokenAtPosition(sourceFile, pos) {
    let result = null;

    function visit(node) {
        if (pos < node.getStart(sourceFile) || pos >= node.getEnd()) return;
        // Prefer identifier-like tokens
        if (ts.isIdentifier(node) || ts.isStringLiteral(node)) {
            result = node;
            return;
        }
        ts.forEachChild(node, visit);
        // If no identifier found, use this node
        if (!result && node.getStart(sourceFile) <= pos && pos < node.getEnd()) {
            result = node;
        }
    }

    visit(sourceFile);
    return result;
}

// ══════════════════════════════════════════
//  3. findReferences — Find all references to a symbol
// ══════════════════════════════════════════

/**
 * Find all references to a symbol by name.
 * Uses the type checker where possible, falls back to validated text search.
 * @param {string} projectPath
 * @param {string} filePath - Optional: file where the symbol is defined (for disambiguation)
 * @param {string} symbolName - Name of the symbol to search for
 * @returns {{ references: Array<{ file: string, line: number, column: number, preview: string }> }}
 */
function findReferences(projectPath, filePath, symbolName) {
    try {
        const program = getProgram(projectPath);
        const checker = program.getTypeChecker();
        const references = [];
        const MAX_REFS = 200;

        // First, try to find the canonical symbol if filePath is provided
        let canonicalSymbol = null;
        if (filePath) {
            const sourceFile = program.getSourceFile(filePath);
            if (sourceFile) {
                canonicalSymbol = findSymbolByName(sourceFile, symbolName, checker);
            }
        }

        // Search through all source files
        const sourceFiles = program.getSourceFiles().filter(sf => !sf.isDeclarationFile);

        for (const sf of sourceFiles) {
            if (references.length >= MAX_REFS) break;

            // Walk AST looking for identifiers matching the symbol name
            findIdentifierReferences(sf, symbolName, checker, canonicalSymbol, references, MAX_REFS);
        }

        logger.debug('lsp', `findReferences: '${symbolName}' → ${references.length} refs`);
        return { references };
    } catch (err) {
        logger.error('lsp', `findReferences failed: ${symbolName}`, err?.message);
        return { error: err?.message || 'Unknown error', references: [] };
    }
}

/**
 * Find the symbol object for a name in a source file.
 */
function findSymbolByName(sourceFile, name, checker) {
    let found = null;
    function visit(node) {
        if (found) return;
        if (ts.isIdentifier(node) && node.text === name) {
            const sym = checker.getSymbolAtLocation(node);
            if (sym) {
                found = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
                return;
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return found;
}

/**
 * Find all identifier nodes in a source file that match the given name.
 * Optionally validates against a canonical symbol using the type checker.
 */
function findIdentifierReferences(sourceFile, name, checker, canonicalSymbol, refs, maxRefs) {
    function visit(node) {
        if (refs.length >= maxRefs) return;

        if (ts.isIdentifier(node) && node.text === name) {
            // If we have a canonical symbol, verify this identifier refers to the same symbol
            if (canonicalSymbol) {
                try {
                    let nodeSym = checker.getSymbolAtLocation(node);
                    if (nodeSym) {
                        if (nodeSym.flags & ts.SymbolFlags.Alias) {
                            nodeSym = checker.getAliasedSymbol(nodeSym);
                        }
                        if (nodeSym !== canonicalSymbol) return;
                    }
                    // If checker returns no symbol, include as possible reference anyway
                } catch {
                    // Type checker can fail for some nodes; include as fallback
                }
            }

            const lc = posToLineCol(sourceFile, node.getStart(sourceFile));
            refs.push({
                file: sourceFile.fileName,
                line: lc.line,
                column: lc.column,
                preview: getLineText(sourceFile, lc.line),
            });
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
}

// ══════════════════════════════════════════
//  4. getHoverInfo — Type info on hover
// ══════════════════════════════════════════

/**
 * Get type information and documentation for the symbol at position.
 * @param {string} projectPath
 * @param {string} filePath
 * @param {number} line - 1-indexed
 * @param {number} column - 1-indexed
 * @returns {{ type: string, documentation: string, signature: string } | { error: string }}
 */
function getHoverInfo(projectPath, filePath, line, column) {
    try {
        const program = getProgram(projectPath);
        const sourceFile = program.getSourceFile(filePath);
        if (!sourceFile) {
            return { error: `File not found in program: ${filePath}` };
        }

        const checker = program.getTypeChecker();
        const pos = lineColToPos(sourceFile, line, column);
        const token = findTokenAtPosition(sourceFile, pos);
        if (!token) {
            return { error: `No token found at ${line}:${column}` };
        }

        const symbol = checker.getSymbolAtLocation(token);
        if (!symbol) {
            // Even without a symbol, try to get the type of the expression
            try {
                const type = checker.getTypeAtLocation(token);
                return {
                    type: checker.typeToString(type),
                    documentation: '',
                    signature: '',
                };
            } catch {
                return { error: `No symbol or type found at ${line}:${column}` };
            }
        }

        // Get type
        const type = checker.getTypeOfSymbolAtLocation(symbol, token);
        const typeString = checker.typeToString(type);

        // Get documentation
        const docs = symbol.getDocumentationComment(checker);
        const documentation = ts.displayPartsToString(docs);

        // Get signature (for functions/methods)
        let signature = '';
        const signatures = type.getCallSignatures();
        if (signatures.length > 0) {
            signature = checker.signatureToString(signatures[0]);
        }

        return {
            type: typeString,
            documentation,
            signature,
        };
    } catch (err) {
        logger.error('lsp', `getHoverInfo failed: ${filePath}:${line}:${column}`, err?.message);
        return { error: err?.message || 'Unknown error' };
    }
}

// ══════════════════════════════════════════
//  5. getProjectSymbolTable — Full exported symbol index
// ══════════════════════════════════════════

/**
 * Build a symbol table for the entire project (exported symbols only by default).
 * @param {string} projectPath
 * @param {{ includePrivate?: boolean }} options
 * @returns {{ table: Record<string, Array<{ name: string, kind: string, line: number, exported: boolean }>>, fileCount: number }}
 */
function getProjectSymbolTable(projectPath, options = {}) {
    try {
        const now = Date.now();
        if (
            _symbolTableCache &&
            _symbolTableCache.projectPath === projectPath &&
            (now - _symbolTableCache.timestamp) < SYMBOL_TABLE_TTL
        ) {
            logger.debug('lsp', 'Returning cached symbol table');
            return _symbolTableCache.result;
        }

        const program = getProgram(projectPath);
        const sourceFiles = program.getSourceFiles().filter(sf => !sf.isDeclarationFile);
        const table = {};
        let fileCount = 0;
        const MAX_FILES = 1000;

        for (const sf of sourceFiles) {
            if (fileCount >= MAX_FILES) break;
            // Skip node_modules and other non-project files
            if (sf.fileName.includes('node_modules')) continue;

            const symbols = extractSymbols(sf);
            const filtered = options.includePrivate
                ? symbols
                : symbols.filter(s => s.exported);

            if (filtered.length > 0) {
                // Use relative path for cleaner output
                const relPath = path.relative(projectPath, sf.fileName);
                table[relPath] = filtered.map(s => ({
                    name: s.name,
                    kind: s.kind,
                    line: s.line,
                    exported: s.exported,
                }));
                fileCount++;
            }
        }

        const result = { table, fileCount };
        _symbolTableCache = { result, projectPath, timestamp: now };

        logger.debug('lsp', `Built symbol table: ${fileCount} files, ${Object.values(table).reduce((s, a) => s + a.length, 0)} symbols`);
        return result;
    } catch (err) {
        logger.error('lsp', `getProjectSymbolTable failed: ${projectPath}`, err?.message);
        return { error: err?.message || 'Unknown error', table: {}, fileCount: 0 };
    }
}

// ══════════════════════════════════════════
//  6. IPC Registration
// ══════════════════════════════════════════

/**
 * Register LSP IPC handlers for renderer communication.
 * @param {Electron.IpcMain} ipc
 */
function registerLSPIPC(ipc) {
    ipc.handle('lsp-symbols', (_event, { projectPath, filePath }) => {
        return getSymbols(projectPath, filePath);
    });

    ipc.handle('lsp-definition', (_event, { projectPath, filePath, line, column }) => {
        return getDefinition(projectPath, filePath, line, column);
    });

    ipc.handle('lsp-references', (_event, { projectPath, filePath, symbolName }) => {
        return findReferences(projectPath, filePath, symbolName);
    });

    ipc.handle('lsp-hover', (_event, { projectPath, filePath, line, column }) => {
        return getHoverInfo(projectPath, filePath, line, column);
    });

    ipc.handle('lsp-project-symbols', (_event, { projectPath, options }) => {
        return getProjectSymbolTable(projectPath, options || {});
    });

    ipc.handle('lsp-invalidate', (_event, { projectPath }) => {
        invalidateCache(projectPath);
        return { success: true };
    });

    logger.info('lsp', 'LSP IPC handlers registered');
}

// ══════════════════════════════════════════
//  7. AI Tool Definitions & Executor
// ══════════════════════════════════════════

/**
 * Returns OpenAI function-calling tool definitions for LSP capabilities.
 */
function getLSPToolDefinitions() {
    return [
        {
            type: 'function',
            function: {
                name: 'find_symbol',
                description: 'Find where a symbol (function, class, variable, type) is defined in the project. Returns the file, line, and a code preview.',
                parameters: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'The symbol name to search for (e.g. "useState", "MyComponent", "handleSubmit")',
                        },
                        projectPath: {
                            type: 'string',
                            description: 'Absolute path to the project root. Uses the active project if not provided.',
                        },
                    },
                    required: ['name'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'find_references',
                description: 'Find all usages/references of a symbol across the project. Returns file paths, line numbers, and code previews for each reference.',
                parameters: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'The symbol name to find references for',
                        },
                        filePath: {
                            type: 'string',
                            description: 'Optional: file where the symbol is defined (helps disambiguate same-named symbols)',
                        },
                        projectPath: {
                            type: 'string',
                            description: 'Absolute path to the project root. Uses the active project if not provided.',
                        },
                    },
                    required: ['name'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'list_symbols',
                description: 'List all symbols (functions, classes, interfaces, variables, types) defined in a file. Useful for understanding file structure.',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: {
                            type: 'string',
                            description: 'Absolute path to the file to analyze',
                        },
                        projectPath: {
                            type: 'string',
                            description: 'Absolute path to the project root. Uses the active project if not provided.',
                        },
                    },
                    required: ['filePath'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'get_type_info',
                description: 'Get type information, documentation, and signature for a symbol at a specific position in a file. Useful for understanding what a variable or function is.',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: {
                            type: 'string',
                            description: 'Absolute path to the file',
                        },
                        line: {
                            type: 'integer',
                            description: '1-indexed line number',
                        },
                        column: {
                            type: 'integer',
                            description: '1-indexed column number',
                        },
                        projectPath: {
                            type: 'string',
                            description: 'Absolute path to the project root. Uses the active project if not provided.',
                        },
                    },
                    required: ['filePath', 'line', 'column'],
                },
            },
        },
    ];
}

/**
 * Execute an LSP tool by name with the given arguments.
 * @param {string} toolName - One of: find_symbol, find_references, list_symbols, get_type_info
 * @param {object} args - Tool arguments
 * @param {string} [defaultProjectPath] - Fallback project path if not in args
 * @returns {object} Tool result
 */
function executeLSPTool(toolName, args, defaultProjectPath) {
    const projectPath = args.projectPath || defaultProjectPath;

    if (!projectPath) {
        return { error: 'No project path provided. Set a project path or activate a project first.' };
    }

    try {
        switch (toolName) {
            case 'find_symbol': {
                if (!args.name) return { error: 'Missing required argument: name' };

                // Search the project symbol table for the symbol
                const { table } = getProjectSymbolTable(projectPath, { includePrivate: true });
                const results = [];

                for (const [file, symbols] of Object.entries(table)) {
                    for (const sym of symbols) {
                        if (sym.name === args.name) {
                            results.push({
                                file: path.join(projectPath, file),
                                relativeFile: file,
                                line: sym.line,
                                kind: sym.kind,
                                exported: sym.exported,
                                preview: '', // Will be filled below
                            });
                        }
                    }
                }

                // Add preview lines
                for (const r of results) {
                    try {
                        const content = fs.readFileSync(r.file, 'utf-8');
                        const lines = content.split('\n');
                        r.preview = (lines[r.line - 1] || '').trim();
                    } catch {
                        r.preview = '';
                    }
                }

                if (results.length === 0) {
                    return { message: `Symbol '${args.name}' not found in project`, results: [] };
                }

                return { results };
            }

            case 'find_references': {
                if (!args.name) return { error: 'Missing required argument: name' };
                return findReferences(projectPath, args.filePath || null, args.name);
            }

            case 'list_symbols': {
                if (!args.filePath) return { error: 'Missing required argument: filePath' };
                return getSymbols(projectPath, args.filePath);
            }

            case 'get_type_info': {
                if (!args.filePath || !args.line || !args.column) {
                    return { error: 'Missing required arguments: filePath, line, column' };
                }
                return getHoverInfo(projectPath, args.filePath, args.line, args.column);
            }

            default:
                return { error: `Unknown LSP tool: ${toolName}` };
        }
    } catch (err) {
        logger.error('lsp', `executeLSPTool failed: ${toolName}`, err?.message);
        return { error: err?.message || 'Unknown error' };
    }
}

// ══════════════════════════════════════════
//  Module Exports
// ══════════════════════════════════════════

module.exports = {
    // Core functions
    getSymbols,
    getDefinition,
    findReferences,
    getHoverInfo,
    getProjectSymbolTable,
    invalidateCache,

    // IPC
    registerLSPIPC,

    // AI tools
    getLSPToolDefinitions,
    executeLSPTool,
};
