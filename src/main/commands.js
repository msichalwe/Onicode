/**
 * Custom Commands — user-defined slash commands from .md files
 *
 * Scans two directories for command definitions:
 *   - Global:  ~/.onicode/commands/*.md
 *   - Project: <projectPath>/.onicode/commands/*.md
 *
 * Each .md file becomes a slash command. The filename (minus .md) is the
 * command name. The file content is the prompt template, with $ARGUMENTS
 * replaced by whatever the user types after the command name.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Paths ──

const GLOBAL_COMMANDS_DIR = path.join(os.homedir(), '.onicode', 'commands');

function projectCommandsDir(projectPath) {
    if (!projectPath) return null;
    return path.join(projectPath, '.onicode', 'commands');
}

// ── Helpers ──

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Extract a description from markdown content.
 * Uses the first line starting with `#`, stripped of the `#` prefix.
 * Falls back to the first 80 characters of the content.
 */
function extractDescription(content) {
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#')) {
            return trimmed.replace(/^#+\s*/, '').trim();
        }
    }
    // No heading found — use first 80 chars of the first non-empty line
    const firstLine = lines.find(l => l.trim().length > 0);
    if (!firstLine) return 'Custom command';
    const text = firstLine.trim();
    return text.length > 80 ? text.slice(0, 80) + '…' : text;
}

/**
 * Read all .md files from a directory and return command objects.
 */
function scanDirectory(dir, source) {
    const commands = [];
    if (!dir || !fs.existsSync(dir)) return commands;

    let entries;
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return commands;
    }

    for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;
        const filePath = path.join(dir, entry);

        try {
            const stat = fs.statSync(filePath);
            if (!stat.isFile()) continue;

            const content = fs.readFileSync(filePath, 'utf-8');
            const name = entry.replace(/\.md$/, '');
            const description = extractDescription(content);

            commands.push({ name, description, prompt: content, source });
        } catch {
            // Skip unreadable files
        }
    }

    return commands;
}

// ── Default Templates ──

