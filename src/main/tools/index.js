/**
 * Tools facade — re-exports all tool system components from submodules.
 * Callers can still do: const { executeTool, TOOL_DEFINITIONS } = require('./aiTools');
 *
 * Structure:
 *   tools/definitions.js  — TOOL_DEFINITIONS array (pure data)
 *   tools/executor.js     — executeTool function + state management
 *   tools/pathSafety.js   — Path sanitization
 *   tools/fuzzyMatch.js   — Levenshtein-based fuzzy matching
 *   tools/helpers.js      — Utility functions (lint, html, chunk, glob, search)
 *   tools/fileContext.js   — FileContextTracker class
 */

// The executor module contains the bulk of the tool system:
// - executeTool function (dispatch + pre-flight checks)
// - State management (session, permissions, agents, tasks, background processes)
// - All setter/getter functions
const executor = require('./executor');

// Re-export everything from executor (backward compatible)
module.exports = executor;
