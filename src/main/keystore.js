/**
 * Key Store — AES-256-GCM encrypted vault for API keys and secrets
 *
 * Storage: ~/.onicode/keystore.enc (encrypted JSON blob)
 * Encryption: AES-256-GCM with PBKDF2-derived key
 * Master password: OS keychain via Electron safeStorage when available,
 *                  falls back to machine-derived key (hostname + username + salt)
 */

const { safeStorage } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ONICODE_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.onicode');
const KEYSTORE_FILE = path.join(ONICODE_DIR, 'keystore.enc');
const SALT_FILE = path.join(ONICODE_DIR, 'keystore.salt');

const ALGORITHM = 'aes-256-gcm';
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// ── Master Key Derivation ──

let _cachedMasterKey = null;

function getSalt() {
    if (!fs.existsSync(ONICODE_DIR)) fs.mkdirSync(ONICODE_DIR, { recursive: true });
    if (fs.existsSync(SALT_FILE)) {
        return fs.readFileSync(SALT_FILE);
    }
    const salt = crypto.randomBytes(32);
    fs.writeFileSync(SALT_FILE, salt);
    return salt;
}

function deriveMasterKey() {
    if (_cachedMasterKey) return _cachedMasterKey;

    const salt = getSalt();
    let masterPassword;

    // Try Electron safeStorage (uses OS keychain: macOS Keychain, Windows DPAPI, Linux libsecret)
    if (safeStorage.isEncryptionAvailable()) {
        const marker = 'onicode-keystore-master';
        const markerFile = path.join(ONICODE_DIR, 'keystore.marker');

        if (fs.existsSync(markerFile)) {
            // Decrypt the stored master password
            const encrypted = fs.readFileSync(markerFile);
            masterPassword = safeStorage.decryptString(encrypted);
        } else {
            // Generate and store a new master password
            masterPassword = crypto.randomBytes(64).toString('base64');
            const encrypted = safeStorage.encryptString(masterPassword);
            fs.writeFileSync(markerFile, encrypted);
        }
    } else {
        // Fallback: derive from machine identity (less secure but still AES-encrypted)
        masterPassword = `onicode:${os.hostname()}:${os.userInfo().username}:${os.platform()}`;
    }

    _cachedMasterKey = crypto.pbkdf2Sync(masterPassword, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');
    return _cachedMasterKey;
}

// ── Encryption / Decryption ──

function encrypt(plaintext) {
    const key = deriveMasterKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Format: iv (16) + authTag (16) + ciphertext
    return Buffer.concat([iv, authTag, encrypted]);
}

function decrypt(buffer) {
    const key = deriveMasterKey();
    const iv = buffer.subarray(0, IV_LENGTH);
    const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
}

// ── Vault CRUD ──

function loadVault() {
    try {
        if (fs.existsSync(KEYSTORE_FILE)) {
            const raw = fs.readFileSync(KEYSTORE_FILE);
            const json = decrypt(raw);
            return JSON.parse(json);
        }
    } catch (err) {
        console.error('[keystore] Failed to decrypt vault:', err.message);
    }
    return {};
}

function saveVault(data) {
    if (!fs.existsSync(ONICODE_DIR)) fs.mkdirSync(ONICODE_DIR, { recursive: true });
    const json = JSON.stringify(data, null, 2);
    const encrypted = encrypt(json);
    fs.writeFileSync(KEYSTORE_FILE, encrypted);
}

/**
 * Store a key in the vault
 * @param {string} id - Unique key identifier (e.g., 'openai-main', 'anthropic-prod')
 * @param {object} entry - { name, value, provider, notes }
 */
function storeKey(id, entry) {
    const vault = loadVault();
    vault[id] = {
        ...entry,
        id,
        createdAt: vault[id]?.createdAt || Date.now(),
        updatedAt: Date.now(),
    };
    saveVault(vault);
    return vault[id];
}

/**
 * Get a key from the vault (with value)
 */
function getKey(id) {
    const vault = loadVault();
    return vault[id] || null;
}

/**
 * List all keys (without values for safety)
 */
function listKeys() {
    const vault = loadVault();
    return Object.values(vault).map(entry => ({
        id: entry.id,
        name: entry.name,
        provider: entry.provider,
        notes: entry.notes,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        // Mask the value — only show last 4 chars
        maskedValue: entry.value ? `${'•'.repeat(8)}${entry.value.slice(-4)}` : '',
    }));
}

/**
 * Delete a key from the vault
 */
function deleteKey(id) {
    const vault = loadVault();
    if (!vault[id]) return false;
    delete vault[id];
    saveVault(vault);
    return true;
}

/**
 * Get decrypted value for a key (used internally by provider system)
 */
function getKeyValue(id) {
    const entry = getKey(id);
    return entry?.value || null;
}

// ── IPC Registration ──

function registerKeystoreIPC(ipcMain) {
    ipcMain.handle('keystore-list', async () => {
        return { keys: listKeys() };
    });

    ipcMain.handle('keystore-store', async (_event, id, entry) => {
        const result = storeKey(id, entry);
        return { success: true, key: { ...result, value: undefined } };
    });

    ipcMain.handle('keystore-get', async (_event, id) => {
        const entry = getKey(id);
        if (!entry) return { found: false };
        return {
            found: true,
            key: { ...entry, maskedValue: entry.value ? `${'•'.repeat(8)}${entry.value.slice(-4)}` : '' },
        };
    });

    ipcMain.handle('keystore-get-value', async (_event, id) => {
        // Returns the actual decrypted value — use with care
        const value = getKeyValue(id);
        return { value };
    });

    ipcMain.handle('keystore-delete', async (_event, id) => {
        const deleted = deleteKey(id);
        return { success: deleted };
    });

    ipcMain.handle('keystore-status', async () => {
        const usesSafeStorage = safeStorage.isEncryptionAvailable();
        const keys = listKeys();
        return {
            encrypted: true,
            algorithm: 'AES-256-GCM',
            keyDerivation: 'PBKDF2-SHA512',
            safeStorage: usesSafeStorage,
            keyCount: keys.length,
        };
    });
}

module.exports = { registerKeystoreIPC, getKeyValue, listKeys, encrypt, decrypt };
