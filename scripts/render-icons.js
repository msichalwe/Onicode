/**
 * Render SVG icons to PNG using sharp
 * Run: node scripts/render-icons.js
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const RES = path.join(__dirname, '..', 'resources');

async function render() {
    // App icon at multiple sizes
    const sizes = [16, 32, 64, 128, 256, 512, 1024];
    const svgBuf = fs.readFileSync(path.join(RES, 'icon.svg'));

    for (const size of sizes) {
        await sharp(svgBuf)
            .resize(size, size)
            .png()
            .toFile(path.join(RES, `icon-${size}.png`));
    }

    // Main app icon (256px for BrowserWindow)
    await sharp(svgBuf).resize(256, 256).png().toFile(path.join(RES, 'icon.png'));

    // Tray icon — monochrome template for macOS (22px logical, 44px @2x)
    const traySvg = fs.readFileSync(path.join(RES, 'trayTemplate.svg'));
    await sharp(traySvg).resize(22, 22).png().toFile(path.join(RES, 'trayTemplate.png'));
    await sharp(traySvg).resize(44, 44).png().toFile(path.join(RES, 'trayTemplate@2x.png'));

    // Colored tray icon (for non-macOS or when template doesn't work)
    const trayColorSvg = fs.readFileSync(path.join(RES, 'trayIconTemplate.svg'));
    await sharp(trayColorSvg).resize(32, 32).png().toFile(path.join(RES, 'tray-color.png'));
    await sharp(trayColorSvg).resize(64, 64).png().toFile(path.join(RES, 'tray-color@2x.png'));

    console.log('PNG icons rendered:');
    const pngs = fs.readdirSync(RES).filter(f => f.endsWith('.png'));
    pngs.forEach(f => {
        const stat = fs.statSync(path.join(RES, f));
        console.log(`  ${f} (${stat.size} bytes)`);
    });
}

render().catch(err => {
    console.error('Icon render failed:', err);
    process.exit(1);
});
