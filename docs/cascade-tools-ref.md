---

# Cascade AI Tools — Complete Technical Reference

> Generated for project context. This document explains every tool available to Cascade (the AI pair-programmer inside Windsurf IDE), how each one works internally, what parameters they accept, and when they are invoked.

---

## Table of Contents

1. [Code Search (Fast Context)](#1-code-search-fast-context)
2. [Sequential Thinking](#2-sequential-thinking)
3. [Terminal Commands](#3-terminal-commands)
4. [Command Status](#4-command-status)
5. [File Reading](#5-file-reading)
6. [File Editing (Single)](#6-file-editing-single)
7. [File Editing (Multi)](#7-file-editing-multi)
8. [File Creation](#8-file-creation)
9. [Directory Listing](#9-directory-listing)
10. [Find by Name](#10-find-by-name)
11. [Grep Search](#11-grep-search)
12. [Jupyter Notebook Read](#12-jupyter-notebook-read)
13. [Jupyter Notebook Edit](#13-jupyter-notebook-edit)
14. [Browser Preview](#14-browser-preview)
15. [URL Content Reader](#15-url-content-reader)
16. [View Content Chunk](#16-view-content-chunk)
17. [Web Search](#17-web-search)
18. [Todo List / Plan Management](#18-todo-list--plan-management)
19. [Deployment Tools](#19-deployment-tools)
20. [Trajectory Search](#20-trajectory-search)
21. [Terminal Reader](#21-terminal-reader)
22. [MCP: Git Server](#22-mcp-git-server)
23. [MCP: Memory Server](#23-mcp-memory-server)
24. [MCP: Puppeteer Server](#24-mcp-puppeteer-server)
25. [MCP: Sequential Thinking Server](#25-mcp-sequential-thinking-server)
26. [Ask User Question](#26-ask-user-question)
27. [Tool Invocation Rules & Parallelism](#27-tool-invocation-rules--parallelism)
28. [How Cascade Works — System Architecture](#28-how-cascade-works--system-architecture)
29. [Task Execution Pipeline — From Prompt to Result](#29-task-execution-pipeline--from-prompt-to-result)
30. [Complex Task Orchestration — Real-World Walkthrough](#30-complex-task-orchestration--real-world-walkthrough)
31. [Decision-Making Model — How Cascade Chooses What To Do](#31-decision-making-model--how-cascade-chooses-what-to-do)
32. [Context Window, Token Budget & Memory Management](#32-context-window-token-budget--memory-management)
33. [What Cascade Receives Alongside Every User Request](#33-what-cascade-receives-alongside-every-user-request)

---

## 1. Code Search (Fast Context)

**Internal name:** `code_search`

**What the user sees it called:** "Fast Context"

### How It Works

This is a **sub-agent** — a separate AI search process that runs in the background. When invoked, it:

1. Receives a **natural-language query** describing what you want to find (e.g., "Find where authentication is handled in Express routes").
2. Spawns **parallel `grep` and `read_file` calls** over multiple internal turns.
3. Explores the codebase iteratively: it greps for keywords, reads candidate files, narrows down, and returns the most relevant file snippets with line numbers.

### Parameters

| Parameter                    | Type   | Required | Description                                                                                          |
| ---------------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------- |
| `search_term`                | string | Yes      | A targeted natural-language query describing what you're looking for.                                |
| `search_folder_absolute_uri` | string | Yes      | Absolute path of the folder to search within. Must be a specific subfolder in multi-repo workspaces. |

### When It's Used

- **First tool called** when exploring an unfamiliar codebase or when the task involves more than a single known file.
- Cannot be called in parallel with other `code_search` calls (sequential only).
- Returns file paths, line ranges, and code snippets scored by relevance.

### Technical Details

- Internally executes `grep`, `read_file`, and analysis steps across multiple internal turns.
- Results are capped and may be incomplete — classical search tools (`grep_search`, `find_by_name`) are used afterwards if needed.
- The sub-agent can make mistakes in relevance scoring, so results are always critically evaluated.

---

## 2. Sequential Thinking

**Internal name:** `mcp6_sequentialthinking`

**MCP Server:** `sequential-thinking`

### How It Works

A structured **chain-of-thought reasoning engine** that breaks complex problems into numbered thought steps. Each thought can:

- Build on previous thoughts linearly.
- **Revise** a previous thought (mark `isRevision: true` and reference `revisesThought`).
- **Branch** from a previous thought into an alternative path (`branchFromThought` + `branchId`).
- Adjust the total number of thoughts dynamically (`totalThoughts` can increase or decrease).
- Generate and verify hypotheses before concluding.

### Parameters

| Parameter           | Type    | Required | Description                                                    |
| ------------------- | ------- | -------- | -------------------------------------------------------------- |
| `thought`           | string  | Yes      | The current thinking step content.                             |
| `nextThoughtNeeded` | boolean | Yes      | Whether another thought step follows.                          |
| `thoughtNumber`     | integer | Yes      | Current step number (1-indexed).                               |
| `totalThoughts`     | integer | Yes      | Current estimate of total steps needed.                        |
| `isRevision`        | boolean | No       | Whether this thought revises a previous one.                   |
| `revisesThought`    | integer | No       | Which thought number is being reconsidered.                    |
| `branchFromThought` | integer | No       | Branching point thought number.                                |
| `branchId`          | string  | No       | Identifier for the current branch.                             |
| `needsMoreThoughts` | boolean | No       | Signal that more thoughts are needed beyond original estimate. |

### When It's Used

- Complex multi-step problem solving.
- Debugging where root cause isn't immediately obvious.
- Planning and design tasks requiring iterative refinement.
- Any task where the full scope isn't clear initially.

---

## 3. Terminal Commands

**Internal name:** `run_command`

### How It Works

Proposes a shell command to run on the user's machine. The command does **not execute** until the user explicitly approves it (unless flagged as safe to auto-run). Runs in `zsh` on macOS with `PAGER=cat`.

### Parameters

| Parameter           | Type    | Required | Description                                                                                                                                                                                               |
| ------------------- | ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CommandLine`       | string  | Yes      | The exact command to execute. **Never includes `cd`**.                                                                                                                                                    |
| `Cwd`               | string  | No       | The working directory for the command. Used instead of `cd`.                                                                                                                                              |
| `Blocking`          | boolean | No       | If `true`, blocks until the command finishes. Use for short commands. If `false`, runs asynchronously (for dev servers, watchers, etc.).                                                                  |
| `WaitMsBeforeAsync` | integer | No       | Only for non-blocking. Milliseconds to wait before going fully async. Useful for catching quick startup errors.                                                                                           |
| `SafeToAutoRun`     | boolean | No       | If `true`, the command runs without user approval. Only set for truly safe, read-only commands. **Never auto-run destructive commands** (delete, install, external requests, etc.) even if the user asks. |

### Safety Rules

- Commands that delete files, install packages, mutate state, or make network requests are **always unsafe** and require user approval.
- `SafeToAutoRun` is only `true` for harmless read-only operations (e.g., `ls`, `cat`, `echo`).
- The user can configure an allowlist in their settings for auto-run exceptions.

### Technical Details

- Returns a `Background command ID` for non-blocking commands, which can be polled with `command_status`.
- Output is captured and returned. Long-running commands should use non-blocking mode.

---

## 4. Command Status

**Internal name:** `command_status`

### How It Works

Checks the status of a previously started **non-blocking** terminal command by its ID. Can optionally wait for the command to finish.

### Parameters

| Parameter              | Type    | Required | Description                                                                                                                              |
| ---------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `CommandId`            | string  | Yes      | The background command ID returned by `run_command`.                                                                                     |
| `OutputCharacterCount` | integer | Yes      | Number of characters to retrieve. Keep small to avoid memory issues.                                                                     |
| `WaitDurationSeconds`  | integer | No       | Seconds to wait for command completion before returning status. Max 60. Returns early if command finishes. Default: 0 (immediate check). |

### Return Values

- **Status:** `RUNNING` or `DONE`
- **Output:** The last N characters of stdout/stderr.
- **Exit code** (when done).

---

## 5. File Reading

**Internal name:** `read_file`

### How It Works

Reads the contents of a file at the given absolute path. Returns the file with **1-indexed line numbers** in `cat -n` format. For image files (jpg, png, gif, svg, etc.), the content is **presented visually** rather than as raw bytes.

### Parameters

| Parameter   | Type    | Required | Description                                              |
| ----------- | ------- | -------- | -------------------------------------------------------- |
| `file_path` | string  | Yes      | Absolute path to the file.                               |
| `offset`    | integer | No       | 1-indexed starting line. Only use for files >1000 lines. |
| `limit`     | integer | No       | Number of lines to read. Only use with `offset`.         |

### Technical Details

- Lines longer than 2000 characters are truncated.
- Only reads files in the workspace that are not `.gitignore`d.
- Can read temporary file paths (e.g., screenshot paths).
- Multiple `read_file` calls can be batched in parallel.
- **Must be called at least once** before any `edit` tool can modify a file.

---

## 6. File Editing (Single)

**Internal name:** `edit`

### How It Works

Performs an **exact string replacement** in a file. Finds `old_string` in the file and replaces it with `new_string`. This is a surgical, minimal edit — not a full file rewrite.

### Parameters

| Parameter     | Type    | Required | Description                                                                                        |
| ------------- | ------- | -------- | -------------------------------------------------------------------------------------------------- |
| `file_path`   | string  | Yes      | Absolute path to the file. **Generated first before other params.**                                |
| `old_string`  | string  | Yes      | The exact text to find and replace. Must be **unique** in the file (unless `replace_all` is true). |
| `new_string`  | string  | Yes      | The replacement text. Must differ from `old_string`.                                               |
| `replace_all` | boolean | No       | If `true`, replaces every occurrence of `old_string`. Useful for renaming variables.               |
| `explanation` | string  | Yes      | Human-readable description of the change.                                                          |

### Failure Conditions

- Fails if `old_string` is not found in the file.
- Fails if `old_string` is not unique (and `replace_all` is false).
- Fails if `old_string === new_string` (no-op).
- Fails if `read_file` was never called on this file first.

### Technical Details

- Whitespace and indentation must match exactly.
- Imports are always placed at the top of the file, never in the middle.
- Edits larger than ~300 lines are broken into multiple smaller edits.

---

## 7. File Editing (Multi)

**Internal name:** `multi_edit`

### How It Works

Performs **multiple sequential find-and-replace operations** on a single file in one atomic operation. All edits succeed or none are applied.

### Parameters

| Parameter     | Type   | Required | Description                                                                  |
| ------------- | ------ | -------- | ---------------------------------------------------------------------------- |
| `file_path`   | string | Yes      | Absolute path to the file.                                                   |
| `edits`       | array  | Yes      | Array of `{old_string, new_string, replace_all?}` objects. Applied in order. |
| `explanation` | string | Yes      | Description of all changes.                                                  |

### Technical Details

- Each edit operates on the **result of the previous edit** (sequential pipeline).
- If any single edit fails, the entire batch is rolled back.
- Same constraints as single `edit` tool (unique strings, exact matching, etc.).
- Preferred over single `edit` when making multiple changes to the same file.

---

## 8. File Creation

**Internal name:** `write_to_file`

### How It Works

Creates a **new file** (and any necessary parent directories). Never used to modify existing files.

### Parameters

| Parameter     | Type    | Required | Description                                          |
| ------------- | ------- | -------- | ---------------------------------------------------- |
| `TargetFile`  | string  | Yes      | Absolute path for the new file. **Generated first.** |
| `CodeContent` | string  | Yes      | The full contents to write.                          |
| `EmptyFile`   | boolean | Yes      | Set `true` to create an empty file.                  |

### Technical Details

- Parent directories are created automatically.
- Existence is always confirmed before calling (never overwrites).

---

## 9. Directory Listing

**Internal name:** `list_dir`

### How It Works

Lists all files and subdirectories in a given directory. Shows relative paths, file sizes (bytes), and recursive item counts for directories.

### Parameters

| Parameter       | Type   | Required | Description                     |
| --------------- | ------ | -------- | ------------------------------- |
| `DirectoryPath` | string | Yes      | Absolute path to the directory. |

---

## 10. Find by Name

**Internal name:** `find_by_name`

### How It Works

Searches for files/directories by name pattern using `fd` (a fast alternative to `find`). Uses smart case and respects `.gitignore` by default.

### Parameters

| Parameter         | Type     | Required | Description                                             |
| ----------------- | -------- | -------- | ------------------------------------------------------- |
| `SearchDirectory` | string   | Yes      | The directory to search within.                         |
| `Pattern`         | string   | Yes      | Glob pattern to match (e.g., `*.tsx`, `README*`).       |
| `Type`            | string   | No       | Filter: `file`, `directory`, or `any`.                  |
| `Extensions`      | string[] | No       | File extensions to include (without leading dot).       |
| `Excludes`        | string[] | No       | Glob patterns to exclude (e.g., `["node_modules/**"]`). |
| `MaxDepth`        | integer  | No       | Maximum directory depth to search.                      |
| `FullPath`        | boolean  | No       | If true, the full absolute path must match the glob.    |

### Technical Details

- Results capped at 50 matches.
- Returns type, size, modification time, and relative path for each result.

---

## 11. Grep Search

**Internal name:** `grep_search`

### How It Works

A powerful search tool built on **ripgrep** (`rg`). Searches file contents for a pattern (regex by default, or literal with `FixedStrings`).

### Parameters

| Parameter       | Type     | Required | Description                                                                                                   |
| --------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `SearchPath`    | string   | Yes      | File or directory to search.                                                                                  |
| `Query`         | string   | Yes      | The search pattern (regex by default).                                                                        |
| `Includes`      | string[] | No       | Glob filters (e.g., `["*.ts", "*.tsx"]`).                                                                     |
| `FixedStrings`  | boolean  | No       | Treat query as literal string (no regex).                                                                     |
| `CaseSensitive` | boolean  | No       | Default false (case-insensitive).                                                                             |
| `MatchPerLine`  | boolean  | No       | Show surrounding context with matches. **Only for specific, targeted searches** — not broad initial searches. |

### Technical Details

- Replaces manual `grep` or `rg` shell commands — those are never run via `run_command`.
- Results are truncated if too large; narrow the search with more specific queries or filters.
- Optimized for correct permissions and access within the workspace.

---

## 12. Jupyter Notebook Read

**Internal name:** `read_notebook`

### How It Works

Parses and displays a `.ipynb` file, showing cells with their IDs, types (code/markdown), source content, and outputs in a formatted view.

### Parameters

| Parameter      | Type   | Required | Description                         |
| -------------- | ------ | -------- | ----------------------------------- |
| `AbsolutePath` | string | Yes      | Absolute path to the `.ipynb` file. |

---

## 13. Jupyter Notebook Edit

**Internal name:** `edit_notebook`

### How It Works

Replaces the entire contents of a specific cell in a Jupyter notebook, or inserts a new cell.

### Parameters

| Parameter       | Type    | Required | Description                                              |
| --------------- | ------- | -------- | -------------------------------------------------------- |
| `absolute_path` | string  | Yes      | Absolute path to the `.ipynb` file. **Generated first.** |
| `new_source`    | string  | Yes      | New content for the cell.                                |
| `cell_number`   | integer | No       | 0-indexed cell number. Default: 0.                       |
| `cell_id`       | string  | No       | Alternative to `cell_number` for targeting cells.        |
| `edit_mode`     | string  | No       | `replace` (default) or `insert`.                         |
| `cell_type`     | string  | No       | `code` or `markdown`. Required for insert mode.          |

### Limitations

- Cannot delete cells — only replace content or insert new cells.

---

## 14. Browser Preview

**Internal name:** `browser_preview`

### How It Works

Spins up a browser preview pane for a running web server. The user clicks a button in the IDE to open it. Also captures console logs and server output.

### Parameters

| Parameter | Type   | Required | Description                                                                 |
| --------- | ------ | -------- | --------------------------------------------------------------------------- |
| `Url`     | string | Yes      | URL with scheme, domain, and port (e.g., `http://localhost:3001`). No path. |
| `Name`    | string | Yes      | Short 3-5 word title (e.g., "Starfall Story Game").                         |

---

## 15. URL Content Reader

**Internal name:** `read_url_content`

### How It Works

Fetches and reads content from a public HTTP/HTTPS URL. The user must **approve** the fetch request before it executes.

### Parameters

| Parameter | Type   | Required | Description                              |
| --------- | ------ | -------- | ---------------------------------------- |
| `Url`     | string | Yes      | The URL to fetch. Must be HTTP or HTTPS. |

---

## 16. View Content Chunk

**Internal name:** `view_content_chunk`

### How It Works

Views a specific chunk of a previously fetched web document. The document must have already been read by `read_url_content`.

### Parameters

| Parameter     | Type    | Required | Description                                              |
| ------------- | ------- | -------- | -------------------------------------------------------- |
| `document_id` | string  | Yes      | The document ID from a previous `read_url_content` call. |
| `position`    | integer | Yes      | The chunk position to view.                              |

---

## 17. Web Search

**Internal name:** `search_web`

### How It Works

Performs a web search and returns a list of relevant web documents/URLs for a given query.

### Parameters

| Parameter | Type   | Required | Description                               |
| --------- | ------ | -------- | ----------------------------------------- |
| `query`   | string | Yes      | The search query.                         |
| `domain`  | string | No       | Optional domain to prioritize in results. |

---

## 18. Todo List / Plan Management

**Internal name:** `todo_list`

### How It Works

Creates or updates a structured task list visible in the IDE. Each item has a status, priority, and unique ID. Used to track multi-step work and communicate progress.

### Parameters

| Parameter | Type  | Required | Description                                                               |
| --------- | ----- | -------- | ------------------------------------------------------------------------- |
| `todos`   | array | Yes      | Array of todo items, each with `id`, `content`, `status`, and `priority`. |

### Item Schema

| Field      | Values                                |
| ---------- | ------------------------------------- |
| `status`   | `pending`, `in_progress`, `completed` |
| `priority` | `high`, `medium`, `low`               |
| `id`       | Unique string identifier              |
| `content`  | Task description                      |

---

## 19. Deployment Tools

### 19a. Read Deployment Config

**Internal name:** `read_deployment_config`

Reads the deployment configuration for a web app to check if it's ready to deploy. Must be called **before** `deploy_web_app`.

| Parameter     | Type   | Required | Description                   |
| ------------- | ------ | -------- | ----------------------------- |
| `ProjectPath` | string | Yes      | Absolute path to the project. |

### 19b. Deploy Web App

**Internal name:** `deploy_web_app`

Deploys a JavaScript web application to a provider like Netlify. Only source files are needed (no pre-build required).

| Parameter     | Type   | Required | Description                                                                      |
| ------------- | ------ | -------- | -------------------------------------------------------------------------------- |
| `ProjectPath` | string | Yes      | Absolute path to the project.                                                    |
| `Framework`   | string | No       | Framework enum (e.g., `nextjs`, `sveltekit`, `astro`, `create-react-app`, etc.). |
| `Subdomain`   | string | No       | Unique subdomain for the URL. Leave empty for re-deploys.                        |
| `ProjectId`   | string | No       | Existing project ID for re-deploys. Leave empty for new sites.                   |

### 19c. Check Deploy Status

**Internal name:** `check_deploy_status`

Checks whether a deployment build succeeded and if the site has been claimed.

| Parameter              | Type   | Required | Description                              |
| ---------------------- | ------ | -------- | ---------------------------------------- |
| `WindsurfDeploymentId` | string | Yes      | The deployment ID from `deploy_web_app`. |

---

## 20. Trajectory Search

**Internal name:** `trajectory_search`

### How It Works

Searches or retrieves chunks from a previous conversation (trajectory). Used when the user `@mentions` a conversation. Returns up to 50 scored, sorted, and filtered chunks.

### Parameters

| Parameter    | Type   | Required | Description                             |
| ------------ | ------ | -------- | --------------------------------------- |
| `ID`         | string | Yes      | The cascade/conversation ID.            |
| `Query`      | string | Yes      | Search query (empty returns all steps). |
| `SearchType` | string | Yes      | `cascade` for conversations.            |

---

## 21. Terminal Reader

**Internal name:** `read_terminal`

### How It Works

Reads the current contents of an active terminal by its process ID. Used to inspect terminal output from running processes.

### Parameters

| Parameter   | Type   | Required | Description                 |
| ----------- | ------ | -------- | --------------------------- |
| `ProcessID` | string | Yes      | Process ID of the terminal. |
| `Name`      | string | Yes      | Name of the terminal.       |

---

## 22. MCP: Git Server

**MCP Server name:** `git`

A full suite of Git operations exposed via the Model Context Protocol. Each tool maps to a Git command:

| Tool              | Internal Name            | What It Does                             | Key Parameters                                                                                     |
| ----------------- | ------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Add**           | `mcp0_git_add`           | Stages files (`git add`)                 | `repo_path`, `files[]`                                                                             |
| **Branch**        | `mcp0_git_branch`        | Lists branches                           | `repo_path`, `branch_type` (`local`/`remote`/`all`), optional `contains`/`not_contains` commit SHA |
| **Checkout**      | `mcp0_git_checkout`      | Switches branches                        | `repo_path`, `branch_name`                                                                         |
| **Commit**        | `mcp0_git_commit`        | Commits staged changes                   | `repo_path`, `message`                                                                             |
| **Create Branch** | `mcp0_git_create_branch` | Creates a new branch                     | `repo_path`, `branch_name`, optional `base_branch`                                                 |
| **Diff**          | `mcp0_git_diff`          | Shows diff between branches/commits      | `repo_path`, `target`, optional `context_lines`                                                    |
| **Diff Staged**   | `mcp0_git_diff_staged`   | Shows staged changes                     | `repo_path`                                                                                        |
| **Diff Unstaged** | `mcp0_git_diff_unstaged` | Shows unstaged working directory changes | `repo_path`                                                                                        |
| **Log**           | `mcp0_git_log`           | Shows commit history                     | `repo_path`, optional `max_count`, `start_timestamp`, `end_timestamp`                              |
| **Reset**         | `mcp0_git_reset`         | Unstages all staged changes              | `repo_path`                                                                                        |
| **Show**          | `mcp0_git_show`          | Shows contents of a specific commit      | `repo_path`, `revision`                                                                            |
| **Status**        | `mcp0_git_status`        | Shows working tree status                | `repo_path`                                                                                        |

### Technical Details

- All tools require `repo_path` (absolute path to the Git repository).
- Timestamps accept ISO 8601, relative dates (`"2 weeks ago"`), or absolute dates.
- `git_log` defaults to 10 commits.

---

## 23. MCP: Memory Server

**MCP Server name:** `memory`

A **persistent knowledge graph** database. Stores entities (with types and observations) and relations between them. Data persists across conversations.

| Tool                    | Internal Name              | What It Does                                                                              |
| ----------------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| **Create Entities**     | `mcp2_create_entities`     | Creates new nodes in the knowledge graph with `name`, `entityType`, and `observations[]`. |
| **Add Observations**    | `mcp2_add_observations`    | Adds new observation strings to existing entities.                                        |
| **Create Relations**    | `mcp2_create_relations`    | Creates directed edges between entities (`from` -> `to` with `relationType`).              |
| **Delete Entities**     | `mcp2_delete_entities`     | Removes entities and their associated relations.                                          |
| **Delete Observations** | `mcp2_delete_observations` | Removes specific observations from entities.                                              |
| **Delete Relations**    | `mcp2_delete_relations`    | Removes specific relations.                                                               |
| **Open Nodes**          | `mcp2_open_nodes`          | Retrieves specific entities by name.                                                      |
| **Read Graph**          | `mcp2_read_graph`          | Returns the entire knowledge graph.                                                       |
| **Search Nodes**        | `mcp2_search_nodes`        | Searches entities by query matching names, types, and observation content.                |

### Technical Details

- Relations are always in **active voice** (e.g., "uses", "depends_on", "extends").
- The graph persists between sessions and can be used for long-term project context.
- Memories can become stale — always verify relevance.

---

## 24. MCP: Puppeteer Server

**MCP Server name:** `puppeteer`

Controls a headless (or headed) Chromium browser for web automation, testing, and screenshots.

| Tool           | Internal Name               | What It Does                                         | Key Parameters                                            |
| -------------- | --------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| **Navigate**   | `mcp5_puppeteer_navigate`   | Opens a URL in the browser                           | `url`, optional `launchOptions`, `allowDangerous`         |
| **Screenshot** | `mcp5_puppeteer_screenshot` | Captures a screenshot of the page or element         | `name`, optional `selector`, `width`, `height`, `encoded` |
| **Click**      | `mcp5_puppeteer_click`      | Clicks an element                                    | `selector` (CSS)                                          |
| **Fill**       | `mcp5_puppeteer_fill`       | Types into an input field                            | `selector`, `value`                                       |
| **Select**     | `mcp5_puppeteer_select`     | Selects an option in a `<select>` element            | `selector`, `value`                                       |
| **Hover**      | `mcp5_puppeteer_hover`      | Hovers over an element                               | `selector`                                                |
| **Evaluate**   | `mcp5_puppeteer_evaluate`   | Executes arbitrary JavaScript in the browser console | `script`                                                  |

### Technical Details

- `launchOptions` can configure headless mode, sandbox settings, etc. Changing them restarts the browser.
- `allowDangerous` must be explicitly set to allow insecure launch options like `--no-sandbox`.
- Screenshots can be returned as binary image or base64 data URI (`encoded: true`).

---

## 25. MCP: Sequential Thinking Server

Same as [Section 2](#2-sequential-thinking) — the sequential thinking tool is provided via an MCP server but functions identically.

---

## 26. Ask User Question

**Internal name:** `ask_user_question`

### How It Works

Presents the user with a multiple-choice question in the IDE chat. Up to 4 options, each with a label and description. The user can also provide a custom free-text response.

### Parameters

| Parameter       | Type    | Required | Description                                                                   |
| --------------- | ------- | -------- | ----------------------------------------------------------------------------- |
| `question`      | string  | Yes      | The question to ask.                                                          |
| `options`       | array   | Yes      | Up to 4 options, each with `label` and `description`. Never includes "other". |
| `allowMultiple` | boolean | Yes      | Whether the user can select more than one option.                             |

---

## 27. Tool Invocation Rules & Parallelism

### Invocation Format

All tools are called in XML-style blocks:

```xml
<function_calls>
  <invoke name="tool_name">
    <parameter name="param_name">value</parameter>
  </invoke>
</function_calls>
```

Multiple tools can be invoked inside a single `<function_calls>` block to run them **in parallel**.

### Parallelism Rules

1. **Independent calls run in parallel.** If two tool calls have no data dependency between them (e.g., reading two different files), they are batched into a single block and execute simultaneously.
2. **Dependent calls run sequentially.** If call B needs a value returned by call A, call A must finish first.
3. **`code_search` is always sequential.** It cannot be parallelized with other `code_search` calls.
4. **Destructive commands are never parallelized** with other destructive commands on the same resource.

### Execution & Safety Model

| Category                   | Behavior                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **User approval**          | All `run_command` calls require user approval unless `SafeToAutoRun` is true. `read_url_content` also requires approval. |
| **Auto-run**               | Only provably safe, read-only commands can be auto-run (e.g., `ls`, `cat`, `echo`, `pwd`).                               |
| **Never auto-run**         | File deletion, package installation, network requests, database mutations, anything with side effects.                   |
| **File edit precondition** | `read_file` must be called on a file at least once in the conversation before `edit` or `multi_edit` can touch it.       |
| **Max edit size**          | Individual edits stay under ~300 lines. Larger changes are broken into multiple edits.                                   |
| **Max output tokens**      | 64,000 tokens per generation. Tool results that are too large get truncated.                                             |

### Order of Preference

When gathering codebase context, tools are preferred in this order:

1. `code_search` — broad semantic exploration (first choice for new codebases)
2. `grep_search` — targeted pattern matching (after initial exploration)
3. `find_by_name` — locating files/directories by name or extension
4. `read_file` — reading specific known files
5. `list_dir` — browsing directory structure

When modifying code:

1. `edit` / `multi_edit` — surgical changes to existing files (always preferred)
2. `write_to_file` — only for creating brand new files
3. `run_command` — only when shell operations are truly necessary

---

## 28. How Cascade Works — System Architecture

Cascade is an **agentic AI coding assistant** embedded inside the Windsurf IDE. Unlike a simple chatbot that only generates text, Cascade is an autonomous agent that can read, write, search, execute, and verify code on your machine. Here is how the system is structured:

### 28.1 Core Components

```
+------------------------------------------------------------------+
|                        WINDSURF IDE                                |
|                                                                    |
|  +----------+   +--------------+   +----------------------+       |
|  |  Chat UI  |-->|  Cascade LLM |-->|  Tool Execution      |       |
|  |  (user)   |<--|  (reasoning) |<--|  Engine              |       |
|  +----------+   +------+-------+   +------+---------------+       |
|                        |                   |                       |
|              +---------v---------+   +-----v-----------------+    |
|              |  System Prompt &  |   |  File System Access    |    |
|              |  User Rules &     |   |  Terminal Access        |    |
|              |  Memory (MCP)     |   |  Browser Preview        |    |
|              +-------------------+   +-----------------------+    |
|                                                                    |
|  +------------------------------------------------------------+   |
|  |              MCP Servers (external processes)               |   |
|  |  +-----+ +--------+ +-----------+ +-------+ +-------+     |   |
|  |  | git | | memory | | puppeteer | | n8n   | |hostng |     |   |
|  |  +-----+ +--------+ +-----------+ +-------+ +-------+     |   |
|  +------------------------------------------------------------+   |
+------------------------------------------------------------------+
```

### 28.2 The LLM (Large Language Model) Layer

At its core, Cascade is a large language model. Every time you send a message, the following payload is assembled and sent to the model:

1. **System prompt** — A long, detailed instruction set that defines Cascade's behavior. It includes:
   - Communication style rules (be terse, no filler phrases, use markdown).
   - Tool definitions with JSON schemas for every parameter.
   - Safety constraints (never auto-run destructive commands).
   - Code style rules (preserve comments, imports at top, minimal edits).
   - Citation format rules for referencing files.
2. **User rules** — Custom rules you have configured (e.g., your "API-first delivery rules" are injected here as a `MEMORY[user_global]` block).
3. **Retrieved memories** — Entities from the persistent knowledge graph (MCP Memory server) that match the current context.
4. **IDE metadata** — The currently open file, cursor position, active workspace path, OS version.
5. **Conversation history** — All previous messages, tool calls, and tool results in this session.
6. **Your new message** — The actual request you just typed.

The model processes this entire payload and produces a **generation** — a response that may contain plain text, tool calls, or both. The max output per generation is **64,000 tokens**.

### 28.3 The Tool Execution Engine

When the model's generation includes tool calls, the IDE's execution engine:

1. **Parses** the XML tool call blocks from the generation.
2. **Validates** parameters against the tool's JSON schema.
3. **Checks safety** — If a `run_command` has `SafeToAutoRun: false`, the IDE shows an approval prompt to you. Nothing executes until you click "Allow".
4. **Dispatches** the call to the appropriate handler:
   - **Built-in tools** (`read_file`, `edit`, `grep_search`, etc.) are handled by the IDE's native file system layer.
   - **MCP tools** (`mcp0_git_*`, `mcp2_*`, `mcp5_puppeteer_*`, `mcp6_*`) are dispatched via JSON-RPC to the relevant MCP server process.
   - **Terminal tools** (`run_command`) spawn a shell process in the IDE's integrated terminal.
5. **Collects results** — stdout, stderr, file contents, search results, etc.
6. **Feeds results back** into the conversation as a `<function_results>` block.
7. **Triggers re-generation** — The model sees the results and produces its next response (which may include more tool calls, forming a loop).

This loop continues until the model produces a response with no tool calls — indicating the task step is complete.

### 28.4 The Agentic Loop

```
User Message
    |
    v
+-----------------+
| LLM Generation  |<---------------------+
| (text + tools)  |                       |
+--------+--------+                       |
         |                                |
    Has tool calls?                       |
    +----+----+                           |
    |Yes      |No                         |
    v         v                           |
+--------+  +----------+                 |
|Execute |  | Final    |                 |
| tools  |  | Response |                 |
+---+----+  | to User  |                 |
    |       +----------+                 |
    v                                    |
+-------------+                          |
|Tool Results |--------------------------+
|(fed back)   |
+-------------+
```

A single user message can trigger **many iterations** of this loop. For example, when you asked "build a Next.js story game", the loop executed approximately:

- 1 `code_search` call (exploration)
- 1 `run_command` for `npx create-next-app` (project creation, user-approved)
- 1 `command_status` poll (wait for npm install)
- 3 `edit` / file write calls (page.tsx, globals.css, layout.tsx)
- 2 `find_by_name` calls (check for existing files)
- 2 `write_to_file` calls (CHANGELOG.md, CHECKLIST.md)
- 2 `run_command` for lint + build (verification)
- 1 `run_command` for dev server (non-blocking)
- 1 `command_status` poll (confirm server started)

That's **~14 tool invocations** across **~8 loop iterations** from a single prompt.

### 28.5 Parallel Execution Within a Single Generation

Inside a single generation, Cascade can emit **multiple tool calls simultaneously**. The execution engine runs them in parallel when they are independent. For example:

```
Generation contains:
  - read_file("/src/app/page.tsx")
  - read_file("/src/app/layout.tsx")
  - read_file("/src/app/globals.css")
```

All three execute concurrently. The results return together, and the model sees all three files at once in the next iteration.

But if there's a dependency:

```
Generation 1: run_command("npm run build")     -> wait for result
Generation 2: run_command("npm run dev")        -> depends on build succeeding
```

These are sequential — generation 2 only happens after generation 1's result is fed back.

### 28.6 User Approval Gate

The system has a hard security boundary: **no destructive action executes without your explicit approval**. This applies to:

- `run_command` with `SafeToAutoRun: false` (installing packages, deleting files, running scripts, any network request).
- `read_url_content` (fetching external URLs).

The model cannot bypass this gate. Even if instructed to auto-run everything, the safety constraint is enforced at the IDE level, not the model level. The model can only _recommend_ `SafeToAutoRun: true` for provably safe, read-only commands.

### 28.7 IDE State Injection

Every time you send a message, the IDE injects metadata about your current state:

- **Active document** — Which file is open in the editor, and at what line the cursor sits.
- **Recent user actions** — If you manually edited files between messages, the IDE sends diffs of those changes so Cascade knows what you changed.
- **Lint errors** — If the IDE's linter detects errors in files Cascade recently edited, those errors are injected as feedback after tool results.

This means Cascade is **aware of your IDE state**, not just the chat. It can see what file you're looking at and react to lint errors in real-time.

---

## 29. Task Execution Pipeline — From Prompt to Result

When you type a request like _"add a login page with JWT auth"_, Cascade executes a structured internal pipeline. Here is exactly what happens at each stage:

### 29.1 Stage 1: Intent Classification

The model first classifies your request into one of several intent categories:

| Intent                | Example                                      | Primary Action                         |
| --------------------- | -------------------------------------------- | -------------------------------------- |
| **Build / Create**    | "Build a Next.js story game"                 | Scaffold project, write files          |
| **Fix / Debug**       | "Fix the login redirect bug"                 | Search code, identify root cause, edit |
| **Modify / Refactor** | "Add dark mode to the settings page"         | Read existing code, make edits         |
| **Explain / Answer**  | "How does the auth middleware work?"         | Search code, read files, explain       |
| **Run / Deploy**      | "Deploy this to Netlify"                     | Run commands, use deploy tools         |
| **Plan / Design**     | "How should I architect the payment system?" | Reason, produce plan, ask questions    |

The classification is implicit — it happens inside the model's reasoning, not as a separate tool call.

### 29.2 Stage 2: Context Gathering (The Exploration Phase)

Before writing any code, Cascade gathers context. The depth of exploration depends on task complexity:

**Simple task** (user points to a specific file and line):

```
read_file -> edit -> done
```

**Medium task** (feature in a known area):

```
code_search -> read_file (2-3 files) -> edit/multi_edit -> verify
```

**Complex task** (new feature across unknown codebase):

```
code_search -> grep_search -> find_by_name -> read_file (5-10 files)
-> sequential_thinking (plan) -> edit (multiple files) -> run_command (test)
-> command_status -> fix if needed -> verify
```

The key principle: **Cascade never guesses file contents**. It always reads before editing. If it hasn't read a file, the `edit` tool will literally refuse to execute.

### 29.3 Stage 3: Planning

For non-trivial tasks, Cascade creates an explicit plan using the `todo_list` tool. This plan:

- Appears as a visible checklist in the IDE sidebar.
- Has items marked `pending`, `in_progress`, or `completed`.
- Gets updated in real-time as work progresses.
- Can be revised when new information is discovered.

The plan follows a **one-step-at-a-time** discipline — only one item is `in_progress` at any moment.

For deeply complex problems, Cascade may also invoke `mcp6_sequentialthinking` to produce an internal chain-of-thought before committing to a plan. This is a private reasoning process that:

1. Breaks the problem into numbered thought steps.
2. Can revise earlier thoughts if new information contradicts them.
3. Can branch into alternative approaches.
4. Generates a hypothesis and verifies it before acting.

### 29.4 Stage 4: Implementation

Implementation follows a strict order:

1. **Edits to existing files** are always preferred over creating new files.
2. **Minimal, surgical edits** — Cascade replaces only the exact lines that need changing, preserving all surrounding code, comments, and formatting.
3. **Imports are added separately** — If a code change needs a new import, that's a separate edit at the top of the file, never injected in the middle.
4. **Large changes are chunked** — Any edit larger than ~300 lines is split into multiple sequential edits to stay within the 64K token output limit.

### 29.5 Stage 5: Verification

After implementation, Cascade verifies its work through available automated means:

| Verification Method            | Tool Used                                       | When It's Used                          |
| ------------------------------ | ----------------------------------------------- | --------------------------------------- |
| **Linter / type checker**      | `run_command` (e.g., `npm run lint`, `tsc`)     | After code changes                      |
| **Build**                      | `run_command` (e.g., `npm run build`)           | Before declaring a feature complete     |
| **Unit / integration tests**   | `run_command` (e.g., `npm test`)                | When test suite exists                  |
| **Dev server startup**         | `run_command` (non-blocking) + `command_status` | For web apps                            |
| **cURL endpoint verification** | `run_command` (cURL commands)                   | For API endpoints (per your user rules) |
| **Visual screenshot**          | `mcp5_puppeteer_screenshot`                     | When verifying UI rendering             |
| **IDE lint feedback**          | Automatic (injected by IDE)                     | After every edit                        |

If verification fails (lint errors, build errors, test failures), Cascade enters a **fix loop**:

```
Verify -> Fail -> Read error -> Diagnose -> Edit fix -> Verify again -> Pass
```

This loop continues until the verification passes or Cascade determines it needs your input.

### 29.6 Stage 6: Reporting

Once the task is complete, Cascade produces a structured summary. If your user rules define a specific output format (as yours do — PLAN, OPENAPI DIFF, CODE CHANGES, CURL COMMANDS, RUN LOGS, NEXT STEPS), that format is followed exactly.

### 29.7 Full Pipeline Diagram

```
+---------------+
| User Request  |
+------+--------+
       |
       v
+------------------+     +-----------------------+
| 1. CLASSIFY      |---->| What kind of task?     |
|    intent        |     | Build/Fix/Modify/etc.  |
+------+-----------+     +-----------------------+
       |
       v
+------------------+     +-----------------------+
| 2. EXPLORE       |---->| code_search            |
|    gather context|     | grep_search            |
|                  |     | find_by_name           |
|                  |     | read_file (batch)      |
+------+-----------+     +-----------------------+
       |
       v
+------------------+     +-----------------------+
| 3. PLAN          |---->| todo_list              |
|    create steps  |     | sequential_thinking    |
+------+-----------+     +-----------------------+
       |
       v
+------------------+     +-----------------------+
| 4. IMPLEMENT     |---->| edit / multi_edit      |
|    write code    |     | write_to_file          |
|                  |     | run_command             |
+------+-----------+     +-----------------------+
       |
       v
+------------------+     +-----------------------+
| 5. VERIFY        |---->| run_command (lint/test)|
|    check work    |     | puppeteer_screenshot   |
|                  |     | IDE lint feedback       |
+------+-----------+     +-----------------------+
       |                          |
       |  +-----------------------+
       |  | Failures loop back
       |  | to IMPLEMENT
       |  v
       v
+------------------+     +-----------------------+
| 6. REPORT        |---->| Structured summary     |
|    summarize     |     | per user format rules  |
+------------------+     +-----------------------+
```

---

## 30. Complex Task Orchestration — Real-World Walkthrough

This section walks through exactly how Cascade orchestrated the task _"build a Next.js interactive story game with a deep story, sci-fi sad story with a twisted ending, simple pixelated art and simple movement and mainly story choices"_ — the request that created this very project.

### 30.1 What Cascade Received

The raw input was a single chat message. Alongside it, the IDE injected:

- **OS:** macOS
- **No active workspace** (the user hadn't opened a project folder yet).
- **User rules** (your global `MEMORY[user_global]`): API-first delivery flow, always create CHANGELOG, CHECKLIST, use postgres/mongodb for DB, structured output format, etc.
- **No retrieved memories** from previous sessions.

### 30.2 Decision Tree — What Happened Internally

```
INPUT: "build a nextjs interactive story game..."
  |
  +- Intent: BUILD / CREATE (new project from scratch)
  |
  +- No workspace open -> Must create a new project folder
  |  +- User said "create in documents" -> target: /Users/msichalwe/Documents/
  |
  +- Stack inference:
  |  +- Framework: Next.js (user specified)
  |  +- Language: TypeScript (default for modern Next.js)
  |  +- Styling: Tailwind CSS (comes with create-next-app)
  |  +- Database: None needed (client-side game, no backend)
  |  +- Backend API: None needed -> user rule about API-first is noted but N/A
  |  +- Deployment: Not requested yet
  |
  +- Game design inference (from user's vague description):
  |  +- Genre: Sci-fi, sad, twisted ending
  |  +- Art: "simple pixelated" -> pixel font + grid-based movement
  |  +- Gameplay: "mainly story choices" -> branching narrative
  |  +- Movement: "simple movement" -> arrow keys / WASD on a small grid
  |  +- MVP scope: Short playable version (5-8 scenes, 2 endings)
  |
  +- Plan created with 5 steps
```

### 30.3 Execution Timeline — Tool by Tool

Here is the exact sequence of tool calls that were made, in order:

| Step | Tool                 | Purpose                                                          | Blocking? | Parallel? |
| ---- | -------------------- | ---------------------------------------------------------------- | --------- | --------- |
| 1    | `todo_list`          | Create 5-step plan visible in IDE sidebar                        | --        | No        |
| 2    | `run_command`        | `mkdir -p /Users/msichalwe/Documents` (ensure dir exists)        | Async     | No        |
| 3    | `command_status`     | Poll mkdir completion                                            | Wait 2s   | No        |
| 4    | `run_command`        | `npx create-next-app@latest starfall-last-signal --ts --app ...` | Async     | No        |
| 5    | `command_status`     | Poll npm install completion                                      | Wait 60s  | No        |
| 6    | `find_by_name`       | Check if AGENTS.md exists (standard check)                       | --        | No        |
| 7    | `todo_list`          | Mark step 1 complete, step 2 in-progress                         | --        | No        |
| 8    | `code_search`        | Find main page.tsx, globals.css, layout.tsx to replace           | --        | No        |
| 9    | `edit` (page.tsx)    | Replace entire default page with story game engine               | --        | No        |
| 10   | `edit` (globals.css) | Replace default styles with pixel-art theme                      | --        | No        |
| 11   | `edit` (page.tsx)    | Fix lint error — remove `mounted` state, use `typeof window`     | --        | No        |
| 12   | `edit` (globals.css) | Remove `@theme` block causing CSS warning                        | --        | No        |
| 13   | `edit` (layout.tsx)  | Replace Geist fonts with IBM Plex Mono + Press Start 2P          | --        | No        |
| 14   | `edit` (globals.css) | Remove Google Fonts `@import` (now handled by next/font)         | --        | No        |
| 15   | `find_by_name` x2    | Check CHANGELOG.md and CHECKLIST.md don't already exist          | --        | **Yes**   |
| 16   | `write_to_file` x1   | Create CHANGELOG.md                                              | --        | No        |
| 17   | `write_to_file` x1   | Create CHECKLIST.md                                              | --        | No        |
| 18   | `run_command` x2     | `npm run lint` + `npm run build`                                 | Blocking  | **Yes**   |
| 19   | `run_command`        | `npm run dev -- --port 3001`                                     | Async     | No        |
| 20   | `command_status`     | Confirm dev server is running                                    | Wait 10s  | No        |
| 21   | `edit` (CHECKLIST)   | Mark lint + smoke test as passed                                 | --        | No        |
| 22   | `todo_list`          | Mark all 5 steps completed                                       | --        | No        |

**Total: 22 tool invocations. ~12 agentic loop iterations. One user prompt.**

### 30.4 Key Moments Where Cascade Self-Corrected

During the build, the IDE injected lint feedback after edits. Cascade reacted to two issues:

1. **React lint error** — `setState` inside `useEffect` triggered an eslint violation. Cascade immediately removed the `mounted` state variable and switched to a `typeof window` guard instead. This is an example of the **IDE-feedback-driven fix loop**.

2. **CSS `@import` ordering warning** — The production build warned that `@import url(...)` must precede all rules. Cascade moved the fonts to `next/font/google` in `layout.tsx` and removed the CSS import entirely. This required coordinated edits across two files (`layout.tsx` and `globals.css`).

Neither of these issues was caused by a "bug" in the original plan. They were emergent problems discovered during verification, and Cascade fixed them autonomously before reporting success.

### 30.5 What Cascade Did NOT Do (And Why)

| Skipped Action           | Reason                                                          |
| ------------------------ | --------------------------------------------------------------- |
| No OpenAPI spec          | No backend endpoints — this is a client-side game               |
| No cURL commands         | No API to verify                                                |
| No database setup        | Game state is in React state + localStorage                     |
| No test suite            | MVP scope — lint + build + dev server serves as smoke test      |
| No `ask_user_question`   | User's intent was clear enough to proceed without clarification |
| No `sequential_thinking` | Task was well-defined; structured reasoning wasn't needed       |

This demonstrates that Cascade **adapts its pipeline to the task**. It doesn't mechanically run every possible step — it runs only what's relevant.

---

## 31. Decision-Making Model — How Cascade Chooses What To Do

### 31.1 The Core Decision Heuristic

At every generation, Cascade's decision is shaped by a priority stack:

```
Priority 1: USER RULES (your MEMORY[user_global] -- always obeyed)
Priority 2: SAFETY CONSTRAINTS (never auto-run destructive commands)
Priority 3: TASK REQUIREMENTS (what the user actually asked for)
Priority 4: BEST PRACTICES (code quality, minimal edits, idiomatic style)
Priority 5: EFFICIENCY (parallel calls, minimal tool invocations)
```

If two priorities conflict, the higher one wins. For example:

- If your user rules say "always create a CHANGELOG" but the task is "just fix this one-line typo", the CHANGELOG still gets updated (Priority 1 beats Priority 5).
- If you say "auto-run all commands", Cascade still won't auto-run `rm -rf` (Priority 2 beats Priority 1).

### 31.2 When Cascade Acts vs. When It Asks

Cascade uses this decision tree to determine whether to act immediately or ask for clarification:

```
Is the user's intent clear?
+-- YES: Can I gather remaining details via tools?
|   +-- YES -> Act immediately (read files, search, infer)
|   +-- NO  -> Ask the user (use ask_user_question)
|
+-- NO: Is there a reasonable default?
    +-- YES -> Act with the default, mention the assumption
    +-- NO  -> Ask the user
```

**Examples of "act immediately":**

- "Fix the bug on the login page" -> Search for login-related code, read it, diagnose, fix.
- "Add a dark mode toggle" -> Find existing theme/styling code, implement toggle.

**Examples of "ask the user":**

- "Set up the database" -> Which database? Postgres? MongoDB? What schema?
- "Deploy this" -> To which provider? What domain? New site or existing?

### 31.3 How Cascade Chooses Between Tools

When multiple tools could accomplish the same goal, Cascade follows a preference order:

**For searching code:**

| Situation                              | Tool Choice    | Why                                               |
| -------------------------------------- | -------------- | ------------------------------------------------- |
| First time exploring unknown codebase  | `code_search`  | Broad semantic search, finds relevant areas fast  |
| Know roughly what you're looking for   | `grep_search`  | Precise pattern matching, faster than code_search |
| Looking for a specific file by name    | `find_by_name` | Fastest for filename-based lookup                 |
| Know the exact file, need to read it   | `read_file`    | Direct file access, no search overhead            |
| Need to understand directory structure | `list_dir`     | Shows tree structure with sizes                   |

**For modifying code:**

| Situation                                | Tool Choice     | Why                                            |
| ---------------------------------------- | --------------- | ---------------------------------------------- |
| Changing a few lines in an existing file | `edit`          | Surgical, minimal, preserves surrounding code  |
| Changing many parts of the same file     | `multi_edit`    | Atomic batch — all succeed or all rollback     |
| Creating a brand new file                | `write_to_file` | Only tool that creates files; never overwrites |
| Need to run a build/test/install         | `run_command`   | Shell execution with safety gate               |

**For reasoning:**

| Situation                           | Tool Choice               | Why                                       |
| ----------------------------------- | ------------------------- | ----------------------------------------- |
| Multi-step problem with unknowns    | `mcp6_sequentialthinking` | Structured chain-of-thought with revision |
| Need to track progress across steps | `todo_list`               | Visible plan in IDE sidebar               |
| Need external information           | `search_web`              | Web search for docs, APIs, error messages |
| Need to read a documentation page   | `read_url_content`        | Fetches and parses web pages              |

### 31.4 How Cascade Handles Ambiguity

When a request is ambiguous, Cascade uses **inference from available context** rather than asking by default:

1. **Check open file** — If you have `auth.ts` open and say "fix this", Cascade reads `auth.ts` first.
2. **Check cursor position** — If you're on line 45 of a file and say "this function is broken", Cascade focuses on the function containing line 45.
3. **Check recent edits** — If you just manually edited 3 lines and say "this doesn't work", the IDE sends those diffs, and Cascade examines what you changed.
4. **Check user rules** — Your global rules specify stack preferences, output formats, and workflow patterns that resolve many ambiguities.
5. **Check project files** — `package.json`, `tsconfig.json`, `.env.example`, etc. reveal the stack, dependencies, and conventions.

Only after exhausting all contextual inference does Cascade ask you a direct question.

### 31.5 How Cascade Handles Failure

When something goes wrong mid-task:

```
Error occurs
    |
    v
Is it a lint/type/build error in code I just wrote?
+-- YES -> Read the error message, diagnose, edit the fix, re-verify
|         (autonomous fix loop, no user interaction needed)
|
+-- Is it a permission/environment error?
|   +-- YES -> Report to user with suggested fix command
|   +-- NO  |
|
+-- Is it an unknown/external error?
|   +-- Can I search the web for it? -> search_web, read docs, try fix
|   +-- NO -> Report to user with full error output, ask for guidance
|
+-- Have I already tried to fix this same error 2+ times?
    +-- YES -> Stop looping, report to user, explain what I tried
```

The key principle: **Cascade will autonomously fix errors it caused, but escalates to the user for environment issues or when it's stuck in a loop.**

### 31.6 Proactive vs. Careful Mode

Cascade calibrates its autonomy based on what you ask:

| User Says                           | Cascade's Interpretation            | Behavior                            |
| ----------------------------------- | ----------------------------------- | ----------------------------------- |
| "Build me a ..."                    | Full autonomy expected              | Scaffold, implement, verify, report |
| "How should I ..."                  | Advice expected, not implementation | Explain approach, don't write code  |
| "Fix the bug in ..."                | Implementation expected             | Diagnose and fix                    |
| "What does this code do?"           | Explanation expected                | Read and explain, no edits          |
| "Can you add X? But don't change Y" | Constrained implementation          | Implement X, explicitly avoid Y     |

---

## 32. Context Window, Token Budget & Memory Management

### 32.1 What Is the Context Window?

Every LLM has a finite **context window** — the maximum amount of text (measured in tokens) it can process in a single generation. For Cascade, this includes:

- The system prompt (~3,000-5,000 tokens)
- Your user rules (~500-2,000 tokens depending on size)
- All conversation history (messages + tool results)
- IDE metadata and injected lint errors
- The current message

As a conversation grows, this window fills up. When it approaches the limit, the system must manage what stays and what gets summarized or dropped.

### 32.2 Token Budget Breakdown

| Component                     | Approximate Token Cost | Notes                                              |
| ----------------------------- | ---------------------- | -------------------------------------------------- |
| System prompt + tool schemas  | ~4,000-6,000           | Fixed cost every generation                        |
| User rules (MEMORY)           | ~500-2,000             | Fixed cost, scales with rule complexity            |
| Each user message             | ~50-500                | Varies by length                                   |
| Each tool result              | ~100-5,000             | `read_file` of a 200-line file ~ 2,000 tokens      |
| Each `code_search` result     | ~1,000-3,000           | Returns multiple file snippets                     |
| Each `grep_search` result     | ~200-1,000             | Depends on number of matches                       |
| Each `run_command` result     | ~100-2,000             | Depends on stdout length                           |
| **Max output per generation** | **64,000 tokens**      | Hard limit on what Cascade can produce in one turn |

### 32.3 How Cascade Manages Long Conversations

As a conversation grows beyond the context window limit:

1. **Automatic summarization** — The system condenses older messages and tool results into summaries, keeping recent context intact.
2. **Tool result truncation** — Large outputs (e.g., reading a 1000-line file) are truncated, with a note that more content exists.
3. **Selective memory** — Cascade uses the MCP Memory server to store important facts persistently, so they survive across conversations even when the context window resets.

### 32.4 How Cascade Keeps Context Fresh Within a Session

Within a single session, Cascade uses several strategies to manage its "working memory":

1. **Read files lazily** — Only read files that are relevant to the current step, not the entire codebase upfront.
2. **Use `offset` and `limit`** — For large files (>1000 lines), read only the relevant section rather than the whole file.
3. **Minimize `OutputCharacterCount`** — When polling `command_status`, request only the characters needed (e.g., 2000-4000, not the full output).
4. **Avoid `MatchPerLine` on broad searches** — `grep_search` with `MatchPerLine: true` returns context around every match, which can be enormous. Only used for specific, targeted searches.
5. **Plan management** — The `todo_list` serves as a persistent plan that doesn't need re-reading; it's always visible in the sidebar.

### 32.5 Cross-Session Persistence: The Memory Knowledge Graph

The MCP Memory server (`mcp2_*` tools) provides **cross-session persistence**. This is how Cascade remembers things between separate conversations:

```
Session 1: User says "I prefer Tailwind over styled-components"
  -> Cascade calls mcp2_create_entities to store this preference
  -> Entity: {name: "UserPreferences", type: "preference",
     observations: ["Prefers Tailwind CSS over styled-components"]}

Session 2: User says "Style this component"
  -> System retrieves memory: "Prefers Tailwind CSS"
  -> Cascade uses Tailwind without asking
```

The knowledge graph stores three types of data:

| Type             | What It Stores                                  | Example                                                                                        |
| ---------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Entities**     | Named things with types and observation strings | `{name: "ProjectX", type: "project", observations: ["Uses Next.js 14", "Deployed on Vercel"]}` |
| **Relations**    | Directed edges between entities                 | `ProjectX` -> `uses` -> `PostgreSQL`                                                            |
| **Observations** | Individual facts attached to entities           | "API uses JWT tokens with 24h expiry"                                                          |

### 32.6 What Cascade Remembers vs. What It Forgets

| Persists Across Sessions         | Lost When Session Ends                     |
| -------------------------------- | ------------------------------------------ |
| MCP Memory entities/relations    | Conversation history (tool calls, results) |
| User rules (MEMORY[user_global]) | Files read into context                    |
| Git history (on disk)            | In-progress todo_list state                |
| Files on disk (of course)        | Background command IDs                     |

### 32.7 Practical Implications For You

1. **Long conversations get slower** — As the context window fills, each generation takes longer because the model processes more input. Starting a new conversation for a new task is faster.
2. **Cascade may "forget" earlier context** — In very long conversations, early messages get summarized. If you need Cascade to remember something specific, either:
   - Restate it in your current message.
   - Ask Cascade to store it in the Memory knowledge graph.
3. **File reads are ephemeral** — Just because Cascade read a file earlier in the conversation doesn't mean it "remembers" every line. It may need to re-read the file if the conversation is long.
4. **Your user rules are always present** — They're injected fresh every generation, so they never get summarized away. This is why putting important preferences in user rules is more reliable than stating them in chat.

---

## Quick Reference: All Tools at a Glance

| #   | Tool                | Internal Name             | Category           | MCP Server            |
| --- | ------------------- | ------------------------- | ------------------ | --------------------- |
| 1   | Code Search         | `code_search`             | Search             | --                    |
| 2   | Sequential Thinking | `mcp6_sequentialthinking` | Reasoning          | `sequential-thinking` |
| 3   | Terminal Command    | `run_command`             | Execution          | --                    |
| 4   | Command Status      | `command_status`          | Execution          | --                    |
| 5   | Read File           | `read_file`               | File I/O           | --                    |
| 6   | Edit File           | `edit`                    | File I/O           | --                    |
| 7   | Multi Edit          | `multi_edit`              | File I/O           | --                    |
| 8   | Write File          | `write_to_file`           | File I/O           | --                    |
| 9   | List Directory      | `list_dir`                | Search             | --                    |
| 10  | Find by Name        | `find_by_name`            | Search             | --                    |
| 11  | Grep Search         | `grep_search`             | Search             | --                    |
| 12  | Read Notebook       | `read_notebook`           | Jupyter            | --                    |
| 13  | Edit Notebook       | `edit_notebook`           | Jupyter            | --                    |
| 14  | Browser Preview     | `browser_preview`         | UI                 | --                    |
| 15  | Read URL            | `read_url_content`        | Web                | --                    |
| 16  | View Chunk          | `view_content_chunk`      | Web                | --                    |
| 17  | Web Search          | `search_web`              | Web                | --                    |
| 18  | Todo List           | `todo_list`               | Planning           | --                    |
| 19a | Deploy Config       | `read_deployment_config`  | Deploy             | --                    |
| 19b | Deploy App          | `deploy_web_app`          | Deploy             | --                    |
| 19c | Deploy Status       | `check_deploy_status`     | Deploy             | --                    |
| 20  | Trajectory Search   | `trajectory_search`       | Context            | --                    |
| 21  | Read Terminal       | `read_terminal`           | Execution          | --                    |
| 22  | Git (12 tools)      | `mcp0_git_*`              | Version Control    | `git`                 |
| 23  | Memory (9 tools)    | `mcp2_*`                  | Knowledge Graph    | `memory`              |
| 24  | Puppeteer (7 tools) | `mcp5_puppeteer_*`        | Browser Automation | `puppeteer`           |
| 25  | Sequential Thinking | `mcp6_sequentialthinking` | Reasoning          | `sequential-thinking` |
| 26  | Ask User            | `ask_user_question`       | Interaction        | --                    |

**Total: ~45 distinct tool functions** across 6 categories.

---

## How MCP (Model Context Protocol) Works

MCP is an open standard that connects AI systems with external tool servers. Each MCP server:

1. **Runs as a separate process** (local or remote).
2. **Exposes tools** (callable functions) and optionally **resources** (static data).
3. **Communicates via JSON-RPC** over stdio or HTTP.
4. Is configured in the IDE settings — Cascade discovers available servers at startup.

The MCP servers available in this environment:

| Server                | Purpose                                          |
| --------------------- | ------------------------------------------------ |
| `git`                 | Full Git CLI operations without shell commands   |
| `memory`              | Persistent knowledge graph across sessions       |
| `puppeteer`           | Headless browser control for testing/screenshots |
| `sequential-thinking` | Structured chain-of-thought reasoning            |
| `hostinger-mcp`       | Hosting provider integration                     |
| `n8n-mcp`             | Workflow automation integration                  |

---

## 33. What Cascade Receives Alongside Every User Request

This section documents the **complete payload** that arrives when you type a message. Your request is never sent alone — it is wrapped in multiple layers of system-injected context. Here is every component, in the order the model receives it.

### 33.1 Layer 1: The System Prompt

Before any conversation begins, a massive system prompt is injected. This is **invisible to you** but defines all of Cascade's behavior. It contains:

| Section                     | Content                                                                                                                         | Approx. Size         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **Identity**                | "You are Cascade, a powerful agentic AI coding assistant."                                                                      | ~50 tokens           |
| **Communication style**     | Rules for tone (terse, direct), markdown formatting, citation format for file paths, no filler phrases, no emojis unless asked. | ~800 tokens          |
| **Tool definitions**        | Full JSON schema for every tool — all ~45 tools with parameter names, types, required/optional flags, and descriptions.         | ~8,000-12,000 tokens |
| **Tool calling rules**      | When to batch parallel calls, when to sequence, never guess params.                                                             | ~300 tokens          |
| **Code editing rules**      | Prefer minimal edits, imports at top, max ~300 lines per edit, read before edit, immediately runnable code.                     | ~500 tokens          |
| **Task management rules**   | Use `todo_list`, keep plans concise, one step in-progress at a time.                                                            | ~200 tokens          |
| **Command execution rules** | Never use `cd`, use `Cwd` instead. Safety gate rules. Never auto-run destructive commands.                                      | ~400 tokens          |
| **Debugging rules**         | Address root cause, add logging, add tests to isolate.                                                                          | ~150 tokens          |
| **MCP server list**         | Names and brief descriptions of available MCP servers (git, memory, puppeteer, sequential-thinking, hostinger-mcp, n8n-mcp).    | ~200 tokens          |
| **API calling rules**       | Use compatible versions, never hardcode secrets, point out API key requirements.                                                | ~100 tokens          |
| **Workflow rules**          | How to read/create `.windsurf/workflows/*.md` files, `// turbo` annotation handling.                                            | ~300 tokens          |
| **Bug fixing discipline**   | Minimal upstream fixes, verify root cause, add regression tests.                                                                | ~100 tokens          |
| **Testing discipline**      | Design tests before implementation, never delete tests without instruction.                                                     | ~100 tokens          |
| **Planning cadence**        | Draft plan for non-trivial tasks, one step at a time, refresh after new constraints.                                            | ~100 tokens          |

**Total system prompt: ~11,000-15,000 tokens** — this is the fixed overhead on every single generation.

### 33.2 Layer 2: Your User Rules (MEMORY[user_global])

Immediately after the system prompt, your custom rules are injected inside a `<user_rules>` block. For your account, this is your full "API-FIRST DELIVERY RULES" document — all 28 rules, including:

```
# === API-FIRST DELIVERY RULES FOR WINDSURF (CASCADE) ===
1. Always follow an API-first flow: DESIGN -> IMPLEMENT -> PROVE WITH CURL -> FRONTEND.
2. Never scaffold UI until every required backend endpoint is implemented...
3. Before any code changes: produce a concise PLAN...
...
26. Always create a changelog...
27. Always create a checklist...
28. Database techstack should always be "postgres" or "mongodb"...
```

These rules are tagged as **highest priority** — I must follow them without exception, and they override any conflicting instruction from the system prompt. They persist across every message in every conversation because they are stored in your account settings, not in the chat.

### 33.3 Layer 3: User Information

A small block of metadata about your environment:

```xml
<user_information>
The USER's OS version is mac.
The USER does not have any active workspace. [or: The USER's workspace is at /path/...]
</user_information>
```

This tells me your operating system (affects shell commands — `zsh` vs `bash`, path formats) and whether you have a workspace open (affects where I create files).

### 33.4 Layer 4: Memory System

A header that explains the three types of memories:

1. **Global rules** — System-wide rules (your user rules from Layer 2).
2. **User-provided memories** — Context you explicitly told Cascade to remember (stored via MCP Memory server).
3. **System-retrieved memories** — Automatically retrieved from the knowledge graph based on relevance to the current message. These may or may not be relevant — I'm instructed to verify before using them.

If memories were retrieved, they appear here. If not, a line says "No MEMORIES were retrieved."

### 33.5 Layer 5: IDE Metadata (Injected Per-Message)

Every time you send a message, the IDE injects a metadata block:

```xml
<additional_metadata>
NOTE: Open files and cursor position may not be related to the user's
current request. Always verify relevance before assuming connection.

The USER presented this request to you on Mar 11, 2026 at 8:27am, UTC+02:00.

The current state of the user's IDE is as follows:
Active Document: /Users/msichalwe/Documents/starfall-last-signal/docs/cascade-tools-reference.md
  (LANGUAGE_MARKDOWN)
Cursor is on line: 1384
</additional_metadata>
```

This tells me:

- **Timestamp** of your request (useful for time-sensitive tasks).
- **Active document** — which file is currently open in your editor, and its language.
- **Cursor line** — exactly where your cursor sits in that file.

I'm explicitly warned that this metadata **may not be related** to your request — I only use it when it clearly connects to what you're asking.

### 33.6 Layer 6: User Actions (Between Messages)

If you manually edited files, switched tabs, or scrolled to specific lines between your messages, the IDE captures those actions and injects them:

```xml
<user_actions>
The following changes were made by the USER to: /path/to/file.md
[diff_block_start]
@@ -52,10 +52,10 @@
-| old table format |
+| new table format |
[diff_block_end]

The USER performed the following action in the IDE:
Show the contents of file /path/to/file.md from lines 681 to 696
</user_actions>
```

This is how I know:

- **What you manually edited** — I see the exact diffs of your changes, so I don't accidentally overwrite your work.
- **What you were looking at** — If you scrolled to a specific section, the IDE tells me which lines you viewed. This helps me understand what you're focused on.

There's a note saying: _"ONLY talk about this if it is directly relevant to the user's next request. Otherwise prioritize the actual user_request."_

### 33.7 Layer 7: Ephemeral System Messages

Occasionally, the system injects **ephemeral messages** — instructions from the Cascade runtime (not from you). These contain reminders like:

- "Remember to consider user rules and memories."
- "The TODO list has not been updated after N messages — update it if needed."
- "Do NOT output unnecessary filler phrases."
- "You will automatically have your work summarized if you run out of tokens."
- "Be persistent and only stop for true issues."

I'm instructed to **never acknowledge or refer to these messages** — they're invisible guidance that shapes behavior silently.

### 33.8 Layer 8: Conversation History

All previous messages in this session, including:

- Every message you sent.
- Every response I generated.
- Every tool call I made (the full XML invocation with parameters).
- Every tool result that came back (file contents, command output, search results).
- Every IDE-injected lint error that appeared after edits.

This history is what gives me "memory" within a session. But as described in Section 32, it gets summarized when the context window fills up.

### 33.9 Layer 9: Your Actual Message

Finally, your actual request — wrapped in a `<user_request>` block:

```xml
<user_request>
what instructions do you receive along with my request
</user_request>
```

### 33.10 Complete Assembly Order

Here is the exact order everything arrives in, from first to last:

```
1.  SYSTEM PROMPT (tool definitions, behavior rules, safety constraints)
2.  USER RULES (your MEMORY[user_global] -- API-first delivery rules)
3.  USER INFORMATION (OS, workspace path)
4.  MEMORY SYSTEM (retrieved memories from knowledge graph)
5.  --- Conversation history begins ---
6.  ... previous messages, tool calls, tool results ...
7.  --- Current turn ---
8.  EPHEMERAL MESSAGE (system reminders -- if any)
9.  USER ACTIONS (diffs of manual edits, viewed lines)
10. IDE METADATA (active file, cursor line, timestamp)
11. YOUR MESSAGE (the actual request)
```

### 33.11 What This Means In Practice

For your most recent message _"what instructions do you receive along with my request"_, I received approximately:

| Layer                | Content                                                                             |
| -------------------- | ----------------------------------------------------------------------------------- |
| System prompt        | ~12,000 tokens of behavior rules and tool schemas                                   |
| Your user rules      | Your 28 API-first delivery rules                                                    |
| User info            | macOS, no active workspace                                                          |
| Memory               | "No MEMORIES were retrieved"                                                        |
| Conversation history | All previous messages in this session (the game build + tools doc expansion)        |
| Ephemeral message    | Reminders about todo_list, no filler phrases, persistence                           |
| User actions         | You viewed lines 681-696 of the reference doc; your cursor is on line 1384          |
| IDE metadata         | Active file: `cascade-tools-reference.md`, cursor line 1384, timestamp 8:27am UTC+2 |
| Your message         | "what instructions do you receive along with my request"                            |

Every single generation I produce is shaped by all of these layers simultaneously.

---

_End of reference document._

---
