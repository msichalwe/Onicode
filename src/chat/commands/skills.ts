/**
 * Built-in Skills Registry — Pre-built prompt templates for the AI
 *
 * Skills are specialized capabilities that enhance the AI's behavior.
 * They are injected into the system prompt when enabled.
 */

export type SkillMode = 'onichat' | 'workpal' | 'projects' | 'all';

export interface Skill {
    id: string;
    name: string;
    description: string;
    category: 'code' | 'review' | 'testing' | 'docs' | 'devops' | 'debug' | 'design' | 'data' | 'research' | 'security';
    prompt: string;
    enabled: boolean;
    icon: string;
    system?: boolean;
    modes: SkillMode[]; // Which modes this skill is relevant to. 'all' = every mode.
}

const STORAGE_KEY = 'onicode-skills';

export const DEFAULT_SKILLS: Skill[] = [
    {
        id: 'code-review',
        name: 'Code Review',
        description: 'Analyze code for bugs, security issues, performance problems, and best practices',
        category: 'review',
        icon: 'Review',
        modes: ["projects","workpal"],
        enabled: true,
        prompt: `When asked to review code or when you detect code that could be improved:
1. Check for bugs, edge cases, and logic errors
2. Check for security vulnerabilities (XSS, injection, auth issues)
3. Check for performance issues (N+1 queries, unnecessary re-renders, memory leaks)
4. Check for code style and best practices
5. Provide specific, actionable suggestions with code examples
6. Rate severity: critical, warning, info
Format: Use a structured review with sections for each category.`,
    },
    {
        id: 'refactor',
        name: 'Smart Refactor',
        description: 'Refactor code to improve readability, reduce duplication, and follow patterns',
        category: 'code',
        icon: 'Refactor',
        modes: ["projects"],
        enabled: true,
        prompt: `When refactoring code:
1. Identify code smells: duplication, long functions, deep nesting, magic numbers
2. Apply DRY, SOLID, and KISS principles
3. Extract reusable functions/components where beneficial
4. Improve naming for clarity
5. Always create a restore point before making changes
6. Show before/after comparisons
7. Ensure all tests still pass after refactoring`,
    },
    {
        id: 'test-gen',
        name: 'Test Generator',
        description: 'Generate comprehensive unit tests, integration tests, and E2E tests',
        category: 'testing',
        icon: 'Test',
        modes: ["projects"],
        enabled: true,
        prompt: `When generating tests:
1. Detect the testing framework (Jest, Vitest, Pytest, Go test, etc.)
2. Write tests for: happy path, edge cases, error handling, boundary values
3. Use descriptive test names that explain the expected behavior
4. Mock external dependencies appropriately
5. Aim for high coverage but prioritize meaningful tests over 100%
6. Include both unit tests and integration tests where appropriate
7. Run the tests after writing them to verify they pass`,
    },
    {
        id: 'doc-gen',
        name: 'Documentation',
        description: 'Generate README, API docs, JSDoc/TSDoc, and inline comments',
        category: 'docs',
        icon: 'Docs',
        modes: ["workpal","projects"],
        enabled: true,
        prompt: `When generating documentation:
1. Write clear, concise README.md with: overview, setup, usage, API reference
2. Add JSDoc/TSDoc to exported functions, classes, and interfaces
3. Document complex algorithms with inline comments explaining WHY
4. Generate API endpoint documentation with request/response examples
5. Include code examples for common use cases
6. Add architecture diagrams in markdown where helpful`,
    },
    {
        id: 'debug',
        name: 'Debugger',
        description: 'Systematic debugging with log analysis, stack traces, and root cause identification',
        category: 'debug',
        icon: 'Debug',
        modes: ["projects"],
        enabled: true,
        prompt: `When debugging issues:
1. Read the error message and stack trace carefully
2. Identify the root cause, not just the symptom
3. Check system logs with get_system_logs for recent errors
4. Add strategic console.log/print statements to narrow down the issue
5. Check for common causes: null/undefined, async timing, wrong types, missing imports
6. Fix the root cause, not just the error
7. Add error handling to prevent recurrence
8. Verify the fix by running the failing scenario`,
    },
    {
        id: 'git-workflow',
        name: 'Git Workflow',
        description: 'Smart git operations: commits, branches, PRs, conflict resolution',
        category: 'devops',
        icon: 'Git',
        modes: ["projects"],
        enabled: true,
        prompt: `When working with git:
1. Make atomic commits — one logical change per commit
2. Write conventional commit messages: type(scope): description
   Types: feat, fix, refactor, test, docs, chore, style, perf
3. After completing a major milestone, auto-commit with a descriptive message
4. Before risky changes, create a git branch
5. When resolving conflicts, understand both sides before choosing
6. Use git diff to review changes before committing`,
    },
    {
        id: 'perf-optimize',
        name: 'Performance',
        description: 'Profile and optimize code for speed, memory, and bundle size',
        category: 'code',
        icon: 'Perf',
        modes: ["projects"],
        enabled: true,
        prompt: `When optimizing performance:
1. Identify bottlenecks: slow queries, excessive re-renders, large bundles
2. For React: memo, useMemo, useCallback, lazy loading, code splitting
3. For APIs: caching, pagination, query optimization, connection pooling
4. For builds: tree shaking, minification, compression, lazy imports
5. Measure before and after — use benchmarks, not assumptions
6. Check bundle size with analysis tools`,
    },
    {
        id: 'security-audit',
        name: 'Security Audit',
        description: 'Scan for vulnerabilities: XSS, injection, auth flaws, exposed secrets',
        category: 'review',
        icon: 'Security',
        modes: ["projects"],
        enabled: true,
        prompt: `When auditing security:
1. Check for OWASP Top 10 vulnerabilities
2. Scan for exposed API keys, tokens, passwords in code
3. Verify input validation and sanitization
4. Check authentication and authorization logic
5. Review dependency vulnerabilities (npm audit, pip audit)
6. Check for insecure defaults (CORS *, debug mode in prod)
7. Verify HTTPS enforcement and secure cookie settings
8. Rate findings: critical, high, medium, low`,
    },
    {
        id: 'api-builder',
        name: 'API Builder',
        description: 'Design and implement REST/GraphQL APIs with validation and error handling',
        category: 'code',
        icon: 'API',
        modes: ["projects"],
        enabled: true,
        prompt: `When building APIs:
1. Follow REST conventions: proper HTTP methods, status codes, URL patterns
2. Add input validation with descriptive error messages
3. Implement proper error handling with consistent error response format
4. Add rate limiting and authentication middleware
5. Write OpenAPI/Swagger documentation
6. Create integration tests for each endpoint
7. Handle pagination, filtering, and sorting`,
    },
    {
        id: 'accessibility',
        name: 'Accessibility',
        description: 'Ensure WCAG compliance: ARIA labels, keyboard nav, screen readers, contrast',
        category: 'design',
        icon: 'A11y',
        modes: ["projects","workpal"],
        enabled: true,
        prompt: `When checking accessibility:
1. Add ARIA labels and roles to interactive elements
2. Ensure keyboard navigation works (tab order, focus management)
3. Check color contrast ratios (WCAG AA: 4.5:1 for text)
4. Add alt text to images
5. Ensure form inputs have labels
6. Test with screen reader semantics
7. Support reduced motion preferences`,
    },
    {
        id: 'ci-cd',
        name: 'CI/CD Setup',
        description: 'Set up GitHub Actions, Docker, deployment pipelines',
        category: 'devops',
        icon: 'CI/CD',
        modes: ["projects"],
        enabled: false,
        prompt: `When setting up CI/CD:
1. Create GitHub Actions workflows for: lint, test, build, deploy
2. Use caching for node_modules, pip cache, etc.
3. Set up Docker with multi-stage builds
4. Configure environment-specific deployments (staging, production)
5. Add health checks and rollback strategies
6. Set up automated security scanning`,
    },
    {
        id: 'database',
        name: 'Database Design',
        description: 'Design schemas, write migrations, optimize queries',
        category: 'data',
        icon: 'DB',
        modes: ["projects"],
        enabled: false,
        prompt: `When working with databases:
1. Design normalized schemas with proper relationships
2. Add indexes for frequently queried columns
3. Write migrations that are reversible
4. Use transactions for multi-table operations
5. Optimize N+1 queries with eager loading/joins
6. Add proper constraints (NOT NULL, UNIQUE, FOREIGN KEY)
7. Consider data access patterns when designing schemas`,
    },
    {
        id: 'frontend-design',
        name: 'Frontend Design',
        description: 'Design stunning UIs with modern frameworks, component libraries, and real-world inspiration',
        category: 'design',
        icon: 'Design',
        modes: ["projects","workpal"],
        enabled: true,
        prompt: `When designing frontend interfaces:
1. Use the web_search tool to find design inspiration from Dribbble, Behance, Awwwards, and similar sites
2. Use web_fetch to pull real code examples from component libraries (shadcn/ui, Radix, Headless UI, Material UI)
3. Follow modern design principles: visual hierarchy, whitespace, consistent spacing (4/8px grid)
4. Build with a component-first approach: atoms → molecules → organisms
5. Use a design token system: colors, typography scale, spacing scale, border radii, shadows
6. Enforce design consistency: shared color palette, font stack, elevation levels
7. Always consider dark mode and theme compatibility from the start
8. Reference real-world examples: "This follows the pattern used by Linear/Notion/Vercel"
9. Use modern CSS: Grid, Flexbox, container queries, :has(), color-mix()
10. Prefer CSS custom properties for theming over hardcoded values`,
    },
    {
        id: 'web-research',
        name: 'Web Research',
        description: 'Search the web for latest docs, npm packages, framework guides, and code examples',
        category: 'research',
        icon: 'Research',
        modes: ["all"],
        enabled: true,
        prompt: `When the user needs up-to-date information or you need to look something up:
1. Use web_search to find the latest documentation, release notes, and migration guides
2. Use web_fetch to read official docs pages and extract relevant code examples
3. Always search for the LATEST version of packages and frameworks — do not rely on training data
4. For npm/yarn/pnpm: search "npm <package> latest" to get current version and install commands
5. For Laravel: search "laravel <feature> docs" for the latest syntax and artisan commands
6. For React/Next.js/Vue/Svelte: search the official docs for current API and patterns
7. When giving install commands, always verify the current package name and version
8. Provide direct links to source documentation so the user can read more
9. Compare multiple sources when instructions differ across versions
10. Flag when documentation is outdated or when breaking changes exist between versions`,
    },
    {
        id: 'screenshot-to-code',
        name: 'Screenshot to Code',
        description: 'Clone any website or design from a URL or screenshot into working code',
        category: 'design',
        icon: 'Clone',
        modes: ["projects","workpal"],
        enabled: true,
        prompt: `When cloning a design from a URL or screenshot:
1. Use browser_screenshot or web_fetch to capture the target design
2. Analyze the layout: grid structure, spacing, typography, colors, imagery
3. Extract the exact color palette using color values from the source
4. Identify the component structure: header, hero, cards, forms, footer, etc.
5. Recreate pixel-perfect using modern HTML + CSS (Flexbox/Grid)
6. Match typography: font family, sizes, weights, line heights, letter spacing
7. Replicate interactions: hover states, transitions, animations
8. Use placeholder images from picsum.photos or similar when originals aren't available
9. Make it responsive — ensure it works on mobile, tablet, and desktop
10. Output clean, semantic HTML with well-organized CSS`,
    },
    {
        id: 'responsive-layout',
        name: 'Responsive Layout',
        description: 'Build mobile-first responsive layouts with modern CSS techniques',
        category: 'design',
        icon: 'Layout',
        modes: ["projects","workpal"],
        enabled: false,
        prompt: `When building responsive layouts:
1. Start mobile-first: design for 320px, then scale up with min-width breakpoints
2. Standard breakpoints: 640px (sm), 768px (md), 1024px (lg), 1280px (xl), 1536px (2xl)
3. Use CSS Grid for 2D layouts, Flexbox for 1D alignment
4. Use container queries for component-level responsiveness
5. Use clamp() for fluid typography: clamp(1rem, 2.5vw, 2rem)
6. Use fluid spacing: clamp(1rem, 3vw, 3rem) for padding/margins
7. Test touch targets: minimum 44x44px for interactive elements
8. Hide/show elements with display:none at breakpoints, not visibility
9. Use srcset/sizes for responsive images
10. Test on real device sizes, not just browser resize`,
    },
    {
        id: 'animation-design',
        name: 'Animation & Motion',
        description: 'Add smooth animations, transitions, and micro-interactions',
        category: 'design',
        icon: 'Motion',
        modes: ["projects","workpal"],
        enabled: false,
        prompt: `When adding animations and motion:
1. Follow the principle: animation should inform, not distract
2. Use CSS transitions for simple state changes (hover, focus, active)
3. Use CSS @keyframes for complex multi-step animations
4. Use Framer Motion for React component animations (enter/exit/layout)
5. Use GSAP for timeline-based and scroll-triggered animations
6. Standard durations: micro 100-150ms, small 200-250ms, medium 300-400ms, large 500-700ms
7. Preferred easing: ease-out for enters, ease-in for exits, ease-in-out for moves
8. Use transform and opacity for performant animations (GPU-accelerated)
9. Respect prefers-reduced-motion: disable non-essential animations
10. Add spring physics for natural-feeling interactions: mass, stiffness, damping`,
    },
    {
        id: 'fullstack-scaffold',
        name: 'Fullstack Scaffold',
        description: 'Generate complete project scaffolds with best-practice folder structure and config',
        category: 'code',
        icon: 'Scaffold',
        modes: ["projects"],
        enabled: false,
        prompt: `When scaffolding a new project:
1. Use web_search to find the LATEST create commands and starter templates
2. Set up proper folder structure following community conventions
3. Configure TypeScript with strict mode and path aliases
4. Set up linting (ESLint) and formatting (Prettier) with opinionated defaults
5. Add .gitignore, .env.example, and editor config files
6. Set up testing framework (Vitest/Jest for unit, Playwright for E2E)
7. Configure CI with GitHub Actions (lint, test, build)
8. Add Docker support with multi-stage builds
9. Create a README with setup instructions, scripts, and architecture overview
10. Install and configure common dependencies for the chosen stack`,
    },
    // ══════════════════════════════════════════
    //  Production Skills (inspired by 2026 best practices)
    // ══════════════════════════════════════════
    {
        id: 'frontend-design-pro',
        name: 'Frontend Design Pro',
        description: 'Production-grade UI with bold aesthetics — escapes generic AI design patterns',
        category: 'design',
        icon: 'DesignPro',
        modes: ["projects","workpal"],
        enabled: true,
        prompt: `FRONTEND DESIGN PRO — Break the "generic AI" design pattern:
1. NEVER default to Inter font + purple gradient + white background + card grid. This is distributional convergence.
2. Choose distinctive typography: pair a display font (Space Grotesk, Clash Display, Satoshi) with a body font
3. Build a 5-color palette with intention: primary, accent, surface, text, and a "pop" color for CTAs
4. Use whitespace aggressively — 32-48px between sections minimum
5. Add purposeful motion: entrance animations on scroll, hover micro-interactions, page transitions
6. Use CSS clamp() for fluid sizing: clamp(2rem, 5vw, 4rem) for headings
7. Create visual hierarchy: every screen should have ONE dominant element
8. Use gradients with subtlety: mesh gradients, radial gradients, gradient borders
9. Add texture: noise overlays, grain, subtle patterns — not flat colors
10. Test with a screenshot — if it looks like "AI made this," redesign
11. Use show_widget artifact to preview designs inline before creating files
12. Prefer Tailwind CSS v4 or CSS modules. No inline styles for production.`,
    },
    {
        id: 'browser-automation',
        name: 'Browser Automation',
        description: 'Live web interaction, E2E testing, scraping, and visual validation',
        category: 'testing',
        icon: 'Browser',
        modes: ["projects","workpal"],
        enabled: true,
        prompt: `BROWSER AUTOMATION — Use browser tools for testing and web interaction:
1. For E2E testing: navigate to URL, interact with elements, assert outcomes
2. Use browser_navigate → browser_screenshot → verify visual state
3. For form testing: browser_type into inputs, browser_click submit, check result
4. Test responsive: check mobile (375px), tablet (768px), desktop (1440px)
5. Capture screenshots before and after changes for visual diff
6. For scraping: navigate → get page text → extract structured data
7. Test authentication flows end-to-end: login → session → protected route → logout
8. Check for console errors after each navigation: read_console_messages
9. Validate API responses: navigate to API endpoint, parse JSON
10. Run accessibility checks: tab order, aria labels, contrast ratios
11. If test fails, capture screenshot + console errors, create fix task, retry after fix
12. Always close browser sessions when done.`,
    },
    {
        id: 'simplify',
        name: 'Simplify & Clean',
        description: 'Reduce complexity — fewer lines, clearer intent, less abstraction',
        category: 'review',
        icon: 'Simplify',
        modes: ["projects"],
        enabled: true,
        prompt: `SIMPLIFY — Make code shorter, clearer, and more direct:
1. Remove dead code, unused imports, commented-out blocks
2. Flatten nested conditionals: early returns over deep if/else
3. Replace verbose patterns with idiomatic equivalents (array methods over loops, template literals over concat)
4. Remove premature abstractions: if a helper is used once, inline it
5. Reduce file count: merge small related modules into one
6. Simplify types: use inference over explicit annotations where obvious
7. Remove defensive coding that can't happen (null checks on non-nullable values)
8. Replace complex state machines with simpler state variables when possible
9. Use standard library functions over custom implementations
10. After simplifying: run tests to verify behavior preserved, run linter to check style
11. Target: 30% fewer lines with identical behavior. If you can't, the code was already simple.`,
    },
    {
        id: 'video-creator',
        name: 'Video & Animation Creator',
        description: 'Create animated demos, explainers, and presentations using artifacts',
        category: 'design',
        icon: 'Video',
        modes: ["workpal","onichat"],
        enabled: false,
        prompt: `VIDEO & ANIMATION — Create rich animated content using artifacts:
1. Use show_widget artifact with HTML Canvas/SVG for animations
2. For product demos: create step-by-step animated walkthroughs
3. For data visualization: animate chart transitions, growing bars, flowing lines
4. Use requestAnimationFrame for smooth 60fps animations
5. Add easing functions: ease-out for entries, ease-in for exits
6. For slide-style videos: create multi-scene artifacts with navigation
7. For explainers: combine text + animated diagrams + code snippets
8. Use CSS @keyframes for simple looping animations
9. For complex timelines: build a frame counter and switch scenes based on time
10. Always include play/pause controls in animations
11. Keep artifacts under 400px tall — use expand for full view
12. Export-ready: designs should work as standalone HTML files.`,
    },
    {
        id: 'data-pipeline',
        name: 'Data Pipeline & Analysis',
        description: 'ETL processing, CSV/JSON analysis, statistics, and visualization',
        category: 'data',
        icon: 'Pipeline',
        modes: ["all"],
        enabled: true,
        prompt: `DATA PIPELINE — Process, analyze, and visualize data:
1. For CSV/JSON: use ctx_execute with Python (pandas, json, csv modules)
2. Clean data first: handle nulls, normalize formats, deduplicate
3. Compute summary statistics: count, mean, median, std, min, max, percentiles
4. For large datasets: process in chunks, only print summaries (not raw data)
5. Create visualizations using show_widget: chart, interactive-graph, data-table
6. For comparisons: use show_widget comparison or data-table with sorting
7. For time series: use svg-chart or artifact with Chart.js line/area charts
8. Save processed data as JSON/CSV to filesystem for reuse
9. For API data: fetch → parse → analyze → visualize in one pipeline
10. Always validate data types before operations (numbers as numbers, dates as dates)
11. Use show_widget artifact with Chart.js for publication-quality charts
12. Present findings with executive summary first, details second.`,
    },
    {
        id: 'pentesting',
        name: 'Security Pentesting',
        description: 'Analyze code for vulnerabilities, test attack surfaces, validate fixes',
        category: 'review',
        icon: 'Pentest',
        modes: ["projects"],
        enabled: false,
        prompt: `SECURITY PENTESTING — White-box security analysis:
1. Map attack surface: list all endpoints, inputs, auth boundaries
2. Check OWASP Top 10: injection, broken auth, XSS, CSRF, SSRF, path traversal
3. Analyze authentication: session management, token handling, password storage
4. Check authorization: can user A access user B's data? Test IDOR
5. Review secrets: scan for hardcoded API keys, passwords, tokens in code and env files
6. Check dependencies: search for known CVEs in package.json/requirements.txt
7. Test input validation: SQL injection, XSS payloads, path traversal, command injection
8. Check CORS configuration: is it too permissive?
9. Review file upload handling: type validation, size limits, storage location
10. Check rate limiting: brute force protection on login/API endpoints
11. For each vulnerability found: describe impact, provide proof of concept, suggest fix
12. IMPORTANT: Only test against systems the user owns. Never test production without explicit authorization.`,
    },
    {
        id: 'diagram-generator',
        name: 'Diagram Generator',
        description: 'Architecture diagrams, flowcharts, and system maps using artifacts',
        category: 'docs',
        icon: 'Diagram',
        modes: ["all"],
        enabled: true,
        prompt: `DIAGRAM GENERATOR — Create visual architecture and system diagrams:
1. Use show_widget artifact with SVG for all diagrams — never plain text descriptions
2. For architecture: show components as rounded rectangles, connections as arrows with labels
3. For flowcharts: use show_widget flowchart with nodes and edges
4. For system maps: group related components in dashed boxes (microservices, databases, external APIs)
5. Color coding: blue for services, green for databases, orange for external APIs, red for user-facing
6. Use show_widget mindmap for hierarchical concepts
7. Use show_widget timeline for sequential processes
8. For data flow: show direction with arrows, label with data format (JSON, gRPC, REST)
9. Add a legend explaining colors and symbols
10. Keep diagrams focused: max 15 nodes per diagram. Split complex systems into multiple views.
11. Every diagram should argue a point — not just display components but show WHY they're connected
12. Include real identifiers: actual service names, actual port numbers, actual API paths.`,
    },
    {
        id: 'schema-designer',
        name: 'Schema Designer',
        description: 'Database schema design with indexing, relationships, and migration planning',
        category: 'data',
        icon: 'Schema',
        modes: ["projects"],
        enabled: true,
        prompt: `SCHEMA DESIGNER — Design databases that scale:
1. Start with the access patterns: what queries will run? Design schema around reads, not writes
2. Every table needs: id (UUID or auto-increment), created_at, updated_at timestamps
3. Use foreign keys for relationships, with ON DELETE CASCADE/SET NULL as appropriate
4. Add indexes for every column used in WHERE, JOIN, ORDER BY, or GROUP BY
5. Composite indexes: put high-cardinality columns first (user_id, created_at) not (status, user_id)
6. For full-text search: use FTS5 (SQLite), GIN indexes (Postgres), or FULLTEXT (MySQL)
7. Normalize to 3NF by default, denormalize only when you can prove a performance need
8. Use enums/check constraints for status fields (not unbounded strings)
9. Migration planning: always make changes backward-compatible. Add columns before removing old ones.
10. For branching databases (PlanetScale, Neon): create a branch per feature, merge when tested
11. Visualize schema with show_widget artifact showing tables and relationships
12. Always include seed data for testing.`,
    },
    {
        id: 'pr-creator',
        name: 'PR Creator',
        description: 'Automated pull request creation with descriptions, checklists, and reviews',
        category: 'devops',
        icon: 'PR',
        modes: ["projects"],
        enabled: true,
        prompt: `PR CREATOR — Automate high-quality pull requests:
1. Before creating PR: run linter, tests, and type checks. Fix any failures.
2. Use git_diff to understand all changes, then write a summary
3. PR title: concise (<70 chars), starts with type: feat:, fix:, refactor:, docs:, test:
4. PR description format:
   - ## Summary: 2-3 bullet points of what changed and WHY
   - ## Changes: file-by-file or component-by-component breakdown
   - ## Testing: what was tested, how to verify
   - ## Screenshots: if UI changes, use browser_screenshot and include
5. Add checklist: [ ] Tests pass, [ ] No console errors, [ ] Responsive, [ ] Accessible
6. Link related issues: "Closes #123" or "Related to #456"
7. Use git_create_pr to create the PR via GitHub API
8. If changes are large (>500 lines), suggest splitting into smaller PRs
9. Auto-add labels based on file paths: frontend, backend, infrastructure, docs
10. Review your own changes before creating: check for debug logs, TODO comments, hardcoded values.`,
    },
    {
        id: 'memory-manager',
        name: 'Smart Memory',
        description: 'Persistent context management — remember decisions, preferences, and project state',
        category: 'research',
        icon: 'Memory',
        modes: ["all"],
        enabled: true,
        prompt: `SMART MEMORY — Actively manage persistent context:
1. After EVERY significant decision: save to memory (memory_save_fact or memory_append)
2. Categories to track: user preferences, technical decisions, project architecture, past bugs, deployment configs
3. At session start: search memory for relevant context (conversation_search, memory_read)
4. Before repeating a question: check if the answer is already in memory
5. Track user corrections: "Don't do X, do Y instead" — save immediately as a correction
6. Track project patterns: "This project uses Tailwind" "Auth is via Clerk" "Deploy to Vercel"
7. Daily summaries: at the end of significant sessions, save a summary of what was accomplished
8. Cross-session recall: when user references past work, use conversation_search to find it
9. Memory hygiene: don't save trivial things (greetings, typos). Save decisions and patterns.
10. When unsure if something was discussed before: search first, ask second.
11. Track file modification history: which files were changed and why
12. Save error patterns: if a bug was fixed, save the symptom and solution for future reference.`,
    },
    {
        id: 'pptx-creator',
        name: 'Presentation Creator',
        description: 'Create professional slide decks — PPTX-quality presentations using artifacts',
        category: 'docs',
        icon: 'PPTX',
        modes: ["workpal","onichat"],
        enabled: true,
        system: true,
        prompt: `PRESENTATION CREATOR — Build professional slide decks:
1. Use show_widget slides for quick presentations (5-15 slides)
2. For production decks: use show_widget artifact with full HTML/CSS slide layout
3. SLIDE STRUCTURE: Title slide → Agenda → Content slides → Summary → CTA/Next Steps
4. DESIGN RULES:
   - One idea per slide. If you need two points, use two slides.
   - Maximum 6 bullet points per slide. Each under 12 words.
   - Use large text: titles 36px+, body 24px+, never below 18px
   - Dark slides: #0f172a background, white text, accent highlights
   - Light slides: #fafafa background, #1e293b text
5. VISUAL ELEMENTS:
   - Add icons/emoji for visual anchors on each slide
   - Use color blocks and cards instead of plain bullet lists
   - Add data visualizations (Chart.js) for any numerical content
   - Use progress indicators for multi-section decks
6. CONTENT PATTERNS:
   - Comparison slides: side-by-side cards with checkmarks/crosses
   - Data slides: chart + 1-sentence insight below
   - Quote slides: large italic text centered with attribution
   - Timeline slides: horizontal steps with icons
7. For artifacts: include navigation (← →), slide counter, keyboard support (arrow keys)
8. Export: save as standalone HTML file that can be opened in any browser
9. For actual .pptx files: use run_command with python-pptx to generate downloadable files
10. Always ask about audience and purpose before designing.`,
    },
    {
        id: 'game-design',
        name: 'Game Design Framework',
        description: 'Design and build games — mechanics, systems, prototyping, and playtesting',
        category: 'code',
        icon: 'Game',
        modes: ["projects","onichat"],
        enabled: true,
        system: true,
        prompt: `GAME DESIGN FRAMEWORK — Design and prototype games systematically:
1. CONCEPT PHASE:
   - Define the core loop: what does the player DO every 30 seconds?
   - Identify the "juice": what makes it FEEL good? (screenshake, particles, sound, animation)
   - Set scope: MVP must be playable in 1-2 hours of dev time
   - Genre clarity: platformer, puzzle, roguelike, narrative, simulation, etc.
2. MECHANICS DESIGN:
   - Core mechanic: the ONE action that defines gameplay (jump, match, shoot, build, choose)
   - Secondary mechanics: support the core (collect, upgrade, unlock, explore)
   - Progression: how does difficulty/complexity increase? (levels, waves, skill tree, story)
   - Risk/reward: every choice should have tradeoffs
3. TECHNICAL ARCHITECTURE:
   - Game loop: input → update → render at 60fps
   - State machine for game states: menu → playing → paused → gameover
   - Entity-component pattern for game objects
   - Collision detection: AABB for simple, SAT for polygons
   - For web games: Canvas 2D or Phaser.js. For 3D: Three.js
4. PROTOTYPING:
   - Use show_widget artifact to build playable prototypes inline
   - Start with rectangles and colors — no art until mechanics work
   - Add keyboard/touch input handling immediately
   - Include FPS counter and debug info toggle
5. GAME FEEL:
   - Add easing to all movement (never linear)
   - Screenshake on impacts: translate + rotate for 100-200ms
   - Particle effects: death, collect, hit, spawn
   - Sound cues: use Tone.js for procedural audio in artifacts
   - Camera: smooth follow with lerp, zoom on action
6. BALANCING:
   - Start too easy, then tune up — players quit from frustration, not boredom
   - Track metrics: average play time, death locations, completion rate
   - Use difficulty curves: easy → medium → hard → breather → harder
7. PLAYTESTING:
   - Build it playable in an artifact so user can test immediately
   - Add a score/timer for engagement
   - Include restart button — zero friction to retry
8. For Phaser/Next.js projects: scaffold with proper asset loading, scene management, and responsive canvas
9. For mobile: touch controls with virtual joystick or tap/swipe zones
10. Always prototype the core mechanic FIRST before building menus, save systems, or content.`,
    },
    {
        id: 'document-writer',
        name: 'Document Writer',
        description: 'Write professional documents — reports, proposals, memos, and formatted content',
        category: 'docs',
        icon: 'DocWriter',
        modes: ["workpal","onichat"],
        enabled: true,
        system: true,
        prompt: `DOCUMENT WRITER — Create professional written deliverables:
1. BEFORE WRITING: Ask about audience, purpose, tone, and length constraints
2. DOCUMENT TYPES:
   - Reports: Executive summary → Findings → Analysis → Recommendations → Appendix
   - Proposals: Problem → Solution → Approach → Timeline → Budget → Team
   - Memos: Context → Key Points → Action Items → Deadline
   - READMEs: What → Why → Quick Start → API Reference → Contributing
   - SOPs: Purpose → Scope → Steps → Exceptions → Review Schedule
3. FORMATTING RULES:
   - Use markdown with clear heading hierarchy (H1 → H2 → H3, never skip)
   - Short paragraphs: 2-4 sentences max
   - Use bullet lists for 3+ items, numbered lists for sequential steps
   - Bold for key terms on first use. Italic for emphasis.
   - Add a table of contents for documents over 3 pages
4. WRITING QUALITY:
   - Active voice over passive ("We recommend" not "It is recommended")
   - Specific over vague ("Reduce load time by 40%" not "Improve performance")
   - Cut adverbs and filler words: very, really, basically, actually, just
   - One idea per paragraph
5. VISUAL PRESENTATION:
   - Use show_widget artifact to render polished HTML preview
   - Add tables for structured data comparisons
   - Use callout boxes for warnings, tips, and important notes
   - Include charts/diagrams where data supports the narrative
6. SAVE deliverables as files: .md for editing, .html for presentation
7. For .docx/.pdf: generate via python-docx or HTML-to-PDF with run_command
8. Always proofread: check for typos, consistency, and completeness before presenting.`,
    },
];

