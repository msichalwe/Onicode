# Onicode — Connectors

## Overview

Connectors are native integrations that let Onicode interact with external services. Unlike extensions/plugins, connectors are **first-class citizens** with deep integration into the chat and agent systems.

## Why Connectors Matter

> "Hey Oni, create a PR with these changes, assign it to the team, and email the stakeholders a summary."

That's one sentence that uses **GitHub + Gmail** connectors in a single agent flow.

## Built-In Connectors

### GitHub

| Feature             | Description                         |
| ------------------- | ----------------------------------- |
| **Auth**            | OAuth App or Personal Access Token  |
| **PR Management**   | Create, review, merge PRs from chat |
| **Issue Tracking**  | View, create, comment on issues     |
| **Repo Operations** | Clone, fork, star, browse repos     |
| **Actions**         | Trigger workflows, view status      |
| **Notifications**   | Real-time PR reviews, CI status     |

**Chat examples:**

- "Create a PR from `feature/auth` to `main` with title 'Add login flow'"
- "Show me open issues labeled `bug`"
- "What's the CI status on my last commit?"

### Gmail

| Feature    | Description                       |
| ---------- | --------------------------------- |
| **Auth**   | Google OAuth 2.0                  |
| **Read**   | Search and read emails            |
| **Send**   | Compose and send emails from chat |
| **Drafts** | AI-written draft emails           |
| **Labels** | Organize with labels              |

**Chat examples:**

- "Summarize my unread emails"
- "Draft a reply to the client's last email about the API deadline"
- "Send a project update to team@company.com"

### Slack

| Feature           | Description                |
| ----------------- | -------------------------- |
| **Auth**          | Slack OAuth / Bot Token    |
| **Messages**      | Send/read channel messages |
| **Notifications** | Push deploy notifications  |
| **Threads**       | Reply to threads from chat |

### Jira / Linear

| Feature          | Description                        |
| ---------------- | ---------------------------------- |
| **Auth**         | API Token / OAuth                  |
| **Tickets**      | Create, update, transition tickets |
| **Sprints**      | View sprint board                  |
| **Link to code** | Associate commits/PRs with tickets |

### Notion

| Feature       | Description                          |
| ------------- | ------------------------------------ |
| **Auth**      | Integration token                    |
| **Pages**     | Read/write Notion pages              |
| **Databases** | Query Notion databases               |
| **Sync**      | Sync docs between Onicode and Notion |

### Vercel / Netlify

| Feature     | Description                   |
| ----------- | ----------------------------- |
| **Deploy**  | Trigger deployments from chat |
| **Preview** | Get preview URLs for branches |
| **Logs**    | View deployment logs          |

## Connector Architecture

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

## Custom Connectors

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
