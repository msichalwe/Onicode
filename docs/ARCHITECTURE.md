# Onicode — Architecture

> **Last updated:** 2025-03-09 — reflects the actual implemented state.

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                     Onicode Desktop (Electron 34)                 │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                  Chat Shell (React 19 + Vite 6)           │    │
│  │                                                          │    │
│  │  ┌───────────┐  ┌──────────────┐  ┌──────────────────┐  │    │
│  │  │  Sidebar   │  │  Main View   │  │   Right Panel    │  │    │
│  │  │           │  │              │  │                  │  │    │
│  │  │ • Chat    │  │ • ChatView   │  │ • Terminal       │  │    │
│  │  │ • Projects│  │ • Projects   │  │ • File Viewer    │  │    │
│  │  │ • Docs    │  │ • Documents  │  │ • Browser        │  │    │
│  │  │ • Settings│  │ • Settings   │  │ • PDF/Image/etc  │  │    │
│  │  └───────────┘  └──────────────┘  └──────────────────┘  │    │
│  │                                                          │    │
│  │  ┌──────────────────────────────────────────────────┐    │    │
│  │  │  Command System (registry + executor)            │    │    │
│  │  │  20 slash commands across 6 categories           │    │    │
│  │  └──────────────────────────────────────────────────┘    │    │
│  └───────────────────────────┬──────────────────────────────┘    │
│                              │ IPC (contextBridge)               │
│  ┌───────────────────────────▼──────────────────────────────┐    │
│  │              Main Process (Node.js / CommonJS)            │    │
│  │                                                          │    │
│  │  index.js ─── AI Chat (streaming, dual-mode routing)     │    │
│  │           ├── Codex OAuth PKCE flow                      │    │
│  │           ├── Test Provider connection                    │    │
│  │           └── App lifecycle                               │    │
│  │                                                          │    │
│  │  terminal.js ─ Shell session management (spawn, IPC)     │    │
│  │  projects.js ─ Project CRUD + onidocs + filesystem ops   │    │
│  │  git.js ───── Git operations (status, branch, commit..)  │    │
│  │               [created, not yet wired]                    │    │
│  │                                                          │    │
│  │  preload.js ── contextBridge → window.onicode API        │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │              Provider Layer (Implemented)                  │    │
│  │  OpenAI Codex (sk- keys + ChatGPT OAuth JWT)             │    │
│  │  OniAI Gateway (self-hosted URL + key)                    │    │
│  │  OpenClaw Gateway (multi-model URL + key)                 │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │              Future (Not Yet Implemented)                  │    │
│  │  Editor Shell │ AI Engine │ Key Vault │ Connectors        │    │
│  │  Anthropic    │ Ollama    │ Mobile    │ SQLite             │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

## Directory Structure (Actual)

