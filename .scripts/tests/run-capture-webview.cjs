// Run against an already launched, isolated Review build with WebView2 CDP enabled.
// FORGE_PLAYWRIGHT_MODULE may point to an existing Playwright installation.
// This tests native capture/files/clipboard/windows, but substitutes the capture
// mode returned to the frontend. It does NOT certify OS hotkeys or tray clicks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.FORGE_PLAYWRIGHT_MODULE || 'playwright');

const reportPath = process.env.FORGE_CAPTURE_REPORT || path.join(os.tmpdir(), 'forge-capture-webview.json');
const report = { createdAt: new Date().toISOString(), checks: [], errors: [],
    limitations: ['Capture mode is injected; OS hotkeys and tray clicks are unverified.',
        'Asset-backed editor input is tested; real scrolling of target applications is unverified.'] };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (name, details = {}) => { report.checks.push({ name, status: 'pass', ...details }); console.log(`PASS ${name}`); };
let browser, context, config;
const invoke = (page, command, args = {}) => page.evaluate(([cmd, payload]) => window.__TAURI_INTERNALS__.invoke(cmd, payload), [command, args]);

async function closeWindow(page, label) {
    const closed = page.waitForEvent('close', { timeout: 5000 });
    await invoke(page, 'plugin:window|close', { label }).catch(error => { if (!page.isClosed()) throw error; });
    await closed;
}

async function pageWithLabel(label) {
    for (let retry = 0; retry < 100; retry++) {
        for (const page of context.pages()) {
            if (await page.evaluate(() => window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label).catch(() => null) === label) return page;
        }
        await pause(100);
    }
    throw new Error(`Window not found: ${label}`);
}

async function drag(page, points) {
    await page.mouse.move(...points[0]);
    await page.mouse.down();
    for (const point of points.slice(1)) await page.mouse.move(...point, { steps: 6 });
    await page.mouse.up();
}

