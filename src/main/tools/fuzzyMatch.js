/**
 * Fuzzy text matching — Levenshtein-based edit matching for file edits.
 */

/**
 * Fuzzy find a text block in content using line-by-line similarity.
 * Returns { start, end, similarity, matchedText } or null.
 */
function fuzzyFindBlock(content, searchBlock) {
    const contentLines = content.split('\n');
    const searchLines = searchBlock.split('\n').map(l => l.trim());
    const searchLen = searchLines.length;

    if (searchLen === 0 || contentLines.length === 0) return null;

    let bestMatch = null;
    let bestScore = 0;

    for (let i = 0; i <= contentLines.length - searchLen; i++) {
        let totalSim = 0;
        for (let j = 0; j < searchLen; j++) {
            const contentLine = contentLines[i + j].trim();
            const searchLine = searchLines[j];
            totalSim += lineSimilarity(contentLine, searchLine);
        }
        const avgSim = totalSim / searchLen;

        if (avgSim > bestScore) {
            bestScore = avgSim;
            const startCharPos = contentLines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
            const matchedText = contentLines.slice(i, i + searchLen).join('\n');
            const endCharPos = startCharPos + matchedText.length;
            bestMatch = { start: startCharPos, end: endCharPos, similarity: avgSim, matchedText };
        }
    }

    return bestMatch;
}

/**
 * Line similarity using normalized Levenshtein distance (0-1).
 */
function lineSimilarity(a, b) {
    if (a === b) return 1.0;
    if (a.length === 0 || b.length === 0) return 0;

    const maxLen = Math.max(a.length, b.length);
    if (Math.abs(a.length - b.length) / maxLen > 0.4) return 0.3;

    const dist = levenshtein(a, b, Math.floor(maxLen * 0.3));
    if (dist === -1) return 0.3;
    return 1.0 - dist / maxLen;
}

/**
 * Levenshtein distance with early termination.
 * Returns -1 if distance exceeds maxDist.
 */
function levenshtein(a, b, maxDist = Infinity) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > maxDist) return -1;

    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    let curr = new Array(n + 1);

    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        let rowMin = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
            rowMin = Math.min(rowMin, curr[j]);
        }
        if (rowMin > maxDist) return -1;
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

module.exports = { fuzzyFindBlock, lineSimilarity, levenshtein };
