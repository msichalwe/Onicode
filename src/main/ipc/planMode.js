/**
 * Plan mode + worktree + deferred tool loading IPC handlers.
 * Extracted from index.js for modularity.
 */

const path = require('path');

function registerPlanModeIPC(deps) {
    const { ipcMain, getToolsDeps, getCurrentProjectPath } = deps;

    // ── Plan Mode ──
    ipcMain.handle('plan-mode-enter', async (_event, conversationId) => {
        try {
            const { getPlanModeState, setPlanModeState } = getToolsDeps();
            const { conversationPlanStorage } = require('../storage');
            const existing = conversationPlanStorage.getForConversation(conversationId);
            if (existing) {
                setPlanModeState({ active: true, planId: existing.id, content: existing.content });
                return { success: true, plan: existing };
            }
            const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const content = '# Plan\n\n## Goal\n\n\n## Steps\n\n1. \n\n## Notes\n\n';
            conversationPlanStorage.save(conversationId, planId, content);
            setPlanModeState({ active: true, planId, content });
            return { success: true, plan: { id: planId, content } };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('plan-mode-exit', async (_event, planId) => {
        try {
            const { setPlanModeState } = getToolsDeps();
            setPlanModeState({ active: false, planId: null, content: null });
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('plan-mode-get', async () => {
        try {
            const { getPlanModeState } = getToolsDeps();
            return { success: true, ...getPlanModeState() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('plan-mode-update', async (_event, planId, content) => {
        try {
            const { setPlanModeState, getPlanModeState } = getToolsDeps();
            const { conversationPlanStorage } = require('../storage');
            conversationPlanStorage.updateContent(planId, content);
            const state = getPlanModeState();
            if (state.planId === planId) {
                setPlanModeState({ ...state, content });
            }
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── Worktree ──
    ipcMain.handle('worktree-create', async (_event, name) => {
        try {
            const { execSync } = require('child_process');
            const projectPath = getCurrentProjectPath() || process.cwd();
            const worktreePath = path.join(projectPath, '..', `.onicode-worktree-${name}`);
            const branch = `worktree/${name}`;
            execSync(`git worktree add -b "${branch}" "${worktreePath}"`, { cwd: projectPath, encoding: 'utf-8', timeout: 15000 });
            return { success: true, path: worktreePath, branch };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('worktree-remove', async (_event, worktreePath, force) => {
        try {
            const { execSync } = require('child_process');
            const projectPath = getCurrentProjectPath() || process.cwd();
            execSync(`git worktree remove ${force ? '--force ' : ''}"${worktreePath}"`, { cwd: projectPath, encoding: 'utf-8', timeout: 15000 });
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('worktree-list', async () => {
        try {
            const { execSync } = require('child_process');
            const projectPath = getCurrentProjectPath() || process.cwd();
            const raw = execSync('git worktree list --porcelain', { cwd: projectPath, encoding: 'utf-8', timeout: 10000 });
            const worktrees = [];
            let current = {};
            for (const line of raw.split('\n')) {
                if (line.startsWith('worktree ')) {
                    if (current.path) worktrees.push(current);
                    current = { path: line.slice(9) };
                } else if (line.startsWith('HEAD ')) {
                    current.head = line.slice(5);
                } else if (line.startsWith('branch ')) {
                    current.branch = line.slice(7).replace('refs/heads/', '');
                } else if (line === 'bare' || line === '') {
                    if (current.path) { current.isMain = worktrees.length === 0; worktrees.push(current); current = {}; }
                }
            }
            if (current.path) { current.isMain = worktrees.length === 0; worktrees.push(current); }
            return { success: true, worktrees };
        } catch (err) {
            return { success: true, worktrees: [] };
        }
    });

    ipcMain.handle('worktree-get-current', async () => {
        const { getWorktreeState } = getToolsDeps();
        const state = getWorktreeState();
        return { inWorktree: state.active, path: state.path, branch: state.active ? path.basename(state.path || '') : undefined };
    });

    // ── Deferred Tool Loading ──
    ipcMain.handle('deferred-tool-categories', async () => {
        const { DEFERRED_TOOL_CATEGORIES } = getToolsDeps();
        return { categories: DEFERRED_TOOL_CATEGORIES };
    });

    ipcMain.handle('load-tool-categories', async (_event, categories) => {
        const { loadToolCategories, invalidateToolCache } = getToolsDeps();
        const loaded = loadToolCategories(categories);
        invalidateToolCache();
        return { success: true, loaded };
    });
}

module.exports = { registerPlanModeIPC };
