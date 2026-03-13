import React from 'react';
import ProviderSettings from '../ProviderSettings';

export default function ProvidersTab() {
    return (
        <div className="settings-tab-content">
            <div className="settings-section">
                <h3>AI Providers</h3>
                <ProviderSettings />
            </div>
        </div>
    );
}
