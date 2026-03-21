/**
 * Context Compactor — summarizes old conversation messages to free context window space.
 *
 * Modeled after Claude Code's context compaction: when the conversation grows too long,
 * older messages are mechanically summarized into a single compact message while recent
 * messages are kept verbatim.
 */

const DEFAULT_TOKEN_THRESHOLD = 60000;
const DEFAULT_KEEP_LAST = 10;

let _aiCallFunction = null;

/**
 * Set the AI call function reference for semantic compaction.
 * @param {Function} fn — async function(messages, options) => string
 */
function setAICallFunction(fn) { _aiCallFunction = fn; }

// ─── Model-Aware Context Limits ──────────────────────────────────────────────

/**
 * Model context window sizes (input tokens).
 * Used for compaction thresholds and context bar display.
 */
const MODEL_CONTEXT_WINDOWS = {
    'gpt-5.4': 1048576,     // 1.05M
    'gpt-5.4-pro': 1048576,
    'gpt-5': 1048576,
    'gpt-5-mini': 1048576,
    'gpt-5-nano': 524288,   // 512K
    'gpt-4.1': 1048576,
    'gpt-4.1-mini': 1048576,
    'gpt-4.1-nano': 1048576,
    'gpt-4o': 128000,
    'gpt-4o-mini': 128000,
    'o3': 200000,
    'o3-pro': 200000,
    'o3-mini': 200000,
    'o4-mini': 200000,
    'claude-opus-4-6': 200000,
    'claude-sonnet-4-6': 200000,
    'claude-sonnet-4-20250514': 200000,
    'claude-haiku-4-5-20251001': 200000,
    'claude-3-5-haiku-20241022': 200000,
};

/**
 * Model max output tokens.
 */
const MODEL_MAX_OUTPUT = {
    'gpt-5.4': 131072,      // 128K
    'gpt-5.4-pro': 131072,
    'gpt-5': 65536,          // 64K
    'gpt-5-mini': 65536,
    'gpt-5-nano': 32768,
    'gpt-4.1': 32768,
    'gpt-4.1-mini': 32768,
    'gpt-4.1-nano': 16384,
    'gpt-4o': 16384,
    'gpt-4o-mini': 16384,
    'o3': 100000,
    'o3-pro': 100000,
    'o3-mini': 100000,
    'o4-mini': 100000,
    'claude-opus-4-6': 32000,
    'claude-sonnet-4-6': 16000,
    'claude-sonnet-4-20250514': 16000,
};

/**
 * Get the context window size for a model.
 * @param {string} model
 * @returns {number}
 */
function getModelContextWindow(model) {
    if (!model) return 128000;
    // Direct match
    if (MODEL_CONTEXT_WINDOWS[model]) return MODEL_CONTEXT_WINDOWS[model];
    // Prefix match (e.g. "gpt-5.4-turbo" → gpt-5.4)
    if (model.startsWith('gpt-5.4')) return 1048576;
    if (model.startsWith('gpt-5')) return 1048576;
    if (model.startsWith('gpt-4.1')) return 1048576;
    if (model.startsWith('gpt-4o')) return 128000;
    if (model.startsWith('o3') || model.startsWith('o4')) return 200000;
    if (model.startsWith('claude')) return 200000;
    return 128000; // safe default
}

/**
 * Get the max output tokens for a model.
 * @param {string} model
 * @returns {number}
 */
function getModelMaxOutput(model) {
    if (!model) return 16384;
    if (MODEL_MAX_OUTPUT[model]) return MODEL_MAX_OUTPUT[model];
    if (model.startsWith('gpt-5.4')) return 131072;
    if (model.startsWith('gpt-5')) return 65536;
    if (model.startsWith('gpt-4.1')) return 32768;
    if (model.startsWith('o3') || model.startsWith('o4')) return 100000;
    if (model.startsWith('claude')) return 16000;
    return 16384;
}

/**
 * Get the compaction threshold for a model — compact at ~50% of context window.
 * This leaves plenty of room for the AI to work after compaction.
 * @param {string} model
 * @returns {number} token threshold at which to trigger compaction
 */
