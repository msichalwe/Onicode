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

    // Merge branch
    ipcMain.handle('git-merge', async (_event, repoPath, branch, noFf = false) => {
        const flag = noFf ? '--no-ff' : '';
        return runGit(`merge ${flag} "${branch}"`, repoPath, 30000);
    });

    // Reset (soft, mixed, hard)
    ipcMain.handle('git-reset', async (_event, repoPath, mode = 'mixed', ref = 'HEAD') => {
        if (!['soft', 'mixed', 'hard'].includes(mode)) {
            return { error: `Invalid reset mode: ${mode}. Use soft, mixed, or hard.` };
        }
        return runGit(`reset --${mode} ${ref}`, repoPath);
    });

    // Tag operations
    ipcMain.handle('git-tag', async (_event, repoPath, action = 'list', tagName, message) => {
        if (action === 'list') {
            const result = runGit('tag -l --sort=-creatordate', repoPath);
            if (!result.success) return result;
            return { success: true, tags: result.output.split('\n').filter(Boolean) };
        }
        if (action === 'create') {
            if (!tagName) return { error: 'Tag name is required' };
            const msg = message ? `-a "${tagName}" -m "${message.replace(/"/g, '\\"')}"` : `"${tagName}"`;
            return runGit(`tag ${msg}`, repoPath);
        }
        if (action === 'delete') {
            if (!tagName) return { error: 'Tag name is required' };
            return runGit(`tag -d "${tagName}"`, repoPath);
        }
        return { error: `Unknown tag action: ${action}` };
    });

    // Git log with graph data (for visualization)
    ipcMain.handle('git-log-graph', async (_event, repoPath, count = 80) => {
        const format = '%H|%h|%an|%ae|%at|%s|%P|%D';
        const result = runGit(`log --all -${count} --format="${format}"`, repoPath);
        if (!result.success) return { error: result.error };

        const commits = result.output
            .split('\n')
            .filter(Boolean)
            .map((line) => {
                const parts = line.split('|');
                const hash = parts[0];
                const shortHash = parts[1];
                const author = parts[2];
                const email = parts[3];
                const timestamp = parseInt(parts[4]) * 1000;
                const message = parts[5];
                const parents = (parts[6] || '').split(' ').filter(Boolean);
                const refs = (parts[7] || '').split(',').map(r => r.trim()).filter(Boolean);
                return { hash, shortHash, author, email, timestamp, message, parents, refs };
            });

        return { success: true, commits };
    });

    // Abort merge
    ipcMain.handle('git-merge-abort', async (_event, repoPath) => {
        return runGit('merge --abort', repoPath);
    });

    // Stash drop specific entry
    ipcMain.handle('git-stash-drop', async (_event, repoPath, index = 0) => {
        return runGit(`stash drop stash@{${index}}`, repoPath);
    });

    // Add remote
    ipcMain.handle('git-remote-add', async (_event, repoPath, name, url) => {
        if (!name || !url) return { error: 'Remote name and URL are required' };
        return runGit(`remote add "${name}" "${url}"`, repoPath);
    });

    // Remove remote
    ipcMain.handle('git-remote-remove', async (_event, repoPath, name) => {
        if (!name) return { error: 'Remote name is required' };
        return runGit(`remote remove "${name}"`, repoPath);
    });
    // ══════════════════════════════════════════
    //  GitHub API Operations (requires connected GitHub account)
    // ══════════════════════════════════════════

    // Clone a repository
    ipcMain.handle('git-clone', async (_event, repoUrl, targetPath) => {
        if (!repoUrl || !targetPath) return { error: 'Repository URL and target path are required' };
        const token = getGithubToken();
        // Inject token into HTTPS URLs for private repos
        let cloneUrl = repoUrl;
        if (token && repoUrl.startsWith('https://github.com/')) {
            cloneUrl = repoUrl.replace('https://github.com/', `https://${token}@github.com/`);
        }
        try {
            execSync(`git clone "${cloneUrl}" "${targetPath}"`, {
                encoding: 'utf-8',
                timeout: 120000,
                maxBuffer: 5 * 1024 * 1024,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            return { success: true };
        } catch (err) {
            return { success: false, error: err.stderr?.trim() || err.message };
        }
    });

    // Authenticated push (uses GitHub token in remote URL)
    ipcMain.handle('git-push-auth', async (_event, repoPath, remote = 'origin', branch) => {
        const token = getGithubToken();
        if (!token) return { error: 'GitHub account not connected. Connect in Settings > Connectors.' };
        // Get current remote URL
        const remoteResult = runGit(`remote get-url ${remote}`, repoPath);
        if (!remoteResult.success) return { error: `No remote '${remote}' found. Add one first.` };
        const originalUrl = remoteResult.output;
        // Inject token for auth
        let authUrl = originalUrl;
        if (originalUrl.startsWith('https://github.com/')) {
            authUrl = originalUrl.replace('https://github.com/', `https://${token}@github.com/`);
        } else if (originalUrl.match(/^https:\/\/[^@]+@github\.com\//)) {
            authUrl = originalUrl.replace(/https:\/\/[^@]+@github\.com\//, `https://${token}@github.com/`);
        }
        // Temporarily set auth URL, push, restore
        try {
            runGit(`remote set-url ${remote} "${authUrl}"`, repoPath);
            const branchArg = branch || '';
            const result = runGit(`push -u ${remote} ${branchArg}`.trim(), repoPath, 60000);
            runGit(`remote set-url ${remote} "${originalUrl}"`, repoPath);
            return result;
        } catch (err) {
            runGit(`remote set-url ${remote} "${originalUrl}"`, repoPath);
            return { success: false, error: err.message };
        }
    });

    // Authenticated pull (uses GitHub token)
    ipcMain.handle('git-pull-auth', async (_event, repoPath, remote = 'origin', branch) => {
        const token = getGithubToken();
        if (!token) return { error: 'GitHub account not connected.' };
        const remoteResult = runGit(`remote get-url ${remote}`, repoPath);
        if (!remoteResult.success) return { error: `No remote '${remote}' found.` };
        const originalUrl = remoteResult.output;
        let authUrl = originalUrl;
        if (originalUrl.startsWith('https://github.com/')) {
            authUrl = originalUrl.replace('https://github.com/', `https://${token}@github.com/`);
        }
        try {
            runGit(`remote set-url ${remote} "${authUrl}"`, repoPath);
            const branchArg = branch ? `${remote} ${branch}` : '';
            const result = runGit(`pull ${branchArg}`.trim(), repoPath, 60000);
            runGit(`remote set-url ${remote} "${originalUrl}"`, repoPath);
            return result;
        } catch (err) {
            runGit(`remote set-url ${remote} "${originalUrl}"`, repoPath);
            return { success: false, error: err.message };
        }
    });

    // List user's GitHub repos
    ipcMain.handle('git-github-repos', async (_event, page = 1, perPage = 30, sort = 'updated') => {
        const token = getGithubToken();
        if (!token) return { error: 'GitHub account not connected.' };
        try {
            const res = await githubAPI(`/user/repos?sort=${sort}&per_page=${perPage}&page=${page}&type=all`, token);
            const repos = res.map(r => ({
                id: r.id, name: r.name, fullName: r.full_name,
                description: r.description, private: r.private,
                htmlUrl: r.html_url, cloneUrl: r.clone_url,
                language: r.language, stars: r.stargazers_count,
                forks: r.forks_count, updatedAt: r.updated_at,
                defaultBranch: r.default_branch,
            }));
            return { success: true, repos };
        } catch (err) {
            return { error: err.message };
        }
    });

    // Create a pull request
    ipcMain.handle('git-github-create-pr', async (_event, repoPath, title, body, head, base) => {
        const token = getGithubToken();
        if (!token) return { error: 'GitHub account not connected.' };
        const owner_repo = await getOwnerRepo(repoPath);
        if (!owner_repo) return { error: 'Cannot determine GitHub owner/repo from remotes.' };
        try {
            const res = await githubAPI(`/repos/${owner_repo}/pulls`, token, 'POST', { title, body: body || '', head, base: base || 'main' });
            return { success: true, pr: { number: res.number, url: res.html_url, title: res.title, state: res.state } };
        } catch (err) {
            return { error: err.message };
        }
    });

    // List pull requests
    ipcMain.handle('git-github-list-prs', async (_event, repoPath, state = 'open') => {
        const token = getGithubToken();
        if (!token) return { error: 'GitHub account not connected.' };
        const owner_repo = await getOwnerRepo(repoPath);
        if (!owner_repo) return { error: 'Cannot determine GitHub owner/repo from remotes.' };
        try {
            const res = await githubAPI(`/repos/${owner_repo}/pulls?state=${state}&per_page=30`, token);
            const prs = res.map(pr => ({
                number: pr.number, title: pr.title, state: pr.state,
                url: pr.html_url, author: pr.user?.login,
                head: pr.head?.ref, base: pr.base?.ref,
                createdAt: pr.created_at, updatedAt: pr.updated_at,
                draft: pr.draft, mergeable: pr.mergeable,
                additions: pr.additions, deletions: pr.deletions,
                labels: (pr.labels || []).map(l => l.name),
            }));
            return { success: true, prs };
        } catch (err) {
            return { error: err.message };
        }
    });

    // Get PR details (comments, reviews, checks)
    ipcMain.handle('git-github-pr-detail', async (_event, repoPath, prNumber) => {
        const token = getGithubToken();
        if (!token) return { error: 'GitHub account not connected.' };
        const owner_repo = await getOwnerRepo(repoPath);
        if (!owner_repo) return { error: 'Cannot determine GitHub owner/repo from remotes.' };
        try {
            const [pr, comments, reviews] = await Promise.all([
                githubAPI(`/repos/${owner_repo}/pulls/${prNumber}`, token),
                githubAPI(`/repos/${owner_repo}/issues/${prNumber}/comments`, token),
                githubAPI(`/repos/${owner_repo}/pulls/${prNumber}/reviews`, token),
            ]);
            return {
                success: true,
                pr: {
                    number: pr.number, title: pr.title, body: pr.body,
                    state: pr.state, url: pr.html_url, author: pr.user?.login,
                    head: pr.head?.ref, base: pr.base?.ref,
                    mergeable: pr.mergeable, merged: pr.merged,
                    additions: pr.additions, deletions: pr.deletions,
                    changedFiles: pr.changed_files,
                    createdAt: pr.created_at, updatedAt: pr.updated_at,
                },
                comments: comments.map(c => ({
                    id: c.id, body: c.body, author: c.user?.login,
                    createdAt: c.created_at,
                })),
                reviews: reviews.map(r => ({
                    id: r.id, state: r.state, body: r.body,
                    author: r.user?.login, submittedAt: r.submitted_at,
                })),
            };
        } catch (err) {
            return { error: err.message };
        }
    });

    // Merge a PR
    ipcMain.handle('git-github-merge-pr', async (_event, repoPath, prNumber, mergeMethod = 'merge') => {
        const token = getGithubToken();
        if (!token) return { error: 'GitHub account not connected.' };
        const owner_repo = await getOwnerRepo(repoPath);
        if (!owner_repo) return { error: 'Cannot determine GitHub owner/repo.' };
        try {
            const res = await githubAPI(`/repos/${owner_repo}/pulls/${prNumber}/merge`, token, 'PUT', { merge_method: mergeMethod });
            return { success: true, sha: res.sha, message: res.message };
        } catch (err) {
            return { error: err.message };
        }
    });

    // Create a GitHub repo
    ipcMain.handle('git-github-create-repo', async (_event, name, description, isPrivate = true) => {
        const token = getGithubToken();
        if (!token) return { error: 'GitHub account not connected.' };
        try {
            const res = await githubAPI('/user/repos', token, 'POST', {
                name, description: description || '', private: isPrivate, auto_init: false,
            });
            return { success: true, repo: { name: res.name, fullName: res.full_name, cloneUrl: res.clone_url, htmlUrl: res.html_url } };
        } catch (err) {
            return { error: err.message };
        }
    });

    // Get GitHub connection status
    ipcMain.handle('git-github-status', async () => {
        const token = getGithubToken();
        if (!token) return { connected: false };
        try {
            const user = await githubAPI('/user', token);
            return { connected: true, username: user.login, avatarUrl: user.avatar_url, name: user.name };
        } catch {
            return { connected: false };
        }
    });
}

// ── GitHub API helper ──

function githubAPI(endpoint, token, method = 'GET', body = null) {
    const https = require('https');
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: endpoint,
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'Onicode',
                'X-GitHub-Api-Version': '2022-11-28',
            },
        };
        if (body) {
            options.headers['Content-Type'] = 'application/json';
        }
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (res.statusCode >= 400) {
                        reject(new Error(parsed.message || `GitHub API ${res.statusCode}`));
                    } else {
                        resolve(parsed);
                    }
                } catch { resolve(data); }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

// ── Get GitHub token from connectors ──

function getGithubToken() {
    const fs = require('fs');
    const connPath = require('path').join(
        process.env.HOME || process.env.USERPROFILE || '/tmp',
        '.onicode', 'connectors.json'
    );
    try {
        if (fs.existsSync(connPath)) {
            const data = JSON.parse(fs.readFileSync(connPath, 'utf-8'));
            return data.github?.accessToken || null;
        }
    } catch {}
    return null;
}

// ── Extract owner/repo from git remotes ──

async function getOwnerRepo(repoPath) {
    const result = runGit('remote get-url origin', repoPath);
    if (!result.success) return null;
    const url = result.output;
    // https://github.com/owner/repo.git or git@github.com:owner/repo.git
    let match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (match) return `${match[1]}/${match[2]}`;
    return null;
}

module.exports = { registerGitIPC, getGithubToken };
