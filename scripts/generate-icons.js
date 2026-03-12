/**
 * Generate Onicode app icons (PNG at multiple sizes + tray icon)
 *
 * Uses pure Canvas API — no external image dependencies.
 * Run: node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');

// We'll generate SVG and convert to PNG via Electron's nativeImage in the app.
// For now, create SVG-based icons that Electron can load.

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
if (!fs.existsSync(RESOURCES_DIR)) fs.mkdirSync(RESOURCES_DIR, { recursive: true });

/**
 * Onicode icon — A stylized "O" with a subtle code cursor inside.
 * Clean, playful, modern. Works at all sizes including 16x16 tray.
 */
function generateIconSVG(size, opts = {}) {
    const { tray = false } = opts;
    const pad = size * 0.08;
    const cx = size / 2;
    const cy = size / 2;
    const outerR = (size / 2) - pad;
    const innerR = outerR * 0.52;

    // Colors
    const gradId = 'og';
    const bg1 = tray ? '#1a1a2e' : '#6C5CE7';  // Purple
    const bg2 = tray ? '#16213e' : '#A29BFE';  // Light purple
    const ringColor = tray ? '#e0e0e0' : '#FFFFFF';
    const cursorColor = tray ? '#00d4aa' : '#00D4AA'; // Mint green accent

    // The cursor bar (blinking cursor aesthetic)
    const cursorX = cx + innerR * 0.15;
    const cursorW = size * 0.04;
    const cursorH = innerR * 1.1;
    const cursorY = cy - cursorH / 2;

    // Two angle brackets < > around cursor
    const bracketSize = innerR * 0.5;
    const bracketStroke = Math.max(1.5, size * 0.025);
    const leftBX = cx - innerR * 0.45;
    const rightBX = cx + innerR * 0.65;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${bg1}"/>
      <stop offset="100%" stop-color="${bg2}"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="${size * 0.01}" stdDeviation="${size * 0.02}" flood-opacity="0.3"/>
    </filter>
  </defs>

  <!-- Background circle -->
  <circle cx="${cx}" cy="${cy}" r="${outerR}" fill="url(#${gradId})" ${!tray ? 'filter="url(#shadow)"' : ''}/>

  <!-- Inner ring (the "O") -->
  <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="none" stroke="${ringColor}" stroke-width="${size * 0.04}" opacity="0.9"/>

  <!-- Code cursor bar -->
  <rect x="${cursorX}" y="${cursorY}" width="${cursorW}" height="${cursorH}" rx="${cursorW / 2}" fill="${cursorColor}" opacity="0.95"/>

  <!-- Left angle bracket < -->
  <polyline points="${leftBX},${cy - bracketSize * 0.45} ${leftBX - bracketSize * 0.35},${cy} ${leftBX},${cy + bracketSize * 0.45}"
    fill="none" stroke="${ringColor}" stroke-width="${bracketStroke}" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>

  <!-- Right angle bracket > -->
  <polyline points="${rightBX},${cy - bracketSize * 0.45} ${rightBX + bracketSize * 0.35},${cy} ${rightBX},${cy + bracketSize * 0.45}"
    fill="none" stroke="${ringColor}" stroke-width="${bracketStroke}" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>
</svg>`;
}

// Generate main app icon (1024px for max quality)
const appIcon = generateIconSVG(1024);
fs.writeFileSync(path.join(RESOURCES_DIR, 'icon.svg'), appIcon);

// Generate sizes needed for different platforms
const sizes = [16, 32, 64, 128, 256, 512, 1024];
for (const size of sizes) {
    const svg = generateIconSVG(size);
    fs.writeFileSync(path.join(RESOURCES_DIR, `icon-${size}.svg`), svg);
}

// Generate tray icon (should be simple, high-contrast, works on light & dark menu bars)
// macOS tray icons are typically 22x22 (rendered as 16x16 logical)
const trayIconTemplate = generateIconSVG(44, { tray: true }); // 2x for Retina
fs.writeFileSync(path.join(RESOURCES_DIR, 'trayIconTemplate.svg'), trayIconTemplate);

// Also generate a simple tray PNG-compatible SVG (monochrome for macOS template images)
const trayTemplate = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
  <!-- Outer ring -->
  <circle cx="11" cy="11" r="9" fill="none" stroke="black" stroke-width="1.5"/>
  <!-- Inner code brackets -->
  <polyline points="8,8.5 6,11 8,13.5" fill="none" stroke="black" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  <polyline points="14,8.5 16,11 14,13.5" fill="none" stroke="black" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Cursor -->
  <rect x="10.5" y="7.5" width="1.2" height="7" rx="0.6" fill="black"/>
</svg>`;
fs.writeFileSync(path.join(RESOURCES_DIR, 'trayTemplate.svg'), trayTemplate);

// For Electron nativeImage, we need a PNG. Generate a simple fallback PNG using a data URL approach.
// The actual PNG conversion happens at runtime in the tray module.

console.log('Icons generated in resources/:');
console.log('  icon.svg (1024px app icon)');
console.log('  icon-{16..1024}.svg (multi-size)');
console.log('  trayIconTemplate.svg (tray, retina)');
console.log('  trayTemplate.svg (22px monochrome tray template)');
console.log('\nNote: PNG conversion happens at Electron runtime via nativeImage.');
