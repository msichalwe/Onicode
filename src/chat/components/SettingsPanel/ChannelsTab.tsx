import React, { useState, useEffect, useCallback } from 'react';
import { isElectron } from '../../utils';

export default function ChannelsTab() {
    const [tgConnected, setTgConnected] = useState(false);
    const [tgBotInfo, setTgBotInfo] = useState<TelegramBotInfo | null>(null);
    const [tgToken, setTgToken] = useState('');
    const [tgValidating, setTgValidating] = useState(false);
    const [tgValidated, setTgValidated] = useState<TelegramBotInfo | null>(null);
    const [tgConnecting, setTgConnecting] = useState(false);
    const [tgError, setTgError] = useState('');
    const [tgStats, setTgStats] = useState<{ activeChats: number; sessions: Array<{ chatId: number; userName: string; messageCount: number; sessionId: string }>; polling: boolean } | null>(null);
    const [tgAllowedInput, setTgAllowedInput] = useState('');
    const [showLog, setShowLog] = useState(false);
    const [recentMessages, setRecentMessages] = useState<Array<{ direction: string; from?: string; text: string; timestamp: number }>>([]);

    const loadStatus = useCallback(async () => {
        if (!isElectron) return;
        try {
            const res = await window.onicode!.channelsList();
            const tg = res.channels.find(c => c.id === 'telegram');
            if (tg) {
                setTgConnected(tg.connected);
                setTgBotInfo(tg.botInfo);
            }
        } catch {}
    }, []);

    const loadStats = useCallback(async () => {
        if (!isElectron || !tgConnected) return;
        try {
            const stats = await window.onicode!.channelTelegramStats();
            setTgStats({ activeChats: stats.activeChats, sessions: (stats as Record<string, unknown>).sessions as typeof tgStats extends null ? never : NonNullable<typeof tgStats>['sessions'] || [], polling: stats.polling });
        } catch {}
    }, [tgConnected]);

    useEffect(() => { loadStatus(); }, [loadStatus]);
    useEffect(() => { if (tgConnected) { loadStats(); const iv = setInterval(loadStats, 15000); return () => clearInterval(iv); } }, [tgConnected, loadStats]);

    useEffect(() => {
        if (!isElectron) return;
        const cleanupStatus = window.onicode!.onChannelStatus((data) => {
            if (data.channel === 'telegram') {
                setTgConnected(data.status === 'connected');
                if (data.botInfo) setTgBotInfo(data.botInfo);
                if (data.error) setTgError(data.error);
            }
        });
        const cleanupMsg = window.onicode!.onChannelMessage((data) => {
            if (data.channel === 'telegram') {
                setRecentMessages(prev => [...prev.slice(-49), data]);
            }
        });
        return () => { cleanupStatus(); cleanupMsg(); };
    }, []);

    const handleValidate = async () => {
        if (!tgToken.trim()) return;
        setTgValidating(true); setTgError(''); setTgValidated(null);
        try {
            const res = await window.onicode!.channelTelegramValidate(tgToken.trim());
            if (res.success && res.botInfo) setTgValidated(res.botInfo);
            else setTgError(res.error || 'Validation failed');
        } catch (err: unknown) { setTgError(err instanceof Error ? err.message : 'Failed'); }
        setTgValidating(false);
    };

    const handleConnect = async () => {
        setTgConnecting(true); setTgError('');
        try {
            const allowedIds = tgAllowedInput.trim() ? tgAllowedInput.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) : [];
            const res = await window.onicode!.channelTelegramConnect(tgToken.trim(), allowedIds);
            if (res.success && res.botInfo) { setTgConnected(true); setTgBotInfo(res.botInfo); setTgToken(''); setTgValidated(null); }
            else setTgError(res.error || 'Connection failed');
        } catch (err: unknown) { setTgError(err instanceof Error ? err.message : 'Failed'); }
        setTgConnecting(false);
    };

    const handleDisconnect = async () => {
        try { await window.onicode!.channelTelegramDisconnect(); setTgConnected(false); setTgBotInfo(null); setTgStats(null); setRecentMessages([]); } catch {}
    };

    return (
        <div className="settings-tab-content">
            <div className="settings-section">
                <h3>Communication Channels</h3>
                <p className="settings-section-desc">Control Onicode from external messaging platforms. Full AI access, slash commands, and tool execution — all remotely.</p>
            </div>

            {/* ── Telegram ── */}
            <div className="settings-section">
                <div className="ch-header">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" fill="var(--accent)"/>
                    </svg>
                    <div className="ch-header-text">
                        <span className="ch-header-name">Telegram</span>
                        {tgConnected && tgBotInfo ? (
                            <span className="ch-header-status connected">@{tgBotInfo.username}</span>
                        ) : (
                            <span className="ch-header-status">Not connected</span>
                        )}
                    </div>
                    {tgConnected && (
                        <button className="ch-disconnect-btn" onClick={handleDisconnect}>Disconnect</button>
                    )}
                </div>

                {tgConnected ? (
                    <>
                        {/* Connected info */}
                        <div className="ch-connected-info">
                            <div className="ch-info-row">
                                <span className="ch-info-label">Bot</span>
                                <span className="ch-info-value">@{tgBotInfo?.username} ({tgBotInfo?.firstName})</span>
                            </div>
                            <div className="ch-info-row">
                                <span className="ch-info-label">Status</span>
                                <span className="ch-info-value ch-status-live"><span className="ch-pulse" />Polling for messages</span>
                            </div>
                            <div className="ch-info-row">
                                <span className="ch-info-label">Active chats</span>
                                <span className="ch-info-value">{tgStats?.activeChats || 0}</span>
                            </div>
                            {tgStats?.sessions && tgStats.sessions.length > 0 && (
                                <div className="ch-info-row" style={{ alignItems: 'flex-start' }}>
                                    <span className="ch-info-label">Sessions</span>
                                    <div className="ch-info-value" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                        {tgStats.sessions.map(s => (
                                            <span key={s.chatId} style={{ fontSize: 11 }}>
                                                {s.userName} — {s.messageCount} msgs
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Available commands */}
                        <div className="ch-commands">
                            <div className="ch-commands-title">Available Commands</div>
                            <div className="ch-commands-grid">
                                {[
                                    { cmd: '/new', desc: 'New conversation' },
                                    { cmd: '/clear', desc: 'Clear history' },
                                    { cmd: '/status', desc: 'Bot & model info' },
                                    { cmd: '/model', desc: 'Current model' },
                                    { cmd: '/help', desc: 'All commands' },
                                    { cmd: '/run', desc: 'Shell command' },
                                    { cmd: '/context', desc: 'Project context' },
                                    { cmd: '/tasks', desc: 'Task list' },
                                    { cmd: '/files', desc: 'File viewer' },
                                    { cmd: '/terminal', desc: 'Terminal' },
                                    { cmd: '/browser', desc: 'Browser' },
                                    { cmd: '/start', desc: 'Welcome' },
                                ].map(c => (
                                    <div key={c.cmd} className="ch-cmd-item">
                                        <code>{c.cmd}</code>
                                        <span>{c.desc}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Message log (collapsible) */}
                        {recentMessages.length > 0 && (
                            <details className="hook-reference" open={showLog} onToggle={e => setShowLog((e.target as HTMLDetailsElement).open)}>
                                <summary className="hook-reference-title">Message Log ({recentMessages.length})</summary>
                                <div className="ch-messages">
                                    {recentMessages.slice(-15).map((msg, i) => (
                                        <div key={i} className={`ch-msg ${msg.direction}`}>
                                            <span className="ch-msg-dir">{msg.direction === 'incoming' ? msg.from || 'User' : 'Oni'}</span>
                                            <span className="ch-msg-text">{msg.text}</span>
                                            <span className="ch-msg-time">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                                        </div>
                                    ))}
                                </div>
                            </details>
                        )}
                    </>
                ) : (
                    <>
                        {/* Setup flow */}
                        <div className="ch-setup">
                            <div className="ch-setup-steps">
                                <div className="ch-step">
                                    <span className="ch-step-num">1</span>
                                    <div className="ch-step-text">Open Telegram and message <code>@BotFather</code></div>
                                </div>
                                <div className="ch-step">
                                    <span className="ch-step-num">2</span>
                                    <div className="ch-step-text">Send <code>/newbot</code> and follow the prompts</div>
                                </div>
                                <div className="ch-step">
                                    <span className="ch-step-num">3</span>
                                    <div className="ch-step-text">Copy the bot token and paste it below</div>
                                </div>
                            </div>

                            <div className="ch-token-form">
                                <label>Bot Token</label>
                                <div className="ch-token-row">
                                    <input type="password" placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz" value={tgToken}
                                        onChange={e => { setTgToken(e.target.value); setTgValidated(null); setTgError(''); }}
                                        onKeyDown={e => e.key === 'Enter' && handleValidate()} />
                                    <button className="ch-validate-btn" onClick={handleValidate} disabled={!tgToken.trim() || tgValidating}>
                                        {tgValidating ? 'Checking...' : 'Validate'}
                                    </button>
                                </div>

                                {tgValidated && (
                                    <div className="ch-validated">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                                        <span>Bot found: <strong>@{tgValidated.username}</strong> ({tgValidated.firstName})</span>
                                    </div>
                                )}
                                {tgError && <div className="ch-error">{tgError}</div>}

                                {tgValidated && (
                                    <>
                                        <label style={{ marginTop: 8 }}>Allowed Chat IDs (optional)</label>
                                        <input type="text" placeholder="Leave empty to allow all chats" value={tgAllowedInput} onChange={e => setTgAllowedInput(e.target.value)} />
                                        <p className="settings-section-desc" style={{ margin: '4px 0 8px' }}>
                                            Restrict access. Get your ID by messaging <code>@userinfobot</code> on Telegram.
                                        </p>
                                        <button className="ch-connect-btn" onClick={handleConnect} disabled={tgConnecting}>
                                            {tgConnecting ? 'Connecting...' : 'Connect & Start Polling'}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* ── Coming soon ── */}
            <div className="settings-section">
                <h3>Coming Soon</h3>
                <div className="ch-coming-soon">
                    {[
                        { name: 'Discord', desc: 'Chat in Discord servers and DMs' },
                        { name: 'Slack', desc: 'Integrate into your Slack workspace' },
                        { name: 'WhatsApp', desc: 'WhatsApp Business API' },
                        { name: 'Matrix', desc: 'Self-hosted via Matrix/Element' },
                    ].map(ch => (
                        <div key={ch.name} className="ch-future-item">
                            <span className="ch-future-name">{ch.name}</span>
                            <span className="ch-future-desc">{ch.desc}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
