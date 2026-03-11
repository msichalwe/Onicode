# Onicode Architecture

> Technical reference for the Onicode desktop application.
> Last updated: 2026-03-11

---

## 1. System Overview

Onicode is an Electron 34 desktop application built on React 19 (Chat Shell) with a planned VS Code-based Editor Shell. The architecture follows a **two-shell, one-brain** model:

```
+---------------------------------------------------------------------+
|                        Electron Main Process                         |
|  (Node.js — CommonJS — 19 modules — ~17,600 lines)                  |
|                                                                      |
|  index.js ── AI streaming, OAuth, BrowserWindow                      |
|  aiTools.js ── 66 tool definitions + executor + task manager         |
|  orchestrator.js ── multi-agent work graph                           |
|  contextEngine.js ── pre-retrieval pipeline                          |
|  lsp.js / codeIndex.js ── code intelligence + semantic search        |
|  mcp.js ── MCP stdio client + dynamic tool injection                 |
|  storage.js ── SQLite persistence                                    |
|  + 11 more modules (see Module Map)                                  |
+---------------------------------------------------------------------+
        |                                          |
        | contextBridge (preload.js)               | Puppeteer
        | 139 invoke handlers                      | (headless Chrome)
        | 25 event channels                        |
        v                                          v
+--------------------------------+         +--------------+
|      Renderer Process          |         |   Browser    |
|  (React 19 + Vite 6 + TS)     |         |   Instance   |
|                                |         +--------------+
|  Chat Shell (default)          |
|  - 16 TSX/TS files             |
|  - Single CSS file (9,374 LOC) |
|  - 12 themes                   |
+--------------------------------+
        |
        | (planned)
        v
+--------------------------------+
|      Editor Shell              |
|  (VS Code workbench — lazy)    |
|  NOT YET IMPLEMENTED           |
+--------------------------------+
```

**Chat Shell** is the default and only active shell. It provides conversational AI with streaming responses, tool execution visualization, slash commands, terminal integration, project management, and git operations. **Editor Shell** (VS Code workbench) will load lazily when the user activates a code editor view.

---

## 2. Process Model

### Main Process (Node.js, CommonJS)

- Entry: `src/main/index.js`
- Spawns BrowserWindow with `contextIsolation: true`, `nodeIntegration: false`
- Owns all AI streaming connections (OpenAI API, ChatGPT OAuth, gateways)
- Runs all tool execution (file I/O, terminal, git, browser, etc.)
- Manages SQLite database, MCP servers, Puppeteer instances, shell sessions

### Renderer Process (React 19, TypeScript)

- Entry: `src/chat/main.tsx` (Vite-built, served from `dist/chat/`)
- No direct Node.js access; all system interaction through `window.onicode`
- State managed via `useState` + `localStorage` (no Redux/Zustand)
- Receives AI streaming via IPC event listeners

### Preload Bridge (`preload.js`)

- 352 lines; defines the `window.onicode` API surface
- Uses `contextBridge.exposeInMainWorld` to expose typed IPC wrappers
- Two patterns:
  - **`ipcRenderer.invoke(channel, ...args)`** — request/response (139 channels)
  - **`ipcRenderer.on(channel, handler)`** — event subscription (25 channels), each returning an unsubscribe function

---

## 3. Module Map — Main Process

19 CommonJS modules in `src/main/`. Total: ~17,600 lines.

