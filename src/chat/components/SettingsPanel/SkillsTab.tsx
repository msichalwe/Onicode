import React from 'react';
import type { SkillsTabProps } from './types';

export default function SkillsTab({
    skills, expandedSkills, setExpandedSkills, toggleSkill, enabledCount, categories,
}: SkillsTabProps) {
    return (
        <div className="settings-tab-content">
            <div className="settings-section">
                <h3>AI Skills ({enabledCount}/{skills.length} enabled)</h3>
                <p className="settings-section-desc">Skills inject specialized behavior into the AI system prompt. Enabled skills are applied proactively during conversations.</p>

                {categories.map(cat => {
                    const catSkills = skills.filter(s => s.category === cat.id);
                    if (catSkills.length === 0) return null;
                    const catEnabled = catSkills.filter(s => s.enabled).length;
                    return (
                        <div key={cat.id} className="skill-category">
                            <div className="skill-category-label">
                                {cat.label}
                                <span className="skill-category-count">{catEnabled}/{catSkills.length}</span>
                            </div>
                            {catSkills.map(skill => {
                                const isExpanded = expandedSkills.has(skill.id);
                                return (
                                    <div key={skill.id} className={`skill-item ${skill.enabled ? 'enabled' : ''}${isExpanded ? ' expanded' : ''}`}>
                                        <div className="skill-item-top">
                                            <div
                                                className="skill-item-info"
                                                onClick={() => {
                                                    setExpandedSkills(prev => {
                                                        const next = new Set(prev);
                                                        if (next.has(skill.id)) next.delete(skill.id);
                                                        else next.add(skill.id);
                                                        return next;
                                                    });
                                                }}
                                            >
                                                <div className="skill-item-header">
                                                    <span className={`skill-item-chevron${isExpanded ? ' expanded' : ''}`}>&#9656;</span>
                                                    <span className="skill-item-icon">{skill.icon}</span>
                                                    <span className="skill-item-name">{skill.name}</span>
                                                    {skill.enabled && <span className="skill-active-badge">Active</span>}
                                                </div>
                                                <div className="skill-item-desc">{skill.description}</div>
                                            </div>
                                            <button
                                                className={`skill-toggle ${skill.enabled ? 'on' : 'off'}`}
                                                onClick={() => toggleSkill(skill.id)}
                                                title={skill.enabled ? 'Disable' : 'Enable'}
                                            >
                                                <div className="skill-toggle-track">
                                                    <div className="skill-toggle-thumb" />
                                                </div>
                                            </button>
                                        </div>
                                        {isExpanded && (
                                            <div className="skill-item-expanded">
                                                <div className="skill-prompt-label">System Prompt Injection:</div>
                                                <pre className="skill-prompt-content">{skill.prompt}</pre>
                                                <div className="skill-meta">
                                                    <span>Category: {cat.label}</span>
                                                    <span>Status: {skill.enabled ? 'Injected into every AI request' : 'Inactive'}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}

                <div className="skill-info-box">
                    <strong>How Skills Work</strong>
                    <p>Each enabled skill adds specialized instructions to the AI system prompt. The AI reads these instructions and applies them proactively when relevant to your conversation.</p>
                    <p>For example, with "Code Review" enabled, the AI will automatically check for bugs, security issues, and performance problems when reviewing code.</p>
                </div>
            </div>
        </div>
    );
}
