import type { OnicodeMode } from '../../modes';

// ── Mode-specific welcome prompts (20+ per mode, 4 shown at random) ──

const ONICHAT_PROMPTS = [
    'Write a Python script',
    'Explain some code',
    'Brainstorm ideas',
    'Help me write an email',
    'What is quantum computing?',
    'Plan a weekend trip',
    'Compare React vs Vue',
    'Write a short story',
    'Explain how DNS works',
    'Give me a workout plan',
    'How do I learn Rust?',
    'Summarize a topic for me',
    'Help me prep for an interview',
    'Write a regex pattern',
    'Teach me about blockchains',
    'Create a meal plan',
    'What are design patterns?',
    'Help debug this error',
    'Draft a LinkedIn post',
    'Explain machine learning basics',
    'Write a bash one-liner',
    'How do databases scale?',
    'Give me productivity tips',
    'Explain REST vs GraphQL',
];

const WORKPAL_PROMPTS = [
    'Summarize this document',
    'Draft a professional email',
    'Create meeting notes template',
    'Review this text for clarity',
    'Write a project proposal',
    'Turn my notes into a report',
    'Help organize my thoughts',
    'Create a presentation outline',
    'Write a follow-up message',
    'Analyze this spreadsheet data',
    'Draft a status update',
    'Create a to-do list from notes',
    'Write a cover letter',
    'Proofread and improve this text',
    'Summarize key action items',
    'Create a weekly plan',
    'Draft a team announcement',
    'Turn bullet points into prose',
    'Write a product brief',
    'Help me structure this doc',
    'Create an agenda for my meeting',
    'Write a decision document',
    'Simplify this technical text',
    'Extract insights from these files',
];

const PROJECT_PROMPTS = [
    'Set up the project structure',
    'Write unit tests for this',
    'Refactor this function',
    'Add error handling here',
    'Create a new API endpoint',
    'Fix the failing build',
    'Add TypeScript types',
    'Implement authentication',
    'Optimize this database query',
    'Write a migration script',
    'Add input validation',
    'Create a reusable component',
    'Set up CI/CD pipeline',
    'Add logging and monitoring',
    'Write API documentation',
    'Implement caching layer',
    'Add responsive design',
    'Create a state management setup',
    'Write integration tests',
    'Deploy this application',
    'Review my code for issues',
    'Add dark mode support',
    'Create a CLI tool',
    'Implement websocket support',
];

const MODE_PROMPTS: Record<OnicodeMode, string[]> = {
    onichat: ONICHAT_PROMPTS,
    workpal: WORKPAL_PROMPTS,
    projects: PROJECT_PROMPTS,
};

/** Pick N random unique items from an array using Fisher-Yates partial shuffle */
function pickRandom<T>(arr: T[], n: number): T[] {
    const copy = [...arr];
    const result: T[] = [];
    for (let i = 0; i < n && copy.length > 0; i++) {
        const idx = Math.floor(Math.random() * copy.length);
        result.push(copy[idx]);
        copy.splice(idx, 1);
    }
    return result;
}

/** Get 4 random mode-appropriate welcome prompts */
export function getWelcomePrompts(mode: OnicodeMode): string[] {
    return pickRandom(MODE_PROMPTS[mode] || ONICHAT_PROMPTS, 4);
}

// Legacy export for backwards compat
export const WELCOME_SUGGESTIONS = ONICHAT_PROMPTS.slice(0, 4);

export const CONVERSATIONS_KEY = 'onicode-conversations';
export const ACTIVE_CONV_KEY = 'onicode-active-conversation';
