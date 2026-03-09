/**
 * AI Tool System — Cascade-like tool definitions and executor
 * 
 * Provides OpenAI function-calling compatible tool definitions
 * and a tool executor that runs them in the main process.
 */

const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');

// ══════════════════════════════════════════
//  File Context Tracker
// ══════════════════════════════════════════

class FileContextTracker {
    constructor() {
        this.readFiles = new Map();    // path -> { lines, lastRead, hash }
        this.modifiedFiles = new Map(); // path -> { edits: [], original }
        this.createdFiles = new Set();
        this.deletedFiles = new Set();
    }

    trackRead(filePath, content) {
        const lines = content.split('\n').length;
        this.readFiles.set(filePath, {
            lines,
            lastRead: Date.now(),
            size: content.length,
        });
    }

    trackEdit(filePath, oldStr, newStr) {
        if (!this.modifiedFiles.has(filePath)) {
            this.modifiedFiles.set(filePath, { edits: [] });
        }
        this.modifiedFiles.get(filePath).edits.push({
            oldStr: oldStr.slice(0, 100),
            newStr: newStr.slice(0, 100),
            timestamp: Date.now(),
        });
    }

    trackCreate(filePath) {
        this.createdFiles.add(filePath);
    }

    trackDelete(filePath) {
        this.deletedFiles.add(filePath);
    }

    getSummary() {
        return {
            filesRead: this.readFiles.size,
            filesModified: this.modifiedFiles.size,
            filesCreated: this.createdFiles.size,
            filesDeleted: this.deletedFiles.size,
            readPaths: [...this.readFiles.keys()],
            modifiedPaths: [...this.modifiedFiles.keys()],
            createdPaths: [...this.createdFiles],
            deletedPaths: [...this.deletedFiles],
        };
    }

    reset() {
        this.readFiles.clear();
        this.modifiedFiles.clear();
        this.createdFiles.clear();
        this.deletedFiles.clear();
    }
}

const fileContext = new FileContextTracker();

// ══════════════════════════════════════════
//  Restore Points
// ══════════════════════════════════════════

const RESTORE_DIR = path.join(
    process.env.HOME || process.env.USERPROFILE || '/tmp',
    '.onicode', 'restore-points'
);

class RestorePointManager {
    constructor() {
        if (!fs.existsSync(RESTORE_DIR)) {
            fs.mkdirSync(RESTORE_DIR, { recursive: true });
        }
    }