| Module | Lines | Purpose |
|---|---:|---|
| `aiTools.js` | 5,208 | 66 AI tool definitions (OpenAI function-calling format), unified tool executor with permission enforcement, hook pipeline, task manager (SQLite-backed), sub-agent spawning, file context tracker, session management, auto-backup, fuzzy edit matching |
| `index.js` | 2,988 | App entry point, BrowserWindow creation, dual-mode AI streaming (OpenAI API + ChatGPT Responses API), Codex OAuth PKCE flow, tool call routing (`executeAnyTool`), `getAllToolDefinitions()` aggregation, provider test, 42 `ipcMain.handle` registrations |
| `contextEngine.js` | 1,240 | Pre-retrieval pipeline: regex-based dependency graph (~8ms build), file outline cache (LSP + regex fallback), multi-signal file ranker (5 signals: filename, TF-IDF, import proximity, git recency, path heuristics), fs.watch file watcher, task classifier, 5 composite tools |
| `codeIndex.js` | 1,088 | TF-IDF semantic search indexer: file walking with skip dirs, trigram tokenization, inverted index, ranked search results; 2 tools (`semantic_search`, `index_codebase`) |
| `orchestrator.js` | 1,053 | Multi-agent orchestration: 5 specialist roles (researcher, implementer, reviewer, tester, planner), work graph with dependency edges, parallel execution, file lock registry, structured markdown reports; 3 tools |
| `lsp.js` | 858 | Code intelligence via TypeScript compiler API: symbol resolution, definition lookup, reference finding, type information, project-wide symbol search; 4 tools |
| `compactor.js` | 586 | Context compaction: mechanical summary (regex extraction of key decisions/code), semantic compaction (AI-powered summarization), auto-trigger at 60k token estimate, token estimation heuristic |
| `mcp.js` | 521 | MCP (Model Context Protocol) stdio client: JSON-RPC 2.0 over stdin/stdout, server lifecycle (spawn/connect/disconnect), tool discovery, dynamic tool injection into AI tool list. Config: `~/.onicode/mcp.json` |
| `memory.js` | 513 | Persistent memory system: `soul.md` (personality), `user.md` (preferences), daily logs, project-scoped memory, cross-session context. Storage: `~/.onicode/memory/` |
| `commands.js` | 508 | Custom slash commands: `.onicode/commands/*.md` with `$ARGUMENTS` substitution, 5 default templates (review, deploy, test, refactor, explain), auto-detection |
| `storage.js` | 472 | SQLite persistence layer (`~/.onicode/onicode.db`): tables for tasks, milestones, conversations, sessions, attachments. WAL mode, foreign keys, graceful fallback on failure |
| `hooks.js` | 461 | Lifecycle hook system: 19 hook types, global (`~/.onicode/hooks.json`) + project (`.onicode/hooks.json`) config, shell command execution with env vars, dangerous command pattern matching (14 regex patterns) |
| `projects.js` | 386 | Project CRUD: init with onidocs templates, scan existing folders, list/get/delete, open in external editors (VS Code, Cursor, Windsurf, Finder). Storage: `~/.onicode/projects.json` |
| `connectors.js` | 369 | OAuth connectors: GitHub (device code flow), Google (localhost redirect), Slack (placeholder). Token storage in `~/.onicode/connectors.json` |
| `preload.js` | 352 | Electron contextBridge: exposes `window.onicode` API with 139 invoke wrappers + 25 event subscriptions |
| `browser.js` | 340 | Puppeteer headless browser: launch, navigate, screenshot, evaluate JS, click, type, wait, console log capture |
| `git.js` | 294 | Git operations for the UI panel: 23 `ipcMain.handle` registrations covering status, branches, log, diff, stage, unstage, commit, checkout, stash, remotes, pull, push, merge, reset, tag |
| `logger.js` | 220 | Structured logging: daily-rotated log files (`~/.onicode/logs/`), severity levels (debug/info/warn/error), category-based filtering |
| `terminal.js` | 135 | Shell session management: spawn `/bin/zsh -l`, stdin/stdout streaming via IPC, session kill, one-shot exec (30s timeout) |

---

## 4. Chat Shell Components

16 TypeScript/TSX files in `src/chat/`. Total: ~12,500 lines (excluding CSS).

