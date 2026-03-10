/**
 * MCP (Model Context Protocol) Client Module
 *
 * Spawns stdio-based MCP servers, speaks JSON-RPC 2.0 over stdin/stdout,
 * discovers tools, and exposes them as standard AI function-calling tools.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { logger } = require('./logger');

// ══════════════════════════════════════════
//  Config
// ══════════════════════════════════════════

const CONFIG_DIR = path.join(os.homedir(), '.onicode');
const CONFIG_PATH = path.join(CONFIG_DIR, 'mcp.json');

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        }
    } catch (err) {
        logger.warn('mcp', `Failed to read config: ${err.message}`);
    }
    return { mcpServers: {} };
}

function saveConfig(config) {
    try {
        if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    } catch (err) {
        logger.error('mcp', `Failed to save config: ${err.message}`);
    }
}

// ══════════════════════════════════════════
//  Server State
// ══════════════════════════════════════════

/**
 * In-memory map of connected/connecting MCP servers.
 * Key: server name
 * Value: { process, status, tools, pendingRequests, nextId, buffer, error }
 */
const _servers = new Map();

/** Getter function for mainWindow — set via registerMCPIPC(ipcMain, getWindow) */
let _getWindow = () => null;

function sendToRenderer(channel, data) {
    const win = _getWindow();
    win?.webContents?.send(channel, data);
}

// ══════════════════════════════════════════
//  JSON-RPC 2.0 Transport (stdio)
// ══════════════════════════════════════════

function _sendRequest(server, method, params) {
    return new Promise((resolve, reject) => {
        if (!server.process || server.process.killed) {
            return reject(new Error('Server process not running'));
        }

        const id = server.nextId++;
        const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });

        const timeout = setTimeout(() => {
            server.pendingRequests.delete(id);
            reject(new Error(`MCP request timed out: ${method} (30s)`));
        }, 30000);

        server.pendingRequests.set(id, { resolve, reject, timeout });

        try {
            server.process.stdin.write(message + '\n');
        } catch (err) {
            clearTimeout(timeout);
            server.pendingRequests.delete(id);
            reject(new Error(`Failed to write to server stdin: ${err.message}`));
        }
    });
}

function _sendNotification(server, method, params) {
    if (!server.process || server.process.killed) return;
    try {
        const message = JSON.stringify({ jsonrpc: '2.0', method, params });
        server.process.stdin.write(message + '\n');
    } catch (err) {
        logger.warn('mcp', `Failed to send notification: ${err.message}`);
    }
}

function _handleStdout(serverName, chunk) {
    const server = _servers.get(serverName);
    if (!server) return;

    server.buffer += chunk.toString();

    // Process complete lines (newline-delimited JSON)
    const lines = server.buffer.split('\n');
    server.buffer = lines.pop() || ''; // Keep incomplete last line in buffer

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
            const msg = JSON.parse(trimmed);

            // Response to a request we sent
            if (msg.id !== undefined && msg.id !== null && server.pendingRequests.has(msg.id)) {
                const pending = server.pendingRequests.get(msg.id);
                server.pendingRequests.delete(msg.id);
                clearTimeout(pending.timeout);

                if (msg.error) {
                    pending.reject(new Error(`MCP error: ${msg.error.message || JSON.stringify(msg.error)}`));
                } else {
                    pending.resolve(msg.result);
                }
            }
            // Server-initiated notification
            else if (!msg.id && msg.method) {
                logger.info('mcp', `[${serverName}] notification: ${msg.method}`);
            }
        } catch (err) {
            // Not JSON — could be debug output from server startup, ignore
        }
    }
}

// ══════════════════════════════════════════
//  Server Lifecycle
// ══════════════════════════════════════════

