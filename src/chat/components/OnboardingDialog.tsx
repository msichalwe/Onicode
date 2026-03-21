/**
 * OnboardingWizard — 7-step onboarding: Welcome, Use Cases, Theme, Personalize,
 * Account (required), Connect AI, All Set. Premium animated feel with CSS transitions.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTheme, type ThemeName } from '../hooks/useTheme';
import { isElectron } from '../utils';

const API_BASE = 'http://187.124.115.69:4100';

interface OnboardingDialogProps {
    onComplete: () => void;
    onSkip: () => void;
}

type WizardStep = 'welcome' | 'usecases' | 'theme' | 'personalize' | 'account' | 'connect' | 'done';
const STEPS: WizardStep[] = ['welcome', 'usecases', 'theme', 'personalize', 'account', 'connect', 'done'];

/* ── Data ── */

const USE_CASES = [
    { id: 'coding', icon: '{}', label: 'Software Development', desc: 'Build apps, debug code, manage repos' },
    { id: 'writing', icon: '\u270D', label: 'Writing & Content', desc: 'Draft emails, articles, social posts' },
    { id: 'research', icon: '\uD83D\uDD0D', label: 'Research & Analysis', desc: 'Search the web, summarize, compare' },
    { id: 'learning', icon: '\uD83D\uDCDA', label: 'Learning & Study', desc: 'Explanations, tutoring, homework help' },
    { id: 'productivity', icon: '\u26A1', label: 'Productivity', desc: 'Automate tasks, manage files, organize' },
    { id: 'creative', icon: '\uD83C\uDFA8', label: 'Creative Projects', desc: 'Design ideas, brainstorm, plan' },
];

const THEMES: { id: ThemeName; label: string; colors: [string, string, string, string] }[] = [
    { id: 'sand', label: 'Sand', colors: ['#f5f0e8', '#e8dcc8', '#8b7355', '#c5956b'] },
    { id: 'midnight', label: 'Midnight', colors: ['#12122a', '#1e1e3a', '#7b68ee', '#a78bfa'] },
    { id: 'obsidian', label: 'Obsidian', colors: ['#0c0c14', '#16161e', '#8b5cf6', '#c084fc'] },
    { id: 'ocean', label: 'Ocean', colors: ['#1a2838', '#243446', '#38bdf8', '#22d3ee'] },
    { id: 'aurora', label: 'Aurora', colors: ['#1a1232', '#261a46', '#a78bfa', '#818cf8'] },
    { id: 'monokai', label: 'Monokai', colors: ['#272822', '#3e3d32', '#f92672', '#a6e22e'] },
    { id: 'rosepine', label: 'Rose Pine', colors: ['#191724', '#26233a', '#eb6f92', '#c4a7e7'] },
    { id: 'nord', label: 'Nord', colors: ['#2e3440', '#3b4252', '#88c0d0', '#81a1c1'] },
    { id: 'catppuccin', label: 'Catppuccin', colors: ['#1e1e2e', '#313244', '#cba6f7', '#f5c2e7'] },
    { id: 'default-dark', label: 'Dark', colors: ['#1e1e1e', '#2d2d2d', '#569cd6', '#4ec9b0'] },
    { id: 'default-light', label: 'Light', colors: ['#ffffff', '#f3f3f3', '#0066b8', '#267f99'] },
    { id: 'neutral', label: 'Neutral', colors: ['#e0e0e0', '#d0d0d0', '#444444', '#666666'] },
];

const AI_TONES = [
    { id: 'concise', label: 'Concise', desc: 'Short, direct answers' },
    { id: 'balanced', label: 'Balanced', desc: 'Clear with context' },
    { id: 'detailed', label: 'Detailed', desc: 'Thorough, examples included' },
    { id: 'friendly', label: 'Friendly', desc: 'Casual, warm tone' },
];

