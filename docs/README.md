# Onicode Documentation

> The AI-powered development environment that starts as a chat and expands into a full IDE.

## Contents

| Document                              | Description                                        |
| ------------------------------------- | -------------------------------------------------- |
| [Product Vision](./PRODUCT_VISION.md) | What Onicode is and why it exists                  |
| [Architecture](./ARCHITECTURE.md)     | Technical architecture and system design           |
| [Theming](./THEMING.md)               | Theme system, palettes, and customization          |
| [AI Engine](./AI_ENGINE.md)           | Model router, agents, skills, and context engine   |
| [Connectors](./CONNECTORS.md)         | GitHub, Gmail, and third-party integrations        |
| [API Key Store](./API_KEY_STORE.md)   | Global credential vault — no more .env per project |
| [Mobile App](./MOBILE_APP.md)         | Companion app specification                        |
| [Roadmap](./ROADMAP.md)               | Phased development plan                            |

## Quick Start (Development)

```bash
# Clone and install
git clone https://github.com/your-org/onicode.git
cd onicode
yarn install

# Build chat shell
yarn build:chat

# Launch in dev mode
yarn dev
```
