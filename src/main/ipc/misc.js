/**
 * Miscellaneous IPC handlers — agents, files, user answers, activity tracking.
 * Extracted from index.js for modularity.
 */

const fs = require('fs');
const path = require('path');

function registerMiscIPC(deps) {
    const { ipcMain, getMainWindow, getToolsDeps } = deps;

    // ── User Question / Permission Responses ──
    ipcMain.handle('ai-user-answer', (_event, { questionId, answer }) => {
        const { resolveUserAnswer } = getToolsDeps();
        resolveUserAnswer(questionId, answer);
        return { success: true };
    });

    ipcMain.handle('ai-permission-response', (_event, { approvalId, approved }) => {
        const { resolvePermissionApproval } = getToolsDeps();
        resolvePermissionApproval(approvalId, approved);
        return { success: true };
    });

    // ── Chat Activity (for workflow result pipeline) ──
    ipcMain.handle('chat-activity-change', (_event, isActive) => {
        const { setWorkflowChatActive } = deps;
        setWorkflowChatActive(!!isActive);
        return { success: true };
    });

    // ── Agent & Process Runtime ──
    ipcMain.handle('list-agents', () => {
        const { listAgents } = getToolsDeps();
        return listAgents();
    });

    ipcMain.handle('list-background-processes', () => {
        const { getBackgroundProcesses } = getToolsDeps();
        return getBackgroundProcesses().map(p => ({
            id: p.id || String(p.pid),
            command: p.command || 'unknown',
            status: p.running ? 'running' : (p.exitCode != null ? (p.exitCode === 0 ? 'done' : 'error') : 'done'),
            pid: p.pid,
            port: p.port,
            startedAt: p.startedAt,
        }));
    });

    ipcMain.handle('kill-background-process', async (_event, processId) => {
        const { getBackgroundProcesses } = getToolsDeps();
        const procs = getBackgroundProcesses();
        const proc = procs.find(p => p.id === processId);
        if (!proc) return { error: 'Process not found' };
        try {
            if (proc.pid) {
                try { process.kill(-proc.pid, 'SIGTERM'); } catch {
                    process.kill(proc.pid, 'SIGTERM');
                }
            }
            return { success: true };
        } catch (err) {
            return { error: err.message };
        }
    });

    // ── File Reading ──
    ipcMain.handle('read-file-content', async (_event, filePath) => {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const stats = fs.statSync(filePath);
            return { content, size: stats.size, modified: stats.mtime.toISOString() };
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('read-file-binary', async (_event, filePath) => {
        try {
            const data = fs.readFileSync(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const mimeMap = {
                '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
                '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
                '.pdf': 'application/pdf',
                '.mp4': 'video/mp4', '.webm': 'video/webm',
            };
            const mime = mimeMap[ext] || 'application/octet-stream';
            const stats = fs.statSync(filePath);
            return { dataUri: `data:${mime};base64,${data.toString('base64')}`, size: stats.size };
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('read-screenshot-base64', async (_event, filePath) => {
        try {
            const home = require('os').homedir();
            const allowedPrefixes = [
                path.join(home, '.onicode'),
                path.join(home, 'OniProjects'),
            ];
            if (!allowedPrefixes.some(prefix => filePath.startsWith(prefix))) {
                return { error: 'Forbidden' };
            }
            const data = fs.readFileSync(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
            const mime = mimeMap[ext] || 'image/png';
            return { dataUri: `data:${mime};base64,${data.toString('base64')}` };
        } catch {
            return { error: 'Not found' };
        }
    });
}

module.exports = { registerMiscIPC };
