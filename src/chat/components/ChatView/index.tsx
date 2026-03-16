import React, { useState, useRef, useEffect, useCallback } from 'react';
import { SLASH_COMMANDS } from '../../commands/registry';
import { executeCommand } from '../../commands/executor';
import { buildSystemPromptCached, type AIContext } from '../../ai/systemPrompt';
import { isElectron, generateId, requestPanel } from '../../utils';

import { ACTIVE_CONV_KEY } from './constants';
import {
    getActiveProvider,
    getApiEndpoint,
    loadConversationsFromCache,
    saveConversationsCache,
    persistConversationToSQLite,
    deleteFromSQLite,
    loadConversationsFromSQLite,
    generateTitle,
} from './helpers';
import type {
    ToolStep,
    Message,
    Attachment,
    Conversation,
    ProviderConfig,
    ChatViewProps,
    QueueItem,
    MentionItem,
} from './types';

import ConversationHistory from './ConversationHistory';
import WelcomeScreen from './WelcomeScreen';
import MessageList from './MessageList';
import InputArea from './InputArea';

// Re-export types so existing imports from 'ChatView' continue to work
export type { ToolStep, Message, Attachment, Conversation } from './types';

export default function ChatView({ scope = 'general', activeProject, onChangeScope, onNewMessage, mode = 'onichat', workpalFolder }: ChatViewProps) {
    // Per-mode conversation key
    const modeConvKey = `${ACTIVE_CONV_KEY}-${mode}`;

    // ── Conversation state ──
    const [conversations, setConversations] = useState<Conversation[]>(loadConversationsFromCache);
    const [activeConvId, setActiveConvId] = useState<string | null>(() => {
        return localStorage.getItem(modeConvKey) || null;
    });
    const [showHistory, setShowHistory] = useState(false);

    // ── Message state ──
    const [messages, setMessages] = useState<Message[]>(() => {
        const id = localStorage.getItem(modeConvKey);
        if (id) {
            const convs = loadConversationsFromCache();
            const conv = convs.find((c) => c.id === id);
            if (conv) return conv.messages;
        }
        return [];
    });

    // Mode changes only affect the system prompt (via modeRef) — no state reset needed

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

    // ── Message Queue ──
    const [messageQueue, setMessageQueue] = useState<QueueItem[]>([]);
    const [showQueuePanel, setShowQueuePanel] = useState(false);
    const [editingQueueId, setEditingQueueId] = useState<string | null>(null);
    const [editingQueueText, setEditingQueueText] = useState('');
    const messageQueueRef = useRef<QueueItem[]>([]);

    // ── Refs ──
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const streamContentRef = useRef('');
    const cleanupRef = useRef<(() => void) | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const sendingRef = useRef(false);
    const slashMenuRef = useRef<HTMLDivElement>(null);
    const mentionMenuRef = useRef<HTMLDivElement>(null);
    const activeProjectRef = useRef(activeProject);
    const toolStepsRef = useRef<ToolStep[]>([]);
    const pendingWidgetsRef = useRef<Array<{ id: string; type: string; data: Record<string, unknown> }>>([]);
    const pendingChannelRef = useRef<{ chatId: number; channel: string } | null>(null);
    const modeRef = useRef(mode);
    const workpalFolderRef = useRef(workpalFolder);
    const scopeRef = useRef(scope);
    const streamingModeRef = useRef<string | null>(null); // tracks which mode started current stream

    // Keep refs in sync with props so closures always have current value
    useEffect(() => { activeProjectRef.current = activeProject; }, [activeProject]);
    useEffect(() => { messageQueueRef.current = messageQueue; }, [messageQueue]);
    useEffect(() => { scopeRef.current = scope; }, [scope]);
    useEffect(() => { modeRef.current = mode; }, [mode]);
    useEffect(() => { workpalFolderRef.current = workpalFolder; }, [workpalFolder]);

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
            if (!sqliteConvs) return;
            setConversations(sqliteConvs);
            // Sync to localStorage cache so sidebar can read it
            saveConversationsCache(sqliteConvs);
            window.dispatchEvent(new CustomEvent('onicode-conversation-saved'));
            const activeId = localStorage.getItem(modeConvKey);
            if (activeId) {
                const conv = sqliteConvs.find(c => c.id === activeId);
                if (conv) setMessages(conv.messages);
            }
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Sync active provider to main process so automation/workflows work independently ──
    useEffect(() => {
        const provider = getActiveProvider();
        if (provider && isElectron) {
            window.onicode?.syncProviderConfig({
                id: provider.id,
                apiKey: provider.apiKey || '',
                baseUrl: provider.baseUrl,
                selectedModel: provider.selectedModel,
            });
        }
    }, []);

    // ── Persistence (SQLite primary, localStorage cache) ──
    const persistConversation = useCallback((msgs: Message[], convId: string | null) => {
        if (msgs.length === 0) return convId;

        const currentScope = scopeRef.current;
        const currentProject = activeProjectRef.current;
        const convs = loadConversationsFromCache();
        let id = convId;
        let convToSave: Conversation | null = null;

        if (id) {
            const idx = convs.findIndex((c) => c.id === id);
            if (idx >= 0) {
                convs[idx].messages = msgs;
                convs[idx].updatedAt = Date.now();
                if (msgs.length === 1) convs[idx].title = generateTitle(msgs[0].content);
                convs[idx].scope = currentScope;
                if (currentScope === 'project' && currentProject) {
                    convs[idx].projectId = currentProject.id;
                    convs[idx].projectName = currentProject.name;
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
                scope: currentScope,
            };
            if (currentScope === 'project' && currentProject) {
                newConv.projectId = currentProject.id;
                newConv.projectName = currentProject.name;
            }
            convs.unshift(newConv);
            convToSave = newConv;
        }

        saveConversationsCache(convs);
        setConversations(convs);
        localStorage.setItem(modeConvKey, id);
        if (convToSave) persistConversationToSQLite(convToSave);
        // Notify sidebar
        window.dispatchEvent(new CustomEvent('onicode-conversation-saved'));
        return id;
    }, []);

    // ── Scroll ──
    const scrollToBottom = useCallback(() => {
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

    // ── Context tracking ──
    useEffect(() => {
        if (messages.length === 0) { setContextInfo(null); return; }
        let totalChars = 0;
        for (const m of messages) {
            totalChars += m.content.length;
            if (m.toolSteps) {
                for (const step of m.toolSteps) {
                    totalChars += JSON.stringify(step.args || {}).length;
                    if (step.result) totalChars += JSON.stringify(step.result).length;
                }
            }
            if (m.attachments) {
                for (const att of m.attachments) {
                    if (att.content) totalChars += att.content.length;
                    if (att.url) totalChars += att.url.length;
                }
            }
        }
        const systemPromptTokens = 1500;
        const messageOverhead = messages.length * 4;
        const estimatedTokens = Math.round(totalChars / 4) + systemPromptTokens + messageOverhead;
        setContextInfo({ tokens: estimatedTokens, messages: messages.length });
    }, [messages]);

    // ── Session timer ──
    useEffect(() => {
        if (isTyping) {
            sessionStartRef.current = sessionStartRef.current || Date.now();
            const interval = setInterval(() => {
                setSessionTimer(Math.floor((Date.now() - sessionStartRef.current!) / 1000));
            }, 1000);
            return () => clearInterval(interval);
        } else {
            const timeout = setTimeout(() => {
                sessionStartRef.current = null;
                setSessionTimer(0);
            }, 5000);
            return () => clearTimeout(timeout);
        }
    }, [isTyping]);

    // ── Signal chat activity to main process ──
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
        const atIndex = input.lastIndexOf('@');
        if (atIndex >= 0 && !input.startsWith('/')) {
            const afterAt = input.slice(atIndex + 1);
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

    // ── Ask User Question listener ──
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

    // Listen for automation messages
    useEffect(() => {
        if (!window.onicode?.onAutomationMessage) return;
        const removeListener = window.onicode.onAutomationMessage((data) => {
            setMessageQueue(prev => [...prev, {
                id: data.id || generateId(),
                type: 'automation' as const,
                content: data.content,
                source: data.source || 'automation',
                title: data.title,
                timestamp: data.timestamp || Date.now(),
                editable: false,
            }]);
            onNewMessage?.();
        });
        return removeListener;
    }, [onNewMessage]);

    const handleAnswerQuestion = useCallback((answer: string | string[]) => {
        if (!pendingQuestion || !window.onicode?.answerQuestion) return;
        window.onicode.answerQuestion(pendingQuestion.questionId, answer);
        setPendingQuestion(null);
        setSelectedOptions(new Set());
    }, [pendingQuestion]);

    // ── Project-scoped attachments ──
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
    }, [activeProject?.id, messages.length]);

    // ── Mention data sources ──
    const [mentionProjects, setMentionProjects] = useState<Array<{ name: string; path: string }>>([]);
    const [mentionWorkflows, setMentionWorkflows] = useState<Array<{ id: string; name: string; description?: string }>>([]);
    const [mentionMemories, setMentionMemories] = useState<Array<{ filename: string }>>([]);

    useEffect(() => {
        if (!isElectron) return;
        window.onicode?.listProjects?.().then((r: any) => {
            if (r?.success && r.projects) setMentionProjects(r.projects.filter((p: any) => p?.name).map((p: any) => ({ name: String(p.name), path: String(p.path || '') })));
        }).catch(() => {});
        window.onicode?.workflowList?.().then((r: any) => {
            if (r?.success && r.workflows) setMentionWorkflows(r.workflows.filter((w: any) => w?.name).map((w: any) => ({ id: String(w.id), name: String(w.name), description: w.description ? String(w.description) : undefined })));
        }).catch(() => {});
        window.onicode?.memoryList?.().then((r: any) => {
            if (r?.success && r.files) setMentionMemories(r.files.map((f: any) => ({ filename: typeof f === 'string' ? f : (f.name || String(f)) })));
        }).catch(() => {});
    }, [messages.length]);

    // Collect all available mention items
    const mentionItems = React.useMemo(() => {
        const items: MentionItem[] = [];
        const seen = new Set<string>();

        for (const p of mentionProjects) {
            const key = `project:${p.name}`;
            if (!seen.has(key)) { seen.add(key); items.push({ type: 'project', label: p.name, detail: p.path, category: 'Projects', meta: p }); }
        }
        for (const w of mentionWorkflows) {
            const key = `workflow:${w.name}`;
            if (!seen.has(key)) { seen.add(key); items.push({ type: 'workflow', label: w.name, detail: w.description || 'workflow', category: 'Workflows', meta: w }); }
        }
        for (const m of mentionMemories) {
            const key = `memory:${m.filename}`;
            if (!seen.has(key)) { seen.add(key); items.push({ type: 'memory', label: m.filename, detail: 'memory', category: 'Memories', meta: m }); }
        }
        for (const att of projectAttachments) {
            if (!seen.has(att.name)) {
                seen.add(att.name);
                items.push({ type: 'attachment', label: att.name, detail: att.type === 'link' ? (att.url || 'link') : `${att.type}${att.size ? ` · ${Math.round(att.size / 1024)}KB` : ''}`, category: 'Attachments', attachment: att });
            }
        }
        for (const m of messages) {
            if (m.attachments) {
                for (const att of m.attachments) {
                    if (!seen.has(att.name)) {
                        seen.add(att.name);
                        items.push({ type: 'attachment', label: att.name, detail: att.type === 'link' ? (att.url || 'link') : `${att.type}${att.size ? ` · ${Math.round(att.size / 1024)}KB` : ''}`, category: 'Attachments', attachment: att });
                    }
                }
            }
        }
        for (const att of attachments) {
            if (!seen.has(att.name)) {
                seen.add(att.name);
                items.push({ type: 'attachment', label: att.name, detail: att.type === 'link' ? (att.url || 'link') : `${att.type}${att.size ? ` · ${Math.round(att.size / 1024)}KB` : ''}`, category: 'Attachments', attachment: att });
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

    // ── Listen for show-history event ──
    useEffect(() => {
        const handler = () => setShowHistory(true);
        window.addEventListener('onicode-show-history', handler);
        return () => window.removeEventListener('onicode-show-history', handler);
    }, []);

    // ── Listen for agent step events ──
    useEffect(() => {
        if (!window.onicode?.onAgentStep) return;
        const unsub = window.onicode.onAgentStep((data) => {
            setAgentStatus(data as typeof agentStatus);
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

    // ── Auto-open panels when AI requests ──
    useEffect(() => {
        if (!window.onicode?.onPanelOpen) return;
        const unsub = window.onicode.onPanelOpen((data: { type: string }) => {
            requestPanel(data.type);
        });
        return unsub;
    }, []);

    // ── Auto-update conversation title from AI ──
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
                persistConversationToSQLite(convs[idx]);
            }
        });
        return unsub;
    }, [activeConvId]);

    // ── Send via Electron IPC ──
    const sendViaIPC = useCallback(async (
        apiMessages: Array<{ role: string; content: unknown }>,
        provider: ProviderConfig
    ) => {
        streamContentRef.current = '';
        toolStepsRef.current = [];
        setActiveToolSteps([]);
        // Generate unique request ID — used to filter stream events for THIS request only
        const reqId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        streamingModeRef.current = modeRef.current;

        const removeChunkListener = window.onicode!.onStreamChunk((chunk: string, requestId?: string) => {
            // Only process chunks for OUR request
            if (requestId && requestId !== reqId) return;
            streamContentRef.current += chunk;
            setStreamingContent(streamContentRef.current);
        });

        const globalChunkKey = '__onicode_stream_accumulator';
        (window as any)[globalChunkKey] = streamContentRef;

        const removeToolCallListener = window.onicode!.onToolCall((data) => {
            if ((data as Record<string, unknown>).agentId) return;
            if ((data as Record<string, unknown>).requestId && (data as Record<string, unknown>).requestId !== reqId) return;
            const step: ToolStep = { id: data.id, name: data.name, args: data.args, round: data.round, status: 'running' };
            toolStepsRef.current = [...toolStepsRef.current, step];
            setActiveToolSteps([...toolStepsRef.current]);
        });

        const removeToolResultListener = window.onicode!.onToolResult((data) => {
            if ((data as Record<string, unknown>).agentId) return;
            if ((data as Record<string, unknown>).requestId && (data as Record<string, unknown>).requestId !== reqId) return;
            toolStepsRef.current = toolStepsRef.current.map(s =>
                s.id === data.id ? { ...s, result: data.result, status: 'done' as const } : s
            );
            setActiveToolSteps([...toolStepsRef.current]);
        });

        const removeMessageBreakListener = window.onicode!.onMessageBreak(() => {
            const currentContent = streamContentRef.current;
            const currentSteps = [...toolStepsRef.current];
            const currentWidgets = [...pendingWidgetsRef.current];
            if (currentContent.trim() || currentWidgets.length > 0) {
                setMessages((prev) => [...prev, {
                    id: generateId(), role: 'ai' as const,
                    content: currentContent,
                    timestamp: Date.now(),
                    toolSteps: currentSteps.length > 0 ? currentSteps : undefined,
                    widgets: currentWidgets.length > 0 ? currentWidgets as import('./types').ChatWidget[] : undefined,
                }]);
                streamContentRef.current = '';
                toolStepsRef.current = [];
                pendingWidgetsRef.current = [];
                setStreamingContent('');
                setActiveToolSteps([]);
            }
        });

        const removeWidgetListener = window.onicode!.onWidget?.((data) => {
            console.log('[ChatView] Widget event received:', data.type, JSON.stringify(data.data).slice(0, 200));
            pendingWidgetsRef.current = [...pendingWidgetsRef.current, { id: data.id, type: data.type, data: data.data }];
        }) || (() => { console.warn('[ChatView] onWidget not available in preload'); });

        const removeDoneListener = window.onicode!.onStreamDone((error: string | null, requestId?: string) => {
            // Only process done for OUR request
            if (requestId && requestId !== reqId) return;
            removeChunkListener();
            removeDoneListener();
            removeToolCallListener();
            removeWidgetListener();
            removeToolResultListener();
            removeMessageBreakListener();
            cleanupRef.current = null;
            setIsTyping(false);

            const finalContent = streamContentRef.current;
            const finalToolSteps = [...toolStepsRef.current];
            const finalWidgets = [...pendingWidgetsRef.current];
            const streamMode = streamingModeRef.current;
            setStreamingContent('');
            streamContentRef.current = '';
            setActiveToolSteps([]);
            toolStepsRef.current = [];
            pendingWidgetsRef.current = [];
            sendingRef.current = false;
            streamingModeRef.current = null;

            // If mode changed during streaming, discard UI update — the response was for a different mode
            // The conversation was already persisted via persistConversation during streaming
            if (streamMode && streamMode !== modeRef.current) {
                console.log(`[ChatView] Stream finished for mode ${streamMode} but current mode is ${modeRef.current} — skipping UI update`);
                return;
            }

            if (error) {
                setMessages((prev) => [...prev, {
                    id: generateId(), role: 'ai' as const,
                    content: `Failed to get response: ${error}\n\nCheck your API key and connection in **Settings**, or click Retry below.`,
                    isError: true,
                    timestamp: Date.now(),
                    toolSteps: finalToolSteps.length > 0 ? finalToolSteps : undefined,
                }]);
                onNewMessage?.();
            } else if (finalContent.trim() || finalToolSteps.length > 0 || finalWidgets.length > 0) {
                if (finalWidgets.length > 0) {
                    console.log('[ChatView] Attaching widgets to message:', finalWidgets.length, finalWidgets.map(w => `${w.type}:${JSON.stringify(w.data).slice(0, 100)}`));
                }
                setMessages((prev) => [...prev, {
                    id: generateId(), role: 'ai' as const,
                    content: finalContent || '',
                    timestamp: Date.now(),
                    toolSteps: finalToolSteps.length > 0 ? finalToolSteps : undefined,
                    widgets: finalWidgets.length > 0 ? finalWidgets as import('./types').ChatWidget[] : undefined,
                }]);
                onNewMessage?.();
            }

            // ── Channel bridge: send AI response back to the channel ──
            if (pendingChannelRef.current && finalContent.trim()) {
                const { chatId } = pendingChannelRef.current;
                pendingChannelRef.current = null;
                window.onicode?.channelRespond(chatId, finalContent.trim()).catch(() => {});
            }
        });

        cleanupRef.current = () => {
            removeChunkListener(); removeDoneListener();
            removeToolCallListener(); removeToolResultListener();
            removeMessageBreakListener(); removeWidgetListener();
        };

        const result = await window.onicode!.sendMessage(apiMessages as Array<{ role: string; content: string }>, {
            id: provider.id,
            apiKey: provider.apiKey!,
            baseUrl: provider.baseUrl,
            selectedModel: provider.selectedModel,
            projectPath: activeProjectRef.current?.path,
            reasoningEffort: localStorage.getItem('onicode-thinking-level') || 'medium',
            requestId: reqId,
            mode: modeRef.current,
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
        apiMessages: Array<{ role: string; content: unknown }>,
        provider: ProviderConfig
    ) => {
        const endpoint = getApiEndpoint(provider);
        const model = provider.selectedModel || 'gpt-5.4';
        const isOModel = model.startsWith('o');
        const useCompletionTokens = isOModel || model.startsWith('gpt-5') || model.startsWith('gpt-4.1');

        const bodyPayload: Record<string, unknown> = {
            model,
            messages: isOModel ? apiMessages.filter((m) => m.role !== 'system') : apiMessages,
            stream: true,
        };
        if (useCompletionTokens) bodyPayload.max_completion_tokens = 4096;
        else bodyPayload.max_tokens = 4096;

        const abortController = new AbortController();
        abortRef.current = abortController;

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
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
            streamContentRef.current = globalRef.current;
            setStreamingContent(globalRef.current);
            setIsTyping(true);
            sendingRef.current = true;
        }
    }, []);

    // ── Main send handler ──
    const sendToAI = useCallback(async (userMessage: string, allMessages: Message[], currentAttachments?: Attachment[]) => {
        if (sendingRef.current) return;
        sendingRef.current = true;
        setIsTyping(true);
        setStreamingContent('');
        streamContentRef.current = '';

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

        // Build attachment context
        let attachmentContext = '';
        const imageAttachments: Array<{ name: string; dataUrl: string; mimeType?: string }> = [];
        if (currentAttachments && currentAttachments.length > 0) {
            const parts: string[] = ['\n\n---\n**Attached files:**'];
            for (const att of currentAttachments) {
                const sizeStr = att.size ? (att.size < 1024 ? `${att.size}B` : `${Math.round(att.size / 1024)}KB`) : '';
                if (att.type === 'link') {
                    parts.push(`\n**Link:** [${att.name}](${att.url})`);
                } else if (att.type === 'image' && att.dataUrl) {
                    imageAttachments.push({ name: att.name, dataUrl: att.dataUrl, mimeType: att.mimeType });
                    parts.push(`\n**Image: \`${att.name}\`** (${sizeStr}) — image included for visual analysis`);
                } else if (att.type === 'image') {
                    parts.push(`\n**Image: \`${att.name}\`** (${sizeStr}${att.mimeType ? ', ' + att.mimeType : ''}) — image attached but no preview available`);
                } else if (att.type === 'doc') {
                    parts.push(`\n**Document: \`${att.name}\`** (${sizeStr}${att.mimeType ? ', ' + att.mimeType : ''})${att.content ? '\n```\n' + att.content + '\n```' : ' — binary document, content not directly readable'}`);
                } else if (att.content) {
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

        // Load memories, project docs, AGENTS.md, hooks, commands, MCP tools, environment, recent conversations
        let memories: { soul?: string | null; user?: string | null; longTerm?: string | null; dailyToday?: string | null; dailyYesterday?: string | null; projectMemory?: string | null; recentFacts?: string[] } | undefined;
        if (isElectron) {
            try {
                const projectId = (scope === 'project' && currentProject?.id) ? currentProject.id : undefined;
                const memResult = await window.onicode!.memoryLoadCore(projectId);
                if (memResult.success && memResult.memories) {
                    memories = {
                        soul: memResult.memories.soul, user: memResult.memories.user, longTerm: memResult.memories.longTerm,
                        dailyToday: memResult.memories.dailyToday, dailyYesterday: memResult.memories.dailyYesterday,
                        projectMemory: memResult.memories.projectMemory, recentFacts: memResult.memories.recentFacts,
                    };
                }
            } catch { /* memory load failed */ }
        }

        let projectDocs: Array<{ name: string; content: string }> | undefined;
        if (scope === 'project' && currentProject?.id && isElectron) {
            try {
                const projResult = await window.onicode!.getProject(currentProject.id);
                if (projResult.docs) {
                    projectDocs = projResult.docs.map((d: { name: string; content: string }) => ({ name: d.name, content: d.content }));
                }
            } catch { /* proceed without project docs */ }
        }

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

        let hooksSummary: string | undefined;
        let customCommandsSummary: string | undefined;
        if (isElectron) {
            try {
                const hooksRes = await window.onicode!.hooksList(currentProject?.path);
                const mergedHooks = hooksRes.merged || {};
                if (Object.keys(mergedHooks).length > 0) {
                    const lines: string[] = [];
                    for (const [type, hookList] of Object.entries(mergedHooks)) {
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

        let mcpTools: MCPToolInfo[] | undefined;
        if (isElectron) {
            try {
                const mcpRes = await window.onicode!.mcpGetToolsForPrompt();
                if (mcpRes.tools && mcpRes.tools.length > 0) mcpTools = mcpRes.tools;
            } catch { /* MCP not ready */ }
        }

        let environment: Record<string, unknown> | undefined;
        if (isElectron) {
            try { environment = await window.onicode!.getEnvironment(); } catch { /* not available */ }
        }

        let recentConversations: Array<{ title: string; date: string; project?: string }> | undefined;
        if (isElectron) {
            try {
                const convRes = await window.onicode!.conversationList(10, 0);
                if (convRes.success && convRes.conversations) {
                    recentConversations = convRes.conversations
                        .filter((c: { id: string; title: string }) => c.id !== activeConvId)
                        .slice(0, 8)
                        .map((c: { title: string; updated_at: number; project_name?: string }) => ({
                            title: c.title || 'Untitled',
                            date: c.updated_at ? new Date(c.updated_at).toISOString().slice(0, 10) : 'unknown',
                            project: c.project_name || undefined,
                        }));
                }
            } catch { /* conversation list failed */ }
        }

        const customPrompt = localStorage.getItem('onicode-custom-system-prompt') || undefined;
        const systemContent = buildSystemPromptCached({
            mode: modeRef.current || 'onichat',
            workingDirectory: workpalFolderRef.current?.path,
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
                const msgsForEstimate = allMessages.map(m => {
                    let content = m.content;
                    if (m.toolSteps) {
                        const toolContent = m.toolSteps.map(s => JSON.stringify(s.args || {}) + JSON.stringify(s.result || {})).join('');
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
                            id: `compacted-${i}`, role: m.role as 'user' | 'ai', content: m.content, timestamp: Date.now(),
                        }));
                    }
                }
            } catch { /* compaction failed, use original */ }
        }

        // Build the final user message
        const finalUserText = userMessage + attachmentContext;
        let finalUserContent: string | Array<{ type: string; text?: string; image_url?: { url: string }; source?: { type: string; media_type: string; data: string } }>;
        if (imageAttachments.length > 0) {
            finalUserContent = [
                { type: 'text', text: finalUserText },
                ...imageAttachments.map(img => ({ type: 'image_url' as const, image_url: { url: img.dataUrl } })),
            ];
        } else {
            finalUserContent = finalUserText;
        }

        const apiMessages = [
            { role: 'system', content: systemContent },
            ...messagesToSend.map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content })),
            { role: 'user', content: finalUserContent },
        ];

        if (isElectron) {
            await sendViaIPC(apiMessages, provider);
        } else {
            await sendViaFetch(apiMessages, provider);
        }
    }, [sendViaIPC, sendViaFetch]);

    // ── Channel Bridge: Telegram and other channels feed into this ChatView ──
    useEffect(() => {
        if (!isElectron || !window.onicode?.onChannelIncoming) return;
        const cleanup = window.onicode!.onChannelIncoming((data) => {
            const { channel, chatId, from, text, action } = data;

            if (action === 'new_session') {
                // /new or /clear from channel — just reset would happen in a dedicated conv
                return;
            }

            // Inject the message into ChatView's pipeline
            // Tag the pending channel so stream-done sends response back
            pendingChannelRef.current = { chatId, channel };

            const channelTag = `[${channel}:${from}] `;
            const userMsg: Message = {
                id: generateId(), role: 'user',
                content: text,
                timestamp: Date.now(),
                channel: channel as 'telegram',
                channelFrom: from,
            };

            // If AI is currently busy, queue it
            if (sendingRef.current || isTyping) {
                setMessageQueue(prev => [...prev, {
                    id: generateId(), type: 'user' as const,
                    content: channelTag + text,
                    timestamp: Date.now(),
                    editable: false,
                }]);
                // Still need to resolve the channel — but queued messages will resolve later
                // For now, resolve immediately with a "queued" response
                window.onicode?.channelRespond(chatId, 'Your message is queued — I\'m currently processing another request. I\'ll get to it shortly.').catch(() => {});
                pendingChannelRef.current = null;
                return;
            }

            // Add user message and trigger AI — same as pressing Enter
            setMessages(prev => {
                const updated = [...prev, userMsg];
                sendToAI(text, prev);
                return updated;
            });
        });
        return cleanup;
    }, [sendToAI, isTyping]);

    // ── Auto-dequeue ──
    useEffect(() => {
        if (isTyping || sendingRef.current) return;
        if (messageQueueRef.current.length === 0) return;

        const timer = setTimeout(() => {
            const queue = messageQueueRef.current;
            if (queue.length === 0 || sendingRef.current) return;

            const next = queue[0];
            setMessageQueue(prev => prev.slice(1));

            if (next.type === 'user') {
                const userMsg: Message = { id: generateId(), role: 'user', content: next.content, timestamp: Date.now(), attachments: next.attachments };
                setMessages(prev => {
                    const updated = [...prev, userMsg];
                    sendToAI(next.content, prev, next.attachments);
                    return updated;
                });
            } else {
                const prompt = `[Automation Result — ${next.title || next.source || 'System'}]\n${next.content}\n\nReview this result and summarize findings or take appropriate action.`;
                const autoMsg: Message = { id: generateId(), role: 'user', content: prompt, timestamp: Date.now() };
                setMessages(prev => {
                    const updated = [...prev, autoMsg];
                    sendToAI(prompt, prev);
                    return updated;
                });
            }
        }, 500);

        return () => clearTimeout(timer);
    }, [isTyping, messageQueue.length, sendToAI]);

    // ── Persist messages when they change ──
    useEffect(() => {
        if (messages.length > 0) {
            const newId = persistConversation(messages, activeConvId);
            if (newId !== activeConvId) setActiveConvId(newId);
        }
    }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

    const stopGeneration = useCallback(() => {
        if (isElectron) { window.onicode!.abortAI(); } else { abortRef.current?.abort(); }
        if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
        setIsTyping(false);
        sendingRef.current = false;
        const finalContent = streamContentRef.current || '';
        const finalToolSteps = [...toolStepsRef.current];
        if (finalContent.trim() || finalToolSteps.length > 0) {
            setMessages((prev) => [...prev, {
                id: generateId(), role: 'ai' as const,
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
    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;
        processFiles(Array.from(files));
        e.target.value = '';
    }, []);

    const processFiles = useCallback((files: File[]) => {
        for (const f of files) {
            if (f.type.startsWith('video/') || /\.(mp4|avi|mov|wmv|flv|mkv|webm|m4v)$/i.test(f.name)) continue;

            const isImage = f.type.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(f.name);
            const isDoc = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|odt|rtf)$/i.test(f.name);

            const att: Attachment = {
                type: isImage ? 'image' as const : isDoc ? 'doc' as const : 'file' as const,
                name: f.name, size: f.size, mimeType: f.type,
            };

            if (isImage && f.size < 5_000_000) {
                const reader = new FileReader();
                reader.onload = () => { att.dataUrl = reader.result as string; setAttachments((prev) => [...prev, att]); };
                reader.readAsDataURL(f);
                continue;
            }

            const isText = f.type.startsWith('text/') ||
                /\.(ts|tsx|js|jsx|json|md|css|html|py|rb|go|rs|java|c|cpp|h|yml|yaml|toml|env|sh|sql|xml|csv|txt|log|cfg|ini)$/i.test(f.name);
            if (isText && f.size < 100_000) {
                const reader = new FileReader();
                reader.onload = () => { att.content = (reader.result as string).slice(0, 50_000); setAttachments((prev) => [...prev, att]); };
                reader.readAsText(f);
            } else {
                setAttachments((prev) => [...prev, att]);
            }
        }
    }, []);

    const handlePaste = useCallback((e: React.ClipboardEvent) => {
        const text = e.clipboardData.getData('text');
        if (text && /^https?:\/\/\S+$/.test(text.trim())) {
            e.preventDefault();
            const url = text.trim();
            setAttachments((prev) => [...prev, { type: 'link', name: new URL(url).hostname, url }]);
            return;
        }
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
    const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }, []);
    const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (e.currentTarget === e.target) setIsDragOver(false); }, []);
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) processFiles(files);
    }, [processFiles]);

    const removeAttachment = useCallback((index: number) => { setAttachments((prev) => prev.filter((_, i) => i !== index)); }, []);

    // ── Queue management ──
    const removeFromQueue = useCallback((id: string) => { setMessageQueue(prev => prev.filter(item => item.id !== id)); }, []);
    const editQueueItem = useCallback((id: string, newContent: string) => { setMessageQueue(prev => prev.map(item => item.id === id && item.editable ? { ...item, content: newContent } : item)); }, []);
    const moveQueueItem = useCallback((id: string, direction: 'up' | 'down') => {
        setMessageQueue(prev => {
            const idx = prev.findIndex(item => item.id === id);
            if (idx < 0) return prev;
            const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
            if (targetIdx < 0 || targetIdx >= prev.length) return prev;
            const next = [...prev];
            [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
            return next;
        });
    }, []);
    const clearUserQueue = useCallback(() => { setMessageQueue(prev => prev.filter(item => !item.editable)); }, []);

    // ── New chat ──
    const newChat = useCallback(() => {
        if (isElectron) window.onicode!.abortAI();
        else abortRef.current?.abort();
        if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
        setMessages([]); setInput(''); setIsTyping(false); setStreamingContent('');
        streamContentRef.current = ''; sendingRef.current = false;
        setActiveConvId(null); setMessageQueue([]);
        localStorage.removeItem(modeConvKey); setAttachments([]);
        // Clear stale tasks from previous conversation
        if (isElectron && window.onicode?.clearAllTasks) window.onicode.clearAllTasks().catch(() => {});
    }, []);

    // ── Save conversation on close/reload ──
    const messagesRef = useRef(messages);
    const activeConvIdRef = useRef(activeConvId);
    useEffect(() => { messagesRef.current = messages; }, [messages]);
    useEffect(() => { activeConvIdRef.current = activeConvId; }, [activeConvId]);

    useEffect(() => {
        const handler = () => {
            if (messagesRef.current.length > 0) {
                persistConversation(messagesRef.current, activeConvIdRef.current);
            }
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [persistConversation]);

    // ── Listen for external new-chat signal ──
    useEffect(() => {
        const handler = () => newChat();
        window.addEventListener('onicode-new-chat', handler);
        return () => window.removeEventListener('onicode-new-chat', handler);
    }, [newChat]);

    // ── Execute slash commands ──
    const handleCommand = useCallback(async (cmd: string): Promise<boolean> => {
        const result = await executeCommand(cmd, {
            messages, setMessages, newChat, stopGeneration, setShowHistory, activeConvId,
        });
        return result.handled;
    }, [messages, newChat, stopGeneration, activeConvId]);

    // ── Auto-detect project references ──
    const autoDetectProject = useCallback(async (text: string) => {
        if (!isElectron || scope === 'project') return;
        const lower = text.toLowerCase();
        const projectPhrases = /(?:continue|work|working|open|switch|resume|start)\s+(?:on|to|with)?\s+(?:the\s+)?(.+?)(?:\s+project)?$/i;
        const match = lower.match(projectPhrases);
        if (!match) return;
        const query = match[1].trim();
        if (query.length < 2) return;
        try {
            const { projects } = await window.onicode!.listProjects();
            const found = projects.find((p: { id: string; name: string; path: string }) => {
                const pName = p.name.toLowerCase();
                return pName.includes(query) || query.includes(pName);
            });
            if (found) {
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

        if (text.startsWith('/')) {
            const handled = await handleCommand(text);
            if (handled) { setInput(''); setShowSlashMenu(false); return; }
        }

        if (isTyping) {
            if (messageQueueRef.current.length >= 20) { setMessages(prev => [...prev]); return; }
            setMessageQueue(prev => [...prev, {
                id: generateId(), type: 'user' as const, content: text,
                attachments: attachments.length > 0 ? [...attachments] : undefined,
                timestamp: Date.now(), editable: true,
            }]);
            setInput(''); setAttachments([]); setShowQueuePanel(true);
            return;
        }

        autoDetectProject(text);
        const userMessage: Message = {
            id: generateId(), role: 'user', content: text, timestamp: Date.now(),
            attachments: attachments.length > 0 ? [...attachments] : undefined,
        };
        setInput(''); setShowSlashMenu(false);

        if (attachments.length > 0 && activeProject?.id && window.onicode?.attachmentSave) {
            for (const att of attachments) {
                window.onicode.attachmentSave({
                    id: generateId(), projectId: activeProject.id,
                    name: att.name, type: att.type, size: att.size, mimeType: att.mimeType,
                    url: att.url, content: att.content, dataUrl: att.dataUrl,
                    conversationId: activeConvId || undefined, createdAt: Date.now(),
                }).catch(() => {});
            }
        }
        setAttachments([]);

        setMessages((prev) => {
            const updated = [...prev, userMessage];
            sendToAI(text, prev, userMessage.attachments);
            return updated;
        });
    }, [input, attachments, activeProject?.id, activeConvId, handleCommand, sendToAI, autoDetectProject, isTyping]);

    // ── Keyboard handler ──
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (showSlashMenu && filteredCommands.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex((prev) => (prev + 1) % filteredCommands.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length); return; }
            if (e.key === 'Tab' || (e.key === 'Enter' && filteredCommands[slashIndex])) {
                e.preventDefault();
                const cmd = filteredCommands[slashIndex].name;
                const newInput = input.replace(/(^|\s)(\/\S*)$/, (_m, space) => space + cmd + ' ');
                setInput(newInput); setShowSlashMenu(false); return;
            }
            if (e.key === 'Escape') { setShowSlashMenu(false); return; }
        }

        if (showMentionMenu && filteredMentions.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((prev) => (prev + 1) % filteredMentions.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex((prev) => (prev - 1 + filteredMentions.length) % filteredMentions.length); return; }
            if (e.key === 'Tab' || (e.key === 'Enter' && filteredMentions[mentionIndex])) {
                e.preventDefault();
                const item = filteredMentions[mentionIndex];
                const atIndex = input.lastIndexOf('@');
                const prefix = item.type === 'project' ? '@project:' : item.type === 'workflow' ? '@workflow:' : item.type === 'memory' ? '@memory:' : '@';
                const newInput = input.slice(0, atIndex) + prefix + item.label + ' ';
                setInput(newInput);
                if (item.type === 'attachment' && item.attachment && !attachments.some(a => a.name === item.attachment!.name)) {
                    setAttachments(prev => [...prev, item.attachment!]);
                }
                setShowMentionMenu(false); return;
            }
            if (e.key === 'Escape') { setShowMentionMenu(false); return; }
        }

        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    }, [showSlashMenu, filteredCommands, slashIndex, showMentionMenu, filteredMentions, mentionIndex, input, attachments, handleSend]);

    // ── Welcome suggestion click ──
    const handleSuggestionClick = useCallback((suggestion: string) => {
        const userMessage: Message = { id: generateId(), role: 'user', content: suggestion, timestamp: Date.now() };
        setMessages((prev) => { const updated = [...prev, userMessage]; sendToAI(suggestion, prev); return updated; });
    }, [sendToAI]);

    // ── Load conversation ──
    const loadConversation = useCallback((conv: Conversation) => {
        // Clear current state (including tasks) and load the conversation
        newChat();
        setTimeout(() => {
            setMessages(conv.messages); setActiveConvId(conv.id);
            localStorage.setItem(modeConvKey, conv.id); setShowHistory(false);
            // Notify sidebar that conversation changed
            window.dispatchEvent(new CustomEvent('onicode-conversation-saved'));
        }, 0);
    }, [newChat]);

    const deleteConversation = useCallback((convId: string) => {
        const convs = loadConversationsFromCache().filter((c) => c.id !== convId);
        saveConversationsCache(convs); setConversations(convs);
        deleteFromSQLite(convId);
        if (activeConvId === convId) newChat();
        window.dispatchEvent(new CustomEvent('onicode-conversation-deleted'));
    }, [activeConvId, newChat]);

    // ── Listen for external load-conversation signal ──
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            const convId = typeof detail === 'string' ? detail : detail?.id;
            if (!convId) return;
            const cached = loadConversationsFromCache().find(c => c.id === convId);
            if (cached) { loadConversation(cached); return; }
            if (isElectron && window.onicode?.conversationGet) {
                window.onicode.conversationGet(convId).then((res: unknown) => {
                    const r = res as { success?: boolean; conversation?: Conversation };
                    if (r.success && r.conversation) loadConversation(r.conversation);
                }).catch(() => {});
            }
        };
        window.addEventListener('onicode-load-conversation', handler);
        return () => window.removeEventListener('onicode-load-conversation', handler);
    }, [loadConversation]);

    // ── Toggle expanded step ──
    const toggleStepExpand = useCallback((stepId: string, event?: React.MouseEvent) => {
        const clickedEl = event?.currentTarget as HTMLElement | undefined;
        const isGroup = stepId.startsWith('group-');
        setExpandedSteps(prev => {
            const next = new Set(prev);
            if (next.has(stepId)) {
                next.delete(stepId);
            } else if (isGroup) {
                for (const key of next) { if (key.startsWith('group-')) next.delete(key); }
                next.add(stepId);
            } else {
                for (const key of next) { if (!key.startsWith('group-')) next.delete(key); }
                next.add(stepId);
            }
            return next;
        });
        if (clickedEl) {
            requestAnimationFrame(() => { clickedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
        }
    }, []);

    // ── Retry handler ──
    const handleRetry = useCallback((messageId: string) => {
        sendToAI('continue', messages.filter(m => m.id !== messageId));
    }, [messages, sendToAI]);

    // ── Question submit handler ──
    const handleQuestionSubmit = useCallback((messageId: string, answersText: string, updatedPrev: Message[]) => {
        setMessages((prev) => {
            const updatedMessages = prev.map((m) =>
                m.id === messageId ? { ...m, questionsAnswered: true } : m
            );
            const userMsg: Message = { id: generateId(), role: 'user', content: answersText, timestamp: Date.now() };
            const updated = [...updatedMessages, userMsg];
            sendToAI(answersText, updatedMessages);
            return updated;
        });
    }, [sendToAI]);

    // ══════════════════════════════════════════
    //  Render
    // ══════════════════════════════════════════

    return (
        <div className="chat-container">
            {showHistory && (
                <ConversationHistory
                    conversations={conversations}
                    activeConvId={activeConvId}
                    onLoadConversation={loadConversation}
                    onDeleteConversation={deleteConversation}
                    onClose={() => setShowHistory(false)}
                />
            )}

            {messages.length === 0 ? (
                <WelcomeScreen
                    onSuggestionClick={handleSuggestionClick}
                />
            ) : (
                <MessageList
                    messages={messages}
                    streamingContent={streamingContent}
                    activeToolSteps={activeToolSteps}
                    isTyping={isTyping}
                    agentStatus={agentStatus}
                    sessionTimer={sessionTimer}
                    expandedSteps={expandedSteps}
                    showScrollBtn={showScrollBtn}
                    messagesContainerRef={messagesContainerRef}
                    messagesEndRef={messagesEndRef}
                    onToggleStepExpand={toggleStepExpand}
                    onScrollToBottom={scrollToBottom}
                    onRetry={handleRetry}
                    onQuestionSubmit={handleQuestionSubmit}
                    sendToAI={sendToAI}
                />
            )}

            <InputArea
                input={input}
                setInput={setInput}
                isTyping={isTyping}
                isDragOver={isDragOver}
                attachments={attachments}
                showSlashMenu={showSlashMenu}
                slashFilter={slashFilter}
                slashIndex={slashIndex}
                showMentionMenu={showMentionMenu}
                mentionIndex={mentionIndex}
                filteredCommands={filteredCommands}
                filteredMentions={filteredMentions}
                messageQueue={messageQueue}
                showQueuePanel={showQueuePanel}
                editingQueueId={editingQueueId}
                editingQueueText={editingQueueText}
                pendingQuestion={pendingQuestion}
                selectedOptions={selectedOptions}
                pendingApproval={pendingApproval}
                showAttachMenu={showAttachMenu}
                scope={scope}
                activeProject={activeProject}
                contextInfo={contextInfo}
                showModelPicker={showModelPicker}
                thinkingLevel={thinkingLevel}
                messagesCount={messages.length}
                textareaRef={textareaRef}
                fileInputRef={fileInputRef}
                slashMenuRef={slashMenuRef}
                mentionMenuRef={mentionMenuRef}
                attachMenuRef={attachMenuRef}
                onSend={handleSend}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onFileChange={handleFileChange}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onRemoveAttachment={removeAttachment}
                onStopGeneration={stopGeneration}
                onSetShowSlashMenu={setShowSlashMenu}
                onSetShowMentionMenu={setShowMentionMenu}
                onSetSlashIndex={setSlashIndex}
                onSetMentionIndex={setMentionIndex}
                onSetShowAttachMenu={setShowAttachMenu}
                onSetShowQueuePanel={setShowQueuePanel}
                onSetEditingQueueId={setEditingQueueId}
                onSetEditingQueueText={setEditingQueueText}
                onSetShowModelPicker={setShowModelPicker}
                onSetThinkingLevel={setThinkingLevel}
                onSetSelectedOptions={setSelectedOptions}
                onSetAttachments={setAttachments}
                onRemoveFromQueue={removeFromQueue}
                onEditQueueItem={editQueueItem}
                onMoveQueueItem={moveQueueItem}
                onClearUserQueue={clearUserQueue}
                onAnswerQuestion={handleAnswerQuestion}
                onSetPendingApproval={setPendingApproval}
                onChangeScope={onChangeScope}
            />
        </div>
    );
}
