import React, { useCallback } from 'react';
import { marked } from 'marked';
import ToolStepRenderer from './ToolStepRenderer';
import MessageBubble from './MessageBubble';
import { formatTime } from './helpers';
import type { MessageListProps } from './types';

export default function MessageList({
    messages,
    streamingContent,
    activeToolSteps,
    isTyping,
    agentStatus,
    sessionTimer,
    expandedSteps,
    showScrollBtn,
    messagesContainerRef,
    messagesEndRef,
    onToggleStepExpand,
    onScrollToBottom,
    onRetry,
    onQuestionSubmit,
    sendToAI,
}: MessageListProps) {
    const handleMarkdownClick = useCallback((e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        const anchor = target.closest('a');
        if (anchor && anchor.href) {
            e.preventDefault();
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

    return (
        <>
            <div className="messages" ref={messagesContainerRef}>
                {messages.map((message) => (
                    <MessageBubble
                        key={message.id}
                        message={message}
                        isTyping={isTyping}
                        expandedSteps={expandedSteps}
                        onToggleStepExpand={onToggleStepExpand}
                        onRetry={onRetry}
                        onQuestionSubmit={onQuestionSubmit}
                        sendToAI={sendToAI}
                        allMessages={messages}
                    />
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
                            {activeToolSteps.length > 0 && (
                                <ToolStepRenderer
                                    steps={activeToolSteps}
                                    expandedSteps={expandedSteps}
                                    onToggleStepExpand={onToggleStepExpand}
                                />
                            )}
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
                <button className="scroll-to-bottom-btn" onClick={onScrollToBottom} title="Scroll to bottom">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="6 9 12 15 18 9" />
                    </svg>
                </button>
            )}
        </>
    );
}
