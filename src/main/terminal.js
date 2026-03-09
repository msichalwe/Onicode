/**
 * Terminal Manager — spawns and manages shell sessions
 * AI and user can both execute commands through these sessions
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

/** @type {Map<string, { proc: import('child_process').ChildProcess, cwd: string, history: string[] }>} */
const sessions = new Map();

let getMainWindow = () => null;

function registerTerminalIPC(ipcMain, getWindow) {
    getMainWindow = getWindow;

    // Create a new terminal session
    ipcMain.handle('terminal-create', async (_event, cwd) => {
        const sessionId = 'term-' + Date.now().toString(36);
        const shellPath = process.platform === 'win32' ? 'cmd.exe' : '/bin/zsh';
        const shellArgs = process.platform === 'win32' ? [] : ['-l'];
        const targetCwd = cwd || os.homedir();

        try {
            const proc = spawn(shellPath, shellArgs, {
                cwd: targetCwd,
                env: { ...process.env, TERM: 'dumb', LANG: 'en_US.UTF-8' },
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            const session = { proc, cwd: targetCwd, history: [] };
            sessions.set(sessionId, session);

            proc.stdout.on('data', (data) => {
                const text = data.toString();
                const win = getMainWindow();
                if (win) win.webContents.send('terminal-output', { sessionId, data: text, stream: 'stdout' });
            });

            proc.stderr.on('data', (data) => {
                const text = data.toString();
                const win = getMainWindow();
                if (win) win.webContents.send('terminal-output', { sessionId, data: text, stream: 'stderr' });
            });

            proc.on('exit', (code) => {
                sessions.delete(sessionId);
                const win = getMainWindow();
                if (win) win.webContents.send('terminal-exit', { sessionId, code });
            });

            proc.on('error', (err) => {
                sessions.delete(sessionId);
                const win = getMainWindow();
                if (win) win.webContents.send('terminal-exit', { sessionId, code: -1, error: err.message });
            });

            return { success: true, sessionId };
        } catch (err) {
            return { error: err.message };
        }
    });

    // Write to terminal stdin
    ipcMain.handle('terminal-write', async (_event, sessionId, data) => {
        const session = sessions.get(sessionId);
        if (!session) return { error: 'Session not found' };
        try {
            session.proc.stdin.write(data);
            session.history.push(data.trim());
            return { success: true };
        } catch (err) {
            return { error: err.message };
        }
    });

    // Kill terminal session
    ipcMain.handle('terminal-kill', async (_event, sessionId) => {
        const session = sessions.get(sessionId);
        if (!session) return { success: true };
        try {
            session.proc.kill('SIGTERM');
            sessions.delete(sessionId);
        } catch {}
        return { success: true };
    });

    // Get terminal session info
    ipcMain.handle('terminal-status', async (_event, sessionId) => {
        const session = sessions.get(sessionId);
        if (!session) return { exists: false };
        return {
            exists: true,
            cwd: session.cwd,
            historyCount: session.history.length,
            lastCommands: session.history.slice(-10),
        };
    });

    // Execute a command and return output (for AI use — runs to completion)
    ipcMain.handle('terminal-exec', async (_event, command, cwd) => {
        const targetCwd = cwd || os.homedir();
        return new Promise((resolve) => {
            const proc = spawn('/bin/zsh', ['-c', command], {
                cwd: targetCwd,
                env: { ...process.env, TERM: 'dumb' },
                timeout: 30000,
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (d) => { stdout += d.toString(); });
            proc.stderr.on('data', (d) => { stderr += d.toString(); });

            proc.on('close', (code) => {
                resolve({ success: code === 0, code, stdout: stdout.slice(0, 10000), stderr: stderr.slice(0, 5000) });
            });

            proc.on('error', (err) => {
                resolve({ success: false, code: -1, stdout: '', stderr: err.message });
            });
        });
    });
}

function killAllSessions() {
    for (const [id, session] of sessions) {
        try { session.proc.kill('SIGTERM'); } catch {}
        sessions.delete(id);
    }
}

module.exports = { registerTerminalIPC, killAllSessions };
