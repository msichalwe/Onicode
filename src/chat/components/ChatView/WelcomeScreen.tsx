import React, { useState, useEffect } from 'react';
import { getWelcomePrompts } from './constants';
import type { OnicodeMode } from '../../modes';

interface WelcomeScreenProps {
    onSuggestionClick: (suggestion: string) => void;
    mode?: OnicodeMode;
}

const MODE_TITLES: Record<OnicodeMode, { title: string; subtitle: string }> = {
    onichat: {
        title: 'Welcome to Onicode',
        subtitle: 'Your AI-powered companion. Ask me anything — code, general questions, brainstorming, or open a project to start building.',
    },
    workpal: {
        title: 'Workpal Mode',
        subtitle: 'Your document and productivity assistant. Summarize files, draft emails, organize notes, and get work done faster.',
    },
    projects: {
        title: 'Project Mode',
        subtitle: 'Your software engineering partner. Write code, debug, refactor, test, and ship — all within your project context.',
    },
};

export default function WelcomeScreen({ onSuggestionClick, mode = 'onichat' }: WelcomeScreenProps) {
    // Shuffle prompts on mount and when mode changes
    const [prompts, setPrompts] = useState(() => getWelcomePrompts(mode));

    useEffect(() => {
        setPrompts(getWelcomePrompts(mode));
    }, [mode]);

    const { title, subtitle } = MODE_TITLES[mode] || MODE_TITLES.onichat;

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
            <h2>{title}</h2>
            <p>{subtitle}</p>
            <div className="welcome-hints">
                Type <code>/help</code> for commands &middot; Paste a URL to attach &middot; Drop files to include
            </div>
            <div className="welcome-actions">
                {prompts.map((s) => (
                    <button key={s} className="welcome-chip" onClick={() => onSuggestionClick(s)}>{s}</button>
                ))}
            </div>
        </div>
    );
}
