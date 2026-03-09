# Onicode — CLAUDE.md

> AI-powered development environment: a premium chat that expands into a full VS Code IDE on demand.
>
> **Last updated:** 2025-03-09

## Project Overview

Onicode is an Electron 34 + React 19 desktop app. The default experience is a **Chat Shell** (conversational AI with streaming, slash commands, terminal, project management). When the user needs to write code, an **Editor Shell** (VS Code workbench) will slide out (not yet implemented). Both shells will share a single AI Engine.

See `docs/PRODUCT_VISION.md` for the full vision, `docs/ROADMAP.md` for milestones, and `CHANGELOG.md` for version history.

## Tech Stack

- **Desktop**: Electron 34 (main process in CommonJS `.js`)
- **Chat Shell**: React 19 + Vite 6 (TypeScript `.tsx`)
- **Editor Shell**: VS Code workbench (lazy-loaded, not yet implemented)
- **Styling**: Single CSS file, CSS custom properties (4 themes: Sand, Midnight, Obsidian, Ocean)
- **AI Providers**: OpenAI Codex (GPT-5.x, o-series via `sk-` keys or ChatGPT OAuth JWT), OniAI Gateway, OpenClaw Gateway
- **State**: React useState + `localStorage` (no Redux/Zustand)
- **IPC**: Electron contextBridge via `window.onicode` (`preload.js`)
- **Local data**: JSON files (`~/.onicode/projects.json`), `localStorage`. SQLite planned.
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
    git.js                  # Git operations via IPC — CREATED, NOT WIRED YET

  chat/                    # Chat Shell (React 19, TypeScript)
    main.tsx                # ReactDOM entry
    App.tsx                 # Root component, view routing, ThemeProvider
    components/
      ChatView.tsx           # Chat UI, streaming, history, attachments, slash autocomplete
                             # ⚠️ BROKEN — handleSend/handleKeyDown/handleSuggestionClick
                             #   were removed during refactoring and not re-added
      Sidebar.tsx            # Left nav (Chat, Projects, Docs, Settings)
      SettingsPanel.tsx      # Theme picker, providers, connectors, key store
      ProviderSettings.tsx   # AI provider config, Codex OAuth PKCE, test connection
      RightPanel.tsx         # Widget panel: terminal, files, browser, etc.
      ProjectsView.tsx       # Project list, detail, file tree, docs, "Open in"
      DocsView.tsx           # Aggregated docs from all projects' onidocs/
    commands/
      registry.ts            # 20 slash command definitions across 6 categories
      executor.ts            # Slash command execution logic
    ai/
      systemPrompt.ts        # Context-aware system prompt builder
    hooks/
      useTheme.tsx           # ThemeContext, localStorage persistence
    types/
      window.d.ts            # TypeScript types for window.onicode API
    styles/
      index.css              # All CSS: reset, 4 themes, layout, all components

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

- 4 themes defined as CSS custom properties in `index.css`
- `useTheme` hook manages state, persists to localStorage, sets `data-theme` on `<html>`
- Smooth 500ms cross-fade transition via `.theme-transitioning` class

## Critical Issues

### ⚠️ ChatView.tsx is BROKEN

`handleSend`, `handleKeyDown`, and `handleSuggestionClick` functions were removed during a TypeScript declaration-ordering refactor but **not re-added** after `handleCommand`. The file won't compile. These functions must be restored.

### ⚠️ git.js is NOT WIRED

`src/main/git.js` has full IPC handlers for 15 git operations but is not:

- Imported/registered in `index.js`
- Exposed in `preload.js`
- Typed in `window.d.ts`
- Surfaced in any UI component

## What's Working

- [x] Electron app scaffold with BrowserWindow + dev port auto-retry
- [x] AI chat with streaming responses (dual-mode routing)
- [x] Codex OAuth PKCE flow (main process)
- [x] 4 premium themes with animated transitions
- [x] Sidebar navigation (Chat, Projects, Docs, Settings)
- [x] AI provider settings (3 providers, test connection)
- [x] Slash command system (20 commands, autocomplete)
- [x] AI system prompt builder (context-aware)
- [x] Terminal backend (real shell sessions via IPC)
- [x] Terminal widget (in right panel)
- [x] File viewer widget (in right panel)
- [x] Project init with onidocs templates
- [x] Project list, detail, file tree, "Open in" editors
- [x] Documents view (aggregated from all projects)
- [x] Conversation history (localStorage)
- [x] File/URL attachments (UI only)
- [x] Right panel widget system

## What's Missing

- [ ] **Fix ChatView.tsx** — restore removed functions (CRITICAL)
- [ ] **Wire git.js** — register in index.js, expose in preload.js, type in window.d.ts
- [ ] **Git UI** — status, branches, commits, diffs in Projects tab
- [ ] **Project management** — kanban, user stories, milestones
- [ ] **Connectors** — GitHub OAuth, Gmail OAuth, Slack OAuth (currently placeholder)
- [ ] **API Key Store** — encrypted vault (currently placeholder)
- [ ] **SQLite persistence** — conversations, embeddings
- [ ] **Anthropic provider** — Claude API
- [ ] **Ollama provider** — local models
- [ ] **Editor Shell** — VS Code workbench (lazy-loaded)
- [ ] **AI Engine** — model router, context engine, agent orchestrator
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

1. **Fix ChatView.tsx** — Restore `handleSend`, `handleKeyDown`, `handleSuggestionClick` after `handleCommand`
2. **Wire git.js** — Import in `index.js`, expose in `preload.js`, type in `window.d.ts`
3. **Git UI** — Add git integration panel in Projects tab
4. **Project management** — Kanban boards, user stories, milestones
5. **Connectors** — GitHub OAuth, Gmail OAuth (no manual API key generation)
6. **SQLite persistence** — Replace localStorage for conversations