function getCompactionThreshold(model) {
    const ctx = getModelContextWindow(model);
    if (ctx >= 1000000) return 500000;  // 1M+ models: compact at 500K
    if (ctx >= 200000) return 120000;   // 200K models: compact at 120K
    if (ctx >= 128000) return 80000;    // 128K models: compact at 80K
    return 60000;                        // smaller: compact at 60K
}

// ─── Token Estimation ────────────────────────────────────────────────────────

/**
 * Estimate tokens for a string.
 * Uses ~3.8 chars/token for mixed English+code content (GPT-5.x cl200k_base tokenizer).
 * Code-heavy text averages ~3.2 chars/token, prose ~4.2 chars/token.
 * @param {string} text
 * @returns {number}
 */
function estimateStringTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 3.8);
}

/**
 * Estimate token overhead for tool definitions in the API call.
 * Each tool definition adds ~150-300 tokens (name, description, parameters schema).
 * @param {number} toolCount — number of tool definitions
 * @returns {number}
 */
function estimateToolTokens(toolCount) {
    if (!toolCount || toolCount <= 0) return 0;
    // Average ~200 tokens per tool definition (name + desc + param schema)
    return toolCount * 200;
}

/**
 * Estimate tokens for an image based on detail level.
 * OpenAI vision token costs:
 *   - low detail: 85 tokens (fixed)
 *   - high detail: 85 + 170 * tiles (each 512x512 tile = 170 tokens)
 *   - auto: assume high detail average (~765 tokens for typical image)
 * @param {string} [detail='auto'] — 'low', 'high', or 'auto'
 * @returns {number}
 */
function estimateImageTokens(detail) {
    if (detail === 'low') return 85;
    if (detail === 'high') return 1105; // ~6 tiles average (85 + 170*6)
    return 765; // auto: assume ~4 tiles average
}

/**
 * Estimate total tokens across an array of chat messages.
 * Accounts for role labels, content, tool call metadata, image tokens, etc.
 * @param {Array<{role: string, content: string, tool_calls?: any[], name?: string}>} messages
 * @returns {number}
 */
function estimateTokens(messages) {
    if (!Array.isArray(messages)) return 0;

    let total = 0;
    for (const msg of messages) {
        // Per-message overhead: role token, separators, message framing
        // OpenAI uses ~4 base tokens per message + additional for role/name fields
        // With tool calls and structured content, overhead is higher (~15-50 tokens)
        total += 15;

        if (typeof msg.content === 'string') {
            total += estimateStringTokens(msg.content);
        } else if (Array.isArray(msg.content)) {
            // Multi-part content (text + images, etc.)
            for (const part of msg.content) {
                if (part.type === 'text') {
                    total += estimateStringTokens(part.text);
                } else if (part.type === 'image_url') {
                    const detail = part.image_url?.detail || 'auto';
                    total += estimateImageTokens(detail);
                }
            }
        }

        // Tool calls in assistant messages
        if (Array.isArray(msg.tool_calls)) {
            for (const tc of msg.tool_calls) {
                total += 10; // tool_call framing overhead (id, type, function wrapper)
                total += estimateStringTokens(tc.function?.name || '');
                total += estimateStringTokens(tc.function?.arguments || '');
            }
        }

        // Tool result messages
        if (msg.name) {
            total += estimateStringTokens(msg.name);
        }
    }

    return total;
}

// ─── Compaction Trigger ──────────────────────────────────────────────────────

/**
 * Determine whether the conversation should be compacted.
 * @param {Array} messages
 * @param {number|string} [thresholdOrModel] — token threshold or model name for auto-threshold
 * @returns {boolean}
 */
function shouldCompact(messages, thresholdOrModel = DEFAULT_TOKEN_THRESHOLD) {
    const threshold = typeof thresholdOrModel === 'string'
        ? getCompactionThreshold(thresholdOrModel)
        : thresholdOrModel;
    return estimateTokens(messages) > threshold;
}

