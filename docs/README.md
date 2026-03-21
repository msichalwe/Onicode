# Onicode Documentation

Technical documentation for the Onicode AI-powered workspace.

## Online Docs

Full documentation is available at **[onicode.dev/docs](http://187.124.115.69/docs.html)**.

## Documents in This Folder

| Document | Purpose |
|----------|---------|
| [PRODUCT_VISION.md](PRODUCT_VISION.md) | Core experience, key differentiators, target users |
| [ROADMAP.md](ROADMAP.md) | Development phases with status |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture, module map, IPC design, data flow |

## Quick Reference

| Area | Location | Format |
|------|----------|--------|
| Main process | `src/main/` | CommonJS `.js` (24+ modules) |
| Renderer | `src/chat/` | TypeScript `.tsx` (React 19) |
| Tool definitions | `src/main/tools/definitions.js` | OpenAI function schema |
| Tool executors | `src/main/tools/executor.js` | Switch/case dispatch |
| Styles | `src/chat/styles/` | CSS custom properties (12 themes) |
| Config | `~/.onicode/` | SQLite, JSON, encrypted vaults |
| Logs | `~/.onicode/logs/` | Daily JSONL files |

## For Contributors

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development setup, coding conventions, and PR guidelines.

## For AI Assistants

The primary reference for working on Onicode is [`/CLAUDE.md`](../CLAUDE.md) at the project root. It contains coding conventions, architecture notes, current status, and what's working vs. what's missing.