const DEFAULT_TEMPLATES = {
    'review.md': `# Code review with security, performance, and maintainability analysis

Review the following code thoroughly. Analyze it across three dimensions and provide a structured report.

$ARGUMENTS

---

## Review Checklist

### Security
- Check for injection vulnerabilities (SQL, XSS, command injection)
- Verify input validation and sanitization
- Look for hardcoded secrets, tokens, or credentials
- Assess authentication and authorization patterns
- Check for insecure deserialization or unsafe eval usage

### Performance
- Identify unnecessary re-renders or redundant computations
- Look for N+1 query patterns or unbounded loops
- Check for memory leaks (unclosed streams, dangling event listeners)
- Evaluate data structure choices and algorithmic complexity
- Flag any blocking operations on the main thread

### Maintainability
- Assess naming clarity and code readability
- Check for DRY violations and dead code
- Evaluate error handling completeness
- Look for missing or misleading comments
- Verify consistent formatting and style

## Output Format

For each finding, provide:
- **Severity**: \`critical\` | \`warning\` | \`info\`
- **Location**: File and line (or code snippet)
- **Issue**: What is wrong
- **Fix**: Concrete suggestion with code example

End with a summary score (0-10) for each dimension and an overall assessment.
`,

    'deploy.md': `# Smart deployment checklist and verification

Generate a comprehensive deployment plan for the following change. Be thorough — missed steps cause outages.

$ARGUMENTS

---

## Pre-Deployment

1. **Change Summary** — Describe what is being deployed and why
2. **Risk Assessment** — Rate the risk (low / medium / high / critical) with justification
3. **Dependencies** — List any infrastructure, service, or data dependencies
4. **Environment Variables** — New or changed env vars, with safe default values
5. **Database Migrations** — List migrations in order; note if they are reversible
6. **Feature Flags** — Any flags to enable/disable; rollout percentage plan

## Deployment Steps

Provide numbered steps in the exact order they should be executed:
- Include specific commands (e.g., \`kubectl apply\`, \`npm run migrate\`)
- Note expected duration for each step
- Mark any step that causes downtime with ⚠️
- Include rollback command for each step

## Post-Deployment Verification

1. **Health Checks** — Endpoints to hit, expected responses
2. **Smoke Tests** — Critical user flows to manually verify
3. **Monitoring** — Dashboards, alerts, and log queries to watch for 30 minutes
4. **Rollback Trigger** — Specific conditions that warrant an immediate rollback

## Rollback Plan

Provide a complete rollback procedure assuming the deployment has gone wrong:
- Step-by-step rollback commands
- Data restoration steps if applicable
- Communication template for stakeholders
`,

    'test.md': `# Generate comprehensive tests for the specified code

Analyze the following code and generate a thorough test suite. Cover happy paths, edge cases, error conditions, and integration boundaries.

$ARGUMENTS

---

## Test Generation Guidelines

### Structure
- Group tests logically by function/method/feature
- Use descriptive test names that explain the scenario and expected outcome
- Follow the Arrange → Act → Assert pattern
- Include setup and teardown where needed

### Coverage Requirements

**Happy Path Tests**
- Test the primary use case with valid inputs
- Test with different valid input variations
- Verify return values and side effects

**Edge Cases**
- Empty inputs (null, undefined, empty string, empty array)
- Boundary values (0, -1, MAX_INT, very long strings)
- Unicode and special characters
- Concurrent access patterns (if applicable)

**Error Cases**
- Invalid input types
- Missing required parameters
- Network/IO failures (use mocks)
- Timeout scenarios
- Permission/authorization failures

**Integration Boundaries**
- Mock external dependencies
- Test API contract compliance
- Verify error propagation across module boundaries

### Output Format

Generate the tests in the same language and framework used by the codebase. If no test framework is apparent, use:
- JavaScript/TypeScript → Jest or Vitest
- Python → pytest
- Go → standard testing package
- Rust → built-in #[test]

Include all necessary imports, mocks, and fixtures. Tests should be copy-paste ready.
`,

    'refactor.md': `# Refactor code with before/after comparison and rationale

Analyze the following code and propose a refactoring plan. Show concrete before/after comparisons for each change.

$ARGUMENTS

---

## Refactoring Analysis

### Step 1: Identify Issues
List every code smell, anti-pattern, or improvement opportunity:
- Duplicated logic
- Long functions (>30 lines)
- Deep nesting (>3 levels)
- God objects / large classes
- Poor naming
- Missing abstractions
- Tight coupling
- Violation of SOLID principles

### Step 2: Propose Changes
For each issue, provide:

**Before:**
\`\`\`
(original code)
\`\`\`

**After:**
\`\`\`
(refactored code)
\`\`\`

**Rationale:** Why this change improves the code (readability, testability, performance, etc.)

**Risk:** What could break and how to mitigate it

### Step 3: Migration Plan
If the refactoring is large:
1. Order the changes by dependency (which must happen first)
2. Identify safe intermediate states where tests still pass
3. Flag any changes that affect public API or require consumer updates

### Principles
- Preserve external behavior (refactoring, not rewriting)
- Each step should leave the code in a working state
- Prefer small, incremental changes over big-bang rewrites
- Keep backward compatibility unless explicitly removing deprecated code
`,

    'explain.md': `# Deep explanation of code with architecture diagrams and examples

Provide a comprehensive explanation of the following code. Assume the reader is a competent developer who is unfamiliar with this particular codebase.

$ARGUMENTS

---

## Explanation Structure

### 1. High-Level Overview
- What does this code do in one sentence?
- Where does it fit in the larger system? (entry point, library, middleware, etc.)
- What problem does it solve?

### 2. Architecture Diagram
Draw an ASCII diagram showing the key components and data flow:
\`\`\`
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Input   │────▶│ Process  │────▶│  Output  │
└──────────┘     └──────────┘     └──────────┘
\`\`\`

### 3. Code Walkthrough
Walk through the code section by section:
- Explain each function/class and its responsibility
- Highlight the core algorithm or logic
- Point out design patterns in use (Observer, Factory, Strategy, etc.)
- Explain non-obvious decisions ("this uses a WeakMap because…")

### 4. Data Flow
Trace how data moves through the code:
- Input format and validation
- Transformations applied at each stage
- Output format and destination
- Error paths and how failures propagate

### 5. Key Concepts
Explain any domain-specific or advanced concepts used:
- Algorithms (with time/space complexity)
- Protocols or standards
- Language-specific features (generics, macros, decorators, etc.)

### 6. Usage Examples
Provide 2-3 concrete examples showing how to use this code:
\`\`\`
// Example 1: Basic usage
...

// Example 2: With options
...

// Example 3: Error handling
...
\`\`\`

### 7. Gotchas and Caveats
List anything surprising, unintuitive, or easy to get wrong.
`,
};

/**
 * Create default command templates in ~/.onicode/commands/ if the directory
 * does not yet exist.
 */
function ensureDefaultCommands() {
    if (fs.existsSync(GLOBAL_COMMANDS_DIR)) return;

    ensureDir(GLOBAL_COMMANDS_DIR);

    for (const [filename, content] of Object.entries(DEFAULT_TEMPLATES)) {
        const filePath = path.join(GLOBAL_COMMANDS_DIR, filename);
        try {
            fs.writeFileSync(filePath, content, 'utf-8');
        } catch {
            // Non-fatal — user can create commands manually
        }
    }
}