| File | Lines | Purpose |
|---|---:|---|
| `styles/index.css` | 9,374 | All CSS: reset, 12 theme definitions (CSS custom properties), layout, every component style |
| `components/ChatView.tsx` | 2,999 | Main chat UI: message rendering, AI streaming listener, tool step visualization (expandable cards with diffs, terminal output, search results), @ mentions, attachments, session timer, scroll management |
| `components/RightPanel.tsx` | 1,940 | Tabbed widget panel: Terminal, Project files, File viewer, Agents, Tasks, Git, Browser preview |
| `ai/systemPrompt.ts` | 1,109 | Context-aware system prompt builder: injects active skills, tool descriptions, git status, project context, hooks summary, MCP tools, memory, pre-retrieved context |
| `components/ProjectsView.tsx` | 1,013 | Project list/detail view: file tree, onidocs viewer, tasks tab, milestones tab, git tab, "Open in" editor buttons |
| `components/SettingsPanel.tsx` | 929 | Settings UI: theme picker (12 themes), provider management, skills toggle, connectors, hooks config, MCP server management, permissions |
| `components/ProviderSettings.tsx` | 674 | AI provider configuration: 3 providers (OpenAI/Codex, OniAI Gateway, OpenClaw), API key input, Codex OAuth PKCE flow, test connection |
| `types/window.d.ts` | 556 | TypeScript declarations for the `window.onicode` API surface |
| `App.tsx` | 545 | Root component: view routing (Chat, Projects, Docs, Memories, Settings), ThemeProvider, floating editor (highlight.js, draggable/resizable) |
| `commands/executor.ts` | 461 | Slash command execution: maps 21 commands to actions (chat, AI, project, terminal, panel, system categories) |
| `components/MemoriesView.tsx` | 384 | Memory file viewer/editor: list memory files, read/write/delete, inline editing |
| `commands/skills.ts` | 377 | 12 built-in AI skills: code review, debugging, testing, frontend design, web research, screenshot-to-code, responsive layout, animation, fullstack scaffold, etc. |
| `components/AttachmentGallery.tsx` | 333 | Attachment browser: filter by type (images/code/docs/links), search, detail modal with preview |
| `components/QuestionDialog.tsx` | 269 | AI question dialog: structured prompts from `ask_user_question` tool |
| `components/TodoApp.tsx` | 265 | Legacy task list (replaced by unified TaskManager + SQLite) |
| `components/ProjectModeBar.tsx` | 181 | Project mode header bar: shows active project, switch button |
| `components/DocsView.tsx` | 139 | Aggregated onidocs viewer from all projects |
| `components/OnboardingDialog.tsx` | 103 | First-run onboarding: preferences collection, memory initialization |
| `components/Sidebar.tsx` | 97 | Left navigation: Chat, Projects, Docs/Files, Memories, Settings |
| `commands/registry.ts` | 50 | 21 slash command definitions with name, description, category, argument spec |
| `hooks/useTheme.tsx` | 48 | ThemeContext provider: state management, localStorage persistence, `data-theme` attribute on `<html>` |
| `main.tsx` | 10 | ReactDOM.createRoot entry point |

---

## 5. AI Tool Architecture

Tools are defined in OpenAI function-calling format and aggregated in `index.js`:

```
getAllToolDefinitions()
  ├── TOOL_DEFINITIONS (aiTools.js)           — 66 tools
  ├── getLSPToolDefinitions() (lsp.js)        —  4 tools
  ├── getCodeIndexToolDefinitions()           —  2 tools
  ├── ORCHESTRATOR_TOOL_DEFINITIONS           —  3 tools
  ├── getContextEngineToolDefinitions()       —  5 tools
  └── getMCPToolDefinitions() (dynamic)       —  N tools (per connected servers)
                                              ────────
                                              80+ static + MCP dynamic
```

### Tool Categories (66 base tools in aiTools.js)

| Category | Tools | Count |
|---|---|---:|
| File Operations | `read_file`, `edit_file`, `create_file`, `delete_file`, `multi_edit`, `list_directory`, `search_files`, `glob_files`, `explore_codebase` | 9 |
| Terminal | `run_command`, `check_terminal`, `list_terminals` | 3 |
| Git | `git_status`, `git_commit`, `git_push`, `git_pull`, `git_diff`, `git_log`, `git_branches`, `git_checkout`, `git_stash`, `git_stage`, `git_unstage`, `git_merge`, `git_reset`, `git_tag`, `git_remotes`, `git_show` | 16 |
| Browser | `browser_navigate`, `browser_screenshot`, `browser_evaluate`, `browser_click`, `browser_type`, `browser_wait`, `browser_console_logs`, `browser_close` | 8 |
| Tasks | `task_add`, `task_update`, `task_list`, `milestone_create` | 4 |
| Memory | `memory_read`, `memory_write`, `memory_append` | 3 |
| Project | `init_project`, `detect_project`, `index_project`, `verify_project`, `get_context_summary` | 5 |
| Agents | `spawn_sub_agent`, `get_agent_status` | 2 |
| Web | `webfetch`, `websearch`, `read_url_content`, `view_content_chunk` | 4 |
| Reasoning | `ask_user_question`, `sequential_thinking`, `trajectory_search`, `find_by_name` | 4 |
| Notebook | `read_notebook`, `edit_notebook` | 2 |
| Deploy | `read_deployment_config`, `deploy_web_app`, `check_deploy_status` | 3 |
| System | `get_system_logs`, `get_changelog` | 2 |
| **Subtotal** | | **66** |

### Additional Tool Modules

