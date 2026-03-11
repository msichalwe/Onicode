# Onicode -- Roadmap

## Phase 1: Foundation (DONE)

- Electron 34 scaffold with BrowserWindow and dev port auto-retry
- React 19 Chat Shell with Vite 6 build pipeline
- AI streaming with dual-mode routing (OpenAI API + ChatGPT OAuth)
- Codex OAuth PKCE flow (main process, no browser-side tokens)
- 12 themes with CSS custom properties and animated 500ms cross-fade transitions
- Sidebar navigation (Chat, Projects, Docs, Agents, Settings)
- Slash command system (20+ commands across 6 categories, autocomplete)
- AI provider settings (3 providers, test connection)
- Terminal backend (real shell sessions via child_process.spawn)
- Project init with onidocs templates (architecture, scope, changelog, README)
- Conversation history (localStorage)

## Phase 2: AI Tools & Intelligence (DONE)

- 80+ AI tools across file ops, terminal, search, git, LSP, browser, deployment
- LSP code intelligence via TypeScript compiler API (4 tools: definitions, references, symbols, diagnostics)
- TF-IDF semantic search indexer (2 tools: index, search)
- Context Engine with pre-retrieval pipeline (~500ms, fires before every model call)
  - Dependency graph (regex-based import/export scanning)
  - File outline caching (LSP + regex fallback)
  - Multi-signal file ranking (5 signals)
  - 5 composite tools: find_implementation, impact_analysis, prepare_edit_context, smart_read, batch_search
- Git integration (16 AI tools, 15 IPC handlers, full panel UI)
- Browser automation via Puppeteer (8 tools: navigate, screenshot, click, type, evaluate, wait)
- Markdown rendering (marked library, full GFM)
- Floating editor (syntax highlighting, draggable/resizable/snappable)
- File/URL attachments with drag-and-drop, image paste, @ mentions

## Phase 3: Agentic System (DONE)

- Multi-agent orchestration (5 specialist roles: researcher, implementer, reviewer, tester, planner)
- Work graph with dependency tracking and parallel execution
- File lock registry preventing concurrent edits
- Sub-agent spawning with role-scoped tool access
- Agent runtime widget with real-time status tracking
- Hooks system (19 types: PreToolUse, PostToolUse, ToolError, PreEdit, PostEdit, PreCommand, PostCommand, OnDangerousCommand, PreCommit, PostCommit, OnTestFailure, OnTaskComplete, SessionStart, AIResponse, PreCompact, Stop, SubagentStop, UserPromptSubmit, Notification)
- Global + per-project hook configuration
- Permission system (3 modes: auto-allow, ask-destructive, plan-only)
- Per-tool allow/ask/deny with real approval gates in UI
- Unified task management (SQLite-backed, milestones, agile sprint grouping)
- Context compaction (auto-summarize at 60k tokens, mechanical + semantic modes)

## Phase 4: Cascade-Level Features (DONE)

- `ask_user_question` -- AI can ask the user clarifying questions mid-workflow
- `sequential_thinking` -- structured reasoning for complex problems
- `trajectory_search` -- search conversation history for past approaches
- `find_by_name` -- fast file/symbol lookup by name
- `read_url_content` + `view_content_chunk` -- paginated web content reading
- `read_notebook` + `edit_notebook` -- Jupyter .ipynb file support
- Deployment tools (read_deployment_config, deploy_web_app, check_deploy_status)
- Post-edit lint feedback (JS/TS/JSON/Python syntax checking after every edit)
- Cascade-inspired system prompt with intent classification and decision model
- Fuzzy edit matching (Levenshtein-based fallback for imprecise edits)
- Auto-backup before every file edit (~/.onicode/auto-backups/)

## Phase 5: Extensibility (DONE)

- MCP client (stdio JSON-RPC 2.0, tool discovery, dynamic tool injection)
- MCP settings UI (server list, connect/disconnect, tool count badges, add/remove)
- MCP auto-lifecycle (connect enabled servers on app start, disconnect on quit)
- Custom slash commands (.onicode/commands/*.md with $ARGUMENTS substitution)
- 5 default command templates: review, deploy, test, refactor, explain
- 12 built-in AI skills (prompt templates injected into system prompt)
- Unified memory system (soul.md, user.md, project-scoped, daily logs, cross-session)
- SQLite persistence layer (tasks, conversations, sessions)
- Conversation continuation (loads previous session context from SQLite)
- System prompt caching

## Phase 6: Code Quality & Refactoring (IN PROGRESS)

- Component extraction (ChatView and RightPanel are oversized, need decomposition)
- Shared utilities extraction from duplicated logic
- Documentation (ARCHITECTURE.md, PRODUCT_VISION.md, ROADMAP.md)
- CSS audit (ensure all components use theme variables, no hardcoded colors)
- Type safety improvements across IPC boundary

## Phase 7: Providers & Connectors (NEXT)

- Anthropic provider (Claude API with streaming)
- Ollama provider (local model support)
- GitHub OAuth connector (real implementation, replacing placeholder)
- Gmail OAuth connector
- API key vault (AES-256 encrypted storage with OS keychain integration)

## Phase 8: Editor Shell (PLANNED)

- VS Code workbench integration (lazy-loaded, only when user clicks "Open Editor")
- Shared AI engine between Chat Shell and Editor Shell
- IDE state injection (active file, cursor position, user manual edits as diffs)
- Seamless transitions between chat and editor views
- Editor-aware AI context (knows what file the user is looking at)

## Phase 9: Distribution (PLANNED)

- electron-updater for automatic updates
- App signing and notarization (macOS, Windows)
- Full SQLite conversation migration from localStorage
- Installer packaging for macOS (.dmg), Windows (.exe), Linux (.AppImage)
- Crash reporting and telemetry (opt-in)
