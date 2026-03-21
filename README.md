<p align="center">
  <h1 align="center">Onicode</h1>
  <p align="center">
    <strong>AI-powered workspace — chat, create, build.</strong>
  </p>
  <p align="center">
    <a href="https://github.com/msichalwe/Onicode/releases">Download</a> ·
    <a href="http://187.124.115.69/docs.html">Docs</a> ·
    <a href="https://github.com/msichalwe/Onicode/issues">Issues</a> ·
    <a href="CONTRIBUTING.md">Contributing</a>
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/platform-macOS-lightgrey?style=flat-square" alt="macOS" />
    <img src="https://img.shields.io/badge/electron-34-blue?style=flat-square" alt="Electron 34" />
    <img src="https://img.shields.io/badge/react-19-61dafb?style=flat-square" alt="React 19" />
    <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License" />
    <img src="https://img.shields.io/badge/AI%20tools-80%2B-purple?style=flat-square" alt="80+ AI Tools" />
  </p>
</p>

---

Onicode is an open-source Electron desktop app that combines a conversational AI assistant with 80+ built-in tools, browser automation, multi-agent orchestration, and a full project management system. It's designed for everyone — developers, writers, researchers, students, and professionals.

## Features

### Three Modes

| Mode | Purpose |
|------|---------|
| **Chat** | General AI assistant. Research, brainstorm, write, automate — ask anything. |
| **Workpal** | Productivity partner. Documents, emails, spreadsheets, file management. |
| **Projects** | Software engineering. Create projects, write code, test, deploy, manage tasks. |

### AI Providers

| Provider | Models | Auth |
|----------|--------|------|
| **OpenAI** | GPT-5.x, GPT-4.1, o3, o4 | ChatGPT OAuth or API key |
| **Anthropic** | Claude Opus, Sonnet, Haiku | API key |
| **Ollama** | Llama, Mistral, CodeLlama, etc. | Local (no key) |

### 80+ AI Tools

<details>
<summary>Click to expand full tool list</summary>

| Category | Tools | Count |
|----------|-------|-------|
| **File Operations** | `read_file`, `edit_file`, `create_file`, `delete_file`, `multi_edit`, `smart_read` | 6 |
| **Search** | `search_files`, `glob_files`, `find_symbol`, `find_references`, `list_symbols`, `semantic_search`, `batch_search`, `find_implementation` | 8 |
| **Terminal** | `run_command`, `check_terminal`, `list_terminals` | 3 |
| **Git** | `git_status`, `git_commit`, `git_push`, `git_pull`, `git_diff`, `git_log`, `git_branches`, `git_checkout`, `git_merge`, `git_stash`, `git_tag`, `git_show`, `git_remotes`, `gh_cli` + 9 more | 23 |
| **Browser Agent** | `browser_agent_run`, `browser_navigate`, `browser_click`, `browser_type`, `browser_get_elements`, `browser_fill_form`, `browser_extract_table`, `browser_scroll`, `browser_tab_*`, `browser_status` | 21 |
| **Tasks** | `task_add`, `task_update`, `task_list`, `milestone_create` | 4 |
| **Memory** | `memory_save_fact`, `memory_search`, `memory_smart_search`, `memory_get_related`, `memory_hot_list` | 6 |
| **Credentials** | `credential_save`, `credential_search`, `credential_use`, `credential_get`, `credential_list`, `credential_delete` | 6 |
| **Context** | `explore_codebase`, `get_context_summary`, `get_dependency_graph`, `get_smart_context` | 4 |
| **Workflows** | `create_workflow`, `run_workflow`, `create_schedule`, `set_timer`, `show_widget` | 5 |
| **Orchestration** | `spawn_sub_agent`, `orchestrate`, `spawn_specialist` | 3 |
| **Self-Management** | `get_platform_info`, `update_config`, `self_diagnose` | 3 |
| **MCP** | Dynamic tools from connected servers | ∞ |

</details>

### Browser Agent

Autonomous Chrome automation powered by AI. The agent navigates websites, fills forms, clicks buttons, extracts data, and handles multi-step web workflows.

- Opens a real Chrome window (you can watch it work)
- Multi-tab support with per-agent isolation
- Smart page analysis with valid CSS selectors
- Cookie/session persistence across runs
- Parallel agents each get their own tab

### Multi-Agent Orchestration

Spawn specialist sub-agents that work in parallel:

| Role | Capabilities | Max Rounds |
|------|-------------|------------|
| **Researcher** | Read-only exploration, web search, code analysis | 15 |
| **Implementer** | Create and modify files within assigned scope | 25 |
| **Reviewer** | Code quality, bug detection, suggestions | 10 |
| **Tester** | Write tests, browser verification, QA | 15 |
| **Planner** | Architecture analysis, task planning | 10 |
| **Browser Agent** | Autonomous web browsing and data extraction | 30 |

### More Features

