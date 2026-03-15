/**
 * Plan mode + worktree + deferred tool loading IPC handlers.
 * Extracted from index.js for modularity.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

function registerPlanModeIPC(deps) {
    const { ipcMain, getMainWindow, getToolsDeps, getCurrentProjectPath, invalidateToolCache } = deps;

    // ── Plan Mode ──
    ipcMain.handle('plan-mode-enter', async (_event, conversationId) => {
        try {
            const { setPlanModeState } = getToolsDeps();
            const { conversationPlanStorage } = require('../storage');
            const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const planDir = path.join(os.homedir(), '.onicode', 'plans');
            if (!fs.existsSync(planDir)) fs.mkdirSync(planDir, { recursive: true });
            const planPath = path.join(planDir, `${planId}.md`);
            fs.writeFileSync(planPath, `# Plan\n\n_Created: ${new Date().toISOString()}_\n\n## Goals\n\n## Steps\n\n## Notes\n`);
            setPlanModeState(true, planId, planPath);
            // Save to SQLite
            conversationPlanStorage.save({ id: planId, conversationId, content: '', status: 'drafting' });
            // Notify renderer
            const win = getMainWindow();
            if (win) win.webContents.send('plan-mode-changed', { active: true, planId, planPath });
            return { success: true, planId, planPath };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('plan-mode-exit', async (_event, planId) => {
        try {
            const { getPlanModeState, setPlanModeState } = getToolsDeps();
            const { conversationPlanStorage } = require('../storage');
            const state = getPlanModeState();
            if (!state.active) return { success: false, error: 'Not in plan mode' };
            const content = state.planPath && fs.existsSync(state.planPath) ? fs.readFileSync(state.planPath, 'utf-8') : '';
            setPlanModeState(false, null, null);
            // Update SQLite
            conversationPlanStorage.update(planId || state.planId, { content, status: 'completed' });
            const win = getMainWindow();
            if (win) win.webContents.send('plan-mode-changed', { active: false, planId: null });
            return { success: true, content };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('plan-mode-get', async () => {
        const { getPlanModeState } = getToolsDeps();
        const state = getPlanModeState();
        let content = '';
        if (state.active && state.planPath && fs.existsSync(state.planPath)) {
            content = fs.readFileSync(state.planPath, 'utf-8');
        }
        return { active: state.active, planId: state.planId, planPath: state.planPath, content };
    });

    ipcMain.handle('plan-mode-update', async (_event, planId, content) => {
        try {
            const { getPlanModeState } = getToolsDeps();
            const { conversationPlanStorage } = require('../storage');
            const state = getPlanModeState();
            if (!state.active) return { success: false, error: 'Not in plan mode' };
            if (state.planPath) fs.writeFileSync(state.planPath, content);
            conversationPlanStorage.update(planId || state.planId, { content });
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── Worktree ──
    ipcMain.handle('worktree-create', async (_event, name) => {
        try {
            const branchName = name || `worktree-${Date.now()}`;
            const worktreePath = path.join(os.tmpdir(), `onicode-worktree-${branchName}`);
            const { execSync } = require('child_process');
            execSync(`git worktree add -b ${branchName} "${worktreePath}"`, { cwd: getCurrentProjectPath() || process.cwd(), encoding: 'utf-8', timeout: 30000 });
            return { success: true, path: worktreePath, branch: branchName };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('worktree-remove', async (_event, worktreePath, force) => {
        try {
            const { execSync } = require('child_process');
            const forceFlag = force ? ' --force' : '';
            execSync(`git worktree remove "${worktreePath}"${forceFlag}`, { cwd: getCurrentProjectPath() || process.cwd(), encoding: 'utf-8', timeout: 30000 });
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('worktree-list', async () => {
        try {
            const { execSync } = require('child_process');
            const raw = execSync('git worktree list --porcelain', { cwd: getCurrentProjectPath() || process.cwd(), encoding: 'utf-8', timeout: 10000 });
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
        const { loadToolCategories } = getToolsDeps();
        const loaded = loadToolCategories(categories);
        // Invalidate tool cache so next AI call picks up newly loaded tools
        invalidateToolCache();
        return { success: true, loaded };
    });
}

module.exports = { registerPlanModeIPC };
