import React, { useCallback } from 'react';
import { marked } from 'marked';
import QuestionDialog, { parseQuestions, isQuestionMessage } from '../QuestionDialog';
import { generateId } from '../../utils';
import ToolStepRenderer from './ToolStepRenderer';
import type { MessageBubbleProps, Message } from './types';

export default function MessageBubble({
    message,
    isTyping,
    expandedSteps,
    onToggleStepExpand,
    onRetry,
    onQuestionSubmit,
    sendToAI,
    allMessages,
}: MessageBubbleProps) {
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
        <div className={`message message-${message.role}`}>
            <div className="message-content-wrapper">
                {message.toolSteps && message.toolSteps.length > 0 && (
                    <ToolStepRenderer
                        steps={message.toolSteps}
                        expandedSteps={expandedSteps}
                        onToggleStepExpand={onToggleStepExpand}
                    />
                )}
                {message.role === 'ai' && isQuestionMessage(message.content) ? (
                    <div className="message-bubble">
                        <QuestionDialog
                            questions={parseQuestions(message.content)!}
                            submitted={message.questionsAnswered || false}
                            savedAnswers={message.questionAnswers}
                            onSubmit={(answersText) => {
                                const updatedPrev = allMessages.map((m) =>
                                    m.id === message.id
                                        ? { ...m, questionsAnswered: true }
                                        : m
                                );
                                onQuestionSubmit(message.id, answersText, updatedPrev);
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
                        onClick={() => onRetry(message.id)}
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
    );
}
