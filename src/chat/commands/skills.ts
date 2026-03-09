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
    category: 'code' | 'review' | 'testing' | 'docs' | 'devops' | 'debug' | 'design' | 'data';
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
    ];
}
