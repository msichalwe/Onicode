/**
 * Plan persistence — full plans, conversation-scoped plans, and agent conversations.
 */

const { getDB } = require('./db');

const planStorage = {
    save(plan, sessionId, projectId, projectPath) {
        const d = getDB();
        const now = new Date().toISOString();
        d.prepare(`
            INSERT OR REPLACE INTO plans (id, session_id, title, overview, architecture, components, design_decisions, file_map, status, project_id, project_path, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            plan.id, sessionId, plan.title, plan.overview || '', plan.architecture || '',
            JSON.stringify(plan.components || []), JSON.stringify(plan.designDecisions || []),
            JSON.stringify(plan.fileMap || []), plan.status || 'draft',
            projectId || null, projectPath || null,
            plan.createdAt || now, now,
        );
    },

    update(id, updates) {
        const d = getDB();
        const fields = [];
        const values = [];
        if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
        if (updates.overview !== undefined) { fields.push('overview = ?'); values.push(updates.overview); }
        if (updates.architecture !== undefined) { fields.push('architecture = ?'); values.push(updates.architecture); }
        if (updates.components !== undefined) { fields.push('components = ?'); values.push(JSON.stringify(updates.components)); }
        if (updates.designDecisions !== undefined) { fields.push('design_decisions = ?'); values.push(JSON.stringify(updates.designDecisions)); }
        if (updates.fileMap !== undefined) { fields.push('file_map = ?'); values.push(JSON.stringify(updates.fileMap)); }
        if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
        if (fields.length === 0) return null;
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        d.prepare(`UPDATE plans SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return planStorage.get(id);
    },

    get(id) {
        const d = getDB();
        const row = d.prepare('SELECT * FROM plans WHERE id = ?').get(id);
        if (!row) return null;
        return {
            ...row,
            components: JSON.parse(row.components || '[]'),
            designDecisions: JSON.parse(row.design_decisions || '[]'),
            fileMap: JSON.parse(row.file_map || '[]'),
        };
    },

    getActiveForSession(sessionId) {
        const d = getDB();
        const row = d.prepare("SELECT * FROM plans WHERE session_id = ? AND status != 'archived' ORDER BY updated_at DESC LIMIT 1").get(sessionId);
        if (!row) return null;
        return {
            ...row,
            components: JSON.parse(row.components || '[]'),
            designDecisions: JSON.parse(row.design_decisions || '[]'),
            fileMap: JSON.parse(row.file_map || '[]'),
        };
    },

    listForProject(projectPath) {
        const d = getDB();
        return d.prepare('SELECT id, title, status, overview, created_at, updated_at FROM plans WHERE project_path = ? ORDER BY updated_at DESC').all(projectPath);
    },

    delete(id) {
        const d = getDB();
        d.prepare('DELETE FROM plans WHERE id = ?').run(id);
    },
};

const agentConversationStorage = {
    save(agentConv) {
        const d = getDB();
        d.prepare(`
            INSERT OR REPLACE INTO agent_conversations (agent_id, parent_conversation_id, messages, tool_set, agent_type, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            agentConv.agentId, agentConv.parentConversationId || null,
            JSON.stringify(agentConv.messages || []), agentConv.toolSet || null,
            agentConv.agentType || 'general-purpose', agentConv.status || 'completed',
            agentConv.createdAt || Date.now(), Date.now()
        );
    },

    getById(agentId) {
        const d = getDB();
        const row = d.prepare('SELECT * FROM agent_conversations WHERE agent_id = ?').get(agentId);
        if (!row) return null;
        return { ...row, messages: JSON.parse(row.messages || '[]') };
    },

    update(agentId, data) {
        const d = getDB();
        const fields = [];
        const vals = [];
        if (data.messages !== undefined) { fields.push('messages = ?'); vals.push(JSON.stringify(data.messages)); }
        if (data.toolSet !== undefined) { fields.push('tool_set = ?'); vals.push(data.toolSet); }
        if (data.agentType !== undefined) { fields.push('agent_type = ?'); vals.push(data.agentType); }
        if (data.status !== undefined) { fields.push('status = ?'); vals.push(data.status); }
        if (data.parentConversationId !== undefined) { fields.push('parent_conversation_id = ?'); vals.push(data.parentConversationId); }
        if (fields.length === 0) return;
        fields.push('updated_at = ?');
        vals.push(Date.now());
        vals.push(agentId);
        d.prepare(`UPDATE agent_conversations SET ${fields.join(', ')} WHERE agent_id = ?`).run(...vals);
    },

    listByParent(parentConvId) {
        const d = getDB();
        return d.prepare('SELECT * FROM agent_conversations WHERE parent_conversation_id = ? ORDER BY created_at DESC').all(parentConvId)
            .map(row => ({ ...row, messages: JSON.parse(row.messages || '[]') }));
    },

    delete(agentId) {
        const d = getDB();
        d.prepare('DELETE FROM agent_conversations WHERE agent_id = ?').run(agentId);
    },
};

const conversationPlanStorage = {
    save(plan) {
        const d = getDB();
        const now = Date.now();
        d.prepare(`
            INSERT OR REPLACE INTO conversation_plans (id, conversation_id, content, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(plan.id, plan.conversationId || null, plan.content || '', plan.status || 'drafting', plan.createdAt || now, now);
    },

    getById(id) {
        const d = getDB();
        return d.prepare('SELECT * FROM conversation_plans WHERE id = ?').get(id) || null;
    },

    getByConversation(convId) {
        const d = getDB();
        return d.prepare('SELECT * FROM conversation_plans WHERE conversation_id = ? ORDER BY updated_at DESC').all(convId);
    },

    update(id, data) {
        const d = getDB();
        const fields = [];
        const vals = [];
        if (data.content !== undefined) { fields.push('content = ?'); vals.push(data.content); }
        if (data.status !== undefined) { fields.push('status = ?'); vals.push(data.status); }
        if (data.conversationId !== undefined) { fields.push('conversation_id = ?'); vals.push(data.conversationId); }
        if (fields.length === 0) return;
        fields.push('updated_at = ?');
        vals.push(Date.now());
        vals.push(id);
        d.prepare(`UPDATE conversation_plans SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    },

    delete(id) {
        const d = getDB();
        d.prepare('DELETE FROM conversation_plans WHERE id = ?').run(id);
    },
};

module.exports = { planStorage, agentConversationStorage, conversationPlanStorage };
