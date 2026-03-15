/**
 * Channels Module — Transport layer for external messaging channels.
 *
 * Architecture: Onicode is the brain. ChatView is the brain's UI.
 * Channels are TRANSPORT ONLY — they receive messages and deliver responses.
 * All AI processing goes through ChatView (same system prompt, tools, hooks, rendering).
 *
 * Flow:
 *   Telegram message → main process → emit to renderer → ChatView processes it
 *   → AI response → main process → Telegram delivery
 *
 * Storage: ~/.onicode/channels.json
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { logger } = require('./logger');

// ══════════════════════════════════════════
//  Config
// ══════════════════════════════════════════

const CONFIG_DIR = path.join(os.homedir(), '.onicode');
const CONFIG_PATH = path.join(CONFIG_DIR, 'channels.json');

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (err) { logger.warn('channels', `Config read failed: ${err.message}`); }
    return {};
}

function saveConfig(config) {
    try {
        if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    } catch (err) { logger.error('channels', `Config save failed: ${err.message}`); }
}

// ══════════════════════════════════════════
//  Telegram Bot API
// ══════════════════════════════════════════

function telegramAPI(token, method, body) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : '';
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${token}/${method}`,
            method: body ? 'POST' : 'GET',
            headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
        }, (res) => {
            let chunks = '';
            res.on('data', c => chunks += c);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(chunks);
                    if (parsed.ok) resolve(parsed.result);
                    else reject(new Error(parsed.description || 'Telegram API error'));
                } catch (e) { reject(new Error(`Invalid response`)); }
            });
        });
        req.on('error', reject);
        req.setTimeout(60000, () => { req.destroy(); reject(new Error('timeout')); });
        if (data) req.write(data);
        req.end();
    });
}

function sendTelegramMessage(token, chatId, text) {
    const MAX = 4000;
    const chunks = [];
    let rem = text;
    while (rem.length > 0) {
        if (rem.length <= MAX) { chunks.push(rem); break; }
        let idx = rem.lastIndexOf('\n', MAX);
        if (idx < MAX / 2) idx = MAX;
        chunks.push(rem.slice(0, idx));
        rem = rem.slice(idx);
    }
    return Promise.all(chunks.map(c =>
        telegramAPI(token, 'sendMessage', { chat_id: chatId, text: c }).catch(() =>
            telegramAPI(token, 'sendMessage', { chat_id: chatId, text: c })
        )
    ));
}

function sendTelegramTyping(token, chatId) {
    return telegramAPI(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
}

function registerBotCommands(token) {
    telegramAPI(token, 'setMyCommands', { commands: [
        { command: 'new', description: 'Start a new conversation' },
        { command: 'status', description: 'Bot and model info' },
        { command: 'model', description: 'Current AI model' },
        { command: 'clear', description: 'Clear conversation' },
        { command: 'help', description: 'Show all commands' },
        { command: 'start', description: 'Welcome message' },
    ]}).catch(() => {});
}

// ══════════════════════════════════════════
//  State
// ══════════════════════════════════════════

let _telegramState = {
    token: null,
    botInfo: null,
    connected: false,
    polling: false,
    offset: 0,
    allowedChatIds: [],
    activeChats: new Set(),  // track which chatIds are active
    pollAbort: null,
};

let _getMainWindow = () => null;
let _providerConfig = null;

// Pending response promises — chatId → { resolve, timer }
const _pendingResponses = new Map();

function setMainWindow(getWin) { _getMainWindow = getWin; }
function setProviderConfig(config) { _providerConfig = config; }

function emitToRenderer(channel, data) {
    const win = _getMainWindow();
    win?.webContents?.send(channel, data);
}

// ══════════════════════════════════════════
//  Connection Lifecycle
// ══════════════════════════════════════════

async function telegramValidateToken(token) {
    if (!token || !token.includes(':')) throw new Error('Invalid format. Expected: 123456789:ABCdef...');
    const bot = await telegramAPI(token, 'getMe');
    return { id: bot.id, firstName: bot.first_name, username: bot.username };
}

async function telegramConnect(token, allowedChatIds = []) {
    const botInfo = await telegramValidateToken(token);
    const config = loadConfig();
    config.telegram = { token, botId: botInfo.id, botUsername: botInfo.username, botName: botInfo.firstName, allowedChatIds, connectedAt: Date.now() };
    saveConfig(config);

    _telegramState.token = token;
    _telegramState.botInfo = botInfo;
    _telegramState.connected = true;
    _telegramState.allowedChatIds = allowedChatIds;

    registerBotCommands(token);
    startTelegramPolling();

    logger.info('channels', `Telegram connected: @${botInfo.username}`);
    emitToRenderer('channel-status', { channel: 'telegram', status: 'connected', botInfo });
    return { success: true, botInfo };
}

function telegramDisconnect() {
    stopTelegramPolling();
    _telegramState.token = null;
    _telegramState.botInfo = null;
    _telegramState.connected = false;
    _telegramState.activeChats.clear();
    for (const [, pending] of _pendingResponses) { clearTimeout(pending.timer); pending.resolve(null); }
    _pendingResponses.clear();
    const config = loadConfig();
    delete config.telegram;
    saveConfig(config);
    logger.info('channels', 'Telegram disconnected');
    emitToRenderer('channel-status', { channel: 'telegram', status: 'disconnected' });
    return { success: true };
}

async function telegramAutoConnect() {
    const config = loadConfig();
    if (!config.telegram?.token) return;
    try { await telegramConnect(config.telegram.token, config.telegram.allowedChatIds || []); }
    catch (err) {
        logger.warn('channels', `Telegram auto-connect failed: ${err.message}`);
        emitToRenderer('channel-status', { channel: 'telegram', status: 'error', error: err.message });
    }
}

// ══════════════════════════════════════════
//  Polling
// ══════════════════════════════════════════

function startTelegramPolling() {
    if (_telegramState.polling) return;
    _telegramState.polling = true;
    _pollLoop();
}

function stopTelegramPolling() {
    _telegramState.polling = false;
    if (_telegramState.pollAbort) { try { _telegramState.pollAbort.destroy(); } catch {} _telegramState.pollAbort = null; }
}

async function _pollLoop() {
    while (_telegramState.polling && _telegramState.token) {
        try {
            const updates = await _getUpdates();
            for (const update of updates) {
                _telegramState.offset = update.update_id + 1;
                if (update.message?.text) await _handleTelegramMessage(update.message);
            }
        } catch (err) {
            if (_telegramState.polling) {
                logger.warn('channels', `Poll error: ${err.message}`);
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }
}

function _getUpdates() {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${_telegramState.token}/getUpdates?offset=${_telegramState.offset}&timeout=30&allowed_updates=["message"]`,
            method: 'GET',
        }, (res) => {
            let chunks = '';
            res.on('data', c => chunks += c);
            res.on('end', () => {
                try {
                    const p = JSON.parse(chunks);
                    if (p.ok) resolve(p.result || []);
                    else reject(new Error(p.description || 'failed'));
                } catch { reject(new Error('Invalid JSON')); }
            });
        });
        req.on('error', reject);
        req.setTimeout(35000, () => { req.destroy(); resolve([]); });
        _telegramState.pollAbort = req;
        req.end();
    });
}

// ══════════════════════════════════════════
//  Local commands (handled without AI)
// ══════════════════════════════════════════

const LOCAL_COMMANDS = {
    '/start': (_cid, _a, name) => `Welcome to Onicode, ${name}!\n\nI'm your AI dev assistant with full tool access — files, terminal, git, browser, web search, code intelligence, and more.\n\nJust message me naturally. Type / for commands.\n\n/new — Fresh conversation\n/status — Model & connection info\n/help — All commands`,
    '/help': () => `Onicode Telegram Commands\n\n/new — Start fresh conversation\n/clear — Clear conversation\n/status — Connection & model info\n/model — Current model\n\nAll messages go through the full Onicode AI with 70+ tools. Just ask me anything.`,
    '/status': () => { const b = _telegramState.botInfo; return `Bot: @${b?.username || '?'}\nProvider: ${_providerConfig?.id || '?'}\nModel: ${_providerConfig?.selectedModel || '?'}\nChats: ${_telegramState.activeChats.size}`; },
    '/model': () => `${_providerConfig?.selectedModel || 'not configured'} (${_providerConfig?.id || '?'})`,
};

// ══════════════════════════════════════════
//  Message Handling — TRANSPORT ONLY
//  Messages go to ChatView for AI processing
// ══════════════════════════════════════════

async function _handleTelegramMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text || '';
    const userName = msg.from?.first_name || msg.from?.username || 'User';

    if (_telegramState.allowedChatIds.length > 0 && !_telegramState.allowedChatIds.includes(chatId)) return;

    logger.info('channels', `Telegram [${userName}]: ${text.slice(0, 100)}`);
    _telegramState.activeChats.add(chatId);

    // Local commands — handle without AI
    const cmdKey = text.split(' ')[0].toLowerCase();
    if (LOCAL_COMMANDS[cmdKey]) {
        const resp = LOCAL_COMMANDS[cmdKey](chatId, text.slice(cmdKey.length).trim(), userName);
        await sendTelegramMessage(_telegramState.token, chatId, resp);
        return;
    }

    // /new and /clear — tell ChatView to reset the conversation
    if (cmdKey === '/new' || cmdKey === '/clear') {
        emitToRenderer('channel-incoming', {
            channel: 'telegram',
            chatId,
            from: userName,
            text,
            action: 'new_session',
            timestamp: Date.now(),
        });
        await sendTelegramMessage(_telegramState.token, chatId, 'New conversation started.');
        return;
    }

    // Show typing indicator
    await sendTelegramTyping(_telegramState.token, chatId);

    // ── Route to ChatView ──
    // Emit message to renderer — ChatView will process it through the full AI pipeline
    // Then wait for the response via the 'channel-respond' IPC
    const responsePromise = new Promise((resolve) => {
        const timer = setTimeout(() => {
            _pendingResponses.delete(chatId);
            resolve(null); // Timeout — no response
        }, 180000); // 3 min timeout

        _pendingResponses.set(chatId, { resolve, timer });
    });

    emitToRenderer('channel-incoming', {
        channel: 'telegram',
        chatId,
        from: userName,
        text,
        action: 'message',
        timestamp: Date.now(),
    });

    logger.info('channels', `Routed to ChatView, waiting for response (chatId=${chatId})`);

    const response = await responsePromise;

    if (response) {
        logger.info('channels', `Got response for chatId=${chatId}: ${response.slice(0, 80)}...`);
        await sendTelegramMessage(_telegramState.token, chatId, response);
    } else {
        logger.warn('channels', `No response for chatId=${chatId} (timeout or error)`);
        await sendTelegramMessage(_telegramState.token, chatId, 'Sorry, I timed out processing your message. Please try again.').catch(() => {});
    }
}

/**
 * Called by renderer when AI finishes processing a channel message.
 * Resolves the pending promise so the Telegram delivery happens.
 */