// ─── Extraction Helpers ──────────────────────────────────────────────────────

/**
 * Extract structured information from a set of messages for summarization.
 * Purely mechanical — no AI generation involved.
 */
function extractConversationData(messages) {
    const data = {
        firstUserMessage: null,
        decisions: [],
        filesModified: new Map(),   // path → { action, linesAdded, linesRemoved }
        commandsRun: [],
        errors: [],
        tasks: [],
        keyInstructions: [],
        toolCalls: [],
    };

    for (const msg of messages) {
        const content = typeof msg.content === 'string' ? msg.content : '';

        // ── User messages ──────────────────────────────────────────────
        if (msg.role === 'user') {
            if (!data.firstUserMessage) {
                data.firstUserMessage = truncate(content, 200);
            }
            // Capture key instructions (lines that look directive)
            const lines = content.split('\n').filter(l => l.trim());
            for (const line of lines) {
                if (looksLikeInstruction(line)) {
                    data.keyInstructions.push(truncate(line.trim(), 150));
                }
            }
        }

        // ── Assistant messages ─────────────────────────────────────────
        if (msg.role === 'assistant') {
            // Extract decisions (lines with decision-like language)
            const lines = content.split('\n');
            for (const line of lines) {
                if (looksLikeDecision(line)) {
                    data.decisions.push(truncate(line.trim(), 150));
                }
            }

            // Extract tool calls
            if (Array.isArray(msg.tool_calls)) {
                for (const tc of msg.tool_calls) {
                    const name = tc.function?.name || 'unknown';
                    const args = safeParseJSON(tc.function?.arguments);
                    data.toolCalls.push({ name, args });
                    processToolCall(data, name, args);
                }
            }
        }

        // ── Tool result messages ───────────────────────────────────────
        if (msg.role === 'tool') {
            // Check for errors in tool results
            if (content.toLowerCase().includes('error') ||
                content.toLowerCase().includes('failed') ||
                content.toLowerCase().includes('exception')) {
                data.errors.push(truncate(content, 200));
            }

            // Check for command exit codes
            const exitMatch = content.match(/exit\s*(?:code\s*)?(\d+)/i);
            if (exitMatch && exitMatch[1] !== '0') {
                data.errors.push(truncate(content, 200));
            }
        }

        // ── System messages ────────────────────────────────────────────
        // Preserve task references from system messages
        if (msg.role === 'system' && content.includes('[')) {
            const taskMatches = content.match(/\[(done|in_progress|pending|todo|x|\s)\]\s*.+/gi);
            if (taskMatches) {
                data.tasks.push(...taskMatches.map(t => truncate(t, 150)));
            }
        }
    }

    // Deduplicate
    data.decisions = dedup(data.decisions).slice(0, 15);
    data.keyInstructions = dedup(data.keyInstructions).slice(0, 10);
    data.errors = dedup(data.errors).slice(0, 10);
    data.tasks = dedup(data.tasks).slice(0, 20);

    return data;
}

/**
 * Process a tool call and update file/command tracking.
 */
function processToolCall(data, name, args) {
    const nameLower = name.toLowerCase();

    // File operations
    if (nameLower.includes('read') || nameLower === 'read') {
        const filePath = args?.file_path || args?.path || '';
        if (filePath) {
            if (!data.filesModified.has(filePath)) {
                data.filesModified.set(filePath, { action: 'read' });
            }
        }
    }

    if (nameLower.includes('edit') || nameLower === 'edit' || nameLower.includes('replace')) {
        const filePath = args?.file_path || args?.path || '';
        if (filePath) {
            const existing = data.filesModified.get(filePath);
            const oldLen = (args?.old_string || '').split('\n').length;
            const newLen = (args?.new_string || '').split('\n').length;
            data.filesModified.set(filePath, {
                action: 'edited',
                linesAdded: (existing?.linesAdded || 0) + Math.max(0, newLen - oldLen),
                linesRemoved: (existing?.linesRemoved || 0) + Math.max(0, oldLen - newLen),
            });
        }
    }

    if (nameLower.includes('write') || nameLower === 'write' || nameLower.includes('create')) {
        const filePath = args?.file_path || args?.path || '';
        if (filePath) {
            const lineCount = (args?.content || '').split('\n').length;
            data.filesModified.set(filePath, {
                action: 'created',
                linesAdded: lineCount,
                linesRemoved: 0,
            });
        }
    }

    // Commands
    if (nameLower.includes('bash') || nameLower.includes('terminal') ||
        nameLower.includes('exec') || nameLower.includes('command')) {
        const cmd = args?.command || args?.cmd || '';
        if (cmd) {
            data.commandsRun.push(truncate(cmd, 120));
        }
    }
}

