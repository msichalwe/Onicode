/**
 * QuestionDialog — Renders AI discovery questions as an interactive form
 * with selectable options, text input, and "Let AI Decide" button.
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

export default function QuestionDialog({ questions, onSubmit }: QuestionDialogProps) {
    const [answers, setAnswers] = useState<Record<number, string>>({});
    const [customInputs, setCustomInputs] = useState<Record<number, string>>({});
    const [showCustom, setShowCustom] = useState<Record<number, boolean>>({});

    const selectOption = useCallback((qNum: number, option: string) => {
        setAnswers((prev) => ({ ...prev, [qNum]: option }));
        setShowCustom((prev) => ({ ...prev, [qNum]: false }));
    }, []);

    const toggleCustom = useCallback((qNum: number) => {
        setShowCustom((prev) => ({ ...prev, [qNum]: !prev[qNum] }));
        if (!showCustom[qNum]) {
            setAnswers((prev) => {
                const next = { ...prev };
                delete next[qNum];
                return next;
            });
        }
    }, [showCustom]);

    const handleCustomChange = useCallback((qNum: number, value: string) => {
        setCustomInputs((prev) => ({ ...prev, [qNum]: value }));
        setAnswers((prev) => ({ ...prev, [qNum]: value }));
    }, []);

    const handleSubmit = useCallback(() => {
        const lines = questions.map((q) => {
            const answer = answers[q.number] || 'recommended';
            return `${q.number}. ${q.text} → **${answer}**`;
        });
        onSubmit(lines.join('\n'));
    }, [questions, answers, onSubmit]);

    const handleLetAIDecide = useCallback(() => {
        onSubmit('Use recommended defaults for all questions. Just build it.');
    }, [onSubmit]);

    const answeredCount = Object.keys(answers).filter((k) => answers[Number(k)]?.trim()).length;

    return (
        <div className="question-dialog">
            <div className="question-dialog-header">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span>Quick Setup ({answeredCount}/{questions.length} answered)</span>
            </div>

            <div className="question-list">
                {questions.map((q) => (
                    <div key={q.number} className={`question-item ${answers[q.number] ? 'answered' : ''}`}>
                        <div className="question-text">
                            <span className="question-num">{q.number}.</span>
                            {q.text}
                        </div>

                        {q.options.length > 0 && (
                            <div className="question-options">
                                {q.options.map((opt) => (
                                    <button
                                        key={opt}
                                        className={`question-option ${answers[q.number] === opt ? 'selected' : ''}`}
                                        onClick={() => selectOption(q.number, opt)}
                                        title={opt}
                                    >
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

                        {(showCustom[q.number] || q.options.length === 0) && (
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
                ))}
            </div>

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
        </div>
    );
}
