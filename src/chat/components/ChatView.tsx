import React, { useState, useRef, useEffect, useCallback } from 'react';
import { marked } from 'marked';
import { SLASH_COMMANDS } from '../commands/registry';
import { executeCommand } from '../commands/executor';
import { buildSystemPromptCached, type AIContext } from '../ai/systemPrompt';
import QuestionDialog, { parseQuestions, isQuestionMessage } from './QuestionDialog';
import type { ChatScope } from '../App';
import type { ActiveProject } from './ProjectModeBar';
import { requestPanel } from '../utils';

// ══════════════════════════════════════════
//  Screenshot Image Component (loads via IPC)
// ══════════════════════════════════════════

function ScreenshotImage({ filePath, alt, onClick }: { filePath: string; alt: string; onClick?: () => void }) {
    const [src, setSrc] = React.useState<string>('');
    const [error, setError] = React.useState(false);

    React.useEffect(() => {
        if (!filePath) return;
        let cancelled = false;
        window.onicode?.readScreenshotBase64?.(filePath).then(result => {
            if (cancelled) return;
            if (result?.dataUri) setSrc(result.dataUri);
            else setError(true);
        }).catch(() => { if (!cancelled) setError(true); });
        return () => { cancelled = true; };
    }, [filePath]);

    if (error) return <div className="tool-step-error" style={{ fontSize: 11, padding: '4px 8px' }}>Screenshot not available</div>;
    if (!src) return <div style={{ padding: '8px', color: 'var(--text-tertiary)', fontSize: 11 }}>Loading screenshot...</div>;
    return <img src={src} alt={alt} className="tool-screenshot-img" onClick={onClick} />;
}

// ══════════════════════════════════════════
//  Types
// ══════════════════════════════════════════

export interface ToolStep {
    id: string;
    name: string;
    args: Record<string, unknown>;
    result?: Record<string, unknown>;
    round: number;
    status: 'running' | 'done' | 'error';
}

export interface Message {
    id: string;
    role: 'user' | 'ai';
    content: string;
    timestamp: number;
    attachments?: Attachment[];
    toolSteps?: ToolStep[];
    questionsAnswered?: boolean;
    questionAnswers?: Record<number, string[]>;
    isError?: boolean;
}

export interface Attachment {
    type: 'file' | 'link' | 'image' | 'doc';
    name: string;
    url?: string;
    size?: number;
    mimeType?: string;
    content?: string;
    dataUrl?: string; // Base64 data URL for image thumbnails
}

export interface Conversation {
    id: string;
    title: string;
    messages: Message[];
    createdAt: number;
    updatedAt: number;
    scope?: ChatScope;
    projectId?: string;
    projectName?: string;
}

interface ProviderConfig {
    id: string;
    apiKey?: string;
    baseUrl?: string;
    selectedModel?: string;
    connected?: boolean;
    enabled?: boolean;
    models?: string[];
}

// ══════════════════════════════════════════
//  Constants
// ══════════════════════════════════════════

const WELCOME_SUGGESTIONS = [
    'Write a Python script',
    'Explain some code',
    'Build a website',
    'Brainstorm ideas',
];

import { isElectron, generateId } from '../utils';

const CONVERSATIONS_KEY = 'onicode-conversations';
const ACTIVE_CONV_KEY = 'onicode-active-conversation';

// ══════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════

function getActiveProvider(): ProviderConfig | null {
    try {
        const saved = localStorage.getItem('onicode-providers');
        if (!saved) return null;
        const providers: ProviderConfig[] = JSON.parse(saved);
        return providers.find((p) => p.enabled && p.connected && (p.apiKey?.trim() || p.id === 'ollama')) || null;
    } catch {
        return null;
    }
}

function getApiEndpoint(provider: ProviderConfig): string {
    if (provider.id === 'codex') return 'https://api.openai.com/v1/chat/completions';
    const base = (provider.baseUrl || '').replace(/\/$/, '');
    return `${base}/v1/chat/completions`;
}

/**
 * Load conversations from localStorage (sync, used for initial render).
 * After mount, SQLite becomes the primary source via async load.
 */
function loadConversationsFromCache(): Conversation[] {
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
function saveConversationsCache(convs: Conversation[]) {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convs));
}

/**
 * Persist a single conversation to SQLite (primary storage).
 * Also updates localStorage cache for instant sync.
 */
