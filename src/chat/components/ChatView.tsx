import React, { useState, useRef, useEffect, useCallback } from 'react';
import { SLASH_COMMANDS } from '../commands/registry';
import { executeCommand } from '../commands/executor';
import { buildSystemPrompt } from '../ai/systemPrompt';
import QuestionDialog, { parseQuestions, isQuestionMessage } from './QuestionDialog';
import type { ChatScope } from '../App';
import type { ActiveProject } from './ProjectModeBar';

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
}

export interface Attachment {
    type: 'file' | 'link' | 'image';
    name: string;
    url?: string;
    size?: number;
    mimeType?: string;
    content?: string;
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

const isElectron = typeof window !== 'undefined' && !!window.onicode;

const CONVERSATIONS_KEY = 'onicode-conversations';
const ACTIVE_CONV_KEY = 'onicode-active-conversation';

// ══════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════

function generateId() {
    return Math.random().toString(36).substring(2, 12);
}

function getActiveProvider(): ProviderConfig | null {
    try {
        const saved = localStorage.getItem('onicode-providers');
        if (!saved) return null;
        const providers: ProviderConfig[] = JSON.parse(saved);
        return providers.find((p) => p.enabled && p.connected && p.apiKey?.trim()) || null;
    } catch {
        return null;
    }
}

function getApiEndpoint(provider: ProviderConfig): string {
    if (provider.id === 'codex') return 'https://api.openai.com/v1/chat/completions';
    const base = (provider.baseUrl || '').replace(/\/$/, '');
    return `${base}/v1/chat/completions`;
}

function loadConversations(): Conversation[] {
    try {
        const saved = localStorage.getItem(CONVERSATIONS_KEY);
        return saved ? JSON.parse(saved) : [];
    } catch {
        return [];
    }
}

function saveConversations(convs: Conversation[]) {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convs));
}

