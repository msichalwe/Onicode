import React, { useState, useEffect, useCallback } from 'react';
import { isElectron } from '../../utils';

interface TreeNode { name: string; path: string; type: string; children?: TreeNode[] }

function FileViewerWidget({ data }: { data?: Record<string, unknown> }) {
    const [tree, setTree] = useState<TreeNode[]>([]);
    const [refreshKey, setRefreshKey] = useState(0);
    const [currentPath, setCurrentPath] = useState((data?.path as string) || '');
    const [rootPath, setRootPath] = useState('');
    const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
    // viewingFile state removed — files open in floating editor via onicode-open-file event

    // Resolve root path from active project
    useEffect(() => {
        const explicit = data?.path as string;
        if (explicit) { setRootPath(explicit); setCurrentPath(explicit); return; }
        try {
            const stored = localStorage.getItem('onicode-active-project');
            if (stored) { const p = JSON.parse(stored).path; setRootPath(p); setCurrentPath(p); return; }
        } catch {}
        setRootPath(''); setCurrentPath('');
    }, [data?.path]);

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.path) { setRootPath(detail.path); setCurrentPath(detail.path); setExpandedDirs(new Set()); }
        };
        window.addEventListener('onicode-project-activate', handler);
        return () => window.removeEventListener('onicode-project-activate', handler);
    }, []);

    // Load file tree for current path
    useEffect(() => {
        if (!isElectron || !currentPath) return;
        window.onicode!.readDir(currentPath, 2).then((res) => {
            if (res.tree) setTree(res.tree as TreeNode[]);
        });
    }, [currentPath, refreshKey]);

    // Auto-refresh when AI modifies files
    useEffect(() => {
        if (!isElectron || !currentPath || !window.onicode?.onFileChanged) return;
        const unsub = window.onicode.onFileChanged(() => setRefreshKey(k => k + 1));
        return unsub;
    }, [currentPath]);

    const toggleDir = useCallback((dirPath: string) => {
        setExpandedDirs(prev => {
            const next = new Set(prev);
            if (next.has(dirPath)) next.delete(dirPath);
            else next.add(dirPath);
            return next;
        });
    }, []);

    const openFile = useCallback((filePath: string, fileName: string) => {
        // Dispatch event to App.tsx to open floating editor
        window.dispatchEvent(new CustomEvent('onicode-open-file', { detail: { path: filePath, name: fileName } }));
    }, []);

    const navigateUp = useCallback(() => {
        if (currentPath === rootPath || !currentPath) return;
        const parent = currentPath.split('/').slice(0, -1).join('/');
        if (parent && parent.length >= rootPath.length) {
            setCurrentPath(parent);
            setExpandedDirs(new Set());
        }
    }, [currentPath, rootPath]);

    if (!rootPath) {
        return (
            <div className="widget-placeholder">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                </svg>
                <p>No project open</p>
                <span>Use <code>/init</code> or <code>/openproject</code> to start</span>
            </div>
        );
    }

    const renderItem = (item: TreeNode, depth: number) => {
        const isDir = item.type === 'directory';
        const isExpanded = expandedDirs.has(item.path);

        return (
            <div key={item.path}>
                <div
                    className={`file-tree-item ${item.type}`}
                    style={{ paddingLeft: `${8 + depth * 14}px` }}
                    onClick={() => isDir ? toggleDir(item.path) : openFile(item.path, item.name)}
                >
                    {isDir ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }}>
                            <polyline points="9 18 15 12 9 6" />
                        </svg>
                    ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                        </svg>
                    )}
                    <span className="file-tree-name">{item.name}</span>
                </div>
                {isDir && isExpanded && item.children && (
                    <div className="file-tree-children">
                        {(item.children as TreeNode[]).map(child => renderItem(child, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="widget-files">
            <div className="widget-files-header">
                {currentPath !== rootPath && (
                    <button className="file-viewer-back" onClick={navigateUp} title="Go up">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
                    </button>
                )}
                <span className="widget-files-path">{currentPath.split('/').pop()}</span>
                <button className="file-viewer-refresh" onClick={() => setRefreshKey(k => k + 1)} title="Refresh">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
                </button>
            </div>
            <div className="widget-files-tree">
                {tree.map(item => renderItem(item, 0))}
            </div>
        </div>
    );
}

export default FileViewerWidget;
