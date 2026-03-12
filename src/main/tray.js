/**
 * System Tray — Background service with tray icon and menu
 *
 * macOS: Menu bar icon (template image) with dropdown menu
 * Windows/Linux: System tray icon with context menu
 *
 * Menu items: Open Onicode, New Chat, Separator, About, Quit
 */

const { Tray, Menu, nativeImage, app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { logger } = require('./logger');

let tray = null;
let _getMainWindow = null;
let _onNewChat = null;

/**
 * Get the tray icon path based on platform
 */
function getTrayIconPath() {
    const resourcesDir = app.isPackaged
        ? path.join(process.resourcesPath, 'resources')
        : path.join(__dirname, '..', '..', 'resources');

    if (process.platform === 'darwin') {
        // macOS template images — system auto-handles dark/light menu bar
        return path.join(resourcesDir, 'trayTemplate.png');
    }
    // Windows/Linux — colored icon
    return path.join(resourcesDir, 'tray-color.png');
}

/**
 * Create or update the tray menu
 */
function buildTrayMenu() {
    const mainWindow = _getMainWindow?.();
    const isVisible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();

    const menuTemplate = [
        {
            label: isVisible ? 'Hide Onicode' : 'Open Onicode',
            click: () => {
                const win = _getMainWindow?.();
                if (!win || win.isDestroyed()) {
                    // Window was closed — recreate it
                    app.emit('activate');
                    return;
                }
                if (win.isVisible()) {
                    win.hide();
                } else {
                    win.show();
                    win.focus();
                }
                // Rebuild menu to reflect new state
                setTimeout(() => updateTrayMenu(), 100);
            },
        },
        {
            label: 'New Chat',
            click: () => {
                const win = _getMainWindow?.();
                if (!win || win.isDestroyed()) {
                    app.emit('activate');
                    setTimeout(() => {
                        const w = _getMainWindow?.();
                        if (w) w.webContents.send('tray-new-chat');
                    }, 1000);
                    return;
                }
                win.show();
                win.focus();
                win.webContents.send('tray-new-chat');
            },
        },
        { type: 'separator' },
        {
            label: 'About Onicode',
            click: () => {
                dialog.showMessageBox({
                    type: 'info',
                    title: 'About Onicode',
                    message: 'Onicode',
                    detail: `Version: ${app.getVersion()}\nElectron: ${process.versions.electron}\nNode: ${process.versions.node}\nChrome: ${process.versions.chrome}\n\nAI-powered development environment.`,
                    buttons: ['OK'],
                });
            },
        },
        { type: 'separator' },
        {
            label: 'Quit Onicode',
            click: () => {
                app.isQuitting = true;
                app.quit();
            },
        },
    ];

    return Menu.buildFromTemplate(menuTemplate);
}

/**
 * Update the tray menu (e.g., after window show/hide)
 */
function updateTrayMenu() {
    if (!tray || tray.isDestroyed()) return;
    tray.setContextMenu(buildTrayMenu());
}

/**
 * Initialize the system tray
 * @param {Function} getMainWindow - Returns the main BrowserWindow
 * @param {Function} onNewChat - Called when "New Chat" is clicked (optional)
 */
function createTray(getMainWindow, onNewChat) {
    if (tray && !tray.isDestroyed()) return tray; // Already created

    _getMainWindow = getMainWindow;
    _onNewChat = onNewChat;

    try {
        const iconPath = getTrayIconPath();
        let icon = nativeImage.createFromPath(iconPath);

        if (icon.isEmpty()) {
            logger.warn('tray', `Tray icon not found at ${iconPath}, using fallback`);
            // Fallback: create a simple 22x22 icon
            icon = nativeImage.createEmpty();
        }

        // macOS: mark as template image so it adapts to menu bar color
        if (process.platform === 'darwin') {
            icon.setTemplateImage(true);
        }

        tray = new Tray(icon);
        tray.setToolTip('Onicode — AI Development Environment');
        tray.setContextMenu(buildTrayMenu());

        // Double-click on tray icon opens the app (Windows/Linux)
        tray.on('double-click', () => {
            const win = _getMainWindow?.();
            if (!win || win.isDestroyed()) {
                app.emit('activate');
                return;
            }
            win.show();
            win.focus();
        });

        // On macOS, clicking tray icon shows the menu (default behavior)
        // On Windows, we also show on single click
        if (process.platform !== 'darwin') {
            tray.on('click', () => {
                const win = _getMainWindow?.();
                if (!win || win.isDestroyed()) {
                    app.emit('activate');
                    return;
                }
                if (win.isVisible()) {
                    win.hide();
                } else {
                    win.show();
                    win.focus();
                }
                setTimeout(() => updateTrayMenu(), 100);
            });
        }

        logger.info('tray', 'System tray created');
        return tray;
    } catch (err) {
        logger.error('tray', `Failed to create tray: ${err.message}`);
        return null;
    }
}

/**
 * Destroy the tray icon
 */
function destroyTray() {
    if (tray && !tray.isDestroyed()) {
        tray.destroy();
        tray = null;
        logger.info('tray', 'System tray destroyed');
    }
}

/**
 * Check if tray exists
 */
function hasTray() {
    return tray && !tray.isDestroyed();
}

module.exports = {
    createTray,
    destroyTray,
    updateTrayMenu,
    hasTray,
};
