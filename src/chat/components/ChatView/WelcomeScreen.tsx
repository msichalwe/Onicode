import React from 'react';
import { WELCOME_SUGGESTIONS } from './constants';
import type { WelcomeScreenProps } from './types';

export default function WelcomeScreen({ conversations, onSuggestionClick, onShowHistory }: WelcomeScreenProps) {
    return (
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
                    <button key={s} className="welcome-chip" onClick={() => onSuggestionClick(s)}>{s}</button>
                ))}
            </div>
            {conversations.length > 0 && (
                <button className="history-btn" onClick={onShowHistory}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                    </svg>
                    View chat history ({conversations.length})
                </button>
            )}
        </div>
    );
}
