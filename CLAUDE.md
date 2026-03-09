# Onicode — CLAUDE.md

> AI-powered development environment: a premium chat that expands into a full VS Code IDE on demand.
>
> **Last updated:** 2026-03-09

## Project Overview

Onicode is an Electron 34 + React 19 desktop app. The default experience is a **Chat Shell** (conversational AI with streaming, slash commands, terminal, project management). When the user needs to write code, an **Editor Shell** (VS Code workbench) will slide out (not yet implemented). Both shells will share a single AI Engine.

See `docs/PRODUCT_VISION.md` for the full vision, `docs/ROADMAP.md` for milestones, and `CHANGELOG.md` for version history.

## Tech Stack

- **Desktop**: Electron 34 (main process in CommonJS `.js`)
- **Chat Shell**: React 19 + Vite 6 (TypeScript `.tsx`)
- **Editor Shell**: VS Code workbench (lazy-loaded, not yet implemented)
- **Styling**: Single CSS file, CSS custom properties (12 themes: Sand, Midnight, Obsidian, Ocean, Aurora, Monokai, Rosé Pine, Nord, Catppuccin, Default Light, Default Dark, Neutral)
- **AI Providers**: OpenAI Codex (GPT-5.x, o-series via `sk-` keys or ChatGPT OAuth JWT), OniAI Gateway, OpenClaw Gateway
- **State**: React useState + `localStorage` (no Redux/Zustand)
- **IPC**: Electron contextBridge via `window.onicode` (`preload.js`)
- **Local data**: JSON files (`~/.onicode/projects.json`), `localStorage`, SQLite (`~/.onicode/onicode.db`)
- **Persistence**: SQLite for conversations, tasks, sessions; localStorage as fallback
- **Security**: AES-256 key vault (planned), OS keychain integration (planned)
- **Package manager**: npm

## Directory Structure

```
src/
  main/                    # Electron main process (CommonJS .js files)
    index.js                # App entry, BrowserWindow, AI streaming (dual-mode),
                            #   Codex OAuth PKCE, test provider, port auto-retry
    preload.js              # contextBridge → window.onicode API
    terminal.js             # Shell session management (spawn, stdin/stdout, exec)
    projects.js             # Project CRUD, onidocs templates, filesystem ops
    git.js                  # Git operations via IPC (15 handlers, fully wired)
    aiTools.js              # AI tool definitions (45 tools), executor, task manager, file context tracker
    lsp.js                  # Code intelligence via TypeScript compiler API
    codeIndex.js            # TF-IDF semantic search indexer
    storage.js              # SQLite persistence layer (tasks, conversations, sessions)
    hooks.js                # Pre/post tool lifecycle hooks
    commands.js             # Custom slash commands (user-defined)
    compactor.js            # Context compaction (summarize old messages)
    memory.js               # Persistent memory system (soul, user, long-term, daily)
    browser.js              # Puppeteer headless browser integration
    connectors.js           # OAuth connectors (GitHub, Gmail)
    logger.js               # Structured logging system

  chat/                    # Chat Shell (React 19, TypeScript)
    main.tsx                # ReactDOM entry
    App.tsx                 # Root component, view routing, ThemeProvider, floating editor
    components/
      ChatView.tsx           # Chat UI, streaming, tool steps, inline diffs, session timer
      Sidebar.tsx            # Left nav (Chat, Projects, Docs, Settings, Memories)
      SettingsPanel.tsx      # Theme picker, providers, skills, connectors, hooks
      ProviderSettings.tsx   # AI provider config, Codex OAuth PKCE, test connection
      RightPanel.tsx         # Widget panel: terminal, files, agents, tasks, git, browser
      ProjectsView.tsx       # Project list, detail, file tree, docs, "Open in"
      ProjectModeBar.tsx     # Project mode header bar
      MemoriesView.tsx       # Memory file viewer/editor
      OnboardingDialog.tsx   # First-run onboarding
      DocsView.tsx           # Aggregated docs from all projects' onidocs/
    commands/
      registry.ts            # 21 slash command definitions across 6 categories
      executor.ts            # Slash command execution logic
      skills.ts              # 12 built-in AI skills (prompt templates)
    ai/
      systemPrompt.ts        # Context-aware system prompt builder with skills, tools, git
    hooks/
      useTheme.tsx           # ThemeContext, localStorage persistence
    types/
      window.d.ts            # TypeScript types for window.onicode API
    styles/
      index.css              # All CSS: reset, 12 themes, layout, all components

docs/                      # Product docs (see docs/README.md)
```

## Build & Run

