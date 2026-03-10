/**
 * Git Integration — deep git operations via IPC
 */

const { execSync, exec } = require('child_process');
const path = require('path');

function runGit(args, cwd, timeout = 10000) {
    try {
        const result = execSync(`git ${args}`, {
            cwd,
            encoding: 'utf-8',
            timeout,
            maxBuffer: 1024 * 1024,
            stdio: ['pipe', 'pipe', 'pipe'], // Suppress stderr from polluting Electron console
        });
        return { success: true, output: result.trim() };
    } catch (err) {
        return { success: false, error: err.stderr?.trim() || err.message };
    }
}

function registerGitIPC(ipcMain) {
    // Check if path is a git repo
    ipcMain.handle('git-is-repo', async (_event, repoPath) => {
        const result = runGit('rev-parse --is-inside-work-tree', repoPath);
        return { isRepo: result.success && result.output === 'true' };
    });

    // Initialize a git repo (use main as default branch)
    ipcMain.handle('git-init', async (_event, repoPath) => {
        return runGit('init -b main', repoPath);
    });

    // Git status (parsed)
    ipcMain.handle('git-status', async (_event, repoPath) => {
        const branchResult = runGit('branch --show-current', repoPath);
        const statusResult = runGit('status --porcelain -u', repoPath);
        const aheadBehind = runGit('rev-list --left-right --count HEAD...@{upstream}', repoPath);

        if (!statusResult.success) return { error: statusResult.error };

        const branch = branchResult.success ? branchResult.output : 'unknown';
        const files = statusResult.output
            .split('\n')
            .filter(Boolean)
            .map((line) => {
                const status = line.substring(0, 2);
                const filePath = line.substring(3);
                let state = 'modified';
                if (status.includes('?')) state = 'untracked';
                else if (status.includes('A')) state = 'added';
                else if (status.includes('D')) state = 'deleted';
                else if (status.includes('R')) state = 'renamed';
                else if (status.includes('C')) state = 'copied';
                else if (status.includes('U')) state = 'conflicted';
                const staged = status[0] !== ' ' && status[0] !== '?';
                return { path: filePath, status: state, staged };
            });

        let ahead = 0, behind = 0;
        if (aheadBehind.success) {
            const parts = aheadBehind.output.split('\t');
            ahead = parseInt(parts[0]) || 0;
            behind = parseInt(parts[1]) || 0;
        }

        return {
            success: true,
            branch,
            files,
            ahead,
            behind,
            clean: files.length === 0,
        };
    });

    // List branches
    ipcMain.handle('git-branches', async (_event, repoPath) => {
        const result = runGit('branch -a --format="%(refname:short)|%(objectname:short)|%(upstream:short)|%(HEAD)"', repoPath);
        if (!result.success) return { error: result.error };

        const branches = result.output
            .split('\n')
            .filter(Boolean)
            .map((line) => {
                const [name, hash, upstream, head] = line.replace(/"/g, '').split('|');
                return {
                    name: name.trim(),
                    hash: hash?.trim() || '',
                    upstream: upstream?.trim() || null,
                    current: head?.trim() === '*',
                    remote: name.startsWith('origin/') || name.startsWith('remotes/'),
                };
            });

        return { success: true, branches };
    });

    // Git log (recent commits)
    ipcMain.handle('git-log', async (_event, repoPath, count = 50) => {
        const format = '%H|%h|%an|%ae|%at|%s';
        const result = runGit(`log -${count} --format="${format}"`, repoPath);
        if (!result.success) return { error: result.error };

        const commits = result.output
            .split('\n')
            .filter(Boolean)
            .map((line) => {
                const [hash, shortHash, author, email, timestamp, ...subjectParts] = line.split('|');
                return {
                    hash,
                    shortHash,
                    author,
                    email,
                    timestamp: parseInt(timestamp) * 1000,
                    message: subjectParts.join('|'),
                };
            });

        return { success: true, commits };
    });

    // Git diff
    ipcMain.handle('git-diff', async (_event, repoPath, filePath, staged = false) => {
        const args = staged ? 'diff --cached' : 'diff';
        const fullArgs = filePath ? `${args} -- "${filePath}"` : args;
        const result = runGit(fullArgs, repoPath);
        return result;
    });

    // Stage files
    ipcMain.handle('git-stage', async (_event, repoPath, files) => {
        const fileArgs = Array.isArray(files) ? files.map(f => `"${f}"`).join(' ') : `"${files}"`;
        return runGit(`add ${fileArgs}`, repoPath);
    });

    // Unstage files
    ipcMain.handle('git-unstage', async (_event, repoPath, files) => {
        const fileArgs = Array.isArray(files) ? files.map(f => `"${f}"`).join(' ') : `"${files}"`;
        return runGit(`restore --staged ${fileArgs}`, repoPath);
    });

    // Commit
    ipcMain.handle('git-commit', async (_event, repoPath, message) => {
        if (!message?.trim()) return { error: 'Commit message is required' };
        // Escape double quotes in message
        const escaped = message.replace(/"/g, '\\"');
        return runGit(`commit -m "${escaped}"`, repoPath);
    });

    // Checkout branch
    ipcMain.handle('git-checkout', async (_event, repoPath, branch, create = false) => {
        const flag = create ? '-b' : '';
        return runGit(`checkout ${flag} "${branch}"`, repoPath);
    });

    // Stash
    ipcMain.handle('git-stash', async (_event, repoPath, action = 'push', message) => {
        if (action === 'push') {
            const msg = message ? `-m "${message}"` : '';
            return runGit(`stash push ${msg}`, repoPath);
        }
        if (action === 'pop') return runGit('stash pop', repoPath);
        if (action === 'list') {
            const result = runGit('stash list', repoPath);
            if (!result.success) return result;
            return {
                success: true,
                stashes: result.output.split('\n').filter(Boolean),
            };
        }
        return { error: `Unknown stash action: ${action}` };
    });

    // Remote info
    ipcMain.handle('git-remotes', async (_event, repoPath) => {
        const result = runGit('remote -v', repoPath);
        if (!result.success) return { error: result.error };

        const remotes = {};
        result.output.split('\n').filter(Boolean).forEach((line) => {
            const [name, url, type] = line.split(/\s+/);
            if (!remotes[name]) remotes[name] = {};
            remotes[name][type?.replace(/[()]/g, '')] = url;
        });

        return {
            success: true,
            remotes: Object.entries(remotes).map(([name, urls]) => ({
                name,
                fetchUrl: urls.fetch || '',
                pushUrl: urls.push || '',
            })),
        };
    });

    // Pull
    ipcMain.handle('git-pull', async (_event, repoPath) => {
        return runGit('pull', repoPath, 30000);
    });

    // Push
    ipcMain.handle('git-push', async (_event, repoPath) => {
        return runGit('push', repoPath, 30000);
    });

    // Show file at specific commit
    ipcMain.handle('git-show', async (_event, repoPath, ref, filePath) => {
        return runGit(`show ${ref}:"${filePath}"`, repoPath);
    });
}

module.exports = { registerGitIPC };