async function pixels(page, url) {
    return page.evaluate(async (src) => {
        const image = new Image(); image.crossOrigin = 'anonymous'; image.src = src; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const digest = await crypto.subtle.digest('SHA-256', data);
        return { width: canvas.width, height: canvas.height, sha256: [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('') };
    }, url);
}

async function openCapture() {
    const response = await fetch('http://127.0.0.1:60829/ocr_recognize', { method: 'POST', signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    const page = await pageWithLabel('screenshot');
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.waitForFunction(() => document.querySelector('img')?.naturalWidth > 0);
    await invoke(page, 'plugin:window|hide', { label: 'screenshot' });
    return page;
}

async function main() {
    browser = await chromium.connectOverCDP('http://127.0.0.1:19229');
    context = browser.contexts()[0];
    config = await pageWithLabel('config');
    assert.equal(await invoke(config, 'plugin:app|identifier'), 'com.aabiber.pot-forge.review');
    const { sourceIdentity } = await import(pathToFileURL(path.resolve(__dirname, '../source-identity.mjs')));
    report.source = sourceIdentity();
    const binary = process.env.FORGE_REVIEW_BINARY;
    if (binary) report.candidate = { path: binary, sha256: crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex') };
    await invoke(config, 'plugin:window|hide', { label: 'config' });
    await context.addInitScript(() => {
        const original = window.fetch.bind(window);
        window.fetch = async (input, ...args) => String(input?.url || input).endsWith('/get_capture_mode')
            ? new Response(JSON.stringify('save'), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' } })
            : original(input, ...args);
    });

    for (const region of ['Rect', 'Ellipse', 'Freehand', 'Multi']) {
        const page = await openCapture();
        const buttons = await page.locator('body').ariaSnapshot();
        assert.ok(buttons.includes(`button "${region}"`));
        const asset = await page.locator('img').getAttribute('src');
        const original = await pixels(page, asset);
        assert.ok(original.width > 0 && original.height > 0);
        await page.getByRole('button', { name: region, exact: true }).click();
        if (region === 'Freehand') await drag(page, [[300, 300], [900, 300], [900, 700], [300, 300]]);
        else if (region === 'Multi') {
            await drag(page, [[300, 300], [500, 500]]);
            await drag(page, [[700, 500], [900, 700]]);
        } else await drag(page, [[300, 300], [900, 700]]);
        await page.getByRole('button', { name: 'Confirm', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('canvas')?.width > 1 && innerWidth === 960);
        await invoke(page, 'plugin:window|hide', { label: 'screenshot' });
        const crop = await page.locator('canvas').evaluate(c => ({ width: c.width, height: c.height, png: c.toDataURL('image/png').length }));
        assert.ok(crop.png > 100);
        pass(`region ${region}: capture -> editor -> PNG`, crop);

        if (region === 'Rect') {
            for (const tool of ['Rect', 'Oval', 'Arrow', 'Line', 'Pen', 'Text', 'Balloon', 'Step', 'Blur', 'Hi', 'Spot', 'Mag']) {
                await page.getByRole('button', { name: tool, exact: true }).click();
                const b = await page.locator('canvas').boundingBox();
                const start = [b.x + 60, b.y + 60], end = [b.x + 180, b.y + 130];
                if (['Text', 'Step'].includes(tool)) await page.mouse.click(...start);
                else await drag(page, [start, end]);
                if (['Text', 'Balloon'].includes(tool)) {
                    await page.locator('textarea').fill('Forge 文字验收');
                    await page.getByRole('button', { name: 'Select', exact: true }).click();
                }
                assert.ok(await page.locator('canvas').evaluate(c => c.toDataURL('image/png').length > 100));
                pass(`annotation ${tool}: draw and export`);
                await page.getByRole('button', { name: 'Undo', exact: true }).click();
            }
            await page.getByRole('button', { name: 'Crop', exact: true }).click();
            const b = await page.locator('canvas').boundingBox();
            await drag(page, [[b.x + 40, b.y + 40], [b.x + 240, b.y + 180]]);
            await page.waitForFunction(([w, h]) => { const c = document.querySelector('canvas'); return c.width < w && c.height < h; }, [crop.width, crop.height]);
            pass('editor crop changes output dimensions');
            await page.locator('img').evaluate((img, src) => { img.src = src; }, asset);
            await page.waitForFunction(([w, h]) => { const c = document.querySelector('canvas'); return c.width === w && c.height === h; }, [original.width, original.height]);
            assert.ok(await page.locator('canvas').evaluate(c => c.toDataURL('image/png').length > 100));
            pass('asset-backed editor image exports without canvas taint');
        }

        const oldPaths = new Set((await invoke(config, 'list_pin_history')).filter(x => x.source === 'forge').map(x => x.path));
        await page.getByRole('button', { name: /^(Save|Save and copy)$/, exact: true }).click();
        await page.waitForEvent('close', { timeout: 10000 }).catch(error => { if (!page.isClosed()) throw error; });
        const history = (await invoke(config, 'list_pin_history')).filter(x => x.source === 'forge' && !oldPaths.has(x.path));
        assert.equal(history.length, 1); assert.ok(history[0].exists);
        const saved = history[0].path;
        assert.ok(saved.includes('com.aabiber.pot-forge.review'));
        const savedUrl = await config.evaluate(p => window.__TAURI_INTERNALS__.convertFileSrc(p), saved);
        const expected = await pixels(config, savedUrl);
        const pinLabel = await invoke(config, 'pin_from_clipboard');
        const pinPage = await pageWithLabel(pinLabel);
        await pinPage.waitForFunction(() => document.querySelector('img')?.naturalWidth > 0);
        const pinUrl = await pinPage.locator('img').getAttribute('src');
        assert.deepEqual(await pixels(config, pinUrl), expected);
        await invoke(pinPage, 'plugin:window|hide', { label: pinLabel });
        pass(`${region}: native save + history + clipboard pixel readback`, expected);
    }

    const pins = [];
    for (const page of context.pages()) {
        const label = await page.evaluate(() => window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label);
        if (/^pin-\d+$/.test(label)) pins.push({ page, label });
    }
    assert.equal(pins.length, 4);
    pass('four independent pin windows coexist');
    await invoke(config, 'open_pin_history_window');
    const historyPage = await pageWithLabel('pin-history');
    await historyPage.locator('body').waitFor();
    pass('native history window opens without deadlock');
    await closeWindow(historyPage, 'pin-history');
    for (const pin of pins) await closeWindow(pin.page, pin.label);

    const failed = await openCapture();
    await failed.locator('img').evaluate(img => { img.src = img.src.replace('pot_screenshot.png', 'missing-acceptance-fixture.png'); });
    await failed.getByRole('alert').filter({ hasText: 'Could not load the screenshot' }).waitFor();
    pass('missing image shows an actionable error');
    await failed.addInitScript(() => {
        const original = window.fetch.bind(window);
        window.fetch = async (input, ...args) => String(input?.url || input).endsWith('/screenshot')
            ? new Response(JSON.stringify('native capture failure fixture'), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'error' } })
            : original(input, ...args);
    });
    await failed.reload();
    await failed.getByRole('alert').filter({ hasText: 'native capture failure fixture' }).waitFor();
    pass('native capture rejection is visible instead of a hidden window');
    await failed.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(report.errors, []);
    assert.equal(sourceIdentity().fingerprint, report.source.fingerprint);
    report.status = 'pass';
}

main().catch(error => { report.status = 'fail'; report.failure = error.stack; process.exitCode = 1; })
    .finally(async () => { fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); console.log(`Report: ${reportPath}`); await browser?.close(); });
