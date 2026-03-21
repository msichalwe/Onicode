import React, { useState, useEffect, useCallback } from 'react';
import { isElectron } from '../../utils';
import type { VaultCredential } from '../../types/window';

type CredentialType = 'api_key' | 'login' | 'secret' | 'oauth';

const TYPE_ICONS: Record<CredentialType, string> = {
    api_key: '🔑',
    login: '👤',
    secret: '🔒',
    oauth: '🔗',
};

const TYPE_LABELS: Record<CredentialType, string> = {
    api_key: 'API Key',
    login: 'Login',
    secret: 'Secret',
    oauth: 'OAuth Token',
};

interface FormState {
    title: string;
    description: string;
    type: CredentialType;
    service: string;
    tags: string;
    username: string;
    password: string;
    apiKey: string;
    token: string;
    refreshToken: string;
}

const EMPTY_FORM: FormState = {
    title: '', description: '', type: 'api_key', service: '', tags: '',
    username: '', password: '', apiKey: '', token: '', refreshToken: '',
};

export default function VaultTab() {
    const [credentials, setCredentials] = useState<VaultCredential[]>([]);
    const [vaultStatus, setVaultStatus] = useState<{ encrypted: boolean; algorithm: string; safeStorage: boolean; credentialCount: number } | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [filter, setFilter] = useState<CredentialType | 'all'>('all');

    // ── Load ──

    const loadCredentials = useCallback(async () => {
        if (!isElectron) return;
        try {
            const res = await window.onicode!.vaultList();
            setCredentials(res.credentials || []);
        } catch {}
    }, []);

    const loadStatus = useCallback(async () => {
        if (!isElectron) return;
        try {
            const res = await window.onicode!.vaultStatus();
            setVaultStatus(res);
        } catch {}
    }, []);

    useEffect(() => { loadCredentials(); loadStatus(); }, [loadCredentials, loadStatus]);

    // ── Search ──

    const filteredCredentials = useCallback(() => {
        let creds = credentials;
        if (filter !== 'all') creds = creds.filter(c => c.type === filter);
        if (!searchQuery.trim()) return creds;
        const q = searchQuery.toLowerCase();
        return creds.filter(c =>
            c.title.toLowerCase().includes(q) ||
            c.service.toLowerCase().includes(q) ||
            c.description.toLowerCase().includes(q) ||
            c.tags.some((t: string) => t.toLowerCase().includes(q))
        );
    }, [credentials, searchQuery, filter]);

    // ── CRUD ──

    const handleSave = useCallback(async () => {
        if (!isElectron || !form.title.trim()) return;
        setSaving(true);
        try {
            const id = editingId || form.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
            const entry: Record<string, unknown> = {
                title: form.title.trim(),
                description: form.description.trim(),
                type: form.type,
                service: form.service.trim(),
                tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
            };
            // Add type-specific fields
            if (form.type === 'api_key' && form.apiKey) entry.apiKey = form.apiKey;
            if (form.type === 'login') {
                if (form.username) entry.username = form.username;
                if (form.password) entry.password = form.password;
            }
            if (form.type === 'secret' && form.apiKey) entry.apiKey = form.apiKey;
            if (form.type === 'oauth') {
                if (form.token) entry.token = form.token;
                if (form.refreshToken) entry.refreshToken = form.refreshToken;
            }
            if (editingId) entry._update = true;
            await window.onicode!.vaultSave(id, entry as any);
            setShowForm(false);
            setEditingId(null);
            setForm(EMPTY_FORM);
            loadCredentials();
            loadStatus();
        } catch {}
        setSaving(false);
    }, [form, editingId, loadCredentials, loadStatus]);

    const handleEdit = useCallback((cred: VaultCredential) => {
        setEditingId(cred.id);
        setForm({
            title: cred.title,
            description: cred.description,
            type: cred.type,
            service: cred.service,
            tags: cred.tags.join(', '),
            username: '', password: '', apiKey: '', token: '', refreshToken: '',
        });
        setShowForm(true);
    }, []);

    const handleDelete = useCallback(async (id: string) => {
        if (!isElectron) return;
        if (!confirm('Delete this credential? This cannot be undone.')) return;
        await window.onicode!.vaultDelete(id);
        loadCredentials();
        loadStatus();
    }, [loadCredentials, loadStatus]);

    const handleCancel = useCallback(() => {
        setShowForm(false);
        setEditingId(null);
        setForm(EMPTY_FORM);
    }, []);

    const updateForm = (key: keyof FormState, value: string) => setForm(prev => ({ ...prev, [key]: value }));

    const displayed = filteredCredentials();

    // ── Render ──

    return (
        <div className="settings-section">
            {/* Status Header */}
            <div className="vault-status-header">
                <div className="vault-status-left">
                    <h3>Credential Vault</h3>
                    <p className="vault-status-desc">Encrypted storage for API keys, login credentials, secrets, and OAuth tokens. The AI can search and use these credentials when needed.</p>
                </div>
                {vaultStatus && (
                    <div className="vault-status-badges">
                        <span className="vault-badge vault-badge-encrypted">
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-1.5V4.5A3.5 3.5 0 0 0 8 1zm2 6H6V4.5a2 2 0 1 1 4 0V7z"/></svg>
                            {vaultStatus.algorithm}
                        </span>
                        {vaultStatus.safeStorage && (
                            <span className="vault-badge vault-badge-keychain">OS Keychain</span>
                        )}
                        <span className="vault-badge">{vaultStatus.credentialCount} credential{vaultStatus.credentialCount !== 1 ? 's' : ''}</span>
                    </div>
                )}
            </div>

            {/* Search & Filter Bar */}
            <div className="vault-toolbar">
                <div className="vault-search-wrap">
                    <input
                        type="text"
                        className="vault-search"
                        placeholder="Search credentials..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                </div>
                <div className="vault-filters">
                    {(['all', 'api_key', 'login', 'secret', 'oauth'] as const).map(f => (
                        <button key={f} className={`vault-filter-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                            {f === 'all' ? 'All' : TYPE_LABELS[f]}
                        </button>
                    ))}
                </div>
                <button className="vault-add-btn" onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM); }}>
                    + Add Credential
                </button>
            </div>

            {/* Add/Edit Form */}
            {showForm && (
                <div className="vault-form">
                    <h4>{editingId ? 'Edit Credential' : 'New Credential'}</h4>
                    <div className="vault-form-grid">
                        <div className="vault-form-row">
                            <label>Title *</label>
                            <input type="text" value={form.title} onChange={e => updateForm('title', e.target.value)} placeholder="e.g. My AWS Key, Facebook Login" />
                        </div>
                        <div className="vault-form-row">
                            <label>Service</label>
                            <input type="text" value={form.service} onChange={e => updateForm('service', e.target.value)} placeholder="e.g. aws, facebook, github" />
                        </div>
                        <div className="vault-form-row">
                            <label>Type</label>
                            <select value={form.type} onChange={e => updateForm('type', e.target.value)}>
                                <option value="api_key">API Key</option>
                                <option value="login">Login (Username + Password)</option>
                                <option value="secret">Secret</option>
                                <option value="oauth">OAuth Token</option>
                            </select>
                        </div>
                        <div className="vault-form-row">
                            <label>Description</label>
                            <input type="text" value={form.description} onChange={e => updateForm('description', e.target.value)} placeholder="What is this credential for?" />
                        </div>
                        <div className="vault-form-row">
                            <label>Tags</label>
                            <input type="text" value={form.tags} onChange={e => updateForm('tags', e.target.value)} placeholder="Comma-separated: social, production, dev" />
                        </div>
                    </div>

                    {/* Dynamic fields based on type */}
                    <div className="vault-form-fields">
                        {form.type === 'api_key' && (
                            <div className="vault-form-row">
                                <label>API Key</label>
                                <input type="password" value={form.apiKey} onChange={e => updateForm('apiKey', e.target.value)} placeholder={editingId ? '(leave blank to keep current)' : 'Enter API key'} />
                            </div>
                        )}
                        {form.type === 'login' && (
                            <>
                                <div className="vault-form-row">
                                    <label>Username / Email</label>
                                    <input type="text" value={form.username} onChange={e => updateForm('username', e.target.value)} placeholder={editingId ? '(leave blank to keep current)' : 'Enter username or email'} />
                                </div>
                                <div className="vault-form-row">
                                    <label>Password</label>
                                    <input type="password" value={form.password} onChange={e => updateForm('password', e.target.value)} placeholder={editingId ? '(leave blank to keep current)' : 'Enter password'} />
                                </div>
                            </>
                        )}
                        {form.type === 'secret' && (
                            <div className="vault-form-row">
                                <label>Secret Value</label>
                                <input type="password" value={form.apiKey} onChange={e => updateForm('apiKey', e.target.value)} placeholder={editingId ? '(leave blank to keep current)' : 'Enter secret value'} />
                            </div>
                        )}
                        {form.type === 'oauth' && (
                            <>
                                <div className="vault-form-row">
                                    <label>Access Token</label>
                                    <input type="password" value={form.token} onChange={e => updateForm('token', e.target.value)} placeholder={editingId ? '(leave blank to keep current)' : 'Enter access token'} />
                                </div>
                                <div className="vault-form-row">
                                    <label>Refresh Token</label>
                                    <input type="password" value={form.refreshToken} onChange={e => updateForm('refreshToken', e.target.value)} placeholder="Optional refresh token" />
                                </div>
                            </>
                        )}
                    </div>

                    <div className="vault-form-actions">
                        <button className="btn-secondary" onClick={handleCancel}>Cancel</button>
                        <button className="btn-primary" onClick={handleSave} disabled={saving || !form.title.trim()}>
                            {saving ? 'Saving...' : editingId ? 'Update' : 'Save'}
                        </button>
                    </div>
                </div>
            )}

            {/* Credential List */}
            {displayed.length === 0 && !showForm && (
                <div className="vault-empty">
                    <span className="vault-empty-icon">🔐</span>
                    <p>{credentials.length === 0 ? 'No credentials stored yet.' : 'No credentials match your search.'}</p>
                    {credentials.length === 0 && (
                        <p className="vault-empty-hint">Add API keys, login details, secrets, or OAuth tokens. The AI will search and use them automatically when needed.</p>
                    )}
                </div>
            )}

            <div className="vault-list">
                {displayed.map(cred => (
                    <div key={cred.id} className="vault-card">
                        <div className="vault-card-header">
                            <span className="vault-type-icon">{TYPE_ICONS[cred.type as CredentialType]}</span>
                            <div className="vault-card-title">
                                <span className="vault-card-name">{cred.title}</span>
                                <span className="vault-type-badge">{TYPE_LABELS[cred.type as CredentialType]}</span>
                            </div>
                            <div className="vault-card-actions">
                                <button className="vault-action-btn" onClick={() => handleEdit(cred)} title="Edit">
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5L13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5z"/></svg>
                                </button>
                                <button className="vault-action-btn vault-action-delete" onClick={() => handleDelete(cred.id)} title="Delete">
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4L4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
                                </button>
                            </div>
                        </div>
                        {cred.service && <div className="vault-card-service">{cred.service}</div>}
                        {cred.description && <div className="vault-card-desc">{cred.description}</div>}

                        {/* Masked values */}
                        <div className="vault-card-values">
                            {cred.maskedUsername && <span className="vault-masked"><span className="vault-masked-label">User:</span> {cred.maskedUsername}</span>}
                            {cred.maskedPassword && <span className="vault-masked"><span className="vault-masked-label">Pass:</span> {cred.maskedPassword}</span>}
                            {cred.maskedApiKey && <span className="vault-masked"><span className="vault-masked-label">Key:</span> {cred.maskedApiKey}</span>}
                            {cred.maskedToken && <span className="vault-masked"><span className="vault-masked-label">Token:</span> {cred.maskedToken}</span>}
                            {cred.hasRefreshToken && <span className="vault-masked"><span className="vault-masked-label">Refresh:</span> ••••••••</span>}
                        </div>

                        {/* Tags */}
                        {cred.tags.length > 0 && (
                            <div className="vault-card-tags">
                                {cred.tags.map((tag: string) => <span key={tag} className="vault-tag">{tag}</span>)}
                            </div>
                        )}

                        <div className="vault-card-meta">
                            Updated {new Date(cred.updatedAt).toLocaleDateString()}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
