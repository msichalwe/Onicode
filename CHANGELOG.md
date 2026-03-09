# Onicode — Changelog

All notable changes to this project will be documented in this file.

---

## [0.8.0] — 2025-03-09

### Gap Closure: OpenCode/Cascade Parity — New Tools, Context Compaction, Permissions, Agent Modes

#### Added

- **`webfetch` tool** — Fetch and read web page content. Strips HTML to text, follows redirects, 15s timeout. Agent can now look up documentation and API references.
- **`websearch` tool** — Search the web via DuckDuckGo HTML lite (no API key needed). Returns titles, URLs, snippets.
- **`glob_files` tool** — Find files by glob pattern using `git ls-files` (respects .gitignore) or `find` fallback. Sorted by modification time.
- **`explore_codebase` tool** — Fast read-only codebase analysis: project structure, dependencies (package.json parsing), entrypoints detection, config file discovery, tech stack auto-detection (Next.js, React, Vue, Prisma, Tailwind, TypeScript, Python, Go, Rust, etc.).
- **Context compaction** — `compactConversation()` auto-summarizes old messages when conversation exceeds ~80% of estimated token budget. Keeps system prompt + first user message + summary of tools/files + last 10 messages. Wired into agentic loop after round 3.
- **AGENTS.md auto-generation** — `init_project` now creates an `AGENTS.md` file in the project root (like OpenCode's `/init`). Contains project overview, tech stack, directory hints, coding conventions placeholder.
- **Session title auto-generation** — `generateSessionTitle()` fires a lightweight non-streaming AI call on the first user message. Sends `ai-session-title` IPC event to renderer.
- **Permissions system** — `DEFAULT_PERMISSIONS` map with `allow`/`ask`/`deny` per tool. `loadProjectPermissions()` reads `.onicode/config.json` for per-project overrides. `checkPermission()` lookup. IPC handlers: `agent-set-mode`, `agent-get-mode`.
- **Plan agent mode** — `setAgentMode('plan')` denies all write tools (edit_file, create_file, delete_file, multi_edit, init_project), sets run_command to `ask`. `setAgentMode('build')` restores full access.
- **Config file support** — `.onicode/config.json` in project root can override permissions. Read by `loadProjectPermissions()`.
- **Preload bindings** — `agentSetMode()`, `agentGetMode()`, `onAgentMode()`, `onSessionTitle()`.

#### Changed

- **`search_files`** — Now prefers ripgrep (`rg`) which respects .gitignore by default. Falls back to grep with expanded exclusion list (.next, build, coverage).
- **`list_directory`** — Expanded skip list: node_modules, .git, dist, .next, build, coverage, \_\_pycache\_\_, .cache, .turbo.
- **`systemPrompt.ts`** — Added documentation for webfetch, websearch, glob_files, explore_codebase tools.

---

## [0.7.3] — 2025-03-09

### Agentic Loop Auto-Continuation, Tool Step Grouping, No Emojis

#### Fixed

- **Agentic loop stops after init_project + task_add** — The fundamental architecture bug: the model would call `init_project` + `task_add` x5, then respond with text-only ("Starting implementation...") and the loop would exit because `hasToolCalls` was false. **Fixed by adding auto-continuation** (inspired by claude-code/opencode pattern): when the model responds text-only but `TaskManager` has pending tasks, inject a continuation prompt ("You have N pending tasks but have not created any files yet. You MUST call create_file now.") and loop back. Up to 5 auto-continues before giving up.
- **Same fix applied to ChatGPT Responses API backend** — Both `streamOpenAI()` and `streamChatGPTBackend()` now have identical auto-continuation logic.

#### Changed

- **`MAX_TOOL_ROUNDS` increased from 25 to 50** — Supports 10+ minute agentic sessions with many file creates and commands.
- **Tool steps: emojis removed** — Replaced all emoji icons (📄, ✏️, 📝, etc.) with clean text-only display. Tool names shown as "Create File", "Run Command", etc.
- **Tool steps: consecutive calls grouped** — 5x `task_add` now shows as "Task Add (5x) ✓" instead of 5 separate lines. `create_file` and `run_command` are kept ungrouped since their details (filename, command) are important.
- **`index.js`** — `streamOpenAI()` and `streamChatGPTBackend()` track `toolsUsed` set and `autoContinueCount`. Auto-continue injects context-aware continuation prompt based on whether `create_file`/`run_command` have been called yet.
- **`ChatView.tsx`** — `renderToolSteps()` groups consecutive same-name steps into collapsed rows with count badges. No emoji icons.
- **`index.css`** — Removed `.tool-step-icon` class (no longer needed).

---

## [0.7.2] — 2025-03-09

### Compact Chat Top Bar, Anti-Hallucination Fix (init_project + task_add loop)

#### Fixed

- **AI calls init_project + task_add but NEVER creates files** — The model would call `init_project`, add 6 tasks with `task_add`, then respond with "Starting implementation now..." and stop — no `create_file` or `run_command` ever called. Fixed via three-pronged approach:
  1. **`init_project` result** now includes `IMPORTANT_NEXT_STEPS` field explicitly telling the model that no source code exists and it must call `create_file` next.
  2. **`task_add` result** includes `REMINDER` field when tasks exist but none are in-progress, telling the model to start executing with `create_file`/`run_command`.
  3. **System prompt** rewritten with explicit 12-step build sequence showing exactly which tool calls constitute "building" (steps 4-7: `create_file` calls).
- **AI re-initializes project on every "start" message** — Would call `init_project` 3 times, creating 19 duplicate tasks. Fixed: `init_project` now auto-clears stale tasks via `taskManager.clear()`. System prompt adds continuation rules: "start"/"build"/"continue" → call `task_list`, not `init_project`.
- **Tasks accumulate across init attempts** — `TaskManager.clear()` now notifies renderer so UI resets to 0.
- **System prompt referenced `.onidocs/`** — Updated to `onidocs/` (no dot prefix).

#### Changed

- **Chat header → compact top bar** — Replaced centered "Onicode / AI Development Environment" header block with slim single-line bar: brand logo + title left, history + New Chat right. Saves ~60px vertical.
- **`systemPrompt.ts`** — Rewrote "ACT, DON'T TALK" section with specific forbidden patterns. Rewrote Phase 2 with numbered 12-step build sequence. Added continuation rules. Added golden rule: "If you haven't called create_file at least 5 times, you haven't built anything."
- **`aiTools.js`** — `init_project` clears tasks, returns `IMPORTANT_NEXT_STEPS`. `task_add` returns `REMINDER` when no tasks executing. `TaskManager.clear()` notifies renderer.
- **`ChatView.tsx`** — `.chat-header` → `.chat-topbar` with inline brand SVG + actions row.
- **`index.css`** — `.chat-header` → `.chat-topbar` flex row. `.chat-header-actions` → `.chat-topbar-actions`.

---

## [0.7.1] — 2025-03-09

### Bug Fixes: Project Init, Task Sync, Chat Visibility, Tool Timeout

#### Fixed

- **Chat view hidden in project mode** — Replaced `position: absolute/relative` + `visibility` CSS toggling with simple `display: none/flex` for view layers. Eliminates flex layout collapse that hid the chat when entering project mode.
- **init_project creates files in wrong directory** — AI tool was creating onidocs under `.onidocs/` (dot-prefix) but `project-get` IPC reads from `onidocs/` (no dot). Now uses `onidocs/` consistently and creates all standard template files (`architecture.md`, `scope.md`, `changelog.md`, `tasks.md`, `README.md`).
- **Project files not showing in Projects view** — `project-get` IPC now checks both `onidocs/` and `.onidocs/` paths for backwards compatibility.
- **Tasks not syncing to project sidebar** — `TaskManager` was in-memory only with no renderer communication. Now sends `ai-tasks-updated` IPC events on every add/update, with a new `tasks-list` IPC handler for initial load.
- **Long-running tools timing out** — `run_command` default timeout increased from 30s to 120s. Prevents `npm install`, `npx create-next-app`, and similar commands from being killed prematurely.

#### Added

- **Real-time task display in ProjectWidget** — Right panel PROJECT widget now shows task progress bar (done/total with percentage) and a scrollable task list with status icons (✓ done, ▶ in-progress, ○ pending) and priority indicators (red left-border for high).
- **Task IPC bindings** — `tasksList()` and `onTasksUpdated()` preload bindings. TypeScript `TaskItem` and `TaskSummary` global types.

#### Changed

- **`aiTools.js`** — `TaskManager._notifyRenderer()` pushes summary to renderer on every mutation. `init_project` creates `onidocs/` (no dot), `src/`, `README.md`, and 4 template docs matching `project-init` IPC.
- **`projects.js`** — `project-get` handler checks both `onidocs/` and `.onidocs/` directories.
- **`index.js`** — Imports `taskManager`, registers `tasks-list` IPC handler.
- **`preload.js`** — Added `tasksList` and `onTasksUpdated` bindings.
- **`window.d.ts`** — Added `TaskItem`, `TaskSummary` global interfaces and IPC method types.
- **`RightPanel.tsx`** — `ProjectWidget` fetches tasks on mount, subscribes to real-time updates, renders progress bar and task list.
- **`index.css`** — View layers use `display: none/flex`. Added task progress bar, task list, status icon, and priority CSS.

---

## [0.7.0] — 2025-03-09

### Chat Scoping, Persistent AI Streaming, Project Switcher, Exit Warning

#### Fixed

- **AI streaming survives tab switches** — `ChatView` is now always mounted (hidden via CSS `display: none`) instead of unmounted/remounted on sidebar navigation. Streaming, tool execution, and chat state persist across tab changes.
- **Project mode bar overlap** — Added `padding-top: calc(var(--titlebar-height) + 6px)` and `z-index: 50` so the project bar sits correctly below the native titlebar drag region without being obscured by window controls.

#### Added

- **Project dropdown switcher** — Click the project name in the project mode bar to open a dropdown listing all available projects. Switch between projects or exit project mode directly from the dropdown.
- **Chat scoping** — Chats are now scoped to `general`, `project`, or `documents`. A colored scope tag appears above the input area showing the current scope (blue for project, purple for documents). Scope is persisted per conversation in localStorage.
- **Exit project warning dialog** — Closing project mode now shows a confirmation dialog warning that a new general chat will start, with Cancel/Exit buttons.
- **Scoped new chat** — Starting a new chat within a scoped mode inherits that scope. Exiting scope returns to general mode. Multiple project-scoped and general chats can coexist.
- **`onicode-new-chat` event** — External signal for triggering new chat from App-level actions (project switch, exit project mode).

#### Changed

- **`App.tsx`** — Exports `ChatScope` and `View` types. ChatView always mounted in a `view-layer` div. Added `chatScope`, `showExitWarning` state. Project activation auto-sets scope to `project`. New callbacks: `requestExitProject`, `confirmExitProject`, `switchProject`, `changeChatScope`.
- **`ProjectModeBar.tsx`** — Added `onSwitchProject` prop, project list dropdown with outside-click dismiss, "Exit Project Mode" option in dropdown.
- **`ChatView.tsx`** — Accepts `scope`, `activeProject`, `onChangeScope` props. Conversations store `scope`, `projectId`, `projectName`. Input placeholder changes based on scope. Hidden file input uses CSS class instead of inline style.

---

## [0.6.0] — 2025-03-09

### Task-Driven Agent Loop, Puppeteer Browser Testing, System Logger, Auto-Changelog

#### Added

- **System Logger** (`src/main/logger.js`) — Centralized structured logging for all AI actions, tool calls, command outputs, and errors. Persists daily `.jsonl` logs to `~/.onicode/logs/`. In-memory ring buffer (500 entries) with level filtering (DEBUG/INFO/TOOL/CMD/WARN/ERROR).
- **Puppeteer Browser Automation** (`src/main/browser.js`) — Headless browser for testing web apps the AI creates. Tools: `browser_navigate`, `browser_screenshot`, `browser_evaluate`, `browser_click`, `browser_type`, `browser_console_logs`, `browser_close`. Console logs, page errors, and request failures captured automatically.
- **Task Manager** — Built-in task management system for the AI agent loop. Tools: `task_add`, `task_update`, `task_list`, `task_clear`. AI creates a task list before work, executes one-by-one, checks completion, loops until done.
- **Auto-Changelog** — `get_changelog()` tool generates markdown changelog from tracked file changes (created, modified, deleted with line counts).
- **`get_system_logs` tool** — AI can query its own system logs to debug issues (filter by level, category, limit).
- **Enhanced `FileContextTracker`** — Now tracks line-level additions/deletions per file, maintains ordered changelog of all file operations, and generates auto-changelog markdown.

#### Changed

- **System prompt overhaul** — Complete rewrite of AI workflow instructions:
  - Task-driven agent loop: PLAN → EXECUTE → CHECK → DONE cycle
  - Mandatory browser testing for web projects (navigate, check console, screenshot)
  - Auto-changelog instructions (append to `.onidocs/changelog.md`)
  - Enhanced error recovery with `get_system_logs` integration
  - Full tools reference updated with all new tools
- **Agentic loops** — Both `streamOpenAI` and `streamChatGPTBackend` now use structured `logger.toolCall` / `logger.toolResult` logging instead of raw `console.log`.
- **`run_command` tool** — Now logs execution via `logger.cmdExec` with duration tracking.
- **`create_file` tool** — Now passes content to `trackCreate` for accurate line counting in changelog.

---

## [0.5.0] — 2025-03-09

### Memory System, Onboarding, Agent Loop, /init Enforcement

#### Added

- **Memory System (OpenClaw-inspired)** — Persistent AI memory stored in `~/.onicode/memories/`:
  - `soul.md` — AI personality & behavior rules (always injected into system prompt)
  - `user.md` — User preferences, name, coding style (always injected)
  - `MEMORY.md` — Curated long-term memory (durable facts, decisions)
  - `YYYY-MM-DD.md` — Daily append-only session logs (today + yesterday loaded)
- **Memories sidebar tab** — New "Memory" view in sidebar with card UI for core memories and daily logs. View, edit, create, delete memory files.
- **First-launch onboarding** — If `user.md` doesn't exist on startup, shows a modal dialog asking 4 questions (name, language, framework, code style). Saves to `user.md`. Skippable.
- **`init_project` AI tool** — AI can now directly call `init_project` as a tool function (not just slash command). Registers project in Projects tab, creates `.onidocs/`, fires `onicode-project-activate` event to activate project mode bar.
- **`memory_write` / `memory_append` AI tools** — AI can persist durable facts and session notes to memory files.
- **Memory injection** — Core memories (soul.md, user.md, MEMORY.md, daily logs) are loaded and injected into the system prompt on every AI request.
- **Memory compaction** — Heuristic compaction of older conversation messages, saving summaries to daily logs.
- **Agent loop error recovery** — System prompt now instructs AI to read errors, fix and retry (up to 3 attempts), with diagnostic hints for ENOENT/EACCES errors in `run_command`.
- **Memory IPC handlers** — Full CRUD for memory files: `memory-load-core`, `memory-ensure-defaults`, `memory-save-onboarding`, `memory-read`, `memory-write`, `memory-append`, `memory-list`, `memory-delete`, `memory-compact`.

#### Changed

- **System prompt Phase 2** — `init_project` is now **MANDATORY step 1** before any other tool call when creating a project. Explicit warning that skipping it means the project won't appear in Projects tab.
- **`run_command` error responses** — Now include `error_code`, `recoverable` flag, and `suggestion` string for common failures (ENOENT, EACCES).
- **Sidebar** — Added "Memory" button between Docs and Settings.

#### Fixed

- **AI skipped `/init` when creating projects** — Projects weren't registered in Projects tab. Now enforced via dedicated `init_project` tool + mandatory system prompt instruction.

---

## [0.4.0] — 2025-03-09

### Project Mode, Question Dialog, Scrollbar Theming, Panel Overhaul

#### Added

- **Project Mode Bar** — Top bar appears when a project is active (via `/init` or `/openproject`), showing project name, git branch, Open/Hand off/Commit actions, and diff stats.
- **AI Question Dialog** — AI discovery questions rendered as interactive form with selectable option pills, custom text input, and "Let AI Decide" button.
- **Project Widget in side panel** — New "Project" tab showing active project details.
- **Global scrollbar theming** — All scrollbars use theme CSS variables.
- **`onicode-project-activate` custom event** — Fired by `/init` and `/openproject`.

#### Changed

- **Side panel hidden by default** — Panel starts closed, only opens on demand.
- **App layout** — Column layout for project mode bar + horizontal layout for sidebar+content.

#### Fixed

- **Scrollbars ignored theme** — Now all scrollbars match the active theme.
- **Side panel open by default** — Now starts hidden.

---

## [0.3.3] — 2025-03-09

### AI Question Generator, /openproject, Attachment Overhaul

#### Added

- **`/openproject <path>` command** — Scans an existing project folder, auto-detects tech stack and git, creates `.onidocs/` if missing, registers in project list.
- **AI Question Generator** — System prompt instructs AI to ask up to 5 discovery questions before project creation. Skippable.
- **"ACT, DON'T TALK" enforcement** — System prompt rewritten with explicit forbidden/required patterns.
- **File attachment content reading** — Attached text/code files read via FileReader, content sent to AI in code blocks.

#### Changed

- `sendToAI` accepts `currentAttachments` parameter for rich attachment context.
- Attachment context format: filenames → full file content in fenced code blocks.

#### Fixed

- Attachment handling only sent filenames to AI, not content.

---

## [0.3.2] — 2025-03-09

### Real-Time Terminal Output, Panel Collapse, Project System Integration

#### Fixed

- **AI commands invisible in terminal** — Rewrote `run_command` from `exec()` to `spawn()`, streaming stdout/stderr to the terminal widget in real-time via new `ai-terminal-output` IPC event
- **Side panel missing collapse/retract button** — Added collapse/expand toggle with chevron icon; collapsed state shows only icon tabs in a narrow 48px sidebar
- **AI not using project system** — When asked to "create an app", AI would create files in the IDE source tree instead of using Onicode's project system (onidocs, kanban, etc.)
- **Sidebar View type mismatch** — Added `'todo'` to Sidebar's `View` type to match App.tsx

#### Added

- **`ai-terminal-output` IPC event** — Streams real-time command output (prompt, stdout, stderr, exit status) from `spawn()` to the terminal widget
- **Project Creation Protocol in system prompt** — AI now MUST create projects under `~/Documents/OniProjects/` with `.onidocs/` (project.md, tasks.md, changelog.md), git init, and proper config files
- **Panel collapse/retract** — `right-panel-collapsed` CSS class with vertical tab layout
- **ANSI strip helper** — `stripAnsi()` in RightPanel.tsx for clean terminal output display

#### Changed

- Default `/init` project directory: `~/Projects` → `~/Documents/OniProjects`
- `run_command` tool: `exec()` → `spawn()` with real-time output streaming + timeout handling
- Terminal widget shows command prompts (`❯ command`), live output, and exit status (`✓ exit 0` / `✗ exit N`)

---

## [0.3.1] — 2025-03-10

### Bugfixes: /init, AI Tool Usage, Terminal Auto-Open & Session Tracking

#### Fixed

- **`/init` command broken** — `process.env.HOME` is undefined in sandboxed renderer; moved `~` path expansion to main process (`projects.js`) where `os.homedir()` works
- **AI not using tools** — `streamChatGPTBackend` (Codex OAuth / Responses API) had zero tool support; rewrote with full agentic tool-calling loop (`streamChatGPTSingle` + agentic wrapper) supporting all 14 tools
- **Tool definitions format** — Added `toResponsesAPITools()` converter to flatten Chat Completions tool format to Responses API format

#### Added

- **Terminal auto-open** — When AI calls `run_command`, the terminal panel auto-opens via `ai-panel-open` IPC event
- **Terminal session tracking** — Cascade-like AI command history in terminal panel:
  - Shows command, status (spinner/✓/✗), duration, exit code
  - Collapsible session list with live "Running" indicator
  - Sessions tracked in `aiTools.js` and streamed to renderer via `ai-terminal-session` IPC event
- **New IPC events**: `ai-panel-open`, `ai-terminal-session`
- **`setMainWindow()`** in `aiTools.js` — allows tool executor to send IPC events to renderer
- **`getTerminalSessions()`** — retrieve AI command history

#### Changed

- `streamChatGPTBackend` → full agentic loop (was text-only streaming)
- `TerminalWidget` wrapped in `widget-terminal-container` with session tracking panel
- Terminal input now has `title` and `placeholder` attributes (accessibility)

---

## [0.3.0] — 2025-03-10

### Phase 2: Cascade-Like Agentic AI Engine

#### Added

- **Agentic Tool-Calling Loop** (`src/main/index.js`)
  - Replaced simple text-streaming `streamOpenAI` with full agentic loop (`streamOpenAISingle` + `streamOpenAI`)
  - AI can now call tools iteratively (up to 25 rounds) — read files, edit files, run commands, search, etc.
  - Streams text content to renderer in real-time while accumulating tool calls
  - Sends `ai-tool-call`, `ai-tool-result`, `ai-agent-step` IPC events to renderer
  - Increased `max_tokens` to 16384 for larger code generation

- **AI Tool System** (`src/main/aiTools.js`) — 14 tools:
  - **File Operations**: `read_file` (with line ranges), `edit_file` (find-and-replace), `multi_edit`, `create_file`, `delete_file`
  - **Search & Navigate**: `list_directory` (recursive, hidden files), `search_files` (grep with patterns)
  - **Terminal**: `run_command` (with cwd, timeout, stdout/stderr capture)
  - **Restore Points**: `create_restore_point`, `restore_to_point`, `list_restore_points` — file-level snapshots stored at `~/.onicode/restore-points/`
  - **Context Tracking**: `get_context_summary` — tracks files read/modified/created/deleted per session
  - **Sub-Agents**: `spawn_sub_agent`, `get_agent_status` — agent spawning and tracking infrastructure

- **File Context Tracker** (in `aiTools.js`)
  - Tracks all file reads, edits, creates, and deletes during a session
  - Provides summary to system prompt so AI knows what it's already touched

- **Restore Point Manager** (in `aiTools.js`)
  - Creates file-level snapshots before big changes
  - Stores backups with manifest at `~/.onicode/restore-points/<id>/`
  - List, restore, and delete restore points

- **Enhanced System Prompt** (`src/chat/ai/systemPrompt.ts`)
  - Full Cascade-like instructions: THINK → ACT → VERIFY → REPORT protocol
  - Edit Protocol: read before edit, exact string matching, restore points before refactors
  - Complete tool reference with parameters
  - File context summary injection
  - Slash command awareness

- **Tool Steps UI** (`ChatView.tsx`)
  - Real-time tool call visualization during AI execution
  - Each tool step shows: icon, name, file/command detail, spinner (running) / checkmark (done)
  - Error display for failed tools
  - Tool steps attached to completed messages for history
  - Active tool steps shown during streaming

- **CSS for Tool Steps** (`index.css`)
  - `.tool-steps` container with step rows, icons, status indicators
  - Animated spinner for running tools
  - Green checkmark for completed, red X for errors

- **IPC Events** (preload.js + window.d.ts)
  - `onToolCall` — notifies renderer when AI calls a tool
  - `onToolResult` — notifies renderer with tool execution result
  - `onAgentStep` — notifies renderer of agentic round progress

- **New Command**: `/git [status|log|branches]` added to registry

#### Changed

- `streamOpenAI` is now an agentic loop wrapper around `streamOpenAISingle`
- System prompt is now ~3x larger with full tool documentation
- `Message` type now includes optional `toolSteps` array
- Streaming UI shows tool steps alongside text content

---

## [0.2.0] — 2025-03-10

### Phase 1.9: Git Integration + Project Management + Connectors

#### Added

- **Git Integration (Full Backend + UI)**
  - `git.js` — IPC handlers for 15 git operations: `is-repo`, `init`, `status`, `branches`, `log`, `diff`, `stage`, `unstage`, `commit`, `checkout`, `stash`, `remotes`, `pull`, `push`, `show`
  - Wired `git.js` into `index.js`, `preload.js`, and `window.d.ts` with full TypeScript types (`GitStatusFile`, `GitBranch`, `GitCommit`, `GitRemote`)
  - **Git Tab** in ProjectsView — three sub-tabs:
    - **Changes**: staged/unstaged file list with status badges (M/A/D/?/R/C/U), inline stage/unstage buttons, commit box, diff viewer
    - **Branches**: local + remote branch list, create new branch, checkout with one click, current branch indicator
    - **History**: commit log with timeline UI (dot + line), short hash, author, date
  - Branch info bar with ahead/behind badges, pull/push/refresh buttons
  - "Initialize Git Repo" button for non-git project paths

- **Project Management Tabs**
  - **Tasks / Kanban Board**: 4-column drag-and-drop kanban (Backlog → To Do → In Progress → Done)
    - Create tasks with title, description, type (Task/User Story/Bug), priority (Critical/High/Medium/Low)
    - Priority color dots, type icons, drag-to-move between columns
    - localStorage persistence per project
  - **Milestones Tab**: create milestones with title, description, optional due date
    - Open/closed toggle, overall progress bar from task completion
    - localStorage persistence per project

- **Connectors (OAuth, No Manual API Keys)**
  - `connectors.js` — connector OAuth backend with persistent storage at `~/.onicode/connectors.json`
  - **GitHub**: Device Flow OAuth (no client secret needed) — user gets a code, enters it on github.com, app polls for token
  - **Gmail**: Google OAuth 2.0 with PKCE + localhost redirect server on port 1456 — opens browser, captures callback automatically
  - Connector list/get/disconnect IPC handlers
  - Full preload + window.d.ts wiring for all connector methods

- **Settings Panel (Functional Connectors)**
  - GitHub connector: shows device code during auth, "Connected as @username" when done, disconnect button
  - Gmail connector: opens Google consent screen in browser, shows email when connected, disconnect button
  - Slack connector: placeholder (coming soon)

- **CSS Styles** (~600 lines added)
  - Project tabs navigation
  - Git tab: header, sub-tabs, file rows with status badges, commit box, diff viewer, branch list, commit log timeline
  - Kanban board: 4-column grid, draggable cards, priority dots, type icons
  - Milestones: card layout, circular check/uncheck buttons, progress display
  - Connector items: colored icons (GH dark, Gm red, Sl purple), connect/disconnect buttons, device code display

#### Fixed

- `ChatView.tsx` — confirmed `handleSend`, `handleKeyDown`, `handleSuggestionClick` are intact (no fix needed, documentation was stale)
- Accessibility: added `title` attributes to buttons and select elements in ProjectsView
- Replaced inline styles with CSS classes (`connector-error`, `connector-device-code`)

---

## [0.1.0] — 2025-03-09

### Phase 1: Chat Shell + Core Infrastructure

#### Added

- **Electron App Scaffold**
  - Electron 34 main process with BrowserWindow, IPC handlers, dev port auto-retry (5173–5180)
  - React 19 + Vite 6 chat shell renderer with TypeScript
  - `contextBridge` preload script exposing `window.onicode` API
  - `window.d.ts` type definitions for full IPC surface

- **AI Chat (Streaming)**
  - Streaming AI responses via main process IPC (no CORS issues)
  - Dual-mode routing: standard `sk-` API keys → OpenAI `/v1/chat/completions`, OAuth JWT tokens → ChatGPT `backend-api/codex/responses` (Responses API format)
  - SSE parsing for both `response.output_text.delta` (Responses API) and `choices[0].delta.content` (Chat Completions)
  - Required headers for ChatGPT backend: `chatgpt-account-id`, `OpenAI-Beta: responses=experimental`, `originator: codex_cli_rs`
  - Electron `net.fetch` for TLS-safe requests from main process
  - Abort support for in-flight requests (both `AbortController` and `request.destroy()`)

- **Codex OAuth PKCE Flow**
  - Full PKCE OAuth flow handled in main process
  - Generates verifier + challenge, opens `auth.openai.com/oauth/authorize` via `shell.openExternal`
  - Paste-redirect flow: user copies localhost callback URL back to app
  - Token exchange via Node.js `https` (server-side, no CORS)
  - JWT decode to extract `chatgpt_account_id` for API calls
  - Fallback renderer-side PKCE for browser-only dev mode

- **AI Provider Settings** (`ProviderSettings.tsx`)
  - OpenAI Codex provider (GPT-5.x, GPT-4o, o4-mini, o3-pro models)
  - OniAI Gateway provider (self-hosted, URL + key)
  - OpenClaw Gateway provider (multi-model, URL + key)
  - Test Connection via main process IPC (avoids CORS)
  - Provider persistence in `localStorage` under `onicode-providers`

- **4 Premium Themes**
  - Oni Sand (light, warm — default)
  - Oni Midnight (dark, golden accents)
  - Oni Obsidian (OLED dark, copper accents)
  - Oni Ocean (cool, teal accents)
  - CSS custom properties system in single `index.css`
  - `useTheme` hook with `ThemeContext`, `localStorage` persistence
  - 500ms cross-fade transitions via `.theme-transitioning` class

- **Sidebar Navigation** (`Sidebar.tsx`)
  - Chat, Projects, Documents, Settings views
  - Inline SVG icons, active state highlighting
  - macOS traffic light positioning

- **Chat UI** (`ChatView.tsx`)
  - Message bubbles with markdown rendering (code blocks, inline code)
  - Conversation history with `localStorage` persistence
  - Conversation list with load/delete/new operations
  - File and URL attachments system
  - Slash command autocomplete menu with arrow/tab navigation
  - `sendingRef` guard against React 18 StrictMode double-invoke
  - Welcome screen with suggestion chips

- **Slash Command System** (`commands/registry.ts`, `commands/executor.ts`)
  - 20 commands across 6 categories: chat, ai, project, terminal, panel, system
  - `/new`, `/clear` — conversation management
  - `/chathistory` — browse past conversations
  - `/export` — export chat as markdown
  - `/model <name>` — switch AI model on the fly
  - `/system <prompt>` — set custom system prompt
  - `/context` — show current AI context (provider, model, messages, environment)
  - `/stop` — abort AI generation
  - `/agents` — list available AI agents
  - `/init <name> [path]` — create project with onidocs
  - `/projects` — list all projects
  - `/open <editor>` — open project in VS Code/Cursor/Windsurf/Finder
  - `/status` — system status overview
  - `/run <command>` — execute terminal command
  - `/terminal` — open terminal panel
  - `/browser [url]` — open browser panel
  - `/files [path]` — open file viewer panel
  - `/help` — show all commands
  - `/version` — show version info

- **AI System Prompt Builder** (`ai/systemPrompt.ts`)
  - Context-aware prompt including all slash commands, terminal capabilities, project management
  - Active project context injection (name, path, docs)
  - Custom system prompt support
  - Output guidelines for consistent AI responses

- **Terminal System** (`src/main/terminal.js`)
  - Real shell sessions via `child_process.spawn` (`/bin/zsh -l`)
  - Session lifecycle: create, write, kill, status
  - Streaming stdout/stderr via IPC events
  - One-shot command execution (`terminal-exec`) for AI `/run` usage with 30s timeout
  - Cleanup on app quit (`killAllSessions`)

- **Terminal Widget** (in `RightPanel.tsx`)
  - Real shell integration via IPC
  - Command history with arrow key navigation
  - Auto-scroll on new output
  - Session lifecycle management

- **Project System** (`src/main/projects.js`)
  - Project metadata stored in `~/.onicode/projects.json`
  - `/init` creates project folder with `onidocs/` subdirectory
  - Template files: `architecture.md`, `scope.md`, `changelog.md`, `tasks.md`, `README.md`
  - CRUD operations: init, list, get (with docs), delete
  - Open in external editors: VS Code, Cursor, Windsurf, Finder
  - File system operations: `readDir` (recursive, filtered), `readFile`, `writeFile`

- **Projects View** (`ProjectsView.tsx`)
  - Left sidebar with project list cards and new project form
  - Right detail panel with project header, description, metadata
  - "Open in" dropdown menu (VS Code, Cursor, Windsurf, Finder)
  - Doc cards grid for onidocs files
  - File tree display (recursive, directories first)
  - Doc viewer for reading markdown content

- **Documents View** (`DocsView.tsx`)
  - Aggregates all project docs from onidocs/ folders
  - Groups by project with expandable sections
  - Doc viewer for reading content
  - Empty state with `/init` suggestion

- **Right Panel System** (`RightPanel.tsx`)
  - Widget kernel with tab switching
  - Terminal widget (real shell)
  - File viewer widget (directory tree via IPC)
  - Browser widget (URL bar placeholder)
  - PDF, Image, Camera widget placeholders
  - Panel slide-in animation
  - Cross-component panel communication via `onicode-panel` custom events

- **Settings Panel** (`SettingsPanel.tsx`)
  - Theme picker with visual preview grid
  - AI Providers section (delegates to `ProviderSettings`)
  - Connectors section (GitHub, Gmail, Slack — placeholder items)
  - API Key Store section (Global Key Vault — placeholder)

- **Git Backend** (`src/main/git.js`)
  - Full IPC handlers for git operations via `child_process.execSync`
  - `git-is-repo` — check if path is a git repository
  - `git-init` — initialize new repo
  - `git-status` — parsed status (branch, files, staged/unstaged, ahead/behind)
  - `git-branches` — list local and remote branches
  - `git-log` — recent commits with hash, author, timestamp, message
  - `git-diff` — file diffs (staged and unstaged)
  - `git-stage` / `git-unstage` — stage/unstage files
  - `git-commit` — commit with message
  - `git-checkout` — switch/create branches
  - `git-stash` — push, pop, list stash entries
  - `git-remotes` — list remote URLs
  - `git-pull` / `git-push` — sync with remote
  - `git-show` — show file at specific commit
  - **Note:** Created but NOT yet wired into `index.js`, `preload.js`, or `window.d.ts`

#### Fixed

- **403 on ChatGPT backend `/me` endpoint** — Removed HTTP call; now validates JWT structure locally (checks account ID, checks expiration)
- **"socket hang up" on ChatGPT requests** — Switched from raw `https.request` to Electron `net.fetch` for proper TLS handling
- **"Instructions are required" from Responses API** — Added `instructions` field, `store: false`, restructured body to Responses API format
- **Duplicate messages ("HiHi!! 👋 👋")** — Root cause: React 18 StrictMode double-invoking setState updater containing `sendToAI()`. Fixed with `sendingRef` guard
- **Port conflict (5173 in use)** — Added `did-fail-load` listener that auto-retries ports 5173–5180
- **package.json main entry** — Changed from `dist/main/index.js` to `src/main/index.js` for dev mode

### Known Issues

- **ChatView.tsx is broken** — `handleSend`, `handleKeyDown`, and `handleSuggestionClick` functions were removed during a refactoring pass (fixing TypeScript declaration ordering) but NOT re-added. The file won't compile until these are restored after `handleCommand`.
- **git.js not wired** — Backend IPC handlers exist but need registration in `index.js`, exposure in `preload.js`, types in `window.d.ts`, and frontend UI.
- **Connectors are placeholder** — GitHub, Gmail, Slack listed in Settings but have no functionality.
- **API Key Store is placeholder** — UI shell only, no encryption or storage logic.
- **No SQLite persistence** — Conversations stored in `localStorage` only.
- **No git repo initialized** — The Onicode project itself doesn't have `git init` run yet.

---

## [Unreleased] — Phase 1.9

### Planned

- Wire git.js into full stack (index.js → preload.js → window.d.ts → UI)
- Git integration UI in Projects tab (status, branches, commits, diffs, staging)
- Project management tabs (user stories, milestones, kanban boards)
- GitHub connector via GitHub OAuth (no manual PAT generation)
- Gmail connector via Google OAuth 2.0 (no manual API key)
- Slack connector via Slack OAuth

---

## [Future] — Phase 2+

### Planned

- AI Engine: model router, context engine, agent orchestrator
- Editor Shell: VS Code workbench (lazy-loaded)
- Anthropic provider (Claude)
- Ollama provider (local models)
- SQLite conversation persistence
- AES-256 API Key Vault with OS keychain integration
- Inline code completions
- Skills system
- Multi-agent cascade
- Mobile companion app (React Native)