async function connectServer(name) {
    const config = loadConfig();
    const serverDef = config.mcpServers[name];
    if (!serverDef) throw new Error(`MCP server "${name}" not found in config`);

    // If already connected or connecting, skip
    const existing = _servers.get(name);
    if (existing && (existing.status === 'connected' || existing.status === 'connecting')) {
        return { success: true, status: existing.status, toolCount: existing.tools.length };
    }

    // Clean up any dead previous connection
    if (existing) _cleanupServer(name);

    const server = {
        process: null,
        status: 'connecting',
        tools: [],
        pendingRequests: new Map(),
        nextId: 1,
        buffer: '',
        error: null,
    };
    _servers.set(name, server);
    _emitStatus(name);

    try {
        const command = serverDef.command;
        const args = serverDef.args || [];
        const env = { ...process.env, ...(serverDef.env || {}) };

        logger.info('mcp', `Connecting to "${name}": ${command} ${args.join(' ')}`);

        const child = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env,
            shell: process.platform === 'win32',
        });

        server.process = child;

        child.stdout.on('data', (chunk) => _handleStdout(name, chunk));

        child.stderr.on('data', (data) => {
            const text = data.toString().trim();
            if (text) logger.warn('mcp', `[${name}] stderr: ${text}`);
        });

        child.on('close', (code) => {
            const srv = _servers.get(name);
            if (srv && srv.status !== 'disconnected') {
                srv.status = 'error';
                srv.error = `Process exited with code ${code}`;
                for (const [, pending] of srv.pendingRequests) {
                    clearTimeout(pending.timeout);
                    pending.reject(new Error(`Server process exited (code ${code})`));
                }
                srv.pendingRequests.clear();
                _emitStatus(name);
                logger.warn('mcp', `[${name}] process exited with code ${code}`);
            }
        });

        child.on('error', (err) => {
            const srv = _servers.get(name);
            if (srv) {
                srv.status = 'error';
                srv.error = err.message;
                _emitStatus(name);
            }
            logger.error('mcp', `[${name}] spawn error: ${err.message}`);
        });

        // ── MCP Initialization Handshake ──

        const initResult = await _sendRequest(server, 'initialize', {
            protocolVersion: '2024-11-05',
            capabilities: { roots: { listChanged: true } },
            clientInfo: { name: 'Onicode', version: '1.0.0' },
        });
        logger.info('mcp', `[${name}] initialized: protocol ${initResult?.protocolVersion || 'unknown'}`);

        _sendNotification(server, 'notifications/initialized');

        const toolsResult = await _sendRequest(server, 'tools/list', {});
        server.tools = (toolsResult?.tools || []).map(t => ({
            name: t.name,
            description: t.description || t.name,
            inputSchema: t.inputSchema || { type: 'object', properties: {} },
        }));

        server.status = 'connected';
        server.error = null;
        _emitStatus(name);

        logger.info('mcp', `[${name}] connected — ${server.tools.length} tools available`);
        return { success: true, status: 'connected', toolCount: server.tools.length };

    } catch (err) {
        server.status = 'error';
        server.error = err.message;
        _emitStatus(name);
        logger.error('mcp', `[${name}] connection failed: ${err.message}`);

        if (server.process && !server.process.killed) {
            try { server.process.kill(); } catch { /* ignore */ }
        }

        return { success: false, error: err.message };
    }
}

function disconnectServer(name) {
    _cleanupServer(name);
    _emitStatus(name);
    logger.info('mcp', `[${name}] disconnected`);
    return { success: true };
}

function disconnectAll() {
    for (const name of _servers.keys()) {
        _cleanupServer(name);
    }
    logger.info('mcp', 'All MCP servers disconnected');
}

async function connectAllEnabled() {
    const config = loadConfig();
    const names = Object.keys(config.mcpServers).filter(n => config.mcpServers[n].enabled !== false);
    if (names.length === 0) return;

    logger.info('mcp', `Auto-connecting ${names.length} MCP server(s): ${names.join(', ')}`);

    const results = await Promise.allSettled(names.map(n => connectServer(n)));
    for (let i = 0; i < names.length; i++) {
        if (results[i].status === 'rejected') {
            logger.warn('mcp', `[${names[i]}] auto-connect failed: ${results[i].reason?.message}`);
        }
    }
}

function _cleanupServer(name) {
    const server = _servers.get(name);
    if (!server) return;

    for (const [, pending] of server.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Server disconnected'));
    }
    server.pendingRequests.clear();

    if (server.process && !server.process.killed) {
        try { server.process.kill(); } catch { /* ignore */ }
    }

    server.status = 'disconnected';
    server.tools = [];
    server.error = null;
}

function _emitStatus(name) {
    const server = _servers.get(name);
    sendToRenderer('mcp-server-status', {
        name,
        status: server?.status || 'disconnected',
        toolCount: server?.tools?.length || 0,
        error: server?.error || null,
    });
}

// ══════════════════════════════════════════
//  Tool Definitions & Execution
// ══════════════════════════════════════════

