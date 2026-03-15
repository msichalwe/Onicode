/**
 * ArtifactWidget — Renders arbitrary HTML+CSS+JS in a sandboxed iframe.
 */
import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';

const MIN_HEIGHT = 80;
const COLLAPSED_MAX = 400;
const EXPANDED_MAX = 1200;

interface ArtifactWidgetProps {
    data: Record<string, unknown>;
    onAction?: (command: string) => void;
}

export default function ArtifactWidget({ data, onAction }: ArtifactWidgetProps) {
    const d = data as Record<string, unknown>;
    const html = String(d.html || d.code || d.content || '');
    const title = String(d.title || d.name || '');
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [contentHeight, setContentHeight] = useState(200);
    const [expanded, setExpanded] = useState(false);

    const maxH = expanded ? EXPANDED_MAX : COLLAPSED_MAX;
    const displayHeight = Math.min(Math.max(contentHeight, MIN_HEIGHT), maxH);
    const isOverflowing = contentHeight > COLLAPSED_MAX;

    const getThemeVars = useCallback(() => {
        const style = getComputedStyle(document.documentElement);
        const get = (name: string) => style.getPropertyValue(name).trim();
        return {
            '--bg-primary': get('--bg-primary') || '#0d1117',
            '--bg-secondary': get('--bg-secondary') || '#161b22',
            '--bg-tertiary': get('--bg-tertiary') || '#21262d',
            '--text-primary': get('--text-primary') || '#e6edf3',
            '--text-secondary': get('--text-secondary') || '#8b949e',
            '--text-tertiary': get('--text-tertiary') || '#6e7681',
            '--accent': get('--accent') || '#3b82f6',
            '--success': get('--success') || '#2ea043',
            '--error': get('--error') || '#f85149',
            '--warning': get('--warning') || '#d29922',
            '--border-light': get('--border-light') || '#30363d',
            '--font-code': get('--font-code') || "'JetBrains Mono', monospace",
        };
    }, []);

    const bridgeScript = `<script>
function sendPrompt(t){window.parent.postMessage({type:'onicode-artifact-action',text:t},'*')}
function reportHeight(){var h=Math.max(document.body.scrollHeight,document.body.offsetHeight,80);window.parent.postMessage({type:'onicode-artifact-height',height:h},'*')}
window.addEventListener('load',function(){setTimeout(reportHeight,100);setTimeout(reportHeight,500)});
try{new ResizeObserver(reportHeight).observe(document.body)}catch(e){}
setTimeout(reportHeight,200);setTimeout(reportHeight,1000);setTimeout(reportHeight,2000);
window.onerror=function(m){document.body.innerHTML='<pre style="color:#f85149;padding:12px;font-size:12px">Error: '+m+'</pre>';reportHeight()};
</script>`;

    const srcdoc = useMemo(() => {
        const vars = getThemeVars();
        const cssVars = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
        const themeStyle = `<style>:root{${cssVars}}*{box-sizing:border-box}body{font-family:'Inter',-apple-system,sans-serif;color:var(--text-primary);font-size:13px;line-height:1.5;margin:0}</style>`;

        // If AI sent a full HTML document, inject theme + bridge into it
        const isFullDoc = /<!doctype|<html/i.test(html);
        if (isFullDoc) {
            let doc = html;
            if (/<head>/i.test(doc)) {
                doc = doc.replace(/<head>/i, `<head>${themeStyle}`);
            } else if (/<html[^>]*>/i.test(doc)) {
                doc = doc.replace(/<html[^>]*>/i, (m) => `${m}<head>${themeStyle}</head>`);
            }
            if (/<\/body>/i.test(doc)) {
                doc = doc.replace(/<\/body>/i, `${bridgeScript}</body>`);
            } else {
                doc += bridgeScript;
            }
            return doc;
        }

        // Wrap fragment
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${themeStyle}<style>body{background:transparent;padding:12px}a{color:var(--accent)}canvas{display:block;max-width:100%}button{font-family:inherit;cursor:pointer}</style></head><body>${html}${bridgeScript}</body></html>`;
    }, [html, getThemeVars]);

    // Listen for messages from iframe
    useEffect(() => {
        const handler = (e: MessageEvent) => {
            if (e.data?.type === 'onicode-artifact-height' && typeof e.data.height === 'number') {
                setContentHeight(e.data.height);
            }
            if (e.data?.type === 'onicode-artifact-action' && e.data.text) {
                onAction?.(e.data.text);
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [onAction]);

    if (!html) return null;

    return (
        <div className="cw cw-artifact">
            <div className="cw-artifact-header">
                <span className="cw-diagram-title">{title || 'Artifact'}</span>
                <div className="cw-artifact-actions">
                    {isOverflowing && (
                        <button className="cw-artifact-btn" onClick={() => setExpanded(!expanded)}>
                            {expanded ? '↕ Collapse' : '↕ Expand'}
                        </button>
                    )}
                </div>
            </div>
            <div className="cw-artifact-container" style={{ height: `${displayHeight}px`, overflow: 'hidden', position: 'relative' }}>
                <iframe
                    ref={iframeRef}
                    className="cw-artifact-frame"
                    style={{ height: `${Math.max(contentHeight, MIN_HEIGHT)}px` }}
                    srcDoc={srcdoc}
                    sandbox="allow-scripts"
                    title={title || 'Artifact'}
                />
                {!expanded && isOverflowing && (
                    <div className="cw-artifact-fade" onClick={() => setExpanded(true)} />
                )}
            </div>
        </div>
    );
}
