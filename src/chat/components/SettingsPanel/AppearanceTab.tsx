import React from 'react';
import { THEMES } from './types';
import type { AppearanceTabProps } from './types';

export default function AppearanceTab({ theme, setTheme }: AppearanceTabProps) {
    return (
        <div className="settings-tab-content">
            <div className="settings-section">
                <h3>Theme</h3>
                <div className="theme-grid">
                    {THEMES.map(t => (
                        <div
                            key={t.id}
                            className={`theme-card ${theme === t.id ? 'active' : ''}`}
                            onClick={() => setTheme(t.id)}
                        >
                            <div className={`theme-preview ${t.previewClass}`} />
                            <div className="theme-card-name">{t.name}</div>
                            <div className="theme-card-type">{t.type}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
