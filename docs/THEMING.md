# Onicode — Theme System

## Overview

Onicode ships with 4 premium built-in themes and supports custom user themes. Themes apply to **both** Chat Shell and Editor Shell seamlessly.

## Built-In Themes

### Oni Sand (Light — Default)

Warm, inviting, approachable. Feels like a premium chat app, not a dev tool.

| Token              | Value     | Usage                      |
| ------------------ | --------- | -------------------------- |
| `--bg-primary`     | `#F5EDE0` | Main background            |
| `--bg-secondary`   | `#EDE3D3` | Cards, panels              |
| `--bg-tertiary`    | `#E8D5B7` | Hover states, sidebar      |
| `--accent`         | `#C9A882` | Buttons, links, highlights |
| `--accent-hover`   | `#B8956E` | Button hover               |
| `--text-primary`   | `#2C2418` | Body text                  |
| `--text-secondary` | `#6B5D4F` | Muted text                 |
| `--border`         | `#D4C4AD` | Borders, dividers          |
| `--code-bg`        | `#E8DED0` | Code block background      |
| `--success`        | `#6B8F4A` | Success states             |
| `--error`          | `#C4553A` | Error states               |
| `--warning`        | `#D4943A` | Warning states             |

### Oni Midnight (Dark)

Deep, focused, luxurious. Warm golden accents on charcoal.

| Token              | Value     | Usage                      |
| ------------------ | --------- | -------------------------- |
| `--bg-primary`     | `#1A1A2E` | Main background            |
| `--bg-secondary`   | `#22223A` | Cards, panels              |
| `--bg-tertiary`    | `#2A2A42` | Hover states, sidebar      |
| `--accent`         | `#E8B54D` | Buttons, links, highlights |
| `--accent-hover`   | `#D4A03A` | Button hover               |
| `--text-primary`   | `#E8E0D4` | Body text                  |
| `--text-secondary` | `#8A8296` | Muted text                 |
| `--border`         | `#33334D` | Borders, dividers          |
| `--code-bg`        | `#16162A` | Code block background      |

### Oni Obsidian (OLED Dark)

True black for OLED screens. Copper and gold accents.

| Token            | Value     | Usage           |
| ---------------- | --------- | --------------- |
| `--bg-primary`   | `#0A0A0F` | Main background |
| `--bg-secondary` | `#121218` | Cards, panels   |
| `--accent`       | `#B87333` | Buttons, links  |
| `--text-primary` | `#D4CFC8` | Body text       |

### Oni Ocean (Cool)

Steel blue with teal highlights. Modern and techy.

| Token            | Value     | Usage           |
| ---------------- | --------- | --------------- |
| `--bg-primary`   | `#1B2838` | Main background |
| `--bg-secondary` | `#213040` | Cards, panels   |
| `--accent`       | `#4FD1C5` | Buttons, links  |
| `--text-primary` | `#D0D8E0` | Body text       |

## Theme Picker UX

- **Animated live preview**: click a theme → entire app cross-fades in 300ms
- **Sidebar toggle**: quick-switch icon in the navigation bar
- **Full picker**: Settings → Appearance → visual grid of theme previews
- **Custom themes**: import JSON files or create from within the UI
- **Scheduling**: auto-switch between light/dark based on time of day

## Implementation

Themes use CSS custom properties set on `:root`. The theme engine in `src/themes/engine.ts`:

1. Loads theme JSON from `src/themes/*.json`
2. Applies CSS variables to both Chat Shell and Editor Shell
3. For Editor Shell, maps tokens to VS Code's `workbench.colorCustomizations`
4. Persists selection in local settings
