/**
 * Tool helpers — utility functions used by the executor.
 */

const fs = require('fs');
const path = require('path');

/**
 * Quick lint/syntax check after file edits.
 * Returns array of diagnostic strings, or empty array if clean.
 */
function quickLintCheck(filePath, projectPath) {
    const ext = path.extname(filePath).toLowerCase();
    const diagnostics = [];

    try {
        if (['.js', '.mjs', '.cjs'].includes(ext)) {
            require('child_process').execSync(
                `node --check "${filePath}" 2>&1`,
                { encoding: 'utf-8', timeout: 5000 }
            );
        } else if (['.ts', '.tsx', '.jsx'].includes(ext)) {
            const projectDir = projectPath || path.dirname(filePath);
            const tsconfig = path.join(projectDir, 'tsconfig.json');
            if (fs.existsSync(tsconfig)) {
                try {
                    require('child_process').execSync(
                        `npx tsc --noEmit --pretty false "${filePath}" 2>&1`,
                        { encoding: 'utf-8', timeout: 15000, cwd: projectDir }
                    );
                } catch (tsErr) {
                    const output = tsErr.stdout || tsErr.stderr || '';
                    const lines = output.split('\n').filter(l => l.includes('error TS'));
                    for (const line of lines.slice(0, 5)) {
                        diagnostics.push(line.trim());
                    }
                }
            }
        } else if (ext === '.json') {
            JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } else if (ext === '.py') {
            try {
                require('child_process').execSync(
                    `python3 -m py_compile "${filePath}" 2>&1`,
                    { encoding: 'utf-8', timeout: 5000 }
                );
            } catch (pyErr) {
                const output = pyErr.stdout || pyErr.stderr || '';
                if (output.trim()) diagnostics.push(output.trim().split('\n').slice(-2).join(' '));
            }
        }
    } catch (err) {
        const output = err.stdout || err.stderr || err.message || '';
        const lines = output.split('\n').filter(l => l.trim());
        for (const line of lines.slice(0, 3)) {
            diagnostics.push(line.trim());
        }
    }

    return diagnostics;
}

/**
 * Strip HTML to readable text.
 */
function htmlToText(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<\/?(div|p|br|h[1-6]|li|tr|td|th|blockquote|pre|hr|section|article|header|main)[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*\n+/g, '\n\n')
        .trim();
}

/**
 * Chunk text content into pages of ~chunkSize chars each.
 */
function chunkContent(content, chunkSize = 4000) {
    const chunks = [];
    for (let i = 0; i < content.length; i += chunkSize) {
        chunks.push(content.slice(i, i + chunkSize));
    }
    return chunks;
}

/**
 * Simple glob pattern matcher (supports * and ? wildcards).
 */
function matchGlob(name, pattern) {
    const regex = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`, 'i').test(name);
}

/**
 * Search messages in a conversation for relevant chunks.
 */
function searchMessages(messages, query, limit, convId, convTitle) {
    const results = [];
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
        const contentLower = content.toLowerCase();

        let score = 0;
        for (const term of queryTerms) {
            const occurrences = (contentLower.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
            score += occurrences;
        }

        if (score > 0) {
            const firstMatch = contentLower.indexOf(queryTerms[0] || queryLower);
            const snippetStart = Math.max(0, firstMatch - 100);
            const snippet = content.slice(snippetStart, snippetStart + 500);

            results.push({
                conversation_id: convId,
                conversation_title: convTitle || '(untitled)',
                message_index: i,
                role: msg.role,
                score: Math.round(score * 100) / 100,
                snippet: snippet + (content.length > snippetStart + 500 ? '...' : ''),
                timestamp: msg.timestamp || null,
            });
        }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
}

module.exports = { quickLintCheck, htmlToText, chunkContent, matchGlob, searchMessages };