const LANGUAGES = ['TypeScript', 'Python', 'JavaScript', 'Java', 'Go', 'Rust', 'C++', 'Swift', 'Other'];
const FRAMEWORKS = ['React', 'Next.js', 'Vue', 'Angular', 'Django', 'Flask', 'Express', 'Spring', 'Other'];

export default function OnboardingDialog({ onComplete, onSkip }: OnboardingDialogProps) {
    const { theme, setTheme } = useTheme();
    const [step, setStep] = useState<WizardStep>('welcome');
    const [direction, setDirection] = useState<'forward' | 'back'>('forward');
    const [animating, setAnimating] = useState(false);
    const [mounted, setMounted] = useState(false);

    // Step 2: Use cases
    const [selectedUseCases, setSelectedUseCases] = useState<string[]>([]);

    // Step 4: Personalize
    const [name, setName] = useState('');
    const [aiTone, setAiTone] = useState('balanced');
    const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
    const [selectedFrameworks, setSelectedFrameworks] = useState<string[]>([]);

    // Step 5: Account
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [accountStatus, setAccountStatus] = useState<'idle' | 'creating' | 'created' | 'error'>('idle');
    const [accountMessage, setAccountMessage] = useState('');
    const [oniId, setOniId] = useState('');

    // Step 6: Connect AI
    const [codexStatus, setCodexStatus] = useState<'idle' | 'waiting' | 'exchanging' | 'connected' | 'error'>('idle');
    const [codexMessage, setCodexMessage] = useState('');
    const [redirectUrl, setRedirectUrl] = useState('');
    const [codexModels, setCodexModels] = useState<string[]>([]);
    const [apiKeyInput, setApiKeyInput] = useState('');
    const [apiKeyMode, setApiKeyMode] = useState(false);

    // Connectivity
    const [apiReachable, setApiReachable] = useState<boolean | null>(null);

    // Mount animation
    useEffect(() => {
        requestAnimationFrame(() => setMounted(true));
    }, []);

    // Check API connectivity
    useEffect(() => {
        fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5000) })
            .then(r => r.json())
            .then(d => setApiReachable(d.status === 'ok'))
            .catch(() => setApiReachable(false));
    }, []);

    /* ── Navigation ── */

    const goTo = useCallback((target: WizardStep) => {
        if (animating) return;
        const currentIdx = STEPS.indexOf(step);
        const targetIdx = STEPS.indexOf(target);
        setDirection(targetIdx > currentIdx ? 'forward' : 'back');
        setAnimating(true);
        setTimeout(() => {
            setStep(target);
            setAnimating(false);
        }, 300);
    }, [step, animating]);

    const next = useCallback(() => {
        const idx = STEPS.indexOf(step);
        if (idx < STEPS.length - 1) goTo(STEPS[idx + 1]);
    }, [step, goTo]);

    const back = useCallback(() => {
        const idx = STEPS.indexOf(step);
        if (idx > 0) goTo(STEPS[idx - 1]);
    }, [step, goTo]);

    /* ── Use case toggle ── */

    const toggleUseCase = useCallback((id: string) => {
        setSelectedUseCases(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    }, []);

    /* ── Chip toggles ── */

    const toggleChip = useCallback((list: string[], setList: React.Dispatch<React.SetStateAction<string[]>>, value: string) => {
        setList(prev => prev.includes(value) ? prev.filter(x => x !== value) : [...prev, value]);
    }, []);

    /* ── Save profile ── */

    const saveProfile = useCallback(async () => {
        // Save use cases
        localStorage.setItem('onicode-use-cases', JSON.stringify(selectedUseCases));

        if (window.onicode) {
            await window.onicode.memorySaveOnboarding({
                name: name.trim() || undefined,
                language: selectedLanguages.join(', ') || undefined,
                framework: selectedFrameworks.join(', ') || undefined,
                codeStyle: aiTone,
                extras: `Use cases: ${selectedUseCases.join(', ')}`,
            });
        }
    }, [name, selectedUseCases, selectedLanguages, selectedFrameworks, aiTone]);

    /* ── Codex OAuth ── */

    const startCodexAuth = useCallback(async () => {
        setCodexStatus('waiting');
        setCodexMessage('Opening browser for sign-in...');
        if (isElectron && window.onicode) {
            const result = await window.onicode.codexOAuthGetAuthUrl();
            if (result.error) {
                setCodexStatus('error');
                setCodexMessage(result.error);
            }
        }
    }, []);

    const exchangeCodexCode = useCallback(async () => {
        const url = redirectUrl.trim();
        if (!url) return;
        setCodexStatus('exchanging');
        setCodexMessage('Exchanging authorization code...');

        if (isElectron && window.onicode) {
            const result = await window.onicode.codexOAuthExchange(url);
            if (result.success && result.accessToken) {
                const providers = JSON.parse(localStorage.getItem('onicode-providers') || '[]');
                const updated = providers.map((p: any) =>
                    p.id === 'codex' ? { ...p, apiKey: result.accessToken, connected: true, enabled: true } : p
                );
                localStorage.setItem('onicode-providers', JSON.stringify(updated));
                localStorage.setItem('onicode-codex-tokens', JSON.stringify({
                    access_token: result.accessToken,
                    refresh_token: result.refreshToken,
                    expires_in: result.expiresIn,
                    obtained_at: Date.now(),
                }));
                setCodexStatus('connected');
                setCodexMessage('Connected to OpenAI!');
                try {
                    const test = await window.onicode.testProvider({ id: 'codex', apiKey: result.accessToken });
                    if (test.success && test.models) setCodexModels(test.models.slice(0, 5));
                } catch {}
            } else {
                setCodexStatus('error');
                setCodexMessage(result.error || 'Failed to exchange code');
            }
        }
    }, [redirectUrl]);

    const saveApiKey = useCallback(() => {
        const key = apiKeyInput.trim();
        if (!key) return;
        const providers = JSON.parse(localStorage.getItem('onicode-providers') || '[]');
        const updated = providers.map((p: any) =>
            p.id === 'codex' ? { ...p, apiKey: key, connected: true, enabled: true } : p
        );
        localStorage.setItem('onicode-providers', JSON.stringify(updated));
        setCodexStatus('connected');
        setCodexMessage('API key saved!');
    }, [apiKeyInput]);

    /* ── Account creation ── */

    const createAccount = useCallback(async () => {
        if (!email.trim() || !password.trim() || !name.trim()) {
            setAccountMessage('Please fill in all fields');
            setAccountStatus('error');
            return;
        }
        if (password.length < 6) {
            setAccountMessage('Password must be at least 6 characters');
            setAccountStatus('error');
            return;
        }
        if (password !== confirmPassword) {
            setAccountMessage('Passwords do not match');
            setAccountStatus('error');
            return;
        }
        setAccountStatus('creating');
        setAccountMessage('Creating your account...');
        try {
            const res = await fetch(`${API_BASE}/api/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: email.trim(),
                    name: name.trim(),
                    password: password.trim(),
                    preferences: {
                        theme,
                        useCases: selectedUseCases,
                        aiTone,
                        languages: selectedLanguages,
                        frameworks: selectedFrameworks,
                    },
                    machineId: `mac_${Date.now()}`,
                }),
            });
            const data = await res.json();
            if (data.success) {
                setAccountStatus('created');
                setOniId(data.user.oniId);
                setAccountMessage(`Account created!`);
                localStorage.setItem('onicode-account', JSON.stringify({
                    token: data.token,
                    oniId: data.user.oniId,
                    email: data.user.email,
                    name: data.user.name,
                }));
            } else {
                setAccountStatus('error');
                setAccountMessage(data.error || 'Registration failed');
            }
        } catch {
            setAccountStatus('error');
            setAccountMessage('Could not connect to server');
        }
    }, [email, password, confirmPassword, name, theme, selectedUseCases, aiTone, selectedLanguages, selectedFrameworks]);

    /* ── Finish ── */

    const finish = useCallback(async () => {
        await saveProfile();
        onComplete();
    }, [saveProfile, onComplete]);

    /* ── Progress ── */

    const stepIdx = STEPS.indexOf(step);
    const showProgress = step !== 'welcome' && step !== 'done';
    const progressSteps = STEPS.slice(1, -1); // usecases, theme, personalize, account, connect
    const progressIdx = progressSteps.indexOf(step);
    const progress = showProgress ? ((progressIdx + 1) / progressSteps.length) * 100 : 0;

    const showCodingPrefs = selectedUseCases.includes('coding');

    return (
        <div className={`ob-overlay ${mounted ? 'ob-mounted' : ''}`}>
            {/* Floating background shapes (welcome only persists, others subtle) */}
            <div className="ob-bg-shapes">
                <div className="ob-shape ob-shape-1" />
                <div className="ob-shape ob-shape-2" />
                <div className="ob-shape ob-shape-3" />
            </div>

            {/* Progress bar */}
            {showProgress && (
                <div className="ob-progress">
                    <div className="ob-progress-fill" style={{ width: `${progress}%` }} />
                </div>
            )}

            <div className={`ob-container ${animating ? `ob-slide-out-${direction}` : 'ob-slide-in'}`}>

                {/* ════ Step 1: Welcome ════ */}
                {step === 'welcome' && (
                    <div className="ob-step ob-welcome">
                        <div className="ob-logo-anim">
                            <div className="ob-logo-glow" />
                            <h1 className="ob-title">Onicode</h1>
                        </div>
                        <p className="ob-tagline">Your AI-powered workspace</p>
                        <p className="ob-desc">Chat, create, build — all in one place</p>
                        <button className="ob-btn-primary ob-btn-lg" onClick={next}>
                            Get Started
                        </button>
                    </div>
                )}

                {/* ════ Step 2: Use Cases ════ */}
                {step === 'usecases' && (
                    <div className="ob-step ob-usecases-step">
                        <h2>What will you use Onicode for?</h2>
                        <p className="ob-step-desc">Pick all that apply — this helps personalize your experience</p>
                        <div className="ob-usecase-grid">
                            {USE_CASES.map(uc => (
                                <button
                                    key={uc.id}
                                    className={`ob-usecase-card ${selectedUseCases.includes(uc.id) ? 'ob-usecase-active' : ''}`}
                                    onClick={() => toggleUseCase(uc.id)}
                                >
                                    <span className="ob-usecase-icon">{uc.icon}</span>
                                    <span className="ob-usecase-label">{uc.label}</span>
                                    <span className="ob-usecase-desc">{uc.desc}</span>
                                    {selectedUseCases.includes(uc.id) && (
                                        <span className="ob-usecase-check">
                                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                                <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                            </svg>
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                        <div className="ob-nav">
                            <button className="ob-btn-back" onClick={back}>Back</button>
                            <button className="ob-btn-primary" onClick={next} disabled={selectedUseCases.length === 0}>
                                Continue
                            </button>
                        </div>
                    </div>
                )}

                {/* ════ Step 3: Theme ════ */}
                {step === 'theme' && (
                    <div className="ob-step ob-theme-step">
                        <h2>Choose your look</h2>
                        <p className="ob-step-desc">Pick a theme — you can change it anytime in Settings.</p>
                        <div className="ob-theme-grid">
                            {THEMES.map(t => (
                                <button
                                    key={t.id}
                                    className={`ob-theme-card ${theme === t.id ? 'ob-theme-active' : ''}`}
                                    onClick={() => setTheme(t.id)}
                                >
                                    <div className="ob-theme-preview">
                                        <div className="ob-theme-bar" style={{ background: t.colors[0] }} />
                                        <div className="ob-theme-bar" style={{ background: t.colors[1] }} />
                                        <div className="ob-theme-accent" style={{ background: t.colors[2] }} />
                                        <div className="ob-theme-accent-2" style={{ background: t.colors[3] }} />
                                    </div>
                                    <span className="ob-theme-label">{t.label}</span>
                                </button>
                            ))}
                        </div>
                        <div className="ob-nav">
                            <button className="ob-btn-back" onClick={back}>Back</button>
                            <button className="ob-btn-primary" onClick={next}>Continue</button>
                        </div>
                    </div>
                )}

                {/* ════ Step 4: Personalize ════ */}
                {step === 'personalize' && (
                    <div className="ob-step ob-personalize-step">
                        <h2>Personalize your experience</h2>
                        <p className="ob-step-desc">Help us tailor Onicode to how you work.</p>

                        <div className="ob-field">
                            <label>What should we call you?</label>
                            <input
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Your name"
                                autoFocus
                            />
                        </div>

                        <label className="ob-label-top">AI Tone</label>
                        <div className="ob-tone-grid">
                            {AI_TONES.map(t => (
                                <button
                                    key={t.id}
                                    className={`ob-tone-card ${aiTone === t.id ? 'ob-tone-active' : ''}`}
                                    onClick={() => setAiTone(t.id)}
                                >
                                    <span className="ob-tone-name">{t.label}</span>
                                    <span className="ob-tone-desc">{t.desc}</span>
                                </button>
                            ))}
                        </div>

                        {showCodingPrefs && (
                            <div className="ob-coding-prefs">
                                <label className="ob-label-top">Languages</label>
                                <div className="ob-chip-row">
                                    {LANGUAGES.map(lang => (
                                        <button
                                            key={lang}
                                            className={`ob-chip ${selectedLanguages.includes(lang) ? 'ob-chip-active' : ''}`}
                                            onClick={() => toggleChip(selectedLanguages, setSelectedLanguages, lang)}
                                        >
                                            {lang}
                                        </button>
                                    ))}
                                </div>

                                <label className="ob-label-top">Frameworks</label>
                                <div className="ob-chip-row">
                                    {FRAMEWORKS.map(fw => (
                                        <button
                                            key={fw}
                                            className={`ob-chip ${selectedFrameworks.includes(fw) ? 'ob-chip-active' : ''}`}
                                            onClick={() => toggleChip(selectedFrameworks, setSelectedFrameworks, fw)}
                                        >
                                            {fw}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="ob-nav">
                            <button className="ob-btn-back" onClick={back}>Back</button>
                            <button className="ob-btn-primary" onClick={next} disabled={!name.trim()}>
                                Continue
                            </button>
                        </div>
                    </div>
                )}

                {/* ════ Step 5: Account (NOT SKIPPABLE) ════ */}
                {step === 'account' && (
                    <div className="ob-step ob-account-step">
                        <h2>Create your Oni account</h2>
                        <p className="ob-step-desc">
                            Required to use Onicode — syncs your settings and unlocks all features
                        </p>

                        {/* Server health indicator */}
                        <div className="ob-server-health">
                            <span className={`ob-health-dot ${apiReachable === true ? 'ob-health-ok' : apiReachable === false ? 'ob-health-down' : 'ob-health-checking'}`} />
                            <span className="ob-health-text">
                                {apiReachable === null ? 'Checking server...' : apiReachable ? 'Server online' : 'Server offline'}
                            </span>
                        </div>

                        {(accountStatus === 'idle' || accountStatus === 'error') && (
                            <>
                                <div className="ob-field">
                                    <label>Email</label>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={e => setEmail(e.target.value)}
                                        placeholder="your@email.com"
                                        autoFocus
                                    />
                                </div>
                                <div className="ob-field">
                                    <label>Password</label>
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        placeholder="At least 6 characters"
                                    />
                                </div>
                                <div className="ob-field">
                                    <label>Confirm Password</label>
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={e => setConfirmPassword(e.target.value)}
                                        placeholder="Confirm your password"
                                    />
                                </div>
                                {accountStatus === 'error' && (
                                    <p className="ob-error-msg">{accountMessage}</p>
                                )}
                                <button
                                    className="ob-btn-primary ob-btn-full"
                                    onClick={createAccount}
                                    disabled={!email.trim() || !password.trim() || !confirmPassword.trim() || !name.trim()}
                                >
                                    Create Account
                                </button>
                                {apiReachable === false && (
                                    <button className="ob-btn-offline" onClick={next}>
                                        Continue offline — account will be created when connected
                                    </button>
                                )}
                            </>
                        )}

                        {accountStatus === 'creating' && (
                            <div className="ob-connect-status">
                                <div className="ob-spinner" />
                                <span>{accountMessage}</span>
                            </div>
                        )}

                        {accountStatus === 'created' && (
                            <div className="ob-account-success">
                                <div className="ob-success-icon">
                                    <svg className="ob-checkmark-svg" viewBox="0 0 52 52">
                                        <circle className="ob-checkmark-circle" cx="26" cy="26" r="24" fill="none" />
                                        <path className="ob-checkmark-path" fill="none" d="M14 27l7 7 16-16" />
                                    </svg>
                                </div>
                                <p className="ob-account-msg"><strong>{accountMessage}</strong></p>
                                <p className="ob-oni-id">Oni ID: {oniId}</p>
                            </div>
                        )}

                        <div className="ob-nav">
                            <button className="ob-btn-back" onClick={back}>Back</button>
                            {accountStatus === 'created' && (
                                <button className="ob-btn-primary" onClick={next}>Continue</button>
                            )}
                        </div>
                    </div>
                )}

                {/* ════ Step 6: Connect AI (skippable) ════ */}
                {step === 'connect' && (
                    <div className="ob-step ob-connect-step">
                        <h2>Connect your AI provider</h2>
                        <p className="ob-step-desc">Sign in with ChatGPT to power your assistant</p>

                        <div className="ob-connect-card">
                            <div className="ob-connect-header">
                                <div className="ob-connect-icon">AI</div>
                                <div>
                                    <strong>OpenAI / ChatGPT</strong>
                                    <p>Uses your ChatGPT Plus or Pro subscription</p>
                                </div>
                                {codexStatus === 'connected' && <span className="ob-badge-ok">Connected</span>}
                            </div>

                            {codexStatus === 'idle' && !apiKeyMode && (
                                <div className="ob-connect-actions">
                                    <button className="ob-btn-connect" onClick={startCodexAuth}>
                                        Sign in with ChatGPT
                                    </button>
                                    <button className="ob-btn-text" onClick={() => setApiKeyMode(true)}>
                                        Or enter an API key
                                    </button>
                                </div>
                            )}

                            {codexStatus === 'idle' && apiKeyMode && (
                                <div className="ob-connect-flow">
                                    <input
                                        type="password"
                                        className="ob-connect-input"
                                        value={apiKeyInput}
                                        onChange={e => setApiKeyInput(e.target.value)}
                                        placeholder="sk-..."
                                    />
                                    <div className="ob-connect-actions">
                                        <button className="ob-btn-primary" onClick={saveApiKey} disabled={!apiKeyInput.trim()}>
                                            Save Key
                                        </button>
                                        <button className="ob-btn-text" onClick={() => setApiKeyMode(false)}>
                                            Use OAuth instead
                                        </button>
                                    </div>
                                </div>
                            )}

                            {codexStatus === 'waiting' && (
                                <div className="ob-connect-flow">
                                    <p className="ob-connect-info">
                                        A browser window opened. Sign in to ChatGPT, then paste the redirect URL below.
                                    </p>
                                    <input
                                        type="text"
                                        className="ob-connect-input"
                                        value={redirectUrl}
                                        onChange={e => setRedirectUrl(e.target.value)}
                                        placeholder="Paste the localhost redirect URL here..."
                                    />
                                    <button className="ob-btn-primary" onClick={exchangeCodexCode} disabled={!redirectUrl.trim()}>
                                        Connect
                                    </button>
                                </div>
                            )}

                            {codexStatus === 'exchanging' && (
                                <div className="ob-connect-status">
                                    <div className="ob-spinner" />
                                    <span>{codexMessage}</span>
                                </div>
                            )}

                            {codexStatus === 'connected' && (
                                <div className="ob-connect-success">
                                    <span className="ob-check">&#10003;</span>
                                    <span>{codexMessage}</span>
                                    {codexModels.length > 0 && (
                                        <p className="ob-models">Models: {codexModels.join(', ')}</p>
                                    )}
                                </div>
                            )}

                            {codexStatus === 'error' && (
                                <div className="ob-connect-error">
                                    <span>{codexMessage}</span>
                                    <button className="ob-btn-text" onClick={() => { setCodexStatus('idle'); setRedirectUrl(''); }}>
                                        Try again
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="ob-nav">
                            <button className="ob-btn-back" onClick={back}>Back</button>
                            <button className="ob-btn-primary" onClick={next}>
                                {codexStatus === 'connected' ? 'Continue' : 'Skip for now'}
                            </button>
                        </div>
                    </div>
                )}

                {/* ════ Step 7: All Set! ════ */}
                {step === 'done' && (
                    <div className="ob-step ob-done-step">
                        {/* Confetti particles */}
                        <div className="ob-done-celebration">
                            {Array.from({ length: 20 }).map((_, i) => (
                                <div
                                    key={i}
                                    className={`ob-confetti ob-confetti-${i % 5}`}
                                    style={{
                                        left: `${5 + Math.random() * 90}%`,
                                        animationDelay: `${Math.random() * 0.8}s`,
                                        animationDuration: `${1.5 + Math.random() * 1.5}s`,
                                    }}
                                />
                            ))}
                        </div>

                        {/* Animated checkmark */}
                        <div className="ob-done-checkmark">
                            <svg className="ob-checkmark-svg ob-checkmark-lg" viewBox="0 0 52 52">
                                <circle className="ob-checkmark-circle" cx="26" cy="26" r="24" fill="none" />
                                <path className="ob-checkmark-path" fill="none" d="M14 27l7 7 16-16" />
                            </svg>
                        </div>

                        <h2 className="ob-done-title">Welcome, {name || 'friend'}!</h2>

                        <div className="ob-summary">
                            <div className="ob-summary-row">
                                <span className="ob-summary-label">Theme</span>
                                <span className="ob-summary-value">{THEMES.find(t => t.id === theme)?.label || theme}</span>
                            </div>
                            <div className="ob-summary-row">
                                <span className="ob-summary-label">Use Cases</span>
                                <span className="ob-summary-value">
                                    {selectedUseCases.map(id => USE_CASES.find(u => u.id === id)?.label).join(', ') || 'None'}
                                </span>
                            </div>
                            <div className="ob-summary-row">
                                <span className="ob-summary-label">AI Tone</span>
                                <span className="ob-summary-value">{AI_TONES.find(t => t.id === aiTone)?.label || aiTone}</span>
                            </div>
                            {selectedLanguages.length > 0 && (
                                <div className="ob-summary-row">
                                    <span className="ob-summary-label">Languages</span>
                                    <span className="ob-summary-value">{selectedLanguages.join(', ')}</span>
                                </div>
                            )}
                            <div className="ob-summary-row">
                                <span className="ob-summary-label">AI Provider</span>
                                <span className="ob-summary-value">
                                    {codexStatus === 'connected' ? 'OpenAI (Connected)' : 'Not connected yet'}
                                </span>
                            </div>
                            {oniId && (
                                <div className="ob-summary-row">
                                    <span className="ob-summary-label">Oni ID</span>
                                    <span className="ob-summary-value ob-mono">{oniId}</span>
                                </div>
                            )}
                        </div>

                        <button className="ob-btn-primary ob-btn-full ob-btn-lg" onClick={finish}>
                            Start using Onicode
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
