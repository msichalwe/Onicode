import React, { useState, useEffect, useCallback } from 'react';

const API_BASE = 'http://187.124.115.69:4100';

interface OniAccount {
    token: string;
    oniId: string;
    email: string;
    name: string;
}

interface ProfileData {
    oniId: string;
    email: string;
    name: string;
    preferences: any;
    loginCount: number;
    codexConnected: boolean;
    machineIds: string[];
    createdAt: string;
    updatedAt: string;
}

export default function ProfileTab() {
    const [account, setAccount] = useState<OniAccount | null>(null);
    const [profile, setProfile] = useState<ProfileData | null>(null);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [editName, setEditName] = useState('');
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [loginEmail, setLoginEmail] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [loginStatus, setLoginStatus] = useState<'idle' | 'logging-in' | 'error'>('idle');
    const [loginError, setLoginError] = useState('');

    // Load account from localStorage
    useEffect(() => {
        const saved = localStorage.getItem('onicode-account');
        if (saved) {
            try {
                const acc = JSON.parse(saved);
                setAccount(acc);
                // Fetch full profile from API
                fetchProfile(acc.token);
            } catch {}
        }
        setLoading(false);
    }, []);

    const fetchProfile = async (token: string) => {
        try {
            const res = await fetch(`${API_BASE}/api/profile`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                if (data.success) setProfile(data.user);
            }
        } catch {}
    };

    const handleLogin = async () => {
        if (!loginEmail.trim() || !loginPassword.trim()) return;
        setLoginStatus('logging-in');
        setLoginError('');
        try {
            const res = await fetch(`${API_BASE}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword.trim() }),
            });
            const data = await res.json();
            if (data.success) {
                const acc = { token: data.token, oniId: data.user.oniId, email: data.user.email, name: data.user.name };
                localStorage.setItem('onicode-account', JSON.stringify(acc));
                setAccount(acc);
                setProfile(data.user as any);
                setLoginStatus('idle');
            } else {
                setLoginStatus('error');
                setLoginError(data.error || 'Login failed');
            }
        } catch {
            setLoginStatus('error');
            setLoginError('Could not connect to server');
        }
    };

    const handleSave = async () => {
        if (!account || !editName.trim()) return;
        setSaveStatus('saving');
        try {
            const res = await fetch(`${API_BASE}/api/profile`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.token}` },
                body: JSON.stringify({ name: editName.trim() }),
            });
            const data = await res.json();
            if (data.success) {
                setProfile(data.user);
                const updated = { ...account, name: editName.trim() };
                localStorage.setItem('onicode-account', JSON.stringify(updated));
                setAccount(updated);
                setSaveStatus('saved');
                setEditing(false);
                setTimeout(() => setSaveStatus('idle'), 2000);
            }
        } catch {
            setSaveStatus('error');
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('onicode-account');
        setAccount(null);
        setProfile(null);
    };

    if (loading) return <div className="profile-loading">Loading...</div>;

    // Not logged in — show login form
    if (!account) {
        return (
            <div className="profile-tab">
                <div className="profile-login-card">
                    <div className="profile-login-icon">Oni</div>
                    <h3>Sign in to your Oni account</h3>
                    <p>Access your profile, sync settings, and manage your account.</p>
                    <div className="profile-field">
                        <label>Email</label>
                        <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="your@email.com" />
                    </div>
                    <div className="profile-field">
                        <label>Password</label>
                        <input type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="Your password"
                            onKeyDown={e => e.key === 'Enter' && handleLogin()} />
                    </div>
                    {loginStatus === 'error' && <p className="profile-error">{loginError}</p>}
                    <button className="profile-btn-primary" onClick={handleLogin} disabled={loginStatus === 'logging-in'}>
                        {loginStatus === 'logging-in' ? 'Signing in...' : 'Sign In'}
                    </button>
                </div>
            </div>
        );
    }

    // Logged in — show profile
    return (
        <div className="profile-tab">
            <div className="profile-header">
                <div className="profile-avatar">{account.name?.[0]?.toUpperCase() || 'O'}</div>
                <div className="profile-info">
                    {editing ? (
                        <div className="profile-edit-row">
                            <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="profile-edit-input" />
                            <button className="profile-btn-sm" onClick={handleSave}>Save</button>
                            <button className="profile-btn-sm-secondary" onClick={() => setEditing(false)}>Cancel</button>
                        </div>
                    ) : (
                        <h3 className="profile-name">{account.name} <button className="profile-edit-btn" onClick={() => { setEditName(account.name); setEditing(true); }}>Edit</button></h3>
                    )}
                    <p className="profile-email">{account.email}</p>
                    <span className="profile-oni-id">{account.oniId}</span>
                </div>
                <button className="profile-logout" onClick={handleLogout}>Sign Out</button>
            </div>

            {profile && (
                <div className="profile-details">
                    <div className="profile-stat-row">
                        <div className="profile-stat">
                            <span className="profile-stat-value">{profile.loginCount || 0}</span>
                            <span className="profile-stat-label">Logins</span>
                        </div>
                        <div className="profile-stat">
                            <span className="profile-stat-value">{profile.machineIds?.length || 0}</span>
                            <span className="profile-stat-label">Devices</span>
                        </div>
                        <div className="profile-stat">
                            <span className={`profile-stat-value ${profile.codexConnected ? 'profile-connected' : ''}`}>
                                {profile.codexConnected ? 'Yes' : 'No'}
                            </span>
                            <span className="profile-stat-label">AI Connected</span>
                        </div>
                    </div>

                    {profile.preferences && (
                        <div className="profile-section">
                            <h4>Preferences</h4>
                            <div className="profile-prefs">
                                {profile.preferences.theme && <span className="profile-pref-tag">Theme: {profile.preferences.theme}</span>}
                                {profile.preferences.language && <span className="profile-pref-tag">Lang: {profile.preferences.language}</span>}
                                {profile.preferences.framework && <span className="profile-pref-tag">Framework: {profile.preferences.framework}</span>}
                                {profile.preferences.personality && <span className="profile-pref-tag">Tone: {profile.preferences.personality}</span>}
                            </div>
                        </div>
                    )}

                    <div className="profile-section">
                        <h4>Account Details</h4>
                        <div className="profile-detail-row">
                            <span>Created</span>
                            <span>{new Date(profile.createdAt).toLocaleDateString()}</span>
                        </div>
                        <div className="profile-detail-row">
                            <span>Last Updated</span>
                            <span>{new Date(profile.updatedAt).toLocaleDateString()}</span>
                        </div>
                    </div>
                </div>
            )}

            {saveStatus === 'saved' && <p className="profile-saved">Profile updated!</p>}
        </div>
    );
}