/** Load skills from localStorage, merging with defaults */
export function loadSkills(): Skill[] {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) return DEFAULT_SKILLS;
        const savedSkills: Record<string, boolean> = JSON.parse(saved);
        return DEFAULT_SKILLS.map(skill => ({
            ...skill,
            enabled: savedSkills[skill.id] ?? skill.enabled,
        }));
    } catch {
        return DEFAULT_SKILLS;
    }
}

/** Save skill enabled states to localStorage */
export function saveSkills(skills: Skill[]) {
    const states: Record<string, boolean> = {};
    for (const s of skills) {
        states[s.id] = s.enabled;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
}

/** Get the combined prompt text for enabled skills, filtered by current mode */
export function getEnabledSkillsPrompt(mode?: string): string {
    const currentMode = mode || 'onichat';
    const skills = loadSkills().filter(s => {
        if (!s.enabled) return false;
        // Check if skill is relevant to current mode
        if (s.modes.includes('all')) return true;
        return s.modes.includes(currentMode as SkillMode);
    });
    if (skills.length === 0) return '';

    const lines = ['\n## Active Skills\nYou have the following specialized skills enabled for this mode. Apply them proactively when relevant:\n'];
    for (const skill of skills) {
        lines.push(`### ${skill.name}${skill.system ? ' (System)' : ''}\n${skill.prompt}\n`);
    }
    return lines.join('\n');
}

/** Get skill categories for UI grouping */
export function getSkillCategories(): { id: string; label: string }[] {
    return [
        { id: 'code', label: 'Code' },
        { id: 'review', label: 'Review' },
        { id: 'testing', label: 'Testing' },
        { id: 'docs', label: 'Docs' },
        { id: 'devops', label: 'DevOps' },
        { id: 'debug', label: 'Debug' },
        { id: 'design', label: 'Design' },
        { id: 'data', label: 'Data' },
        { id: 'research', label: 'Research' },
        { id: 'security', label: 'Security' },
    ];
}
