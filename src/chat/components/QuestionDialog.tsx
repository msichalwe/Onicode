/**
 * QuestionDialog — Renders AI discovery questions as an interactive form
 * with selectable options (multi-select), text input, and "Let AI Decide" button.
 * Supports submitted/locked state to retain answers after submission.
 */

import React, { useState, useCallback } from 'react';

export interface ParsedQuestion {
    number: number;
    text: string;
    options: string[];
}

interface QuestionDialogProps {
    questions: ParsedQuestion[];
    onSubmit: (answers: string) => void;
    submitted?: boolean;
    savedAnswers?: Record<number, string[]>;
}

/**
 * Parse numbered questions with parenthetical options from AI message content.
 * Pattern: "1. Question text? (option1, option2, option3)"
 * Returns null if no questions detected.
 */
export function parseQuestions(content: string): ParsedQuestion[] | null {
    const lines = content.split('\n').filter((l) => l.trim());
    const questions: ParsedQuestion[] = [];

    for (const line of lines) {
        // Match numbered questions: "1. text", "1.**text**", "1) text", "- 1. text"
        // Flexible: allows optional bold markers, colon after number, no space after period
        const match = line.match(/^\s*[-*]?\s*(\d+)[.)]\s*\**\s*(.+)/);
        if (!match) continue;

        const num = parseInt(match[1], 10);
        let text = match[2].trim();
        // Strip leading/trailing markdown bold markers
        text = text.replace(/^\*{1,2}/, '').replace(/\*{1,2}$/, '').trim();
        // Strip leading colon after bold label
        text = text.replace(/^\*{0,2}:?\s*/, '').trim();
        let options: string[] = [];

        // Extract parenthetical options: (opt1, opt2, opt3)
        const optMatch = text.match(/\(([^)]+)\)\s*[?.]?\s*$/);
        if (optMatch) {
            options = optMatch[1].split(/,\s*|\/\s*|\sor\s/).map((o) => o.trim().replace(/^["']|["']$/g, ''));
            text = text.replace(/\s*\([^)]+\)\s*[?.]?\s*$/, '').trim();
        }

        // Extract options from "e.g." pattern
        const egMatch = text.match(/(?:e\.g\.\s*|like\s+)(.+)$/i);
        if (egMatch && options.length === 0) {
            options = egMatch[1].split(/,\s*|\sor\s/).map((o) => o.trim().replace(/^["']|["']$/g, ''));
        }

        // Extract options from quoted alternatives: "option1", "option2", or "option3"
        const quotedMatch = text.match(/["""]([^"""]+)["""]/g);
        if (quotedMatch && options.length === 0) {
            options = quotedMatch.map(q => q.replace(/["""]/g, '').trim());
        }

        // Extract options from bold alternatives: **option1**, **option2**, **option3**
        const boldMatch = text.match(/\*\*([^*]+)\*\*/g);
        if (boldMatch && boldMatch.length >= 2 && options.length === 0) {
            options = boldMatch.map(b => b.replace(/\*\*/g, '').trim());
        }

        if (text) {
            // Clean up remaining markdown from text
            text = text.replace(/\*\*/g, '').replace(/`/g, '').trim();
            questions.push({ number: num, text, options });
        }
    }

    return questions.length >= 2 ? questions : null;
}

/**
 * Check if an AI message looks like a discovery question set.
 * Must be a short, question-focused message — NOT a status report with numbered items.
 */
export function isQuestionMessage(content: string): boolean {
    // Don't treat long messages (status reports, changelogs) as question dialogs
    if (content.length > 1500) return false;

    // Must contain actual question marks — numbered lists without "?" are status reports
    const questionMarkCount = (content.match(/\?/g) || []).length;
    if (questionMarkCount < 2) return false;

    // Reject if message contains tool result indicators (status reports, changelogs, etc.)
    if (/\b(completed|done|applied|created|updated|built|passed|failed|error|fixed)\b/i.test(content.slice(0, 200))) return false;

    const questions = parseQuestions(content);
    if (!questions || questions.length < 2) return false;

    // At least half of the parsed "questions" must actually end with "?"
    const actualQuestions = questions.filter(q => q.text.includes('?') || q.options.length > 0);
    return actualQuestions.length >= 2;
}

export default function QuestionDialog({ questions, onSubmit, submitted = false, savedAnswers }: QuestionDialogProps) {
    const [answers, setAnswers] = useState<Record<number, string[]>>(
        savedAnswers || {}
    );
    const [customInputs, setCustomInputs] = useState<Record<number, string>>({});
    const [showCustom, setShowCustom] = useState<Record<number, boolean>>({});
    const [isSubmitted, setIsSubmitted] = useState(submitted);

    const toggleOption = useCallback((qNum: number, option: string) => {
        if (isSubmitted) return;
        setAnswers((prev) => {
            const current = prev[qNum] || [];
            const idx = current.indexOf(option);
            if (idx >= 0) {
                // Deselect
                return { ...prev, [qNum]: current.filter((o) => o !== option) };
            } else {
                // Select (add to array)
                return { ...prev, [qNum]: [...current, option] };
            }
        });
        setShowCustom((prev) => ({ ...prev, [qNum]: false }));
    }, [isSubmitted]);

    const toggleCustom = useCallback((qNum: number) => {
        if (isSubmitted) return;
        setShowCustom((prev) => ({ ...prev, [qNum]: !prev[qNum] }));
        if (!showCustom[qNum]) {
            // Clear preset selections when switching to custom
            setAnswers((prev) => {
                const next = { ...prev };
                delete next[qNum];
                return next;
            });
        }
    }, [showCustom, isSubmitted]);

    const handleCustomChange = useCallback((qNum: number, value: string) => {
        if (isSubmitted) return;
        setCustomInputs((prev) => ({ ...prev, [qNum]: value }));
        setAnswers((prev) => ({ ...prev, [qNum]: value ? [value] : [] }));
    }, [isSubmitted]);

    const handleSubmit = useCallback(() => {
        if (isSubmitted) return;
        const lines = questions.map((q) => {
            const selected = answers[q.number] || [];
            const answer = selected.length > 0 ? selected.join(', ') : 'recommended';
            return `${q.number}. ${q.text} → **${answer}**`;
        });
        setIsSubmitted(true);
        onSubmit(lines.join('\n'));
    }, [questions, answers, onSubmit, isSubmitted]);

    const handleLetAIDecide = useCallback(() => {
        if (isSubmitted) return;
        // Mark all as "recommended"
        const defaultAnswers: Record<number, string[]> = {};
        for (const q of questions) {
            defaultAnswers[q.number] = ['recommended'];
        }
        setAnswers(defaultAnswers);
        setIsSubmitted(true);
        onSubmit('Use recommended defaults for all questions. Just build it.');
    }, [onSubmit, isSubmitted, questions]);

    const answeredCount = Object.keys(answers).filter((k) => {
        const val = answers[Number(k)];
        return val && val.length > 0 && val.some(v => v.trim());
    }).length;

    return (
        <div className={`question-dialog ${isSubmitted ? 'question-dialog-submitted' : ''}`}>
            <div className="question-dialog-header">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {isSubmitted ? (
                        <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>
                    ) : (
                        <><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></>
                    )}
                </svg>
                <span>
                    {isSubmitted
                        ? `Setup Complete (${answeredCount}/${questions.length} answered)`
                        : `Quick Setup (${answeredCount}/${questions.length} answered)`
                    }
                </span>
            </div>

            <div className="question-list">
                {questions.map((q) => {
                    const selected = answers[q.number] || [];
                    const hasAnswer = selected.length > 0 && selected.some(v => v.trim());
                    return (
                        <div key={q.number} className={`question-item ${hasAnswer ? 'answered' : ''} ${isSubmitted ? 'locked' : ''}`}>
                            <div className="question-text">
                                <span className="question-num">{q.number}.</span>
                                {q.text}
                                {isSubmitted && hasAnswer && (
                                    <span className="question-answer-badge">{selected.join(', ')}</span>
                                )}
                            </div>

                            {!isSubmitted && q.options.length > 0 && (
                                <div className="question-options">
                                    {q.options.map((opt) => (
                                        <button
                                            key={opt}
                                            className={`question-option ${selected.includes(opt) ? 'selected' : ''}`}
                                            onClick={() => toggleOption(q.number, opt)}
                                            title={opt}
                                        >
                                            {selected.includes(opt) && (
                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                                    <polyline points="20 6 9 17 4 12" />
                                                </svg>
                                            )}
                                            {opt}
                                        </button>
                                    ))}
                                    <button
                                        className={`question-option question-option-custom ${showCustom[q.number] ? 'selected' : ''}`}
                                        onClick={() => toggleCustom(q.number)}
                                        title="Type your own answer"
                                    >
                                        Custom...
                                    </button>
                                </div>
                            )}

                            {!isSubmitted && (showCustom[q.number] || q.options.length === 0) && (
                                <input
                                    type="text"
                                    className="question-input"
                                    placeholder="Type your preference..."
                                    value={customInputs[q.number] || ''}
                                    onChange={(e) => handleCustomChange(q.number, e.target.value)}
                                    autoFocus={showCustom[q.number]}
                                />
                            )}
                        </div>
                    );
                })}
            </div>

            {!isSubmitted && (
                <div className="question-actions">
                    <button className="question-action-btn question-ai-decide" onClick={handleLetAIDecide}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 2L2 7l10 5 10-5-10-5z" />
                            <path d="M2 17l10 5 10-5" />
                            <path d="M2 12l10 5 10-5" />
                        </svg>
                        Let AI Decide
                    </button>
                    <button
                        className="question-action-btn question-submit"
                        onClick={handleSubmit}
                        disabled={answeredCount === 0}
                    >
                        Submit Answers
                    </button>
                </div>
            )}
        </div>
    );
}
