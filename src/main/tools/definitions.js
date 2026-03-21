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
            description: 'Execute a terminal command and return stdout/stderr. Use for running scripts, installing packages, building, testing, git operations, etc. Never use cd — use cwd instead.',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'The exact command to execute. Never includes cd — use cwd instead.' },
                    cwd: { type: 'string', description: 'Working directory for the command (used instead of cd)' },
                    timeout: { type: 'integer', description: 'Timeout in milliseconds (default 120000)' },
                    blocking: { type: 'boolean', description: 'If true, blocks until command finishes (default: auto-detected). If false, runs async (for dev servers, watchers).' },
                    safe_to_auto_run: { type: 'boolean', description: 'If true, this is a read-only command safe to auto-run (ls, cat, echo, pwd). NEVER set true for destructive commands (rm, install, curl, etc.).' },
                },
                required: ['command'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'check_terminal',
            description: 'Check the status and recent output of a running terminal session (dev server, install, build). Use this to monitor background processes, verify dev servers are still running, check install progress, or read error output.',
            parameters: {
                type: 'object',
                properties: {
                    session_id: { type: 'string', description: 'The terminal session ID (returned by run_command)' },
                    lines: { type: 'integer', description: 'Number of recent output lines to return (default 20, max 100)' },
                },
                required: ['session_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_terminals',
            description: 'List all active terminal sessions — running dev servers, background processes, and recent commands. Shows PID, port, uptime, and status for each.',
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
            description: 'Spawn a focused sub-agent for a specific task. Give it precise instructions, a constrained tool set, and clear boundaries. Supports agent types for specialized behavior and resume for continuing previous agent conversations.',
            parameters: {
                type: 'object',
                properties: {
                    task: { type: 'string', description: 'Precise task description. Be specific: what to do, what NOT to do, expected output format.' },
                    tool_set: {
                        type: 'string',
                        enum: ['read-only', 'git', 'browser', 'workspace', 'file-ops', 'search', 'research'],
                        description: 'Tool set for the sub-agent. read-only (default): read/search/list. git: git tools. browser: puppeteer. workspace: gws_cli. file-ops: full CRUD. search: LSP + semantic. research: websearch + browser + URL reading.',
                    },
                    agent_type: {
                        type: 'string',
                        enum: ['general-purpose', 'explore', 'plan', 'research'],
                        description: 'Agent type. explore: fast codebase exploration (read-only). plan: design implementation strategy (read-only). research: web research + analysis. general-purpose (default): full capabilities.',
                    },
                    thoroughness: {
                        type: 'string',
                        enum: ['quick', 'medium', 'thorough'],
                        description: 'For explore agents: quick (basic search), medium (moderate exploration), thorough (comprehensive analysis). Default: medium.',
                    },
                    resume_id: {
                        type: 'string',
                        description: 'Agent ID from a previous spawn_sub_agent call. Resumes the agent with its full prior conversation preserved. The task field becomes a follow-up message.',
                    },
                    context_files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'File paths to include as context for the sub-agent',
                    },
                    constraints: {
                        type: 'string',
                        description: 'Explicit constraints: "only read these 3 files", "do not modify anything", "return JSON format", "max 5 files", etc.',
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
                    dry_run: { type: 'boolean', description: 'If true, preview all edits without writing to disk. Returns what would change.' },
                },
                required: ['file_path', 'edits'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'init_project',
            description: 'Create a BRAND NEW project from scratch. Creates a clean project folder with only onicode.md (project context) + git init. No template bloat. Use ONLY for new projects — for existing folders/repos, use detect_project instead.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Project name (e.g. "streaming-website", "todo-app")' },
                    projectPath: { type: 'string', description: 'Full path for the project (e.g. "~/Documents/OniProjects/my-app")' },
                    description: { type: 'string', description: 'Brief project description' },
                    techStack: { type: 'string', description: 'Tech stack (e.g. "Next.js + TypeScript + Tailwind")' },
                },
                required: ['name', 'projectPath'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'detect_project',
            description: 'Scan an existing folder to detect if it is a known project (already registered in Onicode) or import it as a new project. Use this INSTEAD of init_project when the user wants to work on an existing codebase, git repo, or folder they did not create through Onicode. Returns project info, detected tech stack, git status, and file listing. Automatically registers unregistered folders as projects.',
            parameters: {
                type: 'object',
                properties: {
                    folder_path: { type: 'string', description: 'Path to the existing folder to scan (e.g. "~/Projects/my-app" or "/Users/me/code/repo")' },
                },
                required: ['folder_path'],
            },
        },
    },
    // ── Conversation Recall Tools ──
    {
        type: 'function',
        function: {
            name: 'conversation_search',
            description: 'Search past conversations by content. Use when the user references previous work ("remember that thing we built", "yesterday we...", "that project from last week"). Returns matching conversations with snippets. FTS5-powered with ranking.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search keywords — what the user is referring to (e.g. "zombie game", "auth system", "portfolio site")' },
                    limit: { type: 'number', description: 'Max results (default: 5)' },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'conversation_recall',
            description: 'Load the full context of a past conversation by ID. Returns a summary with the last 20 user/AI messages. Use after conversation_search to get details about a specific past conversation the user is referencing.',
            parameters: {
                type: 'object',
                properties: {
                    conversation_id: { type: 'string', description: 'The conversation ID from conversation_search results' },
                },
                required: ['conversation_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'memory_read',
            description: 'Read a memory file or list all memory files. Use to recall past decisions, user preferences, project context, or session history.',
            parameters: {
                type: 'object',
                properties: {
                    filename: { type: 'string', description: 'Memory filename to read (e.g. "MEMORY.md", "user.md", "soul.md", "2025-03-09.md"). Omit to list all files.' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'memory_write',
            description: 'Write or overwrite a memory file. Use this to update user.md with structured profile data. For incremental additions, prefer memory_append. MANDATORY: call this when the user shares personal info or you need to update their profile.',
            parameters: {
                type: 'object',
                properties: {
                    filename: { type: 'string', description: 'Memory filename (e.g. "MEMORY.md", "user.md", "2025-03-09.md")' },
                    content: { type: 'string', description: 'Full content to write (overwrites existing)' },
                },
                required: ['filename', 'content'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'memory_append',
            description: 'Append content to a memory file. MANDATORY: call this when the user states a preference, makes a tech decision, or you learn something worth remembering. Append to "user.md" for preferences, "MEMORY.md" for durable facts, or "<YYYY-MM-DD>.md" for session logs.',
            parameters: {
                type: 'object',
                properties: {
                    filename: { type: 'string', description: 'Memory filename to append to' },
                    content: { type: 'string', description: 'Content to append' },
                },
                required: ['filename', 'content'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'memory_search',
            description: 'Semantic search across all memories using FTS5 + TF-IDF similarity. Returns ranked results with snippets from soul, user profile, long-term memory, daily logs, and project memories. Use this PROACTIVELY to recall user preferences, past decisions, project patterns, or any relevant context before starting work.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query — keywords or phrases to find in memories' },
                    scope: { type: 'string', enum: ['all', 'global', 'project'], description: 'Search scope: all (default), global (soul/user/MEMORY/daily), or project memories only' },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'memory_save_fact',
            description: 'Quick-save a single learned fact to persistent memory. Use this whenever you learn something about the user, their preferences, a decision, or a pattern. Facts are individually indexed for fast semantic search. Much simpler than memory_append — just pass the fact string.',
            parameters: {
                type: 'object',
                properties: {
                    fact: { type: 'string', description: 'The fact to remember (e.g. "User prefers dark mode", "Project uses Prisma with PostgreSQL", "User\'s name is Alex")' },
                    category: { type: 'string', enum: ['preference', 'personal', 'technical', 'decision', 'correction', 'general'], description: 'Category for the fact (default: general)' },
                },
                required: ['fact'],
            },
        },
    },
    // ── Memory Intelligence Tools (OpenViking-inspired) ──
    {
        type: 'function',
        function: {
            name: 'memory_smart_search',
            description: 'Intent-aware memory search with hotness ranking. Analyzes your query to generate focused sub-queries, searches across all memory categories, and ranks results by relevance AND how frequently/recently each memory is accessed. Use this instead of memory_search for complex or ambiguous queries.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Natural language query — can be vague ("what does the user prefer") or specific ("their timezone")' },
                    project_id: { type: 'string', description: 'Optional project ID to scope search' },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'memory_get_related',
            description: 'Get memories related to a specific memory by following relation links. Memories that were extracted together or are topically connected are automatically linked. Use to explore context around a known fact.',
            parameters: {
                type: 'object',
                properties: {
                    memory_id: { type: 'number', description: 'The memory ID to find relations for' },
                },
                required: ['memory_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'memory_hot_list',
            description: 'List the most actively used memories ranked by hotness (access frequency * recency). Shows what knowledge is most important to the current user/project. Use to understand what context matters most.',
            parameters: {
                type: 'object',
                properties: {
                    category: { type: 'string', description: 'Optional category filter: fact, soul, user, long-term, daily, project' },
                    limit: { type: 'number', description: 'Max results (default: 15)' },
                },
            },
        },
    },
    // ── Credential Vault Tools ──
    {
        type: 'function',
        function: {
            name: 'credential_save',
            description: 'Save a credential to the encrypted vault (AES-256-GCM). Use for API keys, login credentials (username+password), secrets, or OAuth tokens. Each credential has a service name and tags for context-aware search.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Human-readable name (e.g. "Facebook Login", "Stripe Production Key")' },
                    type: { type: 'string', enum: ['api_key', 'login', 'secret', 'oauth'], description: 'Credential type' },
                    service: { type: 'string', description: 'Service name (e.g. "facebook", "stripe", "aws", "github")' },
                    description: { type: 'string', description: 'What this credential is for' },
                    tags: { type: 'array', items: { type: 'string' }, description: 'Tags for context search (e.g. ["social", "personal"])' },
                    username: { type: 'string', description: 'Username or email (for login type)' },
                    password: { type: 'string', description: 'Password (for login type)' },
                    api_key: { type: 'string', description: 'API key value (for api_key type)' },
                    token: { type: 'string', description: 'Token value (for oauth/secret type)' },
                    refresh_token: { type: 'string', description: 'Refresh token (for oauth type)' },
                    extra: { type: 'object', description: 'Additional key-value pairs', additionalProperties: { type: 'string' } },
                },
                required: ['title', 'type', 'service'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'credential_search',
            description: 'Search the credential vault by service name, title, tags, or description. Returns matching credentials with metadata (NO secrets). Use this FIRST when the user mentions a service and you need to check if credentials exist.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query — service name, title, or keywords (e.g. "facebook", "aws production")' },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'credential_get',
            description: 'Get a specific credential by ID. Returns metadata + masked values (e.g. "••••••XXXX"). Use to confirm which credential to use before calling credential_use.',
            parameters: {
                type: 'object',
                properties: {
                    credential_id: { type: 'string', description: 'The credential ID (from credential_search or credential_list)' },
                },
                required: ['credential_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'credential_use',
            description: 'Get decrypted credential values for immediate use in a tool call or command. SECURITY: Decrypted values are available ONLY in this tool result — they are NEVER shown in chat or stored in conversation history. Use when you need the actual password/key to authenticate.',
            parameters: {
                type: 'object',
                properties: {
                    credential_id: { type: 'string', description: 'The credential ID to decrypt' },
                    fields: { type: 'array', items: { type: 'string' }, description: 'Specific fields to retrieve (e.g. ["username", "password"]). If omitted, returns all fields.' },
                },
                required: ['credential_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'credential_list',
            description: 'List all credentials in the vault. Returns metadata only (title, type, service, tags) — no secrets. Shows what credentials the user has stored.',
            parameters: {
                type: 'object',
                properties: {
                    type_filter: { type: 'string', enum: ['api_key', 'login', 'secret', 'oauth'], description: 'Filter by credential type' },
                    service_filter: { type: 'string', description: 'Filter by service name' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'credential_delete',
            description: 'Delete a credential from the vault. This is permanent and cannot be undone. Always confirm with the user before deleting.',
            parameters: {
                type: 'object',
                properties: {
                    credential_id: { type: 'string', description: 'The credential ID to delete' },
                },
                required: ['credential_id'],
            },
        },
    },
    // ── Browser / Puppeteer Tools ──
    {
        type: 'function',
        function: {
            name: 'browser_navigate',
            description: 'Launch a browser (if not already running) and navigate to a URL. Use this to test web apps you create. Returns page title, status code, and URL. Console logs are captured automatically.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'URL to navigate to (e.g. http://localhost:3000)' },
                    wait_until: { type: 'string', description: 'Wait strategy: "load", "domcontentloaded", "networkidle0", "networkidle2" (default)' },
                },
                required: ['url'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_screenshot',
            description: 'Take a screenshot AND extract page content (headings, buttons, text, errors, inputs). Use the returned pageContent to analyze what the user sees — check headings, bodyText, buttons, and errors fields. If bodyText is empty, the app may not be rendering.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Name for the screenshot file' },
                    selector: { type: 'string', description: 'Optional CSS selector to screenshot a specific element' },
                    full_page: { type: 'boolean', description: 'Capture full page (default false)' },
                },
                required: ['name'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_evaluate',
            description: 'Execute JavaScript in the browser page context. Use to check DOM state, read values, or interact with the page.',
            parameters: {
                type: 'object',
                properties: {
                    script: { type: 'string', description: 'JavaScript code to execute in the browser' },
                },
                required: ['script'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_click',
            description: 'Click an element on the page by CSS selector.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of element to click' },
                },
                required: ['selector'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_type',
            description: 'Type text into an input field by CSS selector.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of input element' },
                    text: { type: 'string', description: 'Text to type' },
                },
                required: ['selector', 'text'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_wait',
            description: 'Wait for an element to appear on the page by CSS selector. Useful after navigation or interaction to wait for dynamic content to load before taking screenshots or clicking.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of element to wait for' },
                    timeout: { type: 'integer', description: 'Max time to wait in ms (default 10000)' },
                },
                required: ['selector'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_console_logs',
            description: 'Get browser console logs (errors, warnings, info). IMPORTANT: When you see errors, ACT on them — read the relevant source file, fix the bug with edit_file, then re-check. Do NOT just report errors to the user.',
            parameters: {
                type: 'object',
                properties: {
                    type: { type: 'string', description: 'Filter by type: "log", "error", "warn", "info"' },
                    limit: { type: 'integer', description: 'Max number of entries (default 50)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_close',
            description: 'Close the browser instance and free resources.',
            parameters: { type: 'object', properties: {} },
        },
    },
    // ── Browser Agent Tools (Chrome Automation) ──
    {
        type: 'function',
        function: {
            name: 'browser_agent_run',
            description: 'Launch an autonomous browser agent that uses your Chrome browser to achieve a goal. The agent navigates pages, clicks buttons, fills forms, and extracts data to accomplish web tasks. Use this for multi-step web workflows like: searching for information, filling out forms, comparing products, booking services, or any task that requires browsing multiple pages. The agent uses the user\'s actual Chrome browser with their existing sessions/cookies.',
            parameters: {
                type: 'object',
                properties: {
                    goal: { type: 'string', description: 'Natural language description of what to accomplish (e.g., "Search Google for the latest news about AI and summarize the top 3 results", "Go to amazon.com and find the cheapest wireless earbuds under $50")' },
                    start_url: { type: 'string', description: 'Optional starting URL. If not provided, the agent will navigate to where it needs to go.' },
                    max_steps: { type: 'integer', description: 'Maximum number of steps the agent can take (default 30)' },
                    use_chrome: { type: 'boolean', description: 'Use the user\'s Chrome browser (default true). Set to false for headless mode.' },
                },
                required: ['goal'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_get_elements',
            description: 'Get all interactive elements on the current browser page — buttons, links, inputs, dropdowns. Returns each element with its text/label, type, CSS selector, and position. Use this to understand what actions are available on the current page before clicking or typing.',
            parameters: {
                type: 'object',
                properties: {},
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_get_structure',
            description: 'Get the semantic structure of the current page — title, headings, navigation, main content, forms, tables, images. Use this to understand the overall layout and content of a page.',
            parameters: {
                type: 'object',
                properties: {},
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_extract_table',
            description: 'Extract structured data from HTML tables on the current page. Returns headers and rows as arrays. Useful for scraping tabular data like prices, listings, schedules, etc.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'Optional CSS selector to target a specific table. If omitted, extracts all tables.' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_extract_links',
            description: 'Extract all links from the current page. Optionally filter by text or URL pattern. Returns link text, href, whether it\'s external, and surrounding context.',
            parameters: {
                type: 'object',
                properties: {
                    filter: { type: 'string', description: 'Optional keyword to filter links by text or URL' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_fill_form',
            description: 'Fill multiple form fields at once by matching field labels. More efficient than individual browser_type calls. Handles text inputs, checkboxes, radio buttons, and dropdowns.',
            parameters: {
                type: 'object',
                properties: {
                    fields: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                label: { type: 'string', description: 'Field label text to match (e.g., "Email", "First Name")' },
                                value: { type: 'string', description: 'Value to fill in' },
                                selector: { type: 'string', description: 'Optional explicit CSS selector (overrides label matching)' },
                            },
                            required: ['value'],
                        },
                        description: 'Array of fields to fill',
                    },
                },
                required: ['fields'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_select',
            description: 'Select an option from a dropdown/select element by value or visible text.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of the select element' },
                    value: { type: 'string', description: 'Option value or visible text to select' },
                },
                required: ['selector', 'value'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_scroll',
            description: 'Scroll the page. Can scroll to an element, scroll by pixels, or scroll to top/bottom.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector to scroll to (element will be scrolled into view)' },
                    direction: { type: 'string', description: '"up" or "down" (default "down")' },
                    amount: { type: 'integer', description: 'Pixels to scroll (default 500)' },
                    to_bottom: { type: 'boolean', description: 'Scroll to the bottom of the page' },
                    to_top: { type: 'boolean', description: 'Scroll to the top of the page' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_tab_open',
            description: 'Open a new browser tab, optionally navigating to a URL. Returns the tab ID for later switching.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'Optional URL to navigate to in the new tab' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_tab_switch',
            description: 'Switch to a different browser tab by its tab ID.',
            parameters: {
                type: 'object',
                properties: {
                    tab_id: { type: 'string', description: 'Tab ID to switch to (from browser_tab_list)' },
                },
                required: ['tab_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_tab_list',
            description: 'List all open browser tabs with their URLs, titles, and tab IDs.',
            parameters: {
                type: 'object',
                properties: {},
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_tab_close',
            description: 'Close a specific browser tab by its tab ID.',
            parameters: {
                type: 'object',
                properties: {
                    tab_id: { type: 'string', description: 'Tab ID to close' },
                },
                required: ['tab_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_status',
            description: 'Get the current browser status — whether it\'s running, using Chrome or headless, open tabs, current URL, and available downloads.',
            parameters: {
                type: 'object',
                properties: {},
            },
        },
    },
    // ── Task Management Tools ──
    {
        type: 'function',
        function: {
            name: 'task_add',
            description: 'Add a task to your work plan. Always create a task list BEFORE starting any multi-step work. Supports dependency chains: use blocks/blocked_by to enforce task ordering.',
            parameters: {
                type: 'object',
                properties: {
                    content: { type: 'string', description: 'Task description' },
                    priority: { type: 'string', description: '"high", "medium", or "low"' },
                    milestone_id: { type: 'string', description: 'Optional milestone ID to group this task under' },
                    blocks: { type: 'array', items: { type: 'integer' }, description: 'Task IDs that this task blocks (they cannot start until this completes)' },
                    blocked_by: { type: 'array', items: { type: 'integer' }, description: 'Task IDs that must complete before this task can start' },
                },
                required: ['content'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'task_update',
            description: 'Update a task status or dependencies. Mark tasks "in_progress" when starting, "done" when finished. Tasks with non-empty blocked_by cannot be claimed until blockers complete.',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'integer', description: 'Task ID to update' },
                    status: { type: 'string', description: '"pending", "in_progress", "done", "skipped"' },
                    content: { type: 'string', description: 'Updated task description (optional)' },
                    add_blocks: { type: 'array', items: { type: 'integer' }, description: 'Task IDs to add as blocked by this task' },
                    add_blocked_by: { type: 'array', items: { type: 'integer' }, description: 'Task IDs to add as blocking this task' },
                    remove_blocks: { type: 'array', items: { type: 'integer' }, description: 'Task IDs to remove from blocks' },
                    remove_blocked_by: { type: 'array', items: { type: 'integer' }, description: 'Task IDs to remove from blocked_by' },
                },
                required: ['id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'task_list',
            description: 'List all tasks with their status. Use this to check what is done and what remains. Call this after completing each task to decide what to do next.',
            parameters: {
                type: 'object',
                properties: {
                    status: { type: 'string', description: 'Filter by status: "pending", "in_progress", "done"' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'milestone_create',
            description: 'Create a milestone to group tasks into sprints/phases. Tasks can be assigned to milestones via task_add(milestone_id).',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Milestone title (e.g. "Sprint 1", "Phase 1: Setup")' },
                    description: { type: 'string', description: 'What this milestone covers' },
                },
                required: ['title'],
            },
        },
    },
    // ── Plan Tools ──
    {
        type: 'function',
        function: {
            name: 'create_plan',
            description: 'Create an architecture/design plan BEFORE writing any code. Plans define the system design, components, file structure, and key decisions. The AI references plans while coding to stay aligned. Always create a plan for any non-trivial project or feature.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Plan title (e.g. "Zombie Survival Game Architecture")' },
                    overview: { type: 'string', description: 'High-level summary of what is being built and why (1-3 paragraphs)' },
                    architecture: { type: 'string', description: 'Technical architecture: patterns, data flow, state management, APIs, rendering approach, etc. Use markdown.' },
                    components: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: 'Component/module name' },
                                purpose: { type: 'string', description: 'What this component does' },
                                dependencies: { type: 'array', items: { type: 'string' }, description: 'Other components it depends on' },
                            },
                        },
                        description: 'List of components/modules in the system',
                    },
                    file_map: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                path: { type: 'string', description: 'File path relative to project root' },
                                purpose: { type: 'string', description: 'What this file contains' },
                            },
                        },
                        description: 'Planned file structure',
                    },
                    design_decisions: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Key design decisions and trade-offs (e.g. "Using Canvas2D over WebGL for simplicity")',
                    },
                },
                required: ['title', 'overview'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'update_plan',
            description: 'Update the active plan as scope evolves. Use this when the user changes requirements, you discover new needs, or architecture decisions change. Keep the plan as the living source of truth.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Updated title (optional)' },
                    overview: { type: 'string', description: 'Updated overview (optional)' },
                    architecture: { type: 'string', description: 'Updated architecture (optional)' },
                    components: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                purpose: { type: 'string' },
                                dependencies: { type: 'array', items: { type: 'string' } },
                            },
                        },
                        description: 'Updated component list (replaces existing)',
                    },
                    file_map: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                path: { type: 'string' },
                                purpose: { type: 'string' },
                            },
                        },
                        description: 'Updated file map (replaces existing)',
                    },
                    design_decisions: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Updated design decisions (replaces existing)',
                    },
                    status: { type: 'string', description: '"active", "completed", "archived"' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_plan',
            description: 'Retrieve the current active plan. Use this to refresh your understanding of the architecture before coding, after compaction, or when starting a new task. Returns the full plan with components, file map, and design decisions.',
            parameters: {
                type: 'object',
                properties: {},
            },
        },
    },
    // ── Web Tools ──
    {
        type: 'function',
        function: {
            name: 'webfetch',
            description: 'Fetch and read the content of a web page. Use this to look up documentation, READMEs, API references, or any web content. Returns the text content of the page.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'URL to fetch (must start with http:// or https://)' },
                    max_length: { type: 'integer', description: 'Maximum characters to return (default 8000)' },
                },
                required: ['url'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'websearch',
            description: 'Search the web for information. Returns a list of relevant results with titles, URLs, and snippets. Use this to find solutions, documentation, or research topics.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query' },
                    max_results: { type: 'integer', description: 'Maximum number of results (default 5)' },
                },
                required: ['query'],
            },
        },
    },
    // ── File Discovery Tools ──
    {
        type: 'function',
        function: {
            name: 'glob_files',
            description: 'Find files by glob pattern. Returns matching file paths sorted by modification time. Respects .gitignore. Use this to discover files by extension or name pattern.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.tsx", "*.json")' },
                    search_path: { type: 'string', description: 'Root directory to search from' },
                    max_results: { type: 'integer', description: 'Maximum results (default 50)' },
                },
                required: ['pattern', 'search_path'],
            },
        },
    },
    // ── Codebase Exploration ──
    {
        type: 'function',
        function: {
            name: 'explore_codebase',
            description: 'Fast, read-only exploration of a codebase. Analyzes project structure, key files, tech stack, and entry points. Use this to quickly understand an unfamiliar codebase before making changes.',
            parameters: {
                type: 'object',
                properties: {
                    project_path: { type: 'string', description: 'Root path of the project to explore' },
                    focus: { type: 'string', description: 'Optional focus area: "structure", "dependencies", "entrypoints", "config", or "all" (default)' },
                },
                required: ['project_path'],
            },
        },
    },
    // ── Logging / Context Tools ──
    {
        type: 'function',
        function: {
            name: 'get_system_logs',
            description: 'Get recent system logs including command outputs, errors, tool calls. Use this to debug issues or check what happened.',
            parameters: {
                type: 'object',
                properties: {
                    level: { type: 'string', description: 'Minimum level: "DEBUG", "INFO", "TOOL", "CMD", "WARN", "ERROR"' },
                    category: { type: 'string', description: 'Filter by category: "tool-call", "tool-result", "cmd-exec", "file-change", "agent-step"' },
                    limit: { type: 'integer', description: 'Max entries (default 50)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_changelog',
            description: 'Get the auto-generated changelog of all file changes in this session (files created, modified, deleted with line counts).',
            parameters: {
                type: 'object',
                properties: {
                    format: { type: 'string', description: '"json" or "markdown" (default markdown)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'index_project',
            description: 'Index a project directory to build a searchable map of all source files, their exports, imports, and key structures. Returns a condensed project context for better understanding. Use before making complex changes to unfamiliar codebases.',
            parameters: {
                type: 'object',
                properties: {
                    project_path: { type: 'string', description: 'Path to the project root' },
                    file_types: { type: 'string', description: 'Comma-separated extensions to index (default: ts,tsx,js,jsx,py,go,rs,java,css,html)' },
                    max_files: { type: 'integer', description: 'Maximum files to index (default 100)' },
                },
                required: ['project_path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'verify_project',
            description: 'Run automated quality checks on a project: cross-reference integrity (IDs match between files), import resolution, route/navigation target validation, unused exports detection, and dead code analysis. MANDATORY to run after building any project before marking it complete. Returns a list of issues found.',
            parameters: {
                type: 'object',
                properties: {
                    project_path: { type: 'string', description: 'Root path of the project to verify' },
                    checks: { type: 'string', description: 'Comma-separated checks to run: "cross-refs,imports,routes,exports,all" (default: "all")' },
                },
                required: ['project_path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_status',
            description: 'Get git status for a repository — branch, changed files, ahead/behind counts. Use before committing to see what changed.',
            parameters: {
                type: 'object',
                properties: {
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_commit',
            description: 'Stage all changes and create a git commit. Use after completing milestones, features, or bug fixes.',
            parameters: {
                type: 'object',
                properties: {
                    message: { type: 'string', description: 'Commit message (use conventional commits: feat:, fix:, refactor:, docs:, chore:)' },
                    cwd: { type: 'string', description: 'Repository path' },
                    files: { type: 'string', description: 'Files to stage (default: -A for all). Can be specific paths separated by spaces.' },
                },
                required: ['message'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_push',
            description: 'Push committed changes to the remote repository. Use after committing to sync with remote.',
            parameters: {
                type: 'object',
                properties: {
                    cwd: { type: 'string', description: 'Repository path' },
                    set_upstream: { type: 'boolean', description: 'Set upstream tracking branch (default true for first push)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_diff',
            description: 'View changes in working directory or staged files. Use to review what changed before committing.',
            parameters: {
                type: 'object',
                properties: {
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                    file_path: { type: 'string', description: 'Specific file to diff (optional, defaults to all files)' },
                    staged: { type: 'boolean', description: 'Show staged changes instead of unstaged (default false)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_log',
            description: 'View recent commit history. Use to understand what has been done recently or find a specific commit.',
            parameters: {
                type: 'object',
                properties: {
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                    count: { type: 'number', description: 'Number of commits to show (default 20, max 50)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_branches',
            description: 'List all local and remote branches. Use to see available branches before switching.',
            parameters: {
                type: 'object',
                properties: {
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_checkout',
            description: 'Switch to a different branch or create a new branch. Use for branching workflows.',
            parameters: {
                type: 'object',
                properties: {
                    branch: { type: 'string', description: 'Branch name to switch to or create' },
                    create: { type: 'boolean', description: 'Create a new branch (default false)' },
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
                required: ['branch'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_stash',
            description: 'Stash or restore uncommitted changes. Use to temporarily save work without committing.',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['push', 'pop', 'list', 'drop'], description: 'Stash action: push (save), pop (restore), list (show all), drop (discard)' },
                    message: { type: 'string', description: 'Stash message (only for push action)' },
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
                required: ['action'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_pull',
            description: 'Pull latest changes from the remote repository. Use to sync with teammates\' changes.',
            parameters: {
                type: 'object',
                properties: {
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
            },
        },
    },
    // ── Git: Stage & Unstage ──
    {
        type: 'function',
        function: {
            name: 'git_stage',
            description: 'Stage specific files for commit. Use this to selectively stage files before committing (instead of staging everything).',
            parameters: {
                type: 'object',
                properties: {
                    files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'File paths to stage. Use ["."] to stage all.',
                    },
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
                required: ['files'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_unstage',
            description: 'Unstage files that were staged for commit, keeping the working directory changes.',
            parameters: {
                type: 'object',
                properties: {
                    files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'File paths to unstage.',
                    },
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
                required: ['files'],
            },
        },
    },
    // ── Git: Merge ──
    {
        type: 'function',
        function: {
            name: 'git_merge',
            description: 'Merge a branch into the current branch. Use --no-ff for explicit merge commits.',
            parameters: {
                type: 'object',
                properties: {
                    branch: { type: 'string', description: 'Branch to merge into current branch' },
                    no_ff: { type: 'boolean', description: 'Force a merge commit even for fast-forward merges (default false)' },
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
                required: ['branch'],
            },
        },
    },
    // ── Git: Reset ──
    {
        type: 'function',
        function: {
            name: 'git_reset',
            description: 'Reset current HEAD to a specified state. Modes: soft (keep staged+working), mixed (keep working, unstage), hard (discard all changes). DANGEROUS with hard mode.',
            parameters: {
                type: 'object',
                properties: {
                    mode: { type: 'string', enum: ['soft', 'mixed', 'hard'], description: 'Reset mode (default: mixed)' },
                    ref: { type: 'string', description: 'Commit reference to reset to (default: HEAD)' },
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
            },
        },
    },
    // ── Git: Tag ──
    {
        type: 'function',
        function: {
            name: 'git_tag',
            description: 'Create, list, or delete git tags. Use for versioning releases.',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['list', 'create', 'delete'], description: 'Tag action (default: list)' },
                    tag_name: { type: 'string', description: 'Tag name (required for create/delete)' },
                    message: { type: 'string', description: 'Annotated tag message (optional, for create)' },
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
            },
        },
    },
    // ── Git: Remotes ──
    {
        type: 'function',
        function: {
            name: 'git_remotes',
            description: 'List, add, or remove remote repositories.',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['list', 'add', 'remove'], description: 'Remote action (default: list)' },
                    name: { type: 'string', description: 'Remote name (required for add/remove)' },
                    url: { type: 'string', description: 'Remote URL (required for add)' },
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
            },
        },
    },
    // ── Git: Show file at commit ──
    {
        type: 'function',
        function: {
            name: 'git_show',
            description: 'Show the contents of a file at a specific commit or branch. Useful for comparing versions.',
            parameters: {
                type: 'object',
                properties: {
                    ref: { type: 'string', description: 'Commit hash, branch name, or tag (e.g., "HEAD~1", "main", "v1.0")' },
                    file_path: { type: 'string', description: 'Path to the file within the repository' },
                    cwd: { type: 'string', description: 'Repository path (defaults to current project path)' },
                },
                required: ['ref', 'file_path'],
            },
        },
    },
    // ── GitHub PR Tools ──
    {
        type: 'function',
        function: {
            name: 'git_create_pr',
            description: 'Create a pull request on GitHub for the current branch. Requires GitHub account to be connected.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'PR title' },
                    body: { type: 'string', description: 'PR description/body (markdown)' },
                    base: { type: 'string', description: 'Base branch to merge into (default: main)' },
                    cwd: { type: 'string', description: 'Repository path' },
                },
                required: ['title'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_list_prs',
            description: 'List pull requests for the current repository on GitHub.',
            parameters: {
                type: 'object',
                properties: {
                    state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Filter by state (default: open)' },
                    cwd: { type: 'string', description: 'Repository path' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'git_publish',
            description: 'Create a new GitHub repository and push the local repo to it. Requires GitHub account.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Repository name' },
                    description: { type: 'string', description: 'Repository description' },
                    private: { type: 'boolean', description: 'Make repository private (default: true)' },
                    cwd: { type: 'string', description: 'Repository path' },
                },
                required: ['name'],
            },
        },
    },
    // ══════════════════════════════════════════
    //  GitHub CLI (gh) Tools
    // ══════════════════════════════════════════
    {
        type: 'function',
        function: {
            name: 'gh_cli',
            description: 'Execute GitHub CLI (gh) commands. Use for ALL GitHub operations: issues, PRs, repos, releases, actions, gists, codespaces, API calls. The gh CLI is authenticated via the connected GitHub account. Examples: "pr list", "issue create --title Bug --body Details", "api repos/{owner}/{repo}", "release list", "run list".',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'The gh subcommand to run (e.g. "pr list", "issue view 123", "repo clone owner/repo", "api /user/repos")' },
                    cwd: { type: 'string', description: 'Working directory (defaults to current project)' },
                    flags: { type: 'string', description: 'Additional flags as a single string (e.g. "--json number,title,state --limit 20")' },
                },
                required: ['command'],
            },
        },
    },
    // ══════════════════════════════════════════
    //  Google Workspace CLI (gws) Tools
    // ══════════════════════════════════════════
    {
        type: 'function',
        function: {
            name: 'gws_cli',
            description: 'Execute Google Workspace CLI (gws) commands for Gmail, Drive, Docs, Sheets, Calendar, and 30+ Google services. Auth is handled by gws itself (run "gws auth login" first). If auth fails, tell the user to run "gws auth login" in terminal. Common operations: "gmail users messages list --params {\"userId\":\"me\",\"maxResults\":10}", "drive files list", "sheets spreadsheets create --json {}", "calendar events list", "docs documents get --params {\"documentId\":\"...\"}". Use --json for structured input and --params for query parameters.',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'The gws subcommand (e.g. "gmail users messages list", "drive files list", "sheets spreadsheets create")' },
                    params: { type: 'string', description: 'JSON string for --params flag (query parameters)' },
                    json_body: { type: 'string', description: 'JSON string for --json flag (request body)' },
                    flags: { type: 'string', description: 'Additional flags (e.g. "--page-all", "--dry-run")' },
                },
                required: ['command'],
            },
        },
    },
    // ══════════════════════════════════════════
    //  Cascade-Level Tools
    // ══════════════════════════════════════════
    // ── Ask User Question (structured multiple-choice) ──
    {
        type: 'function',
        function: {
            name: 'ask_user_question',
            description: 'Present the user with a structured question and up to 4 clickable options. Use when you need clarification, confirmation, or a choice from the user. The user can also provide free-text instead of picking an option. ALWAYS use this instead of asking questions in plain text — it provides a better UX with clickable buttons.',
            parameters: {
                type: 'object',
                properties: {
                    question: { type: 'string', description: 'The question to ask the user' },
                    options: {
                        type: 'array',
                        description: 'Up to 4 options for the user to choose from',
                        items: {
                            type: 'object',
                            properties: {
                                label: { type: 'string', description: 'Short label for the option (shown on button)' },
                                description: { type: 'string', description: 'Longer description of what this option means' },
                            },
                            required: ['label'],
                        },
                    },
                    allow_multiple: { type: 'boolean', description: 'Whether the user can select more than one option (default: false)' },
                },
                required: ['question', 'options'],
            },
        },
    },
    // ── Sequential Thinking (structured chain-of-thought reasoning) ──
    {
        type: 'function',
        function: {
            name: 'sequential_thinking',
            description: 'A structured reasoning tool for complex multi-step problems. Call this multiple times to build a chain of thought. Each call adds a numbered thought step. You can revise previous thoughts, branch into alternatives, and adjust the total number of steps dynamically. Use for: debugging with unclear root cause, multi-file refactoring planning, architecture decisions, any problem where you need to reason step by step before acting.',
            parameters: {
                type: 'object',
                properties: {
                    thought: { type: 'string', description: 'The current thinking step content' },
                    thought_number: { type: 'integer', description: 'Current step number (1-indexed)' },
                    total_thoughts: { type: 'integer', description: 'Current estimate of total steps needed (can be adjusted)' },
                    next_thought_needed: { type: 'boolean', description: 'Whether another thought step follows' },
                    is_revision: { type: 'boolean', description: 'Whether this revises a previous thought' },
                    revises_thought: { type: 'integer', description: 'Which thought number is being reconsidered' },
                    branch_from_thought: { type: 'integer', description: 'Branching point thought number' },
                    branch_id: { type: 'string', description: 'Identifier for the current branch (e.g., "approach-A")' },
                },
                required: ['thought', 'thought_number', 'total_thoughts', 'next_thought_needed'],
            },
        },
    },
    // ── Trajectory Search (search past conversations) ──
    {
        type: 'function',
        function: {
            name: 'trajectory_search',
            description: 'Search through previous conversations for relevant context. Returns matching conversation chunks scored by relevance. Use when the user references past work, or when you need context from a previous session.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query — can be a topic, file name, tool name, or natural language description' },
                    conversation_id: { type: 'string', description: 'Optional: specific conversation ID to search within' },
                    max_results: { type: 'integer', description: 'Maximum number of results to return (default: 10, max: 50)' },
                },
                required: ['query'],
            },
        },
    },
    // ── Find by Name (enhanced file finder) ──
    {
        type: 'function',
        function: {
            name: 'find_by_name',
            description: 'Search for files and directories by name pattern. Fast alternative to list_directory for locating files. Respects .gitignore by default. Use before read_file when you know the filename but not the exact path.',
            parameters: {
                type: 'object',
                properties: {
                    search_directory: { type: 'string', description: 'The directory to search within' },
                    pattern: { type: 'string', description: 'Glob pattern to match (e.g., "*.tsx", "README*", "auth*")' },
                    type: { type: 'string', enum: ['file', 'directory', 'any'], description: 'Filter by type (default: "any")' },
                    extensions: { type: 'array', items: { type: 'string' }, description: 'File extensions to include without dot (e.g., ["ts", "tsx", "js"])' },
                    excludes: { type: 'array', items: { type: 'string' }, description: 'Glob patterns to exclude (e.g., ["node_modules/**", "dist/**"])' },
                    max_depth: { type: 'integer', description: 'Maximum directory depth to search (default: unlimited)' },
                },
                required: ['search_directory', 'pattern'],
            },
        },
    },

    // ── URL Content & Pagination ──

    {
        type: 'function',
        function: {
            name: 'read_url_content',
            description: 'Fetch and read content from a public HTTP/HTTPS URL. Returns the text content (HTML stripped) and a document_id for paginated reading with view_content_chunk. Use for documentation, API references, or any web page the user references.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'The URL to fetch (must be HTTP or HTTPS)' },
                },
                required: ['url'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'view_content_chunk',
            description: 'View a specific chunk of a previously fetched web document. The document must have already been read by read_url_content. Use to page through long documents.',
            parameters: {
                type: 'object',
                properties: {
                    document_id: { type: 'string', description: 'The document ID from a previous read_url_content call' },
                    position: { type: 'integer', description: 'The chunk position to view (0-indexed)' },
                },
                required: ['document_id', 'position'],
            },
        },
    },

    // ── Jupyter Notebook ──

    {
        type: 'function',
        function: {
            name: 'read_notebook',
            description: 'Read and parse a Jupyter notebook (.ipynb file). Shows cells with their IDs, types (code/markdown), source content, and outputs in a formatted view.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: { type: 'string', description: 'Absolute path to the .ipynb file' },
                },
                required: ['file_path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'edit_notebook',
            description: 'Edit a Jupyter notebook cell. Can replace existing cell content or insert a new cell. Cannot delete cells.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: { type: 'string', description: 'Absolute path to the .ipynb file' },
                    cell_number: { type: 'integer', description: '0-indexed cell number to edit (default: 0)' },
                    new_source: { type: 'string', description: 'New content for the cell' },
                    edit_mode: { type: 'string', enum: ['replace', 'insert'], description: '"replace" to replace cell content (default), "insert" to insert a new cell' },
                    cell_type: { type: 'string', enum: ['code', 'markdown'], description: 'Cell type — required when edit_mode is "insert"' },
                },
                required: ['file_path', 'new_source'],
            },
        },
    },

    // ── Deployment ──

    {
        type: 'function',
        function: {
            name: 'read_deployment_config',
            description: 'Read the deployment configuration for a web project. Detects framework, build settings, and readiness for deployment. Must be called before deploy_web_app.',
            parameters: {
                type: 'object',
                properties: {
                    project_path: { type: 'string', description: 'Absolute path to the project root' },
                },
                required: ['project_path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'deploy_web_app',
            description: 'Deploy a JavaScript web application to a hosting provider (Netlify/Vercel). Runs the build and deploys. Only source files needed — no pre-build required.',
            parameters: {
                type: 'object',
                properties: {
                    project_path: { type: 'string', description: 'Absolute path to the project' },
                    framework: { type: 'string', enum: ['nextjs', 'react', 'vue', 'svelte', 'astro', 'nuxt', 'gatsby', 'vite', 'remix', 'angular'], description: 'Framework enum' },
                    provider: { type: 'string', enum: ['netlify', 'vercel'], description: 'Hosting provider (default: netlify)' },
                    subdomain: { type: 'string', description: 'Unique subdomain for the URL (leave empty for re-deploys)' },
                    project_id: { type: 'string', description: 'Existing project ID for re-deploys' },
                },
                required: ['project_path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'check_deploy_status',
            description: 'Check whether a deployment build succeeded and the site is live.',
            parameters: {
                type: 'object',
                properties: {
                    deployment_id: { type: 'string', description: 'The deployment ID from deploy_web_app' },
                    provider: { type: 'string', enum: ['netlify', 'vercel'], description: 'Hosting provider' },
                },
                required: ['deployment_id'],
            },
        },
    },
    // ── Plan Mode Tools ──
    {
        type: 'function',
        function: {
            name: 'enter_plan_mode',
            description: 'Enter plan mode for non-trivial implementation tasks. In plan mode, you are restricted to read-only tools (no edit/create/delete/run_command). Explore the codebase, understand patterns, then write a plan before coding. Use for: new features, multi-file changes, architectural decisions, unclear requirements.',
            parameters: {
                type: 'object',
                properties: {
                    reason: { type: 'string', description: 'Brief reason for entering plan mode (e.g. "Multi-file refactor needs architecture review")' },
                },
                required: ['reason'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'exit_plan_mode',
            description: 'Exit plan mode after writing your plan. The plan should already be complete. This signals readiness for implementation.',
            parameters: {
                type: 'object',
                properties: {
                    plan_summary: { type: 'string', description: 'One-line summary of what the plan covers' },
                },
                required: ['plan_summary'],
            },
        },
    },
    // ── Worktree Tools ──
    {
        type: 'function',
        function: {
            name: 'enter_worktree',
            description: 'Create an isolated git worktree for experimental or parallel work. Creates a new branch from HEAD in .onicode/worktrees/. Use when you need to make changes without affecting the main working directory.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Worktree name (used for directory and branch name). Auto-generated if omitted.' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'exit_worktree',
            description: 'Leave the current worktree. Choose to keep it (for later review/merge) or remove it (cleanup).',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['keep', 'remove'], description: '"keep" preserves the worktree and branch. "remove" deletes both.' },
                    discard_changes: { type: 'boolean', description: 'Force remove even with uncommitted changes. Default false.' },
                },
                required: ['action'],
            },
        },
    },
    // ── Deferred Tool Loading ──
    {
        type: 'function',
        function: {
            name: 'load_tools',
            description: 'Load extended tool definitions by category. By default, only core tools (read/edit/create/delete/search/run_command/etc) are available. Use this to activate specialized tools when needed.',
            parameters: {
                type: 'object',
                properties: {
                    categories: {
                        type: 'array',
                        items: { type: 'string', enum: ['deployment', 'browser', 'notebooks', 'url_reading', 'orchestration', 'code_intelligence', 'context_engine', 'verification'] },
                        description: 'Tool categories to load. Each category activates a group of related tools.',
                    },
                },
                required: ['categories'],
            },
        },
    },
    // ── Background Task Output ──
    {
        type: 'function',
        function: {
            name: 'get_background_output',
            description: 'Retrieve output from a background process or async sub-agent by its ID. Can optionally block until completion.',
            parameters: {
                type: 'object',
                properties: {
                    process_id: { type: 'string', description: 'Process or agent ID to retrieve output from' },
                    block: { type: 'boolean', description: 'If true, wait for the process to complete before returning. Default false.' },
                    timeout_ms: { type: 'integer', description: 'Max wait time in ms when blocking. Default 30000 (30s). Max 300000 (5min).' },
                },
                required: ['process_id'],
            },
        },
    },
    // ══════════════════════════════════════════
    //  Self-Management & Platform Identity Tools
    // ══════════════════════════════════════════
    {
        type: 'function',
        function: {
            name: 'get_platform_info',
            description: 'Get comprehensive information about the Onicode platform, including version, active provider/model, loaded tools count, active project, connected services, system resources, and diagnostic health checks. Use this to understand your own capabilities and troubleshoot issues.',
            parameters: {
                type: 'object',
                properties: {
                    include_diagnostics: { type: 'boolean', description: 'Run diagnostic checks (memory usage, tool count, provider status, storage health). Default true.' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'update_config',
            description: 'Update Onicode configuration settings. Can modify soul.md (your personality), user.md (user profile), theme, permission mode, auto-commit preference, and other behavioral settings. Use this to adapt your behavior based on user preferences.',
            parameters: {
                type: 'object',
                properties: {
                    setting: {
                        type: 'string',
                        enum: ['soul', 'user_profile', 'theme', 'permission_mode', 'auto_commit', 'thinking_level', 'compact_threshold'],
                        description: 'The setting to update',
                    },
                    value: { type: 'string', description: 'The new value for the setting. For soul/user_profile: the full content to write. For theme: theme name (sand, midnight, obsidian, ocean, aurora, monokai, rose-pine, nord, catppuccin, light, dark, neutral). For permission_mode: auto-allow, ask-destructive, plan-only. For auto_commit: true/false. For thinking_level: low, medium, high. For compact_threshold: number (token count).' },
                },
                required: ['setting', 'value'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'self_diagnose',
            description: 'Run self-diagnostic checks on Onicode systems. Checks: AI provider connectivity, tool definitions integrity, memory system health, storage (SQLite) status, MCP server connections, active terminal sessions, and recent errors from logs. Returns a structured health report with issues and recommendations.',
            parameters: {
                type: 'object',
                properties: {
                    checks: {
                        type: 'string',
                        description: 'Comma-separated checks to run: "provider,tools,memory,storage,mcp,terminals,errors,all" (default: "all")',
                    },
                },
            },
        },
    },
];

module.exports = { TOOL_DEFINITIONS };
