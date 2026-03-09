# Onicode — Changelog

All notable changes to this project will be documented in this file.

---

## [0.4.0] — 2025-03-09

### Project Mode, Question Dialog, Scrollbar Theming, Panel Overhaul

#### Added

- **Project Mode Bar** — Top bar appears when a project is active (via `/init` or `/openproject`), showing project name, git branch, Open/Hand off/Commit actions, and diff stats. Inspired by Cursor/Windsurf project bars. Persisted via `localStorage`.
- **AI Question Dialog** — AI discovery questions now render as an interactive form in the chat with selectable option pills per question, custom text input, and a "Let AI Decide" button. No more plain-text questions.
- **`QuestionDialog` component** (`src/chat/components/QuestionDialog.tsx`) — Parses numbered AI questions with parenthetical options, renders structured form UI.
- **`ProjectModeBar` component** (`src/chat/components/ProjectModeBar.tsx`) — Top bar with project name, branch, Open/Hand off/Commit buttons, diff stats.
- **Project Widget in side panel** — New "Project" tab in the right panel showing active project details (name, path, tech stack, git branch, docs list).
- **Global scrollbar theming** — All scrollbars (sidebar, chat, panels) now use theme CSS variables (`--border`, `--text-tertiary`) via `*::-webkit-scrollbar` rules.
- **`onicode-project-activate` custom event** — Fired by `/init` and `/openproject` to activate project mode across the app.

#### Changed

- **Side panel hidden by default** — Panel starts closed (`widget: null`), only opens when user clicks an icon or AI triggers it. Removed `panelHidden` state and localStorage mode logic.
- **App layout** — `.app` is now `flex-direction: column` to accommodate the project mode bar above the sidebar+content row. New `.app-body` wrapper for the horizontal layout.
- **Widget list** — Added `project` widget type to `WidgetType` union and `WIDGETS` array in `RightPanel.tsx`.
- **System prompt Phase 2** — Now explicitly instructs AI to register the project in Onicode first before coding, to activate project mode.

#### Fixed

- **Scrollbars ignored theme** — Sidebar and main content scrollbars used browser defaults. Now all scrollbars match the active theme.
- **Side panel open by default** — Was always showing terminal on load. Now starts hidden, only opens on demand.

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
