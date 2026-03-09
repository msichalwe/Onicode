/**
 * Built-in Skills Registry — Pre-built prompt templates for the AI
 *
 * Skills are specialized capabilities that enhance the AI's behavior.
 * They are injected into the system prompt when enabled.
 */

export interface Skill {
    id: string;
    name: string;
    description: string;
    category: 'code' | 'review' | 'testing' | 'docs' | 'devops' | 'debug' | 'design' | 'data' | 'research';
    prompt: string;
    enabled: boolean;
    icon: string; // SVG path or emoji-free label
}

const STORAGE_KEY = 'onicode-skills';

export const DEFAULT_SKILLS: Skill[] = [
    {
        id: 'code-review',
        name: 'Code Review',
        description: 'Analyze code for bugs, security issues, performance problems, and best practices',
        category: 'review',
        icon: 'Review',
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

/** Get the combined prompt text for all enabled skills */
export function getEnabledSkillsPrompt(): string {
    const skills = loadSkills().filter(s => s.enabled);
    if (skills.length === 0) return '';

    const lines = ['\n## Active Skills\nYou have the following specialized skills enabled. Apply them proactively when relevant:\n'];
    for (const skill of skills) {
        lines.push(`### ${skill.name}\n${skill.prompt}\n`);
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
    ];
}
