---
title: "I built an open-source AI workspace with 80+ tools and an autonomous browser agent"
published: true
tags: opensource, ai, electron, webdev
---

## Why I Built Onicode

Every AI coding tool feels the same — a chat box with code suggestions. I wanted something that actually *does* things. Not just for developers either — for writers, researchers, students, anyone who wants AI superpowers on their desktop.

So I built **Onicode** — an open-source Electron app with 80+ built-in tools, an autonomous browser agent, and multi-agent orchestration.

## What Makes It Different

### 1. Three Modes for Everyone

- **Chat** — General AI assistant. Research, brainstorm, write, automate.
- **Workpal** — Productivity partner. Documents, emails, file management.
- **Projects** — Software engineering. Code, test, deploy, manage tasks.

### 2. Browser Agent 🌐

This is the feature I'm most excited about. The AI opens a **real Chrome window** and autonomously:
- Navigates to websites
- Fills out forms
- Clicks buttons
- Extracts data from tables
- Manages multiple tabs

You tell it "Go to Amazon and find wireless earbuds under $50" and watch it work in real-time.

Each parallel sub-agent gets its own browser tab — no conflicts when running multiple tasks at once.

### 3. 80+ Built-in Tools

Not plugins. Not extensions. Built right in:

| Category | Examples |
|----------|---------|
| File ops | read, edit, create, delete, multi-edit |
| Git | 23 tools — status, commit, push, pull, branches, PRs via gh CLI |
| Browser | 21 tools — navigate, click, type, fill forms, extract tables |
| Terminal | Run commands, check output, manage processes |
| Search | Glob, regex, semantic search, symbol lookup |
| Memory | Save facts, smart search, deduplication |
| Credentials | AES-256 encrypted vault with OS Keychain |
| Workflows | 7 step types, cron scheduling, webhooks |
| MCP | 55+ server catalog, one-click install |

### 4. Multi-Agent Orchestration

Spawn specialist sub-agents that work in parallel:
- **Researcher** — Read-only exploration and web search
- **Implementer** — Create and modify files
- **Tester** — Write tests and verify with browser
- **Browser Agent** — Autonomous web browsing

They coordinate via a work graph with dependency tracking and file locks.

### 5. Five AI Providers

| Provider | Models |
|----------|--------|
| OpenAI | GPT-5.x, GPT-4.1, o3, o4 (with native web search) |
| Anthropic | Claude Opus, Sonnet, Haiku |
| Ollama | Any local model — Llama, Mistral, etc. |

## Tech Stack

- **Desktop**: Electron 34
- **UI**: React 19 + TypeScript + Vite 6
- **Styling**: CSS custom properties (12 themes, no framework)
- **Database**: SQLite (conversations, tasks, sessions, memory)
- **Encryption**: AES-256-GCM + PBKDF2 + OS Keychain
- **Browser**: Puppeteer + Chrome DevTools Protocol

## Getting Started

```bash
git clone https://github.com/msichalwe/Onicode.git
cd Onicode
npm install
npm run dev
```

Requirements: Node.js 20+, macOS.

## Links

- **GitHub**: [github.com/msichalwe/Onicode](https://github.com/msichalwe/Onicode)
- **Website**: [onicode.dev](http://187.124.115.69)
- **Docs**: [Documentation](http://187.124.115.69/docs.html)

MIT licensed. PRs welcome.

---

What features would you want in an AI workspace? Let me know in the comments 👇
