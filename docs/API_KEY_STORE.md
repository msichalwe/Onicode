# Onicode — Global API Key Store

## The Problem

Every project needs a `.env` file. You have the same API keys copy-pasted across 20 projects. When you rotate a key, you forget half of them. Keys leak into git history. It's a mess.

## The Solution

Onicode has a **Global Key Vault** — a single encrypted store for all your API keys, tokens, and secrets. Keys are injected into project environments automatically.

## How It Works

```
┌────────────────────────────────────────────────────┐
│                  Key Vault (AES-256)                │
│                                                    │
│  ┌────────────┐  ┌────────────┐  ┌──────────────┐  │
│  │ OPENAI_KEY │  │ GITHUB_PAT │  │ STRIPE_KEY   │  │
│  │ sk-abc...  │  │ ghp_xyz... │  │ sk_live_...  │  │
│  │            │  │            │  │              │  │
│  │ Projects:  │  │ Projects:  │  │ Projects:    │  │
│  │ • All      │  │ • All      │  │ • shop-api   │  │
│  │            │  │            │  │ • payments   │  │
│  └────────────┘  └────────────┘  └──────────────┘  │
└────────────────────────────────────────────────────┘
          │
          ▼  Auto-inject
┌──────────────────┐
│ Project Terminal  │
│                  │
│ $ echo $OPENAI.. │  ← Available without .env
│ sk-abc123...     │
└──────────────────┘
```

## Features

| Feature               | Description                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Encrypted storage** | AES-256 encryption with OS keychain integration (macOS Keychain, Windows Credential Manager, Linux Secret Service) |
| **Auto-injection**    | Keys automatically available in project terminals — no `.env` needed                                               |
| **Scoping**           | Keys can be global (all projects) or scoped to specific projects/folders                                           |
| **Groups**            | Organize keys into groups (Development, Staging, Production)                                                       |
| **Rotation alerts**   | Track key age, remind you to rotate old keys                                                                       |
| **Import/Export**     | Import from `.env` files, export (encrypted) for backup                                                            |
| **Team sharing**      | (Future) Share encrypted key sets with team members                                                                |
| **Never in git**      | Keys live in the vault, never touch your repository                                                                |

## UI in Chat Shell

Access via **Settings → Key Store** or type `@keys` in chat:

```
💬 You: @keys show all
🤖 Oni: Here are your stored keys:

  🔑 OPENAI_API_KEY          ••••••abc123    Scope: All projects
  🔑 ANTHROPIC_API_KEY       ••••••xyz789    Scope: All projects
  🔑 GITHUB_TOKEN            ••••••ghp456    Scope: All projects
  🔑 STRIPE_SECRET_KEY       ••••••sk_live   Scope: shop-api, payments
  🔑 DATABASE_URL            ••••••postgres  Scope: backend-*

  [Add Key]  [Import .env]  [Export Backup]
```

## Auto-Inject Logic

When you open a project terminal in Onicode:

1. **Vault loads** all keys scoped to the current project
2. **Pattern matching**: keys scoped to `backend-*` match `backend-api`, `backend-worker`, etc.
3. **Environment injection**: keys are set as environment variables in the terminal process
4. **Process isolation**: keys are only in memory, never written to disk in the project
5. **Priority**: project-scoped keys override global keys (like staging DB vs prod DB)

## Migration from .env

When you open a project with a `.env` file, Onicode offers:

> "I found a .env file with 5 keys. Would you like to import them into your Key Vault?"
>
> [Import All] [Import Selected] [Ignore]

After import, optionally add `.env` to `.gitignore` and delete the file.

## Security Model

- **Encryption**: AES-256-GCM with random IV per entry
- **Master key**: Derived from OS keychain (macOS Keychain, etc.) — no password to remember
- **At rest**: Encrypted SQLite database in `~/.onicode/vault.db`
- **In memory**: Keys decrypted only when needed, cleared after process exits
- **No telemetry**: Keys never sent to any server, ever
- **Audit log**: Every key access is logged locally (which process, when)
