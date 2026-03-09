# Onicode — Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Onicode Desktop (Electron)                │
│                                                             │
│  ┌─────────────────┐  ┌──────────────────────────────────┐  │
│  │   Chat Shell     │  │        Editor Shell              │  │
│  │   (React)        │  │   (VS Code Workbench — lazy)     │  │
│  │                  │  │                                  │  │
│  │  • Chat UI       │  │  • Monaco Editor                 │  │
│  │  • Nav sidebar   │  │  • File Explorer                 │  │
│  │  • Project list  │  │  • Terminal                      │  │
│  │  • Doc editor    │  │  • Live Preview                  │  │
│  │  • Connectors    │  │  • Debugger                      │  │
│  └────────┬─────────┘  └──────────────┬───────────────────┘  │
│           │                           │                      │
│           └───────────┬───────────────┘                      │
│                       │                                      │
│              ┌────────▼────────┐                             │
│              │  Shell Manager  │  (Animate transitions)      │
│              └────────┬────────┘                             │
│                       │                                      │
│  ┌────────────────────▼──────────────────────────────────┐   │
│  │                 AI Engine (Shared)                     │   │
│  │                                                       │   │
│  │  Model Router → Context Engine → Agent Orchestrator   │   │
│  │       ↓              ↓                ↓               │   │
│  │  Key Store      Embeddings DB    Skills System        │   │
│  │       ↓              ↓                ↓               │   │
│  │  Connectors     Knowledge Base   Tool Registry        │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐   │
│  │              Provider Layer                           │   │
│  │  OniAI  |  OpenAI  |  Anthropic  |  Ollama (local)   │   │
│  └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
         ▲
         │ WebSocket
         ▼
  ┌──────────────┐
  │ Mobile App   │
  │ (React Native)│
  └──────────────┘
```

## Directory Structure

```
onicode/
├── docs/                          # Documentation (you are here)
├── src/
│   ├── main/                      # Electron main process
│   │   ├── app.ts                 # App entry point
│   │   ├── shellManager.ts        # Chat ↔ Editor shell transitions
│   │   ├── windowManager.ts       # Window creation and management
│   │   └── updater.ts             # Auto-update logic
│   │
│   ├── chat/                      # Chat Shell (React)
│   │   ├── App.tsx                # Chat shell root component
│   │   ├── components/
│   │   │   ├── ChatView.tsx       # Main chat interface
│   │   │   ├── MessageBubble.tsx  # Chat message rendering
│   │   │   ├── Sidebar.tsx        # Navigation sidebar
│   │   │   ├── ProjectList.tsx    # Project management
│   │   │   ├── DocEditor.tsx      # Document editor
│   │   │   └── ThemePicker.tsx    # Multi-theme selector
│   │   ├── hooks/
│   │   └── styles/
│   │
│   ├── editor/                    # Editor Shell (VS Code fork)
│   │   └── (VS Code workbench — loaded lazily)
│   │
│   ├── ai/                        # AI Engine
│   │   ├── modelRouter.ts         # Multi-provider routing
│   │   ├── contextEngine.ts       # RAG + codebase indexing
│   │   ├── agentOrchestrator.ts   # Multi-agent cascade
│   │   ├── completionProvider.ts  # Inline code completions
│   │   ├── skills/                # Skill definitions
│   │   └── knowledge/             # Persistent memory
│   │
│   ├── connectors/                # Third-party integrations
│   │   ├── github.ts              # GitHub connector
│   │   ├── gmail.ts               # Gmail connector
│   │   ├── slack.ts               # Slack connector
│   │   ├── jira.ts                # Jira connector
│   │   └── registry.ts            # Connector registry
│   │
│   ├── keystore/                  # Global API key vault
│   │   ├── vault.ts               # Encrypted key storage
│   │   ├── injector.ts            # Auto-inject into projects
│   │   └── ui/                    # Key management UI
│   │
│   ├── preview/                   # Live web preview
│   │   └── previewPanel.ts
│   │
│   ├── themes/                    # Theme engine
│   │   ├── engine.ts              # Theme application logic
│   │   ├── sand.json              # Oni Sand (light)
│   │   ├── midnight.json          # Oni Midnight (dark)
│   │   ├── obsidian.json          # Oni Obsidian (OLED)
│   │   └── ocean.json             # Oni Ocean (cool)
│   │
│   └── shared/                    # Shared utilities
│       ├── types.ts
│       ├── ipc.ts                 # Electron IPC channels
│       └── crypto.ts              # Encryption utilities
│
├── mobile/                        # Mobile companion (React Native)
├── resources/                     # Icons, splash screens, assets
├── build/                         # Build scripts and CI/CD
├── package.json
└── electron-builder.yml
```

## Key Design Decisions

| Decision                                  | Rationale                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| Chat shell in React (not VS Code webview) | Full control over UX, faster iteration, no VS Code dependency for chat             |
| Editor shell loads lazily                 | Fast startup — chat loads in <1s, VS Code loads only when "Open Editor" is clicked |
| AI engine is shared between shells        | Same conversation context whether you're in chat or editor mode                    |
| Electron for desktop                      | Required for VS Code compatibility, plus native OS integration                     |
| SQLite for local data                     | Embeddings, conversation history, knowledge base — all local, fast, portable       |
| AES-256 for key vault                     | API keys encrypted at rest with user's master password or OS keychain              |
