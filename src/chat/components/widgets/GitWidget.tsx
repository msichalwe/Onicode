import React, { useState, useEffect, useRef, useCallback } from 'react';
import { isElectron } from '../../utils';

interface GitFile { path: string; status: string; staged: boolean }
interface GitBranch { name: string; current: boolean; remote: boolean; hash?: string; upstream?: string | null }
interface GitGraphEntry { hash: string; shortHash: string; author: string; timestamp: number; message: string; parents: string[]; refs: string[] }
interface PREntry { number: number; title: string; state: string; url: string; author: string; head: string; base: string; draft: boolean; labels: string[]; createdAt: string; updatedAt: string }
interface RemoteEntry { name: string; fetchUrl: string; pushUrl: string }

type GitTab = 'changes' | 'graph' | 'stash' | 'prs' | 'sync';

function GitWidget() {
    // ── Core State ──
    const [branch, setBranch] = useState('');
    const [files, setFiles] = useState<GitFile[]>([]);
    const [branches, setBranches] = useState<GitBranch[]>([]);
    const [ahead, setAhead] = useState(0);
    const [behind, setBehind] = useState(0);
    const [commitMsg, setCommitMsg] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showBranches, setShowBranches] = useState(false);
    const [repoPath, setRepoPath] = useState('');
    const [isRepo, setIsRepo] = useState(false);
    const [actionLog, setActionLog] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState<GitTab>('changes');
    const [graphCommits, setGraphCommits] = useState<GitGraphEntry[]>([]);
    const [stashes, setStashes] = useState<string[]>([]);
    const [newBranchName, setNewBranchName] = useState('');
    const [showNewBranch, setShowNewBranch] = useState(false);
    const [mergeBranch, setMergeBranch] = useState('');
    const [showMerge, setShowMerge] = useState(false);
    const [stashMsg, setStashMsg] = useState('');

    // ── GitHub / Sync State ──
    const [githubConnected, setGithubConnected] = useState(false);
    const [githubUser, setGithubUser] = useState('');
    const [prs, setPrs] = useState<PREntry[]>([]);
    const [prFilter, setPrFilter] = useState<'open' | 'closed' | 'all'>('open');
    const [remotes, setRemotes] = useState<RemoteEntry[]>([]);
    const [showCreatePR, setShowCreatePR] = useState(false);
    const [prTitle, setPrTitle] = useState('');
    const [prBody, setPrBody] = useState('');
    const [prBase, setPrBase] = useState('main');
    const [showPublish, setShowPublish] = useState(false);
    const [publishName, setPublishName] = useState('');
    const [publishPrivate, setPublishPrivate] = useState(true);
    const [addRemoteUrl, setAddRemoteUrl] = useState('');
    const [showAddRemote, setShowAddRemote] = useState(false);

    const addLog = useCallback((msg: string) => {
        setActionLog(prev => [...prev.slice(-10), `${new Date().toLocaleTimeString()} — ${msg}`]);
    }, []);

    const getProjectPath = useCallback(() => {
        try {
            const stored = localStorage.getItem('onicode-active-project');
            if (stored) return JSON.parse(stored).path || '';
        } catch {}
        return '';
    }, []);

    // ── Check GitHub connection ──
    const checkGithub = useCallback(async () => {
        if (!isElectron || !window.onicode?.gitGithubStatus) return;
        try {
            const status = await window.onicode.gitGithubStatus();
            setGithubConnected(status.connected);
            if (status.connected) setGithubUser(status.username || '');
        } catch {}
    }, []);

    // ── Refresh git status ──
    const refreshStatus = useCallback(async () => {
        const projPath = repoPath || getProjectPath();
        if (!projPath || !isElectron || !window.onicode?.gitStatus) return;
        setRepoPath(projPath);
        try {
            const repoCheck = await window.onicode.gitIsRepo(projPath);
            setIsRepo(repoCheck.isRepo);
            if (!repoCheck.isRepo) return;
            const status = await window.onicode.gitStatus(projPath);
            if (status.success) {
                setBranch(status.branch || 'unknown');
                setFiles(status.files || []);
                setAhead(status.ahead || 0);
                setBehind(status.behind || 0);
                setError('');
            } else if (status.error) {
                setError(status.error);
            }
        } catch {
            setError('Failed to get git status');
        }
    }, [repoPath, getProjectPath]);

    const loadBranches = useCallback(async () => {
        const projPath = repoPath || getProjectPath();
        if (!projPath || !window.onicode?.gitBranches) return;
        const result = await window.onicode.gitBranches(projPath);
        if (result.success) setBranches(result.branches || []);
    }, [repoPath, getProjectPath]);

    const loadRemotes = useCallback(async () => {
        const projPath = repoPath || getProjectPath();
        if (!projPath || !window.onicode?.gitRemotes) return;
        const result = await window.onicode.gitRemotes(projPath);
        if (result.success) setRemotes(result.remotes || []);
    }, [repoPath, getProjectPath]);

    // ── Init ──
    useEffect(() => {
        refreshStatus();
        checkGithub();
        const interval = setInterval(refreshStatus, 10000);
        return () => clearInterval(interval);
    }, [refreshStatus, checkGithub]);

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.path) { setRepoPath(detail.path); setTimeout(refreshStatus, 500); }
        };
        window.addEventListener('onicode-project-activate', handler);
        return () => window.removeEventListener('onicode-project-activate', handler);
    }, [refreshStatus]);

    // ── File Operations ──
    const stageFile = useCallback(async (filePath: string) => {
        if (!window.onicode?.gitStage) return;
        await window.onicode.gitStage(repoPath, [filePath]);
        addLog(`Staged: ${filePath}`);
        refreshStatus();
    }, [repoPath, refreshStatus, addLog]);

    const unstageFile = useCallback(async (filePath: string) => {
        if (!window.onicode?.gitUnstage) return;
        await window.onicode.gitUnstage(repoPath, [filePath]);
        addLog(`Unstaged: ${filePath}`);
        refreshStatus();
    }, [repoPath, refreshStatus, addLog]);

    const stageAll = useCallback(async () => {
        if (!window.onicode?.gitStage) return;
        await window.onicode.gitStage(repoPath, ['.']);
        addLog('Staged all files');
        refreshStatus();
    }, [repoPath, refreshStatus, addLog]);

    // ── Commit ──
    const doCommit = useCallback(async () => {
        if (!commitMsg.trim() || !window.onicode?.gitCommit) return;
        setLoading(true);
        try {
            const result = await window.onicode.gitCommit(repoPath, commitMsg.trim());
            if (result.success) {
                addLog(`Committed: ${commitMsg.trim()}`);
                setCommitMsg('');
                refreshStatus();
            } else {
                setError(result.error || 'Commit failed');
            }
        } catch { setError('Commit failed'); }
        setLoading(false);
    }, [repoPath, commitMsg, refreshStatus, addLog]);

    // ── Push/Pull (with auth fallback) ──
    const doPush = useCallback(async () => {
        setLoading(true);
        try {
            // Try authenticated push first if GitHub connected
            if (githubConnected && window.onicode?.gitPushAuth) {
                const result = await window.onicode.gitPushAuth(repoPath, 'origin', branch);
                if (result.success) { addLog('Pushed to remote (authenticated)'); refreshStatus(); setLoading(false); return; }
            }
            // Fallback to regular push
            if (!window.onicode?.gitPush) { setLoading(false); return; }
            const result = await window.onicode.gitPush(repoPath);
            if (result.success) { addLog('Pushed to remote'); refreshStatus(); }
            else { setError(result.error || 'Push failed. Connect GitHub in Settings for auth.'); }
        } catch { setError('Push failed'); }
        setLoading(false);
    }, [repoPath, branch, githubConnected, refreshStatus, addLog]);

    const doPull = useCallback(async () => {
        setLoading(true);
        try {
            if (githubConnected && window.onicode?.gitPullAuth) {
                const result = await window.onicode.gitPullAuth(repoPath, 'origin');
                if (result.success) { addLog('Pulled from remote (authenticated)'); refreshStatus(); setLoading(false); return; }
            }
            if (!window.onicode?.gitPull) { setLoading(false); return; }
            const result = await window.onicode.gitPull(repoPath);
            if (result.success) { addLog('Pulled from remote'); refreshStatus(); }
            else { setError(result.error || 'Pull failed'); }
        } catch { setError('Pull failed'); }
        setLoading(false);
    }, [repoPath, githubConnected, refreshStatus, addLog]);

    // ── Branch Operations ──
    const checkoutBranch = useCallback(async (branchName: string) => {
        if (!window.onicode?.gitCheckout) return;
        setLoading(true);
        const result = await window.onicode.gitCheckout(repoPath, branchName, false);
        if (result.success) { addLog(`Switched to: ${branchName}`); setShowBranches(false); refreshStatus(); }
        else setError(result.error || 'Checkout failed');
        setLoading(false);
    }, [repoPath, refreshStatus, addLog]);

    const initRepo = useCallback(async () => {
        const projPath = getProjectPath();
        if (!projPath || !window.onicode?.gitInit) return;
        const result = await window.onicode.gitInit(projPath);
        if (result.success) { setRepoPath(projPath); addLog('Initialized git repository'); refreshStatus(); }
    }, [getProjectPath, refreshStatus, addLog]);

    const createBranch = useCallback(async () => {
        if (!newBranchName.trim() || !window.onicode?.gitCheckout) return;
        setLoading(true);
        const result = await window.onicode.gitCheckout(repoPath, newBranchName.trim(), true);
        if (result.success) { addLog(`Created branch: ${newBranchName.trim()}`); setNewBranchName(''); setShowNewBranch(false); refreshStatus(); loadBranches(); }
        else setError(result.error || 'Branch creation failed');
        setLoading(false);
    }, [repoPath, newBranchName, refreshStatus, loadBranches, addLog]);

    const doMerge = useCallback(async () => {
        if (!mergeBranch || !window.onicode?.gitMerge) return;
        setLoading(true);
        try {
            const result = await window.onicode.gitMerge(repoPath, mergeBranch);
            if (result.success) { addLog(`Merged: ${mergeBranch} → ${branch}`); setMergeBranch(''); setShowMerge(false); refreshStatus(); }
            else setError(result.error || 'Merge failed');
        } catch { setError('Merge failed'); }
        setLoading(false);
    }, [repoPath, mergeBranch, branch, refreshStatus, addLog]);

    // ── Graph ──
    const loadGraph = useCallback(async () => {
        const projPath = repoPath || getProjectPath();
        if (!projPath || !window.onicode?.gitLogGraph) return;
        try {
            const result = await window.onicode.gitLogGraph(projPath, 50);
            if (result.success && result.commits) setGraphCommits(result.commits);
        } catch {}
    }, [repoPath, getProjectPath]);

    // ── Stash ──
    const loadStashes = useCallback(async () => {
        const projPath = repoPath || getProjectPath();
        if (!projPath || !window.onicode?.gitStash) return;
        try {
            const result = await window.onicode.gitStash(projPath, 'list');
            if (result.success) setStashes(result.stashes || []);
        } catch {}
    }, [repoPath, getProjectPath]);

    const doStashPush = useCallback(async () => {
        if (!window.onicode?.gitStash) return;
        setLoading(true);
        const result = await window.onicode.gitStash(repoPath, 'push', stashMsg || undefined);
        if (result.success) { addLog(`Stashed${stashMsg ? `: ${stashMsg}` : ''}`); setStashMsg(''); refreshStatus(); loadStashes(); }
        else setError(result.error || 'Stash failed');
        setLoading(false);
    }, [repoPath, stashMsg, refreshStatus, loadStashes, addLog]);

    const doStashPop = useCallback(async () => {
        if (!window.onicode?.gitStash) return;
        setLoading(true);
        const result = await window.onicode.gitStash(repoPath, 'pop');
        if (result.success) { addLog('Popped latest stash'); refreshStatus(); loadStashes(); }
        else setError(result.error || 'Stash pop failed');
        setLoading(false);
    }, [repoPath, refreshStatus, loadStashes, addLog]);

    const doStashDrop = useCallback(async (index: number) => {
        if (!window.onicode?.gitStashDrop) return;
        const result = await window.onicode.gitStashDrop(repoPath, index);
        if (result.success) { addLog(`Dropped stash@{${index}}`); loadStashes(); }
        else setError(result.error || 'Drop failed');
    }, [repoPath, loadStashes, addLog]);

    // ── Pull Requests ──
    const loadPRs = useCallback(async () => {
        if (!githubConnected || !window.onicode?.gitGithubListPRs) return;
        try {
            const result = await window.onicode.gitGithubListPRs(repoPath, prFilter);
            if (result.success) setPrs(result.prs || []);
            else if (result.error) setError(result.error);
        } catch {}
    }, [repoPath, githubConnected, prFilter]);

    const createPR = useCallback(async () => {
        if (!prTitle.trim() || !window.onicode?.gitGithubCreatePR) return;
        setLoading(true);
        try {
            const result = await window.onicode.gitGithubCreatePR(repoPath, prTitle.trim(), prBody, branch, prBase);
            if (result.success && result.pr) {
                addLog(`PR #${result.pr.number} created`);
                setPrTitle(''); setPrBody(''); setShowCreatePR(false);
                loadPRs();
            } else {
                setError(result.error || 'PR creation failed');
            }
        } catch { setError('PR creation failed'); }
        setLoading(false);
    }, [repoPath, prTitle, prBody, branch, prBase, loadPRs, addLog]);

    // ── Publish (create GitHub repo + set remote) ──
    const publishRepo = useCallback(async () => {
        if (!publishName.trim() || !window.onicode?.gitGithubCreateRepo) return;
        setLoading(true);
        try {
            const result = await window.onicode.gitGithubCreateRepo(publishName.trim(), '', publishPrivate);
            if (result.success && result.repo) {
                // Add origin remote
                await window.onicode.gitRemoteAdd!(repoPath, 'origin', result.repo.cloneUrl);
                // Push
                if (window.onicode.gitPushAuth) {
                    await window.onicode.gitPushAuth(repoPath, 'origin', branch);
                }
                addLog(`Published to GitHub: ${result.repo.fullName}`);
                setShowPublish(false); setPublishName('');
                loadRemotes();
                refreshStatus();
            } else {
                setError(result.error || 'Publish failed');
            }
        } catch (e) { setError('Publish failed'); }
        setLoading(false);
    }, [repoPath, publishName, publishPrivate, branch, refreshStatus, loadRemotes, addLog]);

    // ── Add Remote ──
    const doAddRemote = useCallback(async () => {
        if (!addRemoteUrl.trim() || !window.onicode?.gitRemoteAdd) return;
        const result = await window.onicode.gitRemoteAdd(repoPath, 'origin', addRemoteUrl.trim());
        if (result.success) { addLog('Remote added'); setAddRemoteUrl(''); setShowAddRemote(false); loadRemotes(); refreshStatus(); }
        else setError(result.error || 'Failed to add remote');
    }, [repoPath, addRemoteUrl, loadRemotes, refreshStatus, addLog]);

    // ── Tab data loading ──
    useEffect(() => {
        if (activeTab === 'graph') loadGraph();
        if (activeTab === 'stash') loadStashes();
        if (activeTab === 'prs') loadPRs();
        if (activeTab === 'sync') loadRemotes();
    }, [activeTab, loadGraph, loadStashes, loadPRs, loadRemotes]);

    const stagedFiles = files.filter(f => f.staged);
    const unstagedFiles = files.filter(f => !f.staged);

    if (!repoPath && !getProjectPath()) {
        return (<div className="widget-git"><div className="git-empty">No project selected. Open a project to use Git.</div></div>);
    }

    if (!isRepo) {
        return (
            <div className="widget-git">
                <div className="git-empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 24 }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3 }}>
                        <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 012 2v7" /><line x1="6" y1="9" x2="6" y2="21" />
                    </svg>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Not a git repository</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                        Version control is essential. Initialize a repository to track changes.
                    </div>
                    <button className="git-action-btn" onClick={initRepo} style={{ marginTop: 4 }}>Initialize Repository</button>
                </div>
            </div>
        );
    }

    const formatTimeAgo = (ts: number) => {
        const d = Date.now() - ts;
        if (d < 60000) return 'just now';
        if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
        if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
        return `${Math.floor(d / 86400000)}d ago`;
    };

    const hasOrigin = remotes.some(r => r.name === 'origin');

    return (
        <div className="widget-git">
            {/* GitHub account bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', fontSize: 10, color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: githubConnected ? 'var(--success)' : 'var(--text-tertiary)', flexShrink: 0 }} />
                {githubConnected ? (
                    <span>GitHub: <strong style={{ color: 'var(--text-secondary)' }}>{githubUser}</strong></span>
                ) : (
                    <span>GitHub not connected — <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => window.dispatchEvent(new CustomEvent('onicode-navigate', { detail: { view: 'settings', tab: 'connectors' } }))}>connect in Settings</span></span>
                )}
                {isRepo && !hasOrigin && githubConnected && (
                    <button style={{ marginLeft: 'auto', fontSize: 10, padding: '1px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--accent)', color: 'var(--text-on-accent, #fff)', cursor: 'pointer' }} onClick={() => { setPublishName(getProjectPath().split('/').pop() || ''); setShowPublish(true); }}>
                        Publish
                    </button>
                )}
                {isRepo && !hasOrigin && !githubConnected && (
                    <button style={{ marginLeft: 'auto', fontSize: 10, padding: '1px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer' }} onClick={() => setShowAddRemote(true)}>
                        Add Remote
                    </button>
                )}
            </div>

            {/* Publish dialog */}
            {showPublish && (
                <div style={{ padding: 8, borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 600 }}>Publish to GitHub</div>
                    <input style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }}
                        value={publishName} onChange={e => setPublishName(e.target.value)} placeholder="Repository name" />
                    <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="checkbox" checked={publishPrivate} onChange={e => setPublishPrivate(e.target.checked)} /> Private repository
                    </label>
                    <div style={{ display: 'flex', gap: 4 }}>
                        <button className="git-action-btn" onClick={publishRepo} disabled={loading || !publishName.trim()}>Create & Push</button>
                        <button className="git-action-btn git-action-secondary" onClick={() => setShowPublish(false)}>Cancel</button>
                    </div>
                </div>
            )}

            {/* Add remote dialog */}
            {showAddRemote && (
                <div style={{ padding: 8, borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 600 }}>Add Remote Origin</div>
                    <input style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 11, outline: 'none', fontFamily: 'JetBrains Mono, monospace' }}
                        value={addRemoteUrl} onChange={e => setAddRemoteUrl(e.target.value)} placeholder="https://github.com/user/repo.git" />
                    <div style={{ display: 'flex', gap: 4 }}>
                        <button className="git-action-btn" onClick={doAddRemote} disabled={!addRemoteUrl.trim()}>Add</button>
                        <button className="git-action-btn git-action-secondary" onClick={() => setShowAddRemote(false)}>Cancel</button>
                    </div>
                </div>
            )}

            {/* Branch bar */}
            <div className="git-branch-bar">
                <button className="git-branch-btn" onClick={() => { setShowBranches(!showBranches); if (!showBranches) loadBranches(); }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 01-9 9" />
                    </svg>
                    {branch || 'main'}
                </button>
                <div className="git-sync-info">
                    {ahead > 0 && <span className="git-ahead" title={`${ahead} ahead`}>{ahead}↑</span>}
                    {behind > 0 && <span className="git-behind" title={`${behind} behind`}>{behind}↓</span>}
                </div>
                <div className="git-sync-actions">
                    <button className="git-icon-btn" onClick={doPull} disabled={loading} title="Pull">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="8 17 12 21 16 17" /><line x1="12" y1="12" x2="12" y2="21" /><path d="M20.88 18.09A5 5 0 0018 9h-1.26A8 8 0 103 16.29" /></svg>
                    </button>
                    <button className="git-icon-btn" onClick={doPush} disabled={loading} title="Push">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" /><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" /></svg>
                    </button>
                    <button className="git-icon-btn" onClick={() => { setShowMerge(!showMerge); if (!showMerge) loadBranches(); }} disabled={loading} title="Merge">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M6 21V9a9 9 0 009 9" /></svg>
                    </button>
                    <button className="git-icon-btn" onClick={refreshStatus} title="Refresh">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
                    </button>
                </div>
            </div>

            {/* Branch dropdown */}
            {showBranches && (
                <div className="git-branches-dropdown">
                    {branches.filter(b => !b.remote).map(b => (
                        <button key={b.name} className={`git-branch-option ${b.current ? 'current' : ''}`} onClick={() => checkoutBranch(b.name)}>
                            {b.current && <span className="git-branch-current-dot" />}
                            {b.name}
                        </button>
                    ))}
                    <div className="git-branch-new">
                        {showNewBranch ? (
                            <div className="git-new-branch-form">
                                <input className="git-new-branch-input" value={newBranchName} onChange={e => setNewBranchName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') createBranch(); if (e.key === 'Escape') setShowNewBranch(false); }}
                                    placeholder="new-branch-name" autoFocus />
                                <button className="git-new-branch-ok" onClick={createBranch} disabled={!newBranchName.trim()}>Create</button>
                            </div>
                        ) : (
                            <button className="git-branch-option git-new-branch-btn" onClick={() => setShowNewBranch(true)}>+ New Branch</button>
                        )}
                    </div>
                </div>
            )}

            {/* Merge panel */}
            {showMerge && (
                <div className="git-merge-panel">
                    <div className="git-merge-label">Merge into <strong>{branch}</strong>:</div>
                    <select className="git-merge-select" value={mergeBranch} onChange={e => setMergeBranch(e.target.value)}>
                        <option value="">Select branch...</option>
                        {branches.filter(b => !b.current && !b.remote).map(b => (
                            <option key={b.name} value={b.name}>{b.name}</option>
                        ))}
                    </select>
                    <div className="git-merge-actions">
                        <button className="git-action-btn" onClick={doMerge} disabled={!mergeBranch || loading}>Merge</button>
                        <button className="git-action-btn git-action-secondary" onClick={() => setShowMerge(false)}>Cancel</button>
                    </div>
                </div>
            )}

            {error && <div className="git-error">{error} <button className="git-error-dismiss" onClick={() => setError('')}>×</button></div>}

            {/* Tab bar */}
            <div className="git-tabs">
                <button className={`git-tab ${activeTab === 'changes' ? 'active' : ''}`} onClick={() => setActiveTab('changes')}>
                    Changes {files.length > 0 && <span className="git-tab-badge">{files.length}</span>}
                </button>
                <button className={`git-tab ${activeTab === 'graph' ? 'active' : ''}`} onClick={() => setActiveTab('graph')}>Graph</button>
                <button className={`git-tab ${activeTab === 'stash' ? 'active' : ''}`} onClick={() => setActiveTab('stash')}>
                    Stash {stashes.length > 0 && <span className="git-tab-badge">{stashes.length}</span>}
                </button>
                {githubConnected && (
                    <button className={`git-tab ${activeTab === 'prs' ? 'active' : ''}`} onClick={() => setActiveTab('prs')}>
                        PRs {prs.length > 0 && <span className="git-tab-badge">{prs.length}</span>}
                    </button>
                )}
                <button className={`git-tab ${activeTab === 'sync' ? 'active' : ''}`} onClick={() => setActiveTab('sync')}>Sync</button>
            </div>

            {/* Changes tab */}
            {activeTab === 'changes' && (
                <>
                    <div className="git-commit-area">
                        <input className="git-commit-input" value={commitMsg} onChange={e => setCommitMsg(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doCommit(); } }}
                            placeholder="Commit message..." disabled={loading} />
                        <div className="git-commit-actions">
                            <button className="git-stage-all-btn" onClick={stageAll} disabled={loading || unstagedFiles.length === 0}>Stage All</button>
                            <button className="git-commit-btn" onClick={doCommit} disabled={loading || !commitMsg.trim() || stagedFiles.length === 0}>
                                {loading ? 'Working...' : `Commit (${stagedFiles.length})`}
                            </button>
                        </div>
                    </div>
                    <div className="git-files-section">
                        {stagedFiles.length > 0 && (
                            <div className="git-file-group">
                                <div className="git-file-group-label">Staged ({stagedFiles.length})</div>
                                {stagedFiles.map(f => (
                                    <div key={f.path} className={`git-file-item git-file-${f.status}`}>
                                        <span className="git-file-status">{f.status[0].toUpperCase()}</span>
                                        <span className="git-file-path">{f.path}</span>
                                        <button className="git-file-action" onClick={() => unstageFile(f.path)} title="Unstage">−</button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {unstagedFiles.length > 0 && (
                            <div className="git-file-group">
                                <div className="git-file-group-label">Changes ({unstagedFiles.length})</div>
                                {unstagedFiles.map(f => (
                                    <div key={f.path} className={`git-file-item git-file-${f.status}`}>
                                        <span className="git-file-status">{f.status[0].toUpperCase()}</span>
                                        <span className="git-file-path">{f.path}</span>
                                        <button className="git-file-action" onClick={() => stageFile(f.path)} title="Stage">+</button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {files.length === 0 && <div className="git-clean">Working tree clean</div>}
                    </div>
                </>
            )}

            {/* Graph tab */}
            {activeTab === 'graph' && (
                <div className="git-graph-section">
                    {graphCommits.length === 0 ? (
                        <div className="git-clean">No commits yet</div>
                    ) : (
                        <div className="git-graph-list">
                            {graphCommits.map((c, i) => {
                                const isMerge = c.parents.length > 1;
                                const branchRefs = c.refs.filter(r => !r.startsWith('tag:'));
                                const tagRefs = c.refs.filter(r => r.startsWith('tag:')).map(r => r.replace('tag: ', ''));
                                return (
                                    <div key={c.hash} className={`git-graph-commit ${i === 0 ? 'git-graph-head' : ''}`}>
                                        <div className="git-graph-line">
                                            <div className={`git-graph-dot ${isMerge ? 'git-graph-merge-dot' : ''}`} />
                                            {i < graphCommits.length - 1 && <div className="git-graph-connector" />}
                                        </div>
                                        <div className="git-graph-content">
                                            <div className="git-graph-msg">
                                                <span className="git-graph-hash">{c.shortHash}</span>
                                                {branchRefs.map(r => <span key={r} className={`git-graph-ref ${r.includes('HEAD') ? 'git-graph-ref-head' : ''}`}>{r.replace('HEAD -> ', '')}</span>)}
                                                {tagRefs.map(t => <span key={t} className="git-graph-tag">{t}</span>)}
                                                <span className="git-graph-text">{c.message}</span>
                                            </div>
                                            <div className="git-graph-meta"><span>{c.author}</span><span>{formatTimeAgo(c.timestamp)}</span></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Stash tab */}
            {activeTab === 'stash' && (
                <div className="git-stash-section">
                    <div className="git-stash-form">
                        <input className="git-stash-input" value={stashMsg} onChange={e => setStashMsg(e.target.value)} placeholder="Stash message (optional)..." disabled={loading} />
                        <div className="git-stash-actions">
                            <button className="git-action-btn" onClick={doStashPush} disabled={loading || files.length === 0}>Stash Changes</button>
                            <button className="git-action-btn git-action-secondary" onClick={doStashPop} disabled={loading || stashes.length === 0}>Pop Latest</button>
                        </div>
                    </div>
                    {stashes.length > 0 ? (
                        <div className="git-stash-list">
                            {stashes.map((s, i) => (
                                <div key={i} className="git-stash-item">
                                    <span className="git-stash-text">{s}</span>
                                    <button className="git-file-action" onClick={() => doStashDrop(i)} title="Drop">×</button>
                                </div>
                            ))}
                        </div>
                    ) : <div className="git-clean">No stashes</div>}
                </div>
            )}

            {/* PRs tab */}
            {activeTab === 'prs' && (
                <div className="git-prs-section" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, flex: 1, overflow: 'auto' }}>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        {(['open', 'closed', 'all'] as const).map(f => (
                            <button key={f} onClick={() => setPrFilter(f)} style={{
                                fontSize: 10, padding: '2px 8px', borderRadius: 10, border: '1px solid var(--border)',
                                background: prFilter === f ? 'var(--accent)' : 'var(--bg-secondary)',
                                color: prFilter === f ? 'var(--text-on-accent, #fff)' : 'var(--text-secondary)', cursor: 'pointer',
                            }}>{f}</button>
                        ))}
                        <button onClick={() => loadPRs()} style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer' }}>Refresh</button>
                        <button onClick={() => setShowCreatePR(true)} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--accent)', color: 'var(--text-on-accent, #fff)', cursor: 'pointer' }}>New PR</button>
                    </div>

                    {showCreatePR && (
                        <div style={{ padding: 8, borderRadius: 6, background: 'var(--bg-tertiary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <input style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }}
                                value={prTitle} onChange={e => setPrTitle(e.target.value)} placeholder="PR title" />
                            <textarea style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 11, outline: 'none', minHeight: 50, resize: 'vertical', fontFamily: 'inherit' }}
                                value={prBody} onChange={e => setPrBody(e.target.value)} placeholder="Description (optional)" />
                            <div style={{ display: 'flex', gap: 4, fontSize: 10, alignItems: 'center' }}>
                                <span style={{ color: 'var(--text-tertiary)' }}>{branch}</span>
                                <span style={{ color: 'var(--text-tertiary)' }}>→</span>
                                <input style={{ width: 80, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 10, outline: 'none' }}
                                    value={prBase} onChange={e => setPrBase(e.target.value)} placeholder="base branch" />
                                <button className="git-action-btn" style={{ marginLeft: 'auto', fontSize: 10 }} onClick={createPR} disabled={loading || !prTitle.trim()}>Create PR</button>
                                <button className="git-action-btn git-action-secondary" style={{ fontSize: 10 }} onClick={() => setShowCreatePR(false)}>Cancel</button>
                            </div>
                        </div>
                    )}

                    {prs.length === 0 ? (
                        <div className="git-clean">No {prFilter} pull requests</div>
                    ) : prs.map(pr => (
                        <div key={pr.number} style={{ padding: '6px 8px', borderRadius: 6, background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 10, color: pr.state === 'open' ? 'var(--success)' : 'var(--text-tertiary)', fontWeight: 600 }}>#{pr.number}</span>
                                {pr.draft && <span style={{ fontSize: 9, padding: '0 4px', borderRadius: 3, background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}>draft</span>}
                                <span style={{ fontSize: 11, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr.title}</span>
                            </div>
                            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', display: 'flex', gap: 8 }}>
                                <span>{pr.author}</span>
                                <span>{pr.head} → {pr.base}</span>
                                {pr.labels.length > 0 && pr.labels.map(l => <span key={l} style={{ padding: '0 3px', borderRadius: 2, background: 'var(--bg-tertiary)' }}>{l}</span>)}
                                <span style={{ marginLeft: 'auto' }}>{formatTimeAgo(new Date(pr.createdAt).getTime())}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Sync tab */}
            {activeTab === 'sync' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8, flex: 1, overflow: 'auto' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>Remotes</div>
                    {remotes.length === 0 ? (
                        <div className="git-clean" style={{ fontSize: 11 }}>
                            No remotes configured.
                            {githubConnected ? (
                                <button style={{ display: 'block', margin: '8px auto 0', fontSize: 10, padding: '4px 12px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--accent)', color: 'var(--text-on-accent, #fff)', cursor: 'pointer' }}
                                    onClick={() => { setPublishName(getProjectPath().split('/').pop() || ''); setShowPublish(true); }}>
                                    Publish to GitHub
                                </button>
                            ) : (
                                <button style={{ display: 'block', margin: '8px auto 0', fontSize: 10, padding: '4px 12px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer' }}
                                    onClick={() => setShowAddRemote(true)}>
                                    Add Remote
                                </button>
                            )}
                        </div>
                    ) : remotes.map(r => (
                        <div key={r.name} style={{ padding: '6px 8px', borderRadius: 6, background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{r.name}</span>
                                <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'JetBrains Mono, monospace' }}>{r.fetchUrl}</span>
                            </div>
                        </div>
                    ))}

                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Quick Actions</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            <button className="git-action-btn" onClick={doPull} disabled={loading || remotes.length === 0}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 3 }}><polyline points="8 17 12 21 16 17" /><line x1="12" y1="12" x2="12" y2="21" /></svg>
                                Pull
                            </button>
                            <button className="git-action-btn" onClick={doPush} disabled={loading || remotes.length === 0}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 3 }}><polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" /></svg>
                                Push
                            </button>
                            <button className="git-action-btn" onClick={async () => { await doPull(); await doPush(); }} disabled={loading || remotes.length === 0}>
                                Sync (Pull + Push)
                            </button>
                        </div>
                    </div>

                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 'auto', display: 'flex', gap: 12 }}>
                        <span>Branch: {branch}</span>
                        {ahead > 0 && <span style={{ color: 'var(--accent)' }}>{ahead} ahead</span>}
                        {behind > 0 && <span style={{ color: 'var(--error)' }}>{behind} behind</span>}
                        {ahead === 0 && behind === 0 && remotes.length > 0 && <span>Up to date</span>}
                    </div>
                </div>
            )}

            {/* Action log */}
            {actionLog.length > 0 && (
                <div className="git-log">
                    {actionLog.map((msg, i) => <div key={i} className="git-log-entry">{msg}</div>)}
                </div>
            )}
        </div>
    );
}

export default GitWidget;