```
onicode/
├── CHANGELOG.md                   # Version history
├── CLAUDE.md                      # AI assistant context file
├── docs/                          # Documentation (you are here)
│   ├── README.md                  # Docs index
│   ├── PRODUCT_VISION.md          # What Onicode is and why
│   ├── ARCHITECTURE.md            # This file
│   ├── ROADMAP.md                 # Phased development plan
│   ├── AI_ENGINE.md               # AI engine design (future)
│   ├── CONNECTORS.md              # Connector system design (future)
│   ├── API_KEY_STORE.md           # Key vault design (future)
│   ├── THEMING.md                 # Theme system
│   └── MOBILE_APP.md              # Mobile companion (future)
│
├── src/
│   ├── main/                      # Electron main process (CommonJS .js)
│   │   ├── index.js               # App entry, BrowserWindow, all core IPC:
│   │   │                          #   AI chat (streaming, dual-mode routing)
│   │   │                          #   Codex OAuth PKCE, test provider
│   │   │                          #   JWT decode, PKCE helpers
│   │   ├── preload.js             # contextBridge → window.onicode API
│   │   ├── terminal.js            # Shell session management via IPC
│   │   ├── projects.js            # Project CRUD, onidocs, filesystem ops
│   │   └── git.js                 # Git operations via IPC (NOT WIRED YET)
│   │
│   ├── chat/                      # Chat Shell (React 19, TypeScript)
│   │   ├── main.tsx               # ReactDOM entry point
│   │   ├── App.tsx                # Root component, view routing, ThemeProvider
│   │   ├── components/
│   │   │   ├── ChatView.tsx       # Chat UI, streaming, history, attachments,
│   │   │   │                      # slash command autocomplete, message rendering
│   │   │   ├── Sidebar.tsx        # Left nav (Chat, Projects, Docs, Settings)
│   │   │   ├── SettingsPanel.tsx   # Theme picker, providers, connectors, key store
│   │   │   ├── ProviderSettings.tsx # AI provider config, Codex OAuth, test connection
│   │   │   ├── RightPanel.tsx     # Widget panel: terminal, files, browser, etc.
│   │   │   ├── ProjectsView.tsx   # Project list, detail, file tree, docs, "Open in"
│   │   │   └── DocsView.tsx       # Aggregated docs from all projects' onidocs/
│   │   ├── commands/
│   │   │   ├── registry.ts        # Slash command definitions (20 commands)
│   │   │   └── executor.ts        # Slash command execution logic
│   │   ├── ai/
│   │   │   └── systemPrompt.ts    # Context-aware system prompt builder
│   │   ├── hooks/
│   │   │   └── useTheme.tsx       # ThemeContext, localStorage persistence
│   │   ├── types/
│   │   │   └── window.d.ts        # TypeScript types for window.onicode API
│   │   └── styles/
│   │       └── index.css          # All CSS: reset, 4 themes, layout, components
│   │
│   └── editor/                    # Editor Shell (NOT YET IMPLEMENTED)
│
├── resources/                     # Icons, splash screens, assets
├── package.json                   # npm dependencies, build scripts
├── tsconfig.json                  # Chat Shell TypeScript config
├── tsconfig.electron.json         # Main process TypeScript config
├── vite.config.ts                 # Vite configuration
└── index.html                     # Vite entry HTML
```

## IPC Architecture

All renderer ↔ main communication goes through `contextBridge` (`preload.js` → `window.onicode`).

### Registered IPC Channels

| Channel                    | Type   | Direction       | Module      | Description                       |
| -------------------------- | ------ | --------------- | ----------- | --------------------------------- |
| `get-app-info`             | invoke | renderer → main | index.js    | App name, version, platform       |
| `get-theme` / `set-theme`  | invoke | renderer → main | index.js    | Theme stub (actual: localStorage) |
| `ai-send-message`          | invoke | renderer → main | index.js    | Send messages + provider config   |
| `ai-stream-chunk`          | event  | main → renderer | index.js    | Streaming SSE delta text          |
| `ai-stream-done`           | event  | main → renderer | index.js    | Stream complete (null or error)   |
| `ai-abort`                 | invoke | renderer → main | index.js    | Abort in-flight AI request        |
| `codex-oauth-get-auth-url` | invoke | renderer → main | index.js    | Start PKCE OAuth, open browser    |
| `codex-oauth-exchange`     | invoke | renderer → main | index.js    | Exchange redirect URL for token   |
| `codex-oauth-cancel`       | invoke | renderer → main | index.js    | Cancel pending OAuth flow         |
| `test-provider`            | invoke | renderer → main | index.js    | Test provider connection          |
| `terminal-create`          | invoke | renderer → main | terminal.js | Spawn shell session               |
| `terminal-write`           | invoke | renderer → main | terminal.js | Write to terminal stdin           |
| `terminal-kill`            | invoke | renderer → main | terminal.js | Kill terminal session             |
| `terminal-status`          | invoke | renderer → main | terminal.js | Get session info                  |
| `terminal-exec`            | invoke | renderer → main | terminal.js | Run command to completion         |
| `terminal-output`          | event  | main → renderer | terminal.js | Terminal stdout/stderr output     |
| `terminal-exit`            | event  | main → renderer | terminal.js | Terminal session exit             |
| `project-init`             | invoke | renderer → main | projects.js | Create project with onidocs       |
| `project-list`             | invoke | renderer → main | projects.js | List all projects                 |
| `project-get`              | invoke | renderer → main | projects.js | Get project + docs                |
| `project-delete`           | invoke | renderer → main | projects.js | Delete project entry              |
| `project-open-in`          | invoke | renderer → main | projects.js | Open in external editor           |
| `fs-read-dir`              | invoke | renderer → main | projects.js | Read directory tree               |
| `fs-read-file`             | invoke | renderer → main | projects.js | Read file content                 |
| `fs-write-file`            | invoke | renderer → main | projects.js | Write file content                |

