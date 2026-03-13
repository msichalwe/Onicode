import React from 'react';
import { getActiveProvider } from './helpers';
import type { ContextBarProps, ProviderConfig } from './types';

const DEFAULT_MODELS: Record<string, string[]> = {
    openai: ['gpt-5.4', 'gpt-5.4-pro', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o3-pro', 'o3-mini', 'o4-mini'],
    codex: ['gpt-5.4', 'gpt-5-codex', 'gpt-5.3-codex', 'gpt-5.2-codex', 'codex-mini-latest', 'gpt-4o', 'o4-mini'],
    oniai: ['gpt-5.4', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'o3-mini', 'claude-sonnet-4-20250514'],
    openclaw: ['gpt-5.4', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'o3-mini'],
    anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'claude-3-5-haiku-20241022'],
    ollama: ['llama3.3', 'codellama', 'mistral', 'deepseek-coder-v2', 'qwen2.5-coder'],
};

const PROVIDER_NAMES: Record<string, string> = { openai: 'OpenAI', codex: 'OpenAI Codex', anthropic: 'Anthropic', ollama: 'Ollama', oniai: 'OniAI', openclaw: 'OpenClaw' };

export default function ContextBar({
    contextInfo,
    messagesCount,
    showModelPicker,
    thinkingLevel,
    onSetShowModelPicker,
    onSetThinkingLevel,
}: ContextBarProps) {
    if (!contextInfo || messagesCount === 0) return null;

    const handleSelectModel = (prov: ProviderConfig, model: string) => {
        try {
            const saved = localStorage.getItem('onicode-providers');
            if (saved) {
                const providers = JSON.parse(saved);
                providers.forEach((pp: ProviderConfig) => { pp.enabled = pp.id === prov.id; });
                const target = providers.find((pp: ProviderConfig) => pp.id === prov.id);
                if (target) target.selectedModel = model;
                localStorage.setItem('onicode-providers', JSON.stringify(providers));
                if (window.onicode?.syncProviderConfig && target) {
                    window.onicode.syncProviderConfig({
                        id: prov.id,
                        apiKey: prov.apiKey || '',
                        baseUrl: prov.baseUrl,
                        selectedModel: model,
                    });
                }
            }
        } catch { /* ignore */ }
        onSetShowModelPicker(false);
    };

    const handleRefreshModels = async (prov: ProviderConfig) => {
        if (!window.onicode?.fetchModels) return;
        try {
            const result = await window.onicode.fetchModels({ id: prov.id, apiKey: prov.apiKey, baseUrl: prov.baseUrl });
            if (result.models?.length) {
                const saved = localStorage.getItem('onicode-providers');
                if (saved) {
                    const providers = JSON.parse(saved);
                    const target = providers.find((pp: ProviderConfig) => pp.id === prov.id);
                    if (target) {
                        target.models = result.models;
                        localStorage.setItem('onicode-providers', JSON.stringify(providers));
                        onSetShowModelPicker(false);
                        setTimeout(() => onSetShowModelPicker(true), 50); // re-render
                    }
                }
            }
        } catch { /* ignore */ }
    };

    const activeProvider = getActiveProvider();

    let connectedProviders: ProviderConfig[] = [];
    try {
        const saved = localStorage.getItem('onicode-providers');
        if (saved) connectedProviders = JSON.parse(saved).filter((p: ProviderConfig) => p.connected && (p.apiKey?.trim() || p.id === 'ollama'));
    } catch { /* ignore */ }

    return (
        <div className="context-tracker">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
            </svg>
            <button
                className="context-model"
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontSize: 'inherit', fontFamily: 'inherit', position: 'relative' }}
                onClick={() => onSetShowModelPicker(!showModelPicker)}
                title="Click to change model"
            >
                {activeProvider?.selectedModel || 'gpt-5.4'}
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ marginLeft: 3, verticalAlign: 'middle' }}><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            {showModelPicker && (
                <div className="model-picker-dropdown">
                    {connectedProviders.map((prov: ProviderConfig) => {
                        const models = prov.models?.length ? prov.models : (DEFAULT_MODELS[prov.id] || []);
                        const isActive = prov.id === activeProvider?.id;
                        return (
                            <div key={prov.id} className="model-picker-group">
                                <div className="model-picker-provider">
                                    {PROVIDER_NAMES[prov.id] || prov.id}
                                    {isActive && <span className="model-picker-active">active</span>}
                                    <button
                                        className="model-picker-refresh"
                                        onClick={(e) => { e.stopPropagation(); handleRefreshModels(prov); }}
                                        title="Refresh models from API"
                                    >
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                            <path d="M23 4v6h-6M1 20v-6h6" />
                                            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                                        </svg>
                                    </button>
                                </div>
                                {models.map((m: string) => (
                                    <button
                                        key={`${prov.id}-${m}`}
                                        className={`model-picker-item${isActive && m === prov.selectedModel ? ' selected' : ''}`}
                                        onClick={() => handleSelectModel(prov, m)}
                                    >{m}</button>
                                ))}
                            </div>
                        );
                    })}
                </div>
            )}
            <span className="context-divider">&middot;</span>
            <span>~{contextInfo.tokens.toLocaleString()} tokens &middot; {contextInfo.messages} msgs</span>
            <span className="context-divider">&middot;</span>
            <button
                className="thinking-level-btn"
                onClick={() => {
                    const levels = ['low', 'medium', 'high'];
                    const idx = levels.indexOf(thinkingLevel);
                    const next = levels[(idx + 1) % levels.length];
                    onSetThinkingLevel(next);
                    localStorage.setItem('onicode-thinking-level', next);
                }}
                title={`Thinking: ${thinkingLevel} (click to change)`}
            >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z" />
                    <line x1="9" y1="21" x2="15" y2="21" />
                </svg>
                <span className={`thinking-level-label thinking-level-${thinkingLevel}`}>{thinkingLevel}</span>
            </button>
            {contextInfo.tokens > 60000 && <span className="context-warning">compacting soon</span>}
        </div>
    );
}