function persistConversationToSQLite(conv: Conversation) {
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
function deleteFromSQLite(convId: string) {
    if (!isElectron || !window.onicode?.conversationDelete) return;
    window.onicode.conversationDelete(convId).catch(() => { });
}

/**
 * Load all conversations from SQLite (async, primary source).
 * If SQLite is empty, migrates from localStorage and returns the migrated data.
 */
async function loadConversationsFromSQLite(): Promise<Conversation[] | null> {
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

function generateTitle(content: string): string {
    const clean = content.replace(/[#*`]/g, '').trim();
    return clean.length > 40 ? clean.slice(0, 40) + '...' : clean;
}

// ══════════════════════════════════════════
//  Panel Events (dispatched to App)
// ══════════════════════════════════════════
// requestPanel moved to utils/index.ts to avoid breaking React Fast Refresh

// ══════════════════════════════════════════
//  Component
// ══════════════════════════════════════════

interface ChatViewProps {
    scope?: ChatScope;
    activeProject?: ActiveProject | null;
    onChangeScope?: (scope: ChatScope) => void;
    onNewMessage?: () => void;
}

export default function ChatView({ scope = 'general', activeProject, onChangeScope, onNewMessage }: ChatViewProps) {
    // ── Conversation state ──
    const [conversations, setConversations] = useState<Conversation[]>(loadConversationsFromCache);
    const [activeConvId, setActiveConvId] = useState<string | null>(() => {
        return localStorage.getItem(ACTIVE_CONV_KEY) || null;
    });
    const [showHistory, setShowHistory] = useState(false);

    // ── Message state ──
    const [messages, setMessages] = useState<Message[]>(() => {
        const id = localStorage.getItem(ACTIVE_CONV_KEY);
        if (id) {
            const convs = loadConversationsFromCache();
            const conv = convs.find((c) => c.id === id);
            if (conv) return conv.messages;
        }
        return [];
    });

    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [streamingContent, setStreamingContent] = useState('');
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [showSlashMenu, setShowSlashMenu] = useState(false);
    const [slashFilter, setSlashFilter] = useState('');
    const [slashIndex, setSlashIndex] = useState(0);
    const [showMentionMenu, setShowMentionMenu] = useState(false);
    const [mentionFilter, setMentionFilter] = useState('');
    const [mentionIndex, setMentionIndex] = useState(0);
    const [isDragOver, setIsDragOver] = useState(false);
    const [activeToolSteps, setActiveToolSteps] = useState<ToolStep[]>([]);
    const [agentStatus, setAgentStatus] = useState<{
        status: string;
        round: number;
        pending?: number;
        agentId?: string;
        task?: string;
    } | null>(null);

    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [contextInfo, setContextInfo] = useState<{ tokens: number; messages: number } | null>(null);
    const [pendingQuestion, setPendingQuestion] = useState<{
        questionId: string;
        question: string;
        options: Array<{ label: string; description?: string }>;
        allowMultiple: boolean;
    } | null>(null);
    const [selectedOptions, setSelectedOptions] = useState<Set<number>>(new Set());
    const [pendingApproval, setPendingApproval] = useState<{
        approvalId: string;
        tool: string;
        args: Record<string, unknown>;
    } | null>(null);
    const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
    const [sessionTimer, setSessionTimer] = useState<number>(0);
    const [thinkingLevel, setThinkingLevel] = useState<string>(() =>
        localStorage.getItem('onicode-thinking-level') || 'medium'
    );
    const [showModelPicker, setShowModelPicker] = useState(false);
    const [showAttachMenu, setShowAttachMenu] = useState(false);
    const attachMenuRef = useRef<HTMLDivElement>(null);
    const sessionStartRef = useRef<number | null>(null);

    // ── Refs ──
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const streamContentRef = useRef('');
    const cleanupRef = useRef<(() => void) | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const sendingRef = useRef(false); // Prevents double-send from StrictMode
    const slashMenuRef = useRef<HTMLDivElement>(null);
    const mentionMenuRef = useRef<HTMLDivElement>(null);
    const activeProjectRef = useRef(activeProject);

    // Keep ref in sync with prop so closures always have current value
    useEffect(() => { activeProjectRef.current = activeProject; }, [activeProject]);

    // Close attach menu on outside click
    useEffect(() => {
        if (!showAttachMenu) return;
        const handler = (e: MouseEvent) => {
            if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
                setShowAttachMenu(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showAttachMenu]);

    // ── Load from SQLite (primary source) on mount ──
    useEffect(() => {
        loadConversationsFromSQLite().then(sqliteConvs => {
            if (!sqliteConvs) return; // SQLite unavailable, keep localStorage data
            setConversations(sqliteConvs);
            // If we have an active conversation, update messages from SQLite data
            const activeId = localStorage.getItem(ACTIVE_CONV_KEY);
            if (activeId) {
                const conv = sqliteConvs.find(c => c.id === activeId);
                if (conv) setMessages(conv.messages);
            }
        });
    }, []);

    // ── Persistence (SQLite primary, localStorage cache) ──
    const persistConversation = useCallback((msgs: Message[], convId: string | null) => {
        if (msgs.length === 0) return convId;

        const convs = loadConversationsFromCache();
        let id = convId;
        let convToSave: Conversation | null = null;

        if (id) {
            const idx = convs.findIndex((c) => c.id === id);
            if (idx >= 0) {
                convs[idx].messages = msgs;
                convs[idx].updatedAt = Date.now();
                if (msgs.length === 1) convs[idx].title = generateTitle(msgs[0].content);
                // Update scope info
                convs[idx].scope = scope;
                if (scope === 'project' && activeProject) {
                    convs[idx].projectId = activeProject.id;
                    convs[idx].projectName = activeProject.name;
                }
                convToSave = convs[idx];
            }
        } else {
            id = generateId();
            const newConv: Conversation = {
                id,
                title: generateTitle(msgs[0].content),
                messages: msgs,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                scope,
            };
            if (scope === 'project' && activeProject) {
                newConv.projectId = activeProject.id;
                newConv.projectName = activeProject.name;
            }
            convs.unshift(newConv);
            convToSave = newConv;
        }

        saveConversationsCache(convs);
        setConversations(convs);
        localStorage.setItem(ACTIVE_CONV_KEY, id);

        // Persist to SQLite (primary storage)
        if (convToSave) persistConversationToSQLite(convToSave);

        return id;
    }, [scope, activeProject]);

    // ── Scroll ──
    const scrollToBottom = useCallback(() => {
        // Use double rAF to ensure DOM layout is complete before scrolling
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            });
        });
    }, []);

    useEffect(() => { scrollToBottom(); }, [messages, streamingContent, activeToolSteps, scrollToBottom]);

    // ── Scroll detection for scroll-to-bottom button ──
    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;
        const handleScroll = () => {
            const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            setShowScrollBtn(distFromBottom > 150);
        };
        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, [messages.length > 0]);

    // ── Context tracking (estimate token count — includes tool steps + system prompt) ──
    useEffect(() => {
        if (messages.length === 0) { setContextInfo(null); return; }
        let totalChars = 0;
        for (const m of messages) {
            totalChars += m.content.length;
            // Include tool step args + results in token estimate
            if (m.toolSteps) {
                for (const step of m.toolSteps) {
                    totalChars += JSON.stringify(step.args || {}).length;
                    if (step.result) totalChars += JSON.stringify(step.result).length;
                }
            }
            // Include attachment content
            if (m.attachments) {
                for (const att of m.attachments) {
                    if (att.content) totalChars += att.content.length;
                    if (att.url) totalChars += att.url.length;
                }
            }
        }
        // System prompt overhead (~6000 chars = ~1500 tokens)
        const systemPromptTokens = 1500;
        // Per-message overhead (role labels, separators) = ~4 tokens each
        const messageOverhead = messages.length * 4;
        const estimatedTokens = Math.round(totalChars / 4) + systemPromptTokens + messageOverhead;
        setContextInfo({ tokens: estimatedTokens, messages: messages.length });
    }, [messages]);

    // ── Session timer (tracks AI working duration) ──
    useEffect(() => {
        if (isTyping) {
            sessionStartRef.current = sessionStartRef.current || Date.now();
            const interval = setInterval(() => {
                setSessionTimer(Math.floor((Date.now() - sessionStartRef.current!) / 1000));
            }, 1000);
            return () => clearInterval(interval);
        } else {
            // Keep final time visible briefly, then reset
            const timeout = setTimeout(() => {
                sessionStartRef.current = null;
                setSessionTimer(0);
            }, 5000);
            return () => clearTimeout(timeout);
        }
    }, [isTyping]);

    // ── Signal chat activity to main process (for workflow result pipeline) ──
    useEffect(() => {
        if (isElectron && window.onicode?.chatActivityChange) {
            window.onicode.chatActivityChange(isTyping);
        }
    }, [isTyping]);

    // ── Textarea auto-resize ──
    useEffect(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
        }
    }, [input]);

    // ── Slash command menu ──
    useEffect(() => {
        // Detect / at start of input or after whitespace, at end of current typing
        const match = input.match(/(^|\s)(\/\S*)$/);
        if (match) {
            setShowSlashMenu(true);
            setShowMentionMenu(false);
            setSlashFilter(match[2].slice(1).toLowerCase());
            setSlashIndex(0);
        } else {
            setShowSlashMenu(false);
        }
    }, [input]);

    const filteredCommands = SLASH_COMMANDS.filter((cmd) =>
        cmd.name.toLowerCase().includes('/' + slashFilter)
    );

    // Scroll active slash menu item into view
    useEffect(() => {
        if (!showSlashMenu || !slashMenuRef.current) return;
        const active = slashMenuRef.current.querySelector('.slash-menu-item.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    }, [slashIndex, showSlashMenu]);

    // ── @ mention menu ──
    useEffect(() => {
        // Detect @ at any position in input (not just start)
        const atIndex = input.lastIndexOf('@');
        if (atIndex >= 0 && !input.startsWith('/')) {
            const afterAt = input.slice(atIndex + 1);
            // Only show if there's no space after the filter text (user is still typing the mention)
            if (!afterAt.includes(' ') || afterAt.length === 0) {
                setShowMentionMenu(true);
                setShowSlashMenu(false);
                setMentionFilter(afterAt.toLowerCase());
                setMentionIndex(0);
            } else {
                setShowMentionMenu(false);
            }
        } else if (!input.startsWith('/')) {
            setShowMentionMenu(false);
        }
    }, [input]);

    // ── Ask User Question listener (Cascade-level) ──
    useEffect(() => {
        if (!window.onicode?.onAskUser) return;
        const removeListener = window.onicode.onAskUser((data) => {
            setPendingQuestion(data);
            setSelectedOptions(new Set());
        });
        return removeListener;
    }, []);

    // ── Permission Approval listener ──
    useEffect(() => {
        if (!window.onicode?.onPermissionRequest) return;
        const removeListener = window.onicode.onPermissionRequest((data) => {
            setPendingApproval(data);
        });
        return removeListener;
    }, []);

    // ── Auto-commit notification listener ──
    useEffect(() => {
        if (!window.onicode?.onAutoCommit) return;
        const removeListener = window.onicode.onAutoCommit((data) => {
            setMessages(prev => [...prev, {
                id: `auto-commit-${Date.now()}`,
                role: 'ai' as const,
                content: `Auto-committed: \`${data.message}\``,
                timestamp: Date.now(),
                toolSteps: [],
            }]);
        });
        return removeListener;
    }, []);

    // Listen for automation messages (timers, background workflows, scheduled tasks)
    useEffect(() => {
        if (!window.onicode?.onAutomationMessage) return;
        const removeListener = window.onicode.onAutomationMessage((data) => {
            setMessages(prev => [...prev, {
                id: data.id || generateId(),
                role: 'ai' as const,
                content: `**${data.title || data.source || 'Automation'}:** ${data.content}`,
                timestamp: data.timestamp || Date.now(),
            }]);
            onNewMessage?.();
        });
        return removeListener;
    }, [onNewMessage]);

    const handleAnswerQuestion = React.useCallback((answer: string | string[]) => {
        if (!pendingQuestion || !window.onicode?.answerQuestion) return;
        window.onicode.answerQuestion(pendingQuestion.questionId, answer);
        setPendingQuestion(null);
        setSelectedOptions(new Set());
    }, [pendingQuestion]);

    // ── Project-scoped attachments (loaded from SQLite) ──
    const [projectAttachments, setProjectAttachments] = useState<Attachment[]>([]);

    useEffect(() => {
        if (!activeProject?.id || !window.onicode?.attachmentList) return;
        window.onicode.attachmentList(activeProject.id).then(result => {
            if (result.success && result.attachments) {
                setProjectAttachments(result.attachments.map(a => ({
                    name: a.name,
                    type: (a.type as Attachment['type']) || 'file',
                    size: a.size || undefined,
                    mimeType: a.mime_type || undefined,
                    url: a.url || undefined,
                    content: a.content || undefined,
                    dataUrl: a.data_url || undefined,
                })));
            }
        }).catch(() => {});
    }, [activeProject?.id, messages.length]); // Reload after each message send

    // ── Mention data sources (projects, workflows, memories) ──
    const [mentionProjects, setMentionProjects] = useState<Array<{ name: string; path: string }>>([]);
    const [mentionWorkflows, setMentionWorkflows] = useState<Array<{ id: string; name: string; description?: string }>>([]);
    const [mentionMemories, setMentionMemories] = useState<Array<{ filename: string }>>([]);

    useEffect(() => {
        if (!isElectron) return;
        // Load projects
        window.onicode?.listProjects?.().then((r: any) => {
            if (r?.success && r.projects) setMentionProjects(r.projects.filter((p: any) => p?.name).map((p: any) => ({ name: String(p.name), path: String(p.path || '') })));
        }).catch(() => {});
        // Load workflows
        window.onicode?.workflowList?.().then((r: any) => {
            if (r?.success && r.workflows) setMentionWorkflows(r.workflows.filter((w: any) => w?.name).map((w: any) => ({ id: String(w.id), name: String(w.name), description: w.description ? String(w.description) : undefined })));
        }).catch(() => {});
        // Load memory files
        window.onicode?.memoryList?.().then((r: any) => {
            if (r?.success && r.files) setMentionMemories(r.files.map((f: any) => ({ filename: typeof f === 'string' ? f : (f.name || String(f)) })));
        }).catch(() => {});
    }, [messages.length]); // Refresh after interactions

    // Collect all available mention items
    type MentionItem = { type: 'attachment' | 'file' | 'project' | 'workflow' | 'memory'; label: string; detail: string; category: string; attachment?: Attachment; meta?: any };
    const mentionItems = React.useMemo(() => {
        const items: MentionItem[] = [];
        const seen = new Set<string>();

        // ── Projects ──
        for (const p of mentionProjects) {
            const key = `project:${p.name}`;
            if (!seen.has(key)) {
                seen.add(key);
                items.push({ type: 'project', label: p.name, detail: p.path, category: 'Projects', meta: p });
            }
        }

        // ── Workflows ──
        for (const w of mentionWorkflows) {
            const key = `workflow:${w.name}`;
            if (!seen.has(key)) {
                seen.add(key);
                items.push({ type: 'workflow', label: w.name, detail: w.description || 'workflow', category: 'Workflows', meta: w });
            }
        }

        // ── Memory files ──
        for (const m of mentionMemories) {
            const key = `memory:${m.filename}`;
            if (!seen.has(key)) {
                seen.add(key);
                items.push({ type: 'memory', label: m.filename, detail: 'memory', category: 'Memories', meta: m });
            }
        }

        // ── Attachments (project-scoped from SQLite) ──
        for (const att of projectAttachments) {
            if (!seen.has(att.name)) {
                seen.add(att.name);
                items.push({
                    type: 'attachment',
                    label: att.name,
                    detail: att.type === 'link' ? (att.url || 'link') : `${att.type}${att.size ? ` · ${Math.round(att.size / 1024)}KB` : ''}`,
                    category: 'Attachments',
                    attachment: att,
                });
            }
        }

        // ── Attachments from conversation messages ──
        for (const m of messages) {
            if (m.attachments) {
                for (const att of m.attachments) {
                    if (!seen.has(att.name)) {
                        seen.add(att.name);
                        items.push({
                            type: 'attachment',
                            label: att.name,
                            detail: att.type === 'link' ? (att.url || 'link') : `${att.type}${att.size ? ` · ${Math.round(att.size / 1024)}KB` : ''}`,
                            category: 'Attachments',
                            attachment: att,
                        });
                    }
                }
            }
        }

        // ── Pending attachments ──
        for (const att of attachments) {
            if (!seen.has(att.name)) {
                seen.add(att.name);
                items.push({
                    type: 'attachment',
                    label: att.name,
                    detail: att.type === 'link' ? (att.url || 'link') : `${att.type}${att.size ? ` · ${Math.round(att.size / 1024)}KB` : ''}`,
                    category: 'Attachments',
                    attachment: att,
                });
            }
        }

        return items;
    }, [messages, attachments, projectAttachments, mentionProjects, mentionWorkflows, mentionMemories]);

    const filteredMentions = mentionItems.filter(item =>
        typeof item.label === 'string' && item.label.toLowerCase().includes(mentionFilter)
    );

    // Scroll active mention item into view
    useEffect(() => {
        if (!showMentionMenu || !mentionMenuRef.current) return;
        const active = mentionMenuRef.current.querySelector('.mention-menu-item.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    }, [mentionIndex, showMentionMenu]);

    // ── Listen for show-history event from unified header ──
    useEffect(() => {
        const handler = () => setShowHistory(true);
        window.addEventListener('onicode-show-history', handler);
        return () => window.removeEventListener('onicode-show-history', handler);
    }, []);

    // ── Listen for agent step events (thinking, streaming, continuing, sub-agent) ──
    useEffect(() => {
        if (!window.onicode?.onAgentStep) return;
        const unsub = window.onicode.onAgentStep((data) => {
            setAgentStatus(data as typeof agentStatus);
            // Auto-open Agents panel when a sub-agent, specialist, or orchestration starts
            if (data.status === 'sub-agent' || data.status === 'specialist' || data.status === 'orchestration-start') {
                requestPanel('agents');
            }
        });
        return unsub;
    }, []);

    // ── Clear agent status when typing stops ──
    useEffect(() => {
        if (!isTyping) setAgentStatus(null);
    }, [isTyping]);

    // ── Auto-open panels when AI requests (e.g. terminal on run_command) ──
    useEffect(() => {
        if (!window.onicode?.onPanelOpen) return;
        const unsub = window.onicode.onPanelOpen((data: { type: string }) => {
            requestPanel(data.type);
        });
        return unsub;
    }, []);

    // ── Auto-update conversation title from AI-generated title ──
    useEffect(() => {
        if (!window.onicode?.onSessionTitle) return;
        const unsub = window.onicode.onSessionTitle((title: string) => {
            if (!activeConvId || !title) return;
            const convs = loadConversationsFromCache();
            const idx = convs.findIndex(c => c.id === activeConvId);
            if (idx >= 0) {
                convs[idx].title = title;
                saveConversationsCache(convs);
                setConversations(convs);
                // Update title in SQLite too
                persistConversationToSQLite(convs[idx]);
            }
        });
        return unsub;
    }, [activeConvId]);

    // ── Send via Electron IPC (with agentic tool-call support) ──
    const toolStepsRef = useRef<ToolStep[]>([]);

    const sendViaIPC = useCallback(async (
        apiMessages: Array<{ role: string; content: string }>,
        provider: ProviderConfig
    ) => {
        streamContentRef.current = '';
        toolStepsRef.current = [];
        setActiveToolSteps([]);

        // Register persistent chunk listener that survives HMR remounts
        const removeChunkListener = window.onicode!.onStreamChunk((chunk: string) => {
            streamContentRef.current += chunk;
            setStreamingContent(streamContentRef.current);
        });

        // Also register a global fallback — if the component remounts during streaming,
        // we keep accumulating text so it's not lost
        const globalChunkKey = '__onicode_stream_accumulator';
        (window as any)[globalChunkKey] = streamContentRef;

        // Listen for tool calls from the agentic loop
        // Filter out sub-agent tool calls (those with agentId) — they show in the Agents widget instead
        const removeToolCallListener = window.onicode!.onToolCall((data) => {
            if ((data as Record<string, unknown>).agentId) return; // Sub-agent tool call — don't show in main chat
            const step: ToolStep = {
                id: data.id,
                name: data.name,
                args: data.args,
                round: data.round,
                status: 'running',
            };
            toolStepsRef.current = [...toolStepsRef.current, step];
            setActiveToolSteps([...toolStepsRef.current]);
        });

        // Listen for tool results
        const removeToolResultListener = window.onicode!.onToolResult((data) => {
            if ((data as Record<string, unknown>).agentId) return; // Sub-agent result — handled by Agents widget
            toolStepsRef.current = toolStepsRef.current.map(s =>
                s.id === data.id ? { ...s, result: data.result, status: 'done' as const } : s
            );
            setActiveToolSteps([...toolStepsRef.current]);
        });

        // Listen for message breaks — finalize current bubble, start a new one
        const removeMessageBreakListener = window.onicode!.onMessageBreak(() => {
            const currentContent = streamContentRef.current;
            const currentSteps = [...toolStepsRef.current];

            // Only create a message if there's actual text content.
            // Tool-only rounds (no AI text) just get their steps folded into the next message.
            if (currentContent.trim()) {
                setMessages((prev) => [...prev, {
                    id: generateId(), role: 'ai' as const,
                    content: currentContent,
                    timestamp: Date.now(),
                    toolSteps: currentSteps.length > 0 ? currentSteps : undefined,
                }]);
                // Full reset — content was committed
                streamContentRef.current = '';
                toolStepsRef.current = [];
                setStreamingContent('');
                setActiveToolSteps([]);
            } else if (currentSteps.length > 0) {
                // No text but has tool steps — keep the steps for the next bubble
                // (they'll be attached to whatever text the AI emits next)
                // Don't create an empty message
            }
        });

        const removeDoneListener = window.onicode!.onStreamDone((error: string | null) => {
            removeChunkListener();
            removeDoneListener();
            removeToolCallListener();
            removeToolResultListener();
            removeMessageBreakListener();
            cleanupRef.current = null;
            setIsTyping(false);

            const finalContent = streamContentRef.current;
            const finalToolSteps = [...toolStepsRef.current];
            setStreamingContent('');
            streamContentRef.current = '';
            setActiveToolSteps([]);
            toolStepsRef.current = [];
            sendingRef.current = false;

            if (error) {
                setMessages((prev) => [...prev, {
                    id: generateId(), role: 'ai' as const,
                    content: `Failed to get response: ${error}\n\nCheck your API key and connection in **Settings**, or click Retry below.`,
                    isError: true,
                    timestamp: Date.now(),
                    toolSteps: finalToolSteps.length > 0 ? finalToolSteps : undefined,
                }]);
                onNewMessage?.();
            } else if (finalContent.trim() || finalToolSteps.length > 0) {
                setMessages((prev) => [...prev, {
                    id: generateId(), role: 'ai' as const,
                    content: finalContent || '',
                    timestamp: Date.now(),
                    toolSteps: finalToolSteps.length > 0 ? finalToolSteps : undefined,
                }]);
                onNewMessage?.();
            }
        });

        cleanupRef.current = () => {
            removeChunkListener(); removeDoneListener();
            removeToolCallListener(); removeToolResultListener();
            removeMessageBreakListener();
        };

        const result = await window.onicode!.sendMessage(apiMessages, {
            id: provider.id,
            apiKey: provider.apiKey!,
            baseUrl: provider.baseUrl,
            selectedModel: provider.selectedModel,
            projectPath: activeProjectRef.current?.path,
            reasoningEffort: localStorage.getItem('onicode-thinking-level') || 'medium',
        });

        if (result.error) {
            removeChunkListener();
            removeDoneListener();
            removeToolCallListener();
            removeToolResultListener();
            cleanupRef.current = null;
            setIsTyping(false);
            setStreamingContent('');
            streamContentRef.current = '';
            setActiveToolSteps([]);
            toolStepsRef.current = [];
            sendingRef.current = false;
            setMessages((prev) => [...prev, {
                id: generateId(), role: 'ai' as const,
                content: `Failed to get response: ${result.error}\n\nCheck your API key and connection in **Settings**, or click Retry below.`,
                isError: true,
                timestamp: Date.now(),
            }]);
        }
    }, []);

    // ── Send via direct fetch (browser fallback) ──
    const sendViaFetch = useCallback(async (
        apiMessages: Array<{ role: string; content: string }>,
        provider: ProviderConfig
    ) => {
        const endpoint = getApiEndpoint(provider);
        const model = provider.selectedModel || 'gpt-4o';
        const isOModel = model.startsWith('o');

        const bodyPayload: Record<string, unknown> = {
            model,
            messages: isOModel ? apiMessages.filter((m) => m.role !== 'system') : apiMessages,
            stream: true,
        };
        if (isOModel) bodyPayload.max_completion_tokens = 4096;
        else bodyPayload.max_tokens = 4096;

        const abortController = new AbortController();
        abortRef.current = abortController;

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${provider.apiKey}`,
                },
                body: JSON.stringify(bodyPayload),
                signal: abortController.signal,
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                let errorMsg = errData.error?.message || `API error: ${response.status}`;
                if (response.status === 401) errorMsg = 'Authentication failed (401). Check your API key or sign in again.';
                if (response.status === 403) errorMsg = `Access denied for model "${model}". Try a different model.`;
                throw new Error(errorMsg);
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');

            const decoder = new TextDecoder();
            let fullContent = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                for (const line of chunk.split('\n')) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]' || !trimmed.startsWith('data: ')) continue;
                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        const delta = json.choices?.[0]?.delta?.content;
                        if (delta) { fullContent += delta; setStreamingContent(fullContent); }
                    } catch { /* skip malformed */ }
                }
            }

            setIsTyping(false);
            setStreamingContent('');
            sendingRef.current = false;
            if (fullContent.trim()) {
                setMessages((prev) => [...prev, {
                    id: generateId(), role: 'ai' as const, content: fullContent, timestamp: Date.now(),
                }]);
            }
        } catch (err: unknown) {
            setIsTyping(false);
            setStreamingContent('');
            sendingRef.current = false;
            if (err instanceof Error && err.name === 'AbortError') return;
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            setMessages((prev) => [...prev, {
                id: generateId(), role: 'ai' as const,
                content: `Failed to get response: ${errorMessage}\n\nCheck your API key and connection in **Settings**, or click Retry below.`,
                isError: true,
                timestamp: Date.now(),
            }]);
        }
    }, []);

    // ── Recover streaming state on HMR remount ──
    useEffect(() => {
        if (!isElectron) return;
        const globalRef = (window as any).__onicode_stream_accumulator;
        if (globalRef && globalRef.current && globalRef.current.length > 0) {
            // A stream was active before HMR — recover it
            streamContentRef.current = globalRef.current;
            setStreamingContent(globalRef.current);
            setIsTyping(true);
            sendingRef.current = true;
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Main send handler ──
    const sendToAI = useCallback(async (userMessage: string, allMessages: Message[], currentAttachments?: Attachment[]) => {
        // Guard against React StrictMode double-invoke
        if (sendingRef.current) return;
        sendingRef.current = true;

        setIsTyping(true);
        setStreamingContent('');
        streamContentRef.current = '';

        // Use ref to always get the current activeProject (closures capture stale props)
        const currentProject = activeProjectRef.current;

        const provider = getActiveProvider();
        if (!provider) {
            setIsTyping(false);
            sendingRef.current = false;
            setMessages((prev) => [...prev, {
                id: generateId(), role: 'ai' as const,
                content: 'No AI provider connected. Go to **Settings** and configure an API key for OpenAI Codex, OniAI Gateway, or OpenClaw Gateway, then test the connection.\n\nOnce connected, I\'ll be ready to chat.',
                timestamp: Date.now(),
            }]);
            return;
        }

        // Build attachment context — include actual file contents for code/text files
        // Images with dataUrl are passed separately for vision API support
        let attachmentContext = '';
        const imageAttachments: Array<{ name: string; dataUrl: string; mimeType?: string }> = [];
        if (currentAttachments && currentAttachments.length > 0) {
            const parts: string[] = ['\n\n---\n**Attached files:**'];
            for (const att of currentAttachments) {
                const sizeStr = att.size ? (att.size < 1024 ? `${att.size}B` : `${Math.round(att.size / 1024)}KB`) : '';
                if (att.type === 'link') {
                    parts.push(`\n**Link:** [${att.name}](${att.url})`);
                } else if (att.type === 'image' && att.dataUrl) {
                    // Collect images for vision API — send as multimodal content
                    imageAttachments.push({ name: att.name, dataUrl: att.dataUrl, mimeType: att.mimeType });
                    parts.push(`\n**Image: \`${att.name}\`** (${sizeStr}) — image included for visual analysis`);
                } else if (att.type === 'image') {
                    parts.push(`\n**Image: \`${att.name}\`** (${sizeStr}${att.mimeType ? ', ' + att.mimeType : ''}) — image attached but no preview available`);
                } else if (att.type === 'doc') {
                    parts.push(`\n**Document: \`${att.name}\`** (${sizeStr}${att.mimeType ? ', ' + att.mimeType : ''})${att.content ? '\n```\n' + att.content + '\n```' : ' — binary document, content not directly readable'}`);
                } else if (att.content) {
                    // Detect language from extension for syntax highlighting
                    const ext = att.name.split('.').pop()?.toLowerCase() || '';
                    const langMap: Record<string, string> = { ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', css: 'css', html: 'html', json: 'json', md: 'markdown', yml: 'yaml', yaml: 'yaml', sql: 'sql', sh: 'bash' };
                    const lang = langMap[ext] || ext;
                    parts.push(`\n**File: \`${att.name}\`** (${sizeStr})\n\`\`\`${lang}\n${att.content}\n\`\`\``);
                } else {
                    parts.push(`\n**File: \`${att.name}\`** (${att.type}, ${sizeStr}) — binary file, content not readable`);
                }
            }
            attachmentContext = parts.join('');
        }

        // Load core memories for injection into system prompt (including project memory)
        let memories: { soul?: string | null; user?: string | null; longTerm?: string | null; dailyToday?: string | null; dailyYesterday?: string | null; projectMemory?: string | null; recentFacts?: string[] } | undefined;
        if (isElectron) {
            try {
                const projectId = (scope === 'project' && currentProject?.id) ? currentProject.id : undefined;
                const memResult = await window.onicode!.memoryLoadCore(projectId);
                if (memResult.success && memResult.memories) {
                    memories = {
                        soul: memResult.memories.soul,
                        user: memResult.memories.user,
                        longTerm: memResult.memories.longTerm,
                        dailyToday: memResult.memories.dailyToday,
                        dailyYesterday: memResult.memories.dailyYesterday,
                        projectMemory: memResult.memories.projectMemory,
                        recentFacts: memResult.memories.recentFacts,
                    };
                }
            } catch { /* memory load failed, proceed without */ }
        }

        // Load project docs if in project scope
        let projectDocs: Array<{ name: string; content: string }> | undefined;
        if (scope === 'project' && currentProject?.id && isElectron) {
            try {
                const projResult = await window.onicode!.getProject(currentProject.id);
                if (projResult.docs) {
                    projectDocs = projResult.docs.map((d: { name: string; content: string }) => ({
                        name: d.name,
                        content: d.content,
                    }));
                }
            } catch { /* proceed without project docs */ }
        }

        // Load AGENTS.md (project intelligence file — equivalent to CLAUDE.md)
        let agentsMd: string | undefined;
        if (currentProject?.path && isElectron) {
            try {
                const agentsResult = await window.onicode!.readFile(`${currentProject.path}/.onicode/AGENTS.md`);
                if (agentsResult.success && agentsResult.content) agentsMd = agentsResult.content;
            } catch { /* no AGENTS.md */ }
            if (!agentsMd) {
                try {
                    const agentsResult = await window.onicode!.readFile(`${currentProject.path}/AGENTS.md`);
                    if (agentsResult.success && agentsResult.content) agentsMd = agentsResult.content;
                } catch { /* no AGENTS.md */ }
            }
        }

        // Load hooks summary and custom commands summary
        let hooksSummary: string | undefined;
        let customCommandsSummary: string | undefined;
        if (isElectron) {
            try {
                const hooksRes = await window.onicode!.hooksList();
                if (hooksRes.hooks && Object.keys(hooksRes.hooks).length > 0) {
                    const lines: string[] = [];
                    for (const [type, hookList] of Object.entries(hooksRes.hooks)) {
                        for (const hook of hookList as HookDefinition[]) {
                            lines.push(`- **${type}**${hook.matcher ? ` (match: /${hook.matcher}/)` : ''}: \`${hook.command}\``);
                        }
                    }
                    hooksSummary = lines.join('\n');
                }
            } catch { /* hooks not ready */ }
            try {
                const cmds = await window.onicode!.customCommandsList(activeProjectRef.current?.path);
                if (cmds.length > 0) {
                    customCommandsSummary = cmds.map((c: CustomCommand) => `- \`/${c.name}\` — ${c.description} (${c.source})`).join('\n');
                }
            } catch { /* commands not ready */ }
        }

        // Load MCP tools for system prompt injection
        let mcpTools: MCPToolInfo[] | undefined;
        if (isElectron) {
            try {
                const mcpRes = await window.onicode!.mcpGetToolsForPrompt();
                if (mcpRes.tools && mcpRes.tools.length > 0) {
                    mcpTools = mcpRes.tools;
                }
            } catch { /* MCP not ready */ }
        }

        // Load machine environment info (timezone, platform, OS, etc.)
        let environment: Record<string, unknown> | undefined;
        if (isElectron) {
            try {
                environment = await window.onicode!.getEnvironment();
            } catch { /* environment info not available */ }
        }

        // Load recent conversation titles for context recall
        let recentConversations: Array<{ title: string; date: string; project?: string }> | undefined;
        if (isElectron) {
            try {
                const convRes = await window.onicode!.conversationList(10, 0);
                if (convRes.success && convRes.conversations) {
                    recentConversations = convRes.conversations
                        .filter((c: { id: string; title: string }) => c.id !== activeConvId) // Exclude current
                        .slice(0, 8)
                        .map((c: { title: string; updated_at: number; project_name?: string }) => ({
                            title: c.title || 'Untitled',
                            date: c.updated_at ? new Date(c.updated_at).toISOString().slice(0, 10) : 'unknown',
                            project: c.project_name || undefined,
                        }));
                }
            } catch { /* conversation list failed */ }
        }

        // Build context-aware system prompt
        const customPrompt = localStorage.getItem('onicode-custom-system-prompt') || undefined;
        const systemContent = buildSystemPromptCached({
            activeProjectName: currentProject?.name,
            activeProjectPath: currentProject?.path,
            projectDocs,
            customSystemPrompt: customPrompt,
            memories,
            agentsMd,
            hooksSummary,
            customCommandsSummary,
            autoCommitEnabled: localStorage.getItem('onicode-auto-commit') !== 'false',
            mcpTools,
            recentConversations,
            environment: environment as AIContext['environment'],
        });

        // Auto-compact if context is getting large
        let messagesToSend = allMessages;
        if (isElectron && allMessages.length > 8) {
            try {
                // Include tool step content in token estimation for accuracy
                const msgsForEstimate = allMessages.map(m => {
                    let content = m.content;
                    if (m.toolSteps) {
                        const toolContent = m.toolSteps.map(s =>
                            JSON.stringify(s.args || {}) + JSON.stringify(s.result || {})
                        ).join('');
                        content += toolContent;
                    }
                    return { role: m.role, content };
                });
                const tokenEst = await window.onicode!.estimateTokens(msgsForEstimate);
                if (tokenEst.tokens > 80000) {
                    const compactResult = await window.onicode!.compactMessages(
                        allMessages.map(m => ({ role: m.role, content: m.content, toolSteps: m.toolSteps }))
                    );
                    if (compactResult.compacted && compactResult.messages) {
                        messagesToSend = compactResult.messages.map((m, i) => ({
                            id: `compacted-${i}`,
                            role: m.role as 'user' | 'ai',
                            content: m.content,
                            timestamp: Date.now(),
                        }));
                    }
                }
            } catch { /* compaction failed, use original messages */ }
        }

        // Build the final user message — if images are attached, use multimodal content format
        const finalUserText = userMessage + attachmentContext;
        let finalUserContent: string | Array<{ type: string; text?: string; image_url?: { url: string }; source?: { type: string; media_type: string; data: string } }>;
        if (imageAttachments.length > 0) {
            // Multimodal content: text + image blocks (main process will route to correct API format)
            finalUserContent = [
                { type: 'text', text: finalUserText },
                ...imageAttachments.map(img => ({
                    type: 'image_url' as const,
                    image_url: { url: img.dataUrl },
                })),
            ];
        } else {
            finalUserContent = finalUserText;
        }

        const apiMessages = [
            { role: 'system', content: systemContent },
            ...messagesToSend.map((m) => ({
                role: m.role === 'ai' ? 'assistant' : 'user',
                content: m.content,
            })),
            { role: 'user', content: finalUserContent },
        ];

        if (isElectron) {
            await sendViaIPC(apiMessages, provider);
        } else {
            await sendViaFetch(apiMessages, provider);
        }
    }, [sendViaIPC, sendViaFetch]);

    // ── Persist messages when they change ──
    useEffect(() => {
        if (messages.length > 0) {
            const newId = persistConversation(messages, activeConvId);
            if (newId !== activeConvId) setActiveConvId(newId);
        }
    }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

    const stopGeneration = useCallback(() => {
        if (isElectron) {
            window.onicode!.abortAI();
        } else {
            abortRef.current?.abort();
        }

        if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }

        setIsTyping(false);
        sendingRef.current = false;
        const finalContent = streamContentRef.current || '';
        const finalToolSteps = [...toolStepsRef.current];

        // Preserve both streaming content AND tool steps when user stops generation
        if (finalContent.trim() || finalToolSteps.length > 0) {
            setMessages((prev) => [...prev, {
                id: generateId(),
                role: 'ai' as const,
                content: finalContent || '*(Stopped by user)*',
                timestamp: Date.now(),
                toolSteps: finalToolSteps.length > 0 ? finalToolSteps : undefined,
            }]);
        }
        setStreamingContent('');
        streamContentRef.current = '';
        setActiveToolSteps([]);
        toolStepsRef.current = [];
    }, []);

    // ── Attachments ──
    const handleFileSelect = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;
        processFiles(Array.from(files));
        e.target.value = '';
    }, []);

    const processFiles = useCallback((files: File[]) => {
        for (const f of files) {
            // Block video files
            if (f.type.startsWith('video/') || /\.(mp4|avi|mov|wmv|flv|mkv|webm|m4v)$/i.test(f.name)) {
                continue; // Skip videos silently
            }

            const isImage = f.type.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(f.name);
            const isDoc = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|odt|rtf)$/i.test(f.name);

            const att: Attachment = {
                type: isImage ? 'image' as const : isDoc ? 'doc' as const : 'file' as const,
                name: f.name,
                size: f.size,
                mimeType: f.type,
            };

            // Read image as data URL for thumbnail preview
            if (isImage && f.size < 5_000_000) {
                const reader = new FileReader();
                reader.onload = () => {
                    att.dataUrl = reader.result as string;
                    setAttachments((prev) => [...prev, att]);
                };
                reader.readAsDataURL(f);
                continue;
            }

            // Read text content for code/text files (up to 100KB)
            const isText = f.type.startsWith('text/') ||
                /\.(ts|tsx|js|jsx|json|md|css|html|py|rb|go|rs|java|c|cpp|h|yml|yaml|toml|env|sh|sql|xml|csv|txt|log|cfg|ini)$/i.test(f.name);

            if (isText && f.size < 100_000) {
                const reader = new FileReader();
                reader.onload = () => {
                    att.content = (reader.result as string).slice(0, 50_000);
                    setAttachments((prev) => [...prev, att]);
                };
                reader.readAsText(f);
            } else {
                setAttachments((prev) => [...prev, att]);
            }
        }
    }, []);

    const handlePaste = useCallback((e: React.ClipboardEvent) => {
        const text = e.clipboardData.getData('text');
        // Auto-detect pasted URLs as link attachments
        if (text && /^https?:\/\/\S+$/.test(text.trim())) {
            e.preventDefault();
            const url = text.trim();
            setAttachments((prev) => [...prev, {
                type: 'link',
                name: new URL(url).hostname,
                url,
            }]);
            return;
        }
        // Handle pasted images
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                e.preventDefault();
                const file = items[i].getAsFile();
                if (file) processFiles([file]);
                return;
            }
        }
    }, [processFiles]);

    // ── Drag-and-drop ──
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Only hide if leaving the container (not entering a child)
        if (e.currentTarget === e.target) setIsDragOver(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) processFiles(files);
    }, [processFiles]);

    const removeAttachment = useCallback((index: number) => {
        setAttachments((prev) => prev.filter((_, i) => i !== index));
    }, []);

    // ── New chat ──
    const newChat = useCallback(() => {
        if (isElectron) window.onicode!.abortAI();
        else abortRef.current?.abort();
        if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
        setMessages([]);
        setInput('');
        setIsTyping(false);
        setStreamingContent('');
        streamContentRef.current = '';
        sendingRef.current = false;
        setActiveConvId(null);
        localStorage.removeItem(ACTIVE_CONV_KEY);
        setAttachments([]);
    }, []);

    // ── Listen for external new-chat signal (from project switch / exit) ──
    useEffect(() => {
        const handler = () => newChat();
        window.addEventListener('onicode-new-chat', handler);
        return () => window.removeEventListener('onicode-new-chat', handler);
    }, [newChat]);

    // ── Execute slash commands (delegated to executor module) ──
    const handleCommand = useCallback(async (cmd: string): Promise<boolean> => {
        const result = await executeCommand(cmd, {
            messages,
            setMessages,
            newChat,
            stopGeneration,
            setShowHistory,
            activeConvId,
        });
        return result.handled;
    }, [messages, newChat, stopGeneration, activeConvId]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Auto-detect project references and switch to project mode ──
    const autoDetectProject = useCallback(async (text: string) => {
        if (!isElectron || scope === 'project') return; // already in project mode
        const lower = text.toLowerCase();
        // Match phrases like "continue working on X", "work on X", "open X project", "switch to X"
        const projectPhrases = /(?:continue|work|working|open|switch|resume|start)\s+(?:on|to|with)?\s+(?:the\s+)?(.+?)(?:\s+project)?$/i;
        const match = lower.match(projectPhrases);
        if (!match) return;
        const query = match[1].trim();
        if (query.length < 2) return;

        try {
            const { projects } = await window.onicode!.listProjects();
            // Fuzzy match: project name contains the query or query contains the project name
            const found = projects.find((p: { id: string; name: string; path: string }) => {
                const pName = p.name.toLowerCase();
                return pName.includes(query) || query.includes(pName);
            });
            if (found) {
                // Auto-activate the project
                window.dispatchEvent(new CustomEvent('onicode-project-activate', {
                    detail: { id: found.id, name: found.name, path: found.path },
                }));
            }
        } catch { /* project list failed */ }
    }, [scope]);

    // ── Handle send ──
    const handleSend = useCallback(async () => {
        const text = input.trim();
        if (!text) return;

        // Handle slash commands
        if (text.startsWith('/')) {
            const handled = await handleCommand(text);
            if (handled) {
                setInput('');
                setShowSlashMenu(false);
                return;
            }
        }

        // Auto-detect and switch to project if user mentions one
        autoDetectProject(text);

        const userMessage: Message = {
            id: generateId(),
            role: 'user',
            content: text,
            timestamp: Date.now(),
            attachments: attachments.length > 0 ? [...attachments] : undefined,
        };

        setInput('');
        setShowSlashMenu(false);

        // Persist attachments to project-scoped storage
        if (attachments.length > 0 && activeProject?.id && window.onicode?.attachmentSave) {
            for (const att of attachments) {
                window.onicode.attachmentSave({
                    id: generateId(),
                    projectId: activeProject.id,
                    name: att.name,
                    type: att.type,
                    size: att.size,
                    mimeType: att.mimeType,
                    url: att.url,
                    content: att.content,
                    dataUrl: att.dataUrl,
                    conversationId: activeConvId || undefined,
                    createdAt: Date.now(),
                }).catch(() => {});
            }
        }
        setAttachments([]);

        setMessages((prev) => {
            const updated = [...prev, userMessage];
            sendToAI(text, prev, userMessage.attachments);
            return updated;
        });
    }, [input, attachments, activeProject?.id, activeConvId, handleCommand, sendToAI, autoDetectProject]);

    // ── Keyboard handler ──
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        // Slash command menu navigation
        if (showSlashMenu && filteredCommands.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSlashIndex((prev) => (prev + 1) % filteredCommands.length);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSlashIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
                return;
            }
            if (e.key === 'Tab' || (e.key === 'Enter' && filteredCommands[slashIndex])) {
                e.preventDefault();
                const cmd = filteredCommands[slashIndex].name;
                // Replace only the /filter part at the end of input
                const newInput = input.replace(/(^|\s)(\/\S*)$/, (_m, space) => space + cmd + ' ');
                setInput(newInput);
                setShowSlashMenu(false);
                return;
            }
            if (e.key === 'Escape') {
                setShowSlashMenu(false);
                return;
            }
        }

        // @ mention menu navigation
        if (showMentionMenu && filteredMentions.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMentionIndex((prev) => (prev + 1) % filteredMentions.length);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionIndex((prev) => (prev - 1 + filteredMentions.length) % filteredMentions.length);
                return;
            }
            if (e.key === 'Tab' || (e.key === 'Enter' && filteredMentions[mentionIndex])) {
                e.preventDefault();
                const item = filteredMentions[mentionIndex];
                const atIndex = input.lastIndexOf('@');
                const prefix = item.type === 'project' ? '@project:' : item.type === 'workflow' ? '@workflow:' : item.type === 'memory' ? '@memory:' : '@';
                const newInput = input.slice(0, atIndex) + prefix + item.label + ' ';
                setInput(newInput);
                // Re-attach the referenced attachment
                if (item.type === 'attachment' && item.attachment && !attachments.some(a => a.name === item.attachment!.name)) {
                    setAttachments(prev => [...prev, item.attachment!]);
                }
                setShowMentionMenu(false);
                return;
            }
            if (e.key === 'Escape') {
                setShowMentionMenu(false);
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }, [showSlashMenu, filteredCommands, slashIndex, showMentionMenu, filteredMentions, mentionIndex, input, attachments, handleSend]);

    // ── Welcome suggestion click ──
    const handleSuggestionClick = useCallback((suggestion: string) => {
        const userMessage: Message = {
            id: generateId(),
            role: 'user',
            content: suggestion,
            timestamp: Date.now(),
        };
        setMessages((prev) => {
            const updated = [...prev, userMessage];
            sendToAI(suggestion, prev);
            return updated;
        });
    }, [sendToAI]);

    // ── Load conversation ──
    const loadConversation = useCallback((conv: Conversation) => {
        newChat();
        setTimeout(() => {
            setMessages(conv.messages);
            setActiveConvId(conv.id);
            localStorage.setItem(ACTIVE_CONV_KEY, conv.id);
            setShowHistory(false);
        }, 0);
    }, [newChat]);

    const deleteConversation = useCallback((convId: string) => {
        const convs = loadConversationsFromCache().filter((c) => c.id !== convId);
        saveConversationsCache(convs);
        setConversations(convs);
        deleteFromSQLite(convId);
        if (activeConvId === convId) newChat();
    }, [activeConvId, newChat]);

    // ── Toggle expanded step ──
    const toggleStepExpand = useCallback((stepId: string, event?: React.MouseEvent) => {
        const clickedEl = event?.currentTarget as HTMLElement | undefined;
        const isGroup = stepId.startsWith('group-');
        setExpandedSteps(prev => {
            const next = new Set(prev);
            if (next.has(stepId)) {
                // Closing this item
                next.delete(stepId);
            } else if (isGroup) {
                // Opening a group — close other groups (accordion), keep sub-items
                for (const key of next) {
                    if (key.startsWith('group-')) next.delete(key);
                }
                next.add(stepId);
            } else {
                // Opening a sub-item — keep parent group open, close other sub-items
                for (const key of next) {
                    if (!key.startsWith('group-')) next.delete(key);
                }
                next.add(stepId);
            }
            return next;
        });
        if (clickedEl) {
            requestAnimationFrame(() => {
                clickedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            });
        }
    }, []);

    // ── Format elapsed time ──
    const formatTime = (seconds: number): string => {
        if (seconds < 60) return `${seconds}s`;
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}m ${s}s`;
    };

    // ── Render tool steps as rich contextual messages ──
    const renderToolSteps = (steps: ToolStep[]) => {
        if (!steps || steps.length === 0) return null;

        // Tool display config
        const toolIcon = (name: string): string => {
            const icons: Record<string, string> = {
                read_file: 'Read', edit_file: 'Edit', multi_edit: 'Edit', create_file: 'Created',
                delete_file: 'Deleted', list_directory: 'Listed', search_files: 'Searched',
                run_command: 'Ran', check_terminal: 'Terminal', list_terminals: 'Terminals',
                init_project: 'Init', task_add: 'Task', task_update: 'Task',
                task_list: 'Tasks', milestone_create: 'Milestone', browser_navigate: 'Browser', browser_screenshot: 'Screenshot',
                browser_evaluate: 'Browser JS', browser_click: 'Clicked', browser_type: 'Typed',
                browser_console_logs: 'Console', browser_close: 'Browser',
                orchestrate: 'Orchestration', spawn_specialist: 'Specialist',
                spawn_sub_agent: 'Sub-agent', get_agent_status: 'Agent',
                get_orchestration_status: 'Orchestration',
                glob_files: 'Found', explore_codebase: 'Explored', memory_write: 'Memory',
                memory_append: 'Memory', memory_search: 'Memory Search', memory_save_fact: 'Remembered',
                conversation_search: 'Recalled', conversation_recall: 'Loaded Context',
                webfetch: 'Fetched', websearch: 'Searched',
                get_context_summary: 'Context', get_system_logs: 'Logs', get_changelog: 'Changelog',
                git_commit: 'Committed', git_push: 'Pushed', git_status: 'Git Status',
                find_symbol: 'Def', find_references: 'Refs', list_symbols: 'Symbols',
                get_type_info: 'Type', semantic_search: 'Search', index_codebase: 'Index',
                git_diff: 'Diff', git_log: 'Log', git_branches: 'Branch',
                git_checkout: 'Checkout', git_stash: 'Stash', git_pull: 'Pull',
                git_stage: 'Staged', git_unstage: 'Unstaged', git_merge: 'Merged',
                git_reset: 'Reset', git_tag: 'Tag', git_remotes: 'Remotes', git_show: 'Show',
                find_implementation: 'Found', impact_analysis: 'Impact', prepare_edit_context: 'Context',
                smart_read: 'Smart Read', batch_search: 'Batch Search',
                verify_project: 'Verified',
                git_create_pr: 'PR Created', git_list_prs: 'PRs', git_publish: 'Published',
                gh_cli: 'GitHub', gws_cli: 'Workspace',
                ask_user_question: 'Question',
                sequential_thinking: 'Thinking',
                trajectory_search: 'History Search',
                find_by_name: 'Found Files',
                read_url_content: 'Web Fetch',
                view_content_chunk: 'Reading',
                read_notebook: 'Notebook',
                edit_notebook: 'Edit Notebook',
                read_deployment_config: 'Deploy Config',
                deploy_web_app: 'Deploying',
                check_deploy_status: 'Deploy Status',
                create_schedule: 'Scheduled', list_schedules: 'Schedules', delete_schedule: 'Unscheduled',
                set_timer: 'Timer Set',
                create_workflow: 'Workflow Created', run_workflow: 'Workflow Run', list_workflows: 'Workflows', delete_workflow: 'Workflow Deleted',
                configure_heartbeat: 'Heartbeat',
            };
            return icons[name] || name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        };

        // Build rich detail from step result
        const getDetail = (step: ToolStep): string => {
            const a = step.args;
            const r = step.result as Record<string, unknown> | undefined;

            switch (step.name) {
                case 'create_file': {
                    const fname = String(a.file_path || '').split('/').pop();
                    const lines = r?.lines ?? (typeof a.content === 'string' ? (a.content as string).split('\n').length : '?');
                    return `${fname} (${lines} lines)`;
                }
                case 'edit_file': case 'multi_edit': {
                    const fname = String(a.file_path || '').split('/').pop();
                    const added = r?.lines_added ?? '?';
                    const removed = r?.lines_removed ?? '?';
                    return `${fname} (+${added} -${removed})`;
                }
                case 'read_file': {
                    const fname = String(a.file_path || '').split('/').pop();
                    const total = r?.total_lines ?? '';
                    return `${fname}${total ? ` (${total} lines)` : ''}`;
                }
                case 'delete_file':
                    return String(a.file_path || '').split('/').pop() || '';
                case 'run_command': {
                    const cmd = String(a.command || '').slice(0, 80);
                    const exit = r?.exitCode != null ? ` [exit ${r.exitCode}]` : '';
                    const bg = r?.background ? ' (background)' : '';
                    return `\`${cmd}\`${exit}${bg}`;
                }
                case 'init_project':
                    return String(a.name || r?.project_name || '');
                case 'task_add':
                    return String(a.content || '').slice(0, 60);
                case 'task_update': {
                    const status = a.status || '';
                    return `#${a.id} → ${status}`;
                }
                case 'task_list': {
                    if (r && typeof r === 'object' && 'total' in r) return `${r.done}/${r.total} done`;
                    return '';
                }
                case 'create_plan':
                    return String(a.title || '').slice(0, 60);
                case 'update_plan':
                    return String(a.title || a.status || 'updated').slice(0, 40);
                case 'get_plan': {
                    if (r && typeof r === 'object' && 'plan' in r && r.plan) return String((r.plan as Record<string, unknown>).title || '');
                    return 'No active plan';
                }
                case 'search_files': case 'websearch':
                    return `"${String(a.query || '').slice(0, 50)}"`;
                case 'browser_navigate':
                    return String(a.url || '').replace(/^https?:\/\//, '').slice(0, 50);
                case 'browser_screenshot': {
                    const screenshotPath = r?.path as string;
                    return screenshotPath ? `${String(a.name || '')}` : String(a.name || '');
                }
                case 'list_directory':
                    return String(a.dir_path || '').split('/').pop() || '';
                case 'glob_files':
                    return String(a.pattern || '');
                case 'explore_codebase':
                    return String(a.project_path || '').split('/').pop() || '';
                case 'verify_project':
                    return String(a.project_path || '').split('/').pop() || '';
                case 'spawn_sub_agent':
                case 'spawn_specialist':
                    return String(a.task || '').slice(0, 60);
                case 'orchestrate':
                    return String(a.description || '').slice(0, 60);
                case 'get_orchestration_status':
                    return String(a.orchestration_id || '');
                case 'git_commit':
                    return String(a.message || '').slice(0, 60);
                case 'git_push':
                    return r?.success ? 'success' : '';
                case 'git_status': {
                    const files = (r as Record<string, unknown>)?.files;
                    return Array.isArray(files) ? `${files.length} changed` : '';
                }
                case 'find_symbol': {
                    const sym = String(a.symbol || a.name || '');
                    const loc = r?.file ? String(r.file).split('/').pop() : '';
                    return loc ? `${sym} → ${loc}` : sym;
                }
                case 'find_references': {
                    const sym = String(a.symbol || a.name || '');
                    const refs = Array.isArray(r?.references) ? (r.references as unknown[]).length : r?.count ?? '?';
                    return `${sym} (${refs} refs)`;
                }
                case 'list_symbols': {
                    const fname = String(a.file_path || a.file || '').split('/').pop() || '';
                    const count = Array.isArray(r?.symbols) ? (r.symbols as unknown[]).length : r?.count ?? '?';
                    return `${fname} (${count} symbols)`;
                }
                case 'get_type_info': {
                    const typeStr = String(r?.type || r?.type_string || a.symbol || '');
                    return typeStr.slice(0, 80);
                }
                case 'semantic_search': {
                    const query = String(a.query || '').slice(0, 40);
                    const count = Array.isArray(r?.results) ? (r.results as unknown[]).length : r?.count ?? '?';
                    return `"${query}" (${count} results)`;
                }
                case 'index_codebase': {
                    const indexed = r?.files_indexed ?? r?.count ?? '?';
                    return `${indexed} files indexed`;
                }
                case 'git_diff': {
                    const files = Array.isArray(r?.files) ? (r.files as unknown[]).length : r?.file_count;
                    return files ? `${files} files changed` : r?.summary ? String(r.summary).slice(0, 60) : 'no changes';
                }
                case 'git_log': {
                    const commits = Array.isArray(r?.commits) ? (r.commits as unknown[]).length : r?.count ?? '?';
                    return `${commits} commits`;
                }
                case 'git_branches': {
                    const current = r?.current || r?.current_branch || '';
                    return current ? `on ${current}` : '';
                }
                case 'git_checkout': {
                    const branch = String(a.branch || r?.branch || '');
                    const created = r?.created ? ' (new)' : '';
                    return `${branch}${created}`;
                }
                case 'git_stash': {
                    const action = String(a.action || a.command || 'push');
                    return action;
                }
                case 'git_pull': {
                    const ok = r?.success;
                    const summary = r?.summary || r?.output;
                    return ok ? (summary ? String(summary).slice(0, 60) : 'success') : 'failed';
                }
                case 'git_stage': {
                    const files = Array.isArray(a.files) ? a.files as string[] : [];
                    return files.length > 0 ? `${files.length} file(s)` : String(a.files || '.');
                }
                case 'git_unstage': {
                    const files = Array.isArray(a.files) ? a.files as string[] : [];
                    return files.length > 0 ? `${files.length} file(s)` : '';
                }
                case 'git_merge': {
                    const branch = String(a.branch || '');
                    const ok = r?.success;
                    const conflicts = r?.conflicts;
                    return conflicts ? `${branch} (conflicts!)` : ok ? branch : `${branch} (failed)`;
                }
                case 'git_reset': {
                    const mode = String(a.mode || 'mixed');
                    const target = a.target ? String(a.target).slice(0, 10) : 'HEAD';
                    return `--${mode} ${target}`;
                }
                case 'git_tag': {
                    const action = String(a.action || 'list');
                    if (action === 'list') {
                        const tags = Array.isArray(r?.tags) ? (r.tags as unknown[]).length : '?';
                        return `${tags} tags`;
                    }
                    return `${action} ${a.name || ''}`;
                }
                case 'git_remotes': {
                    const remotes = Array.isArray(r?.remotes) ? (r.remotes as unknown[]).length : '?';
                    return `${remotes} remote(s)`;
                }
                case 'git_show': {
                    const ref = String(a.ref || r?.hash || 'HEAD').slice(0, 10);
                    return ref;
                }
                case 'find_implementation': {
                    const desc = String(a.description || '').slice(0, 50);
                    const total = r?.total ?? '?';
                    return `"${desc}" (${total} results)`;
                }
                case 'impact_analysis': {
                    const fname = String(a.file_path || '').split('/').pop();
                    return r?.impactSummary ? `${fname}: ${r.impactSummary}` : fname || '';
                }
                case 'prepare_edit_context': {
                    const fname = String(a.file_path || '').split('/').pop();
                    const outline = Array.isArray(r?.outline) ? (r.outline as unknown[]).length : '?';
                    return `${fname} (${outline} symbols)`;
                }
                case 'smart_read': {
                    const fname = String(a.file_path || '').split('/').pop();
                    const mode = r?.mode || '';
                    return `${fname} [${mode}]`;
                }
                case 'batch_search': {
                    const total = r?.total ?? '?';
                    const qCount = Array.isArray(a.queries) ? (a.queries as unknown[]).length : '?';
                    return `${qCount} queries → ${total} results`;
                }
                case 'ask_user_question': {
                    const answer = r?.answer;
                    return answer ? `→ ${String(answer).slice(0, 60)}` : '(waiting...)';
                }
                case 'sequential_thinking': {
                    const num = a.thought_number ?? '?';
                    const total = a.total_thoughts ?? '?';
                    const isRev = a.is_revision ? ' (revision)' : '';
                    const branch = a.branch_id ? ` [${a.branch_id}]` : '';
                    return `Step ${num}/${total}${isRev}${branch}`;
                }
                case 'trajectory_search': {
                    const total = r?.total ?? '?';
                    return `"${String(a.query || '').slice(0, 40)}" (${total} results)`;
                }
                case 'find_by_name': {
                    const total = r?.total ?? '?';
                    return `"${String(a.pattern || '')}" (${total} found)`;
                }
                case 'read_url_content': {
                    const url = String(a.url || '');
                    const domain = url.replace(/^https?:\/\//, '').split('/')[0];
                    const chunks = r?.total_chunks ?? '?';
                    return `${domain} (${chunks} chunks)`;
                }
                case 'view_content_chunk': {
                    const pos = a.position ?? '?';
                    const total = r?.total_chunks ?? '?';
                    return `Chunk ${pos}/${total}`;
                }
                case 'read_notebook': {
                    const fname = String(a.file_path || '').split('/').pop();
                    const cells = r?.total_cells ?? '?';
                    return `${fname} (${cells} cells)`;
                }
                case 'edit_notebook': {
                    const fname = String(a.file_path || '').split('/').pop();
                    const mode = a.edit_mode || 'replace';
                    return `${fname} (${mode} cell ${a.cell_number ?? 0})`;
                }
                case 'read_deployment_config': {
                    const framework = r?.framework ?? 'unknown';
                    const ready = r?.ready ? 'ready' : 'not ready';
                    return `${framework} — ${ready}`;
                }
                case 'deploy_web_app': {
                    const provider = a.provider || 'netlify';
                    const url = r?.url ? String(r.url) : 'deploying...';
                    return `${provider}: ${url}`;
                }
                case 'check_deploy_status': {
                    const status = r?.status ?? 'checking';
                    return `Status: ${status}`;
                }
                case 'gh_cli': {
                    const cmd = String(a.command || '').slice(0, 60);
                    const ok = r?.success;
                    return ok ? `gh ${cmd}` : `gh ${cmd} (failed)`;
                }
                case 'gws_cli': {
                    const cmd = String(a.command || '').slice(0, 60);
                    const ok = r?.success;
                    return ok ? `gws ${cmd}` : `gws ${cmd} (failed)`;
                }
                case 'memory_search': {
                    const q = String(a.query || '').slice(0, 40);
                    const total = r?.totalResults ?? r?.totalMatches ?? '?';
                    return `"${q}" (${total} results)`;
                }
                case 'memory_save_fact': {
                    const factText = String(a.fact || '').slice(0, 60);
                    const cat = String(a.category || 'general');
                    return `[${cat}] ${factText}`;
                }
                case 'conversation_search': {
                    const cq = String(a.query || '').slice(0, 40);
                    const cTotal = r?.totalResults ?? '?';
                    return `"${cq}" (${cTotal} conversations)`;
                }
                case 'conversation_recall': {
                    const cConv = r?.conversation as Record<string, unknown> | undefined;
                    const cTitle = String(cConv?.title || 'past conversation');
                    return cTitle.slice(0, 60);
                }
                case 'create_schedule': {
                    const sName = String(a.name || '');
                    const sCron = String(a.cron || '');
                    const sType = a.one_time ? 'one-time' : 'recurring';
                    return `"${sName}" (${sCron}, ${sType})`;
                }
                case 'list_schedules': {
                    const sCount = (r as Record<string, unknown>)?.schedules;
                    return `${Array.isArray(sCount) ? sCount.length : '?'} schedule(s)`;
                }
                case 'create_workflow': {
                    const wName = String(a.name || '');
                    const wSteps = Array.isArray(a.steps) ? a.steps.length : '?';
                    return `"${wName}" (${wSteps} steps)`;
                }
                case 'run_workflow': {
                    const wStatus = String(r?.status || 'running');
                    const wDur = r?.duration ? `${r.duration}ms` : '';
                    return `${wStatus} ${wDur}`.trim();
                }
                case 'list_workflows': {
                    const wCount = (r as Record<string, unknown>)?.workflows;
                    return `${Array.isArray(wCount) ? wCount.length : '?'} workflow(s)`;
                }
                case 'set_timer': {
                    const tMsg = String(a.message || '');
                    const tSec = String(a.seconds || '');
                    return `"${tMsg}" (${tSec}s)`;
                }
                case 'configure_heartbeat': {
                    const hEnabled = (r as Record<string, unknown>)?.current_config as Record<string, unknown> | undefined;
                    return hEnabled?.enabled ? 'Enabled' : 'Updated';
                }
                default:
                    return '';
            }
        };

        // Check if a step has expandable content
        const hasExpandableContent = (step: ToolStep): boolean => {
            if (step.status !== 'done' || !step.result) return false;
            const r = step.result as Record<string, unknown>;
            switch (step.name) {
                case 'run_command': return !!(r.stdout || r.stderr);
                case 'edit_file': case 'multi_edit': return true;
                case 'create_file': return true;
                case 'search_files': return !!(r.matches && Array.isArray(r.matches) && (r.matches as unknown[]).length > 0);
                case 'git_status': return !!(r.files && Array.isArray(r.files) && (r.files as unknown[]).length > 0);
                case 'find_references': return !!(r.references && Array.isArray(r.references) && (r.references as unknown[]).length > 0);
                case 'list_symbols': return !!(r.symbols && Array.isArray(r.symbols) && (r.symbols as unknown[]).length > 0);
                case 'semantic_search': return !!(r.results && Array.isArray(r.results) && (r.results as unknown[]).length > 0);
                case 'git_diff': return !!(r.diff || r.output);
                case 'git_log': return !!(r.commits && Array.isArray(r.commits) && (r.commits as unknown[]).length > 0);
                case 'git_branches': return !!(r.branches && Array.isArray(r.branches) && (r.branches as unknown[]).length > 0);
                case 'git_merge': return !!(r.output || r.conflicts);
                case 'git_show': return !!(r.diff || r.output || r.message);
                case 'git_tag': return !!(r.tags && Array.isArray(r.tags) && (r.tags as unknown[]).length > 0);
                case 'git_remotes': return !!(r.remotes && Array.isArray(r.remotes) && (r.remotes as unknown[]).length > 0);
                case 'orchestrate': return !!(r.summary || r.report);
                case 'spawn_specialist': return !!(r.result || r.content);
                case 'verify_project': return !!(r.issues || r.summary);
                case 'sequential_thinking': return true;
                case 'trajectory_search': return !!(r.results && Array.isArray(r.results) && (r.results as unknown[]).length > 0);
                case 'find_by_name': return !!(r.results && Array.isArray(r.results) && (r.results as unknown[]).length > 0);
                case 'read_url_content': return !!(r.first_chunk);
                case 'read_notebook': return !!(r.cells && Array.isArray(r.cells) && (r.cells as unknown[]).length > 0);
                case 'read_deployment_config': return true;
                case 'deploy_web_app': return !!(r.output || r.url);
                case 'gh_cli': return !!(r.output || r.data || r.error);
                case 'gws_cli': return !!(r.output || r.data || r.error);
                case 'memory_search': return !!(r.results && Array.isArray(r.results) && (r.results as unknown[]).length > 0);
                case 'conversation_search': return !!(r.results && Array.isArray(r.results) && (r.results as unknown[]).length > 0);
                case 'conversation_recall': return !!(r.context);
                case 'create_plan': return true;
                case 'get_plan': return !!(r.plan);
                default: return false;
            }
        };

        // Render expandable content for a step
        const renderExpandedContent = (step: ToolStep) => {
            const r = step.result as Record<string, unknown>;
            const a = step.args;

            switch (step.name) {
                case 'run_command': {
                    const stdout = String(r.stdout || '').trim();
                    const stderr = String(r.stderr || '').trim();
                    const exitCode = r.exitCode as number | null;
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-terminal">
                                <div className="tool-step-terminal-header">
                                    <span className="tool-step-terminal-prompt">$ {String(a.command || '').slice(0, 120)}</span>
                                    {exitCode != null && (
                                        <span className={`tool-step-exit-code ${exitCode === 0 ? 'success' : 'error'}`}>
                                            exit {exitCode}
                                        </span>
                                    )}
                                </div>
                                {stdout && <pre className="tool-step-stdout">{stdout.slice(0, 3000)}{stdout.length > 3000 ? '\n... (truncated)' : ''}</pre>}
                                {stderr && <pre className="tool-step-stderr">{stderr.slice(0, 1500)}{stderr.length > 1500 ? '\n... (truncated)' : ''}</pre>}
                            </div>
                        </div>
                    );
                }
                case 'edit_file': case 'multi_edit': {
                    const oldStr = String(a.old_string || '').trim();
                    const newStr = String(a.new_string || '').trim();
                    const linesRemoved = r.lines_removed as number || 0;
                    const linesAdded = r.lines_added as number || 0;
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-diff">
                                <div className="tool-step-diff-header">
                                    <span>{String(a.file_path || '').split('/').pop()}</span>
                                    <span className="tool-step-diff-stats">
                                        <span className="diff-added">+{linesAdded}</span>
                                        <span className="diff-removed">-{linesRemoved}</span>
                                    </span>
                                </div>
                                {oldStr && (
                                    <div className="tool-step-diff-block removed">
                                        {oldStr.split('\n').slice(0, 10).map((line, i) => (
                                            <div key={i} className="diff-line diff-line-removed">
                                                <span className="diff-sign">-</span>
                                                <span>{line}</span>
                                            </div>
                                        ))}
                                        {oldStr.split('\n').length > 10 && <div className="diff-line diff-truncated">... +{oldStr.split('\n').length - 10} more lines</div>}
                                    </div>
                                )}
                                {newStr && (
                                    <div className="tool-step-diff-block added">
                                        {newStr.split('\n').slice(0, 10).map((line, i) => (
                                            <div key={i} className="diff-line diff-line-added">
                                                <span className="diff-sign">+</span>
                                                <span>{line}</span>
                                            </div>
                                        ))}
                                        {newStr.split('\n').length > 10 && <div className="diff-line diff-truncated">... +{newStr.split('\n').length - 10} more lines</div>}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                }
                case 'create_file': {
                    const content = String(a.content || '');
                    const lines = content.split('\n');
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-diff">
                                <div className="tool-step-diff-header">
                                    <span>{String(a.file_path || '').split('/').pop()}</span>
                                    <span className="tool-step-diff-stats"><span className="diff-added">+{lines.length} lines</span></span>
                                </div>
                                <div className="tool-step-diff-block added">
                                    {lines.slice(0, 15).map((line, i) => (
                                        <div key={i} className="diff-line diff-line-added">
                                            <span className="diff-sign">+</span>
                                            <span>{line}</span>
                                        </div>
                                    ))}
                                    {lines.length > 15 && <div className="diff-line diff-truncated">... +{lines.length - 15} more lines</div>}
                                </div>
                            </div>
                        </div>
                    );
                }
                case 'search_files': {
                    const matches = r.matches as Array<{ file?: string; line?: number; content?: string }>;
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-search-results">
                                {matches.slice(0, 8).map((m, i) => (
                                    <div key={i} className="search-result-line">
                                        <span className="search-result-file">{String(m.file || '').split('/').pop()}</span>
                                        {m.line && <span className="search-result-lineno">:{m.line}</span>}
                                        <span className="search-result-content">{String(m.content || '').slice(0, 80)}</span>
                                    </div>
                                ))}
                                {matches.length > 8 && <div className="diff-line diff-truncated">... +{matches.length - 8} more results</div>}
                            </div>
                        </div>
                    );
                }
                case 'git_status': {
                    const files = r.files as Array<{ path: string; status: string; staged: boolean }>;
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-git-status">
                                {files.slice(0, 10).map((f, i) => (
                                    <div key={i} className={`git-status-file git-status-${f.status}`}>
                                        <span className="git-status-indicator">{f.staged ? 'S' : ' '}{f.status[0].toUpperCase()}</span>
                                        <span>{f.path}</span>
                                    </div>
                                ))}
                                {files.length > 10 && <div className="diff-line diff-truncated">... +{files.length - 10} more files</div>}
                            </div>
                        </div>
                    );
                }
                case 'find_references': {
                    const refs = r.references as Array<{ file?: string; line?: number; content?: string }>;
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-search-results">
                                {refs.slice(0, 10).map((ref, i) => (
                                    <div key={i} className="search-result-line">
                                        <span className="search-result-file">{String(ref.file || '').split('/').pop()}</span>
                                        {ref.line && <span className="search-result-lineno">:{ref.line}</span>}
                                        {ref.content && <span className="search-result-content">{String(ref.content).slice(0, 80)}</span>}
                                    </div>
                                ))}
                                {refs.length > 10 && <div className="diff-line diff-truncated">... +{refs.length - 10} more references</div>}
                            </div>
                        </div>
                    );
                }
                case 'list_symbols': {
                    const symbols = r.symbols as Array<{ name?: string; kind?: string; line?: number }>;
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-search-results">
                                {symbols.slice(0, 15).map((sym, i) => (
                                    <div key={i} className="search-result-line">
                                        <span className="search-result-file">{sym.kind || 'symbol'}</span>
                                        <span className="search-result-content">{sym.name}</span>
                                        {sym.line && <span className="search-result-lineno">:{sym.line}</span>}
                                    </div>
                                ))}
                                {symbols.length > 15 && <div className="diff-line diff-truncated">... +{symbols.length - 15} more symbols</div>}
                            </div>
                        </div>
                    );
                }
                case 'semantic_search': {
                    const results = r.results as Array<{ file?: string; score?: number; snippet?: string; content?: string }>;
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-search-results">
                                {results.slice(0, 8).map((res, i) => (
                                    <div key={i} className="search-result-line">
                                        <span className="search-result-file">{String(res.file || '').split('/').pop()}</span>
                                        {res.score != null && <span className="search-result-lineno"> ({(res.score as number).toFixed(2)})</span>}
                                        <span className="search-result-content">{String(res.snippet || res.content || '').slice(0, 80)}</span>
                                    </div>
                                ))}
                                {results.length > 8 && <div className="diff-line diff-truncated">... +{results.length - 8} more results</div>}
                            </div>
                        </div>
                    );
                }
                case 'git_diff': {
                    const diffText = String(r.diff || r.output || '');
                    const diffLines = diffText.split('\n');
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-terminal">
                                <pre className="tool-step-stdout">
                                    {diffLines.slice(0, 30).map((line, i) => (
                                        <div key={i} className={line.startsWith('+') ? 'diff-line diff-line-added' : line.startsWith('-') ? 'diff-line diff-line-removed' : line.startsWith('@@') ? 'diff-line diff-hunk' : ''}>
                                            {line}
                                        </div>
                                    ))}
                                    {diffLines.length > 30 && <div className="diff-line diff-truncated">{`... +${diffLines.length - 30} more lines`}</div>}
                                </pre>
                            </div>
                        </div>
                    );
                }
                case 'git_log': {
                    const commits = r.commits as Array<{ hash?: string; message?: string; author?: string; date?: string }>;
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-git-status">
                                {commits.slice(0, 10).map((c, i) => (
                                    <div key={i} className="git-status-file">
                                        <span className="git-status-indicator">{String(c.hash || '').slice(0, 7)}</span>
                                        <span>{String(c.message || '').slice(0, 60)}</span>
                                    </div>
                                ))}
                                {commits.length > 10 && <div className="diff-line diff-truncated">... +{commits.length - 10} more commits</div>}
                            </div>
                        </div>
                    );
                }
                case 'git_branches': {
                    const branches = r.branches as Array<{ name?: string; current?: boolean } | string>;
                    const currentBranch = r.current || r.current_branch || '';
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-git-status">
                                {branches.slice(0, 15).map((b, i) => {
                                    const name = typeof b === 'string' ? b : (b.name || '');
                                    const isCurrent = typeof b === 'string' ? b === currentBranch : !!b.current;
                                    return (
                                        <div key={i} className={`git-status-file${isCurrent ? ' git-status-modified' : ''}`}>
                                            <span className="git-status-indicator">{isCurrent ? '*' : ' '}</span>
                                            <span>{name}</span>
                                        </div>
                                    );
                                })}
                                {branches.length > 15 && <div className="diff-line diff-truncated">... +{branches.length - 15} more branches</div>}
                            </div>
                        </div>
                    );
                }
                case 'git_merge': {
                    const output = String(r.output || r.message || '');
                    const conflicts = r.conflicts;
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-terminal">
                                <div className="tool-step-terminal-header">
                                    <span className="tool-step-terminal-prompt">$ git merge {String(step.args.branch || '')}</span>
                                    <span className={`tool-step-exit-code ${conflicts ? 'error' : 'success'}`}>
                                        {conflicts ? 'CONFLICTS' : 'OK'}
                                    </span>
                                </div>
                                {output && <pre className="tool-step-stdout">{output.slice(0, 2000)}</pre>}
                            </div>
                        </div>
                    );
                }
                case 'git_show': {
                    const diffText = String(r.diff || r.output || '');
                    const msg = String(r.message || '');
                    const diffLines = diffText.split('\n');
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-terminal">
                                {msg && <div className="tool-step-terminal-header"><span className="tool-step-terminal-prompt">{msg.slice(0, 120)}</span></div>}
                                <pre className="tool-step-stdout">
                                    {diffLines.slice(0, 30).map((line, i) => (
                                        <div key={i} className={line.startsWith('+') ? 'diff-line diff-line-added' : line.startsWith('-') ? 'diff-line diff-line-removed' : line.startsWith('@@') ? 'diff-line diff-hunk' : ''}>
                                            {line}
                                        </div>
                                    ))}
                                    {diffLines.length > 30 && <div className="diff-line diff-truncated">{`... +${diffLines.length - 30} more lines`}</div>}
                                </pre>
                            </div>
                        </div>
                    );
                }
                case 'git_tag': {
                    const tags = r.tags as Array<string | { name?: string; message?: string }>;
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-git-status">
                                {tags.slice(0, 15).map((t, i) => {
                                    const name = typeof t === 'string' ? t : (t.name || '');
                                    return (
                                        <div key={i} className="git-status-file">
                                            <span className="git-status-indicator">🏷</span>
                                            <span>{name}</span>
                                        </div>
                                    );
                                })}
                                {tags.length > 15 && <div className="diff-line diff-truncated">... +{tags.length - 15} more tags</div>}
                            </div>
                        </div>
                    );
                }
                case 'git_remotes': {
                    const remotes = r.remotes as Array<{ name?: string; url?: string; type?: string } | string>;
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-git-status">
                                {remotes.map((rem, i) => {
                                    const name = typeof rem === 'string' ? rem : (rem.name || '');
                                    const url = typeof rem === 'string' ? '' : (rem.url || '');
                                    return (
                                        <div key={i} className="git-status-file">
                                            <span className="git-status-indicator">{name}</span>
                                            <span>{url}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                }
                case 'orchestrate': {
                    const summary = r.summary as { total?: number; done?: number; failed?: number; nodes?: Array<{ id: string; task: string; role: string; status: string; rounds?: number }> };
                    const report = String(r.report || '');
                    const duration = r.duration_ms ? Math.round(Number(r.duration_ms) / 1000) : null;
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-terminal">
                                <div className="tool-step-terminal-header">
                                    <span className="tool-step-terminal-prompt">Orchestration: {String(a.description || '')}</span>
                                    {duration != null && <span className="tool-step-exit-code success">{duration}s</span>}
                                </div>
                                {summary?.nodes && (
                                    <div style={{ padding: '4px 8px' }}>
                                        {summary.nodes.map((n, i) => {
                                            const badge = { researcher: '🔍', implementer: '🔨', reviewer: '👁️', tester: '🧪', planner: '📋' }[n.role] || '⚡';
                                            const statusIcon = n.status === 'done' ? '✅' : n.status === 'failed' ? '❌' : n.status === 'skipped' ? '⏭️' : '⏳';
                                            return (
                                                <div key={i} style={{ padding: '2px 0', fontSize: '0.8rem', display: 'flex', gap: 6, alignItems: 'center' }}>
                                                    <span>{statusIcon}</span>
                                                    <span>{badge} {n.role}</span>
                                                    <span style={{ opacity: 0.7 }}>{n.task.slice(0, 50)}</span>
                                                    {n.rounds && <span style={{ opacity: 0.5, fontSize: '0.7rem' }}>({n.rounds} rounds)</span>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                                {report && <pre className="tool-step-stdout" style={{ maxHeight: 300, overflow: 'auto' }}>{report.slice(0, 5000)}</pre>}
                            </div>
                        </div>
                    );
                }
                case 'spawn_specialist': {
                    const result = String(r.result || r.content || '');
                    const role = String(r.role || a.role || '');
                    const rounds = r.rounds as number;
                    const status = String(r.status || '');
                    const badge = { researcher: '🔍', implementer: '🔨', reviewer: '👁️', tester: '🧪', planner: '📋' }[role] || '⚡';
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-terminal">
                                <div className="tool-step-terminal-header">
                                    <span className="tool-step-terminal-prompt">{badge} {role} — {String(a.task || '').slice(0, 80)}</span>
                                    <span className={`tool-step-exit-code ${status === 'done' ? 'success' : 'error'}`}>
                                        {status} ({rounds || 0} rounds)
                                    </span>
                                </div>
                                {result && <pre className="tool-step-stdout" style={{ maxHeight: 300, overflow: 'auto' }}>{result.slice(0, 5000)}</pre>}
                            </div>
                        </div>
                    );
                }
                case 'verify_project': {
                    const summary = r.summary as { critical?: number; high?: number; medium?: number; low?: number; total_issues?: number; verdict?: string } | undefined;
                    const issues = (r.issues || []) as Array<{ severity: string; type: string; file?: string; message: string }>;
                    const filesScanned = r.files_scanned as number;
                    const severityColor: Record<string, string> = { critical: 'var(--error, #ff4444)', high: 'var(--warning, #ff8800)', medium: 'var(--warning-light, #ffcc00)', low: 'var(--text-muted, #888)' };
                    const verdictColor = summary?.critical ? 'var(--error, #ff4444)' : summary?.high ? 'var(--warning, #ff8800)' : 'var(--success, #44cc44)';
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-terminal">
                                <div className="tool-step-terminal-header">
                                    <span className="tool-step-terminal-prompt">Verify: {String(a.project_path || '').split('/').pop()}</span>
                                    <span className="tool-step-exit-code" style={{ color: verdictColor }}>
                                        {filesScanned} files · {summary?.total_issues || 0} issues
                                    </span>
                                </div>
                                {summary?.verdict && (
                                    <div style={{ padding: '6px 8px', fontWeight: 'bold', color: verdictColor, fontSize: '0.85rem' }}>
                                        {summary.verdict}
                                    </div>
                                )}
                                {issues.length > 0 && (
                                    <div style={{ padding: '4px 8px' }}>
                                        {issues.slice(0, 20).map((issue, i) => (
                                            <div key={i} style={{ padding: '2px 0', fontSize: '0.8rem', display: 'flex', gap: 6 }}>
                                                <span style={{ color: severityColor[issue.severity] || 'var(--text-muted, #888)', fontWeight: 'bold', minWidth: 60 }}>
                                                    {issue.severity.toUpperCase()}
                                                </span>
                                                {issue.file && <span style={{ opacity: 0.6 }}>{issue.file}:</span>}
                                                <span>{issue.message.slice(0, 200)}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                }
                case 'sequential_thinking': {
                    const thought = String(a.thought || r?.thought || '');
                    const num = Number(a.thought_number || r?.thought_number || 0);
                    const total = Number(a.total_thoughts || r?.total_thoughts || 0);
                    const isRev = a.is_revision || false;
                    const branch = a.branch_id as string || null;
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-terminal" style={{ borderLeft: `3px solid ${isRev ? 'var(--warning-light, #ffcc00)' : branch ? 'var(--accent-secondary, #88aaff)' : 'var(--text-muted)'}` }}>
                                <div className="tool-step-terminal-header">
                                    <span className="tool-step-terminal-prompt">
                                        Thought {num}/{total}{isRev ? ' (revision)' : ''}{branch ? ` [${branch}]` : ''}
                                    </span>
                                </div>
                                <div style={{ padding: '6px 8px', fontSize: '0.85rem', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                                    {thought}
                                </div>
                            </div>
                        </div>
                    );
                }
                case 'trajectory_search': {
                    const results = (r.results || []) as Array<{ conversation_title: string; role: string; score: number; snippet: string }>;
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-terminal">
                                <div className="tool-step-terminal-header">
                                    <span className="tool-step-terminal-prompt">History: &quot;{String(a.query || '').slice(0, 40)}&quot;</span>
                                    <span className="tool-step-exit-code">{results.length} matches</span>
                                </div>
                                {results.slice(0, 10).map((res, i) => (
                                    <div key={i} style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', fontSize: '0.8rem' }}>
                                        <div style={{ display: 'flex', gap: 8, opacity: 0.7, marginBottom: 2 }}>
                                            <span>{res.conversation_title}</span>
                                            <span>({res.role})</span>
                                            <span style={{ marginLeft: 'auto' }}>score: {res.score}</span>
                                        </div>
                                        <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.78rem' }}>{String(res.snippet || '').slice(0, 300)}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                }
                case 'find_by_name': {
                    const results = (r.results || []) as Array<{ path: string; name: string; type: string; size: number | null }>;
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-terminal">
                                <div className="tool-step-terminal-header">
                                    <span className="tool-step-terminal-prompt">Find: &quot;{String(a.pattern || '')}&quot;</span>
                                    <span className="tool-step-exit-code">{results.length} results</span>
                                </div>
                                <div style={{ padding: '4px 8px', fontSize: '0.8rem' }}>
                                    {results.slice(0, 30).map((res, i) => (
                                        <div key={i} style={{ padding: '1px 0', display: 'flex', gap: 8 }}>
                                            <span style={{ color: res.type === 'directory' ? 'var(--accent-secondary, #88aaff)' : 'inherit' }}>
                                                {res.type === 'directory' ? '📁' : '📄'} {res.path}
                                            </span>
                                            {res.size != null && <span style={{ opacity: 0.5, marginLeft: 'auto' }}>{(res.size / 1024).toFixed(1)}KB</span>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    );
                }
                case 'read_url_content': {
                    const content = String(r.first_chunk || '');
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-terminal">
                                <div className="tool-step-terminal-header">
                                    <span className="tool-step-terminal-prompt">{String(r.url || a.url || '')}</span>
                                    <span className="tool-step-exit-code">{String(r.total_chunks)} chunks, {String(r.total_chars)} chars</span>
                                </div>
                                <div className="tool-step-terminal-text" style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                                    {content.slice(0, 2000)}
                                    {content.length > 2000 && '\n... (truncated)'}
                                </div>
                            </div>
                        </div>
                    );
                }
                case 'read_notebook': {
                    const cells = (r.cells || []) as Array<{ cell_number: number; cell_type: string; source: string; execution_count: number | null }>;
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-terminal">
                                <div className="tool-step-terminal-header">
                                    <span className="tool-step-terminal-prompt">{String(a.file_path || '').split('/').pop()}</span>
                                    <span className="tool-step-exit-code">{cells.length} cells ({String(r.kernel || 'unknown')})</span>
                                </div>
                                {cells.slice(0, 20).map((cell, i) => (
                                    <div key={i} style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
                                        <div style={{ display: 'flex', gap: 8, fontSize: '0.75rem', opacity: 0.6, marginBottom: 2 }}>
                                            <span>[{cell.cell_number}]</span>
                                            <span style={{ color: cell.cell_type === 'code' ? 'var(--accent)' : 'var(--text-secondary)' }}>
                                                {cell.cell_type}
                                            </span>
                                            {cell.execution_count != null && <span>exec: {cell.execution_count}</span>}
                                        </div>
                                        <pre style={{ margin: 0, fontSize: '0.78rem', whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto' }}>
                                            {String(cell.source || '').slice(0, 500)}
                                        </pre>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                }
                case 'read_deployment_config': {
                    const issues = (r.issues || []) as string[];
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-terminal">
                                <div className="tool-step-terminal-header">
                                    <span className="tool-step-terminal-prompt">Deploy Config</span>
                                    <span className="tool-step-exit-code">{r.ready ? 'READY' : 'NOT READY'}</span>
                                </div>
                                <div style={{ padding: '4px 8px', fontSize: '0.8rem' }}>
                                    <div>Framework: {String(r.framework || 'unknown')}</div>
                                    <div>Build script: {r.has_build ? 'yes' : 'no'}</div>
                                    {r.config_files != null && <div>Config: {(r.config_files as string[]).join(', ') || 'none'}</div>}
                                    {issues.length > 0 && (
                                        <div style={{ color: 'var(--error, #ff4444)', marginTop: 4 }}>
                                            {issues.map((issue, i) => <div key={i}>- {issue}</div>)}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                }
                case 'deploy_web_app': {
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-terminal">
                                <div className="tool-step-terminal-header">
                                    <span className="tool-step-terminal-prompt">Deploy ({String(a.provider || 'netlify')})</span>
                                    <span className="tool-step-exit-code">{r.success ? 'SUCCESS' : 'FAILED'}</span>
                                </div>
                                {r.url != null && <div style={{ padding: '4px 8px', fontSize: '0.85rem', color: 'var(--accent)' }}>{String(r.url)}</div>}
                                {r.output != null && <div className="tool-step-terminal-text">{String(r.output).slice(0, 500)}</div>}
                            </div>
                        </div>
                    );
                }
                case 'gh_cli': {
                    const output = String(r.output || r.data || r.error || '');
                    const cmd = String(a.command || '');
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-terminal">
                                <div className="tool-step-terminal-header">
                                    <span className="tool-step-terminal-prompt">$ gh {cmd}</span>
                                    <span className={`tool-step-exit-code ${r.success ? 'success' : 'error'}`}>
                                        {r.success ? 'OK' : 'FAILED'}
                                    </span>
                                </div>
                                <pre className="tool-step-stdout" style={{ maxHeight: 300, overflow: 'auto' }}>
                                    {output.slice(0, 5000)}
                                    {output.length > 5000 && '\n... (truncated)'}
                                </pre>
                            </div>
                        </div>
                    );
                }
                case 'gws_cli': {
                    const output = String(r.output || r.data || r.error || '');
                    const cmd = String(a.command || '');
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-terminal">
                                <div className="tool-step-terminal-header">
                                    <span className="tool-step-terminal-prompt">$ gws {cmd}</span>
                                    <span className={`tool-step-exit-code ${r.success ? 'success' : 'error'}`}>
                                        {r.success ? 'OK' : 'FAILED'}
                                    </span>
                                </div>
                                <pre className="tool-step-stdout" style={{ maxHeight: 300, overflow: 'auto' }}>
                                    {output.slice(0, 5000)}
                                    {output.length > 5000 && '\n... (truncated)'}
                                </pre>
                            </div>
                        </div>
                    );
                }
                case 'memory_search': {
                    const memResults = r.results as Array<{ file: string; category: string; snippet: string }>;
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-search-results">
                                {(memResults || []).slice(0, 8).map((res, i) => (
                                    <div key={i} style={{ marginBottom: 8 }}>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 2 }}>
                                            {res.file} <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>({res.category})</span>
                                        </div>
                                        <div className="search-result-line">
                                            <span className="search-result-content">{(res.snippet || '').slice(0, 200)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                }
                case 'conversation_search': {
                    const convResults = r.results as Array<{ id: string; title: string; project: string | null; date: string | null; snippet: string }>;
                    return (
                        <div className="tool-step-expanded">
                            <div className="tool-step-search-results">
                                {(convResults || []).slice(0, 5).map((res, i) => (
                                    <div key={i} style={{ marginBottom: 8 }}>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 2 }}>
                                            {res.title} {res.date && <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>({res.date})</span>}
                                            {res.project && <span style={{ fontSize: '0.65rem', opacity: 0.7 }}> • {res.project}</span>}
                                        </div>
                                        <div className="search-result-line">
                                            <span className="search-result-content">{(res.snippet || '').slice(0, 200)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                }
                case 'conversation_recall': {
                    const convContext = String(r.context || '');
                    const convInfo = r.conversation as Record<string, unknown> | undefined;
                    return (
                        <div className="tool-step-expanded">
                            {convInfo && (
                                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                                    {String(convInfo.title || '')} ({String(convInfo.messageCount || '?')} messages)
                                    {convInfo.project ? <span> &bull; {String(convInfo.project)}</span> : null}
                                </div>
                            )}
                            <pre className="tool-step-terminal" style={{ maxHeight: 200, overflow: 'auto', fontSize: '0.7rem' }}>
                                {convContext.slice(0, 2000)}
                            </pre>
                        </div>
                    );
                }
                case 'create_plan': case 'get_plan': {
                    const rawPlan = step.name === 'create_plan'
                        ? { title: a.title, overview: a.overview, architecture: a.architecture, components: a.components || [], fileMap: a.file_map || [], designDecisions: a.design_decisions || [] }
                        : (r.plan as Record<string, unknown> | null);
                    if (!rawPlan) return <div className="tool-step-expanded"><em>No active plan</em></div>;
                    const planOverview = String(rawPlan.overview || '');
                    const comps = (rawPlan.components as Array<{ name: string; purpose: string }>) || [];
                    const files = ((rawPlan.fileMap || rawPlan.file_map) as Array<{ path: string; purpose: string }>) || [];
                    const decisions = ((rawPlan.designDecisions || rawPlan.design_decisions) as string[]) || [];
                    return (
                        <div className="tool-step-expanded">
                            <div style={{ padding: '8px 12px', fontSize: '0.78rem', lineHeight: 1.6 }}>
                                {planOverview && <p style={{ color: 'var(--text-secondary)', margin: '0 0 8px 0' }}>{planOverview.slice(0, 300)}</p>}
                                {comps.length > 0 && (
                                    <div style={{ marginBottom: 6 }}>
                                        <strong style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>Components:</strong>
                                        {comps.map((c, i) => (
                                            <div key={i} style={{ paddingLeft: 8, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                                <span style={{ color: 'var(--accent-primary)' }}>{c.name}</span> — {c.purpose}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {files.length > 0 && (
                                    <div style={{ marginBottom: 6 }}>
                                        <strong style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>Files ({files.length}):</strong>
                                        {files.slice(0, 10).map((f, i) => (
                                            <div key={i} style={{ paddingLeft: 8, fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-secondary)' }}>
                                                {f.path} — <span style={{ opacity: 0.7 }}>{f.purpose}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {decisions.length > 0 && (
                                    <div>
                                        <strong style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>Decisions:</strong>
                                        {decisions.slice(0, 5).map((d, i) => (
                                            <div key={i} style={{ paddingLeft: 8, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>• {d}</div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                }
                default:
                    return null;
            }
        };

        // Group consecutive same-type tool calls into action groups
        // e.g., 5 create_file calls → "Created 5 files" with expandable list
        // But important unique actions always show individually
        const alwaysSingle = new Set(['run_command', 'init_project', 'spawn_sub_agent', 'orchestrate', 'spawn_specialist', 'get_orchestration_status', 'browser_navigate', 'browser_screenshot', 'git_commit', 'git_push', 'git_status', 'git_diff', 'git_log', 'git_checkout', 'git_pull', 'git_branches', 'git_merge', 'git_reset', 'git_tag', 'git_show', 'git_remotes', 'git_stage', 'git_unstage', 'index_codebase', 'detect_project', 'impact_analysis', 'prepare_edit_context', 'verify_project', 'ask_user_question', 'sequential_thinking', 'trajectory_search', 'read_url_content', 'read_notebook', 'read_deployment_config', 'deploy_web_app', 'check_deploy_status', 'gh_cli', 'gws_cli', 'create_plan', 'update_plan', 'get_plan']);
        // Group names for display
        const groupLabels: Record<string, { single: string; plural: string }> = {
            create_file: { single: 'Created', plural: 'Created' },
            edit_file: { single: 'Edited', plural: 'Edited' },
            multi_edit: { single: 'Edited', plural: 'Edited' },
            read_file: { single: 'Read', plural: 'Read' },
            search_files: { single: 'Searched', plural: 'Searched' },
            glob_files: { single: 'Found', plural: 'Found' },
            task_add: { single: 'Task', plural: 'Tasks' },
            task_update: { single: 'Task', plural: 'Tasks' },
            task_list: { single: 'Tasks', plural: 'Tasks' },
            create_plan: { single: 'Plan', plural: 'Plans' },
            update_plan: { single: 'Plan Updated', plural: 'Plans Updated' },
            get_plan: { single: 'Plan', plural: 'Plans' },
            delete_file: { single: 'Deleted', plural: 'Deleted' },
            list_directory: { single: 'Listed', plural: 'Listed' },
            find_references: { single: 'Refs', plural: 'Refs' },
            list_symbols: { single: 'Symbols', plural: 'Symbols' },
            semantic_search: { single: 'Search', plural: 'Searched' },
            find_implementation: { single: 'Found', plural: 'Found' },
            smart_read: { single: 'Smart Read', plural: 'Smart Read' },
            batch_search: { single: 'Batch Search', plural: 'Batch Search' },
        };
        // Merge edit_file and multi_edit into same group key
        const groupKey = (name: string) => name === 'multi_edit' ? 'edit_file' : name;

        interface GroupedStep { key: string; name: string; steps: ToolStep[]; count: number; allDone: boolean; anyRunning: boolean; anyError: boolean; }
        const grouped: GroupedStep[] = [];
        for (const step of steps) {
            const key = groupKey(step.name);
            const last = grouped[grouped.length - 1];
            if (last && last.key === key && !alwaysSingle.has(step.name)) {
                last.steps.push(step);
                last.count++;
                last.allDone = last.allDone && step.status === 'done';
                last.anyRunning = last.anyRunning || step.status === 'running';
                last.anyError = last.anyError || step.status === 'error';
            } else {
                grouped.push({ key, name: step.name, steps: [step], count: 1, allDone: step.status === 'done', anyRunning: step.status === 'running', anyError: step.status === 'error' });
            }
        }

        return (
            <div className="tool-steps">
                {grouped.map((group, gi) => {
                    // Multi-item group — accordion style: "Created 5 files" with expandable file list
                    if (group.count > 1) {
                        const status = group.anyRunning ? 'running' : group.anyError ? 'error' : group.allDone ? 'done' : 'running';
                        const label = groupLabels[group.key] || { single: toolIcon(group.name), plural: toolIcon(group.name) };
                        const isGroupExpanded = expandedSteps.has(`group-${gi}`);
                        return (
                            <div key={gi} className={`tool-step tool-step-${status}`}>
                                <div
                                    className="tool-step-group-header"
                                    onClick={(e) => toggleStepExpand(`group-${gi}`, e)}
                                >
                                    <span className={`tool-step-chevron${isGroupExpanded ? ' expanded' : ''}`}>&#9656;</span>
                                    <span className="tool-step-label">{label.plural}</span>
                                    <span className="tool-step-group-count">{group.count}</span>
                                    <span className={`tool-step-status ${status}`}>
                                        {status === 'running' ? <span className="tool-spinner" /> : status === 'done' ? '\u2713' : '\u2717'}
                                    </span>
                                </div>
                                {isGroupExpanded && (
                                    <div className="tool-step-group-items">
                                        {group.steps.map((step) => {
                                            const detail = getDetail(step);
                                            const isItemExpandable = hasExpandableContent(step);
                                            const isItemExpanded = expandedSteps.has(step.id);
                                            return (
                                                <div key={step.id}>
                                                    <div
                                                        className="tool-step-group-item"
                                                        onClick={isItemExpandable ? (e) => toggleStepExpand(step.id, e) : undefined}
                                                    >
                                                        {isItemExpandable && <span className={`tool-step-chevron${isItemExpanded ? ' expanded' : ''}`}>&#9656;</span>}
                                                        <span className="file-name">{detail}</span>
                                                        <span className={`tool-step-status ${step.status}`}>
                                                            {step.status === 'running' ? <span className="tool-spinner" /> : step.status === 'done' ? '\u2713' : '\u2717'}
                                                        </span>
                                                    </div>
                                                    {isItemExpanded && renderExpandedContent(step)}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    }

                    // Single step — rich display
                    const step = group.steps[0];
                    const detail = getDetail(step);
                    const hasError = step.result && 'error' in step.result;
                    const isScreenshot = step.name === 'browser_screenshot' && step.status === 'done' && step.result && 'path' in step.result;
                    const isExpandable = hasExpandableContent(step);
                    const isExpanded = expandedSteps.has(step.id);

                    return (
                        <div key={step.id} className={`tool-step tool-step-${step.status}${hasError ? ' tool-step-has-error' : ''}${isExpanded ? ' tool-step-expanded-active' : ''}`}>
                            <div
                                className={`tool-step-header${isExpandable ? ' tool-step-clickable' : ''}`}
                                onClick={isExpandable ? (e) => toggleStepExpand(step.id, e) : undefined}
                            >
                                {isExpandable && (
                                    <span className={`tool-step-chevron${isExpanded ? ' expanded' : ''}`}>&#9656;</span>
                                )}
                                <span className="tool-step-label">{toolIcon(step.name)}</span>
                                {detail && <span className="tool-step-detail">{detail}</span>}
                                <span className={`tool-step-status ${step.status}`}>
                                    {step.status === 'running' ? <span className="tool-spinner" /> : step.status === 'done' ? '\u2713' : '\u2717'}
                                </span>
                            </div>
                            {isScreenshot && (
                                <div className="tool-step-screenshot">
                                    <ScreenshotImage
                                        filePath={String((step.result as Record<string, unknown>).path)}
                                        alt={String(step.args.name || 'Screenshot')}
                                        onClick={() => window.onicode?.openExternal?.(`file://${String((step.result as Record<string, unknown>).path)}`)}
                                    />
                                </div>
                            )}
                            {hasError && (
                                <div className="tool-step-error">{String((step.result as Record<string, unknown>).error)}</div>
                            )}
                            {isExpanded && renderExpandedContent(step)}
                        </div>
                    );
                })}
            </div>
        );
    };

    // ── Render message content (full markdown via marked) ──
    const handleMarkdownClick = useCallback((e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        const anchor = target.closest('a');
        if (anchor && anchor.href) {
            e.preventDefault();
            // Open external links in system browser via Electron shell
            if (window.onicode?.openExternal) {
                window.onicode.openExternal(anchor.href);
            } else {
                window.open(anchor.href, '_blank', 'noopener');
            }
        }
    }, []);

    const renderMessageContent = (content: string) => {
        const html = marked.parse(content, { breaks: true, gfm: true }) as string;
        return <div className="markdown-body" onClick={handleMarkdownClick} dangerouslySetInnerHTML={{ __html: html }} />;
    };

    // ══════════════════════════════════════════
    //  Render
    // ══════════════════════════════════════════

    return (
        <div className="chat-container">
            {/* History sidebar overlay */}
            {showHistory && (
                <div className="history-overlay" onClick={() => setShowHistory(false)}>
                    <div className="history-panel" onClick={(e) => e.stopPropagation()}>
                        <div className="history-header">
                            <h3>Chat History</h3>
                            <button className="history-close" onClick={() => setShowHistory(false)}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                        <div className="history-list">
                            {conversations.length === 0 ? (
                                <div className="history-empty">No conversations yet</div>
                            ) : (
                                conversations.map((conv) => (
                                    <div
                                        key={conv.id}
                                        className={`history-item ${conv.id === activeConvId ? 'active' : ''}`}
                                    >
                                        <div
                                            className="history-item-content"
                                            onClick={() => loadConversation(conv)}
                                        >
                                            <div className="history-item-title">{conv.title}</div>
                                            <div className="history-item-date">
                                                {new Date(conv.updatedAt).toLocaleDateString()} &middot; {conv.messages.length} msgs
                                            </div>
                                        </div>
                                        <button
                                            className="history-item-delete"
                                            onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                                            title="Delete"
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <polyline points="3 6 5 6 21 6" />
                                                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                            </svg>
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {messages.length === 0 ? (
                <div className="welcome">
                    <div className="welcome-logo">
                        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                            <rect width="48" height="48" rx="12" fill="var(--accent)" />
                            <path d="M16 32V20l8-6 8 6v12l-8-4-8 4z" fill="var(--text-on-accent)" opacity="0.9" />
                            <path d="M24 14l8 6v12l-8-4V14z" fill="var(--text-on-accent)" opacity="0.6" />
                        </svg>
                    </div>
                    <h2>Welcome to Onicode</h2>
                    <p>
                        Your AI-powered development companion. Ask me anything — code,
                        general questions, brainstorming, or open a project to start building.
                    </p>
                    <div className="welcome-hints">
                        Type <code>/help</code> for commands &middot; Paste a URL to attach &middot; Drop files to include
                    </div>
                    <div className="welcome-actions">
                        {WELCOME_SUGGESTIONS.map((s) => (
                            <button key={s} className="welcome-chip" onClick={() => handleSuggestionClick(s)}>{s}</button>
                        ))}
                    </div>
                    {conversations.length > 0 && (
                        <button className="history-btn" onClick={() => setShowHistory(true)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12 6 12 12 16 14" />
                            </svg>
                            View chat history ({conversations.length})
                        </button>
                    )}
                </div>
            ) : (
                <>
                    <div className="messages" ref={messagesContainerRef}>
                        {messages.map((message) => (
                            <div key={message.id} className={`message message-${message.role}`}>
                                <div className="message-content-wrapper">
                                    {message.toolSteps && message.toolSteps.length > 0 && renderToolSteps(message.toolSteps)}
                                    {message.role === 'ai' && isQuestionMessage(message.content) ? (
                                        <div className="message-bubble">
                                            <QuestionDialog
                                                questions={parseQuestions(message.content)!}
                                                submitted={message.questionsAnswered || false}
                                                savedAnswers={message.questionAnswers}
                                                onSubmit={(answersText) => {
                                                    // Mark the question message as answered with saved selections
                                                    setMessages((prev) => {
                                                        const updatedPrev = prev.map((m) =>
                                                            m.id === message.id
                                                                ? { ...m, questionsAnswered: true }
                                                                : m
                                                        );
                                                        const userMsg: Message = {
                                                            id: generateId(),
                                                            role: 'user',
                                                            content: answersText,
                                                            timestamp: Date.now(),
                                                        };
                                                        const updated = [...updatedPrev, userMsg];
                                                        sendToAI(answersText, updatedPrev);
                                                        return updated;
                                                    });
                                                }}
                                            />
                                        </div>
                                    ) : (
                                        <div className="message-bubble">{renderMessageContent(message.content)}</div>
                                    )}
                                    {message.isError && !isTyping && (
                                        <button
                                            type="button"
                                            className="retry-button"
                                            onClick={() => {
                                                sendToAI('continue', messages.filter(m => m.id !== message.id));
                                            }}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                                            Retry
                                        </button>
                                    )}
                                    {message.attachments && message.attachments.length > 0 && (
                                        <div className="message-attachments">
                                            {message.attachments.map((att, i) => (
                                                <div key={i} className={`attachment-chip attachment-chip-${att.type}`}>
                                                    {att.type === 'link' ? (
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
                                                    ) : att.type === 'image' ? (
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                                                    ) : att.type === 'doc' ? (
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                                                    ) : (
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                                    )}
                                                    {att.name}
                                                    {att.type === 'image' && att.dataUrl && (
                                                        <img src={att.dataUrl} alt="" className="attachment-chip-thumb" />
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {isTyping && (streamingContent || activeToolSteps.length > 0 || agentStatus) && (
                            <div className="message message-ai">
                                <div className="message-content-wrapper">
                                    {(agentStatus || sessionTimer > 0) && (
                                        <div className={`agent-status ${agentStatus ? `agent-status-${agentStatus.status}` : ''}`}>
                                            <span className="agent-status-indicator" />
                                            <span className="agent-status-text">
                                                {agentStatus?.status === 'thinking' && 'Thinking...'}
                                                {agentStatus?.status === 'streaming' && (agentStatus.round > 0 ? `Generating (round ${agentStatus.round + 1})...` : 'Generating...')}
                                                {agentStatus?.status === 'continuing' && `Continuing — ${agentStatus.pending} task${agentStatus.pending !== 1 ? 's' : ''} remaining`}
                                                {agentStatus?.status === 'sub-agent' && `Sub-agent: ${agentStatus.task || 'working'}...`}
                                                {agentStatus?.status === 'executing' && 'Executing tools...'}
                                                {!agentStatus && sessionTimer > 0 && !isTyping && 'Completed'}
                                            </span>
                                            {agentStatus && agentStatus.round > 0 && agentStatus.status !== 'continuing' && (
                                                <span className="agent-status-round">Round {agentStatus.round + 1}</span>
                                            )}
                                            {sessionTimer > 0 && (
                                                <span className="session-timer">{formatTime(sessionTimer)}</span>
                                            )}
                                        </div>
                                    )}
                                    {activeToolSteps.length > 0 && renderToolSteps(activeToolSteps)}
                                    {streamingContent && <div className="message-bubble">{renderMessageContent(streamingContent)}</div>}
                                </div>
                            </div>
                        )}
                        {isTyping && !streamingContent && activeToolSteps.length === 0 && !agentStatus && (
                            <div className="message message-ai">
                                <div className="message-bubble">
                                    <div className="typing-indicator">
                                        <div className="typing-dot" />
                                        <div className="typing-dot" />
                                        <div className="typing-dot" />
                                    </div>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                    {showScrollBtn && (
                        <button className="scroll-to-bottom-btn" onClick={scrollToBottom} title="Scroll to bottom">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="6 9 12 15 18 9" />
                            </svg>
                        </button>
                    )}
                </>
            )}

            <div
                className={`input-area${isDragOver ? ' drag-over' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {/* Drag-drop overlay */}
                {isDragOver && (
                    <div className="drag-overlay">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                        </svg>
                        <span>Drop files to attach</span>
                        <span className="drag-overlay-hint">Images, documents, code files</span>
                    </div>
                )}

                {/* Attachment previews */}
                {attachments.length > 0 && (
                    <div className="attachment-bar">
                        {attachments.map((att, i) => (
                            <div key={i} className={`attachment-preview${att.type === 'image' && att.dataUrl ? ' attachment-preview-image' : ''}`}>
                                {att.type === 'image' && att.dataUrl ? (
                                    <img src={att.dataUrl} alt={att.name} className="attachment-thumb" />
                                ) : att.type === 'link' ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
                                ) : att.type === 'doc' ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                                ) : att.type === 'image' ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                                ) : (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                )}
                                <span>{att.name}</span>
                                {att.size && <span className="attachment-size">{att.size < 1024 ? `${att.size}B` : `${Math.round(att.size / 1024)}KB`}</span>}
                                <button className="attachment-remove" onClick={() => removeAttachment(i)}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Slash command menu */}
                {showSlashMenu && filteredCommands.length > 0 && (
                    <div className="slash-menu" ref={slashMenuRef}>
                        {filteredCommands.map((cmd, i) => (
                            <div
                                key={cmd.name}
                                className={`slash-menu-item ${i === slashIndex ? 'active' : ''}`}
                                onClick={() => {
                                    const newVal = input.replace(/(^|\s)(\/\S*)$/, (_m, space) => space + cmd.name + ' ');
                                    setInput(newVal);
                                    setShowSlashMenu(false);
                                    textareaRef.current?.focus();
                                }}
                            >
                                <span className="slash-cmd-name">{cmd.name}</span>
                                <span className="slash-cmd-desc">{cmd.description}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* @ mention menu */}
                {showMentionMenu && filteredMentions.length > 0 && (
                    <div className="mention-menu" ref={mentionMenuRef}>
                        {(() => {
                            let lastCategory = '';
                            return filteredMentions.map((item, i) => {
                                const showHeader = item.category !== lastCategory;
                                lastCategory = item.category;
                                return (
                                    <React.Fragment key={`${item.type}:${item.label}`}>
                                        {showHeader && <div className="mention-menu-header">{item.category}</div>}
                                        <div
                                            className={`mention-menu-item ${i === mentionIndex ? 'active' : ''}`}
                                            onClick={() => {
                                                const atIndex = input.lastIndexOf('@');
                                                const prefix = item.type === 'project' ? '@project:' : item.type === 'workflow' ? '@workflow:' : item.type === 'memory' ? '@memory:' : '@';
                                                setInput(input.slice(0, atIndex) + prefix + item.label + ' ');
                                                if (item.type === 'attachment' && item.attachment && !attachments.some(a => a.name === item.attachment!.name)) {
                                                    setAttachments(prev => [...prev, item.attachment!]);
                                                }
                                                setShowMentionMenu(false);
                                                textareaRef.current?.focus();
                                            }}
                                        >
                                            <span className="mention-item-icon">
                                                {item.type === 'project' ? (
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                                                ) : item.type === 'workflow' ? (
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></svg>
                                                ) : item.type === 'memory' ? (
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z" /><line x1="9" y1="21" x2="15" y2="21" /></svg>
                                                ) : item.attachment?.type === 'link' ? (
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
                                                ) : item.attachment?.type === 'image' ? (
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                                                ) : (
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                                )}
                                            </span>
                                            <span className="mention-item-name">{item.label}</span>
                                            <span className="mention-item-detail">{item.detail}</span>
                                        </div>
                                    </React.Fragment>
                                );
                            });
                        })()}
                    </div>
                )}

                {/* Scope tag bar */}
                {scope !== 'general' && (
                    <div className="scope-tag-bar">
                        <div className={`scope-tag scope-tag-${scope}`}>
                            {scope === 'project' ? (
                                <>
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                                    </svg>
                                    <span>Project: {activeProject?.name || 'Unknown'}</span>
                                </>
                            ) : (
                                <>
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                                        <polyline points="14 2 14 8 20 8" />
                                    </svg>
                                    <span>Documents</span>
                                </>
                            )}
                            <button
                                className="scope-tag-close"
                                onClick={() => onChangeScope?.('general')}
                                title="Exit to general chat (starts new chat)"
                            >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Permission Approval Card ── */}
                {pendingApproval && (
                    <div className="ask-user-card" style={{ borderColor: 'var(--warning, #ff8800)' }}>
                        <div className="ask-user-question">
                            Allow <code style={{ background: 'var(--hover)', padding: '2px 6px', borderRadius: 4 }}>{pendingApproval.tool}</code>?
                        </div>
                        {pendingApproval.args.command != null && (
                            <div style={{ padding: '4px 8px', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', background: 'var(--hover)', borderRadius: 6, marginBottom: 8 }}>
                                {String(pendingApproval.args.command).slice(0, 200)}
                            </div>
                        )}
                        <div className="ask-user-options">
                            <button
                                type="button"
                                className="ask-user-option"
                                style={{ borderColor: 'var(--success, #44cc44)' }}
                                onClick={() => {
                                    window.onicode?.respondToPermission(pendingApproval.approvalId, true);
                                    setPendingApproval(null);
                                }}
                            >
                                <span className="ask-user-option-label">Allow</span>
                            </button>
                            <button
                                type="button"
                                className="ask-user-option"
                                style={{ borderColor: 'var(--error, #ff4444)' }}
                                onClick={() => {
                                    window.onicode?.respondToPermission(pendingApproval.approvalId, false);
                                    setPendingApproval(null);
                                }}
                            >
                                <span className="ask-user-option-label">Deny</span>
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Ask User Question Card ── */}
                {pendingQuestion && (
                    <div className="ask-user-card">
                        <div className="ask-user-question">{pendingQuestion.question}</div>
                        <div className="ask-user-options">
                            {pendingQuestion.options.map((opt, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    className={`ask-user-option ${selectedOptions.has(i) ? 'selected' : ''}`}
                                    onClick={() => {
                                        if (pendingQuestion.allowMultiple) {
                                            setSelectedOptions(prev => {
                                                const next = new Set(prev);
                                                if (next.has(i)) next.delete(i); else next.add(i);
                                                return next;
                                            });
                                        } else {
                                            handleAnswerQuestion(opt.label);
                                        }
                                    }}
                                >
                                    <span className="ask-user-option-label">{opt.label}</span>
                                    {opt.description && <span className="ask-user-option-desc">{opt.description}</span>}
                                </button>
                            ))}
                        </div>
                        {pendingQuestion.allowMultiple && selectedOptions.size > 0 && (
                            <button
                                type="button"
                                className="ask-user-confirm"
                                onClick={() => {
                                    const selected = [...selectedOptions].map(i => pendingQuestion.options[i].label);
                                    handleAnswerQuestion(selected);
                                }}
                            >
                                Confirm ({selectedOptions.size} selected)
                            </button>
                        )}
                        <div className="ask-user-custom">
                            <input
                                type="text"
                                placeholder="Or type a custom answer..."
                                className="ask-user-custom-input"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                                        handleAnswerQuestion((e.target as HTMLInputElement).value.trim());
                                    }
                                }}
                            />
                        </div>
                    </div>
                )}

                <div className="input-wrapper">
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.json,.csv,.xml,.yml,.yaml,.ts,.tsx,.js,.jsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.css,.html,.sh,.sql,.toml,.env,.cfg,.ini,.log,.rtf,.odt"
                        className="file-input-hidden"
                        onChange={handleFileChange}
                    />
                    <div className="attach-menu-anchor" ref={attachMenuRef}>
                        <button className="attach-btn" onClick={() => setShowAttachMenu(prev => !prev)} title="Attach" disabled={isTyping}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                        </button>
                        {showAttachMenu && (
                            <div className="attach-menu">
                                <button className="attach-menu-item" onClick={() => { setShowAttachMenu(false); fileInputRef.current?.click(); }}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></svg>
                                    <div className="attach-menu-text"><span className="attach-menu-label">Upload Files</span><span className="attach-menu-desc">Images, code, documents</span></div>
                                </button>
                                <button className="attach-menu-item" onClick={() => {
                                    setShowAttachMenu(false);
                                    const url = prompt('Paste a URL to attach:');
                                    if (url?.trim()) {
                                        const trimmed = url.trim();
                                        if (/^https?:\/\/\S+$/.test(trimmed)) {
                                            try {
                                                setAttachments(prev => [...prev, { type: 'link', name: new URL(trimmed).hostname, url: trimmed }]);
                                            } catch { setAttachments(prev => [...prev, { type: 'link', name: trimmed.slice(0, 40), url: trimmed }]); }
                                        }
                                    }
                                }}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
                                    <div className="attach-menu-text"><span className="attach-menu-label">Paste URL</span><span className="attach-menu-desc">Attach a web link</span></div>
                                </button>
                                <button className="attach-menu-item" onClick={() => {
                                    setShowAttachMenu(false);
                                    const repoUrl = prompt('Git repository URL to clone:');
                                    if (repoUrl?.trim() && window.onicode?.gitClone) {
                                        const targetPath = prompt('Clone destination (leave empty for default):');
                                        window.onicode.gitClone(repoUrl.trim(), targetPath?.trim() || undefined).then((r: any) => {
                                            if (r?.success) {
                                                setInput(prev => prev + (prev ? ' ' : '') + `Cloned ${repoUrl.trim()} to ${r.path || 'project folder'}`);
                                            } else {
                                                setInput(prev => prev + (prev ? ' ' : '') + `Clone failed: ${r?.error || 'unknown error'}`);
                                            }
                                        });
                                    }
                                }}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 012 2v7" /><line x1="6" y1="9" x2="6" y2="21" /></svg>
                                    <div className="attach-menu-text"><span className="attach-menu-label">Clone Repository</span><span className="attach-menu-desc">Clone a Git repo</span></div>
                                </button>
                                <button className="attach-menu-item" onClick={() => {
                                    setShowAttachMenu(false);
                                    requestPanel('files');
                                }}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                                    <div className="attach-menu-text"><span className="attach-menu-label">Browse Files</span><span className="attach-menu-desc">Open file viewer panel</span></div>
                                </button>
                                <button className="attach-menu-item" onClick={() => {
                                    setShowAttachMenu(false);
                                    if (onChangeScope) onChangeScope('project');
                                    requestPanel('project');
                                }}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
                                    <div className="attach-menu-text"><span className="attach-menu-label">Open Project</span><span className="attach-menu-desc">Switch to project mode</span></div>
                                </button>
                                <button className="attach-menu-item" onClick={() => {
                                    setShowAttachMenu(false);
                                    const query = prompt('What do you want to research?');
                                    if (query?.trim()) {
                                        setInput(prev => (prev ? prev + '\n' : '') + `Deep research: ${query.trim()}`);
                                        textareaRef.current?.focus();
                                    }
                                }}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
                                    <div className="attach-menu-text"><span className="attach-menu-label">Deep Research</span><span className="attach-menu-desc">AI-powered web research</span></div>
                                </button>
                            </div>
                        )}
                    </div>
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        placeholder={scope === 'project' ? `Ask about ${activeProject?.name || 'this project'}... (/ commands, @ attachments)` : 'Ask Onicode anything... (/ commands, @ attachments)'}
                        rows={1}
                        disabled={isTyping}
                    />
                    {isTyping ? (
                        <button className="send-btn stop-btn" onClick={stopGeneration}>
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <rect x="6" y="6" width="12" height="12" rx="2" />
                            </svg>
                        </button>
                    ) : (
                        <button className="send-btn" onClick={handleSend} disabled={!input.trim()}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="22" y1="2" x2="11" y2="13" />
                                <polygon points="22 2 15 22 11 13 2 9 22 2" />
                            </svg>
                        </button>
                    )}
                </div>
                {contextInfo && messages.length > 0 && (
                    <div className="context-tracker">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 6v6l4 2" />
                        </svg>
                        <button
                            className="context-model"
                            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontSize: 'inherit', fontFamily: 'inherit', position: 'relative' }}
                            onClick={() => setShowModelPicker(!showModelPicker)}
                            title="Click to change model"
                        >
                            {getActiveProvider()?.selectedModel || 'gpt-4o'}
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ marginLeft: 3, verticalAlign: 'middle' }}><polyline points="6 9 12 15 18 9" /></svg>
                        </button>
                        {showModelPicker && (() => {
                            const activeProvider = getActiveProvider();
                            const DEFAULT_MODELS: Record<string, string[]> = {
                                codex: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3', 'o3-mini', 'o4-mini', 'codex-mini-latest'],
                                oniai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3-mini', 'claude-sonnet-4-20250514'],
                                openclaw: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3-mini'],
                                anthropic: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-3-5-20241022'],
                                ollama: ['llama3', 'codellama', 'mistral', 'deepseek-coder'],
                            };
                            const PROVIDER_NAMES: Record<string, string> = { codex: 'OpenAI', anthropic: 'Anthropic', ollama: 'Ollama', oniai: 'OniAI', openclaw: 'OpenClaw' };
                            let connectedProviders: ProviderConfig[] = [];
                            try {
                                const saved = localStorage.getItem('onicode-providers');
                                if (saved) connectedProviders = JSON.parse(saved).filter((p: ProviderConfig) => p.connected && (p.apiKey?.trim() || p.id === 'ollama'));
                            } catch {}
                            return (
                                <div className="model-picker-dropdown">
                                    {connectedProviders.map((prov: ProviderConfig) => {
                                        const models = prov.models?.length ? prov.models : (DEFAULT_MODELS[prov.id] || []);
                                        const isActive = prov.id === activeProvider?.id;
                                        return (
                                            <div key={prov.id} className="model-picker-group">
                                                <div className="model-picker-provider">{PROVIDER_NAMES[prov.id] || prov.id}{isActive && <span className="model-picker-active">active</span>}</div>
                                                {models.map((m: string) => (
                                                    <button key={`${prov.id}-${m}`} className={`model-picker-item${isActive && m === prov.selectedModel ? ' selected' : ''}`} onClick={() => {
                                                        try {
                                                            const saved = localStorage.getItem('onicode-providers');
                                                            if (saved) {
                                                                const providers = JSON.parse(saved);
                                                                // Disable all, enable this one, set model
                                                                providers.forEach((pp: ProviderConfig) => { pp.enabled = pp.id === prov.id; });
                                                                const target = providers.find((pp: ProviderConfig) => pp.id === prov.id);
                                                                if (target) target.selectedModel = m;
                                                                localStorage.setItem('onicode-providers', JSON.stringify(providers));
                                                            }
                                                        } catch {}
                                                        setShowModelPicker(false);
                                                    }}>{m}</button>
                                                ))}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })()}
                        <span className="context-divider">·</span>
                        <span>~{contextInfo.tokens.toLocaleString()} tokens · {contextInfo.messages} msgs</span>
                        <span className="context-divider">·</span>
                        <button
                            className="thinking-level-btn"
                            onClick={() => {
                                const levels = ['low', 'medium', 'high'];
                                const idx = levels.indexOf(thinkingLevel);
                                const next = levels[(idx + 1) % levels.length];
                                setThinkingLevel(next);
                                localStorage.setItem('onicode-thinking-level', next);
                            }}
                            title={`Thinking: ${thinkingLevel} (click to change)`}
                        >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z" />
                                <line x1="9" y1="21" x2="15" y2="21" />
                            </svg>
                            <span className={`thinking-level-label thinking-level-${thinkingLevel}`}>{thinkingLevel}</span>
                        </button>
                        {contextInfo.tokens > 60000 && <span className="context-warning">compacting soon</span>}
                    </div>
                )}
            </div>
        </div>
    );
}