function resolveChannelResponse(chatId, text) {
    const pending = _pendingResponses.get(chatId);
    if (pending) {
        clearTimeout(pending.timer);
        _pendingResponses.delete(chatId);
        pending.resolve(text);
        logger.info('channels', `Response resolved for chatId=${chatId}`);
    } else {
        logger.warn('channels', `No pending request for chatId=${chatId}`);
    }
}

// ══════════════════════════════════════════
//  Status
// ══════════════════════════════════════════

function getChannelStatus() {
    const config = loadConfig();
    return [{
        id: 'telegram',
        name: 'Telegram',
        connected: _telegramState.connected,
        botInfo: _telegramState.botInfo,
        allowedChatIds: _telegramState.allowedChatIds,
        activeChats: _telegramState.activeChats.size,
        savedConfig: !!config.telegram,
    }];
}

function getTelegramStats() {
    return {
        connected: _telegramState.connected,
        botInfo: _telegramState.botInfo,
        activeChats: _telegramState.activeChats.size,
        chatIds: Array.from(_telegramState.activeChats),
        polling: _telegramState.polling,
    };
}

// ══════════════════════════════════════════
//  IPC
// ══════════════════════════════════════════

function registerChannelsIPC(ipcMain, getWindow) {
    setMainWindow(getWindow);

    ipcMain.handle('channels-list', async () => ({ channels: getChannelStatus() }));
    ipcMain.handle('channel-telegram-validate', async (_e, token) => {
        try { return { success: true, botInfo: await telegramValidateToken(token) }; }
        catch (err) { return { success: false, error: err.message }; }
    });
    ipcMain.handle('channel-telegram-connect', async (_e, token, ids) => {
        try { return await telegramConnect(token, ids || []); }
        catch (err) { return { success: false, error: err.message }; }
    });
    ipcMain.handle('channel-telegram-disconnect', async () => telegramDisconnect());
    ipcMain.handle('channel-telegram-stats', async () => getTelegramStats());
    ipcMain.handle('channel-telegram-set-allowed', async (_e, ids) => {
        _telegramState.allowedChatIds = ids;
        const config = loadConfig();
        if (config.telegram) { config.telegram.allowedChatIds = ids; saveConfig(config); }
        return { success: true };
    });
    ipcMain.handle('channel-telegram-send', async (_e, chatId, text) => {
        if (!_telegramState.connected) return { success: false, error: 'Not connected' };
        try { await sendTelegramMessage(_telegramState.token, chatId, text); return { success: true }; }
        catch (err) { return { success: false, error: err.message }; }
    });

    // ── Response from ChatView after AI processing ──
    ipcMain.handle('channel-respond', async (_e, chatId, text) => {
        resolveChannelResponse(chatId, text);
        return { success: true };
    });
}

/**
 * Broadcast a message to ALL active Telegram chats.
 * Used by automation (reminders, schedules, heartbeat) to forward results.
 */
function _broadcastToTelegram(text) {
    if (!_telegramState.connected || !_telegramState.token) return;
    if (_telegramState.activeChats.size === 0) return;

    for (const chatId of _telegramState.activeChats) {
        sendTelegramMessage(_telegramState.token, chatId, text).catch(err => {
            logger.warn('channels', `Broadcast to ${chatId} failed: ${err.message}`);
        });
    }
    logger.info('channels', `Broadcast to ${_telegramState.activeChats.size} chat(s): ${text.slice(0, 80)}`);
}

module.exports = {
    registerChannelsIPC,
    telegramAutoConnect,
    telegramDisconnect,
    stopTelegramPolling,
    setProviderConfig,
    getChannelStatus,
    _broadcastToTelegram,
};
