import React from 'react';
import { requestPanel } from '../../utils';
import ContextBar from './ContextBar';
import type { InputAreaProps } from './types';

export default function InputArea({
    input,
    setInput,
    isTyping,
    isDragOver,
    attachments,
    showSlashMenu,
    slashIndex,
    showMentionMenu,
    mentionIndex,
    filteredCommands,
    filteredMentions,
    messageQueue,
    showQueuePanel,
    editingQueueId,
    editingQueueText,
    pendingQuestion,
    selectedOptions,
    pendingApproval,
    showAttachMenu,
    scope,
    activeProject,
    contextInfo,
    showModelPicker,
    thinkingLevel,
    messagesCount,
    textareaRef,
    fileInputRef,
    slashMenuRef,
    mentionMenuRef,
    attachMenuRef,
    onSend,
    onKeyDown,
    onPaste,
    onFileChange,
    onDragOver,
    onDragLeave,
    onDrop,
    onRemoveAttachment,
    onStopGeneration,
    onSetShowSlashMenu,
    onSetShowMentionMenu,
    onSetShowAttachMenu,
    onSetShowQueuePanel,
    onSetEditingQueueId,
    onSetEditingQueueText,
    onSetShowModelPicker,
    onSetThinkingLevel,
    onSetSelectedOptions,
    onSetAttachments,
    onRemoveFromQueue,
    onEditQueueItem,
    onMoveQueueItem,
    onClearUserQueue,
    onAnswerQuestion,
    onSetPendingApproval,
    onChangeScope,
}: InputAreaProps) {
    return (
        <div
            className={`input-area${isDragOver ? ' drag-over' : ''}`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            {/* Drag-drop overlay */}
            {isDragOver && (
                <div className="drag-overlay">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                    </svg>
                    <span>Drop files to attach</span>
                    <span className="drag-overlay-hint">Images, documents, code files</span>
                </div>
            )}

            {/* Message Queue Panel */}
            {messageQueue.length > 0 && (
                <div className="mq-bar">
                    <button className="mq-header" onClick={() => onSetShowQueuePanel(!showQueuePanel)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="6" rx="1" /><rect x="3" y="15" width="18" height="6" rx="1" /><line x1="3" y1="12" x2="21" y2="12" />
                        </svg>
                        <span>{messageQueue.length} queued</span>
                        <svg className={`mq-chevron${showQueuePanel ? ' mq-chevron-open' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                        {messageQueue.some(q => !q.editable) && <span className="mq-auto-label">auto</span>}
                    </button>
                    {messageQueue.filter(q => q.editable).length > 0 && (
                        <button className="mq-clear-btn" onClick={onClearUserQueue} title="Clear user messages">Clear</button>
                    )}
                    {showQueuePanel && (
                        <div className="mq-list">
                            {messageQueue.map((item, idx) => (
                                <div key={item.id} className={`mq-item${item.type === 'automation' ? ' mq-item-auto' : ''}`}>
                                    <div className="mq-item-badge">
                                        {item.type === 'automation' ? (
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
                                        ) : (
                                            <span className="mq-item-num">{idx + 1}</span>
                                        )}
                                    </div>
                                    <div className="mq-item-content">
                                        {editingQueueId === item.id ? (
                                            <textarea
                                                className="mq-edit-input"
                                                value={editingQueueText}
                                                onChange={e => onSetEditingQueueText(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                        e.preventDefault();
                                                        onEditQueueItem(item.id, editingQueueText);
                                                        onSetEditingQueueId(null);
                                                    }
                                                    if (e.key === 'Escape') onSetEditingQueueId(null);
                                                }}
                                                autoFocus
                                                rows={2}
                                            />
                                        ) : (
                                            <span className="mq-item-text">{item.title ? `[${item.title}] ` : ''}{item.content.length > 120 ? item.content.slice(0, 120) + '...' : item.content}</span>
                                        )}
                                        {item.attachments && item.attachments.length > 0 && (
                                            <span className="mq-item-attach">+{item.attachments.length} file{item.attachments.length > 1 ? 's' : ''}</span>
                                        )}
                                    </div>
                                    {item.editable && editingQueueId !== item.id && (
                                        <div className="mq-item-actions">
                                            {idx > 0 && (
                                                <button className="mq-action-btn" onClick={() => onMoveQueueItem(item.id, 'up')} title="Move up">
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15" /></svg>
                                                </button>
                                            )}
                                            {idx < messageQueue.length - 1 && (
                                                <button className="mq-action-btn" onClick={() => onMoveQueueItem(item.id, 'down')} title="Move down">
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                                                </button>
                                            )}
                                            <button className="mq-action-btn" onClick={() => { onSetEditingQueueId(item.id); onSetEditingQueueText(item.content); }} title="Edit">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                            </button>
                                            <button className="mq-action-btn mq-action-delete" onClick={() => onRemoveFromQueue(item.id)} title="Remove">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                            </button>
                                        </div>
                                    )}
                                    {!item.editable && (
                                        <div className="mq-item-lock" title="Automation result — cannot edit">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Attachment previews */}
            {attachments.length > 0 && (
                <div className="attachment-bar">
                    {attachments.map((att, i) => (
                        <div key={i} className={`attachment-preview${att.type === 'image' && att.dataUrl ? ' attachment-preview-image' : ''}`}>
                            {att.type === 'image' && att.dataUrl ? (
                                <img src={att.dataUrl} alt={att.name} className="attachment-thumb" />
                            ) : att.type === 'link' ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
                            ) : att.type === 'doc' ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                            ) : att.type === 'image' ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                            ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                            )}
                            <span>{att.name}</span>
                            {att.size && <span className="attachment-size">{att.size < 1024 ? `${att.size}B` : `${Math.round(att.size / 1024)}KB`}</span>}
                            <button className="attachment-remove" onClick={() => onRemoveAttachment(i)}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Slash command menu */}
            {showSlashMenu && filteredCommands.length > 0 && (
                <div className="slash-menu" ref={slashMenuRef}>
                    {filteredCommands.map((cmd, i) => (
                        <div
                            key={cmd.name}
                            className={`slash-menu-item ${i === slashIndex ? 'active' : ''}`}
                            onClick={() => {
                                const newVal = input.replace(/(^|\s)(\/\S*)$/, (_m, space) => space + cmd.name + ' ');
                                setInput(newVal);
                                onSetShowSlashMenu(false);
                                textareaRef.current?.focus();
                            }}
                        >
                            <span className="slash-cmd-name">{cmd.name}</span>
                            <span className="slash-cmd-desc">{cmd.description}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* @ mention menu */}
            {showMentionMenu && filteredMentions.length > 0 && (
                <div className="mention-menu" ref={mentionMenuRef}>
                    {(() => {
                        let lastCategory = '';
                        return filteredMentions.map((item, i) => {
                            const showHeader = item.category !== lastCategory;
                            lastCategory = item.category;
                            return (
                                <React.Fragment key={`${item.type}:${item.label}`}>
                                    {showHeader && <div className="mention-menu-header">{item.category}</div>}
                                    <div
                                        className={`mention-menu-item ${i === mentionIndex ? 'active' : ''}`}
                                        onClick={() => {
                                            const atIndex = input.lastIndexOf('@');
                                            const prefix = item.type === 'project' ? '@project:' : item.type === 'workflow' ? '@workflow:' : item.type === 'memory' ? '@memory:' : '@';
                                            setInput(input.slice(0, atIndex) + prefix + item.label + ' ');
                                            if (item.type === 'attachment' && item.attachment && !attachments.some(a => a.name === item.attachment!.name)) {
                                                onSetAttachments(prev => [...prev, item.attachment!]);
                                            }
                                            onSetShowMentionMenu(false);
                                            textareaRef.current?.focus();
                                        }}
                                    >
                                        <span className="mention-item-icon">
                                            {item.type === 'project' ? (
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                                            ) : item.type === 'workflow' ? (
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></svg>
                                            ) : item.type === 'memory' ? (
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z" /><line x1="9" y1="21" x2="15" y2="21" /></svg>
                                            ) : item.attachment?.type === 'link' ? (
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
                                            ) : item.attachment?.type === 'image' ? (
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                                            ) : (
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                            )}
                                        </span>
                                        <span className="mention-item-name">{item.label}</span>
                                        <span className="mention-item-detail">{item.detail}</span>
                                    </div>
                                </React.Fragment>
                            );
                        });
                    })()}
                </div>
            )}

            {/* Scope tag bar */}
            {scope !== 'general' && (
                <div className="scope-tag-bar">
                    <div className={`scope-tag scope-tag-${scope}`}>
                        {scope === 'project' ? (
                            <>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                                </svg>
                                <span>Project: {activeProject?.name || 'Unknown'}</span>
                            </>
                        ) : (
                            <>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                                    <polyline points="14 2 14 8 20 8" />
                                </svg>
                                <span>Documents</span>
                            </>
                        )}
                        <button
                            className="scope-tag-close"
                            onClick={() => onChangeScope?.('general')}
                            title="Exit to general chat (starts new chat)"
                        >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>
                </div>
            )}

            {/* Permission Approval Card */}
            {pendingApproval && (
                <div className="ask-user-card" style={{ borderColor: 'var(--warning, #ff8800)' }}>
                    <div className="ask-user-question">
                        Allow <code style={{ background: 'var(--hover)', padding: '2px 6px', borderRadius: 4 }}>{pendingApproval.tool}</code>?
                    </div>
                    {pendingApproval.args.command != null && (
                        <div style={{ padding: '4px 8px', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', background: 'var(--hover)', borderRadius: 6, marginBottom: 8 }}>
                            {String(pendingApproval.args.command).slice(0, 200)}
                        </div>
                    )}
                    <div className="ask-user-options">
                        <button
                            type="button"
                            className="ask-user-option"
                            style={{ borderColor: 'var(--success, #44cc44)' }}
                            onClick={() => {
                                window.onicode?.respondToPermission(pendingApproval.approvalId, true);
                                onSetPendingApproval(null);
                            }}
                        >
                            <span className="ask-user-option-label">Allow</span>
                        </button>
                        <button
                            type="button"
                            className="ask-user-option"
                            style={{ borderColor: 'var(--error, #ff4444)' }}
                            onClick={() => {
                                window.onicode?.respondToPermission(pendingApproval.approvalId, false);
                                onSetPendingApproval(null);
                            }}
                        >
                            <span className="ask-user-option-label">Deny</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Ask User Question Card */}
            {pendingQuestion && (
                <div className="ask-user-card">
                    <div className="ask-user-question">{pendingQuestion.question}</div>
                    <div className="ask-user-options">
                        {pendingQuestion.options.map((opt, i) => (
                            <button
                                key={i}
                                type="button"
                                className={`ask-user-option ${selectedOptions.has(i) ? 'selected' : ''}`}
                                onClick={() => {
                                    if (pendingQuestion.allowMultiple) {
                                        onSetSelectedOptions(prev => {
                                            const next = new Set(prev);
                                            if (next.has(i)) next.delete(i); else next.add(i);
                                            return next;
                                        });
                                    } else {
                                        onAnswerQuestion(opt.label);
                                    }
                                }}
                            >
                                <span className="ask-user-option-label">{opt.label}</span>
                                {opt.description && <span className="ask-user-option-desc">{opt.description}</span>}
                            </button>
                        ))}
                    </div>
                    {pendingQuestion.allowMultiple && selectedOptions.size > 0 && (
                        <button
                            type="button"
                            className="ask-user-confirm"
                            onClick={() => {
                                const selected = [...selectedOptions].map(i => pendingQuestion.options[i].label);
                                onAnswerQuestion(selected);
                            }}
                        >
                            Confirm ({selectedOptions.size} selected)
                        </button>
                    )}
                    <div className="ask-user-custom">
                        <input
                            type="text"
                            placeholder="Or type a custom answer..."
                            className="ask-user-custom-input"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                                    onAnswerQuestion((e.target as HTMLInputElement).value.trim());
                                }
                            }}
                        />
                    </div>
                </div>
            )}

            <div className="input-wrapper">
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.json,.csv,.xml,.yml,.yaml,.ts,.tsx,.js,.jsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.css,.html,.sh,.sql,.toml,.env,.cfg,.ini,.log,.rtf,.odt"
                    className="file-input-hidden"
                    onChange={onFileChange}
                />
                <div className="attach-menu-anchor" ref={attachMenuRef}>
                    <button className="attach-btn" onClick={() => onSetShowAttachMenu(prev => !prev)} title="Attach">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                    </button>
                    {showAttachMenu && (
                        <div className="attach-menu">
                            {/* Upload Files */}
                            <button className="attach-menu-item" onClick={() => { onSetShowAttachMenu(false); fileInputRef.current?.click(); }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></svg>
                                <div className="attach-menu-text"><span className="attach-menu-label">Upload Files</span><span className="attach-menu-desc">Images, code, documents</span></div>
                            </button>

                            {/* Clone Repository — sets input for AI to handle */}
                            <button className="attach-menu-item" onClick={() => {
                                onSetShowAttachMenu(false);
                                setInput('Clone this repository and set it up as a new project: ');
                                textareaRef.current?.focus();
                            }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 012 2v7" /><line x1="6" y1="9" x2="6" y2="21" /></svg>
                                <div className="attach-menu-text"><span className="attach-menu-label">Clone Repository</span><span className="attach-menu-desc">Paste a repo URL after this</span></div>
                            </button>

                            {/* Browse Files — native folder picker (this works) */}
                            <button className="attach-menu-item" onClick={async () => {
                                onSetShowAttachMenu(false);
                                if (window.onicode?.selectFolder) {
                                    const result = await window.onicode.selectFolder();
                                    if (result.success && result.path) {
                                        window.dispatchEvent(new CustomEvent('onicode-mode-switch', { detail: 'workpal' }));
                                        setInput(`Working on folder: ${result.path}`);
                                        textareaRef.current?.focus();
                                    }
                                }
                            }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                                <div className="attach-menu-text"><span className="attach-menu-label">Browse Files</span><span className="attach-menu-desc">Open a folder to work on</span></div>
                            </button>

                            {/* Open Project — navigates to projects view */}
                            <button className="attach-menu-item" onClick={() => {
                                onSetShowAttachMenu(false);
                                window.dispatchEvent(new CustomEvent('onicode-mode-switch', { detail: 'projects' }));
                                window.dispatchEvent(new CustomEvent('onicode-navigate', { detail: 'projects' }));
                            }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
                                <div className="attach-menu-text"><span className="attach-menu-label">Open Project</span><span className="attach-menu-desc">Browse and select a project</span></div>
                            </button>

                            {/* Deep Research — prefills input */}
                            <button className="attach-menu-item" onClick={() => {
                                onSetShowAttachMenu(false);
                                setInput('Deep research the following topic. Produce a comprehensive report and save it as Markdown + PDF with sources, key findings, and actionable insights.\n\nTopic: ');
                                textareaRef.current?.focus();
                            }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                                <div className="attach-menu-text"><span className="attach-menu-label">Deep Research</span><span className="attach-menu-desc">AI research with report output</span></div>
                            </button>
                        </div>
                    )}
                </div>
                <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                    placeholder={scope === 'project' ? `Ask about ${activeProject?.name || 'this project'}... (/ commands, @ attachments)` : 'Ask Onicode anything... (/ commands, @ attachments)'}
                    rows={1}
                />
                {isTyping ? (
                    <>
                        <button className="send-btn queue-btn" onClick={onSend} disabled={!input.trim()} title="Queue message">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="3" width="18" height="6" rx="1" /><rect x="3" y="15" width="18" height="6" rx="1" /><line x1="3" y1="12" x2="21" y2="12" />
                            </svg>
                            {messageQueue.length > 0 && <span className="mq-count-badge">{messageQueue.length}</span>}
                        </button>
                        <button className="send-btn stop-btn" onClick={onStopGeneration} title="Stop generation">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <rect x="6" y="6" width="12" height="12" rx="2" />
                            </svg>
                        </button>
                    </>
                ) : (
                    <button className="send-btn" onClick={onSend} disabled={!input.trim()}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13" />
                            <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                    </button>
                )}
            </div>
            <ContextBar
                contextInfo={contextInfo}
                messagesCount={messagesCount}
                showModelPicker={showModelPicker}
                thinkingLevel={thinkingLevel}
                onSetShowModelPicker={onSetShowModelPicker}
                onSetThinkingLevel={onSetThinkingLevel}
            />
        </div>
    );
}
