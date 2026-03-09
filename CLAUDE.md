# Onicode — CLAUDE.md

> AI-powered development environment: a premium chat that expands into a full VS Code IDE on demand.

## Project Overview

Onicode is an Electron + React desktop app. The default experience is a **Chat Shell** (conversational AI). When the user needs to write code, an **Editor Shell** (VS Code workbench) slides out. Both shells share a single AI Engine.

See `docs/PRODUCT_VISION.md` for the full vision and `docs/ROADMAP.md` for phased milestones.

## Tech Stack

- **Desktop**: Electron 34 (main process in CommonJS)
- **Chat Shell**: React 19 + Vite 6 (TypeScript, JSX)
- **Editor Shell**: VS Code workbench (lazy-loaded, not yet implemented)
- **Styling**: CSS custom properties (4 themes: Sand, Midnight, Obsidian, Ocean)
- **AI Providers**: OpenAI Codex (GPT-5.x, o-series), OniAI Gateway, OpenClaw Gateway, Ollama (planned)
- **Local data**: better-sqlite3 (planned), electron-store
- **Security**: AES-256 key vault (planned), OS keychain integration (planned)
- **Package manager**: npm (see package-lock.json)

## Directory Structure

```
src/
  main/              # Electron main process (CommonJS .js files)
    index.js          # App entry, BrowserWindow, IPC handlers
    preload.js         # contextBridge — exposes `window.onicode` API
  chat/              # Chat Shell (React, TypeScript)
    main.tsx           # ReactDOM entry
    App.tsx            # Root component, view routing, ThemeProvider
    components/
      ChatView.tsx      # Chat UI, streaming AI responses, message rendering
      Sidebar.tsx       # Left nav (Chat, Projects, Docs, Settings)
      SettingsPanel.tsx  # Theme picker, provider settings, connectors, key store
      ProviderSettings.tsx  # AI provider config, Codex OAuth PKCE, test connection
    hooks/
      useTheme.tsx      # ThemeContext, localStorage persistence, CSS variable injection
    styles/
      index.css         # All CSS: reset, 4 theme palettes, layout, components
docs/                # Product docs (vision, architecture, theming, AI engine, connectors, etc.)
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

## Architecture Notes

### Two Shells, One Brain
- **Chat Shell** (React) is the default view — loads instantly
- **Editor Shell** (VS Code) loads lazily only when user clicks "Open Editor" (not yet built)
- Both share the same AI Engine (not yet built as a separate module)

### AI Provider Flow (Current)
1. User configures providers in `SettingsPanel > ProviderSettings`
2. Providers stored in `localStorage` under key `onicode-providers`
3. `ChatView.getActiveProvider()` reads localStorage to find the first enabled+connected provider with an API key
4. Chat sends to OpenAI-compatible `/v1/chat/completions` endpoint with streaming
5. For Codex: direct `https://api.openai.com/v1/chat/completions`
6. For gateways: `${baseUrl}/v1/chat/completions`

### Codex OAuth PKCE Flow (Fixed)
The ChatGPT sign-in flow uses PKCE OAuth, fully handled in the main process:
1. Renderer calls `window.onicode.startCodexOAuth()` (IPC to main)
2. Main process generates PKCE verifier+challenge, starts HTTP server on port 1455
3. Main process opens `auth.openai.com/oauth/authorize` in the default browser via `shell.openExternal`
4. User signs in, browser redirects to `localhost:1455/auth/callback`
5. HTTP server captures the redirect, shows a success page, extracts the auth code
6. Main process exchanges code for token via Node.js `https` (no CORS)
7. Main process sends token to renderer via `codex-oauth-result` IPC event
8. Renderer stores the access token and marks provider as connected

**Note:** ChatGPT OAuth tokens may have limited API scopes. If the token doesn't work for chat completions, users should use a standard API key from platform.openai.com instead.

### IPC Channels
- `get-app-info` — returns app name, version, platform
- `get-theme` / `set-theme` — stub (theme actually persisted in localStorage, not Electron)
- `ai-send-message` (invoke) — sends messages + provider config to main, starts streaming
- `ai-stream-chunk` (event, main→renderer) — each SSE delta as it arrives
- `ai-stream-done` (event, main→renderer) — null on success, error string on failure
- `ai-abort` (invoke) — destroys the in-flight HTTP request
- `codex-oauth-start` (invoke) — starts HTTP server on 1455, opens browser for OAuth
- `codex-oauth-cancel` (invoke) — shuts down the auth server
- `codex-oauth-result` (event, main→renderer) — `{ success, accessToken }` or `{ error }`
- `test-provider` (invoke) — tests connection via main process (no CORS)

### Theme System
- 4 themes defined as CSS custom properties in `index.css`
- `useTheme` hook manages state, persists to localStorage, sets `data-theme` on `<html>`
- Smooth 500ms cross-fade transition via `.theme-transitioning` class

## Known Broken / Missing

### Fixed
1. **AI chat now routes through main process IPC** — `ai-send-message` handler in `index.js` makes the API call via Node.js `https` (no CORS). Streaming chunks sent back via `ai-stream-chunk` events, completion via `ai-stream-done`.
2. **Codex OAuth flow works** — Main process starts HTTP server on port 1455 to capture the redirect automatically. Token exchange happens server-side via Node.js `https` (no CORS). User just clicks "Sign in with ChatGPT", authenticates in browser, and comes back to a connected app.
3. **Test Connection routes through main process** — `test-provider` IPC handler avoids CORS for gateway URLs.

### Remaining (per roadmap Phase 1)
- [ ] Conversation history persistence (SQLite) — currently in-memory only
- [ ] Onicode branding assets (logo, icons, splash) — using inline SVGs
- [ ] Anthropic provider (Claude)
- [ ] Ollama (local) provider
- [ ] Project management (open folder, file tree)

### Missing (per roadmap Phase 2+)
- [ ] Model router (`src/ai/modelRouter.ts`)
- [ ] Context engine (`src/ai/contextEngine.ts`)
- [ ] Agent orchestrator (`src/ai/agentOrchestrator.ts`)
- [ ] Global API Key Store / vault (`src/keystore/`)
- [ ] Shell manager (chat <-> editor transitions)
- [ ] Editor Shell (VS Code integration)
- [ ] Inline completions
- [ ] Skills system
- [ ] Connectors (GitHub, Gmail, Slack)
- [ ] Mobile companion app

## Coding Conventions

- **Main process**: CommonJS (`require`/`module.exports`), plain `.js` files
- **Chat shell**: TypeScript + React (functional components, hooks), `.tsx` files
- **Styling**: Single CSS file with CSS custom properties. No CSS-in-JS, no Tailwind.
- **State**: React useState + localStorage. No Redux/Zustand yet.
- **IPC**: Electron contextBridge via `window.onicode` (see `preload.js`)
- **SVGs**: Inline in JSX (no icon library)
- **Font**: Inter (UI) + JetBrains Mono (code)

## Next Steps (Phase 2)

1. **Add Anthropic provider** — Claude API uses `x-api-key` header and different response format.
2. **Add conversation persistence** — Use better-sqlite3 to store conversations.
3. **Add Ollama provider** — Local models, no auth needed, different API format.
4. **Context engine** — Codebase indexing, RAG, @mentions.
5. **Editor Shell** — Lazy-loaded VS Code workbench with shell transitions.