function generateTitle(content: string): string {
    const clean = content.replace(/[#*`]/g, '').trim();
    return clean.length > 40 ? clean.slice(0, 40) + '...' : clean;
}

// ══════════════════════════════════════════
//  Panel Events (dispatched to App)
// ══════════════════════════════════════════

export function requestPanel(type: string, data?: Record<string, unknown>) {
    window.dispatchEvent(new CustomEvent('onicode-panel', { detail: { type, data } }));
}

// ══════════════════════════════════════════
//  Component
// ══════════════════════════════════════════

interface ChatViewProps {
    scope?: ChatScope;
    activeProject?: ActiveProject | null;
    onChangeScope?: (scope: ChatScope) => void;
}

export default function ChatView({ scope = 'general', activeProject, onChangeScope }: ChatViewProps) {
    // ── Conversation state ──
    const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
    const [activeConvId, setActiveConvId] = useState<string | null>(() => {
        return localStorage.getItem(ACTIVE_CONV_KEY) || null;
    });
    const [showHistory, setShowHistory] = useState(false);

    // ── Message state ──
    const [messages, setMessages] = useState<Message[]>(() => {
        const id = localStorage.getItem(ACTIVE_CONV_KEY);
        if (id) {
            const convs = loadConversations();
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
    const [activeToolSteps, setActiveToolSteps] = useState<ToolStep[]>([]);

    // ── Refs ──
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const streamContentRef = useRef('');
    const cleanupRef = useRef<(() => void) | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const sendingRef = useRef(false); // Prevents double-send from StrictMode

    // ── Persistence ──
    const persistConversation = useCallback((msgs: Message[], convId: string | null) => {
        if (msgs.length === 0) return convId;

        const convs = loadConversations();
        let id = convId;

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
        }

        saveConversations(convs);
        setConversations(convs);
        localStorage.setItem(ACTIVE_CONV_KEY, id);
        return id;
    }, [scope, activeProject]);

    // ── Scroll ──
    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(() => { scrollToBottom(); }, [messages, streamingContent, scrollToBottom]);

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
        if (input.startsWith('/')) {
            setShowSlashMenu(true);
            setSlashFilter(input.slice(1).toLowerCase());
            setSlashIndex(0);
        } else {
            setShowSlashMenu(false);
        }
    }, [input]);

    const filteredCommands = SLASH_COMMANDS.filter((cmd) =>
        cmd.name.toLowerCase().includes('/' + slashFilter)
    );

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
            const convs = loadConversations();
            const idx = convs.findIndex(c => c.id === activeConvId);
            if (idx >= 0) {
                convs[idx].title = title;
                saveConversations(convs);
                setConversations(convs);
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

        const removeChunkListener = window.onicode!.onStreamChunk((chunk: string) => {
            streamContentRef.current += chunk;
            setStreamingContent(streamContentRef.current);
        });

        // Listen for tool calls from the agentic loop
        const removeToolCallListener = window.onicode!.onToolCall((data) => {
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
            toolStepsRef.current = toolStepsRef.current.map(s =>
                s.id === data.id ? { ...s, result: data.result, status: 'done' as const } : s
            );
            setActiveToolSteps([...toolStepsRef.current]);
        });

        const removeDoneListener = window.onicode!.onStreamDone((error: string | null) => {
            removeChunkListener();
            removeDoneListener();
            removeToolCallListener();
            removeToolResultListener();
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
                    content: `Failed to get response: ${error}\n\nCheck your API key and connection in **Settings**.`,
                    timestamp: Date.now(),
                    toolSteps: finalToolSteps.length > 0 ? finalToolSteps : undefined,
                }]);
            } else if (finalContent.trim() || finalToolSteps.length > 0) {
                setMessages((prev) => [...prev, {
                    id: generateId(), role: 'ai' as const,
                    content: finalContent || '*(Completed using tools)*',
                    timestamp: Date.now(),
                    toolSteps: finalToolSteps.length > 0 ? finalToolSteps : undefined,
                }]);
            }
        });

        cleanupRef.current = () => {
            removeChunkListener(); removeDoneListener();
            removeToolCallListener(); removeToolResultListener();
        };

        const result = await window.onicode!.sendMessage(apiMessages, {
            id: provider.id,
            apiKey: provider.apiKey!,
            baseUrl: provider.baseUrl,
            selectedModel: provider.selectedModel,
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
                content: `Failed to get response: ${result.error}\n\nCheck your API key and connection in **Settings**.`,
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
                content: `Failed to get response: ${errorMessage}\n\nCheck your API key and connection in **Settings**.`,
                timestamp: Date.now(),
            }]);
        }
    }, []);

    // ── Main send handler ──
    const sendToAI = useCallback(async (userMessage: string, allMessages: Message[], currentAttachments?: Attachment[]) => {
        // Guard against React StrictMode double-invoke
        if (sendingRef.current) return;
        sendingRef.current = true;

        setIsTyping(true);
        setStreamingContent('');
        streamContentRef.current = '';

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
        let attachmentContext = '';
        if (currentAttachments && currentAttachments.length > 0) {
            const parts: string[] = ['\n\n---\n**Attached files:**'];
            for (const att of currentAttachments) {
                if (att.type === 'link') {
                    parts.push(`\n**Link:** ${att.url}`);
                } else if (att.content) {
                    parts.push(`\n**File: \`${att.name}\`** (${att.size ? Math.round(att.size / 1024) + 'KB' : 'unknown size'})\n\`\`\`\n${att.content}\n\`\`\``);
                } else {
                    parts.push(`\n**File: \`${att.name}\`** (${att.type}, ${att.size ? Math.round(att.size / 1024) + 'KB' : 'binary'}) — content not readable`);
                }
            }
            attachmentContext = parts.join('');
        }

        // Load core memories for injection into system prompt
        let memories: { soul?: string | null; user?: string | null; longTerm?: string | null; dailyToday?: string | null; dailyYesterday?: string | null } | undefined;
        if (isElectron) {
            try {
                const memResult = await window.onicode!.memoryLoadCore();
                if (memResult.success && memResult.memories) {
                    memories = {
                        soul: memResult.memories.soul,
                        user: memResult.memories.user,
                        longTerm: memResult.memories.longTerm,
                        dailyToday: memResult.memories.dailyToday,
                        dailyYesterday: memResult.memories.dailyYesterday,
                    };
                }
            } catch { /* memory load failed, proceed without */ }
        }

        // Build context-aware system prompt
        const customPrompt = localStorage.getItem('onicode-custom-system-prompt') || undefined;
        const systemContent = buildSystemPrompt({
            customSystemPrompt: customPrompt,
            memories,
        });

        const apiMessages = [
            { role: 'system', content: systemContent },
            ...allMessages.map((m) => ({
                role: m.role === 'ai' ? 'assistant' : 'user',
                content: m.content,
            })),
            { role: 'user', content: userMessage + attachmentContext },
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
        if (finalContent.trim()) {
            setMessages((prev) => [...prev, {
                id: generateId(), role: 'ai' as const, content: finalContent, timestamp: Date.now(),
            }]);
        }
        setStreamingContent('');
        streamContentRef.current = '';
    }, []);

    // ── Attachments ──
    const handleFileSelect = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;

        Array.from(files).forEach((f) => {
            const att: Attachment = {
                type: f.type.startsWith('image/') ? 'image' as const : 'file' as const,
                name: f.name,
                size: f.size,
                mimeType: f.type,
            };

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
        });
        e.target.value = '';
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
        }
    }, []);

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

        const userMessage: Message = {
            id: generateId(),
            role: 'user',
            content: text,
            timestamp: Date.now(),
            attachments: attachments.length > 0 ? [...attachments] : undefined,
        };

        setInput('');
        setAttachments([]);
        setShowSlashMenu(false);

        setMessages((prev) => {
            const updated = [...prev, userMessage];
            sendToAI(text, prev, userMessage.attachments);
            return updated;
        });
    }, [input, attachments, handleCommand, sendToAI]);

    // ── Keyboard handler ──
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
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
                setInput(filteredCommands[slashIndex].name + ' ');
                setShowSlashMenu(false);
                return;
            }
            if (e.key === 'Escape') {
                setShowSlashMenu(false);
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }, [showSlashMenu, filteredCommands, slashIndex, handleSend]);

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
        const convs = loadConversations().filter((c) => c.id !== convId);
        saveConversations(convs);
        setConversations(convs);
        if (activeConvId === convId) newChat();
    }, [activeConvId, newChat]);

    // ── Render tool steps (grouped, no emojis) ──
    const renderToolSteps = (steps: ToolStep[]) => {
        if (!steps || steps.length === 0) return null;

        const toolLabel = (name: string) => {
            return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        };

        const formatArgs = (name: string, args: Record<string, unknown>) => {
            if (name === 'read_file') return String(args.file_path || '').split('/').pop() || '';
            if (name === 'edit_file') return String(args.file_path || '').split('/').pop() || '';
            if (name === 'multi_edit') return String(args.file_path || '').split('/').pop() || '';
            if (name === 'create_file') return String(args.file_path || '').split('/').pop() || '';
            if (name === 'delete_file') return String(args.file_path || '').split('/').pop() || '';
            if (name === 'list_directory') return String(args.dir_path || '').split('/').pop() || '';
            if (name === 'search_files') return `"${args.query}"`;
            if (name === 'run_command') return `\`${String(args.command || '').slice(0, 60)}\``;
            if (name === 'create_restore_point') return String(args.name || '');
            return '';
        };

        // Group consecutive same-name tool calls
        interface GroupedStep {
            name: string;
            steps: ToolStep[];
            count: number;
            allDone: boolean;
            anyRunning: boolean;
            anyError: boolean;
        }
        const grouped: GroupedStep[] = [];
        for (const step of steps) {
            const last = grouped[grouped.length - 1];
            if (last && last.name === step.name && step.name !== 'run_command' && step.name !== 'create_file') {
                last.steps.push(step);
                last.count++;
                last.allDone = last.allDone && step.status === 'done';
                last.anyRunning = last.anyRunning || step.status === 'running';
                last.anyError = last.anyError || step.status === 'error';
            } else {
                grouped.push({
                    name: step.name,
                    steps: [step],
                    count: 1,
                    allDone: step.status === 'done',
                    anyRunning: step.status === 'running',
                    anyError: step.status === 'error',
                });
            }
        }

        return (
            <div className="tool-steps">
                {grouped.map((group, gi) => {
                    // Collapsed group (e.g., "Task Add (x5)")
                    if (group.count > 1) {
                        const status = group.anyRunning ? 'running' : group.anyError ? 'error' : group.allDone ? 'done' : 'running';
                        return (
                            <div key={gi} className={`tool-step tool-step-${status}`}>
                                <div className="tool-step-header">
                                    <span className="tool-step-name">{toolLabel(group.name)}</span>
                                    <span className="tool-step-detail">({group.count}x)</span>
                                    <span className={`tool-step-status ${status}`}>
                                        {status === 'running' ? (
                                            <span className="tool-spinner" />
                                        ) : status === 'done' ? '\u2713' : '\u2717'}
                                    </span>
                                </div>
                            </div>
                        );
                    }

                    // Single step
                    const step = group.steps[0];
                    return (
                        <div key={step.id} className={`tool-step tool-step-${step.status}`}>
                            <div className="tool-step-header">
                                <span className="tool-step-name">{toolLabel(step.name)}</span>
                                <span className="tool-step-detail">{formatArgs(step.name, step.args)}</span>
                                <span className={`tool-step-status ${step.status}`}>
                                    {step.status === 'running' ? (
                                        <span className="tool-spinner" />
                                    ) : step.status === 'done' ? '\u2713' : '\u2717'}
                                </span>
                            </div>
                            {step.result && 'error' in step.result && (
                                <div className="tool-step-error">
                                    {String(step.result.error)}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    };

    // ── Render message content (simple markdown) ──
    const renderMessageContent = (content: string) => {
        const parts = content.split(/(```[\s\S]*?```|`[^`]+`|\*\*[^*]+\*\*)/g);
        return parts.map((part, i) => {
            if (part.startsWith('```') && part.endsWith('```')) {
                const code = part.slice(3, -3);
                const lines = code.split('\n');
                const lang = lines[0].trim();
                const codeContent = lang ? lines.slice(1).join('\n') : code;
                return (
                    <pre key={i}>
                        {lang && <div className="code-lang">{lang}</div>}
                        <code>{codeContent.trim()}</code>
                    </pre>
                );
            }
            if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
            if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
            return <span key={i}>{part.split('\n').map((line, j) => (
                <React.Fragment key={j}>{j > 0 && <br />}{line}</React.Fragment>
            ))}</span>;
        });
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
                    <div className="chat-topbar">
                        <div className="chat-topbar-brand">
                            <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
                                <path d="M16 32V20l8-6 8 6v12l-8-4-8 4z" fill="var(--accent)" opacity="0.9" />
                                <path d="M24 14l8 6v12l-8-4V14z" fill="var(--accent)" opacity="0.6" />
                            </svg>
                            <span className="chat-topbar-title">Onicode</span>
                        </div>
                        <div className="chat-topbar-actions">
                            <button className="header-action-btn" onClick={() => setShowHistory(true)} title="History">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10" />
                                    <polyline points="12 6 12 12 16 14" />
                                </svg>
                            </button>
                            <button className="new-chat-btn" onClick={newChat}>New Chat</button>
                        </div>
                    </div>
                    <div className="messages">
                        {messages.map((message) => (
                            <div key={message.id} className={`message message-${message.role}`}>
                                <div className={`message-avatar ${message.role}`}>
                                    {message.role === 'ai' ? (
                                        <svg width="16" height="16" viewBox="0 0 48 48" fill="none">
                                            <path d="M16 32V20l8-6 8 6v12l-8-4-8 4z" fill="currentColor" opacity="0.9" />
                                            <path d="M24 14l8 6v12l-8-4V14z" fill="currentColor" opacity="0.6" />
                                        </svg>
                                    ) : (
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                                            <circle cx="12" cy="7" r="4" />
                                        </svg>
                                    )}
                                </div>
                                <div className="message-content-wrapper">
                                    {message.toolSteps && message.toolSteps.length > 0 && renderToolSteps(message.toolSteps)}
                                    {message.role === 'ai' && isQuestionMessage(message.content) ? (
                                        <div className="message-bubble">
                                            <QuestionDialog
                                                questions={parseQuestions(message.content)!}
                                                onSubmit={(answersText) => {
                                                    const userMsg: Message = {
                                                        id: generateId(),
                                                        role: 'user',
                                                        content: answersText,
                                                        timestamp: Date.now(),
                                                    };
                                                    setMessages((prev) => {
                                                        const updated = [...prev, userMsg];
                                                        sendToAI(answersText, prev);
                                                        return updated;
                                                    });
                                                }}
                                            />
                                        </div>
                                    ) : (
                                        <div className="message-bubble">{renderMessageContent(message.content)}</div>
                                    )}
                                    {message.attachments && message.attachments.length > 0 && (
                                        <div className="message-attachments">
                                            {message.attachments.map((att, i) => (
                                                <div key={i} className="attachment-chip">
                                                    {att.type === 'link' ? (
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
                                                    ) : (
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                                    )}
                                                    {att.name}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {isTyping && (streamingContent || activeToolSteps.length > 0) && (
                            <div className="message message-ai">
                                <div className="message-avatar ai">
                                    <svg width="16" height="16" viewBox="0 0 48 48" fill="none">
                                        <path d="M16 32V20l8-6 8 6v12l-8-4-8 4z" fill="currentColor" opacity="0.9" />
                                        <path d="M24 14l8 6v12l-8-4V14z" fill="currentColor" opacity="0.6" />
                                    </svg>
                                </div>
                                <div className="message-content-wrapper">
                                    {activeToolSteps.length > 0 && renderToolSteps(activeToolSteps)}
                                    {streamingContent && <div className="message-bubble">{renderMessageContent(streamingContent)}</div>}
                                </div>
                            </div>
                        )}
                        {isTyping && !streamingContent && activeToolSteps.length === 0 && (
                            <div className="message message-ai">
                                <div className="message-avatar ai">
                                    <svg width="16" height="16" viewBox="0 0 48 48" fill="none">
                                        <path d="M16 32V20l8-6 8 6v12l-8-4-8 4z" fill="currentColor" opacity="0.9" />
                                        <path d="M24 14l8 6v12l-8-4V14z" fill="currentColor" opacity="0.6" />
                                    </svg>
                                </div>
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
                </>
            )}

            <div className="input-area">
                {/* Attachment previews */}
                {attachments.length > 0 && (
                    <div className="attachment-bar">
                        {attachments.map((att, i) => (
                            <div key={i} className="attachment-preview">
                                {att.type === 'link' ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
                                ) : att.type === 'image' ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                                ) : (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                )}
                                <span>{att.name}</span>
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
                    <div className="slash-menu">
                        {filteredCommands.map((cmd, i) => (
                            <div
                                key={cmd.name}
                                className={`slash-menu-item ${i === slashIndex ? 'active' : ''}`}
                                onClick={() => {
                                    setInput(cmd.name + ' ');
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

                <div className="input-wrapper">
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="file-input-hidden"
                        onChange={handleFileChange}
                    />
                    <button className="attach-btn" onClick={handleFileSelect} title="Attach file" disabled={isTyping}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                        </svg>
                    </button>
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        placeholder={scope === 'project' ? `Ask about ${activeProject?.name || 'this project'}...` : 'Ask Onicode anything... (type / for commands)'}
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
            </div>
        </div>
    );
}
