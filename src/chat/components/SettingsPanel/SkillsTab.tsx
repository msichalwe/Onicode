import React from 'react';
import type { SkillsTabProps } from './types';

function SkillCard({ skill, isExpanded, onToggleExpand, onToggleSkill, catLabel }: {
    skill: SkillsTabProps['skills'][0];
    isExpanded: boolean;
    onToggleExpand: () => void;
    onToggleSkill: () => void;
    catLabel: string;
}) {
    return (
        <div className={`skill-item ${skill.enabled ? 'enabled' : ''}${isExpanded ? ' expanded' : ''}${skill.system ? ' skill-system' : ''}`}>
            <div className="skill-item-top">
                <div className="skill-item-info" onClick={onToggleExpand}>
                    <div className="skill-item-header">
                        <span className={`skill-item-chevron${isExpanded ? ' expanded' : ''}`}>&#9656;</span>
                        <span className="skill-item-name">{skill.name}</span>
                        {skill.system && <span className="skill-system-badge">System</span>}
                        {skill.enabled && !skill.system && <span className="skill-active-badge">Active</span>}
                    </div>
                    <div className="skill-item-desc">{skill.description}</div>
                </div>
                <button
                    className={`skill-toggle ${skill.enabled ? 'on' : 'off'}`}
                    onClick={onToggleSkill}
                    title={skill.enabled ? 'Disable' : 'Enable'}
                >
                    <div className="skill-toggle-track">
                        <div className="skill-toggle-thumb" />
                    </div>
                </button>
            </div>
            {isExpanded && (
                <div className="skill-item-expanded">
                    <div className="skill-prompt-label">Prompt injected when active:</div>
                    <pre className="skill-prompt-content">{skill.prompt}</pre>
                    <div className="skill-meta">
                        <span>Category: {catLabel}</span>
                        <span>{skill.system ? 'System skill — recommended always on' : skill.enabled ? 'Active — injected into AI requests' : 'Inactive'}</span>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function SkillsTab({
    skills, expandedSkills, setExpandedSkills, toggleSkill, enabledCount, categories,
}: SkillsTabProps) {
    const systemSkills = skills.filter(s => s.system);
    const optionalSkills = skills.filter(s => !s.system);

    const toggleExpand = (id: string) => {
        setExpandedSkills(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    return (
        <div className="settings-tab-content">
            <div className="settings-section">
                <h3>AI Skills ({enabledCount}/{skills.length} enabled)</h3>
                <p className="settings-section-desc">Skills inject specialized behavior into the AI. System skills are recommended defaults. Toggle any skill on/off.</p>

                {/* System Skills */}
                {systemSkills.length > 0 && (
                    <div className="skill-category">
                        <div className="skill-category-label skill-category-system">
                            System Skills
                            <span className="skill-category-count">{systemSkills.filter(s => s.enabled).length}/{systemSkills.length}</span>
                        </div>
                        {systemSkills.map(skill => (
                            <SkillCard
                                key={skill.id}
                                skill={skill}
                                isExpanded={expandedSkills.has(skill.id)}
                                onToggleExpand={() => toggleExpand(skill.id)}
                                onToggleSkill={() => toggleSkill(skill.id)}
                                catLabel={categories.find(c => c.id === skill.category)?.label || skill.category}
                            />
                        ))}
                    </div>
                )}

                {/* Optional Skills by category */}
                {categories.map(cat => {
                    const catSkills = optionalSkills.filter(s => s.category === cat.id);
                    if (catSkills.length === 0) return null;
                    const catEnabled = catSkills.filter(s => s.enabled).length;
                    return (
                        <div key={cat.id} className="skill-category">
                            <div className="skill-category-label">
                                {cat.label}
                                <span className="skill-category-count">{catEnabled}/{catSkills.length}</span>
                            </div>
                            {catSkills.map(skill => (
                                <SkillCard
                                    key={skill.id}
                                    skill={skill}
                                    isExpanded={expandedSkills.has(skill.id)}
                                    onToggleExpand={() => toggleExpand(skill.id)}
                                    onToggleSkill={() => toggleSkill(skill.id)}
                                    catLabel={cat.label}
                                />
                            ))}
                        </div>
                    );
                })}

                <div className="skill-info-box">
                    <strong>How Skills Work</strong>
                    <p>Each enabled skill adds specialized instructions to the AI system prompt. The AI reads these and applies them proactively when relevant.</p>
                    <p><strong>System skills</strong> are production-grade defaults — code review, memory management, PR creation, etc. Keep them on unless you have a reason not to.</p>
                </div>
            </div>
        </div>
    );
}