| Source | Tools | Count |
|---|---|---:|
| LSP (lsp.js) | `find_symbol`, `find_references`, `list_symbols`, `get_type_info` | 4 |
| Code Index (codeIndex.js) | `semantic_search`, `index_codebase` | 2 |
| Orchestrator (orchestrator.js) | `orchestrate`, `spawn_specialist`, `get_orchestration_status` | 3 |
| Context Engine (contextEngine.js) | `find_implementation`, `impact_analysis`, `prepare_edit_context`, `smart_read`, `batch_search` | 5 |
| MCP (mcp.js) | Dynamic — named `mcp_<server>__<tool>` | N |

### Tool Execution Routing

`executeAnyTool(name, args)` in `index.js` routes by prefix/name:

```
executeAnyTool(name, args)
  ├── name.startsWith('mcp_')       → executeMCPTool()
  ├── LSP tool names                 → executeLSPTool()
  ├── Code index tool names          → executeCodeIndexTool()
  ├── Orchestrator tool names        → executeOrchestratorTool()
  ├── Context engine tool names      → executeContextEngineTool()
  └── default                        → executeTool() (aiTools.js)
```

---

## 6. IPC Architecture

### Channel Counts

| Type | Count | Source |
|---|---:|---|
| `ipcMain.handle` (request/response) | 125 | Across 14 modules |
| `ipcRenderer.invoke` wrappers | 139 | preload.js |
| Event channels (`ipcRenderer.on`) | 25 | preload.js |
| **Total IPC surface** | **~164** | |

### Event Channels (Main → Renderer)

These are push events sent from the main process during AI streaming and tool execution:

| Channel | Purpose |
|---|---|
| `ai-stream-chunk` | Streaming text delta from AI |
| `ai-stream-done` | Stream completion or error |
| `ai-message-break` | Finalize current message bubble, start new one |
| `ai-tool-call` | AI requested a tool call (name + args) |
| `ai-tool-result` | Tool execution result |
| `ai-agent-step` | Sub-agent status update |
| `ai-permission-request` | Tool needs user approval (ask mode) |
| `ai-ask-user` | AI is asking user a structured question |
| `ai-thinking-step` | Sequential thinking / reasoning step |
| `ai-orchestration-start` | Multi-agent orchestration began |
| `ai-orchestration-progress` | Orchestration node completed |
| `ai-orchestration-done` | Orchestration finished |
| `ai-panel-open` | AI requests opening a right panel tab |
| `ai-terminal-session` | Terminal session created by AI |
| `ai-terminal-output` | Terminal output from AI-spawned session |
| `ai-tasks-updated` | Task list changed |
| `ai-file-changed` | File created/edited by AI tool |
| `ai-agent-mode` | Agent mode changed |
| `ai-session-title` | AI-generated session title |
| `terminal-output` | Shell session stdout/stderr |
| `terminal-exit` | Shell session exited |
| `connector-google-result` | Google OAuth result |
| `memory-changed` | Memory file was modified |
| `hook-executed` | Hook was executed |
| `mcp-server-status` | MCP server connected/disconnected |

### IPC Domains (invoke handlers)

| Domain | Channels | Module |
|---|---:|---|
| AI | 4 | index.js |
| Git | 23 | git.js |
| Browser | 11 | browser.js |
| Projects | 9 | projects.js |
| Connectors | 8 | connectors.js |
| MCP | 6 | mcp.js |
| Terminal | 5 | terminal.js |
| Memory | 10 | index.js (delegated to memory.js) |
| Tasks/Milestones | 8 | index.js (delegated to aiTools.js + storage.js) |
| Conversations | 6 | index.js (delegated to storage.js) |
| LSP | 6 | lsp.js |
| Code Index | 4 | codeIndex.js |
| Context Engine | 4 | contextEngine.js |
| Hooks | 3 | hooks.js |
| Commands | 3 | commands.js |
| Compactor | 2 | compactor.js |
| Orchestrator | 2 | orchestrator.js |
| Logger | 3 | logger.js |
| Settings/Agent | 4 | index.js |
| File System | 3 | index.js |
| Attachments | 3 | index.js |
| OAuth | 3 | index.js |
| Misc | 5 | index.js |

---

## 7. Data Flow — User Message to AI Response