- **12 Themes** — Sand, Midnight, Obsidian, Ocean, Aurora, Monokai, Rosé Pine, Nord, Catppuccin, Dark, Light, Neutral
- **Credential Vault** — AES-256-GCM encrypted storage with OS Keychain integration
- **Workflows & Scheduler** — 7 step types, cron scheduling, concurrent execution
- **MCP Protocol** — 55+ server catalog, one-click install, dynamic tool injection
- **Memory System** — SQLite-backed with LLM extraction, deduplication, hotness scoring
- **Hooks** — 19 hook types for tool lifecycle, git events, and custom automation
- **38 Widget Types** — Interactive visualizations, data tables, charts, artifacts
- **Slash Commands** — 20+ built-in + custom commands from `.onicode/commands/*.md`

## Quick Start

### Prerequisites

- **Node.js 20+**
- **macOS** (Windows/Linux coming soon)

### Install & Run

```bash
git clone https://github.com/msichalwe/Onicode.git
cd Onicode
npm install
npm run dev
```

This starts the Vite dev server and Electron concurrently. The app opens automatically.

### Build for Production

```bash
npm run build        # Compile TypeScript + bundle React
npm run start        # Run production build
npm run package      # Create distributable (.dmg/.app)
```

### First Launch

The onboarding wizard guides you through:

1. **Use case selection** — What you'll use Onicode for (coding, writing, research, etc.)
2. **Theme** — Pick from 12 visual themes
3. **Profile** — Your name and AI personality preference
4. **Account** — Create your Oni account for settings sync
5. **AI Provider** — Connect OpenAI, Anthropic, or Ollama

## Architecture

```
src/
  main/                    # Electron main process (CommonJS .js)
    index.js               # App entry, BrowserWindow, AI streaming, routing
    browser.js             # Chrome/Puppeteer automation (dual-mode)
    browserAgent.js        # Autonomous browser agent loop
    orchestrator.js        # Multi-agent parallel execution
    tools/
      definitions.js       # 80+ AI tool schemas (OpenAI format)
      executor.js          # Tool execution dispatch + sub-agent system
    storage.js             # SQLite persistence (conversations, tasks, sessions)
    memory.js              # Persistent memory with LLM extraction
    compactor.js           # Model-aware context compaction
    vault.js               # AES-256-GCM credential encryption
    workflows.js           # Multi-step automation engine
    scheduler.js           # Cron-based task scheduler
    keystore.js            # API key vault + OS Keychain
    mcp.js                 # MCP client (stdio JSON-RPC 2.0)
    preload.js             # contextBridge → window.onicode API
    ...                    # 10+ more modules

  chat/                    # React 19 renderer (TypeScript .tsx)
    App.tsx                # Root component, mode switching, search
    components/
      ChatView/            # Main chat UI, streaming, tool steps
      SettingsPanel/       # Settings tabs (Profile, Appearance, Providers, etc.)
      Sidebar.tsx          # Navigation, recent chats
      OnboardingDialog.tsx # Multi-step onboarding wizard
      ...                  # 15+ more components
    styles/                # CSS custom properties, 12 themes
    hooks/                 # useTheme
    ai/                    # System prompt builder
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 34 |
| UI | React 19 + TypeScript + Vite 6 |
| Styling | CSS custom properties (no framework) |
| State | React useState + localStorage |
| IPC | Electron contextBridge |
| Database | SQLite (via better-sqlite3) |
| AI | OpenAI, Anthropic, Ollama APIs |
| Browser | Puppeteer + Chrome DevTools Protocol |
| Encryption | AES-256-GCM + PBKDF2 + OS Keychain |

## Configuration

All user data lives in `~/.onicode/`:

```
~/.onicode/
  onicode.db           # SQLite (conversations, tasks, sessions, memories)
  providers.json       # AI provider config (backup)
  hooks.json           # Global hooks config
  mcp.json             # MCP server connections
  vault.enc            # Encrypted credential vault
  keystore.enc         # Encrypted API key store
  chrome-profile/      # Browser agent Chrome profile
  screenshots/         # Browser agent screenshots
  downloads/           # Browser agent downloads
  logs/                # Daily JSONL log files
  memory/              # Legacy markdown memories
```

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development setup and coding conventions
- Branch strategy and PR guidelines
- Areas to contribute (good first issues → advanced)

## Roadmap

- [x] AI chat with streaming (5 providers)
- [x] 80+ AI tools with permission enforcement
- [x] Browser agent (Chrome automation)
- [x] Multi-agent orchestration
- [x] Workflow engine + scheduler
- [x] MCP protocol + 55-server catalog
- [x] Credential vault (AES-256)
- [x] Memory system with LLM extraction
- [x] 12 themes with animated transitions
- [x] Onboarding wizard with account creation
- [ ] Editor Shell (VS Code workbench, lazy-loaded)
- [ ] Auto-updater (electron-updater)
- [ ] Windows + Linux support
- [ ] Mobile companion (React Native)
- [ ] Knowledge graph memory (entity/relation)

## Links

- **Website**: [onicode.dev](http://187.124.115.69)
- **Documentation**: [Docs](http://187.124.115.69/docs.html)
- **Issues**: [GitHub Issues](https://github.com/msichalwe/Onicode/issues)
- **Changelog**: [CHANGELOG.md](CHANGELOG.md)

## License

[MIT](LICENSE) — Mwansa Sichalwe, 2026
