# Onicode -- Product Vision

## What is Onicode

Onicode is an AI-powered development environment built as a native desktop application. The default experience is a premium conversational chat shell. When the user needs to write code, a full VS Code IDE slides out on demand. Both shells share a single AI engine.

Built on Electron 34 + React 19, Onicode is a native app -- not a web wrapper. It has full filesystem access, a real terminal, and no browser sandbox limitations.

## Core Experience

### Chat Shell (default)

The Chat Shell is the primary interface. It provides:

- Conversational AI with real-time streaming (dual-mode: OpenAI API + ChatGPT OAuth)
- 80+ AI tools spanning file operations, terminal, search, git, LSP, browser automation, deployment, and more
- Multi-agent orchestration with 5 specialist roles (researcher, implementer, reviewer, tester, planner)
- Inline tool results with expandable diffs, command output, and search results
- 20+ slash commands across 6 categories (chat, ai, project, terminal, panel, system)
- 12 built-in AI skills (prompt templates for common workflows)
- Real terminal sessions (not emulated -- actual shell via `child_process.spawn`)
- Project management with onidocs templates, file trees, and "Open in" external editors
- File/URL attachments with drag-and-drop, image paste, and @ mention system
- Markdown rendering with full GFM support
- Floating code editor with syntax highlighting (draggable, resizable, snappable)
- Session timer tracking AI working duration

### Editor Shell (planned)

The Editor Shell is a VS Code workbench that will load lazily when the user clicks "Open Editor." It will share the same AI engine as the Chat Shell, enabling seamless transitions between conversation and code editing. IDE state (active file, cursor position, manual edits) will be injected into the AI context.

## AI Architecture

### Dual-Mode Provider Routing

Onicode supports multiple AI providers with automatic routing:

- **OpenAI API keys (`sk-`)** route to `/v1/chat/completions` (standard SSE streaming)
- **ChatGPT OAuth JWT tokens** route to the ChatGPT Responses API with proper message format conversion
- **Gateway providers** (OniAI, OpenClaw) route to configurable base URLs

The Codex OAuth PKCE flow is fully handled in the main process -- no browser-side token handling.

### Tool System

80+ tools organized across domains:

- **File operations**: read, write, edit (with fuzzy matching), create, delete, move, search
- **Terminal**: real shell sessions, one-shot execution, streaming stdout/stderr
- **Git**: 16 tools covering status, diff, commit, branch, stash, merge, log, blame
- **Code intelligence**: LSP via TypeScript compiler API (4 tools), TF-IDF semantic search (2 tools)
- **Context engine**: 5 composite tools (find_implementation, impact_analysis, prepare_edit_context, smart_read, batch_search)
- **Browser**: 8 tools via Puppeteer (navigate, screenshot, click, type, evaluate, wait)
- **Orchestrator**: 3 tools for multi-agent coordination
- **Cascade-level**: ask_user_question, sequential_thinking, trajectory_search, find_by_name, read_url_content, view_content_chunk, read_notebook, edit_notebook, deployment tools
- **MCP**: Dynamic tools from external servers via stdio JSON-RPC 2.0

### Context Engine

A fast local retrieval layer that fires before every model call:

- Dependency graph built via regex-based import/export scanning (~8ms for 43 files)
- File outline caching with LSP + regex fallback
- Multi-signal file ranking (5 signals: filename relevance, TF-IDF content, import proximity, git recency, path heuristics)
- Pre-retrieval pipeline assembles ranked context in ~500ms, injected into the system prompt

### Multi-Agent Orchestration

5 specialist roles execute in parallel via a work graph with dependency tracking and file locks. The orchestrator produces structured markdown reports merging results from all agents.

### MCP Extensibility

Full Model Context Protocol client supporting stdio JSON-RPC 2.0 server management. External tools are discovered automatically and injected into the AI tool list alongside native tools. Config stored at `~/.onicode/mcp.json`.

## Key Differentiators

**Native desktop, not web.** Built on Electron with full filesystem access, real terminal sessions, and no browser sandbox. The AI operates directly on the user's machine.

**AI acts, doesn't suggest.** Onicode follows the "Act, Don't Talk" philosophy. The AI executes file edits, runs commands, manages git, and deploys -- it does not describe what it would do.

**Unified task and project system.** SQLite-backed task management with milestones, agile sprint grouping, and automatic task tracking throughout AI workflows. Projects include onidocs templates for architecture, scope, changelog, and README.

**Persistent memory.** Cross-session knowledge via soul.md, user.md, project-scoped memory, and daily logs. The AI remembers context from previous conversations.

**12 premium themes.** Sand, Midnight, Obsidian, Ocean, Aurora, Monokai, Rose Pine, Nord, Catppuccin, Default Light, Default Dark, Neutral. Smooth 500ms cross-fade transitions.

**Permission system.** Three modes (auto-allow, ask-destructive, plan-only) with per-tool allow/ask/deny controls. The user decides what the AI can do.

**Hooks system.** 19 hook types (PreToolUse, PostToolUse, PreEdit, PostEdit, PreCommit, PostCommit, OnDangerousCommand, etc.) with global and per-project configuration.

**Post-edit validation.** Automatic lint feedback after file edits -- JS/TS/JSON/Python syntax checking injected as tool results so the AI can self-correct.

## Target Users

Professional developers who want AI integrated deeply into their development workflow -- not as a sidebar chat widget, but as a capable agent that reads their codebase, executes changes, runs tests, manages git, and deploys.

## Philosophy

**"Act, Don't Talk."** The AI should execute tasks, not describe what it would do. When asked to fix a bug, it reads the code, makes the edit, runs the test, and reports the result. When asked to create a feature, it scaffolds files, writes implementation, and verifies the build.

The chat shell is the command center. The editor shell is the workbench. The AI is the engine that drives both.
