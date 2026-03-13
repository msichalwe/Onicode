import React from 'react';
import type { GeneralTabProps } from './types';

export default function GeneralTab({
    permissionMode, setPermissionMode,
    dangerousCommandProtection, setDangerousCommandProtection,
    autoCommit, setAutoCommit,
    sendOnEnter, setSendOnEnter,
    autoTitle, setAutoTitle,
    showToolDetails, setShowToolDetails,
    notifications, setNotifications,
    chatHistoryLimit, setChatHistoryLimit,
    maxAutoContinues, setMaxAutoContinues,
    compactThreshold, setCompactThreshold,
    fontSize, setFontSize,
    defaultProjectPath, setDefaultProjectPath,
    panelMode, changePanelMode,
    saveSetting,
}: GeneralTabProps) {
    return (
        <div className="settings-tab-content">
            {/* Permissions */}
            <div className="settings-section">
                <h3>Permissions</h3>
                <p className="settings-section-desc">Control how much autonomy the AI has when working on your projects.</p>

                <div className="setting-row">
                    <div className="setting-label">
                        <span className="setting-name">Permission Mode</span>
                        <span className="setting-desc">How the AI handles tool permissions</span>
                    </div>
                    <div className="setting-toggle-group">
                        <button className={`setting-toggle-btn ${permissionMode === 'auto-allow' ? 'active' : ''}`} onClick={() => {
                            setPermissionMode('auto-allow');
                            saveSetting('permission-mode', 'auto-allow');
                        }}>Auto Allow</button>
                        <button className={`setting-toggle-btn ${permissionMode === 'ask-destructive' ? 'active' : ''}`} onClick={() => {
                            setPermissionMode('ask-destructive');
                            saveSetting('permission-mode', 'ask-destructive');
                        }}>Ask for Destructive</button>
                        <button className={`setting-toggle-btn ${permissionMode === 'plan-only' ? 'active' : ''}`} onClick={() => {
                            setPermissionMode('plan-only');
                            saveSetting('permission-mode', 'plan-only');
                        }}>Plan Only</button>
                    </div>
                </div>

                <div className="permission-mode-info">
                    {permissionMode === 'auto-allow' && <span>The AI can read, write, delete files, run commands, and commit — no interruptions. Best for productive coding sessions.</span>}
                    {permissionMode === 'ask-destructive' && <span>The AI will ask before deleting files, restoring snapshots, or running destructive commands. Everything else is auto-allowed.</span>}
                    {permissionMode === 'plan-only' && <span>The AI can only read files and search. No writes, no commands, no commits. Use this for code review or planning.</span>}
                </div>
            </div>

            {/* Safety */}
            <div className="settings-section">
                <h3>Safety</h3>

                <div className="setting-row">
                    <div className="setting-label">
                        <span className="setting-name">Dangerous Command Protection</span>
                        <span className="setting-desc">Block destructive commands like rm -rf, git reset --hard, DROP TABLE</span>
                    </div>
                    <label className="setting-switch">
                        <input type="checkbox" checked={dangerousCommandProtection} onChange={(e) => {
                            setDangerousCommandProtection(e.target.checked);
                            saveSetting('dangerous-cmd-protection', e.target.checked);
                        }} />
                        <span className="setting-switch-slider" />
                    </label>
                </div>

                <div className="setting-row">
                    <div className="setting-label">
                        <span className="setting-name">Auto-Commit</span>
                        <span className="setting-desc">AI commits at milestones, after builds, and at session end</span>
                    </div>
                    <label className="setting-switch">
                        <input type="checkbox" checked={autoCommit} onChange={(e) => {
                            setAutoCommit(e.target.checked);
                            saveSetting('auto-commit', e.target.checked);
                        }} />
                        <span className="setting-switch-slider" />
                    </label>
                </div>
            </div>

            {/* Chat Behavior */}
            <div className="settings-section">
                <h3>Chat</h3>

                <div className="setting-row">
                    <div className="setting-label">
                        <span className="setting-name">Send on Enter</span>
                        <span className="setting-desc">Press Enter to send messages. When off, use Ctrl+Enter instead.</span>
                    </div>
                    <label className="setting-switch">
                        <input type="checkbox" checked={sendOnEnter} onChange={(e) => {
                            setSendOnEnter(e.target.checked);
                            saveSetting('send-on-enter', e.target.checked);
                        }} />
                        <span className="setting-switch-slider" />
                    </label>
                </div>

                <div className="setting-row">
                    <div className="setting-label">
                        <span className="setting-name">Auto-Generate Titles</span>
                        <span className="setting-desc">Automatically title new conversations after the first message</span>
                    </div>
                    <label className="setting-switch">
                        <input type="checkbox" checked={autoTitle} onChange={(e) => {
                            setAutoTitle(e.target.checked);
                            saveSetting('auto-title', e.target.checked);
                        }} />
                        <span className="setting-switch-slider" />
                    </label>
                </div>

                <div className="setting-row">
                    <div className="setting-label">
                        <span className="setting-name">Show Tool Details</span>
                        <span className="setting-desc">Show expandable details for tool calls (file diffs, search results, command output)</span>
                    </div>
                    <label className="setting-switch">
                        <input type="checkbox" checked={showToolDetails} onChange={(e) => {
                            setShowToolDetails(e.target.checked);
                            saveSetting('show-tool-details', e.target.checked);
                        }} />
                        <span className="setting-switch-slider" />
                    </label>
                </div>

                <div className="setting-row">
                    <div className="setting-label">
                        <span className="setting-name">Notifications</span>
                        <span className="setting-desc">Desktop notifications for completed tasks, heartbeat alerts, and errors</span>
                    </div>
                    <label className="setting-switch">
                        <input type="checkbox" checked={notifications} onChange={(e) => {
                            setNotifications(e.target.checked);
                            saveSetting('notifications', e.target.checked);
                        }} />
                        <span className="setting-switch-slider" />
                    </label>
                </div>

                <div className="setting-row">
                    <div className="setting-label">
                        <span className="setting-name">Conversation History</span>
                        <span className="setting-desc">Maximum conversations to keep in the sidebar</span>
                    </div>
                    <select className="setting-select" value={chatHistoryLimit} onChange={(e) => {
                        const v = Number(e.target.value);
                        setChatHistoryLimit(v);
                        saveSetting('chat-history-limit', v);
                    }}>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={200}>200</option>
                        <option value={500}>Unlimited (500)</option>
                    </select>
                </div>
            </div>

            {/* AI Agent */}
            <div className="settings-section">
                <h3>AI Agent</h3>

                <div className="setting-row">
                    <div className="setting-label">
                        <span className="setting-name">Max Auto-Continues</span>
                        <span className="setting-desc">How many times the AI can auto-continue before pausing for input</span>
                    </div>
                    <select className="setting-select" value={maxAutoContinues} onChange={(e) => {
                        const v = Number(e.target.value);
                        setMaxAutoContinues(v);
                        saveSetting('max-auto-continues', v);
                    }}>
                        <option value={5}>5 (conservative)</option>
                        <option value={10}>10</option>
                        <option value={15}>15 (default)</option>
                        <option value={25}>25</option>
                        <option value={50}>50 (unrestricted)</option>
                    </select>
                </div>

                <div className="setting-row">
                    <div className="setting-label">
                        <span className="setting-name">Context Compaction</span>
                        <span className="setting-desc">Token threshold before old messages are summarized to free context</span>
                    </div>
                    <select className="setting-select" value={compactThreshold} onChange={(e) => {
                        const v = Number(e.target.value);
                        setCompactThreshold(v);
                        saveSetting('compact-threshold', v);
                    }}>
                        <option value={30000}>30K (aggressive)</option>
                        <option value={60000}>60K (default)</option>
                        <option value={100000}>100K (late)</option>
                        <option value={0}>Off</option>
                    </select>
                </div>
            </div>

            {/* Editor */}
            <div className="settings-section">
                <h3>Editor</h3>

                <div className="setting-row">
                    <div className="setting-label">
                        <span className="setting-name">Font Size</span>
                        <span className="setting-desc">Code and UI font size in pixels</span>
                    </div>
                    <div className="setting-stepper">
                        <button className="setting-stepper-btn" disabled={fontSize <= 10} onClick={() => {
                            const v = Math.max(10, fontSize - 1);
                            setFontSize(v);
                            saveSetting('font-size', v);
                            document.documentElement.style.setProperty('--user-font-size', `${v}px`);
                        }}>-</button>
                        <span className="setting-stepper-value">{fontSize}px</span>
                        <button className="setting-stepper-btn" disabled={fontSize >= 24} onClick={() => {
                            const v = Math.min(24, fontSize + 1);
                            setFontSize(v);
                            saveSetting('font-size', v);
                            document.documentElement.style.setProperty('--user-font-size', `${v}px`);
                        }}>+</button>
                    </div>
                </div>

                <div className="setting-row">
                    <div className="setting-label">
                        <span className="setting-name">Default Project Path</span>
                        <span className="setting-desc">Where new projects are created</span>
                    </div>
                    <input
                        className="setting-input"
                        type="text"
                        value={defaultProjectPath}
                        onChange={(e) => {
                            setDefaultProjectPath(e.target.value);
                            saveSetting('default-project-path', e.target.value);
                        }}
                        placeholder="~/OniProjects"
                    />
                </div>

                <div className="setting-row">
                    <div className="setting-label">
                        <span className="setting-name">Side Panel</span>
                        <span className="setting-desc">Show or hide the right panel (terminal, files, git, browser)</span>
                    </div>
                    <div className="setting-toggle-group">
                        <button className={`setting-toggle-btn ${panelMode === 'always' ? 'active' : ''}`} onClick={() => changePanelMode('always')}>Show</button>
                        <button className={`setting-toggle-btn ${panelMode === 'hidden' ? 'active' : ''}`} onClick={() => changePanelMode('hidden')}>Hide</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