```bash
npm install
npm run dev          # concurrently: vite dev server (port 5173) + electron
npm run build        # tsc + vite build (chat) + tsc -p tsconfig.electron.json (main)
npm run start        # electron . (production)
npm run package      # electron-builder
```

- `tsconfig.json` — Chat Shell (React): ESNext module, JSX, no emit, includes `src/chat` + `src/shared`
- `tsconfig.electron.json` — Main process: CommonJS, emits to `dist/main`, includes `src/main`
- Vite builds chat to `dist/chat/`, Electron main compiles to `dist/main/`
- Dev mode: main entry is `src/main/index.js` (set in `package.json`)

## Architecture Notes

### Two Shells, One Brain

- **Chat Shell** (React) is the default view — loads instantly
- **Editor Shell** (VS Code) loads lazily only when user clicks "Open Editor" (not yet built)
- Both will share the same AI Engine (not yet built as a separate module)

### AI Provider Flow (Dual-Mode Routing)

1. User configures providers in `SettingsPanel > ProviderSettings`
2. Providers stored in `localStorage` under key `onicode-providers`
3. `ChatView.getActiveProvider()` reads localStorage to find the first enabled+connected provider
4. Chat sends messages + provider config to main process via `ai-send-message` IPC
5. Main process routes based on token type:
   - **`sk-` API key** → standard OpenAI `/v1/chat/completions` (SSE: `choices[0].delta.content`)
   - **OAuth JWT token** → ChatGPT backend `/backend-api/codex/responses` (SSE: `response.output_text.delta`)
   - **Gateway** → `${baseUrl}/v1/chat/completions` with provided key
6. Streaming chunks sent to renderer via `ai-stream-chunk` events
7. Completion/error via `ai-stream-done` event

### Codex OAuth PKCE Flow

Fully handled in the main process:

1. Renderer calls `window.onicode.startCodexOAuth()` (IPC to main)
2. Main generates PKCE verifier+challenge, opens `auth.openai.com/oauth/authorize` via `shell.openExternal`
3. User pastes the localhost redirect URL back into the app
4. Main exchanges auth code for token via Node.js `https` (server-side, no CORS)
5. JWT decoded to extract `chatgpt_account_id` for API calls
6. Token returned to renderer, provider marked as connected

### Slash Command System

20 commands across 6 categories (chat, ai, project, terminal, panel, system).
See `src/chat/commands/registry.ts` for definitions, `executor.ts` for logic.
Key commands: `/init`, `/run`, `/context`, `/model`, `/terminal`, `/files`, `/browser`, `/help`.

### Terminal System

Real shell sessions via `child_process.spawn` (`/bin/zsh -l`).

- Session management: create, write stdin, kill, status check
- One-shot `terminal-exec` for AI use (30s timeout)
- Streaming stdout/stderr via IPC events

### Project System

Project metadata stored in `~/.onicode/projects.json`.

- `/init` creates project folder + `onidocs/` with template docs
- Templates: `architecture.md`, `scope.md`, `changelog.md`, `tasks.md`, `README.md`
- Open in external editors: VS Code, Cursor, Windsurf, Finder

### IPC Channels

See `docs/ARCHITECTURE.md` for the full IPC channel reference table.

### Theme System

- 12 themes defined as CSS custom properties in `index.css`
- `useTheme` hook manages state, persists to localStorage, sets `data-theme` on `<html>`
- Smooth 500ms cross-fade transition via `.theme-transitioning` class

### Hooks System

- 19 hook types: PreToolUse, PostToolUse, ToolError, PreEdit, PostEdit, PreCommand, PostCommand, OnDangerousCommand, PreCommit, PostCommit, OnTestFailure, OnTaskComplete, SessionStart, AIResponse, PreCompact, Stop, SubagentStop, UserPromptSubmit, Notification
- Global config: `~/.onicode/hooks.json`, project config: `.onicode/hooks.json`
- Shell command execution with env vars (`$TOOL_NAME`, `$FILE_PATH`, etc.)
- Matcher regex for filtering specific tools

### Custom Commands

- Markdown-based: `.onicode/commands/*.md` with `$ARGUMENTS` substitution
- 5 default templates: review, deploy, test, refactor, explain
- Auto-detected in slash command system

### Context Compaction

- Auto-summarize old messages when tokens exceed 60k threshold
- Mechanical summary extraction preserving key decisions and code changes
- Semantic compaction (AI-powered conversation summarization)
- Token estimation via word-based heuristic

### Agent System

- Sub-agent spawning via `spawn_sub_agent` tool with read-only tool access
- Agent status tracking with real-time IPC events (`ai-agent-step`)
- Agent runtime widget in right panel showing active agents and terminals
- Terminal session tracking across AI workflows