    create(name, filePaths) {
        const id = `rp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const rpDir = path.join(RESTORE_DIR, id);
        fs.mkdirSync(rpDir, { recursive: true });

        const manifest = {
            id,
            name,
            createdAt: Date.now(),
            files: [],
        };

        for (const fp of filePaths) {
            try {
                if (fs.existsSync(fp)) {
                    const content = fs.readFileSync(fp, 'utf-8');
                    const relName = fp.replace(/[/\\:]/g, '__');
                    fs.writeFileSync(path.join(rpDir, relName), content);
                    manifest.files.push({ original: fp, backup: relName, exists: true });
                } else {
                    manifest.files.push({ original: fp, backup: null, exists: false });
                }
            } catch (err) {
                manifest.files.push({ original: fp, backup: null, error: err.message });
            }
        }

        fs.writeFileSync(path.join(rpDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        return manifest;
    }

    list() {
        try {
            const dirs = fs.readdirSync(RESTORE_DIR).filter(d =>
                fs.statSync(path.join(RESTORE_DIR, d)).isDirectory()
            );
            return dirs.map(d => {
                try {
                    const m = JSON.parse(fs.readFileSync(path.join(RESTORE_DIR, d, 'manifest.json'), 'utf-8'));
                    return { id: m.id, name: m.name, createdAt: m.createdAt, fileCount: m.files.length };
                } catch {
                    return { id: d, name: 'Unknown', createdAt: 0, fileCount: 0 };
                }
            }).sort((a, b) => b.createdAt - a.createdAt);
        } catch {
            return [];
        }
    }

    restore(id) {
        const rpDir = path.join(RESTORE_DIR, id);
        if (!fs.existsSync(rpDir)) return { error: 'Restore point not found' };

        const manifest = JSON.parse(fs.readFileSync(path.join(rpDir, 'manifest.json'), 'utf-8'));
        const results = [];

        for (const file of manifest.files) {
            try {
                if (file.backup && file.exists) {
                    const content = fs.readFileSync(path.join(rpDir, file.backup), 'utf-8');
                    const dir = path.dirname(file.original);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(file.original, content);
                    results.push({ path: file.original, restored: true });
                } else if (!file.exists) {
                    // File didn't exist before, delete it if it exists now
                    if (fs.existsSync(file.original)) {
                        fs.unlinkSync(file.original);
                        results.push({ path: file.original, deleted: true });
                    }
                }
            } catch (err) {
                results.push({ path: file.original, error: err.message });
            }
        }

        return { success: true, restored: results, name: manifest.name };
    }

    delete(id) {
        const rpDir = path.join(RESTORE_DIR, id);
        if (fs.existsSync(rpDir)) {
            fs.rmSync(rpDir, { recursive: true, force: true });
            return { success: true };
        }
        return { error: 'Not found' };
    }
}

const restorePoints = new RestorePointManager();

// ══════════════════════════════════════════
//  Sub-Agent System
// ══════════════════════════════════════════

const activeAgents = new Map();

function createSubAgent(id, task, parentContext) {
    const agent = {
        id,
        task,
        status: 'running',
        createdAt: Date.now(),
        messages: [],
        result: null,
        parentContext,
    };
    activeAgents.set(id, agent);
    return agent;
}

function updateAgent(id, update) {
    const agent = activeAgents.get(id);
    if (agent) Object.assign(agent, update);
    return agent;
}

function getAgentStatus(id) {
    return activeAgents.get(id) || null;
}

function listAgents() {
    return [...activeAgents.values()].map(a => ({
        id: a.id,
        task: a.task,
        status: a.status,
        createdAt: a.createdAt,
    }));
}

// ══════════════════════════════════════════
//  Tool Definitions (OpenAI format)
// ══════════════════════════════════════════

const TOOL_DEFINITIONS = [
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the contents of a file. Can optionally read specific line ranges. Returns the file content with line numbers.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: { type: 'string', description: 'Absolute path to the file to read' },
                    start_line: { type: 'integer', description: 'Optional 1-indexed start line' },
                    end_line: { type: 'integer', description: 'Optional 1-indexed end line' },
                },
                required: ['file_path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'edit_file',
            description: 'Edit a file by replacing an exact string match with new content. The old_string must match exactly (including whitespace). Use this to modify existing files.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: { type: 'string', description: 'Absolute path to the file to edit' },
                    old_string: { type: 'string', description: 'The exact text to find and replace. Must be unique in the file.' },
                    new_string: { type: 'string', description: 'The replacement text' },
                    description: { type: 'string', description: 'Brief description of the change' },
                },
                required: ['file_path', 'old_string', 'new_string'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'create_file',
            description: 'Create a new file with the given content. Parent directories will be created if they do not exist.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: { type: 'string', description: 'Absolute path for the new file' },
                    content: { type: 'string', description: 'Content to write to the file' },
                },
                required: ['file_path', 'content'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'delete_file',
            description: 'Delete a file from the filesystem.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: { type: 'string', description: 'Absolute path to the file to delete' },
                },
                required: ['file_path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_directory',
            description: 'List files and directories in the given path. Returns names, types (file/dir), and sizes.',
            parameters: {
                type: 'object',
                properties: {
                    dir_path: { type: 'string', description: 'Absolute path to the directory' },
                    max_depth: { type: 'integer', description: 'Maximum recursion depth (default 1)' },
                    include_hidden: { type: 'boolean', description: 'Include hidden files/dirs (default false)' },
                },
                required: ['dir_path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'search_files',
            description: 'Search for a pattern across files in a directory using grep. Returns matching file paths and line content.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search pattern (regex supported)' },
                    search_path: { type: 'string', description: 'Directory or file path to search in' },
                    file_pattern: { type: 'string', description: 'Glob pattern to filter files, e.g., "*.ts" or "*.js"' },
                    case_sensitive: { type: 'boolean', description: 'Case-sensitive search (default false)' },
                    max_results: { type: 'integer', description: 'Maximum number of results (default 50)' },
                },
                required: ['query', 'search_path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'run_command',
            description: 'Execute a terminal command and return stdout/stderr. Use for running scripts, installing packages, building, testing, git operations, etc.',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'The command to execute' },
                    cwd: { type: 'string', description: 'Working directory for the command' },
                    timeout: { type: 'integer', description: 'Timeout in milliseconds (default 30000)' },
                },
                required: ['command'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'create_restore_point',
            description: 'Create a snapshot/restore point of the current state of specified files. Use this before making significant changes so the user can roll back.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Descriptive name for the restore point' },
                    file_paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Array of absolute file paths to snapshot',
                    },
                },
                required: ['name', 'file_paths'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'restore_to_point',
            description: 'Restore files back to a previously created restore point.',
            parameters: {
                type: 'object',
                properties: {
                    restore_point_id: { type: 'string', description: 'ID of the restore point to restore' },
                },
                required: ['restore_point_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_restore_points',
            description: 'List all available restore points.',
            parameters: {
                type: 'object',
                properties: {},
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_context_summary',
            description: 'Get a summary of the current working context: files read, files modified, files created, active project info.',
            parameters: {
                type: 'object',
                properties: {},
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'spawn_sub_agent',
            description: 'Spawn a sub-agent to handle a specific sub-task in parallel. The sub-agent gets its own conversation context.',
            parameters: {
                type: 'object',
                properties: {
                    task: { type: 'string', description: 'Description of the sub-task to perform' },
                    context_files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'File paths to include as context for the sub-agent',
                    },
                },
                required: ['task'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_agent_status',
            description: 'Check the status and results of a previously spawned sub-agent.',
            parameters: {
                type: 'object',
                properties: {
                    agent_id: { type: 'string', description: 'ID of the sub-agent to check' },
                },
                required: ['agent_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'multi_edit',
            description: 'Make multiple edits to a single file in one operation. Each edit is a find-and-replace. Edits are applied sequentially.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: { type: 'string', description: 'Absolute path to the file' },
                    edits: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                old_string: { type: 'string', description: 'Text to find' },
                                new_string: { type: 'string', description: 'Replacement text' },
                            },
                            required: ['old_string', 'new_string'],
                        },
                        description: 'Array of edit operations to apply sequentially',
                    },
                    description: { type: 'string', description: 'Brief description of the changes' },
                },
                required: ['file_path', 'edits'],
            },
        },
    },
];

// ══════════════════════════════════════════
//  Tool Executor
// ══════════════════════════════════════════

async function executeTool(name, args) {
    try {
        switch (name) {
            case 'read_file': {
                const { file_path, start_line, end_line } = args;
                if (!fs.existsSync(file_path)) {
                    return { error: `File not found: ${file_path}` };
                }
                const content = fs.readFileSync(file_path, 'utf-8');
                const lines = content.split('\n');
                const start = (start_line || 1) - 1;
                const end = end_line || lines.length;
                const slice = lines.slice(start, end);
                const numbered = slice.map((l, i) => `${start + i + 1}\t${l}`).join('\n');

                fileContext.trackRead(file_path, content);

                return {
                    file_path,
                    total_lines: lines.length,
                    showing: `${start + 1}-${Math.min(end, lines.length)}`,
                    content: numbered,
                };
            }

            case 'edit_file': {
                const { file_path, old_string, new_string, description } = args;
                if (!fs.existsSync(file_path)) {
                    return { error: `File not found: ${file_path}` };
                }
                const content = fs.readFileSync(file_path, 'utf-8');
                const occurrences = content.split(old_string).length - 1;
                if (occurrences === 0) {
                    return { error: `old_string not found in ${file_path}. Make sure it matches exactly including whitespace.` };
                }
                if (occurrences > 1) {
                    return { error: `old_string found ${occurrences} times in ${file_path}. It must be unique. Include more surrounding context.` };
                }
                const newContent = content.replace(old_string, new_string);
                fs.writeFileSync(file_path, newContent);
                fileContext.trackEdit(file_path, old_string, new_string);

                return {
                    success: true,
                    file_path,
                    description: description || 'File edited',
                    lines_removed: old_string.split('\n').length,
                    lines_added: new_string.split('\n').length,
                };
            }

            case 'create_file': {
                const { file_path, content } = args;
                const dir = path.dirname(file_path);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                if (fs.existsSync(file_path)) {
                    return { error: `File already exists: ${file_path}. Use edit_file to modify it.` };
                }
                fs.writeFileSync(file_path, content);
                fileContext.trackCreate(file_path);
                return { success: true, file_path, lines: content.split('\n').length };
            }

            case 'delete_file': {
                const { file_path } = args;
                if (!fs.existsSync(file_path)) {
                    return { error: `File not found: ${file_path}` };
                }
                fs.unlinkSync(file_path);
                fileContext.trackDelete(file_path);
                return { success: true, file_path };
            }

            case 'list_directory': {
                const { dir_path, max_depth = 1, include_hidden = false } = args;
                if (!fs.existsSync(dir_path)) {
                    return { error: `Directory not found: ${dir_path}` };
                }

                function listDir(dirPath, depth, maxD) {
                    if (depth > maxD) return [];
                    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                    const result = [];
                    for (const entry of entries) {
                        if (!include_hidden && entry.name.startsWith('.')) continue;
                        if (entry.name === 'node_modules' || entry.name === '.git') continue;
                        const fullPath = path.join(dirPath, entry.name);
                        const isDir = entry.isDirectory();
                        const item = {
                            name: entry.name,
                            type: isDir ? 'directory' : 'file',
                            path: fullPath,
                        };
                        if (!isDir) {
                            try {
                                item.size = fs.statSync(fullPath).size;
                            } catch {}
                        }
                        result.push(item);
                        if (isDir && depth < maxD) {
                            item.children = listDir(fullPath, depth + 1, maxD);
                        }
                    }
                    return result.sort((a, b) => {
                        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                        return a.name.localeCompare(b.name);
                    });
                }

                return { dir_path, entries: listDir(dir_path, 1, max_depth) };
            }

            case 'search_files': {
                const { query, search_path, file_pattern, case_sensitive = false, max_results = 50 } = args;
                if (!fs.existsSync(search_path)) {
                    return { error: `Path not found: ${search_path}` };
                }

                let cmd = `grep -r${case_sensitive ? '' : 'i'}n --include="${file_pattern || '*'}" `;
                cmd += `--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist `;
                cmd += `-m ${max_results} `;
                cmd += `${JSON.stringify(query)} ${JSON.stringify(search_path)}`;

                try {
                    const output = execSync(cmd, { encoding: 'utf-8', timeout: 10000, maxBuffer: 1024 * 1024 });
                    const matches = output.trim().split('\n').filter(Boolean).slice(0, max_results).map(line => {
                        const match = line.match(/^(.+?):(\d+):(.*)$/);
                        if (match) return { file: match[1], line: parseInt(match[2]), content: match[3].trim() };
                        return { raw: line };
                    });
                    return { query, matches, total: matches.length };
                } catch (err) {
                    if (err.status === 1) return { query, matches: [], total: 0, message: 'No matches found' };
                    return { error: err.message?.slice(0, 200) };
                }
            }

            case 'run_command': {
                const { command, cwd, timeout = 30000 } = args;
                return new Promise((resolve) => {
                    const execCwd = cwd || process.env.HOME || '/';
                    exec(command, { cwd: execCwd, timeout, maxBuffer: 1024 * 1024, encoding: 'utf-8' }, (err, stdout, stderr) => {
                        resolve({
                            command,
                            cwd: execCwd,
                            exitCode: err ? err.code || 1 : 0,
                            stdout: (stdout || '').slice(0, 8000),
                            stderr: (stderr || '').slice(0, 4000),
                            success: !err,
                        });
                    });
                });
            }

            case 'create_restore_point': {
                const { name, file_paths } = args;
                const rp = restorePoints.create(name, file_paths);
                return {
                    success: true,
                    id: rp.id,
                    name: rp.name,
                    files_backed_up: rp.files.filter(f => f.exists).length,
                    total_files: rp.files.length,
                };
            }

            case 'restore_to_point': {
                const { restore_point_id } = args;
                return restorePoints.restore(restore_point_id);
            }

            case 'list_restore_points': {
                return { restore_points: restorePoints.list() };
            }

            case 'get_context_summary': {
                return fileContext.getSummary();
            }

            case 'spawn_sub_agent': {
                const { task, context_files } = args;
                const agentId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                const agent = createSubAgent(agentId, task, { context_files });
                // The actual sub-agent execution is handled by the agentic loop
                return {
                    agent_id: agentId,
                    task,
                    status: 'created',
                    message: 'Sub-agent spawned. It will process the task asynchronously.',
                };
            }

            case 'get_agent_status': {
                const { agent_id } = args;
                const agent = getAgentStatus(agent_id);
                if (!agent) return { error: `Agent ${agent_id} not found` };
                return {
                    id: agent.id,
                    task: agent.task,
                    status: agent.status,
                    createdAt: agent.createdAt,
                    result: agent.result,
                };
            }

            case 'multi_edit': {
                const { file_path, edits, description } = args;
                if (!fs.existsSync(file_path)) {
                    return { error: `File not found: ${file_path}` };
                }
                let content = fs.readFileSync(file_path, 'utf-8');
                const results = [];

                for (let i = 0; i < edits.length; i++) {
                    const { old_string, new_string } = edits[i];
                    const occurrences = content.split(old_string).length - 1;
                    if (occurrences === 0) {
                        return { error: `Edit ${i + 1}: old_string not found. Previous edits may have changed the file content.` };
                    }
                    if (occurrences > 1) {
                        return { error: `Edit ${i + 1}: old_string found ${occurrences} times. Must be unique.` };
                    }
                    content = content.replace(old_string, new_string);
                    results.push({ index: i, success: true });
                }

                fs.writeFileSync(file_path, content);
                fileContext.trackEdit(file_path, `[multi_edit: ${edits.length} edits]`, description || '');
                return { success: true, file_path, edits_applied: results.length, description };
            }

            default:
                return { error: `Unknown tool: ${name}` };
        }
    } catch (err) {
        return { error: `Tool execution error: ${err.message}` };
    }
}

// ══════════════════════════════════════════
//  Exports
// ══════════════════════════════════════════

module.exports = {
    TOOL_DEFINITIONS,
    executeTool,
    fileContext,
    restorePoints,
    activeAgents,
    createSubAgent,
    updateAgent,
    getAgentStatus,
    listAgents,
};
