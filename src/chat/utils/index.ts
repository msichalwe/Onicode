/**
 * Shared utilities — single source of truth for common helpers.
 * Import from here instead of redefining in every component.
 */

/** Whether we're running inside Electron with the onicode bridge available. */
export const isElectron = typeof window !== 'undefined' && !!window.onicode;

/** Generate a short random ID (8 chars, alphanumeric). */
export function generateId(): string {
    return Math.random().toString(36).substring(2, 10);
}

/** Strip ANSI escape codes from terminal output. */
export function stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}