## What's Working

- [x] Electron app scaffold with BrowserWindow + dev port auto-retry
- [x] AI chat with streaming (dual-mode: OpenAI API + ChatGPT OAuth)
- [x] Codex OAuth PKCE flow (main process HTTP server)
- [x] 12 themes with animated transitions
- [x] Sidebar navigation (Chat, Projects, Docs, Agents, Settings)
- [x] AI provider settings (3 providers, test connection)
- [x] Slash command system (20+ commands, autocomplete, custom commands)
- [x] AI system prompt builder (context-aware, AGENTS.md, hooks, MCP)
- [x] Terminal backend (real shell sessions via IPC)
- [x] Terminal widget with session persistence across tab switches
- [x] File viewer widget (in right panel)
- [x] Agent runtime widget (in right panel)
- [x] Project init with onidocs templates
- [x] Project list, detail, file tree, "Open in" editors
- [x] Documents view (aggregated from all projects)
- [x] Conversation history (localStorage + SQLite)
- [x] File/URL attachments
- [x] Right panel (Terminal, Project, Files, Agents, Tasks, Git, Browser)
- [x] Git integration (15 IPC handlers + 9 AI tools)
- [x] Git panel (branch, stage, commit, push, pull, branch switching)
- [x] SQLite persistence (tasks, conversations, sessions)
- [x] Permission enforcement (tool-level allow/ask/deny)
- [x] Sub-agent execution (real AI calls, read-only tools)
- [x] Hooks system (19 types, global + project config, wired into tool pipeline)
- [x] Custom commands (.onicode/commands/*.md)
- [x] Context compaction (auto-summarize at token limit)
- [x] Memory system (soul.md, user.md, daily logs)
- [x] Logger, Browser (Puppeteer), Connectors modules
- [x] Inline tool results (expandable: command output, file diffs, search results)
- [x] Session timer (shows AI working duration)
- [x] Project indexer tool (index_project: file map with exports/imports)
- [x] Skills system (12 AI skills, expandable UI, system prompt injection)
- [x] Markdown rendering (marked library, full GFM)
- [x] Floating editor (syntax highlighting via highlight.js, draggable/resizable/snappable)
- [x] Project mode (auto-detect, /switch command, "Work on Project" button)
- [x] Conversation continuation (loads previous session context from SQLite)
- [x] Code Intelligence (LSP via TypeScript compiler API)
- [x] Semantic Search (TF-IDF code indexer)
- [x] Unified Memory System (global + project + daily + cross-session)
- [x] Permission System (3 modes: auto-allow, ask-destructive, plan-only)
- [x] Fuzzy edit matching (Levenshtein-based fallback)
- [x] Auto-backup before edits (restore points)
- [x] System prompt caching
- [x] Semantic compaction (AI-powered conversation summarization)
- [x] Browser widget (Puppeteer preview with URL navigation + screenshots)
- [x] 45 AI tools total

## What's Missing

- [ ] **Connectors** — GitHub OAuth, Gmail OAuth, Slack OAuth (placeholder UI exists)
- [ ] **API Key Store** — AES-256 encrypted vault (placeholder)
- [ ] **Anthropic provider** — Claude API
- [ ] **Ollama provider** — local models
- [ ] **Editor Shell** — VS Code workbench (lazy-loaded)
- [ ] **MCP client** — extensible tool system for external integrations
- [ ] **Auto-update** — electron-updater for seamless updates
- [ ] **SQLite conversation migration** — full migration from localStorage
- [ ] **Mobile companion** — React Native app

## Coding Conventions

- **Main process**: CommonJS (`require`/`module.exports`), plain `.js` files
- **Chat shell**: TypeScript + React (functional components, hooks), `.tsx` files
- **Styling**: Single CSS file with CSS custom properties. No CSS-in-JS, no Tailwind.
- **State**: React useState + localStorage. No Redux/Zustand.
- **IPC**: Electron contextBridge via `window.onicode` (see `preload.js` + `window.d.ts`)
- **SVGs**: Inline in JSX (no icon library)
- **Font**: Inter (UI) + JetBrains Mono (code)
- **Register pattern**: Main process modules export `registerXxxIPC(ipcMain, getWindow)` functions

## Next Steps

1. **Connectors** — GitHub OAuth, Gmail OAuth (no manual API key generation)
3. **API Key Store** — AES-256 encrypted vault with OS keychain
4. **Anthropic provider** — Claude API support
5. **MCP client** — Extensible tool system for external integrations
6. **Editor Shell** — VS Code workbench (lazy-loaded)
7. **Auto-update** — electron-updater for seamless updates
