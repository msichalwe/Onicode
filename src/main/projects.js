/**
 * Project Manager — handles project creation, listing, and onidocs generation
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { shell } = require('electron');
const { execSync } = require('child_process');

// Simple JSON-based storage (SQLite can be added later for scale)
const PROJECTS_FILE = path.join(os.homedir(), '.onicode', 'projects.json');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadProjects() {
    try {
        ensureDir(path.dirname(PROJECTS_FILE));
        if (!fs.existsSync(PROJECTS_FILE)) return [];
        return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
    } catch {
        return [];
    }
}

function saveProjects(projects) {
    ensureDir(path.dirname(PROJECTS_FILE));
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

// ── onidocs templates ──

const TEMPLATES = {
    'architecture.md': (name, techStack) => `# ${name} — Architecture

## Overview
This document describes the architecture of **${name}**.

## Tech Stack
${techStack || '- To be defined'}

## Directory Structure
\`\`\`
${name}/
├── src/
├── onidocs/
│   ├── architecture.md
│   ├── changelog.md
│   └── project.md
└── README.md
\`\`\`

## Key Decisions
- *Document architectural decisions here*

## Data Flow
- *Describe how data flows through the system*
`,

    'project.md': (name, description, scope) => `# ${name}

## Description
${description || 'A new project created with Onicode.'}

## Scope
${scope || '- Define the project scope here'}

## Goals
- [ ] Define project objectives
- [ ] Set up development environment
- [ ] Build core features
- [ ] Deploy

## Non-Goals
- *List what is explicitly out of scope*

## Success Metrics
- *Define how success is measured*
`,

    'changelog.md': (name) => `# ${name} — Changelog

All notable changes to this project will be documented here.

## [Unreleased]

### Added
- Initial project setup with Onicode
- Created onidocs documentation structure

### Changed
- *None yet*

### Fixed
- *None yet*
`,

    'README.md': (name, description) => `# ${name}

${description || 'A project created with Onicode AI.'}

## Getting Started

\`\`\`bash
cd ${name}
# Add setup instructions here
\`\`\`

## Documentation

See the \`onidocs/\` folder for detailed project documentation:
- **architecture.md** — System architecture and tech stack
- **project.md** — Project scope and goals
- **changelog.md** — Version history

Tasks and milestones are managed in the Onicode app (persisted to SQLite).

---
*Created with [Onicode](https://onicode.dev)*
`,
};

function registerProjectIPC(ipcMain, getWindow) {
    // Initialize a new project
    ipcMain.handle('project-init', async (_event, opts) => {
        const { name, projectPath, description, techStack, scope } = opts;

        if (!name || !projectPath) return { error: 'Project name and path are required' };

        try {
            // Expand ~ to home directory (renderer can't access os.homedir)
            const expandedPath = projectPath.replace(/^~/, os.homedir());
            const fullPath = path.resolve(expandedPath, name.replace(/\s+/g, '-').toLowerCase());

            // Create project directory
            ensureDir(fullPath);

            // Create onidocs
            const onidocsPath = path.join(fullPath, 'onidocs');
            ensureDir(onidocsPath);

            // Write template files (tasks/milestones managed in SQLite, not markdown)
            fs.writeFileSync(path.join(onidocsPath, 'architecture.md'), TEMPLATES['architecture.md'](name, techStack));
            fs.writeFileSync(path.join(onidocsPath, 'project.md'), TEMPLATES['project.md'](name, description, scope));
            fs.writeFileSync(path.join(onidocsPath, 'changelog.md'), TEMPLATES['changelog.md'](name));
            fs.writeFileSync(path.join(fullPath, 'README.md'), TEMPLATES['README.md'](name, description));

            // Create src directory
            ensureDir(path.join(fullPath, 'src'));

            // Store project entry
            const projects = loadProjects();
            const project = {
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                name,
                path: fullPath,
                description: description || '',
                techStack: techStack || '',
                scope: scope || '',
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            projects.unshift(project);
            saveProjects(projects);

            return { success: true, project };
        } catch (err) {
            return { error: err.message };
        }
    });

    // List all projects
    ipcMain.handle('project-list', async () => {
        return { projects: loadProjects() };
    });

    // Get single project with its docs
    ipcMain.handle('project-get', async (_event, projectId) => {
        const projects = loadProjects();
        const project = projects.find((p) => p.id === projectId);
        if (!project) return { error: 'Project not found' };

        // Read onidocs if they exist (check both onidocs/ and .onidocs/)
        let onidocsPath = path.join(project.path, 'onidocs');
        if (!fs.existsSync(onidocsPath)) {
            onidocsPath = path.join(project.path, '.onidocs');
        }
        let docs = [];
        if (fs.existsSync(onidocsPath)) {
            try {
                const files = fs.readdirSync(onidocsPath).filter((f) => f.endsWith('.md'));
                docs = files.map((f) => ({
                    name: f,
                    path: path.join(onidocsPath, f),
                    content: fs.readFileSync(path.join(onidocsPath, f), 'utf-8'),
                }));
            } catch { }
        }

        return { project, docs };
    });

    // Scan and import an existing project folder
    ipcMain.handle('project-scan', async (_event, folderPath) => {
        try {
            const expandedPath = folderPath.replace(/^~/, os.homedir());
            const fullPath = path.resolve(expandedPath);

            if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
                return { error: `Directory not found: ${fullPath}` };
            }

            const projectName = path.basename(fullPath);
            const scanResult = { name: projectName, path: fullPath };

            // Detect git
            const gitDir = path.join(fullPath, '.git');
            scanResult.hasGit = fs.existsSync(gitDir);
            if (scanResult.hasGit) {
                try {
                    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: fullPath, timeout: 3000 }).toString().trim();
                    scanResult.gitBranch = branch;
                } catch { scanResult.gitBranch = 'unknown'; }
            }

            // Detect existing onidocs
            const onidocsPath = path.join(fullPath, 'onidocs');
            const dotOnidocsPath = path.join(fullPath, '.onidocs');
            scanResult.hasOnidocs = fs.existsSync(onidocsPath) || fs.existsSync(dotOnidocsPath);

            // Create .onidocs if missing
            if (!scanResult.hasOnidocs) {
                const docsPath = path.join(fullPath, '.onidocs');
                ensureDir(docsPath);
                fs.writeFileSync(path.join(docsPath, 'project.md'), `# ${projectName}\n\n## Overview\nImported existing project.\n\n## Tech Stack\n*(auto-detected — update this)*\n\n## Architecture\n*(describe here)*\n`);
                fs.writeFileSync(path.join(docsPath, 'tasks.md'), `# ${projectName} — Tasks\n\n## TODO\n- [ ] Review codebase\n- [ ] Update documentation\n\n## IN PROGRESS\n\n## DONE\n- [x] Project imported into Onicode\n`);
                fs.writeFileSync(path.join(docsPath, 'changelog.md'), `# ${projectName} — Changelog\n\n## [Imported] — ${new Date().toISOString().split('T')[0]}\n- Imported existing project into Onicode\n`);
                scanResult.createdOnidocs = true;
            }

            // Quick directory scan for tech detection
            const files = fs.readdirSync(fullPath);
            const techSignals = [];
            if (files.includes('package.json')) techSignals.push('Node.js');
            if (files.includes('tsconfig.json')) techSignals.push('TypeScript');
            if (files.includes('next.config.js') || files.includes('next.config.mjs') || files.includes('next.config.ts')) techSignals.push('Next.js');
            if (files.includes('vite.config.ts') || files.includes('vite.config.js')) techSignals.push('Vite');
            if (files.includes('Cargo.toml')) techSignals.push('Rust');
            if (files.includes('go.mod')) techSignals.push('Go');
            if (files.includes('requirements.txt') || files.includes('pyproject.toml')) techSignals.push('Python');
            if (files.includes('Gemfile')) techSignals.push('Ruby');
            if (files.includes('docker-compose.yml') || files.includes('Dockerfile')) techSignals.push('Docker');
            scanResult.detectedTech = techSignals;

            // Count files (top-level)
            const topLevel = files.filter(f => !f.startsWith('.') && f !== 'node_modules');
            scanResult.fileCount = topLevel.length;
            scanResult.topLevelFiles = topLevel.slice(0, 20);

            // Check if already registered
            const projects = loadProjects();
            const existing = projects.find(p => p.path === fullPath);
            if (existing) {
                scanResult.alreadyRegistered = true;
                scanResult.projectId = existing.id;
            } else {
                // Register as project
                const project = {
                    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    name: projectName,
                    path: fullPath,
                    description: `Imported project (${techSignals.join(', ') || 'unknown stack'})`,
                    techStack: techSignals.join(', '),
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                };
                projects.unshift(project);
                saveProjects(projects);
                scanResult.projectId = project.id;
                scanResult.registered = true;
            }

            return { success: true, scan: scanResult };
        } catch (err) {
            return { error: err.message };
        }
    });

    // Delete project entry (does not delete files)
    ipcMain.handle('project-delete', async (_event, projectId) => {
        const projects = loadProjects().filter((p) => p.id !== projectId);
        saveProjects(projects);
        return { success: true };
    });

    // Open project in external editor
    ipcMain.handle('project-open-in', async (_event, projectPath, editor) => {
        try {
            const cmds = {
                'vscode': 'code',
                'cursor': 'cursor',
                'windsurf': 'windsurf',
                'finder': null, // special case
            };

            if (editor === 'finder') {
                shell.openPath(projectPath);
                return { success: true };
            }

            const cmd = cmds[editor];
            if (!cmd) return { error: `Unknown editor: ${editor}` };

            execSync(`${cmd} "${projectPath}"`, { timeout: 5000 });
            return { success: true };
        } catch (err) {
            return { error: `Failed to open in ${editor}: ${err.message}` };
        }
    });

    // Read directory tree
    ipcMain.handle('fs-read-dir', async (_event, dirPath, maxDepth = 2) => {
        try {
            const tree = readDirRecursive(dirPath, 0, maxDepth);
            return { success: true, tree };
        } catch (err) {
            return { error: err.message };
        }
    });

    // Read file content
    ipcMain.handle('fs-read-file', async (_event, filePath) => {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return { success: true, content };
        } catch (err) {
            return { error: err.message };
        }
    });

    // Write file content
    ipcMain.handle('fs-write-file', async (_event, filePath, content) => {
        try {
            ensureDir(path.dirname(filePath));
            fs.writeFileSync(filePath, content);
            return { success: true };
        } catch (err) {
            return { error: err.message };
        }
    });
}

function readDirRecursive(dirPath, depth, maxDepth) {
    if (depth >= maxDepth) return [];
    if (!fs.existsSync(dirPath)) return [];

    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        return entries
            .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
            .sort((a, b) => {
                // Directories first
                if (a.isDirectory() && !b.isDirectory()) return -1;
                if (!a.isDirectory() && b.isDirectory()) return 1;
                return a.name.localeCompare(b.name);
            })
            .map((e) => {
                const fullPath = path.join(dirPath, e.name);
                const item = {
                    name: e.name,
                    path: fullPath,
                    type: e.isDirectory() ? 'directory' : 'file',
                };
                if (e.isDirectory()) {
                    item.children = readDirRecursive(fullPath, depth + 1, maxDepth);
                }
                return item;
            });
    } catch {
        return [];
    }
}

module.exports = { registerProjectIPC };
