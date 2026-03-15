/**
 * Interactive Widgets v2 — Advanced interactive components for chat.
 * 15 new widget types with genuine interactivity: simulations, hover effects,
 * sortable tables, slide decks, animated countdowns, and more.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ══════════════════════════════════════════
//  Helper: safe field extraction
// ══════════════════════════════════════════

function D(raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== 'object') return {};
    return raw as Record<string, unknown>;
}

function str(v: unknown, fallback = ''): string { return v != null ? String(v) : fallback; }
function num(v: unknown, fallback = 0): number { const n = Number(v); return isNaN(n) ? fallback : n; }
function arr(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }

// ══════════════════════════════════════════
//  1. Simulation (animated particle/cell spread)
// ══════════════════════════════════════════

export function SimulationWidget({ data: raw }: { data: unknown }) {
    const d = D(raw);
    const title = str(d.title || d.name, 'Simulation');
    const type = str(d.simulation_type || d.type, 'spread');
    const speed = num(d.speed || d.rate, 2);
    const gridSize = num(d.grid_size || d.size, 20);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [running, setRunning] = useState(false);
    const gridRef = useRef<number[][]>([]);
    const frameRef = useRef(0);

    const initGrid = useCallback(() => {
        const g: number[][] = [];
        for (let y = 0; y < gridSize; y++) {
            g[y] = [];
            for (let x = 0; x < gridSize; x++) g[y][x] = 0;
        }
        const cx = Math.floor(gridSize / 2);
        g[cx][cx] = 1;
        gridRef.current = g;
    }, [gridSize]);

    useEffect(() => { initGrid(); }, [initGrid]);

    useEffect(() => {
        if (!running) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const cellSize = Math.floor(200 / gridSize);
        canvas.width = gridSize * cellSize;
        canvas.height = gridSize * cellSize;

        let animId: number;
        const colors = type === 'spread' ? ['#1a1a2e', '#e74c3c', '#c0392b', '#922b21'] :
            type === 'growth' ? ['#1a1a2e', '#27ae60', '#2ecc71', '#a8e6cf'] :
            ['#1a1a2e', '#3498db', '#2980b9', '#1abc9c'];

        const step = () => {
            const g = gridRef.current;
            const next = g.map(row => [...row]);
            for (let y = 0; y < gridSize; y++) {
                for (let x = 0; x < gridSize; x++) {
                    if (g[y][x] > 0 && g[y][x] < 3) {
                        const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
                        for (const [dy, dx] of dirs) {
                            const ny = y + dy, nx = x + dx;
                            if (ny >= 0 && ny < gridSize && nx >= 0 && nx < gridSize && g[ny][nx] === 0) {
                                if (Math.random() < speed * 0.05) next[ny][nx] = 1;
                            }
                        }
                        if (Math.random() < 0.02) next[y][x] = Math.min(g[y][x] + 1, 3);
                    }
                }
            }
            gridRef.current = next;

            // Draw
            for (let y = 0; y < gridSize; y++) {
                for (let x = 0; x < gridSize; x++) {
                    ctx.fillStyle = colors[Math.min(next[y][x], colors.length - 1)];
                    ctx.fillRect(x * cellSize, y * cellSize, cellSize - 1, cellSize - 1);
                }
            }
            frameRef.current++;
            animId = requestAnimationFrame(step);
        };
        const interval = setInterval(() => { step(); }, 100);
        return () => { clearInterval(interval); cancelAnimationFrame(animId); };
    }, [running, gridSize, speed, type]);

    const infected = gridRef.current.flat().filter(c => c > 0).length;

    return (
        <div className="cw cw-sim">
            <div className="cw-sim-header">
                <span className="cw-diagram-title">{title}</span>
                <div className="cw-sim-controls">
                    <button className="cw-sim-btn" onClick={() => { if (!running) initGrid(); setRunning(!running); }}>
                        {running ? '⏸ Pause' : '▶ Start'}
                    </button>
                    <button className="cw-sim-btn" onClick={() => { setRunning(false); initGrid(); }}>↺ Reset</button>
                </div>
            </div>
            <canvas ref={canvasRef} className="cw-sim-canvas" />
            <div className="cw-sim-stats">
                <span>Cells: {infected}/{gridSize * gridSize}</span>
                <span>Frame: {frameRef.current}</span>
                <span>Speed: {speed}x</span>
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  2. Interactive Graph (hover tooltips)
// ══════════════════════════════════════════

export function InteractiveGraphWidget({ data: raw }: { data: unknown }) {
    const d = D(raw);
    const title = str(d.title);
    const labels = arr(d.labels || d.x).map(String);
    const datasets = arr(d.datasets || d.series).map((ds: unknown) => {
        const s = D(ds);
        return { label: str(s.label || s.name), values: arr(s.values || s.data || s.y).map(Number), color: str(s.color) };
    });
    // Fallback: single values array
    if (datasets.length === 0 && arr(d.values).length > 0) {
        datasets.push({ label: str(d.label, 'Data'), values: arr(d.values).map(Number), color: '' });
    }
    const [hover, setHover] = useState<{ x: number; y: number; label: string; value: number; dataset: string } | null>(null);

    const W = 340, H = 160, pL = 40, pR = 15, pT = 15, pB = 30;
    const cW = W - pL - pR, cH = H - pT - pB;
    const allV = datasets.flatMap(ds => ds.values);
    const maxV = Math.max(...allV, 1);
    const minV = Math.min(...allV, 0);
    const range = maxV - minV || 1;
    const xStep = labels.length > 1 ? cW / (labels.length - 1) : cW;
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

    const toX = (i: number) => pL + i * xStep;
    const toY = (v: number) => pT + cH - ((v - minV) / range) * cH;

    return (
        <div className="cw cw-igraph">
            {title && <div className="cw-diagram-title">{title}</div>}
            <svg width={W} height={H} className="cw-svg" onMouseLeave={() => setHover(null)}>
                {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
                    const y = pT + cH * (1 - f);
                    return <g key={i}><line x1={pL} y1={y} x2={W - pR} y2={y} stroke="var(--border-light)" strokeWidth="0.5" /><text x={pL - 4} y={y + 3} textAnchor="end" fontSize="8" fill="var(--text-tertiary)">{Math.round(minV + range * f)}</text></g>;
                })}
                {labels.map((l, i) => <text key={i} x={toX(i)} y={H - 6} textAnchor="middle" fontSize="8" fill="var(--text-tertiary)">{l}</text>)}
                {datasets.map((ds, di) => {
                    const c = ds.color || colors[di % colors.length];
                    const pts = ds.values.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
                    return (
                        <g key={di}>
                            <polygon points={`${toX(0)},${pT + cH} ${pts} ${toX(ds.values.length - 1)},${pT + cH}`} fill={c} opacity="0.08" />
                            <polyline points={pts} fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            {ds.values.map((v, i) => (
                                <circle key={i} cx={toX(i)} cy={toY(v)} r={hover?.x === i && hover?.dataset === ds.label ? 5 : 3} fill={c}
                                    style={{ cursor: 'pointer', transition: 'r 0.15s' }}
                                    onMouseEnter={(e) => setHover({ x: i, y: v, label: labels[i] || '', value: v, dataset: ds.label })} />
                            ))}
                        </g>
                    );
                })}
            </svg>
            {hover && (
                <div className="cw-igraph-tooltip">
                    <strong>{hover.label}</strong>: {hover.value} {datasets.length > 1 ? `(${hover.dataset})` : ''}
                </div>
            )}
            {datasets.length > 1 && (
                <div className="cw-chart-legend">{datasets.map((ds, i) => <span key={i} className="cw-legend-item"><span className="cw-legend-dot" style={{ background: ds.color || colors[i % colors.length] }} />{ds.label}</span>)}</div>
            )}
        </div>
    );
}

// ══════════════════════════════════════════
//  3. Sortable Data Table
// ══════════════════════════════════════════

export function DataTableWidget({ data: raw }: { data: unknown }) {
    const d = D(raw);
    const title = str(d.title);
    const columns = arr(d.columns || d.headers).map((c: unknown) => typeof c === 'string' ? { key: c, label: c } : { key: str(D(c).key || D(c).name), label: str(D(c).label || D(c).name || D(c).key) });
    const rows = arr(d.rows || d.data).map((r: unknown) => Array.isArray(r) ? r : D(r));
    const [sortCol, setSortCol] = useState<number>(-1);
    const [sortAsc, setSortAsc] = useState(true);
    const [filter, setFilter] = useState('');

    const sortedRows = useMemo(() => {
        let r = [...rows];
        if (filter) r = r.filter(row => JSON.stringify(row).toLowerCase().includes(filter.toLowerCase()));
        if (sortCol >= 0) {
            const key = columns[sortCol]?.key;
            r.sort((a, b) => {
                const va = Array.isArray(a) ? a[sortCol] : D(a)[key];
                const vb = Array.isArray(b) ? b[sortCol] : D(b)[key];
                const cmp = String(va || '').localeCompare(String(vb || ''), undefined, { numeric: true });
                return sortAsc ? cmp : -cmp;
            });
        }
        return r;
    }, [rows, sortCol, sortAsc, filter, columns]);

    const handleSort = (i: number) => {
        if (sortCol === i) setSortAsc(!sortAsc);
        else { setSortCol(i); setSortAsc(true); }
    };

    return (
        <div className="cw cw-dtable">
            {title && <div className="cw-diagram-title">{title}</div>}
            <input className="cw-dtable-filter" placeholder="Filter..." value={filter} onChange={e => setFilter(e.target.value)} />
            <div className="cw-dtable-scroll">
                <table>
                    <thead><tr>{columns.map((c, i) => (
                        <th key={i} onClick={() => handleSort(i)} style={{ cursor: 'pointer' }}>
                            {c.label} {sortCol === i ? (sortAsc ? '↑' : '↓') : ''}
                        </th>
                    ))}</tr></thead>
                    <tbody>{sortedRows.slice(0, 50).map((row, ri) => (
                        <tr key={ri}>{columns.map((c, ci) => {
                            const val = Array.isArray(row) ? row[ci] : D(row)[c.key];
                            return <td key={ci}>{str(val)}</td>;
                        })}</tr>
                    ))}</tbody>
                </table>
            </div>
            <div className="cw-dtable-footer">{sortedRows.length} rows{filter ? ' (filtered)' : ''}</div>
        </div>
    );
}

// ══════════════════════════════════════════
//  4. Comparison Table
// ══════════════════════════════════════════

export function ComparisonWidget({ data: raw }: { data: unknown }) {
    const d = D(raw);
    const title = str(d.title);
    const items = arr(d.items || d.options || d.products).map((it: unknown) => D(it));
    const features = arr(d.features || d.criteria || d.rows).map(String);

    return (
        <div className="cw cw-compare">
            {title && <div className="cw-diagram-title">{title}</div>}
            <div className="cw-compare-scroll">
                <table>
                    <thead><tr><th>Feature</th>{items.map((it, i) => <th key={i} className="cw-compare-name">{str(it.name || it.title)}</th>)}</tr></thead>
                    <tbody>
                        {features.map((f, fi) => (
                            <tr key={fi}><td className="cw-compare-feature">{f}</td>
                                {items.map((it, ii) => {
                                    const vals = D(it.values || it.features || it);
                                    const v = vals[f] ?? (arr(it.values)[fi]);
                                    const display = v === true ? '✓' : v === false ? '✗' : str(v, '—');
                                    return <td key={ii} className={v === true ? 'cw-compare-yes' : v === false ? 'cw-compare-no' : ''}>{display}</td>;
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  5. Pricing Table
// ══════════════════════════════════════════

export function PricingWidget({ data: raw }: { data: unknown }) {
    const d = D(raw);
    const title = str(d.title);
    const plans = arr(d.plans || d.tiers || d.options).map((p: unknown) => D(p));

    return (
        <div className="cw cw-pricing">
            {title && <div className="cw-diagram-title">{title}</div>}
            <div className="cw-pricing-grid">
                {plans.map((plan, i) => (
                    <div key={i} className={`cw-pricing-card ${plan.featured || plan.popular ? 'featured' : ''}`}>
                        <div className="cw-pricing-name">{str(plan.name || plan.title)}</div>
                        <div className="cw-pricing-price">{str(plan.price || plan.cost)}<span className="cw-pricing-period">/{str(plan.period || plan.interval, 'mo')}</span></div>
                        {plan.description ? <div className="cw-pricing-desc">{str(plan.description)}</div> : null}
                        <div className="cw-pricing-features">
                            {arr(plan.features || plan.includes).map((f: unknown, fi: number) => (
                                <div key={fi} className="cw-pricing-feat">✓ {str(f)}</div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  6. Accordion / FAQ
// ══════════════════════════════════════════

export function AccordionWidget({ data: raw }: { data: unknown }) {
    const d = D(raw);
    const title = str(d.title);
    const items = arr(d.items || d.sections || d.questions).map((it: unknown) => D(it));
    const [open, setOpen] = useState<Set<number>>(new Set());

    const toggle = (i: number) => setOpen(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

    return (
        <div className="cw cw-accordion">
            {title && <div className="cw-diagram-title">{title}</div>}
            {items.map((it, i) => (
                <div key={i} className={`cw-acc-item ${open.has(i) ? 'open' : ''}`}>
                    <button className="cw-acc-header" onClick={() => toggle(i)}>
                        <span>{str(it.title || it.question || it.label)}</span>
                        <span className="cw-acc-arrow">{open.has(i) ? '−' : '+'}</span>
                    </button>
                    {open.has(i) && <div className="cw-acc-body">{str(it.content || it.answer || it.body || it.text)}</div>}
                </div>
            ))}
        </div>
    );
}

// ══════════════════════════════════════════
//  7. Tabs
// ══════════════════════════════════════════

export function TabsWidget({ data: raw }: { data: unknown }) {
    const d = D(raw);
    const title = str(d.title);
    const tabs = arr(d.tabs || d.sections || d.panels).map((t: unknown) => D(t));
    const [active, setActive] = useState(0);

    return (
        <div className="cw cw-tabs">
            {title && <div className="cw-diagram-title">{title}</div>}
            <div className="cw-tabs-bar">
                {tabs.map((t, i) => (
                    <button key={i} className={`cw-tabs-btn ${active === i ? 'active' : ''}`} onClick={() => setActive(i)}>
                        {str(t.title || t.label || t.name)}
                    </button>
                ))}
            </div>
            {tabs[active] && <div className="cw-tabs-content">{str(D(tabs[active]).content || D(tabs[active]).body || D(tabs[active]).text)}</div>}
        </div>
    );
}

// ══════════════════════════════════════════
//  8. Slides / Presentation
// ══════════════════════════════════════════

export function SlidesWidget({ data: raw }: { data: unknown }) {
    const d = D(raw);
    const title = str(d.title);
    const slides = arr(d.slides || d.pages).map((s: unknown) => D(s));
    const [current, setCurrent] = useState(0);

    if (slides.length === 0) return null;
    const slide = slides[current];

    return (
        <div className="cw cw-slides">
            <div className="cw-slides-viewport">
                <div className="cw-slides-slide">
                    {slide.title ? <div className="cw-slides-title">{str(slide.title || slide.heading)}</div> : null}
                    <div className="cw-slides-body">{str(slide.content || slide.body || slide.text)}</div>
                    {slide.image ? <img src={str(slide.image)} alt="" className="cw-slides-img" /> : null}
                </div>
            </div>
            <div className="cw-slides-nav">
                <button onClick={() => setCurrent(Math.max(0, current - 1))} disabled={current === 0}>←</button>
                <span>{current + 1} / {slides.length}{title ? ` — ${title}` : ''}</span>
                <button onClick={() => setCurrent(Math.min(slides.length - 1, current + 1))} disabled={current === slides.length - 1}>→</button>
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  9. Star Rating
// ══════════════════════════════════════════

export function RatingWidget({ data: raw }: { data: unknown }) {
    const d = D(raw);
    const title = str(d.title || d.label || d.name);
    const maxStars = num(d.max || d.stars || d.scale, 5);
    const initialRating = num(d.rating || d.value || d.score, 0);
    const [rating, setRating] = useState(initialRating);
    const [hoverRating, setHoverRating] = useState(0);
    const items = arr(d.items || d.list).map((it: unknown) => {
        const o = D(it);
        return { label: str(o.label || o.name || o.title), rating: num(o.rating || o.score || o.value, 0) };
    });

    if (items.length > 0) {
        return (
            <div className="cw cw-rating">
                {title && <div className="cw-diagram-title">{title}</div>}
                {items.map((it, i) => (
                    <div key={i} className="cw-rating-row">
                        <span className="cw-rating-label">{it.label}</span>
                        <div className="cw-rating-stars">{Array.from({ length: maxStars }, (_, si) => (
                            <span key={si} className={si < it.rating ? 'cw-star-filled' : 'cw-star-empty'}>★</span>
                        ))}</div>
                        <span className="cw-rating-val">{it.rating}/{maxStars}</span>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="cw cw-rating">
            {title && <div className="cw-rating-title">{title}</div>}
            <div className="cw-rating-stars-interactive">
                {Array.from({ length: maxStars }, (_, i) => (
                    <span key={i} className={i < (hoverRating || rating) ? 'cw-star-filled' : 'cw-star-empty'}
                        onClick={() => setRating(i + 1)} onMouseEnter={() => setHoverRating(i + 1)} onMouseLeave={() => setHoverRating(0)}
                        style={{ cursor: 'pointer' }}>★</span>
                ))}
            </div>
            <div className="cw-rating-val">{rating > 0 ? `${rating}/${maxStars}` : 'Click to rate'}</div>
        </div>
    );
}

// ══════════════════════════════════════════
//  10. Countdown
// ══════════════════════════════════════════

export function CountdownWidget({ data: raw }: { data: unknown }) {
    const d = D(raw);
    const title = str(d.title || d.label || d.event);
    const targetDate = new Date(str(d.date || d.target || d.deadline, new Date(Date.now() + 86400000).toISOString()));
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        const iv = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(iv);
    }, []);

    const diff = Math.max(0, targetDate.getTime() - now);
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);

    return (
        <div className="cw cw-countdown">
            <div className="cw-countdown-title">{title || 'Countdown'}</div>
            <div className="cw-countdown-blocks">
                {[{ val: days, label: 'Days' }, { val: hours, label: 'Hrs' }, { val: mins, label: 'Min' }, { val: secs, label: 'Sec' }].map((b, i) => (
                    <div key={i} className="cw-countdown-block">
                        <span className="cw-countdown-num">{String(b.val).padStart(2, '0')}</span>
                        <span className="cw-countdown-label">{b.label}</span>
                    </div>
                ))}
            </div>
            {diff === 0 && <div className="cw-countdown-done">Event reached!</div>}
        </div>
    );
}

// ══════════════════════════════════════════
//  11. Color Palette
// ══════════════════════════════════════════

export function ColorPaletteWidget({ data: raw }: { data: unknown }) {
    const d = D(raw);
    const title = str(d.title || d.name);
    const colors = arr(d.colors || d.palette || d.swatches).map((c: unknown) => {
        if (typeof c === 'string') return { color: c, name: c };
        const o = D(c);
        return { color: str(o.color || o.hex || o.value), name: str(o.name || o.label, str(o.color || o.hex)) };
    });
    const [copied, setCopied] = useState('');

    const copy = (hex: string) => {
        navigator.clipboard?.writeText(hex);
        setCopied(hex);
        setTimeout(() => setCopied(''), 1500);
    };

    return (
        <div className="cw cw-colors">
            {title && <div className="cw-diagram-title">{title}</div>}
            <div className="cw-colors-grid">
                {colors.map((c, i) => (
                    <div key={i} className="cw-color-swatch" onClick={() => copy(c.color)} title={`Click to copy ${c.color}`}>
                        <div className="cw-color-box" style={{ background: c.color }} />
                        <span className="cw-color-name">{c.name}</span>
                        <span className="cw-color-hex">{copied === c.color ? 'Copied!' : c.color}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════
//  12. Floor Plan (SVG room layout)
// ══════════════════════════════════════════

export function FloorPlanWidget({ data: raw }: { data: unknown }) {
    const d = D(raw);
    const title = str(d.title || d.name);
    const rooms = arr(d.rooms || d.areas || d.spaces).map((r: unknown) => D(r));
    const [selected, setSelected] = useState<string | null>(null);
    const scale = num(d.scale, 3);

    const colors: Record<string, string> = { bedroom: '#3b82f6', kitchen: '#f59e0b', bathroom: '#06b6d4', living: '#10b981', office: '#8b5cf6', garage: '#6b7280', dining: '#ec4899', default: 'var(--accent)' };

    return (
        <div className="cw cw-floorplan">
            {title && <div className="cw-diagram-title">{title}</div>}
            <svg width={320} height={220} className="cw-svg cw-floorplan-svg">
                {rooms.map((room, i) => {
                    const x = num(room.x, i % 3 * 100 + 10);
                    const y = num(room.y, Math.floor(i / 3) * 80 + 10);
                    const w = num(room.width || room.w, 90) * scale / 3;
                    const h = num(room.height || room.h, 70) * scale / 3;
                    const name = str(room.name || room.label || room.type);
                    const type = str(room.type || room.category, 'default').toLowerCase();
                    const color = colors[type] || colors.default;
                    const isSelected = selected === name;
                    return (
                        <g key={i} onClick={() => setSelected(isSelected ? null : name)} style={{ cursor: 'pointer' }}>
                            <rect x={x} y={y} width={w} height={h} fill={color} opacity={isSelected ? 0.3 : 0.12} stroke={color} strokeWidth={isSelected ? 2 : 1} rx="3" />
                            <text x={x + w / 2} y={y + h / 2 - 4} textAnchor="middle" fontSize="10" fontWeight="600" fill={color}>{name}</text>
                            {room.size ? <text x={x + w / 2} y={y + h / 2 + 8} textAnchor="middle" fontSize="8" fill="var(--text-tertiary)">{str(room.size)}</text> : null}
                        </g>
                    );
                })}
            </svg>
            {selected && <div className="cw-floorplan-info">Selected: {selected}</div>}
        </div>
    );
}

// ══════════════════════════════════════════
//  13. Equation / Math
// ══════════════════════════════════════════

export function EquationWidget({ data: raw }: { data: unknown }) {
    const d = D(raw);
    const title = str(d.title);
    const equations = arr(d.equations || d.formulas || d.expressions).map((e: unknown) => typeof e === 'string' ? { expr: e } : { expr: str(D(e).expression || D(e).formula || D(e).expr), label: str(D(e).label || D(e).name) });
    if (equations.length === 0 && d.expression) equations.push({ expr: str(d.expression || d.formula || d.equation), label: '' });

    return (
        <div className="cw cw-equation">
            {title && <div className="cw-diagram-title">{title}</div>}
            {equations.map((eq, i) => (
                <div key={i} className="cw-eq-row">
                    {eq.label && <span className="cw-eq-label">{eq.label}</span>}
                    <code className="cw-eq-expr">{eq.expr}</code>
                </div>
            ))}
        </div>
    );
}

// ══════════════════════════════════════════
//  14. Video Embed
// ══════════════════════════════════════════

export function VideoWidget({ data: raw }: { data: unknown }) {
    const d = D(raw);
    const title = str(d.title || d.name);
    const url = str(d.url || d.src || d.video);
    const description = str(d.description);

    // Convert YouTube URLs to embed
    let embedUrl = url;
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
    if (ytMatch) embedUrl = `https://www.youtube.com/embed/${ytMatch[1]}`;

    if (!embedUrl) return <div className="cw"><div className="cw-diagram-title">{title || 'Video'}</div><p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>No video URL provided</p></div>;

    return (
        <div className="cw cw-video">
            {title && <div className="cw-diagram-title">{title}</div>}
            <div className="cw-video-container">
                <iframe src={embedUrl} frameBorder="0" allowFullScreen title={title || 'Video'} />
            </div>
            {description && <div className="cw-video-desc">{description}</div>}
        </div>
    );
}

// ══════════════════════════════════════════
//  15. Document Viewer
// ══════════════════════════════════════════

export function DocumentWidget({ data: raw }: { data: unknown }) {
    const d = D(raw);
    const title = str(d.title || d.name || d.filename);
    const content = str(d.content || d.text || d.body);
    const pages = arr(d.pages || d.sections);
    const [page, setPage] = useState(0);

    // If pages provided, use pagination
    if (pages.length > 0) {
        const p = D(pages[page]);
        return (
            <div className="cw cw-document">
                <div className="cw-doc-header">
                    <span className="cw-diagram-title">{title || 'Document'}</span>
                    <span className="cw-doc-page">Page {page + 1}/{pages.length}</span>
                </div>
                <div className="cw-doc-body">
                    {p.heading ? <h3 className="cw-doc-heading">{str(p.heading || p.title)}</h3> : null}
                    <div className="cw-doc-text">{str(p.content || p.text || p.body)}</div>
                </div>
                <div className="cw-doc-nav">
                    <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>← Prev</button>
                    <button onClick={() => setPage(Math.min(pages.length - 1, page + 1))} disabled={page === pages.length - 1}>Next →</button>
                </div>
            </div>
        );
    }

    return (
        <div className="cw cw-document">
            <div className="cw-doc-header">
                <span className="cw-diagram-title">{title || 'Document'}</span>
            </div>
            <div className="cw-doc-body"><div className="cw-doc-text">{content || 'Empty document'}</div></div>
        </div>
    );
}
