# Onicode — Connectors

> **Last updated:** 2025-03-09
>
> Connectors are **not yet implemented**. This document describes the current state and planned design.

---

## Current State (v0.1.0)

The Settings panel (`SettingsPanel.tsx`) shows three connector items as **placeholders**:

- **GitHub** — listed but no functionality
- **Gmail** — listed but no functionality
- **Slack** — listed but no functionality

Clicking these items currently does nothing. The connector system needs to be built.

### Design Decision: OAuth-First Auth

Per user requirements, connectors should use **OAuth flows that don't require manual API key generation**:

- **GitHub** → GitHub OAuth App flow (user clicks "Connect", authorizes, gets token automatically)
- **Gmail** → Google OAuth 2.0 (user clicks "Connect", authorizes via Google, gets token automatically)
- **Slack** → Slack OAuth (user clicks "Connect", authorizes via Slack)

This mirrors the existing Codex OAuth PKCE pattern already implemented in the main process.

---

## Planned Design

### Why Connectors Matter

> "Hey Oni, create a PR with these changes, assign it to the team, and email the stakeholders a summary."

That's one sentence that uses **GitHub + Gmail** connectors in a single agent flow.

### Built-In Connectors

#### GitHub

| Feature             | Description                         |
| ------------------- | ----------------------------------- |
| **Auth**            | GitHub OAuth App (no manual PAT)    |
| **PR Management**   | Create, review, merge PRs from chat |
| **Issue Tracking**  | View, create, comment on issues     |
| **Repo Operations** | Clone, fork, star, browse repos     |
| **Actions**         | Trigger workflows, view status      |
| **Notifications**   | Real-time PR reviews, CI status     |

#### Gmail

| Feature    | Description                       |
| ---------- | --------------------------------- |
| **Auth**   | Google OAuth 2.0 (no manual key)  |
| **Read**   | Search and read emails            |
| **Send**   | Compose and send emails from chat |
| **Drafts** | AI-written draft emails           |
| **Labels** | Organize with labels              |

#### Slack

| Feature           | Description                |
| ----------------- | -------------------------- |
| **Auth**          | Slack OAuth (no bot token) |
| **Messages**      | Send/read channel messages |
| **Notifications** | Push deploy notifications  |
| **Threads**       | Reply to threads from chat |

#### Jira / Linear

| Feature          | Description                        |
| ---------------- | ---------------------------------- |
| **Auth**         | OAuth                              |
| **Tickets**      | Create, update, transition tickets |
| **Sprints**      | View sprint board                  |
| **Link to code** | Associate commits/PRs with tickets |

#### Notion

| Feature       | Description                          |
| ------------- | ------------------------------------ |
| **Auth**      | Integration token                    |
| **Pages**     | Read/write Notion pages              |
| **Databases** | Query Notion databases               |
| **Sync**      | Sync docs between Onicode and Notion |

#### Vercel / Netlify

| Feature     | Description                   |
| ----------- | ----------------------------- |
| **Deploy**  | Trigger deployments from chat |
| **Preview** | Get preview URLs for branches |
| **Logs**    | View deployment logs          |

### Connector Architecture

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│ Chat / Agent │ ──► │ Connector        │ ──► │ External API │
│              │     │ Registry         │     │ (GitHub,     │
│ "Create PR"  │     │                  │     │  Gmail, etc) │
│              │ ◄── │ • Auth manager   │ ◄── │              │
│              │     │ • Rate limiter   │     │              │
│              │     │ • Response mapper│     │              │
└──────────────┘     └─────────────────┘     └──────────────┘
```

- Connectors register their capabilities with the Agent's **Tool Registry**
- The AI agent can autonomously decide which connector to invoke
- Credentials stored in the encrypted **Key Store** (see API_KEY_STORE.md)
- All OAuth flows handled in the main process (same pattern as Codex OAuth PKCE)

### Implementation Plan

1. **GitHub connector** (Phase 3, first priority)
   - Register GitHub OAuth App (client ID + secret in main process)
   - OAuth flow in main process (open browser → callback → token exchange)
   - Store token securely (key vault or encrypted localStorage)
   - IPC handlers: `github-repos`, `github-issues`, `github-prs`, `github-create-pr`, etc.
   - Expose in preload.js + window.d.ts
   - Settings UI: "Connect GitHub" button → OAuth flow → show connected account

2. **Gmail connector** (Phase 3, second priority)
   - Register Google OAuth 2.0 credentials
   - OAuth flow with Gmail scopes (`gmail.readonly`, `gmail.send`, `gmail.compose`)
   - IPC handlers: `gmail-list`, `gmail-read`, `gmail-send`, `gmail-draft`

3. **Slack connector** (Phase 3, third priority)
   - Slack OAuth with bot scopes
   - IPC handlers: `slack-channels`, `slack-send`, `slack-read`

### Custom Connectors

Users can add custom connectors via a simple JSON+TypeScript interface:

```typescript
export interface Connector {
  id: string;
  name: string;
  icon: string;
  auth: AuthConfig;
  tools: Tool[]; // Functions the agent can call
  webhooks?: Webhook[]; // Incoming event listeners
}
```
