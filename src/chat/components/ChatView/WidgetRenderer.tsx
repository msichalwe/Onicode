import React, { useState, useEffect, useCallback } from 'react';
import type {
    ChatWidget, WeatherData, SystemStatsData, QuickActionsData,
    TimerData, ProgressData, GitCardData, PollData, ChecklistData,
    LinkPreviewData, ChartData, ImageGalleryData, ContactCardData,
    CalendarEventData, CodeRunData, FileCardData,
    MermaidData, FlowchartData, TimelineData, KanbanData,
    MindmapData, DashboardData, SVGChartData,
} from './types';
import {
    SimulationWidget, InteractiveGraphWidget, DataTableWidget,
    ComparisonWidget, PricingWidget, AccordionWidget, TabsWidget,
    SlidesWidget, RatingWidget, CountdownWidget, ColorPaletteWidget,
    FloorPlanWidget, EquationWidget, VideoWidget, DocumentWidget,
} from './InteractiveWidgets';

interface WidgetRendererProps {
    widget: ChatWidget;
    onAction?: (command: string) => void;
    onUpdate?: (widgetId: string, data: Record<string, unknown>) => void;
}

export default function WidgetRenderer({ widget, onAction, onUpdate }: WidgetRendererProps) {
    // Debug: log what we received
    if (typeof console !== 'undefined') {
        console.log('[Widget]', widget.type, JSON.stringify(widget.data).slice(0, 300));
    }
    switch (widget.type) {
        case 'weather': return <WeatherWidget data={widget.data as unknown as WeatherData} />;
        case 'system-stats': return <SystemStatsWidget data={widget.data as unknown as SystemStatsData} />;
        case 'quick-actions': return <QuickActionsWidget data={widget.data as unknown as QuickActionsData} onAction={onAction} />;
        case 'timer': return <TimerWidget data={widget.data as unknown as TimerData} />;
        case 'progress': return <ProgressWidget data={widget.data as unknown as ProgressData} />;
        case 'git-card': return <GitCardWidget data={widget.data as unknown as GitCardData} />;
        case 'poll': return <PollWidget data={widget.data as unknown as PollData} id={widget.id} onUpdate={onUpdate} />;
        case 'checklist': return <ChecklistWidget data={widget.data as unknown as ChecklistData} id={widget.id} onUpdate={onUpdate} />;
        case 'link-preview': return <LinkPreviewWidget data={widget.data as unknown as LinkPreviewData} />;
        case 'chart': return <ChartWidget data={widget.data as unknown as ChartData} />;
        case 'image-gallery': return <ImageGalleryWidget data={widget.data as unknown as ImageGalleryData} />;
        case 'contact-card': return <ContactCardWidget data={widget.data as unknown as ContactCardData} />;
        case 'calendar-event': return <CalendarEventWidget data={widget.data as unknown as CalendarEventData} />;
        case 'code-run': return <CodeRunWidget data={widget.data as unknown as CodeRunData} />;
        case 'file-card': return <FileCardWidget data={widget.data as unknown as FileCardData} />;
        case 'mermaid': return <MermaidWidget data={widget.data as unknown as MermaidData} />;
        case 'flowchart': return <FlowchartWidget data={widget.data as unknown as FlowchartData} />;
        case 'timeline': return <TimelineWidget data={widget.data as unknown as TimelineData} />;
        case 'kanban': return <KanbanWidget data={widget.data as unknown as KanbanData} />;
        case 'mindmap': return <MindmapWidget data={widget.data as unknown as MindmapData} />;
        case 'dashboard': return <DashboardWidget data={widget.data as unknown as DashboardData} onAction={onAction} />;
        case 'svg-chart': return <SVGChartWidget data={widget.data as unknown as SVGChartData} />;
        case 'simulation': return <SimulationWidget data={widget.data} />;
        case 'interactive-graph': return <InteractiveGraphWidget data={widget.data} />;
        case 'data-table': return <DataTableWidget data={widget.data} />;
        case 'comparison': return <ComparisonWidget data={widget.data} />;
        case 'pricing': return <PricingWidget data={widget.data} />;
        case 'accordion': return <AccordionWidget data={widget.data} />;
        case 'tabs': return <TabsWidget data={widget.data} />;
        case 'slides': return <SlidesWidget data={widget.data} />;
        case 'rating': return <RatingWidget data={widget.data} />;
        case 'countdown': return <CountdownWidget data={widget.data} />;
        case 'color-palette': return <ColorPaletteWidget data={widget.data} />;
        case 'floor-plan': return <FloorPlanWidget data={widget.data} />;
        case 'equation': return <EquationWidget data={widget.data} />;
        case 'video': return <VideoWidget data={widget.data} />;
        case 'document': return <DocumentWidget data={widget.data} />;
        default: return null;
    }
}

