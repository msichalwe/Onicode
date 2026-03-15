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
    channel?: 'telegram' | 'discord' | 'slack';
    channelFrom?: string;
    widgets?: ChatWidget[];
}

// ── Chat Widgets ──

export type ChatWidgetType =
    | 'weather'
    | 'system-stats'
    | 'quick-actions'
    | 'timer'
    | 'progress'
    | 'git-card'
    | 'poll'
    | 'checklist'
    | 'link-preview'
    | 'chart'
    | 'image-gallery'
    | 'contact-card'
    | 'calendar-event'
    | 'code-run'
    | 'file-card'
    | 'mermaid'
    | 'flowchart'
    | 'timeline'
    | 'kanban'
    | 'mindmap'
    | 'dashboard'
    | 'svg-chart'
    // Interactive widgets (v2)
    | 'simulation'
    | 'interactive-graph'
    | 'data-table'
    | 'comparison'
    | 'pricing'
    | 'accordion'
    | 'tabs'
    | 'slides'
    | 'rating'
    | 'countdown'
    | 'color-palette'
    | 'floor-plan'
    | 'equation'
    | 'video'
    | 'document'
    | 'artifact';

export interface ChatWidget {
    id: string;
    type: ChatWidgetType;
    data: Record<string, unknown>;
}

export interface WeatherData {
    location: string;
    temp: number;
    unit: 'C' | 'F';
    condition: string;
    icon: string; // emoji
    humidity?: number;
    wind?: string;
    forecast?: Array<{ day: string; temp: number; icon: string }>;
}

export interface SystemStatsData {
    cpu: number;
    memory: { used: number; total: number };
    disk: { used: number; total: number };
    uptime?: string;
}

export interface QuickActionsData {
    title?: string;
    actions: Array<{ label: string; command: string; icon?: string }>;
}

export interface TimerData {
    label: string;
    endsAt: number; // unix ms
    duration: number; // seconds
}

export interface ProgressData {
    label: string;
    current: number;
    total: number;
    unit?: string;
    items?: Array<{ label: string; done: boolean }>;
}

export interface GitCardData {
    branch: string;
    status: string;
    ahead?: number;
    behind?: number;
    changed?: number;
    recentCommits?: Array<{ hash: string; message: string; time: string }>;
}

export interface PollData {
    question: string;
    options: Array<{ label: string; votes: number }>;
    voted?: number;
}

export interface ChecklistData {
    title: string;
    items: Array<{ id: string; label: string; done: boolean }>;
}

export interface LinkPreviewData {
    url: string;
    title: string;
    description?: string;
    image?: string;
    domain: string;
}

export interface ChartData {
    title: string;
    type: 'bar' | 'line' | 'pie';
    labels: string[];
    values: number[];
    color?: string;
}

export interface ImageGalleryData {
    images: Array<{ src: string; alt?: string }>;
}

export interface ContactCardData {
    name: string;
    role?: string;
    email?: string;
    phone?: string;
    avatar?: string;
}

export interface CalendarEventData {
    title: string;
    date: string;
    time?: string;
    location?: string;
    description?: string;
}

export interface CodeRunData {
    language: string;
    code: string;
    output?: string;
    exitCode?: number;
}

export interface FileCardData {
    name: string;
    path: string;
    size?: string;
    language?: string;
    preview?: string;
}

export interface MermaidData {
    code: string;
    title?: string;
}

export interface FlowchartData {
    title?: string;
    nodes: Array<{ id: string; label: string; type?: 'start' | 'end' | 'process' | 'decision' | 'io' }>;
    edges: Array<{ from: string; to: string; label?: string }>;
}

export interface TimelineData {
    title?: string;
    events: Array<{ date: string; title: string; description?: string; icon?: string; color?: string }>;
}

export interface KanbanData {
    title?: string;
    columns: Array<{ name: string; color?: string; items: Array<{ id: string; title: string; tag?: string }> }>;
}

export interface MindmapData {
    root: MindmapNode;
}

export interface MindmapNode {
    label: string;
    children?: MindmapNode[];
    color?: string;
}

export interface DashboardData {
    title?: string;
    widgets: Array<{ type: string; data: Record<string, unknown>; span?: number }>;
}

export interface SVGChartData {
    title?: string;
    type: 'line' | 'area' | 'scatter' | 'radar' | 'donut';
    labels: string[];
    datasets: Array<{ label: string; values: number[]; color?: string }>;
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

export type OnicodeMode = 'onichat' | 'workmate' | 'projects';

export interface WorkmateFolder {
    path: string;
    name: string;
}

export interface ChatViewProps {
    scope?: ChatScope;
    activeProject?: ActiveProject | null;
    onChangeScope?: (scope: ChatScope) => void;
    onNewMessage?: () => void;
    mode?: OnicodeMode;
    workmateFolder?: WorkmateFolder | null;
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
