/**
 * Browser Automation — Puppeteer-based browser testing for web apps.
 * The AI uses this to launch, navigate, screenshot, read console logs,
 * click elements, and verify the apps it creates actually work.
 *
 * Enabled by default for all web projects.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

let puppeteer = null;
let browser = null;
let activePage = null;
const consoleLogs = [];
const MAX_CONSOLE_LOGS = 200;

const SCREENSHOTS_DIR = path.join(os.homedir(), '.onicode', 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// ══════════════════════════════════════════
//  Lazy Puppeteer loader
// ══════════════════════════════════════════

function getPuppeteer() {
    if (puppeteer) return puppeteer;
    try {
        puppeteer = require('puppeteer');
        return puppeteer;
    } catch {
        try {
            puppeteer = require('puppeteer-core');
            return puppeteer;
        } catch {
            return null;
        }
    }
}

// ══════════════════════════════════════════
//  Browser lifecycle
// ══════════════════════════════════════════

async function launchBrowser(opts = {}) {
    const pptr = getPuppeteer();
    if (!pptr) {
        return { error: 'Puppeteer not installed. Run: npm install puppeteer' };
    }

    if (browser) {
        return { success: true, message: 'Browser already running', reused: true };
    }

    try {
        browser = await pptr.launch({
            headless: opts.headless !== false ? 'new' : false,
            timeout: 60000,
            protocolTimeout: 120000,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
            ],
            defaultViewport: { width: opts.width || 1280, height: opts.height || 720 },
        });

        activePage = await browser.newPage();
        setupPageListeners(activePage);

        return { success: true, message: 'Browser launched' };
    } catch (err) {
        return { error: `Failed to launch browser: ${err.message}` };
    }
}

async function closeBrowser() {
    if (browser) {
        try { await browser.close(); } catch { }
        browser = null;
        activePage = null;
        consoleLogs.length = 0;
    }
    return { success: true };
}

function setupPageListeners(page) {
    // Capture console logs
    page.on('console', (msg) => {
        const entry = {
            type: msg.type(),
            text: msg.text(),
            ts: new Date().toISOString(),
        };
        consoleLogs.push(entry);
        if (consoleLogs.length > MAX_CONSOLE_LOGS) consoleLogs.shift();
    });

    // Capture page errors
    page.on('pageerror', (err) => {
        consoleLogs.push({
            type: 'error',
            text: `PAGE ERROR: ${err.message}`,
            ts: new Date().toISOString(),
        });
    });

    // Capture request failures
    page.on('requestfailed', (req) => {
        consoleLogs.push({
            type: 'warn',
            text: `REQUEST FAILED: ${req.url()} — ${req.failure()?.errorText || 'unknown'}`,
            ts: new Date().toISOString(),
        });
    });
}

// ══════════════════════════════════════════
//  Navigation & interaction
// ══════════════════════════════════════════

async function ensurePage() {
    if (!browser) {
        const result = await launchBrowser();
        if (result.error) return result;
    }
    if (!activePage || activePage.isClosed()) {
        activePage = await browser.newPage();
        setupPageListeners(activePage);
    }
    return { success: true };
}

async function navigate(url, opts = {}) {
    const check = await ensurePage();
    if (check.error) return check;

    try {
        const timeout = opts.timeout || 60000;
        const response = await activePage.goto(url, {
            waitUntil: opts.waitUntil || 'load',
            timeout,
        });

        return {
            success: true,
            url: activePage.url(),
            status: response?.status() || null,
            title: await activePage.title(),
        };
    } catch (err) {
        return { error: `Navigation failed: ${err.message}`, url };
    }
}

async function screenshot(opts = {}) {
    const check = await ensurePage();
    if (check.error) return check;

    try {
        const name = opts.name || `screenshot_${Date.now()}`;
        const filePath = path.join(SCREENSHOTS_DIR, `${name}.png`);

        const screenshotOpts = { path: filePath, type: 'png' };
        if (opts.selector) {
            const el = await activePage.$(opts.selector);
            if (!el) return { error: `Element not found: ${opts.selector}` };
            await el.screenshot(screenshotOpts);
        } else {
            screenshotOpts.fullPage = opts.fullPage || false;
            await activePage.screenshot(screenshotOpts);
        }

        const stats = fs.statSync(filePath);

        // Extract visible text + DOM structure so the AI can analyze what's on screen
        let pageAnalysis = {};
        try {
            pageAnalysis = await activePage.evaluate(() => {
                const title = document.title || '';
                const bodyText = document.body?.innerText?.slice(0, 3000) || '';
                // Get key UI elements
                const headings = [...document.querySelectorAll('h1, h2, h3')].slice(0, 10).map(el => el.textContent?.trim());
                const buttons = [...document.querySelectorAll('button, [role="button"], a.btn')].slice(0, 15).map(el => el.textContent?.trim());
                const inputs = [...document.querySelectorAll('input, textarea, select')].slice(0, 10).map(el => ({
                    type: el.getAttribute('type') || el.tagName.toLowerCase(),
                    placeholder: el.getAttribute('placeholder') || '',
                    value: el.value?.slice(0, 50) || '',
                }));
                const images = [...document.querySelectorAll('img')].slice(0, 5).map(el => ({
                    alt: el.getAttribute('alt') || '',
                    src: el.getAttribute('src')?.slice(0, 100) || '',
                }));
                const errors = [...document.querySelectorAll('.error, [class*="error"], [role="alert"]')].slice(0, 5).map(el => el.textContent?.trim());
                // Check for common empty states
                const isEmpty = bodyText.trim().length < 50;
                return { title, bodyText: bodyText.slice(0, 2000), headings, buttons, inputs, images, errors, isEmpty };
            });
        } catch { /* page analysis failed, proceed with screenshot only */ }

        return {
            success: true,
            path: filePath,
            name,
            size: stats.size,
            url: activePage.url(),
            pageContent: pageAnalysis,
            ANALYSIS_GUIDE: 'Use the pageContent field to understand what is displayed. Check headings, buttons, bodyText, and errors to verify the UI matches expectations. If bodyText is empty or shows error messages, the app may not be rendering correctly — check console_logs for errors.',
        };
    } catch (err) {
        return { error: `Screenshot failed: ${err.message}` };
    }
}

