/**
 * Data IPC handlers — tasks, milestones, conversations, attachments.
 * Extracted from index.js for modularity.
 */

function registerDataIPC(deps) {
    const { ipcMain, getToolsDeps } = deps;

    // ── Task Management (for UI) ──
    ipcMain.handle('list-project-tasks', async (_event, projectPath) => {
        try {
            const { taskStorage } = require('../storage');
            return taskStorage.getProjectTaskSummary(projectPath);
        } catch {
            return { pending: [], inProgress: [], done: [], archived: [], skipped: [] };
        }
    });

    ipcMain.handle('archive-completed-tasks', async () => {
        try {
            const { taskStorage } = require('../storage');
            const { taskManager, getSessionId } = getToolsDeps();
            const sessionId = getSessionId();
            if (sessionId) taskStorage.archiveCompleted(sessionId);
            // Also update in-memory tasks
            taskManager.tasks.forEach(t => {
                if (t.status === 'done' || t.status === 'skipped') t.status = 'archived';
            });
            taskManager._notifyRenderer();
            return { success: true };
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('tasks-clear-all', async () => {
        try {
            const { taskManager } = getToolsDeps();
            taskManager.clear();
            return { success: true };
        } catch (err) {
            return { error: err.message };
        }
    });

    // ── Task Manager IPC ──
    ipcMain.handle('tasks-list', async () => {
        const { taskManager } = getToolsDeps();
        return taskManager.getSummary();
    });

    ipcMain.handle('load-project-tasks', async (_event, projectPath) => {
        if (!projectPath) return { success: false, error: 'No project path' };
        try {
            const { taskManager } = getToolsDeps();
            taskManager.loadFromProject(projectPath);
            return { success: true, summary: taskManager.getSummary() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('task-create', async (_event, { content, priority }) => {
        try {
            const { taskManager } = getToolsDeps();
            const task = taskManager.addTask(content, priority || 'medium');
            return { success: true, task, summary: taskManager.getSummary() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('task-update', async (_event, { id, updates }) => {
        try {
            const { taskManager } = getToolsDeps();
            const result = taskManager.updateTask(id, updates);
            if (result.error) return { success: false, error: result.error };
            return { success: true, task: result, summary: taskManager.getSummary() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('task-delete', async (_event, { id }) => {
        try {
            const { taskManager } = getToolsDeps();
            const result = taskManager.removeTask(id);
            if (result.error) return { success: false, error: result.error };
            return { success: true, summary: taskManager.getSummary() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── Milestone IPC (SQLite-backed) ──
    ipcMain.handle('milestone-list', async (_event, projectPath) => {
        try {
            const { milestoneStorage } = require('../storage');
            const milestones = milestoneStorage.getProjectSummary(projectPath);
            return { success: true, milestones };
        } catch (err) {
            return { success: false, error: err.message, milestones: [] };
        }
    });

    ipcMain.handle('milestone-create', async (_event, { milestone, projectId, projectPath }) => {
        try {
            const { milestoneStorage } = require('../storage');
            milestoneStorage.save(milestone, projectId, projectPath);
            return { success: true, milestone };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('milestone-update', async (_event, { id, updates }) => {
        try {
            const { milestoneStorage } = require('../storage');
            milestoneStorage.update(id, updates);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('milestone-delete', async (_event, { id }) => {
        try {
            const { milestoneStorage } = require('../storage');
            milestoneStorage.delete(id);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('task-set-milestone', async (_event, { taskId, milestoneId }) => {
        try {
            const { taskManager } = getToolsDeps();
            const task = taskManager.getTask(taskId);
            if (!task) return { success: false, error: 'Task not found' };
            task.milestoneId = milestoneId || null;
            taskManager._persistUpdate(taskId, { milestoneId: milestoneId || null });
            taskManager._notifyRenderer();
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── Conversation Storage IPC (SQLite) ──
    ipcMain.handle('conversation-save', async (_event, conv) => {
        try {
            const { conversationStorage } = require('../storage');
            conversationStorage.save(conv);
            return { success: true };
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('conversation-get', async (_event, id) => {
        try {
            const { conversationStorage } = require('../storage');
            const conv = conversationStorage.get(id);
            return { success: true, conversation: conv };
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('conversation-list', async (_event, limit, offset) => {
        try {
            const { conversationStorage } = require('../storage');
            // Light list (no messages) for sidebar/search
            const conversations = conversationStorage.list(limit || 50, offset || 0);
            return { success: true, conversations };
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('conversation-list-full', async (_event, limit) => {
        try {
            const { conversationStorage } = require('../storage');
            // Full list WITH messages for ChatView state restoration
            const conversations = conversationStorage.listFull(limit || 50);
            return { success: true, conversations };
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('conversation-delete', async (_event, id) => {
        try {
            const { conversationStorage } = require('../storage');
            conversationStorage.delete(id);
            return { success: true };
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('conversation-search', async (_event, query) => {
        try {
            const { conversationStorage } = require('../storage');
            const results = conversationStorage.search(query);
            return { success: true, results };
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('conversation-migrate', async (_event, conversations) => {
        try {
            const { conversationStorage } = require('../storage');
            const result = conversationStorage.migrateFromLocalStorage(conversations);
            return { success: true, ...result };
        } catch (err) {
            return { error: err.message };
        }
    });

    // ── Attachment Storage IPC (project-scoped) ──
    ipcMain.handle('attachment-save', async (_event, att) => {
        try {
            const { attachmentStorage } = require('../storage');
            attachmentStorage.save(att);
            return { success: true };
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('attachment-list', async (_event, projectId) => {
        try {
            const { attachmentStorage } = require('../storage');
            const attachments = attachmentStorage.listByProject(projectId);
            return { success: true, attachments };
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('attachment-delete', async (_event, id) => {
        try {
            const { attachmentStorage } = require('../storage');
            attachmentStorage.delete(id);
            return { success: true };
        } catch (err) {
            return { error: err.message };
        }
    });
}

module.exports = { registerDataIPC };
