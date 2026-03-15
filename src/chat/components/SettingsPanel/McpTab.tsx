import React, { useState, useEffect, useCallback } from 'react';
import { isElectron } from '../../utils';
import type { McpTabProps } from './types';

const CATEGORY_ICONS: Record<string, string> = {
    'Databases': '🗄',
    'Browser & Web': '🌐',
    'Communication': '💬',
    'DevOps & Cloud': '☁',
    'File Systems': '📂',
    'Version Control': '🔀',
    'AI & LLM': '🤖',
    'Data & Analytics': '📊',
    'Design & Media': '🎨',
    'Security': '🔒',
    'Finance': '💰',
    'Productivity': '✅',
    'Code Execution': '⚡',
};

export default function McpTab({
    mcpServers, showAddMCP, setShowAddMCP,
    mcpName, setMcpName, mcpCommand, setMcpCommand,
    mcpArgs, setMcpArgs, mcpEnv, setMcpEnv,
    mcpLoading,
    handleMCPConnect, handleMCPDisconnect, handleMCPRemove, handleMCPAdd,
    installFromCatalog,
}: McpTabProps) {
    const [catalogView, setCatalogView] = useState<'installed' | 'catalog'>('installed');
    const [catalog, setCatalog] = useState<MCPCatalogEntry[]>([]);
    const [categories, setCategories] = useState<Array<{ name: string; count: number }>>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('');
    const [searchQuery, setSearchQuery] = useState('');
    const [installing, setInstalling] = useState<Set<string>>(new Set());

    // Load catalog
    const loadCatalog = useCallback(async () => {
        if (!isElectron) return;
        try {
            if (searchQuery.trim()) {
                const res = await window.onicode!.mcpCatalogSearch(searchQuery, 30);
                setCatalog(res.servers);
            } else {
                const res = await window.onicode!.mcpCatalogList(selectedCategory || undefined);
                setCatalog(res.servers);
                if (!selectedCategory) setCategories(res.categories);
            }
        } catch { /* catalog not ready */ }
    }, [searchQuery, selectedCategory]);

    useEffect(() => {
        if (catalogView === 'catalog') loadCatalog();
    }, [catalogView, loadCatalog]);

    const installedIds = new Set(mcpServers.map(s => s.name));

    const handleInstall = async (entry: MCPCatalogEntry) => {
        setInstalling(prev => new Set(prev).add(entry.id));
        try {
            await installFromCatalog(entry);
        } finally {
            setInstalling(prev => { const n = new Set(prev); n.delete(entry.id); return n; });
        }
    };

    const filteredCatalog = selectedCategory
        ? catalog.filter(s => s.category === selectedCategory)
        : catalog;

    return (
        <div className="settings-tab-content">
            {/* Tab switcher */}
            <div className="mcp-view-switcher">
                <button className={`mcp-view-btn ${catalogView === 'installed' ? 'active' : ''}`} onClick={() => setCatalogView('installed')}>
                    Installed ({mcpServers.length})
                </button>
                <button className={`mcp-view-btn ${catalogView === 'catalog' ? 'active' : ''}`} onClick={() => setCatalogView('catalog')}>
                    Server Catalog ({catalog.length > 0 ? catalog.length + '+' : '55+'})
                </button>
            </div>

            {catalogView === 'installed' ? (
                <>
                    {/* Built-in capabilities */}
                    <div className="settings-section">
                        <h3>Built-in Capabilities</h3>
                        <p className="settings-section-desc">Native tools bundled with Onicode — always available to the AI.</p>
                        <div className="mcp-server-list">
                            {[
                                { name: 'Filesystem', desc: '7 file operations — read, edit, create, delete, search, glob, list' },
                                { name: 'Browser', desc: '8 browser tools — navigate, screenshot, click, type, wait, evaluate, console, close' },
                                { name: 'Terminal', desc: 'Shell execution, background processes, dev server management' },
                                { name: 'Git', desc: '9 git tools — status, diff, log, branches, commit, push, pull, stash, checkout' },
                                { name: 'Memory', desc: 'Persistent cross-session memory — read, write, append' },
                                { name: 'Web Research', desc: 'Web fetch and search — fetch pages, search DuckDuckGo' },
                                { name: 'Code Intelligence', desc: 'LSP + semantic search — symbols, references, types, TF-IDF' },
                                { name: 'Orchestrator', desc: 'Multi-agent system — 5 specialist roles, parallel execution' },
                            ].map(s => (
                                <div key={s.name} className="mcp-server-item mcp-server-builtin">
                                    <div className="mcp-server-status connected" />
                                    <div className="mcp-server-info">
                                        <div className="mcp-server-name">{s.name}</div>
                                        <div className="mcp-server-desc">{s.desc}</div>
                                    </div>
                                    <span className="mcp-builtin-badge">Active</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Installed MCP servers */}
                    <div className="settings-section">
                        <h3>MCP Servers</h3>
                        <p className="settings-section-desc">
                            Connected external servers. Tools from connected servers are automatically available to the AI.
                        </p>

                        {mcpServers.length > 0 && (
                            <div className="mcp-server-list">
                                {mcpServers.map(s => (
                                    <div key={s.name} className="mcp-server-item mcp-server-external">
                                        <div className="mcp-server-status-row">
                                            <div className={`mcp-server-status ${s.status}`} />
                                            <div className="mcp-server-info">
                                                <div className="mcp-server-name">{s.name}</div>
                                                <div className="mcp-server-command">{s.config.command} {(s.config.args || []).join(' ')}</div>
                                                {s.error && <div className="mcp-server-error">{s.error}</div>}
                                            </div>
                                        </div>
                                        <div className="mcp-server-actions">
                                            {s.status === 'connected' && s.toolCount > 0 && (
                                                <span className="mcp-server-tools-badge">{s.toolCount} tool{s.toolCount !== 1 ? 's' : ''}</span>
                                            )}
                                            {s.status === 'connected' ? (
                                                <button className="mcp-server-toggle disconnect" onClick={() => handleMCPDisconnect(s.name)}>Disconnect</button>
                                            ) : s.status === 'connecting' || mcpLoading.has(s.name) ? (
                                                <button className="mcp-server-toggle" disabled>Connecting...</button>
                                            ) : (
                                                <button className="mcp-server-toggle connect" onClick={() => handleMCPConnect(s.name)}>Connect</button>
                                            )}
                                            <button className="mcp-server-remove" onClick={() => handleMCPRemove(s.name)} title="Remove server">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {mcpServers.length === 0 && (
                            <div className="mcp-empty">
                                <p>No MCP servers installed</p>
                                <button className="mcp-browse-btn" onClick={() => setCatalogView('catalog')}>
                                    Browse Server Catalog
                                </button>
                            </div>
                        )}

                        {/* Add custom server */}
                        {!showAddMCP ? (
                            <button className="mcp-add-btn" onClick={() => setShowAddMCP(true)}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                                Add Custom Server
                            </button>
                        ) : (
                            <div className="mcp-add-form">
                                <label>Name</label>
                                <input type="text" placeholder="e.g. postgres, github, slack" value={mcpName} onChange={e => setMcpName(e.target.value)} />
                                <label>Command</label>
                                <input type="text" placeholder="e.g. npx, node, python, uvx" value={mcpCommand} onChange={e => setMcpCommand(e.target.value)} />
                                <label>Arguments (comma-separated)</label>
                                <input type="text" placeholder="e.g. -y, @modelcontextprotocol/server-postgres, postgresql://localhost/mydb" value={mcpArgs} onChange={e => setMcpArgs(e.target.value)} />
                                <label>Environment Variables (optional, KEY=VALUE per line)</label>
                                <textarea rows={2} placeholder="DATABASE_URL=postgresql://..." value={mcpEnv} onChange={e => setMcpEnv(e.target.value)} />
                                <div className="mcp-add-form-actions">
                                    <button className="mcp-server-toggle" onClick={() => setShowAddMCP(false)}>Cancel</button>
                                    <button className="mcp-server-toggle connect" onClick={handleMCPAdd} disabled={!mcpName.trim() || !mcpCommand.trim()}>Add & Connect</button>
                                </div>
                            </div>
                        )}

                        <p className="settings-section-desc" style={{ marginTop: 8 }}>
                            Config: <code>~/.onicode/mcp.json</code> — the AI can also discover servers via <code>mcp_search</code>.
                        </p>
                    </div>
                </>
            ) : (
                /* ═══════ CATALOG VIEW ═══════ */
                <div className="settings-section">
                    <h3>Server Catalog</h3>
                    <p className="settings-section-desc">
                        55+ MCP servers ready to install. The AI also uses <code>mcp_search</code> to find relevant servers automatically.
                    </p>

                    {/* Search */}
                    <div className="mcp-catalog-search">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, opacity: 0.5 }}>
                            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                        </svg>
                        <input
                            type="text"
                            placeholder="Search servers... (e.g. postgres, slack, deploy, kubernetes)"
                            value={searchQuery}
                            onChange={e => { setSearchQuery(e.target.value); setSelectedCategory(''); }}
                        />
                        {searchQuery && (
                            <button className="mcp-search-clear" onClick={() => setSearchQuery('')}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                        )}
                    </div>

                    {/* Category pills */}
                    {!searchQuery && (
                        <div className="mcp-category-pills">
                            <button
                                className={`mcp-cat-pill ${!selectedCategory ? 'active' : ''}`}
                                onClick={() => setSelectedCategory('')}
                            >All ({categories.reduce((s, c) => s + c.count, 0)})</button>
                            {categories.map(cat => (
                                <button
                                    key={cat.name}
                                    className={`mcp-cat-pill ${selectedCategory === cat.name ? 'active' : ''}`}
                                    onClick={() => setSelectedCategory(selectedCategory === cat.name ? '' : cat.name)}
                                >
                                    {CATEGORY_ICONS[cat.name] || '📦'} {cat.name} ({cat.count})
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Server cards */}
                    <div className="mcp-catalog-grid">
                        {filteredCatalog.map(entry => {
                            const isInstalled = installedIds.has(entry.id);
                            const isInstalling = installing.has(entry.id);
                            return (
                                <div key={entry.id} className={`mcp-catalog-card ${isInstalled ? 'installed' : ''}`}>
                                    <div className="mcp-catalog-card-header">
                                        <span className="mcp-catalog-card-icon">{CATEGORY_ICONS[entry.category] || '📦'}</span>
                                        <div className="mcp-catalog-card-title">
                                            <span className="mcp-catalog-card-name">{entry.name}</span>
                                            <span className="mcp-catalog-card-category">{entry.category}</span>
                                        </div>
                                        {isInstalled ? (
                                            <span className="mcp-catalog-installed-badge">Installed</span>
                                        ) : (
                                            <button
                                                className="mcp-catalog-install-btn"
                                                onClick={() => handleInstall(entry)}
                                                disabled={isInstalling}
                                            >
                                                {isInstalling ? 'Installing...' : 'Install'}
                                            </button>
                                        )}
                                    </div>
                                    <p className="mcp-catalog-card-desc">{entry.description}</p>
                                    <div className="mcp-catalog-card-footer">
                                        <code className="mcp-catalog-card-cmd">{entry.command} {entry.args.slice(0, 3).join(' ')}</code>
                                        {entry.env && Object.keys(entry.env).length > 0 && (
                                            <span className="mcp-catalog-env-hint" title={Object.keys(entry.env).join(', ')}>
                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                                                {Object.keys(entry.env).length} env var{Object.keys(entry.env).length > 1 ? 's' : ''}
                                            </span>
                                        )}
                                    </div>
                                    <div className="mcp-catalog-tags">
                                        {entry.tags.slice(0, 5).map(t => (
                                            <span key={t} className="mcp-catalog-tag" onClick={() => { setSearchQuery(t); setSelectedCategory(''); }}>{t}</span>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {filteredCatalog.length === 0 && searchQuery && (
                        <div className="mcp-empty">
                            <p>No servers match &ldquo;{searchQuery}&rdquo;</p>
                            <span>Try different keywords or browse by category.</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
