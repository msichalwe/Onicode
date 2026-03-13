import React from 'react';
import type { McpTabProps } from './types';

export default function McpTab({
    mcpServers, showAddMCP, setShowAddMCP,
    mcpName, setMcpName, mcpCommand, setMcpCommand,
    mcpArgs, setMcpArgs, mcpEnv, setMcpEnv,
    mcpLoading,
    handleMCPConnect, handleMCPDisconnect, handleMCPRemove, handleMCPAdd,
}: McpTabProps) {
    return (
        <div className="settings-tab-content">
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

            <div className="settings-section">
                <h3>MCP Servers</h3>
                <p className="settings-section-desc">
                    Connect external MCP servers to extend the AI&apos;s capabilities. Tools from connected servers are automatically available.
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
                                        <button className="mcp-server-toggle disconnect" onClick={() => handleMCPDisconnect(s.name)}>
                                            Disconnect
                                        </button>
                                    ) : s.status === 'connecting' || mcpLoading.has(s.name) ? (
                                        <button className="mcp-server-toggle" disabled>Connecting...</button>
                                    ) : (
                                        <button className="mcp-server-toggle connect" onClick={() => handleMCPConnect(s.name)}>
                                            Connect
                                        </button>
                                    )}
                                    <button className="mcp-server-remove" onClick={() => handleMCPRemove(s.name)} title="Remove server">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {!showAddMCP ? (
                    <button className="mcp-add-btn" onClick={() => setShowAddMCP(true)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                        Add MCP Server
                    </button>
                ) : (
                    <div className="mcp-add-form">
                        <label>Name</label>
                        <input type="text" placeholder="e.g. postgres, github, slack" value={mcpName} onChange={e => setMcpName(e.target.value)} />
                        <label>Command</label>
                        <input type="text" placeholder="e.g. npx, node, python" value={mcpCommand} onChange={e => setMcpCommand(e.target.value)} />
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

                <div className="mcp-examples">
                    <p className="settings-section-desc" style={{ marginTop: 12 }}>
                        Popular servers: <code>@modelcontextprotocol/server-postgres</code>, <code>@modelcontextprotocol/server-github</code>, <code>@modelcontextprotocol/server-puppeteer</code>, <code>@modelcontextprotocol/server-filesystem</code>
                    </p>
                    <p className="settings-section-desc">
                        Config file: <code>~/.onicode/mcp.json</code> — you can also edit this file directly.
                    </p>
                </div>
            </div>
        </div>
    );
}
