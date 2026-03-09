# Onicode — Changelog

All notable changes to this project will be documented in this file.

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