// ══════════════════════════════════════════
//  Weather
// ══════════════════════════════════════════

function WeatherWidget({ data: raw }: { data: WeatherData }) {
    // Flexible field mapping — AI may use different field names
    const d = raw as unknown as Record<string, unknown>;
    const location = String(d.location || d.city || d.place || d.name || 'Unknown');
    const temp = Number(d.temp ?? d.temperature ?? d.temp_c ?? d.temp_f ?? 0);
    const unit = String(d.unit || (d.temp_f ? 'F' : 'C'));
    const condition = String(d.condition || d.conditions || d.description || d.weather || d.text || '');
    const icon = String(d.icon || d.emoji || '🌤');
    const humidity = d.humidity != null ? Number(d.humidity) : undefined;
    const wind = d.wind ? String(d.wind) : (d.wind_speed ? `${d.wind_speed} km/h` : undefined);
    const forecast = Array.isArray(d.forecast) ? d.forecast : undefined;
    const feelsLike = d.feels_like ?? d.feelsLike ?? d.feelslike;

    return (
        <div className="cw cw-weather">
            <div className="cw-weather-main">
                <span className="cw-weather-icon">{icon}</span>
                <div className="cw-weather-temp">
                    <span className="cw-weather-deg">{temp}°{unit}</span>
                    <span className="cw-weather-cond">{condition}</span>
                </div>
                <span className="cw-weather-loc">{location}</span>
            </div>
            {(humidity != null || wind || feelsLike != null) && (
                <div className="cw-weather-detail">
                    {feelsLike != null && <span>🌡 Feels {Number(feelsLike)}°</span>}
                    {humidity != null && <span>💧 {humidity}%</span>}
                    {wind && <span>💨 {wind}</span>}
                </div>
            )}
            {forecast && forecast.length > 0 && (
                <div className="cw-weather-forecast">
                    {forecast.map((f: Record<string, unknown>, i: number) => (
                        <div key={i} className="cw-weather-fday">
                            <span>{String(f.day || f.date || '')}</span>
                            <span>{String(f.icon || f.emoji || '🌤')}</span>
                            <span>{Number(f.temp ?? f.temperature ?? 0)}°</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ══════════════════════════════════════════
//  System Stats
// ══════════════════════════════════════════

function GaugeBar({ value, label, detail }: { value: number; label: string; detail: string }) {
    const color = value > 90 ? 'var(--error)' : value > 70 ? 'var(--warning, #f0ad4e)' : 'var(--success)';
    return (
        <div className="cw-gauge">
            <div className="cw-gauge-header">
                <span>{label}</span>
                <span>{detail}</span>
            </div>
            <div className="cw-gauge-track">
                <div className="cw-gauge-fill" style={{ width: `${Math.min(value, 100)}%`, background: color }} />
            </div>
        </div>
    );
}

function SystemStatsWidget({ data: raw }: { data: SystemStatsData }) {
    const d = raw as unknown as Record<string, unknown>;
    const data = {
        cpu: Number(d.cpu ?? d.cpu_percent ?? d.cpuUsage ?? 0),
        memory: (d.memory && typeof d.memory === 'object') ? d.memory as { used: number; total: number } : { used: Number(d.memory_used ?? d.memUsed ?? 0), total: Number(d.memory_total ?? d.memTotal ?? 1) },
        disk: (d.disk && typeof d.disk === 'object') ? d.disk as { used: number; total: number } : { used: Number(d.disk_used ?? d.diskUsed ?? 0), total: Number(d.disk_total ?? d.diskTotal ?? 1) },
        uptime: d.uptime ? String(d.uptime) : undefined,
    };
    const memPct = data.memory.total ? Math.round((data.memory.used / data.memory.total) * 100) : 0;
    const diskPct = data.disk.total ? Math.round((data.disk.used / data.disk.total) * 100) : 0;
    const fmtGB = (b: number) => b > 1024 ** 3 ? (b / (1024 ** 3)).toFixed(1) + ' GB' : b > 1024 ** 2 ? (b / (1024 ** 2)).toFixed(0) + ' MB' : b.toFixed(0) + ' B';
    return (
        <div className="cw cw-stats">
            <div className="cw-stats-title">System Monitor {data.uptime && <span className="cw-stats-uptime">up {data.uptime}</span>}</div>
            <GaugeBar value={data.cpu} label="CPU" detail={`${data.cpu}%`} />
            <GaugeBar value={memPct} label="Memory" detail={`${fmtGB(data.memory.used)} / ${fmtGB(data.memory.total)}`} />
            <GaugeBar value={diskPct} label="Disk" detail={`${fmtGB(data.disk.used)} / ${fmtGB(data.disk.total)}`} />
        </div>
    );
}

// ══════════════════════════════════════════
//  Quick Actions
// ══════════════════════════════════════════

function QuickActionsWidget({ data: raw, onAction }: { data: QuickActionsData; onAction?: (cmd: string) => void }) {
    const d = raw as unknown as Record<string, unknown>;
    const title = String(d.title || '');
    const actions = (Array.isArray(d.actions) ? d.actions : []) as Array<Record<string, unknown>>;
    if (actions.length === 0) return null;
    return (
        <div className="cw cw-actions">
            {title && <div className="cw-actions-title">{title}</div>}
            <div className="cw-actions-grid">
                {actions.map((a, i) => (
                    <button key={i} className="cw-action-btn" onClick={() => onAction?.(String(a.command || a.action || a.label || ''))} title={String(a.command || '')}>
                        {a.icon ? <span className="cw-action-icon">{String(a.icon)}</span> : null}
                        <span>{String(a.label || a.name || a.text || '')}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  Timer
// ══════════════════════════════════════════

function TimerWidget({ data: raw }: { data: TimerData }) {
    const d = raw as unknown as Record<string, unknown>;
    const label = String(d.label || d.message || d.title || 'Timer');
    const duration = Number(d.duration || d.seconds || d.timeout || 60);
    // AI may send endsAt, or we compute from duration
    const endsAt = Number(d.endsAt || d.ends_at || (Date.now() + duration * 1000));

    const [remaining, setRemaining] = useState(() => Math.max(0, Math.floor((endsAt - Date.now()) / 1000)));

    useEffect(() => {
        if (remaining <= 0) return;
        const iv = setInterval(() => {
            const left = Math.max(0, Math.floor((endsAt - Date.now()) / 1000));
            setRemaining(left);
            if (left <= 0) clearInterval(iv);
        }, 1000);
        return () => clearInterval(iv);
    }, [endsAt, remaining]);

    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const pct = duration > 0 ? Math.max(0, (remaining / duration) * 100) : 0;
    const done = remaining <= 0;

    return (
        <div className={`cw cw-timer ${done ? 'cw-timer-done' : ''}`}>
            <div className="cw-timer-label">{done ? '✅' : '⏱'} {label}</div>
            <div className="cw-timer-time">{done ? 'Done!' : `${mins}:${secs.toString().padStart(2, '0')}`}</div>
            <div className="cw-timer-bar">
                <div className="cw-timer-fill" style={{ width: `${100 - pct}%` }} />
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  Progress
// ══════════════════════════════════════════

function ProgressWidget({ data: raw }: { data: ProgressData }) {
    const d = raw as unknown as Record<string, unknown>;
    const label = String(d.label || d.title || d.name || 'Progress');
    const current = Number(d.current ?? d.value ?? d.done ?? 0);
    const total = Number(d.total ?? d.max ?? d.count ?? 100);
    const unit = String(d.unit || '');
    const items = Array.isArray(d.items) ? d.items as Array<Record<string, unknown>> : undefined;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    return (
        <div className="cw cw-progress">
            <div className="cw-progress-header">
                <span>{label}</span>
                <span>{current}/{total} {unit} ({pct}%)</span>
            </div>
            <div className="cw-gauge-track">
                <div className="cw-gauge-fill" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
            </div>
            {items && (
                <div className="cw-progress-items">
                    {items.map((item, i) => (
                        <div key={i} className={`cw-progress-item ${item.done ? 'done' : ''}`}>
                            <span>{item.done ? '✓' : '○'}</span>
                            <span>{String(item.label || item.name || item.text || '')}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ══════════════════════════════════════════
//  Git Card
// ══════════════════════════════════════════

function GitCardWidget({ data: raw }: { data: GitCardData }) {
    const d = raw as unknown as Record<string, unknown>;
    const branch = String(d.branch || d.current_branch || d.head || 'unknown');
    const status = String(d.status || d.state || 'clean');
    const ahead = d.ahead != null ? Number(d.ahead) : undefined;
    const behind = d.behind != null ? Number(d.behind) : undefined;
    const changed = d.changed ?? d.modifications ?? d.modified ?? d.changes;
    const commits = Array.isArray(d.recentCommits || d.recent_commits || d.commits) ? (d.recentCommits || d.recent_commits || d.commits) as Array<Record<string, unknown>> : [];
    return (
        <div className="cw cw-git">
            <div className="cw-git-header">
                <span className="cw-git-branch">⑂ {branch}</span>
                <span className="cw-git-status">{status}</span>
            </div>
            <div className="cw-git-detail">
                {ahead != null && <span className="cw-git-ahead">↑{ahead}</span>}
                {behind != null && <span className="cw-git-behind">↓{behind}</span>}
                {changed != null && <span className="cw-git-changed">~{Number(changed)}</span>}
            </div>
            {commits.length > 0 && (
                <div className="cw-git-commits">
                    {commits.slice(0, 5).map((c, i) => (
                        <div key={i} className="cw-git-commit">
                            <code>{String(c.hash || c.sha || c.id || '').slice(0, 7)}</code>
                            <span>{String(c.message || c.subject || c.title || '')}</span>
                            <span className="cw-git-time">{String(c.time || c.date || c.ago || '')}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ══════════════════════════════════════════
//  Poll
// ══════════════════════════════════════════

function PollWidget({ data: raw, id, onUpdate }: { data: PollData; id: string; onUpdate?: (id: string, d: Record<string, unknown>) => void }) {
    const d = raw as unknown as Record<string, unknown>;
    const data = {
        question: String(d.question || d.title || d.prompt || 'Poll'),
        options: (Array.isArray(d.options) ? d.options : Array.isArray(d.choices) ? d.choices : []).map((o: unknown) => {
            if (typeof o === 'string') return { label: o, votes: 0 };
            const obj = o as Record<string, unknown>;
            return { label: String(obj.label || obj.text || obj.name || ''), votes: Number(obj.votes ?? obj.count ?? 0) };
        }),
        voted: d.voted != null ? Number(d.voted) : undefined,
    };
    const [voted, setVoted] = useState(data.voted);
    const totalVotes = data.options.reduce((s, o) => s + o.votes, 0);

    const handleVote = (idx: number) => {
        if (voted != null) return;
        setVoted(idx);
        const updated = { ...data, voted: idx, options: data.options.map((o, i) => i === idx ? { ...o, votes: o.votes + 1 } : o) };
        onUpdate?.(id, updated as unknown as Record<string, unknown>);
    };

    return (
        <div className="cw cw-poll">
            <div className="cw-poll-question">{data.question}</div>
            {data.options.map((opt, i) => {
                const pct = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
                return (
                    <button key={i} className={`cw-poll-option ${voted === i ? 'selected' : ''} ${voted != null ? 'revealed' : ''}`} onClick={() => handleVote(i)} disabled={voted != null}>
                        <div className="cw-poll-bar" style={{ width: voted != null ? `${pct}%` : '0%' }} />
                        <span className="cw-poll-label">{opt.label}</span>
                        {voted != null && <span className="cw-poll-pct">{pct}%</span>}
                    </button>
                );
            })}
            {voted != null && <div className="cw-poll-total">{totalVotes + 1} votes</div>}
        </div>
    );
}

// ══════════════════════════════════════════
//  Checklist
// ══════════════════════════════════════════

function ChecklistWidget({ data: raw, id, onUpdate }: { data: ChecklistData; id: string; onUpdate?: (id: string, d: Record<string, unknown>) => void }) {
    const dd = raw as unknown as Record<string, unknown>;
    const data = {
        title: String(dd.title || dd.name || 'Checklist'),
        items: (Array.isArray(dd.items) ? dd.items : []).map((it: unknown, i: number) => {
            if (typeof it === 'string') return { id: `i${i}`, label: it, done: false };
            const obj = it as Record<string, unknown>;
            return { id: String(obj.id || `i${i}`), label: String(obj.label || obj.text || obj.name || ''), done: !!obj.done };
        }),
    };
    const [items, setItems] = useState(data.items);

    const toggle = useCallback((itemId: string) => {
        setItems(prev => {
            const updated = prev.map(it => it.id === itemId ? { ...it, done: !it.done } : it);
            onUpdate?.(id, { ...data, items: updated } as unknown as Record<string, unknown>);
            return updated;
        });
    }, [id, data, onUpdate]);

    const doneCount = items.filter(i => i.done).length;

    return (
        <div className="cw cw-checklist">
            <div className="cw-checklist-header">
                <span>{data.title}</span>
                <span className="cw-checklist-count">{doneCount}/{items.length}</span>
            </div>
            {items.map(item => (
                <label key={item.id} className={`cw-checklist-item ${item.done ? 'done' : ''}`}>
                    <input type="checkbox" checked={item.done} onChange={() => toggle(item.id)} />
                    <span>{item.label}</span>
                </label>
            ))}
        </div>
    );
}

// ══════════════════════════════════════════
//  Link Preview
// ══════════════════════════════════════════

function LinkPreviewWidget({ data }: { data: LinkPreviewData }) {
    return (
        <a className="cw cw-link" href={data.url} target="_blank" rel="noopener noreferrer">
            {data.image && <div className="cw-link-img" style={{ backgroundImage: `url(${data.image})` }} />}
            <div className="cw-link-body">
                <div className="cw-link-title">{data.title}</div>
                {data.description && <div className="cw-link-desc">{data.description}</div>}
                <div className="cw-link-domain">{data.domain}</div>
            </div>
        </a>
    );
}

// ══════════════════════════════════════════
//  Chart (CSS-only bar/pie)
// ══════════════════════════════════════════

function ChartWidget({ data: raw }: { data: ChartData }) {
    const d = raw as unknown as Record<string, unknown>;
    const data = {
        title: String(d.title || d.name || ''),
        type: String(d.type || 'bar') as 'bar' | 'line' | 'pie',
        labels: (Array.isArray(d.labels) ? d.labels : Array.isArray(d.categories) ? d.categories : []).map(String),
        values: (Array.isArray(d.values) ? d.values : Array.isArray(d.data) ? d.data : []).map(Number),
        color: d.color ? String(d.color) : undefined,
    };
    if (data.values.length === 0) return null;
    const max = Math.max(...data.values, 1);
    const total = data.values.reduce((s, v) => s + v, 0);
    const colors = ['var(--accent)', 'var(--success)', 'var(--warning, #f0ad4e)', 'var(--error)', '#9b59b6', '#1abc9c', '#e67e22', '#3498db'];

    if (data.type === 'pie') {
        let cumPct = 0;
        const segments = data.values.map((v, i) => {
            const pct = total > 0 ? (v / total) * 100 : 0;
            const start = cumPct;
            cumPct += pct;
            return { pct, start, color: colors[i % colors.length], label: data.labels[i] || '' };
        });
        const gradient = segments.map(s => `${s.color} ${s.start}% ${s.start + s.pct}%`).join(', ');
        return (
            <div className="cw cw-chart">
                <div className="cw-chart-title">{data.title}</div>
                <div className="cw-pie" style={{ background: `conic-gradient(${gradient})` }} />
                <div className="cw-chart-legend">
                    {segments.map((s, i) => (
                        <span key={i} className="cw-legend-item"><span className="cw-legend-dot" style={{ background: s.color }} />{s.label} ({Math.round(s.pct)}%)</span>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="cw cw-chart">
            <div className="cw-chart-title">{data.title}</div>
            <div className="cw-bars">
                {data.values.map((v, i) => (
                    <div key={i} className="cw-bar-col">
                        <div className="cw-bar" style={{ height: `${(v / max) * 100}%`, background: data.color || colors[i % colors.length] }} />
                        <span className="cw-bar-label">{data.labels[i] || ''}</span>
                        <span className="cw-bar-value">{v}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  Image Gallery
// ══════════════════════════════════════════

function ImageGalleryWidget({ data }: { data: ImageGalleryData }) {
    const [selected, setSelected] = useState(0);
    return (
        <div className="cw cw-gallery">
            <div className="cw-gallery-main">
                <img src={data.images[selected]?.src} alt={data.images[selected]?.alt || ''} />
            </div>
            {data.images.length > 1 && (
                <div className="cw-gallery-thumbs">
                    {data.images.map((img, i) => (
                        <img key={i} src={img.src} alt={img.alt || ''} className={i === selected ? 'active' : ''} onClick={() => setSelected(i)} />
                    ))}
                </div>
            )}
        </div>
    );
}

// ══════════════════════════════════════════
//  Contact Card
// ══════════════════════════════════════════

function ContactCardWidget({ data: raw }: { data: ContactCardData }) {
    const d = raw as unknown as Record<string, unknown>;
    const data = {
        name: String(d.name || d.full_name || d.displayName || 'Unknown'),
        role: d.role ? String(d.role) : d.title ? String(d.title) : d.position ? String(d.position) : undefined,
        email: d.email ? String(d.email) : undefined,
        phone: d.phone ? String(d.phone) : d.mobile ? String(d.mobile) : undefined,
        avatar: d.avatar ? String(d.avatar) : d.image ? String(d.image) : undefined,
    };
    return (
        <div className="cw cw-contact">
            <div className="cw-contact-avatar">{data.avatar ? <img src={data.avatar} alt="" /> : <span>{data.name.charAt(0)}</span>}</div>
            <div className="cw-contact-info">
                <div className="cw-contact-name">{data.name}</div>
                {data.role && <div className="cw-contact-role">{data.role}</div>}
                {data.email && <div className="cw-contact-detail">{data.email}</div>}
                {data.phone && <div className="cw-contact-detail">{data.phone}</div>}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  Calendar Event
// ══════════════════════════════════════════

function CalendarEventWidget({ data: raw }: { data: CalendarEventData }) {
    const d = raw as unknown as Record<string, unknown>;
    const data = {
        title: String(d.title || d.name || d.event || 'Event'),
        date: String(d.date || d.start_date || d.startDate || new Date().toISOString()),
        time: d.time ? String(d.time) : d.start_time ? String(d.start_time) : undefined,
        location: d.location ? String(d.location) : d.venue ? String(d.venue) : d.place ? String(d.place) : undefined,
        description: d.description ? String(d.description) : d.details ? String(d.details) : undefined,
    };
    const dateObj = new Date(data.date);
    const validDate = !isNaN(dateObj.getTime());
    return (
        <div className="cw cw-event">
            <div className="cw-event-date">
                <span className="cw-event-month">{validDate ? dateObj.toLocaleString('default', { month: 'short' }) : '?'}</span>
                <span className="cw-event-day">{validDate ? dateObj.getDate() : '?'}</span>
            </div>
            <div className="cw-event-body">
                <div className="cw-event-title">{data.title}</div>
                {data.time && <div className="cw-event-time">{data.time}</div>}
                {data.location && <div className="cw-event-loc">{data.location}</div>}
                {data.description && <div className="cw-event-desc">{data.description}</div>}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  Code Run
// ══════════════════════════════════════════

function CodeRunWidget({ data }: { data: CodeRunData }) {
    return (
        <div className="cw cw-code">
            <div className="cw-code-header">
                <span>{data.language}</span>
                {data.exitCode != null && <span className={data.exitCode === 0 ? 'cw-code-pass' : 'cw-code-fail'}>exit {data.exitCode}</span>}
            </div>
            <pre className="cw-code-src">{data.code}</pre>
            {data.output && <pre className={`cw-code-out ${data.exitCode !== 0 ? 'cw-code-err' : ''}`}>{data.output}</pre>}
        </div>
    );
}

// ══════════════════════════════════════════
//  File Card
// ══════════════════════════════════════════

function FileCardWidget({ data }: { data: FileCardData }) {
    return (
        <div className="cw cw-file">
            <div className="cw-file-icon">📄</div>
            <div className="cw-file-info">
                <div className="cw-file-name">{data.name}</div>
                <div className="cw-file-path">{data.path}</div>
                {data.size && <span className="cw-file-size">{data.size}</span>}
            </div>
            {data.preview && <pre className="cw-file-preview">{data.preview.slice(0, 300)}</pre>}
        </div>
    );
}

// ══════════════════════════════════════════
//  Mermaid Diagram (rendered as code block with class for future CDN rendering)
// ══════════════════════════════════════════

function MermaidWidget({ data }: { data: MermaidData }) {
    const d = data as unknown as Record<string, unknown>;
    const code = String(d.code || d.diagram || d.mermaid || '');
    const title = String(d.title || '');

    return (
        <div className="cw cw-mermaid">
            {title && <div className="cw-diagram-title">{title}</div>}
            <pre className="cw-mermaid-code">{code}</pre>
        </div>
    );
}

// ══════════════════════════════════════════
//  Flowchart (SVG-rendered nodes + edges)
// ══════════════════════════════════════════

function FlowchartWidget({ data }: { data: FlowchartData }) {
    const d = data as unknown as Record<string, unknown>;
    const nodes = (Array.isArray(d.nodes) ? d.nodes : []) as FlowchartData['nodes'];
    const edges = (Array.isArray(d.edges) ? d.edges : []) as FlowchartData['edges'];
    const title = String(d.title || '');

    // Simple layout: nodes in a vertical column
    const nodeW = 160, nodeH = 40, gapY = 20, padX = 40, padY = 30;
    const nodePositions = new Map<string, { x: number; y: number }>();
    nodes.forEach((n, i) => {
        nodePositions.set(n.id, { x: padX, y: padY + i * (nodeH + gapY) });
    });
    const svgH = padY * 2 + nodes.length * (nodeH + gapY);

    const typeColors: Record<string, string> = { start: 'var(--success)', end: 'var(--error)', decision: 'var(--warning, #f0ad4e)', io: '#9b59b6', process: 'var(--accent)' };

    return (
        <div className="cw cw-flowchart">
            {title && <div className="cw-diagram-title">{title}</div>}
            <svg width={nodeW + padX * 2} height={svgH} className="cw-flowchart-svg">
                {edges.map((e, i) => {
                    const from = nodePositions.get(e.from);
                    const to = nodePositions.get(e.to);
                    if (!from || !to) return null;
                    return (
                        <g key={i}>
                            <line x1={from.x + nodeW / 2} y1={from.y + nodeH} x2={to.x + nodeW / 2} y2={to.y}
                                stroke="var(--text-tertiary)" strokeWidth="1.5" markerEnd="url(#arrow)" />
                            {e.label && <text x={(from.x + to.x) / 2 + nodeW / 2 + 5} y={(from.y + nodeH + to.y) / 2 + 4}
                                fontSize="9" fill="var(--text-tertiary)">{e.label}</text>}
                        </g>
                    );
                })}
                <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-tertiary)" />
                </marker></defs>
                {nodes.map(n => {
                    const pos = nodePositions.get(n.id)!;
                    const color = typeColors[n.type || 'process'] || 'var(--accent)';
                    const isDecision = n.type === 'decision';
                    return (
                        <g key={n.id}>
                            {isDecision ? (
                                <polygon points={`${pos.x + nodeW / 2},${pos.y} ${pos.x + nodeW},${pos.y + nodeH / 2} ${pos.x + nodeW / 2},${pos.y + nodeH} ${pos.x},${pos.y + nodeH / 2}`}
                                    fill="none" stroke={color} strokeWidth="1.5" rx="4" />
                            ) : (
                                <rect x={pos.x} y={pos.y} width={nodeW} height={nodeH} rx={n.type === 'start' || n.type === 'end' ? 20 : 6}
                                    fill="none" stroke={color} strokeWidth="1.5" />
                            )}
                            <text x={pos.x + nodeW / 2} y={pos.y + nodeH / 2 + 4} textAnchor="middle"
                                fontSize="11" fill="var(--text-primary)" fontFamily="inherit">{n.label}</text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}

// ══════════════════════════════════════════
//  Timeline
// ══════════════════════════════════════════

function TimelineWidget({ data }: { data: TimelineData }) {
    const d = data as unknown as Record<string, unknown>;
    const events = (Array.isArray(d.events) ? d.events : []) as TimelineData['events'];
    const title = String(d.title || '');

    return (
        <div className="cw cw-timeline">
            {title && <div className="cw-diagram-title">{title}</div>}
            <div className="cw-tl-track">
                {events.map((evt, i) => (
                    <div key={i} className="cw-tl-event">
                        <div className="cw-tl-dot" style={evt.color ? { background: evt.color } : undefined}>{evt.icon || ''}</div>
                        <div className="cw-tl-content">
                            <span className="cw-tl-date">{evt.date}</span>
                            <span className="cw-tl-title">{evt.title}</span>
                            {evt.description && <span className="cw-tl-desc">{evt.description}</span>}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  Kanban Board
// ══════════════════════════════════════════

function KanbanWidget({ data }: { data: KanbanData }) {
    const d = data as unknown as Record<string, unknown>;
    const columns = (Array.isArray(d.columns) ? d.columns : []) as KanbanData['columns'];
    const title = String(d.title || '');

    return (
        <div className="cw cw-kanban">
            {title && <div className="cw-diagram-title">{title}</div>}
            <div className="cw-kanban-board">
                {columns.map((col, ci) => (
                    <div key={ci} className="cw-kanban-col">
                        <div className="cw-kanban-col-header" style={col.color ? { borderTopColor: col.color } : undefined}>
                            {col.name} <span className="cw-kanban-count">{col.items.length}</span>
                        </div>
                        {col.items.map((item, ii) => (
                            <div key={ii} className="cw-kanban-card">
                                <span>{item.title}</span>
                                {item.tag && <span className="cw-kanban-tag">{item.tag}</span>}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  Mind Map
// ══════════════════════════════════════════

function MindmapNode({ node, depth = 0 }: { node: import('./types').MindmapNode; depth?: number }) {
    const colors = ['var(--accent)', 'var(--success)', 'var(--warning, #f0ad4e)', '#9b59b6', '#1abc9c', 'var(--error)'];
    const color = node.color || colors[depth % colors.length];
    return (
        <div className="cw-mm-node" style={{ borderLeftColor: depth > 0 ? color : 'transparent' }}>
            <span className="cw-mm-label" style={{ color: depth === 0 ? 'var(--text-primary)' : undefined }}>{node.label}</span>
            {node.children && node.children.length > 0 && (
                <div className="cw-mm-children">
                    {node.children.map((child, i) => <MindmapNode key={i} node={child} depth={depth + 1} />)}
                </div>
            )}
        </div>
    );
}

function MindmapWidget({ data }: { data: import('./types').MindmapData }) {
    const d = data as unknown as Record<string, unknown>;
    const root = (d.root || d) as import('./types').MindmapNode;
    return (
        <div className="cw cw-mindmap">
            <MindmapNode node={root} />
        </div>
    );
}

// ══════════════════════════════════════════
//  Dashboard (composite widget grid)
// ══════════════════════════════════════════

function DashboardWidget({ data, onAction }: { data: DashboardData; onAction?: (cmd: string) => void }) {
    const d = data as unknown as Record<string, unknown>;
    const widgets = (Array.isArray(d.widgets) ? d.widgets : []) as DashboardData['widgets'];
    const title = String(d.title || 'Dashboard');

    return (
        <div className="cw cw-dashboard">
            <div className="cw-diagram-title">{title}</div>
            <div className="cw-dash-grid">
                {widgets.map((w, i) => (
                    <div key={i} className="cw-dash-cell" style={w.span ? { gridColumn: `span ${w.span}` } : undefined}>
                        <WidgetRenderer widget={{ id: `dash-${i}`, type: w.type as import('./types').ChatWidgetType, data: w.data }} onAction={onAction} />
                    </div>
                ))}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  SVG Chart (line, area, scatter, radar, donut)
// ══════════════════════════════════════════

function SVGChartWidget({ data }: { data: SVGChartData }) {
    const d = data as unknown as Record<string, unknown>;
    const type = String(d.type || 'line') as SVGChartData['type'];
    const title = String(d.title || '');
    const labels = (Array.isArray(d.labels) ? d.labels : []) as string[];
    const datasets = (Array.isArray(d.datasets) ? d.datasets : []) as SVGChartData['datasets'];
    const colors = ['var(--accent)', 'var(--success)', 'var(--warning, #f0ad4e)', 'var(--error)', '#9b59b6', '#1abc9c'];

    if (type === 'donut') {
        const values = datasets[0]?.values || [];
        const total = values.reduce((s, v) => s + v, 0);
        let cum = 0;
        const segments = values.map((v, i) => {
            const pct = total > 0 ? (v / total) * 100 : 0;
            const start = cum; cum += pct;
            return { pct, start, color: colors[i % colors.length], label: labels[i] || '' };
        });
        const gradient = segments.map(s => `${s.color} ${s.start}% ${s.start + s.pct}%`).join(', ');
        return (
            <div className="cw cw-svgchart">
                {title && <div className="cw-chart-title">{title}</div>}
                <div className="cw-donut" style={{ background: `conic-gradient(${gradient})` }}>
                    <div className="cw-donut-hole">{total}</div>
                </div>
                <div className="cw-chart-legend">
                    {segments.map((s, i) => <span key={i} className="cw-legend-item"><span className="cw-legend-dot" style={{ background: s.color }} />{s.label} ({Math.round(s.pct)}%)</span>)}
                </div>
            </div>
        );
    }

    // Line / Area / Scatter
    const W = 320, H = 140, padL = 35, padR = 10, padT = 10, padB = 25;
    const chartW = W - padL - padR, chartH = H - padT - padB;
    const allVals = datasets.flatMap(ds => ds.values);
    const maxVal = Math.max(...allVals, 1);
    const minVal = Math.min(...allVals, 0);
    const range = maxVal - minVal || 1;
    const xStep = labels.length > 1 ? chartW / (labels.length - 1) : chartW;

    const toX = (i: number) => padL + i * xStep;
    const toY = (v: number) => padT + chartH - ((v - minVal) / range) * chartH;

    return (
        <div className="cw cw-svgchart">
            {title && <div className="cw-chart-title">{title}</div>}
            <svg width={W} height={H} className="cw-svg">
                {/* Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
                    const y = padT + chartH * (1 - f);
                    const val = minVal + range * f;
                    return (
                        <g key={i}>
                            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--border-light)" strokeWidth="0.5" />
                            <text x={padL - 4} y={y + 3} textAnchor="end" fontSize="8" fill="var(--text-tertiary)">{Math.round(val)}</text>
                        </g>
                    );
                })}
                {/* X labels */}
                {labels.map((l, i) => (
                    <text key={i} x={toX(i)} y={H - 4} textAnchor="middle" fontSize="8" fill="var(--text-tertiary)">{l}</text>
                ))}
                {/* Datasets */}
                {datasets.map((ds, di) => {
                    const color = ds.color || colors[di % colors.length];
                    const points = ds.values.map((v, i) => `${toX(i)},${toY(v)}`);
                    if (type === 'scatter') {
                        return (
                            <g key={di}>
                                {ds.values.map((v, i) => <circle key={i} cx={toX(i)} cy={toY(v)} r="3.5" fill={color} opacity="0.8" />)}
                            </g>
                        );
                    }
                    return (
                        <g key={di}>
                            {type === 'area' && <polygon points={`${toX(0)},${padT + chartH} ${points.join(' ')} ${toX(ds.values.length - 1)},${padT + chartH}`} fill={color} opacity="0.12" />}
                            <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            {ds.values.map((v, i) => <circle key={i} cx={toX(i)} cy={toY(v)} r="2.5" fill={color} />)}
                        </g>
                    );
                })}
            </svg>
            {datasets.length > 1 && (
                <div className="cw-chart-legend">
                    {datasets.map((ds, i) => <span key={i} className="cw-legend-item"><span className="cw-legend-dot" style={{ background: ds.color || colors[i % colors.length] }} />{ds.label}</span>)}
                </div>
            )}
        </div>
    );
}
