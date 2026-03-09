# Onicode — Roadmap

> **Last updated:** 2025-03-09

## Phase 1: Chat Shell + Branding (Week 1) 🏗️

**Goal**: A beautiful, functional AI chat app that stands on its own.

- [x] Electron app scaffold with React chat shell
- [x] Chat UI with streaming AI responses
- [x] 4 built-in themes (Sand, Midnight, Obsidian, Ocean)
- [x] Theme picker with animated transitions
- [x] Left sidebar navigation (Chat, Projects, Docs, Settings)
- [x] Model provider settings (OpenAI Codex, OniAI Gateway, OpenClaw Gateway)
- [x] Codex OAuth PKCE flow (ChatGPT sign-in)
- [x] Dual-mode AI routing (sk- API keys + ChatGPT OAuth JWT)
- [x] Slash command system (20 commands, autocomplete)
- [x] AI system prompt builder (context-aware)
- [x] Terminal backend (real shell sessions)
- [x] Terminal widget in right panel
- [x] File viewer widget in right panel
- [x] Project system (init, list, detail, onidocs templates)
- [x] Projects view (list, detail, file tree, "Open in" editors)
- [x] Documents view (aggregated from all projects)
- [x] Conversation history (localStorage)
- [x] File/URL attachments (UI)
- [x] Git backend (git.js — 15 operations) — **created, not wired**
- [ ] Conversation history persistence (SQLite) — currently localStorage only
- [ ] Onicode branding assets (logo, icons, splash) — using inline SVGs
- [ ] Anthropic provider (Claude)
- [ ] Ollama (local) provider

**Milestone**: You can open Onicode, chat with AI, switch themes, manage projects, use terminal. Looks premium.

**Blockers**:

- ⚠️ `ChatView.tsx` is broken — functions removed during refactoring, need to be restored
- ⚠️ `git.js` needs to be wired into index.js, preload.js, window.d.ts

---

## Phase 1.9: Git Integration + Project Management 🔧

**Goal**: Deep git integration and project management features.

- [ ] Wire git.js into full stack (index.js → preload.js → window.d.ts → UI)
- [ ] Git integration UI in Projects tab (status, branches, commits, diffs, staging)
- [ ] Project management tabs (user stories, milestones, kanban boards)
- [ ] Fix ChatView.tsx (restore removed functions)

**Milestone**: Full git workflow from within Onicode. Project management at a glance.

---

## Phase 2: AI Engine + Editor Shell (Weeks 2-3) ⚡

**Goal**: Wire up the AI brain and add the VS Code editor shell.

- [ ] Model router (multi-provider with fallback)
- [ ] Global API Key Store (encrypted vault, AES-256)
- [ ] Context engine (codebase indexing, embeddings)
- [ ] "Open Editor" → VS Code workbench loads lazily
- [ ] "Collapse to Chat" → smooth transition back
- [ ] Inline code completions in editor
- [ ] Basic agent mode (file edits + terminal commands)
- [ ] Skills system (built-in skills)
- [ ] Auto-inject keys from vault into terminals
- [ ] SQLite conversation persistence

**Milestone**: Full chat-to-editor flow. AI can edit files and run commands.

---

## Phase 3: Connectors + Differentiators (Weeks 4-6) 🔌

**Goal**: The features nobody else has.

- [ ] GitHub connector (OAuth — no manual PAT generation)
- [ ] Gmail connector (Google OAuth 2.0 — no manual API key)
- [ ] Slack connector (Slack OAuth)
- [ ] Live web preview panel in editor
- [ ] General AI chat mode (non-coding)
- [ ] Document editor (rich markdown)
- [ ] Multi-agent cascade (parallel agents)
- [ ] Import .env → Key Vault migration flow

**Milestone**: Create a PR, email a summary, preview a website — all from chat.

---

## Phase 4: Mobile + Polish (Weeks 7-8) 📱

**Goal**: Mobile companion and premium polish.

- [ ] React Native mobile app
- [ ] WebSocket server for mobile connection
- [ ] Mobile: chat, run commands, approve agent actions
- [ ] Voice commands (Web Speech API / Whisper)
- [ ] Onboarding wizard
- [ ] Auto-update system
- [ ] Custom file icon set
- [ ] Performance optimization (startup < 2s for chat)

**Milestone**: Chat with Oni from your phone. Deploy from bed.

---

## Future Ideas 🔮

- Team/org workspaces with shared key vaults
- Jira/Linear connector
- Notion sync
- Vercel/Netlify deploy connector
- Plugin marketplace for custom connectors
- AI pair programming (two users + AI)
- Project templates ("scaffold a Next.js app with auth")
