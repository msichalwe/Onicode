import { isElectron, generateId } from '../../utils';
import { CONVERSATIONS_KEY, ACTIVE_CONV_KEY } from './constants';
import type { Conversation, Message, ProviderConfig } from './types';
import type { ChatScope } from '../../App';

/**
 * Get the first enabled and connected provider from localStorage.
 */
export function getActiveProvider(): ProviderConfig | null {
    try {
        const saved = localStorage.getItem('onicode-providers');
        if (!saved) return null;
        const providers: ProviderConfig[] = JSON.parse(saved);
        return providers.find((p) => p.enabled && p.connected && (p.apiKey?.trim() || p.id === 'ollama')) || null;
    } catch {
        return null;
    }
}

/**
 * Get the API endpoint for a given provider.
 */
export function getApiEndpoint(provider: ProviderConfig): string {
    if (provider.id === 'codex' || provider.id === 'openai') return 'https://api.openai.com/v1/chat/completions';
    const base = (provider.baseUrl || '').replace(/\/$/, '');
    return `${base}/v1/chat/completions`;
}

/**
 * Load conversations from localStorage (sync, used for initial render).
 * After mount, SQLite becomes the primary source via async load.
 */
export function loadConversationsFromCache(): Conversation[] {
    try {
        const saved = localStorage.getItem(CONVERSATIONS_KEY);
        return saved ? JSON.parse(saved) : [];
    } catch {
        return [];
    }
}

/**
 * Save conversations to localStorage cache (sync, for instant UI).
 */
export function saveConversationsCache(convs: Conversation[]) {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convs));
}

/**
 * Persist a single conversation to SQLite (primary storage).
 * Also updates localStorage cache for instant sync.
 */
export function persistConversationToSQLite(conv: Conversation) {
    if (!isElectron || !window.onicode?.conversationSave) return;
    window.onicode.conversationSave({
        id: conv.id,
        title: conv.title,
        messages: conv.messages,
        scope: conv.scope,
        projectId: conv.projectId,
        projectName: conv.projectName,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
    }).catch(() => { /* SQLite save failed, localStorage cache still has it */ });
}

/**
 * Delete a conversation from SQLite.
 */
export function deleteFromSQLite(convId: string) {
    if (!isElectron || !window.onicode?.conversationDelete) return;
    window.onicode.conversationDelete(convId).catch(() => { });
}

/**
 * Load all conversations from SQLite (async, primary source).
 * If SQLite is empty, migrates from localStorage and returns the migrated data.
 */
export async function loadConversationsFromSQLite(): Promise<Conversation[] | null> {
    if (!isElectron || !window.onicode?.conversationList) return null;
    try {
        const res = await window.onicode.conversationList(200, 0);
        if (!res.success || !res.conversations) return null;

        // Map SQLite rows to Conversation type
        let convs: Conversation[] = res.conversations.map((c: Record<string, unknown>) => ({
            id: c.id as string,
            title: c.title as string,
            messages: (c.messages || []) as Message[],
            createdAt: c.created_at as number,
            updatedAt: c.updated_at as number,
            scope: (c.scope || 'general') as ChatScope,
            projectId: c.project_id as string | undefined,
            projectName: c.project_name as string | undefined,
        }));

        // If SQLite is empty but localStorage has data, migrate
        if (convs.length === 0) {
            const cached = loadConversationsFromCache();
            if (cached.length > 0 && window.onicode.conversationMigrate) {
                const migRes = await window.onicode.conversationMigrate(cached);
                if (migRes.success && migRes.migrated && migRes.migrated > 0) {
                    console.log(`[Onicode] Migrated ${migRes.migrated} conversations to SQLite`);
                    // Re-load from SQLite to get proper format
                    const reloaded = await window.onicode.conversationList(200, 0);
                    if (reloaded.success && reloaded.conversations) {
                        convs = reloaded.conversations.map((c: Record<string, unknown>) => ({
                            id: c.id as string,
                            title: c.title as string,
                            messages: (c.messages || []) as Message[],
                            createdAt: c.created_at as number,
                            updatedAt: c.updated_at as number,
                            scope: (c.scope || 'general') as ChatScope,
                            projectId: c.project_id as string | undefined,
                            projectName: c.project_name as string | undefined,
                        }));
                    }
                }
            }
        }

        // Sync localStorage cache with SQLite truth
        saveConversationsCache(convs);
        return convs;
    } catch {
        return null;
    }
}

/**
 * Generate a conversation title from user message content.
 */
export function generateTitle(content: string): string {
    const clean = content.replace(/[#*`]/g, '').trim();
    return clean.length > 40 ? clean.slice(0, 40) + '...' : clean;
}

/**
 * Format elapsed time in seconds to a human-readable string.
 */
export function formatTime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
}
