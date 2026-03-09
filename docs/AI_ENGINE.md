# Onicode — AI Engine

> **Last updated:** 2025-03-09
>
> This document describes both what's **currently implemented** and the **future design** for the full AI Engine.

---

## Current Implementation (v0.1.0)

### What's Built

The AI system currently lives in the main process (`src/main/index.js`) and chat shell (`src/chat/ai/`, `src/chat/commands/`).

### AI Chat (Implemented)

Streaming AI chat with dual-mode routing, handled entirely in the main process to avoid CORS.

**Provider Flow:**

1. User configures providers in Settings → Provider Settings
2. Provider config (id, apiKey, baseUrl, model) sent with each message via IPC
3. Main process routes based on token type:

| Token Type    | Endpoint                                     | SSE Format                   |
| ------------- | -------------------------------------------- | ---------------------------- |
| `sk-` API key | `https://api.openai.com/v1/chat/completions` | `choices[0].delta.content`   |
| OAuth JWT     | `chatgpt.com/backend-api/codex/responses`    | `response.output_text.delta` |
| Gateway key   | `${baseUrl}/v1/chat/completions`             | `choices[0].delta.content`   |

**ChatGPT Backend (Responses API) specifics:**

- Requires `chatgpt-account-id` header (extracted from JWT)
- Requires `OpenAI-Beta: responses=experimental` header
- Body uses `instructions` (not `system` role), `store: false`
- Uses Electron `net.fetch` for TLS compatibility

### Supported Providers (Implemented)

| Provider             | Auth Method        | Models                           | Status      |
| -------------------- | ------------------ | -------------------------------- | ----------- |
| **OpenAI Codex**     | `sk-` key or OAuth | GPT-5.x, GPT-4o, o4-mini, o3-pro | Implemented |
| **OniAI Gateway**    | URL + API key      | All models via gateway           | Implemented |
| **OpenClaw Gateway** | URL + API key      | Multi-model                      | Implemented |
| **Anthropic**        | API key            | Claude Opus, Sonnet              | Planned     |
| **Ollama (Local)**   | None (localhost)   | Llama, CodeLlama, Mistral, etc.  | Planned     |

### System Prompt Builder (Implemented)

`src/chat/ai/systemPrompt.ts` builds a context-aware system prompt including:

- Available slash commands (from registry)
- Terminal execution capabilities
- Project management capabilities
- Active project context (name, path, docs)
- Custom user-defined system prompts
- Output formatting guidelines

### Slash Command System (Implemented)

`src/chat/commands/registry.ts` + `executor.ts` — 20 commands across 6 categories:

| Category | Commands                                            |
| -------- | --------------------------------------------------- |
| Chat     | `/new`, `/clear`, `/chathistory`, `/export`         |
| AI       | `/model`, `/system`, `/context`, `/stop`, `/agents` |
| Project  | `/init`, `/projects`, `/open`                       |
| Terminal | `/run`, `/terminal`                                 |
| Panel    | `/browser`, `/files`                                |
| System   | `/help`, `/version`, `/status`                      |

### Terminal Execution (Implemented)

The AI can execute shell commands via the terminal system:

- `terminal-exec` IPC: runs a command to completion (30s timeout), returns stdout+stderr+exitCode
- Used by `/run <command>` slash command
- Real shell sessions (`/bin/zsh -l`) via `child_process.spawn`

---

## Future Design (Phase 2+)

> The following sections describe the **planned** architecture. None of this is implemented yet.

### Model Router

Routes AI requests to the right provider based on user configuration and task type.

```typescript
interface ModelConfig {
  chat: string; // Model for chat conversations
  completion: string; // Model for inline code completion (fast)
  agent: string; // Model for agentic tasks (powerful)
  embedding: string; // Model for context embeddings
}
```

Users configure which model to use for each purpose. Fast models for autocomplete, powerful models for agents.

### Context Engine

Builds intelligent context for every AI request.

**Context Sources:**

1. **Open files** — currently visible code
2. **Recent edits** — last N file changes
3. **Git diff** — uncommitted changes
4. **Codebase index** — vector embeddings via local FAISS/SQLite
5. **Conversation history** — recent chat messages
6. **Knowledge base** — persistent project/user knowledge
7. **`@mentions`** — explicit file/folder/symbol references

**Token Budget** (priority order):

```
Priority 1: User's current message
Priority 2: @mentioned files/symbols
Priority 3: Open file content
Priority 4: Recent edits
Priority 5: Git diff
Priority 6: Retrieved knowledge
Priority 7: Codebase embeddings (fill remaining space)
```

### Agent Orchestrator

Multi-step autonomous task execution with tool use.

**Available Tools:**

| Tool             | Description                                 |
| ---------------- | ------------------------------------------- |
| `file_read`      | Read file contents                          |
| `file_write`     | Create or modify files                      |
| `file_search`    | Search codebase with grep/ripgrep           |
| `terminal_run`   | Execute shell commands                      |
| `web_search`     | Search the internet                         |
| `browser_view`   | View web pages                              |
| `connector_call` | Invoke any connected service (GitHub, etc.) |
| `key_store_read` | Read API keys from vault                    |

**Approval Modes:**

| Mode           | Behavior                                      |
| -------------- | --------------------------------------------- |
| **Suggest**    | Show proposed changes, wait for user approval |
| **Auto-apply** | Apply changes immediately, allow undo         |
| **Full-auto**  | Sandboxed autonomous execution                |

**Multi-Agent Cascade:**

For complex tasks, the orchestrator can spawn parallel agents:

```
User: "Add authentication to the app"

Agent 1 (auth-models):     → Creates User model, JWT utilities
Agent 2 (auth-routes):     → Creates login/register API routes
Agent 3 (auth-middleware):  → Creates auth middleware
Agent 4 (auth-tests):      → Writes tests for all above

Orchestrator: Merges results, resolves conflicts, presents diff
```

Each agent works on a separate git worktree to avoid conflicts.

### Skills System

Skills are reusable capabilities the AI can invoke.

**Built-In Skills:**

| Skill         | Purpose                         |
| ------------- | ------------------------------- |
| `refactor`    | Intelligent code refactoring    |
| `test-writer` | Generate unit/integration tests |
| `debugger`    | Diagnose and fix errors         |
| `reviewer`    | Code review with suggestions    |
| `documenter`  | Generate documentation          |
| `translator`  | Convert code between languages  |

**Custom Skills** — users create project-specific skills as markdown:

```markdown
---
name: deploy
description: Deploy the application to production
---

## Steps

1. Run `yarn build` in the project root
2. Run `yarn test` to verify
3. If tests pass, run `./deploy.sh production`
4. Notify #deployments channel via Slack connector
```

### Inline Completions

Ghost-text completions in the editor, powered by fast AI models.

- **Trigger**: Automatic on typing pause (debounced 300ms)
- **Accept**: Tab key
- **Dismiss**: Escape or keep typing
- **Context**: Current file + imports + recent edits
- **Model**: Uses the `completion` model (optimized for speed)