### Git IPC Channels (Created, Not Yet Registered)

| Channel        | Description                                 |
| -------------- | ------------------------------------------- |
| `git-is-repo`  | Check if path is a git repo                 |
| `git-init`     | Initialize new repo                         |
| `git-status`   | Parsed status (branch, files, ahead/behind) |
| `git-branches` | List local + remote branches                |
| `git-log`      | Recent commits                              |
| `git-diff`     | File diffs (staged/unstaged)                |
| `git-stage`    | Stage files                                 |
| `git-unstage`  | Unstage files                               |
| `git-commit`   | Commit with message                         |
| `git-checkout` | Switch/create branches                      |
| `git-stash`    | Push, pop, list stash entries               |
| `git-remotes`  | List remote URLs                            |
| `git-pull`     | Pull from remote                            |
| `git-push`     | Push to remote                              |
| `git-show`     | Show file at specific commit                |

## Key Design Decisions

| Decision                                  | Rationale                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| Chat shell in React (not VS Code webview) | Full control over UX, faster iteration, no VS Code dependency for chat             |
| Main process in plain CommonJS `.js`      | Simpler dev flow — no compilation needed for main process during development       |
| Single CSS file with custom properties    | No build-time CSS framework needed; themes are runtime CSS variable swaps          |
| Inline SVGs (no icon library)             | Zero external icon dependencies; full control over icon styling                    |
| `localStorage` for state (no Redux)       | Minimal complexity for current scope; conversation + provider state is simple      |
| IPC for AI calls (not direct fetch)       | Avoids CORS; main process has full Node.js + TLS capabilities                      |
| Electron `net.fetch` for ChatGPT backend  | Raw `https.request` had TLS/socket issues; `net.fetch` handles it properly         |
| `child_process.spawn` for terminal        | No native module dependency (no node-pty); works with standard Electron packaging  |
| JSON file for project metadata            | Simple, portable; `~/.onicode/projects.json` — no database needed for metadata     |
| Editor shell loads lazily (future)        | Fast startup — chat loads in <1s, VS Code loads only when "Open Editor" is clicked |
| SQLite for local data (planned)           | Embeddings, conversation history, knowledge base — all local, fast, portable       |
| AES-256 for key vault (planned)           | API keys encrypted at rest with user's master password or OS keychain              |

## AI Chat Dual-Mode Routing

```
User sends message
       │
       ▼
 Is provider "codex" AND token is OAuth JWT?
       │
  YES ─┤─── NO
       │       │
       ▼       ▼
  ChatGPT     OpenAI API (or Gateway)
  Backend     /v1/chat/completions
  /codex/     ┌──────────────────┐
  /responses  │ Standard SSE:    │
  ┌────────┐  │ choices[0].delta │
  │ Resp.  │  │   .content       │
  │ API:   │  └──────────────────┘
  │ output │
  │ _text. │
  │ delta  │
  └────────┘
```

## Data Storage

| Data               | Location                      | Format           | Status      |
| ------------------ | ----------------------------- | ---------------- | ----------- |
| Conversations      | `localStorage`                | JSON             | Implemented |
| Provider settings  | `localStorage`                | JSON             | Implemented |
| Theme preference   | `localStorage`                | String           | Implemented |
| Project metadata   | `~/.onicode/projects.json`    | JSON file        | Implemented |
| Project docs       | `<project>/onidocs/*.md`      | Markdown files   | Implemented |
| Conversations (v2) | `~/.onicode/conversations.db` | SQLite           | Planned     |
| API Key Vault      | `~/.onicode/vault.db`         | Encrypted SQLite | Planned     |
| Embeddings         | `~/.onicode/embeddings.db`    | SQLite + FAISS   | Planned     |
