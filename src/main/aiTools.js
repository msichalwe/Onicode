/**
 * AI Tool System facade redirect — all tool logic lives in ./tools/ subdirectory.
 * This file exists for backward compatibility with require('./aiTools').
 *
 * Structure:
 *   tools/definitions.js  — TOOL_DEFINITIONS array (pure data, ~1465 lines)
 *   tools/executor.js     — executeTool + state management (~3940 lines)
 *   tools/pathSafety.js   — Path sanitization
 *   tools/fuzzyMatch.js   — Levenshtein-based fuzzy matching
 *   tools/helpers.js      — Utility functions (lint, html, chunk, glob, search)
 *   tools/fileContext.js   — FileContextTracker class
 */
module.exports = require('./tools/index');