```
User types message in ChatView
        │
        v
ChatView.getActiveProvider()
  reads localStorage('onicode-providers')
  finds first enabled+connected provider
        │
        v
window.onicode.sendMessage(messages, providerConfig)
        │
        v (IPC invoke: 'ai-send-message')
        │
index.js handler
  ├── Detects token type:
  │   ├── sk-*         → streamOpenAI()     [/v1/chat/completions]
  │   ├── OAuth JWT    → streamChatGPT()    [/backend-api/codex/responses]
  │   └── Gateway      → streamOpenAI()     [${baseUrl}/v1/chat/completions]
  │
  ├── Pre-retrieval (contextEngine):
  │   preRetrieve(query, projectPath) → context bundle
  │   injected into system prompt
  │
  ├── System prompt built (systemPrompt.ts on renderer,
  │   enriched with pre-retrieved context on main)
  │
  └── SSE streaming begins
        │
        ├── Text deltas → mainWindow.send('ai-stream-chunk', text)
        │                       │
        │                       v
        │               ChatView appends to current message
        │
        ├── Tool call detected → mainWindow.send('ai-tool-call', {name, args})
        │                               │
        │   executeAnyTool(name, args)   │
        │   ├── Permission check         v
        │   ├── Hook pipeline        ChatView renders tool step card
        │   ├── Path sanitization
        │   └── Tool execution
        │           │
        │           v
        │   mainWindow.send('ai-tool-result', {name, result})
        │                               │
        │   Result appended to messages  v
        │   Next streaming round begins  ChatView updates tool step
        │   (agentic loop, up to 75      with result content
        │    rounds)
        │
        └── Stream complete → mainWindow.send('ai-stream-done', null)
                                        │
                                        v
                                ChatView finalizes message,
                                saves to conversation history
```

### Agentic Loop

The AI can make tool calls in a loop (up to 75 rounds per request). Each round:

1. AI returns a tool call (or multiple parallel tool calls)
2. Main process executes tools via `executeAnyTool`
3. Results are appended to the message array
4. A new streaming request is made with the updated messages
5. AI either responds with text (done) or requests more tool calls

Auto-compaction triggers when the token estimate exceeds 50k during the loop.

---

## 8. Storage Layer

### SQLite (`~/.onicode/onicode.db`)

Managed by `storage.js`. WAL mode, foreign keys enabled. Graceful fallback to no-op on failure.

| Table | Purpose | Key Columns |
|---|---|---|
| `tasks` | AI-managed task items | id, session_id, content, status, priority, project_path, milestone_id |
| `milestones` | Sprint/milestone grouping | id, title, description, status, due_date, project_id, project_path |
| `conversations` | Chat history | id, title, messages (JSON), provider, model, created_at, updated_at, project_id |
| `sessions` | AI session metadata | id, started_at, ended_at, project_path, stats (JSON) |
| `attachments` | Project-scoped file attachments | id, project_id, name, type, path, content, conversation_id |

### localStorage (Renderer)

| Key | Purpose |
|---|---|
| `onicode-providers` | AI provider configuration (API keys, enabled state) |
| `onicode-theme` | Active theme name |
| `onicode-conversations` | Legacy conversation storage (migrating to SQLite) |
| `onicode-sidebar-tab` | Last active sidebar tab |
| `onicode-right-panel-*` | Right panel widget states |

### JSON Files (`~/.onicode/`)

| File | Purpose | Module |
|---|---|---|
| `projects.json` | Project registry (name, path, created) | projects.js |
| `hooks.json` | Global hook configuration | hooks.js |
| `connectors.json` | OAuth tokens (GitHub, Google, Slack) | connectors.js |
| `mcp.json` | MCP server definitions | mcp.js |
| `memory/soul.md` | AI personality/identity | memory.js |
| `memory/user.md` | User preferences/context | memory.js |
| `memory/daily/*.md` | Daily interaction logs | memory.js |
| `memory/projects/<id>.md` | Project-scoped memory | memory.js |
| `logs/<date>.log` | Daily structured logs | logger.js |
| `auto-backups/` | Rolling file backups (max 100) | aiTools.js |

### Project-level Config (`.onicode/` in project root)

| File | Purpose |
|---|---|
| `hooks.json` | Project-specific hook overrides |
| `commands/*.md` | Custom slash commands |
| `onidocs/` | Project documentation templates |

---

## 9. Security

### Permission System

Three enforcement modes, configurable per-session:

| Mode | Behavior |
|---|---|
| `auto-allow` | All tools run without confirmation |
| `ask-destructive` | Destructive tools require user approval; read-only tools auto-allow |
| `plan-only` | AI can only plan; all tool execution blocked |

Per-tool permission levels: `allow`, `ask`, `deny`. Configured via Settings UI, synced to main process via `agent-set-mode` IPC.

### Permission Enforcement Pipeline

