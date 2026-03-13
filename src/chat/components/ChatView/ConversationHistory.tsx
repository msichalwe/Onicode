import React from 'react';
import type { ConversationHistoryProps } from './types';

export default function ConversationHistory({ conversations, activeConvId, onLoadConversation, onDeleteConversation, onClose }: ConversationHistoryProps) {
    return (
        <div className="history-overlay" onClick={onClose}>
            <div className="history-panel" onClick={(e) => e.stopPropagation()}>
                <div className="history-header">
                    <h3>Chat History</h3>
                    <button className="history-close" onClick={onClose}>
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
                                    onClick={() => onLoadConversation(conv)}
                                >
                                    <div className="history-item-title">{conv.title}</div>
                                    <div className="history-item-date">
                                        {new Date(conv.updatedAt).toLocaleDateString()} &middot; {conv.messages.length} msgs
                                    </div>
                                </div>
                                <button
                                    className="history-item-delete"
                                    onClick={(e) => { e.stopPropagation(); onDeleteConversation(conv.id); }}
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
    );
}
