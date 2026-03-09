# Onicode — Roadmap

## Phase 1: Chat Shell + Branding (Week 1) 🏗️

**Goal**: A beautiful, functional AI chat app that stands on its own.

- [ ] Electron app scaffold with React chat shell
- [ ] Chat UI with streaming AI responses
- [ ] 4 built-in themes (Sand, Midnight, Obsidian, Ocean)
- [ ] Theme picker with animated transitions
- [ ] Left sidebar navigation (Chat, Projects, Settings)
- [ ] Conversation history (local SQLite)
- [ ] Onicode branding (logo, icons, splash)
- [ ] Model provider settings (OniAI, OpenAI, Anthropic, Ollama)

**Milestone**: You can open Onicode, chat with AI, switch themes. Looks premium.

---

## Phase 2: AI Engine + Editor Shell (Weeks 2-3) ⚡

**Goal**: Wire up the AI brain and add the VS Code editor shell.

- [ ] Model router (multi-provider with fallback)
- [ ] Global API Key Store (encrypted vault)
- [ ] Context engine (codebase indexing)
- [ ] "Open Editor" → VS Code workbench loads lazily
- [ ] "Collapse to Chat" → smooth transition back
- [ ] Inline code completions in editor
- [ ] Basic agent mode (file edits + terminal commands)
- [ ] Skills system (built-in skills)
- [ ] Auto-inject keys from vault into terminals

**Milestone**: Full chat-to-editor flow. AI can edit files and run commands.

---

## Phase 3: Connectors + Differentiators (Weeks 4-6) 🔌

**Goal**: The features nobody else has.

- [ ] GitHub connector (PRs, issues, repos)
- [ ] Gmail connector (read, send, draft)
- [ ] Live web preview panel in editor
- [ ] General AI chat mode (non-coding)
- [ ] Document editor (rich markdown)
- [ ] Multi-agent cascade (parallel agents)
- [ ] Slack connector
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