async function evaluate(script) {
    const check = await ensurePage();
    if (check.error) return check;

    try {
        const result = await activePage.evaluate((code) => {
            try {
                // eslint-disable-next-line no-eval
                const r = eval(code);
                return { success: true, result: String(r) };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }, script);
        return result;
    } catch (err) {
        return { error: `Evaluate failed: ${err.message}` };
    }
}

async function click(selector) {
    const check = await ensurePage();
    if (check.error) return check;

    try {
        await activePage.click(selector);
        return { success: true, selector };
    } catch (err) {
        return { error: `Click failed on "${selector}": ${err.message}` };
    }
}

async function type(selector, text) {
    const check = await ensurePage();
    if (check.error) return check;

    try {
        await activePage.type(selector, text);
        return { success: true, selector, typed: text.length };
    } catch (err) {
        return { error: `Type failed on "${selector}": ${err.message}` };
    }
}

async function waitForSelector(selector, opts = {}) {
    const check = await ensurePage();
    if (check.error) return check;

    try {
        await activePage.waitForSelector(selector, { timeout: opts.timeout || 10000 });
        return { success: true, selector };
    } catch (err) {
        return { error: `Wait failed for "${selector}": ${err.message}` };
    }
}

async function getPageContent() {
    const check = await ensurePage();
    if (check.error) return check;

    try {
        const content = await activePage.content();
        return {
            success: true,
            url: activePage.url(),
            title: await activePage.title(),
            html: content.slice(0, 15000),
            length: content.length,
        };
    } catch (err) {
        return { error: `getPageContent failed: ${err.message}` };
    }
}

function getConsoleLogs(opts = {}) {
    let logs = [...consoleLogs];
    if (opts.type) {
        logs = logs.filter(l => l.type === opts.type);
    }
    if (opts.since) {
        logs = logs.filter(l => l.ts >= opts.since);
    }
    const limit = opts.limit || 50;
    return logs.slice(-limit);
}

function clearConsoleLogs() {
    consoleLogs.length = 0;
    return { success: true };
}

// ══════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════

function registerBrowserIPC() {
    const { ipcMain } = require('electron');

    ipcMain.handle('browser-launch', (_event, opts) => launchBrowser(opts));
    ipcMain.handle('browser-close', () => closeBrowser());
    ipcMain.handle('browser-navigate', (_event, url, opts) => navigate(url, opts));
    ipcMain.handle('browser-screenshot', (_event, opts) => screenshot(opts));
    ipcMain.handle('browser-evaluate', (_event, script) => evaluate(script));
    ipcMain.handle('browser-click', (_event, selector) => click(selector));
    ipcMain.handle('browser-type', (_event, selector, text) => type(selector, text));
    ipcMain.handle('browser-wait', (_event, selector, opts) => waitForSelector(selector, opts));
    ipcMain.handle('browser-content', () => getPageContent());
    ipcMain.handle('browser-console-logs', (_event, opts) => ({ success: true, logs: getConsoleLogs(opts) }));
    ipcMain.handle('browser-console-clear', () => clearConsoleLogs());
}

module.exports = {
    launchBrowser,
    closeBrowser,
    navigate,
    screenshot,
    evaluate,
    click,
    type: type,
    waitForSelector,
    getPageContent,
    getConsoleLogs,
    clearConsoleLogs,
    registerBrowserIPC,
};