// ── Public API ──

/**
 * Load all custom commands from global and project directories.
 * Project commands override global commands with the same name.
 *
 * @param {string} [projectPath] - Optional project root path
 * @returns {Array<{ name: string, description: string, prompt: string, source: 'global'|'project' }>}
 */
function loadCustomCommands(projectPath) {
    ensureDefaultCommands();

    const globalCmds = scanDirectory(GLOBAL_COMMANDS_DIR, 'global');
    const projDir = projectCommandsDir(projectPath);
    const projectCmds = scanDirectory(projDir, 'project');

    // Project commands override global commands with the same name
    const commandMap = new Map();
    for (const cmd of globalCmds) {
        commandMap.set(cmd.name, cmd);
    }
    for (const cmd of projectCmds) {
        commandMap.set(cmd.name, cmd);
    }

    return Array.from(commandMap.values());
}

/**
 * Find and execute a custom command by name.
 * Replaces $ARGUMENTS in the prompt template with the provided args string.
 *
 * @param {string} name - Command name (without leading /)
 * @param {string} args - User-supplied arguments
 * @param {string} [projectPath] - Optional project root path
 * @returns {{ prompt: string, source: 'global'|'project' } | null}
 */
function executeCustomCommand(name, args, projectPath) {
    const commands = loadCustomCommands(projectPath);
    const cmd = commands.find(c => c.name === name);
    if (!cmd) return null;

    const expandedPrompt = cmd.prompt.replace(/\$ARGUMENTS/g, args || '');

    return {
        prompt: expandedPrompt,
        source: cmd.source,
    };
}

/**
 * Get a summary of available custom commands for inclusion in AI system prompts.
 *
 * @param {string} [projectPath] - Optional project root path
 * @returns {string}
 */
function getCustomCommandsSummary(projectPath) {
    const commands = loadCustomCommands(projectPath);
    if (commands.length === 0) return '';

    const lines = ['Available custom commands:'];
    for (const cmd of commands) {
        const tag = cmd.source === 'project' ? ' (project)' : '';
        lines.push(`  /${cmd.name} — ${cmd.description}${tag}`);
    }
    return lines.join('\n');
}

// ── IPC Registration ──

/**
 * Register IPC handlers for custom commands.
 *
 * Channels:
 *   custom-commands-list   — list all commands for a project
 *   custom-commands-create — create/overwrite a command file
 *   custom-commands-delete — delete a command file
 *
 * @param {Electron.IpcMain} ipcMain
 */
function registerCommandsIPC(ipcMain) {
    // List all custom commands
    ipcMain.handle('custom-commands-list', async (_event, projectPath) => {
        try {
            return { commands: loadCustomCommands(projectPath) };
        } catch (err) {
            return { error: err.message };
        }
    });

    // Create or overwrite a command
    ipcMain.handle('custom-commands-create', async (_event, opts) => {
        const { name, content, scope, projectPath } = opts;

        if (!name || !content) {
            return { error: 'Command name and content are required' };
        }

        // Sanitize name: only allow alphanumeric, hyphens, underscores
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '');
        if (!safeName) {
            return { error: 'Invalid command name — use alphanumeric characters, hyphens, or underscores' };
        }

        const dir = scope === 'project' && projectPath
            ? projectCommandsDir(projectPath)
            : GLOBAL_COMMANDS_DIR;

        try {
            ensureDir(dir);
            const filePath = path.join(dir, `${safeName}.md`);
            fs.writeFileSync(filePath, content, 'utf-8');
            return { success: true, name: safeName, path: filePath };
        } catch (err) {
            return { error: err.message };
        }
    });

    // Delete a command
    ipcMain.handle('custom-commands-delete', async (_event, opts) => {
        const { name, scope, projectPath } = opts;

        if (!name) {
            return { error: 'Command name is required' };
        }

        const dir = scope === 'project' && projectPath
            ? projectCommandsDir(projectPath)
            : GLOBAL_COMMANDS_DIR;

        if (!dir) {
            return { error: 'No valid directory for the specified scope' };
        }

        const filePath = path.join(dir, `${name}.md`);

        try {
            if (!fs.existsSync(filePath)) {
                return { error: `Command "${name}" not found in ${scope || 'global'} commands` };
            }
            fs.unlinkSync(filePath);
            return { success: true, name };
        } catch (err) {
            return { error: err.message };
        }
    });
}

module.exports = {
    loadCustomCommands,
    executeCustomCommand,
    getCustomCommandsSummary,
    registerCommandsIPC,
};
