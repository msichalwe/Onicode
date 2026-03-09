/**
 * OnboardingDialog — First-launch modal that asks 3-4 questions
 * to learn user preferences. Saves to ~/.onicode/memories/user.md
 */

import React, { useState, useCallback } from 'react';

interface OnboardingDialogProps {
    onComplete: () => void;
    onSkip: () => void;
}

export default function OnboardingDialog({ onComplete, onSkip }: OnboardingDialogProps) {
    const [name, setName] = useState('');
    const [language, setLanguage] = useState('');
    const [framework, setFramework] = useState('');
    const [codeStyle, setCodeStyle] = useState('');

    const handleSubmit = useCallback(async () => {
        if (window.onicode) {
            await window.onicode.memorySaveOnboarding({
                name: name.trim() || undefined,
                language: language.trim() || undefined,
                framework: framework.trim() || undefined,
                codeStyle: codeStyle.trim() || undefined,
            });
        }
        onComplete();
    }, [name, language, framework, codeStyle, onComplete]);

    const handleSkip = useCallback(async () => {
        // Create a minimal user.md so we don't ask again
        if (window.onicode) {
            await window.onicode.memorySaveOnboarding({});
        }
        onSkip();
    }, [onSkip]);

    return (
        <div className="onboarding-overlay">
            <div className="onboarding-dialog">
                <h2>Welcome to Onicode</h2>
                <p className="onboarding-sub">
                    A few quick questions so the AI can work the way you like.
                </p>

                <div className="onboarding-field">
                    <label htmlFor="ob-name">What should I call you?</label>
                    <input
                        id="ob-name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Alex, Sarah, Dev"
                        autoFocus
                    />
                </div>

                <div className="onboarding-field">
                    <label htmlFor="ob-lang">Preferred programming language?</label>
                    <input
                        id="ob-lang"
                        type="text"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        placeholder="e.g. TypeScript, Python, Rust, Go"
                    />
                </div>

                <div className="onboarding-field">
                    <label htmlFor="ob-fw">Favorite framework / stack?</label>
                    <input
                        id="ob-fw"
                        type="text"
                        value={framework}
                        onChange={(e) => setFramework(e.target.value)}
                        placeholder="e.g. Next.js, React + Vite, Django, Express"
                    />
                </div>

                <div className="onboarding-field">
                    <label htmlFor="ob-style">Code style preference?</label>
                    <input
                        id="ob-style"
                        type="text"
                        value={codeStyle}
                        onChange={(e) => setCodeStyle(e.target.value)}
                        placeholder="e.g. minimal, verbose, lots of comments, functional"
                    />
                </div>

                <div className="onboarding-actions">
                    <button className="onboarding-skip" onClick={handleSkip}>
                        Skip for now
                    </button>
                    <button className="onboarding-submit" onClick={handleSubmit}>
                        Save Preferences
                    </button>
                </div>
            </div>
        </div>
    );
}
