/**
 * Credential Vault — Encrypted credential storage for AI and user access.
 *
 * Reuses AES-256-GCM encryption from keystore.js (shared master key, OS Keychain).
 * Stores credentials in ~/.onicode/vault.enc (separate from keystore.enc).
 *
 * Credential types: api_key, login, secret, oauth
 * Each credential has: title, description, type, service, tags, and type-specific fields.
 *
 * Security:
 * - Renderer only sees masked values (••••••XXXX) via IPC
 * - Decrypted values only accessible in main process (AI tool executor)
 * - Same encryption as keystore: AES-256-GCM + PBKDF2-SHA512 + OS Keychain
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { logger } = require('./logger');
const { encrypt, decrypt } = require('./keystore');

// ══════════════════════════════════════════
//  Config
// ══════════════════════════════════════════

const CONFIG_DIR = path.join(os.homedir(), '.onicode');
const VAULT_FILE = path.join(CONFIG_DIR, 'vault.enc');

// ══════════════════════════════════════════
//  Vault CRUD (encrypted JSON blob)
// ══════════════════════════════════════════

function loadVault() {
    try {
        if (fs.existsSync(VAULT_FILE)) {
            const raw = fs.readFileSync(VAULT_FILE);
            const json = decrypt(raw);
            return JSON.parse(json);
        }
    } catch (err) {
        logger.error('vault', `Failed to decrypt vault: ${err.message}`);
    }
    return {};
}

function saveVault(vault) {
    try {
        if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
        const json = JSON.stringify(vault, null, 2);
        const encrypted = encrypt(json);
        fs.writeFileSync(VAULT_FILE, encrypted);
    } catch (err) {
        logger.error('vault', `Failed to save vault: ${err.message}`);
        throw err;
    }
}

// ══════════════════════════════════════════
//  Masking — hide sensitive values for UI
// ══════════════════════════════════════════

function maskValue(val) {
    if (!val || typeof val !== 'string') return null;
    if (val.length <= 4) return '••••';
    return '••••••••' + val.slice(-4);
}

function maskCredential(cred) {
    return {
        id: cred.id,
        title: cred.title,
        description: cred.description || '',
        type: cred.type,
        service: cred.service,
        tags: cred.tags || [],
        maskedUsername: cred.username ? maskValue(cred.username) : null,
        maskedPassword: cred.password ? '••••••••' : null,
        maskedApiKey: cred.apiKey ? maskValue(cred.apiKey) : null,
        maskedToken: cred.token ? maskValue(cred.token) : null,
        hasRefreshToken: !!cred.refreshToken,
        hasExtra: cred.extra && Object.keys(cred.extra).length > 0,
        extraKeys: cred.extra ? Object.keys(cred.extra) : [],
        createdAt: cred.createdAt,
        updatedAt: cred.updatedAt,
    };
}

// ══════════════════════════════════════════
//  CRUD Functions (exported for AI tools)
// ══════════════════════════════════════════

function vaultSave(id, data) {
    const vault = loadVault();

    // Handle ID collision — append suffix if ID already exists and it's a new entry
    let finalId = id;
    if (vault[id] && !data._update) {
        const suffix = Math.random().toString(36).substring(2, 6);
        finalId = `${id}-${suffix}`;
    }

    const existing = vault[finalId] || {};
    const now = Date.now();

    vault[finalId] = {
        id: finalId,
        title: data.title || existing.title || finalId,
        description: data.description || existing.description || '',
        type: data.type || existing.type || 'secret',
        service: data.service || existing.service || '',
        tags: data.tags || existing.tags || [],
        username: data.username !== undefined ? data.username : (existing.username || null),
        password: data.password !== undefined ? data.password : (existing.password || null),
        apiKey: data.apiKey !== undefined ? data.apiKey : (existing.apiKey || null),
        token: data.token !== undefined ? data.token : (existing.token || null),
        refreshToken: data.refreshToken !== undefined ? data.refreshToken : (existing.refreshToken || null),
        extra: data.extra || existing.extra || {},
        createdAt: existing.createdAt || now,
        updatedAt: now,
    };

    saveVault(vault);
    logger.info('vault', `Saved credential: ${finalId} (${data.type}/${data.service})`);
    return maskCredential(vault[finalId]);
}

function vaultGet(id) {
    const vault = loadVault();
    const cred = vault[id];
    if (!cred) return null;
    return maskCredential(cred);
}

function vaultGetDecrypted(id) {
    const vault = loadVault();
    const cred = vault[id];
    if (!cred) return null;
    // Return actual values — only used in main process tool executor
    return {
        id: cred.id,
        title: cred.title,
        type: cred.type,
        service: cred.service,
        username: cred.username || null,
        password: cred.password || null,
        apiKey: cred.apiKey || null,
        token: cred.token || null,
        refreshToken: cred.refreshToken || null,
        extra: cred.extra || {},
    };
}

function vaultList() {
    const vault = loadVault();
    return Object.values(vault).map(maskCredential);
}

function vaultDelete(id) {
    const vault = loadVault();
    if (!vault[id]) return false;
    delete vault[id];
    saveVault(vault);
    logger.info('vault', `Deleted credential: ${id}`);
    return true;
}

function vaultSearch(query) {
    if (!query) return vaultList();
    const vault = loadVault();
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);

    const scored = Object.values(vault).map(cred => {
        let score = 0;
        const title = (cred.title || '').toLowerCase();
        const service = (cred.service || '').toLowerCase();
        const desc = (cred.description || '').toLowerCase();
        const tags = (cred.tags || []).map(t => t.toLowerCase());

        for (const token of tokens) {
            // Exact service match — strongest signal
            if (service === token) score += 15;
            else if (service.includes(token)) score += 10;

            // Title match
            if (title === token) score += 12;
            else if (title.includes(token)) score += 6;

            // Tag match
            if (tags.includes(token)) score += 8;
            else if (tags.some(t => t.includes(token))) score += 4;

            // Description match
            if (desc.includes(token)) score += 2;
        }

        return { cred, score };
    });

    return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(s => maskCredential(s.cred));
}

// ══════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════

function registerVaultIPC(ipcMain) {
    ipcMain.handle('vault-list', async () => {
        try { return { credentials: vaultList() }; }
        catch (err) { return { error: err.message }; }
    });

    ipcMain.handle('vault-save', async (_e, id, entry) => {
        try {
            const credential = vaultSave(id, { ...entry, _update: true });
            return { success: true, credential };
        } catch (err) { return { success: false, error: err.message }; }
    });

    ipcMain.handle('vault-get', async (_e, id) => {
        try {
            const credential = vaultGet(id);
            return { found: !!credential, credential };
        } catch (err) { return { found: false, error: err.message }; }
    });

    ipcMain.handle('vault-delete', async (_e, id) => {
        try {
            const deleted = vaultDelete(id);
            return { success: deleted };
        } catch (err) { return { success: false, error: err.message }; }
    });

    ipcMain.handle('vault-search', async (_e, query) => {
        try { return { results: vaultSearch(query) }; }
        catch (err) { return { results: [], error: err.message }; }
    });

    ipcMain.handle('vault-status', async () => {
        try {
            const vault = loadVault();
            const count = Object.keys(vault).length;
            let usesSafeStorage = false;
            try {
                const { safeStorage } = require('electron');
                usesSafeStorage = safeStorage?.isEncryptionAvailable?.() || false;
            } catch { /* not available */ }
            return {
                encrypted: true,
                algorithm: 'AES-256-GCM',
                keyDerivation: 'PBKDF2-SHA512',
                safeStorage: usesSafeStorage,
                credentialCount: count,
            };
        } catch (err) { return { error: err.message }; }
    });
}

module.exports = {
    registerVaultIPC,
    vaultSave,
    vaultSearch,
    vaultGet,
    vaultGetDecrypted,
    vaultList,
    vaultDelete,
};
