import type React from 'react';
import type { ChatScope } from '../../App';
import type { ActiveProject } from '../ProjectModeBar';

// ── Core types ──

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

export interface ProviderConfig {
    id: string;
    apiKey?: string;
    baseUrl?: string;
    selectedModel?: string;
    connected?: boolean;
    enabled?: boolean;
    models?: string[];
}

// ── Component props ──

export interface ChatViewProps {
    scope?: ChatScope;
    activeProject?: ActiveProject | null;
    onChangeScope?: (scope: ChatScope) => void;
    onNewMessage?: () => void;
}

export interface QueueItem {
    id: string;
    type: 'user' | 'automation';
    content: string;
    attachments?: Attachment[];
    source?: string;
    title?: string;
    timestamp: number;
    editable: boolean;
}

export type MentionItem = {
    type: 'attachment' | 'file' | 'project' | 'workflow' | 'memory';
    label: string;
    detail: string;
    category: string;
    attachment?: Attachment;
    meta?: unknown;
};

export interface GroupedStep {
    key: string;
    name: string;
    steps: ToolStep[];
    count: number;
    allDone: boolean;
    anyRunning: boolean;
    anyError: boolean;
}

export interface MessageListProps {
    messages: Message[];
    streamingContent: string;
    activeToolSteps: ToolStep[];
    isTyping: boolean;
    agentStatus: {
        status: string;
        round: number;
        pending?: number;
        agentId?: string;
        task?: string;
    } | null;
    sessionTimer: number;
    expandedSteps: Set<string>;
    showScrollBtn: boolean;
    messagesContainerRef: React.RefObject<HTMLDivElement | null>;
    messagesEndRef: React.RefObject<HTMLDivElement | null>;
    onToggleStepExpand: (stepId: string, event?: React.MouseEvent) => void;
    onScrollToBottom: () => void;
    onRetry: (messageId: string) => void;
    onQuestionSubmit: (messageId: string, answersText: string, updatedPrev: Message[]) => void;
    sendToAI: (userMessage: string, allMessages: Message[], currentAttachments?: Attachment[]) => void;
}

export interface MessageBubbleProps {
    message: Message;
    isTyping: boolean;
    expandedSteps: Set<string>;
    onToggleStepExpand: (stepId: string, event?: React.MouseEvent) => void;
    onRetry: (messageId: string) => void;
    onQuestionSubmit: (messageId: string, answersText: string, updatedPrev: Message[]) => void;
    sendToAI: (userMessage: string, allMessages: Message[], currentAttachments?: Attachment[]) => void;
    allMessages: Message[];
}

export interface ToolStepRendererProps {
    steps: ToolStep[];
    expandedSteps: Set<string>;
    onToggleStepExpand: (stepId: string, event?: React.MouseEvent) => void;
}

export interface InputAreaProps {
    input: string;
    setInput: React.Dispatch<React.SetStateAction<string>>;
    isTyping: boolean;
    isDragOver: boolean;
    attachments: Attachment[];
    showSlashMenu: boolean;
    slashFilter: string;
    slashIndex: number;
    showMentionMenu: boolean;
    mentionIndex: number;
    filteredCommands: Array<{ name: string; description: string; category: string }>;
    filteredMentions: MentionItem[];
    messageQueue: QueueItem[];
    showQueuePanel: boolean;
    editingQueueId: string | null;
    editingQueueText: string;
    pendingQuestion: {
        questionId: string;
        question: string;
        options: Array<{ label: string; description?: string }>;
        allowMultiple: boolean;
    } | null;
    selectedOptions: Set<number>;
    pendingApproval: {
        approvalId: string;
        tool: string;
        args: Record<string, unknown>;
    } | null;
    showAttachMenu: boolean;
    scope: ChatScope;
    activeProject?: ActiveProject | null;
    contextInfo: { tokens: number; messages: number } | null;
    showModelPicker: boolean;
    thinkingLevel: string;
    messagesCount: number;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    slashMenuRef: React.RefObject<HTMLDivElement | null>;
    mentionMenuRef: React.RefObject<HTMLDivElement | null>;
    attachMenuRef: React.RefObject<HTMLDivElement | null>;
    onSend: () => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    onPaste: (e: React.ClipboardEvent) => void;
    onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onRemoveAttachment: (index: number) => void;
    onStopGeneration: () => void;
    onSetShowSlashMenu: (show: boolean) => void;
    onSetShowMentionMenu: (show: boolean) => void;
    onSetSlashIndex: (index: number) => void;
    onSetMentionIndex: (index: number) => void;
    onSetShowAttachMenu: (show: boolean | ((prev: boolean) => boolean)) => void;
    onSetShowQueuePanel: (show: boolean) => void;
    onSetEditingQueueId: (id: string | null) => void;
    onSetEditingQueueText: (text: string) => void;
    onSetShowModelPicker: (show: boolean) => void;
    onSetThinkingLevel: (level: string) => void;
    onSetSelectedOptions: (updater: (prev: Set<number>) => Set<number>) => void;
    onSetAttachments: (updater: (prev: Attachment[]) => Attachment[]) => void;
    onRemoveFromQueue: (id: string) => void;
    onEditQueueItem: (id: string, newContent: string) => void;
    onMoveQueueItem: (id: string, direction: 'up' | 'down') => void;
    onClearUserQueue: () => void;
    onAnswerQuestion: (answer: string | string[]) => void;
    onSetPendingApproval: (approval: { approvalId: string; tool: string; args: Record<string, unknown> } | null) => void;
    onChangeScope?: (scope: ChatScope) => void;
}

export interface ContextBarProps {
    contextInfo: { tokens: number; messages: number } | null;
    messagesCount: number;
    showModelPicker: boolean;
    thinkingLevel: string;
    onSetShowModelPicker: (show: boolean) => void;
    onSetThinkingLevel: (level: string) => void;
}

export interface WelcomeScreenProps {
    conversations: Conversation[];
    onSuggestionClick: (suggestion: string) => void;
    onShowHistory: () => void;
}

export interface ConversationHistoryProps {
    conversations: Conversation[];
    activeConvId: string | null;
    onLoadConversation: (conv: Conversation) => void;
    onDeleteConversation: (convId: string) => void;
    onClose: () => void;
}

export interface ScreenshotImageProps {
    filePath: string;
    alt: string;
    onClick?: () => void;
}
