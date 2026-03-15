import React from 'react';
import { HOOK_CATEGORIES } from './types';
import type { HooksTabProps } from './types';

export default function HooksTab({
    hooks, customCommands,
    newHookType, setNewHookType,
    newHookCmd, setNewHookCmd,
    newHookMatcher, setNewHookMatcher,
    hookPresets, hookTestResult, setHookTestResult,
    testingHook,
    addHook, removeHook, applyPreset, testHook,
}: HooksTabProps) {
    const totalHooks = Object.values(hooks).reduce((sum, arr) => sum + arr.length, 0);
    const systemCount = Object.values(hooks).reduce((sum, arr) => sum + arr.filter(h => h._system).length, 0);
    const userCount = totalHooks - systemCount;

    // Separate system hooks from user hooks for display
    const systemHookEntries: Array<{ hookType: string; hook: typeof hooks[string][number]; blocking: boolean }> = [];
    const userHookEntries: Array<{ hookType: string; hook: typeof hooks[string][number]; idx: number; blocking: boolean }> = [];

    for (const [type, hooksArr] of Object.entries(hooks)) {
        const typeInfo = Object.values(HOOK_CATEGORIES).flatMap(c => c.types).find(t => t.type === type);
        const blocking = typeInfo?.blocking ?? false;
        hooksArr.forEach((hook, idx) => {
            if (hook._system) {
                systemHookEntries.push({ hookType: type, hook, blocking });
            } else {
                userHookEntries.push({ hookType: type, hook, idx, blocking });
            }
        });
    }

    return (
        <div className="settings-tab-content">
            <div className="settings-section">
                <h3>Lifecycle Hooks <span className="hook-total-badge">{totalHooks} registered</span></h3>
                <p className="settings-section-desc">Shell commands that execute at lifecycle events. Blocking hooks (marked with a shield) can prevent operations when they exit non-zero.</p>

                {/* System hooks section */}
                {systemCount > 0 && (
                    <div className="hook-system-section">
                        <div className="hook-system-header">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{verticalAlign: -2}}>
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                            </svg>
                            <span>System Hooks</span>
                            <span className="hook-system-count">{systemCount}</span>
                        </div>
                        <p className="hook-system-desc">Essential guardrails auto-applied by Onicode — safety gates, post-edit validation, git quality checks, secret file protection, and AI behavior guards.</p>
                        {systemHookEntries.map((entry, i) => (
                            <div key={`sys-${i}`} className="hook-item hook-item-system">
                                <div className="hook-item-header">
                                    <span className={`hook-type-badge hook-type-system ${entry.blocking ? 'hook-blocking' : ''}`}>
                                        {entry.blocking && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{marginRight: 3, verticalAlign: -1}}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>}
                                        {entry.hookType}
                                    </span>
                                    <span className="hook-system-badge">system</span>
                                    {entry.hook.matcher && <span className="hook-matcher">/{entry.hook.matcher}/</span>}
                                </div>
                                <code className="hook-command">{entry.hook.command}</code>
                                <button
                                    className="hook-test-btn"
                                    onClick={() => testHook(entry.hook.command, entry.hookType)}
                                    disabled={testingHook === entry.hook.command}
                                    title="Test this hook"
                                >
                                    {testingHook === entry.hook.command ? '...' : (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <polygon points="5 3 19 12 5 21 5 3" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* User hooks grouped by category */}
                {userCount > 0 && (
                    <div className="hook-user-section">
                        {systemCount > 0 && (
                            <div className="hook-user-header">Custom Hooks <span className="hook-system-count">{userCount}</span></div>
                        )}
                        {Object.entries(HOOK_CATEGORIES).map(([catId, cat]) => {
                            const catHooks = cat.types.filter(t => hooks[t.type]?.some(h => !h._system));
                            if (catHooks.length === 0) return null;
                            return (
                                <div key={catId} className="hook-category">
                                    <div className="hook-category-header">{cat.label}</div>
                                    {catHooks.map(hookType => (
                                        hooks[hookType.type]?.map((hook, idx) => {
                                            if (hook._system) return null;
                                            return (
                                                <div key={`${hookType.type}-${idx}`} className="hook-item">
                                                    <div className="hook-item-header">
                                                        <span className={`hook-type-badge ${hookType.blocking ? 'hook-blocking' : ''}`}>
                                                            {hookType.blocking && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{marginRight: 3, verticalAlign: -1}}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>}
                                                            {hookType.type}
                                                        </span>
                                                        {hook.matcher && <span className="hook-matcher">/{hook.matcher}/</span>}
                                                    </div>
                                                    <code className="hook-command">{hook.command}</code>
                                                    <button
                                                        className="hook-test-btn"
                                                        onClick={() => testHook(hook.command, hookType.type)}
                                                        disabled={testingHook === hook.command}
                                                        title="Test this hook"
                                                    >
                                                        {testingHook === hook.command ? '...' : (
                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <polygon points="5 3 19 12 5 21 5 3" />
                                                            </svg>
                                                        )}
                                                    </button>
                                                    <button className="hook-remove" onClick={() => removeHook(hookType.type, idx)} title="Remove">
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            );
                                        })
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                )}

                {totalHooks === 0 && (
                    <div className="hook-empty">
                        <p>No hooks configured yet</p>
                        <span>Add hooks below or apply a preset to get started quickly.</span>
                    </div>
                )}

                {/* Quick Presets */}
                {hookPresets.length > 0 && (
                    <div className="hook-presets">
                        <div className="hook-presets-label">Quick Presets</div>
                        <div className="hook-presets-grid">
                            {hookPresets.map(preset => (
                                <button
                                    key={preset.id}
                                    className="hook-preset-btn"
                                    onClick={() => applyPreset(preset.id)}
                                    title={preset.description}
                                >
                                    <span className="hook-preset-name">{preset.name}</span>
                                    <span className="hook-preset-types">{preset.hookTypes.join(', ')}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Add hook form */}
                <div className="hook-add-form">
                    <div className="hook-add-form-row">
                        <select className="hook-type-select" value={newHookType} onChange={e => setNewHookType(e.target.value)}>
                            {Object.entries(HOOK_CATEGORIES).map(([catId, cat]) => (
                                <optgroup key={catId} label={cat.label}>
                                    {cat.types.map(t => (
                                        <option key={t.type} value={t.type}>{t.type}{t.blocking ? ' (blocking)' : ''}</option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                        <input className="hook-input" placeholder="Matcher regex (optional)" value={newHookMatcher} onChange={e => setNewHookMatcher(e.target.value)} />
                    </div>
                    <div className="hook-add-form-row">
                        <input className="hook-input hook-input-cmd" placeholder="Shell command (e.g. npm run lint, npx tsc --noEmit)" value={newHookCmd} onChange={e => setNewHookCmd(e.target.value)} onKeyDown={e => e.key === 'Enter' && addHook()} />
                        <button className="hook-add-btn" onClick={addHook} disabled={!newHookCmd.trim()}>Add Hook</button>
                    </div>
                </div>

                {/* Hook type reference */}
                <details className="hook-reference">
                    <summary className="hook-reference-title">All Hook Types Reference</summary>
                    <div className="hook-reference-content">
                        {Object.entries(HOOK_CATEGORIES).map(([catId, cat]) => (
                            <div key={catId} className="hook-ref-category">
                                <div className="hook-ref-category-label">{cat.label}</div>
                                {cat.types.map(t => (
                                    <div key={t.type} className="hook-ref-item">
                                        <span className={`hook-ref-type ${t.blocking ? 'hook-blocking' : ''}`}>{t.type}</span>
                                        <span className="hook-ref-desc">{t.desc}</span>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </details>

                {/* Example hooks */}
                <details className="hook-reference">
                    <summary className="hook-reference-title">Example Hooks</summary>
                    <div className="hook-reference-content hook-examples">
                        <div className="hook-example">
                            <strong>PreCommit</strong> — Lint + typecheck before every commit
                            <code>npm run lint && npx tsc --noEmit</code>
                        </div>
                        <div className="hook-example">
                            <strong>PostEdit</strong> (matcher: <code>\.tsx?$</code>) — TypeScript check after editing .ts/.tsx
                            <code>npx tsc --noEmit 2&gt;&amp;1 | head -20</code>
                        </div>
                        <div className="hook-example">
                            <strong>PostEdit</strong> (matcher: <code>schema|migration</code>) — Check migrations after schema changes
                            <code>npx prisma validate</code>
                        </div>
                        <div className="hook-example">
                            <strong>OnDangerousCommand</strong> — Block all destructive commands
                            <code>echo "Blocked: $ONICODE_COMMAND" &amp;&amp; exit 1</code>
                        </div>
                        <div className="hook-example">
                            <strong>OnTestFailure</strong> — Log test failures
                            <code>echo "FAIL: $ONICODE_COMMAND" &gt;&gt; ~/.onicode/test-failures.log</code>
                        </div>
                        <div className="hook-example">
                            <strong>PostCommand</strong> (matcher: <code>npm run dev</code>) — Open browser after dev server starts
                            <code>open http://localhost:3000</code>
                        </div>
                    </div>
                </details>

                {hookTestResult && (
                    <div className={`hook-test-result ${hookTestResult.success ? 'hook-test-pass' : 'hook-test-fail'}`}>
                        <div className="hook-test-header">
                            <span>{hookTestResult.success ? 'PASS' : 'FAIL'} (exit {hookTestResult.exitCode ?? 0})</span>
                            <button className="hook-test-dismiss" onClick={() => setHookTestResult(null)}>dismiss</button>
                        </div>
                        {hookTestResult.stdout && <pre className="hook-test-output">{hookTestResult.stdout}</pre>}
                        {hookTestResult.stderr && <pre className="hook-test-output hook-test-stderr">{hookTestResult.stderr}</pre>}
                    </div>
                )}

                <div className="hook-env-info">
                    <span className="hook-env-label">Available env vars:</span>
                    <code>$ONICODE_TOOL_NAME</code> <code>$ONICODE_TOOL_INPUT</code> <code>$ONICODE_TOOL_OUTPUT</code> <code>$ONICODE_PROJECT_DIR</code> <code>$ONICODE_SESSION_ID</code> <code>$ONICODE_COMMAND</code> <code>$ONICODE_FILE_PATH</code> <code>$ONICODE_COMMIT_MSG</code> <code>$ONICODE_ERROR</code> <code>$ONICODE_EXIT_CODE</code> <code>$ONICODE_TASK_CONTENT</code>
                </div>
            </div>

            <div className="settings-section">
                <h3>Custom Commands ({customCommands.length})</h3>
                <p className="settings-section-desc">Slash commands from <code>.onicode/commands/*.md</code>. Each file becomes a /command.</p>
                {customCommands.length > 0 ? (
                    <div className="commands-list">
                        {customCommands.map(cmd => (
                            <div key={`${cmd.source}-${cmd.name}`} className="command-item">
                                <div className="command-item-name">
                                    <code>/{cmd.name}</code>
                                    <span className={`command-source-badge ${cmd.source}`}>{cmd.source}</span>
                                </div>
                                <div className="command-item-desc">{cmd.description}</div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="mcp-placeholder">
                        <span>No custom commands found</span>
                        <span className="mcp-placeholder-hint">Defaults: review, deploy, test, refactor, explain</span>
                    </div>
                )}
            </div>
        </div>
    );
}