function _sanitizeName(str) {
    return str.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

/**
 * Get OpenAI function-calling format tool definitions for all connected MCP servers.
 */
function getMCPToolDefinitions() {
    const defs = [];
    for (const [serverName, server] of _servers) {
        if (server.status !== 'connected') continue;
        for (const tool of server.tools) {
            defs.push({
                type: 'function',
                function: {
                    name: `mcp_${_sanitizeName(serverName)}__${_sanitizeName(tool.name)}`,
                    description: `[MCP: ${serverName}] ${tool.description}`,
                    parameters: tool.inputSchema,
                },
            });
        }
    }
    return defs;
}

/**
 * Execute an MCP tool call. Parses the prefixed name to find the server
 * and original tool, then calls via JSON-RPC.
 */
async function executeMCPTool(fullToolName, args) {
    const withoutPrefix = fullToolName.replace(/^mcp_/, '');
    const separatorIdx = withoutPrefix.indexOf('__');
    if (separatorIdx === -1) {
        return { success: false, error: `Invalid MCP tool name: ${fullToolName}` };
    }

    const sanitizedServer = withoutPrefix.substring(0, separatorIdx);
    const sanitizedTool = withoutPrefix.substring(separatorIdx + 2);

    // Find server by sanitized name match
    let targetServer = null;
    let targetName = null;
    for (const [name, server] of _servers) {
        if (_sanitizeName(name) === sanitizedServer) {
            targetServer = server;
            targetName = name;
            break;
        }
    }

    if (!targetServer || targetServer.status !== 'connected') {
        return { success: false, error: `MCP server not connected: ${sanitizedServer}` };
    }

    const originalTool = targetServer.tools.find(t => _sanitizeName(t.name) === sanitizedTool);
    if (!originalTool) {
        return { success: false, error: `Tool "${sanitizedTool}" not found on server "${targetName}"` };
    }

    try {
        logger.info('mcp', `[${targetName}] calling: ${originalTool.name}`);
        const result = await _sendRequest(targetServer, 'tools/call', {
            name: originalTool.name,
            arguments: args || {},
        });

        // MCP returns { content: [{ type: "text", text: "..." }, ...], isError?: bool }
        if (result && Array.isArray(result.content)) {
            const textParts = result.content
                .filter(c => c.type === 'text')
                .map(c => c.text);
            const imageParts = result.content
                .filter(c => c.type === 'image')
                .map(c => ({ type: 'image', mimeType: c.mimeType, data: c.data }));

            return {
                success: !result.isError,
                text: textParts.join('\n'),
                images: imageParts.length > 0 ? imageParts : undefined,
                isError: result.isError || false,
            };
        }

        return { success: true, result };
    } catch (err) {
        logger.error('mcp', `[${targetName}] tool call failed: ${err.message}`);
        return { success: false, error: err.message };
    }
}

// ══════════════════════════════════════════
//  Server Management (Add / Remove)
// ══════════════════════════════════════════

function addServer(name, serverDef) {
    const config = loadConfig();
    config.mcpServers[name] = {
        command: serverDef.command,
        args: serverDef.args || [],
        env: serverDef.env || {},
        enabled: serverDef.enabled !== false,
    };
    saveConfig(config);
    logger.info('mcp', `Added server "${name}": ${serverDef.command} ${(serverDef.args || []).join(' ')}`);
    return { success: true };
}

function removeServer(name) {
    _cleanupServer(name);
    _servers.delete(name);

    const config = loadConfig();
    delete config.mcpServers[name];
    saveConfig(config);
    logger.info('mcp', `Removed server "${name}"`);
    return { success: true };
}

function listServers() {
    const config = loadConfig();
    const servers = [];

    for (const [name, def] of Object.entries(config.mcpServers)) {
        const live = _servers.get(name);
        servers.push({
            name,
            config: def,
            status: live?.status || 'disconnected',
            toolCount: live?.tools?.length || 0,
            tools: live?.tools?.map(t => ({ name: t.name, description: t.description })) || [],
            error: live?.error || null,
        });
    }

    return servers;
}

function getMCPToolsForPrompt() {
    const tools = [];
    for (const [serverName, server] of _servers) {
        if (server.status !== 'connected') continue;
        for (const tool of server.tools) {
            tools.push({
                serverName,
                toolName: tool.name,
                fullName: `mcp_${_sanitizeName(serverName)}__${_sanitizeName(tool.name)}`,
                description: tool.description,
            });
        }
    }
    return tools;
}

// ══════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════

function registerMCPIPC(ipcMain, getWindow) {
    _getWindow = getWindow;

    ipcMain.handle('mcp-list-servers', async () => {
        return { servers: listServers() };
    });

    ipcMain.handle('mcp-connect-server', async (_event, name) => {
        try {
            return await connectServer(name);
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('mcp-disconnect-server', async (_event, name) => {
        return disconnectServer(name);
    });

    ipcMain.handle('mcp-add-server', async (_event, name, serverDef) => {
        if (!name || !serverDef?.command) {
            return { success: false, error: 'Name and command are required' };
        }
        const result = addServer(name, serverDef);
        if (serverDef.enabled !== false) {
            connectServer(name).catch(() => {});
        }
        return result;
    });

    ipcMain.handle('mcp-remove-server', async (_event, name) => {
        return removeServer(name);
    });

    ipcMain.handle('mcp-get-tools-for-prompt', async () => {
        return { tools: getMCPToolsForPrompt() };
    });
}

module.exports = {
    registerMCPIPC,
    getMCPToolDefinitions,
    executeMCPTool,
    connectAllEnabled,
    disconnectAll,
    listServers,
    getMCPToolsForPrompt,
};
