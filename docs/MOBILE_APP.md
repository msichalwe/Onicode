# Onicode — Mobile Companion App

## Overview

A React Native app that connects to your Onicode desktop via WebSocket. Chat with your AI, run commands, and manage your projects — from your phone.

## Features

| Feature                | Description                                  |
| ---------------------- | -------------------------------------------- |
| **AI Chat**            | Same conversation thread as desktop          |
| **Run Commands**       | Execute terminal commands remotely           |
| **Agent Activity**     | View and approve agent actions               |
| **Project Files**      | Browse project file tree (read-only)         |
| **Push Notifications** | Task complete, CI failed, PR review needed   |
| **Key Store**          | View (not reveal) stored keys                |
| **Quick Actions**      | "Deploy", "Run tests", "Pull latest" buttons |

## Connection

```
┌──────────┐    WebSocket     ┌──────────────┐
│  Mobile  │ ◄──────────────► │   Onicode    │
│   App    │   (encrypted)    │   Desktop    │
└──────────┘                  └──────────────┘
```

### Pairing

1. Onicode Desktop shows a QR code (Settings → Mobile)
2. Mobile app scans QR to pair
3. WebSocket connection established with shared secret
4. Connection persists across sessions (reconnects automatically)

### Security

- TLS-encrypted WebSocket
- Shared secret from QR pairing
- Optional: require biometric auth on mobile for sensitive actions
- Desktop approval required for destructive commands

## Example Flows

### From your phone at dinner:

```
💬 You: Hey Oni, are the tests passing on the auth branch?
🤖 Oni: Running `yarn test` on branch `feature/auth`...
        ✅ 47/47 tests passing. All green!

💬 You: Great, create a PR to main
🤖 Oni: Created PR #142 "Add authentication flow"
        → https://github.com/org/repo/pull/142
```

## Tech Stack

- **React Native** (iOS + Android)
- **Expo** for rapid development
- **WebSocket** for real-time communication
- **AsyncStorage** for local state
- **React Navigation** for routing
