# Onicode Documentation

Technical documentation for the Onicode AI-powered development environment.

## Documents

| Document | Purpose |
|----------|---------|
| [PRODUCT_VISION.md](PRODUCT_VISION.md) | What Onicode is, core experience, key differentiators, target users |
| [ROADMAP.md](ROADMAP.md) | Development phases with status (9 phases, Phase 6 in progress) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture, module map, IPC design, data flow |
| [cascade-tools-ref.md](cascade-tools-ref.md) | Cascade (Windsurf) AI tools reference — 33 sections, comparison baseline |

## Quick Reference

- **Main process**: `src/main/` — 19 CommonJS modules, 17.5K lines
- **Chat shell**: `src/chat/` — 22 TypeScript/React files, 11.5K lines
- **Styles**: `src/chat/styles/index.css` — single CSS file, 12 themes
- **Build**: `npm run dev` (Vite + Electron), `npm run build` (production)
- **Config**: `~/.onicode/` (projects, hooks, connectors, MCP, memories, logs, SQLite DB)

## For AI Assistants

The primary reference for working on Onicode is `/CLAUDE.md` at the project root. It contains coding conventions, architecture notes, current status, and what's working vs. what's missing. These docs provide deeper dives into specific areas.
