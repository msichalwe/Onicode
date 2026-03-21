# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in Onicode, please report it responsibly:

1. **Do NOT open a public issue**
2. Email **msichalwe@gmail.com** with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
3. Allow 48 hours for initial response

## Security Architecture

### Credential Vault
- AES-256-GCM encryption with PBKDF2-SHA512 key derivation
- Master key protected by OS Keychain (Electron safeStorage)
- Decrypted values never sent to renderer — only masked display
- Vault stored at `~/.onicode/vault.enc`

### API Key Storage
- Provider API keys encrypted at rest in `~/.onicode/keystore.enc`
- Same AES-256-GCM + OS Keychain protection as vault

### Browser Agent
- Uses a separate Chrome profile (`~/.onicode/chrome-profile/`)
- Does not access or modify the user's personal Chrome profile
- Cookie/session data isolated from personal browsing

### AI Tool Permissions
- Three permission modes: auto-allow, ask-destructive, plan-only
- `browser_agent_run` requires explicit user approval ('ask' permission)
- File deletion, dangerous commands require confirmation in ask mode

### Data Storage
- All user data stored locally in `~/.onicode/`
- SQLite database at `~/.onicode/onicode.db`
- No telemetry or analytics collected
- Oni account sync is opt-in

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.9.x   | Current   |
