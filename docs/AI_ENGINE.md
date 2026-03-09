# Onicode — AI Engine

## Overview

The AI Engine is the shared brain between Chat Shell and Editor Shell. It handles model routing, context building, agent orchestration, inline completions, and the skills/knowledge system.

## Model Router

Routes AI requests to the right provider based on user configuration.

### Supported Providers

| Provider           | Models                          | Use Case                  |
| ------------------ | ------------------------------- | ------------------------- |
| **OniAI Gateway**  | All models via gateway          | Default — single endpoint |
| **OpenAI**         | GPT-4.1, o3, o4-mini            | General + coding          |
| **Anthropic**      | Claude Opus 4.5, Sonnet 4       | Deep reasoning + coding   |
| **Ollama (Local)** | Llama, CodeLlama, Mistral, etc. | Offline, privacy-first    |

### Routing Logic

```typescript
interface ModelConfig {
  chat: string; // Model for chat conversations
  completion: string; // Model for inline code completion (fast)
  agent: string; // Model for agentic tasks (powerful)
  embedding: string; // Model for context embeddings
}
```

Users configure which model to use for each purpose. Fast models for autocomplete, powerful models for agents.

## Context Engine

Builds intelligent context for every AI request.

### Context Sources

1. **Open files** — currently visible code
2. **Recent edits** — last N file changes
3. **Git diff** — uncommitted changes
4. **Codebase index** — vector embeddings via local FAISS/SQLite
5. **Conversation history** — recent chat messages
6. **Knowledge base** — persistent project/user knowledge
7. **`@mentions`** — explicit file/folder/symbol references

### Token Budget

Context is assembled to fit within the model's context window:

```
Priority 1: User's current message
Priority 2: @mentioned files/symbols
Priority 3: Open file content
Priority 4: Recent edits
Priority 5: Git diff
Priority 6: Retrieved knowledge
Priority 7: Codebase embeddings (fill remaining space)
```

## Agent Orchestrator

Multi-step autonomous task execution with tool use.

### Available Tools

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

### Approval Modes

| Mode           | Behavior                                      |
| -------------- | --------------------------------------------- |
| **Suggest**    | Show proposed changes, wait for user approval |
| **Auto-apply** | Apply changes immediately, allow undo         |
| **Full-auto**  | Sandboxed autonomous execution                |

### Multi-Agent Cascade

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

## Skills System

Skills are reusable capabilities the AI can invoke.

### Built-In Skills

| Skill         | Purpose                         |
| ------------- | ------------------------------- |
| `refactor`    | Intelligent code refactoring    |
| `test-writer` | Generate unit/integration tests |
| `debugger`    | Diagnose and fix errors         |
| `reviewer`    | Code review with suggestions    |
| `documenter`  | Generate documentation          |
| `translator`  | Convert code between languages  |

### Custom Skills

Users create project-specific skills as markdown:

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

## Inline Completions

Ghost-text completions in the editor, powered by fast AI models.

- **Trigger**: Automatic on typing pause (debounced 300ms)
- **Accept**: Tab key
- **Dismiss**: Escape or keep typing
- **Context**: Current file + imports + recent edits
- **Model**: Uses the `completion` model (optimized for speed)
