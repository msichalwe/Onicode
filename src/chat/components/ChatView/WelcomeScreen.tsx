import React from 'react';
import { WELCOME_SUGGESTIONS } from './constants';
import type { WelcomeScreenProps } from './types';

export default function WelcomeScreen({ onSuggestionClick }: WelcomeScreenProps) {
    return (
        <div className="welcome">
            <div className="welcome-logo">
                <svg width="48" height="48" viewBox="0 0 1024 1024" fill="none">
                    <rect width="1024" height="1024" rx="228" fill="#C4A882"/>
                    <circle cx="512" cy="512" r="260" fill="none" stroke="#fff" strokeWidth="64" opacity="0.95"/>
                    <path d="M432 412 L352 512 L432 612" fill="none" stroke="#fff" strokeWidth="48" strokeLinecap="round" strokeLinejoin="round" opacity="0.9"/>
                    <path d="M592 412 L672 512 L592 612" fill="none" stroke="#fff" strokeWidth="48" strokeLinecap="round" strokeLinejoin="round" opacity="0.9"/>
                    <circle cx="512" cy="512" r="28" fill="#fff" opacity="0.85"/>
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
        </div>
    );
}