Every tool call passes through this pipeline in `executeTool()`:

```
Tool call arrives
  │
  ├── 1. checkToolPermission(name, args)
  │      ├── allow → proceed
  │      ├── deny  → return error
  │      └── ask   → send 'ai-permission-request' to renderer
  │                  wait for user approve/deny (60s timeout → auto-allow)
  │
  ├── 2. Path safety check (file tools only)
  │      isPathSafe() checks against BLOCKED_PATHS
  │
  ├── 3. PreToolUse hook — can block any tool
  │
  ├── 4. PreEdit hook — can block file edits
  │
  ├── 5. PreCommand hook — can block commands
  │      └── OnDangerousCommand hook (if dangerous protection enabled)
  │
  ├── 6. PreCommit hook — can block git commits
  │
  └── 7. Tool executes
         │
         ├── PostToolUse hook
         ├── PostEdit hook (file edits)
         ├── PostCommand hook (commands)
         └── PostCommit hook (git commits)
```

### Path Sanitization

File operation tools (`read_file`, `edit_file`, `create_file`, `delete_file`, `multi_edit`) check paths against blocked locations:

| Blocked Path | Reason |
|---|---|
| `~/.ssh/` | SSH keys |
| `~/.gnupg/` | GPG keys |
| `~/.aws/` | AWS credentials |
| `/etc/shadow` | System passwords |
| `/etc/passwd` | System users |

### Dangerous Command Detection

`run_command` tool matches against 14 regex patterns in `hooks.js`:

- `rm -rf`, `rm -f`, `rmdir`
- `git reset --hard`, `git clean -f`, `git push --force`, `git checkout -- .`, `git branch -D`
- SQL `DROP TABLE/DATABASE`, `TRUNCATE TABLE`, `DELETE FROM`
- Fork bombs, `mkfs`, `dd if=`, `chmod -R 777`
- `npm unpublish`
- Pipe-to-shell (`curl ... | bash`)

When a dangerous command is detected and protection is enabled, the `OnDangerousCommand` hook fires and can block execution.

### Auto-Backup

Before every file edit (`edit_file`, `create_file` on existing files), the original file is backed up to `~/.onicode/auto-backups/` with a timestamped filename. A rolling cleanup keeps at most 100 backup files.

---

## 10. AI Provider Routing

### Dual-Mode Streaming

The main process detects the token type and routes to the appropriate API:

| Token Type | API Endpoint | Stream Format | Message Format |
|---|---|---|---|
| `sk-*` API key | `api.openai.com/v1/chat/completions` | SSE: `choices[0].delta.content` | Chat Completions (messages array) |
| OAuth JWT | `chatgpt.com/backend-api/codex/responses` | SSE: `response.output_text.delta` | Responses API (input items) |
| Gateway key | `${baseUrl}/v1/chat/completions` | SSE: `choices[0].delta.content` | Chat Completions (messages array) |

### OAuth PKCE Flow (Codex)

1. Renderer calls `codexOAuthGetAuthUrl` → main generates PKCE verifier+challenge
2. Main opens `auth.openai.com/oauth/authorize` via `shell.openExternal`
3. User completes auth, pastes redirect URL back into app
4. Main calls `codexOAuthExchange` → exchanges code for token via Node.js `https`
5. JWT decoded for `chatgpt_account_id`; token returned to renderer

---

## 11. Theme System

12 themes defined as CSS custom property blocks in `src/chat/styles/index.css`:

Sand, Midnight, Obsidian, Ocean, Aurora, Monokai, Rose Pine, Nord, Catppuccin, Default Light, Default Dark, Neutral

Applied via `data-theme` attribute on `<html>`. Transitions use a 500ms cross-fade via `.theme-transitioning` class. Managed by `useTheme` hook with `localStorage` persistence.

---

## 12. Module Registration Pattern

All main process modules follow the same pattern:

```javascript
// In module (e.g., terminal.js):
function registerTerminalIPC(ipcMain, getWindow) {
    ipcMain.handle('terminal-create', async (_, cwd) => { ... });
    ipcMain.handle('terminal-write', async (_, sid, data) => { ... });
    // ...
}
module.exports = { registerTerminalIPC, ... };

// In index.js:
const { registerTerminalIPC } = require('./terminal');
// After app ready:
registerTerminalIPC(ipcMain, () => mainWindow);
```

This pattern keeps IPC handler registration co-located with the module logic and allows modules to send events to the renderer via the `getWindow()` callback.
