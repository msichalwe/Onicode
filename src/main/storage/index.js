/**
 * Storage facade — re-exports all storage accessors from submodules.
 * Callers can still do: const { taskStorage, conversationStorage } = require('./storage');
 */

const { getDB, closeDB } = require('./db');
const { taskStorage } = require('./taskStorage');
const { milestoneStorage } = require('./milestoneStorage');
const { planStorage, agentConversationStorage, conversationPlanStorage } = require('./planStorage');
const { conversationStorage } = require('./conversationStorage');
const { sessionStorage } = require('./sessionStorage');
const { attachmentStorage } = require('./attachmentStorage');
const { memoryStorage } = require('./memoryStorage');
const { workflowStorage, scheduleStorage, workflowRunStorage, heartbeatStorage } = require('./automationStorage');

module.exports = {
    getDB,
    closeDB,
    taskStorage,
    milestoneStorage,
    planStorage,
    conversationPlanStorage,
    agentConversationStorage,
    conversationStorage,
    sessionStorage,
    attachmentStorage,
    memoryStorage,
    workflowStorage,
    scheduleStorage,
    workflowRunStorage,
    heartbeatStorage,
};
