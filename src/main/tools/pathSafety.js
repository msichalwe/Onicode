/**
 * Path sanitization — blocks access to sensitive directories.
 */

const path = require('path');
const os = require('os');

const BLOCKED_PATHS = [
    path.join(os.homedir(), '.ssh'),
    path.join(os.homedir(), '.gnupg'),
    path.join(os.homedir(), '.aws'),
    '/etc/shadow',
    '/etc/passwd',
];

function isPathSafe(filePath) {
    if (!filePath) return false;
    const resolved = path.resolve(filePath.replace(/^~/, os.homedir()));
    for (const blocked of BLOCKED_PATHS) {
        if (resolved.startsWith(blocked)) return false;
    }
    return true;
}

module.exports = { BLOCKED_PATHS, isPathSafe };
