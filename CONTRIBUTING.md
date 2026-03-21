# Contributing to Onicode

Thank you for your interest in contributing to Onicode! This guide will help you get started.

## Getting Started

### Prerequisites

- **Node.js 20+** (check with `node --version`)
- **npm** (comes with Node.js)
- **macOS** (primary platform; Windows/Linux support coming soon)
- **Git**

### Setup

```bash
git clone https://github.com/msichalwe/Onicode.git
cd Onicode
npm install
npm run dev
```

This starts both the Vite dev server (port 5173) and Electron concurrently.

## Project Structure

```
src/
  main/               # Electron main process (CommonJS .js)
    index.js           # App entry, BrowserWindow, AI streaming
    browser.js         # Chrome/Puppeteer browser automation
    browserAgent.js    # Autonomous browser agent loop
    tools/
      definitions.js   # 80+ AI tool schemas
      executor.js      # Tool execution dispatch
    orchestrator.js    # Multi-agent orchestration
    memory.js          # Persistent memory system
    storage.js         # SQLite persistence
    ...               # 20+ more modules
  chat/               # React 19 renderer (TypeScript .tsx)
    App.tsx            # Root component, routing
    components/        # UI components
    styles/            # CSS (custom properties, 12 themes)
    hooks/             # React hooks (useTheme)
    ai/                # System prompt builder
```

## Development Workflow

### Coding Conventions

- **Main process**: CommonJS (`require`/`module.exports`), plain `.js` files
- **Renderer**: TypeScript + React functional components, `.tsx` files
- **Styling**: CSS with custom properties. No CSS-in-JS, no Tailwind.
- **State**: React `useState` + `localStorage`. No Redux/Zustand.
- **IPC**: Electron `contextBridge` via `window.onicode` (see `preload.js`)
- **Icons**: Inline SVG in JSX (no icon library)
- **Fonts**: Inter (UI) + JetBrains Mono (code)

### Key Patterns

```javascript
// Main process module pattern
function registerXxxIPC(ipcMain, getWindow) {
    ipcMain.handle('xxx-action', async (_event, args) => {
        // Handle action
    });
}
module.exports = { registerXxxIPC };
```

```tsx
// Renderer component pattern
export default function MyComponent({ prop }: Props) {
    const [state, setState] = useState(initial);
    // ...
    return <div className="my-component">...</div>;
}
```

### Build & Test

```bash
npm run dev          # Development (Vite + Electron hot reload)
npm run build        # Production build
npm run start        # Run production build
npm run package      # Create distributable (.dmg)
```

### Checking Your Work

```bash
node -c src/main/index.js        # Syntax check main process
npx vite build                    # Build check (TypeScript + CSS)
```

## Making Changes

### Branch Strategy

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Ensure syntax checks pass: `node -c src/main/<modified-file>.js`
5. Ensure build passes: `npx vite build`
6. Commit with a descriptive message
7. Push and open a Pull Request

### Commit Messages

Follow conventional commits:

```
feat: add browser tab isolation for parallel agents
fix: prevent Chrome from being killed during browser automation
docs: update AI tools reference table
refactor: extract tool executors into separate module
```

### Pull Request Guidelines

- **Title**: Short, descriptive (under 70 chars)
- **Description**: Explain what changed and why
- **Testing**: Describe how you tested the changes
- **Screenshots**: Include for UI changes
- Keep PRs focused — one feature or fix per PR

## Areas to Contribute

### Good First Issues

- Add new themes (CSS custom properties in `themes.css`)
- Add new slash commands (`src/chat/commands/registry.ts`)
- Improve tool descriptions in `definitions.js`
- Add MCP server entries to the catalog
- Fix typos and improve documentation

### Intermediate

- Add new AI tools (definition + executor + permissions)
- Build new widgets for the right panel
- Improve browser agent page analysis
- Add new workflow step types

### Advanced

- Add new AI provider integrations
- Build the Editor Shell (VS Code workbench)
- Implement auto-updater
- Windows/Linux platform support

## Reporting Issues

Use [GitHub Issues](https://github.com/msichalwe/Onicode/issues) with:

- **Bug reports**: Steps to reproduce, expected vs actual behavior, logs
- **Feature requests**: Use case, proposed solution
- **Questions**: Check existing issues first

## Code of Conduct

Be respectful, inclusive, and constructive. We're building something together.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