// ─── Summary Builder ─────────────────────────────────────────────────────────

/**
 * Build a structured summary string from extracted conversation data.
 * @param {object} data — output of extractConversationData
 * @param {number} compactedCount — number of messages that were compacted
 * @param {Array} lastContextMessages — last few messages before the kept window
 * @returns {string}
 */
function buildSummary(data, compactedCount, lastContextMessages) {
    const lines = [];

    lines.push(`[Context Summary — Messages 1-${compactedCount} compacted]`);
    lines.push('');

    // ── Conversation Summary ───────────────────────────────────────
    lines.push('## Conversation Summary');
    if (data.firstUserMessage) {
        lines.push(`- User asked to: ${data.firstUserMessage}`);
    }
    if (data.decisions.length > 0) {
        lines.push(`- Key decisions:`);
        for (const d of data.decisions) {
            lines.push(`  - ${d}`);
        }
    }
    if (data.keyInstructions.length > 0) {
        lines.push(`- Key instructions from user:`);
        for (const inst of data.keyInstructions) {
            lines.push(`  - ${inst}`);
        }
    }
    lines.push('');

    // ── Files Modified ─────────────────────────────────────────────
    if (data.filesModified.size > 0) {
        lines.push('## Files Modified This Session');
        for (const [filePath, info] of data.filesModified) {
            let detail = info.action;
            if (info.action === 'created' && info.linesAdded) {
                detail = `created, ${info.linesAdded} lines`;
            } else if (info.action === 'edited') {
                const parts = [];
                if (info.linesAdded) parts.push(`+${info.linesAdded}`);
                if (info.linesRemoved) parts.push(`-${info.linesRemoved}`);
                detail = `edited${parts.length ? ', ' + parts.join('/') + ' lines' : ''}`;
            }
            lines.push(`- ${filePath} (${detail})`);
        }
        lines.push('');
    }

    // ── Commands Run ───────────────────────────────────────────────
    if (data.commandsRun.length > 0) {
        lines.push('## Commands Run');
        // Deduplicate consecutive identical commands
        const seen = new Set();
        for (const cmd of data.commandsRun) {
            if (!seen.has(cmd)) {
                seen.add(cmd);
                lines.push(`- ${cmd}`);
            }
        }
        lines.push('');
    }

    // ── Errors ─────────────────────────────────────────────────────
    if (data.errors.length > 0) {
        lines.push('## Errors Encountered');
        for (const err of data.errors) {
            lines.push(`- ${err}`);
        }
        lines.push('');
    }

    // ── Tasks ──────────────────────────────────────────────────────
    if (data.tasks.length > 0) {
        lines.push('## Tasks');
        for (const task of data.tasks) {
            lines.push(`- ${task}`);
        }
        lines.push('');
    }

    // ── Last Context ───────────────────────────────────────────────
    if (lastContextMessages.length > 0) {
        lines.push('## Last Context');
        for (const msg of lastContextMessages) {
            const content = typeof msg.content === 'string' ? msg.content : '[non-text content]';
            lines.push(`[${msg.role}]: ${truncate(content, 300)}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

// ─── Main Compaction ─────────────────────────────────────────────────────────

/**
 * Compact a message array: summarize old messages, keep recent ones verbatim.
 *
 * @param {Array} messages — full conversation messages
 * @param {number} [keepLast=10] — number of recent messages to keep verbatim
 * @returns {{ messages: Array, compacted: boolean, originalTokens: number, newTokens: number }}
 */
function compactMessages(messages, keepLast = DEFAULT_KEEP_LAST) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return {
            messages: messages || [],
            compacted: false,
            originalTokens: 0,
            newTokens: 0,
        };
    }

    const originalTokens = estimateTokens(messages);

    // Not enough messages to warrant compaction
    if (messages.length <= keepLast + 2) {
        return {
            messages,
            compacted: false,
            originalTokens,
            newTokens: originalTokens,
        };
    }

    // Split: old messages to summarize, recent messages to keep
    const splitIndex = messages.length - keepLast;
    const oldMessages = messages.slice(0, splitIndex);
    const keptMessages = messages.slice(splitIndex);

    // Grab last 3 of the old messages as "last context" bridge
    const lastContextCount = Math.min(3, oldMessages.length);
    const lastContextMessages = oldMessages.slice(-lastContextCount);

    // Extract structured data from all old messages
    const data = extractConversationData(oldMessages);

    // Build the summary
    const summaryText = buildSummary(data, splitIndex, lastContextMessages);

    // Create the compacted system message
    const summaryMessage = {
        role: 'system',
        content: summaryText,
    };

    // Ensure the kept messages start cleanly — if the first kept message is a
    // tool result without a preceding assistant tool_call, it will confuse the
    // model. In that case, drop orphaned tool results from the front.
    const cleanKept = dropOrphanedToolResults(keptMessages);

    const newMessages = [summaryMessage, ...cleanKept];
    const newTokens = estimateTokens(newMessages);

    // Bridge to memory system — persist compaction summary to daily log
    try {
        const { saveCompactionToMemory } = require('./memory');
        saveCompactionToMemory(summaryText, splitIndex);
    } catch {
        // Memory module not available — proceed without persisting
    }

    return {
        messages: newMessages,
        compacted: true,
        originalTokens,
        newTokens,
        compactedMessageCount: splitIndex,
    };
}

/**
 * Drop tool-result messages at the start of an array that have no matching
 * tool_call in a preceding assistant message (within this array).
 */
function dropOrphanedToolResults(messages) {
    let startIndex = 0;
    for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === 'tool') {
            startIndex = i + 1;
        } else {
            break;
        }
    }
    return messages.slice(startIndex);
}

// ─── Semantic Compaction ─────────────────────────────────────────────────────

/**
 * Semantic compaction — uses the AI to create an intelligent summary
 * Falls back to mechanical compaction if AI is unavailable
 */
async function semanticCompact(messages, keepRecent = DEFAULT_KEEP_LAST) {
    const splitIndex = messages.length - keepRecent;
    if (splitIndex <= 1) return messages; // Nothing to compact

    const oldMessages = messages.slice(0, splitIndex);
    const recentMessages = messages.slice(splitIndex);

    // Try AI-powered summarization
    try {
        const aiCall = _aiCallFunction;
        if (aiCall) {
            const summaryPrompt = [
                {
                    role: 'system',
                    content: `You are a conversation summarizer for an AI coding assistant. Create a concise but comprehensive summary of the conversation below. Focus on:
1. What files were created, modified, or deleted (with paths)
2. Key decisions made and why
3. Current state of the project/task
4. Any errors encountered and how they were resolved
5. What the user was trying to accomplish
6. Any important context the AI needs to continue the work

Format as structured markdown. Be thorough but concise. Include exact file paths and line numbers where relevant.`
                },
                {
                    role: 'user',
                    content: `Summarize this conversation:\n\n${oldMessages.map(m => `[${m.role}]: ${typeof m.content === 'string' ? m.content.slice(0, 2000) : JSON.stringify(m.content).slice(0, 2000)}`).join('\n\n')}`
                }
            ];

            // Use a compact model call (no streaming, short response)
            const summary = await aiCall(summaryPrompt, { maxTokens: 2000, noStream: true });

            if (summary && summary.length > 50) {
                try {
                    const { logger } = require('./logger');
                    logger.info('compactor', `Semantic compaction: ${oldMessages.length} messages → AI summary (${summary.length} chars)`);
                } catch {}

                // Save to memory
                try {
                    const { saveCompactionToMemory } = require('./memory');
                    saveCompactionToMemory(summary, splitIndex);
                } catch {}

                return [
                    messages[0], // Keep system message
                    {
                        role: 'assistant',
                        content: `[CONTEXT COMPACTION — AI Summary of ${oldMessages.length - 1} messages]\n\n${summary}\n\n[End of summary — continue from where you left off]`
                    },
                    ...recentMessages
                ];
            }
        }
    } catch (err) {
        try {
            const { logger } = require('./logger');
            logger.warn('compactor', `Semantic compaction failed, falling back to mechanical: ${err.message}`);
        } catch {}
    }

    // Fallback to mechanical compaction
    return compactMessages(messages, keepRecent).messages;
}

// ─── IPC Registration ────────────────────────────────────────────────────────

/**
 * Register IPC handlers for context compaction.
 * @param {Electron.IpcMain} ipcMain
 */
function registerCompactorIPC(ipcMain) {
    ipcMain.handle('compact-messages', (_event, messages, keepLast) => {
        try {
            return compactMessages(messages, keepLast);
        } catch (err) {
            return { error: err.message, messages, compacted: false };
        }
    });

    ipcMain.handle('estimate-tokens', (_event, messages, model) => {
        try {
            const tokens = estimateTokens(messages);
            const contextWindow = model ? getModelContextWindow(model) : 128000;
            const maxOutput = model ? getModelMaxOutput(model) : 16384;
            return { tokens, contextWindow, maxOutput };
        } catch (err) {
            return { error: err.message, tokens: 0 };
        }
    });
}

// ─── Utility Helpers ─────────────────────────────────────────────────────────

function truncate(str, maxLen) {
    if (!str) return '';
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 3) + '...';
}

function safeParseJSON(str) {
    if (!str || typeof str !== 'string') return {};
    try {
        return JSON.parse(str);
    } catch {
        return {};
    }
}

function dedup(arr) {
    return [...new Set(arr)];
}

/**
 * Heuristic: does this line look like a user instruction?
 * (imperative verbs, action-oriented phrasing)
 */
function looksLikeInstruction(line) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed.length < 10 || trimmed.length > 300) return false;
    const starters = [
        'create ', 'add ', 'fix ', 'update ', 'remove ', 'delete ', 'change ',
        'implement ', 'build ', 'write ', 'make ', 'set ', 'configure ',
        'refactor ', 'move ', 'rename ', 'install ', 'run ', 'test ',
        'deploy ', 'ensure ', 'check ', 'verify ', 'use ', 'do not ',
        'don\'t ', 'please ', 'i want ', 'i need ', 'can you ', 'should ',
        'must ', 'the file should', 'it should', 'this should',
    ];
    return starters.some(s => trimmed.startsWith(s));
}

/**
 * Heuristic: does this line look like a decision statement?
 */
function looksLikeDecision(line) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed.length < 15 || trimmed.length > 300) return false;
    const patterns = [
        /^i('ll| will) /,
        /^let('s| us) /,
        /^we('ll| will| should| need to) /,
        /^i('m| am) going to /,
        /^the (best|right|correct) approach/,
        /^instead(,| of)/,
        /^rather than/,
        /^switching to/,
        /^using .+ instead/,
        /^decided to/,
    ];
    return patterns.some(p => p.test(trimmed));
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
    estimateTokens,
    estimateStringTokens,
    estimateToolTokens,
    estimateImageTokens,
    shouldCompact,
    compactMessages,
    semanticCompact,
    setAICallFunction: setAICallFunction,
    registerCompactorIPC,
    getCompactionThreshold,
    getModelContextWindow,
    getModelMaxOutput,
    MODEL_CONTEXT_WINDOWS,
};
