// Start Review with .scripts/tests/opacity-windows.json (a real isolated panel).
// Uses actual native windows, settings, controls and desktop pixel sampling.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.FORGE_PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.FORGE_OPACITY_REPORT || path.join(os.tmpdir(), 'forge-opacity-result.json');
const report = { createdAt: new Date().toISOString(), checks: [], errors: [], windows: [] };
let browser, context, config, daemon;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const invoke = (p, cmd, args = {}) => p.evaluate(([name, payload]) => window.__TAURI_INTERNALS__.invoke(name, payload), [cmd, args]);
const pass = (name, data = {}) => { report.checks.push({ name, status: 'pass', ...data }); console.log(`PASS ${name}`); };
const alpha = color => color.startsWith('rgba') ? Number(color.match(/[\d.]+/g)[3]) : color === 'transparent' ? 0 : 1;
async function sliderValue(slider, expected) {
    for (let n = 0; n < 80; n++) {
        if (Math.abs(Number(await slider.inputValue()) - expected) < 0.001) return;
        await sleep(50);
    }
    assert.equal(Number(await slider.inputValue()), expected);
}
async function page(label) {
    for (let n = 0; n < 70; n++) {
        for (const p of context.pages()) if (await p.evaluate(() => window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label).catch(() => '') === label) {
            p.setDefaultTimeout(5000); return p;
        }
        await sleep(100);
    }
    throw new Error(`Missing native window ${label}; use the isolated panel fixture`);
}
async function backgrounds(p, selector, expected) {
    await p.waitForFunction(([selector, expected]) => {
        const nodes = [...document.querySelectorAll(selector)];
        return nodes.length && nodes.every(e => {
            const color = getComputedStyle(e).backgroundColor;
            const a = color.startsWith('rgba') ? Number(color.match(/[\d.]+/g)[3]) : 1;
            return Math.abs(a - expected) < 0.01 && getComputedStyle(e).opacity === '1';
        });
    }, [selector, expected]);
}
async function position(p, label, x, y, width, height, top = true) {
    await invoke(p, 'plugin:window|unminimize', { label });
    await invoke(p, 'plugin:window|show', { label });
    await invoke(p, 'plugin:window|set_always_on_top', { label, value: top });
    await invoke(p, 'plugin:window|set_position', { label, value: { Physical: { x, y } } });
    if (width) await invoke(p, 'plugin:window|set_size', { label, value: { Logical: { width, height } } });
    await invoke(p, 'plugin:window|set_focus', { label });
}
async function sample(p, label, point) {
    const origin = await invoke(p, 'plugin:window|inner_position', { label });
    const scale = await invoke(p, 'plugin:window|scale_factor', { label });
    await invoke(daemon, 'screenshot', { x: 0, y: 0 });
    const location = path.join(process.env.LOCALAPPDATA, 'com.aabiber.pot-forge.review', 'pot_screenshot.png');
    return p.evaluate(async ({ location, x, y }) => {
        const img = new Image(); img.crossOrigin = 'anonymous'; img.src = window.__TAURI_INTERNALS__.convertFileSrc(location) + '?t=' + Date.now(); await img.decode();
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
        return Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data);
    }, { location, x: origin.x + point.x * scale, y: origin.y + point.y * scale });
}
async function main() {
    const { sourceIdentity } = await import(pathToFileURL(path.resolve(__dirname, '../source-identity.mjs')));
    report.source = sourceIdentity();
    if (process.env.FORGE_REVIEW_BINARY) report.candidateSha256 = crypto.createHash('sha256').update(fs.readFileSync(process.env.FORGE_REVIEW_BINARY)).digest('hex');
    browser = await chromium.connectOverCDP('http://127.0.0.1:19229'); context = browser.contexts()[0];
    daemon = await page('daemon'); assert.equal(await invoke(daemon, 'plugin:app|identifier'), 'com.aabiber.pot-forge.review');
    config = await page('config');
    const panel = await page('panel');
    await invoke(panel, 'set_panel_settings', { patch: { opacity: 0.25, hoverBoost: false } });
    await panel.reload(); await panel.locator('.forge-panel').waitFor();
    await fetch('http://127.0.0.1:60829/input_translate', { method: 'POST' });
    await fetch('http://127.0.0.1:60829/ocr_recognize?screenshot=false', { method: 'POST' });
    await invoke(config, 'open_pin_history_window'); await invoke(config, 'updater_window');
    const translate = await page('translate'), recognize = await page('recognize');
    const history = await page('pin-history'), updater = await page('updater');
    const red = await config.evaluate(() => { const c = document.createElement('canvas'); c.width = 240; c.height = 180; const x = c.getContext('2d'); x.fillStyle = '#ff0000'; x.fillRect(0, 0, 240, 180); return c.toDataURL(); });
    const saved = await invoke(config, 'finish_capture', { pngBase64: red, pin: true }); assert.ok(saved.pinned);
    let pin;
    for (const p of context.pages()) if (/^pin-\d+$/.test(await p.evaluate(() => window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label))) pin = p;
    assert.ok(pin); await pin.waitForFunction(() => document.querySelector('img')?.naturalWidth > 0);
    const pinLabel = await pin.evaluate(() => window.__TAURI_INTERNALS__.metadata.currentWindow.label);
    await context.addInitScript(() => { const original = window.fetch.bind(window); window.fetch = async (input, ...args) => String(input?.url || input).endsWith('/get_capture_mode') ? new Response(JSON.stringify('save'), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' } }) : original(input, ...args); });
    await fetch('http://127.0.0.1:60829/ocr_recognize', { method: 'POST' }); const shot = await page('screenshot');
    await shot.waitForFunction(() => document.querySelector('img')?.naturalWidth > 0);
    assert.equal(await shot.locator('img').evaluate(i => getComputedStyle(i).opacity), '1');
    pass('capture selection preserves image opacity');
    await shot.mouse.move(250, 200); await shot.mouse.down(); await shot.mouse.move(800, 600, { steps: 5 }); await shot.mouse.up(); await shot.keyboard.press('Enter');
    await shot.locator('.capture-workspace').waitFor();
    const cases = [
        ['translate', translate, '.h-screen.w-screen.relative'], ['config', config, '.forge-window-background'],
        ['recognize', recognize, '.forge-window-background'], ['updater', updater, '.forge-window-background'],
        ['pin-history', history, '.h-screen'], ['screenshot-editor', shot, '.capture-tools,.capture-properties,.capture-workspace,.capture-object-actions,.capture-footer'],
    ];
    report.windows = [...cases.map(x => x[0]), 'panel', pinLabel, 'capture-selection'];
    for (const [name, p] of cases) p.on('pageerror', e => report.errors.push(`${name}: ${e.message}`));
    for (const value of [0.15, 0.5, 1]) {
        await invoke(config, 'set_window_opacity', { opacity: value });
        for (const [name, p, selector] of cases) { await backgrounds(p, selector, value); pass(`${name} background at ${value}`); }
        await backgrounds(config, '.forge-config .bg-content1', value);
        assert.equal(await shot.locator('canvas').evaluate(c => getComputedStyle(c).opacity), '1');
        assert.equal(await pin.locator('img').evaluate(i => getComputedStyle(i).opacity), '1');
    }
    pass('settings cards follow opacity while screenshot pixels and pinned image remain unchanged');
    const slider = config.getByRole('slider', { name: 'Window background opacity (text stays solid)', exact: true });
    await slider.press('Home');
    await sliderValue(translate.getByRole('slider', { name: 'window opacity', exact: true }), 0.15);
    assert.equal(await invoke(config, 'get_window_opacity'), 0.15); pass('settings slider persists immediately and syncs the translate slider');
    await translate.getByRole('slider', { name: 'window opacity', exact: true }).press('End');
    await sliderValue(slider, 1);
    pass('translate slider syncs settings');
    const toggle = config.locator('.config-item').filter({ has: config.getByRole('heading', { name: 'Transparent Effect', exact: true }) }).getByRole('switch');
    await invoke(config, 'set_window_opacity', { opacity: 0.25 }); await toggle.press('Space');
    for (const [, p, selector] of cases) await backgrounds(p, selector, 1);
    assert.ok(await slider.isDisabled()); assert.ok(await translate.getByRole('slider', { name: 'window opacity', exact: true }).isDisabled());
    pass('master switch restores opaque backgrounds and disables inactive sliders');
    await toggle.press('Space'); for (const [, p, selector] of cases) await backgrounds(p, selector, 0.25);
    pass('re-enabling transparency restores the saved value');
    const panelSlider = panel.getByRole('slider', { name: 'panel opacity', exact: true });
    await panelSlider.press('Home'); await backgrounds(panel, '.forge-panel', 0.05);
    await panelSlider.press('ArrowRight'); await backgrounds(panel, '.forge-panel', 0.1);
    assert.ok(Math.abs((await invoke(panel, 'get_panel_settings')).opacity - 0.1) < 0.001);
    await panel.reload(); await backgrounds(panel, '.forge-panel', 0.1); pass('panel slider persists independently across reload');
    await invoke(panel, 'set_panel_settings', { patch: { hoverBoost: true } });
    await panel.reload(); await panel.locator('.forge-panel').waitFor();
    await panel.mouse.move(20, 20); await backgrounds(panel, '.forge-panel', 0.3);
    await panel.mouse.move(-20, -20); await backgrounds(panel, '.forge-panel', 0.1);
    pass('panel hover boost increases opacity and restores the saved base on leave');
    await invoke(panel, 'set_panel_settings', { patch: { hoverBoost: false } }); await panel.reload();
    const pinSlider = pin.getByRole('slider', { name: 'Opacity', exact: true });
    await pinSlider.press('Home'); await pin.waitForFunction(() => getComputedStyle(document.querySelector('img')).opacity === '0.15');
    await pinSlider.press('ArrowRight'); await pin.waitForFunction(() => getComputedStyle(document.querySelector('img')).opacity === '0.2');
    const backgroundsBehindPin = await pin.locator('img').evaluate(img => { const colors = []; for (let e = img.parentElement; e; e = e.parentElement) colors.push(getComputedStyle(e).backgroundColor); return colors; });
    assert.ok(backgroundsBehindPin.every(c => alpha(c) === 0)); pass('pin opacity reveals the desktop rather than a black backing', { backgroundsBehindPin });
    await invoke(config, 'set_window_opacity', { opacity: 0.65 }); await backgrounds(panel, '.forge-panel', 0.1);
    assert.equal(await pin.locator('img').evaluate(i => getComputedStyle(i).opacity), '0.2'); pass('global opacity does not overwrite panel or individual pin values');
    await pin.getByRole('button', { name: 'Reset', exact: true }).click(); await pin.waitForFunction(() => getComputedStyle(document.querySelector('img')).opacity === '1'); pass('pin Reset restores full image opacity');
    await invoke(daemon, 'plugin:window|close', { label: 'config' });
    if (!config.isClosed()) await config.waitForEvent('close', { timeout: 5000 });
    await fetch('http://127.0.0.1:60829/config', { method: 'POST' }); config = await page('config');
    await backgrounds(config, '.forge-window-background', 0.65); pass('reopened settings restore persisted global opacity');
    // Hide other surfaces and use an owned webview as a deterministic blue backing.
    for (const [label, p] of [['translate', translate], ['recognize', recognize], ['updater', updater], ['screenshot', shot], ['panel', panel], [pinLabel, pin]]) await invoke(p, 'plugin:window|hide', { label });
    await history.evaluate(() => { document.body.innerHTML = '<div style="position:fixed;inset:0;background:rgb(0,40,255)"></div>'; });
    await position(history, 'pin-history', 600, 300, 1000, 750, true);
    await position(config, 'config', 650, 350, 800, 600);
    const samples = [];
    for (const value of [0.25, 0.75, 1]) {
        await invoke(config, 'set_window_opacity', { opacity: value }); await backgrounds(config, '.forge-window-background', value); await sleep(120);
        const pixel = await sample(config, 'config', { x: 234, y: 240 }); samples.push({ value, pixel });
    }
    assert.ok(samples[0].pixel[0] + 60 < samples[1].pixel[0] && samples[1].pixel[0] < samples[2].pixel[0]);
    pass('real desktop pixels track window background opacity', { samples });
    await invoke(config, 'plugin:window|hide', { label: 'config' }); await position(pin, pinLabel, 800, 450);
    const pinSamples = [];
    for (const value of [1, 0.15]) {
        await pinSlider.press(value === 1 ? 'End' : 'Home'); await pin.waitForFunction(v => Number(getComputedStyle(document.querySelector('img')).opacity) === v, value); await sleep(120);
        const point = await pin.locator('img').evaluate(i => { const b = i.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
        pinSamples.push({ value, pixel: await sample(pin, pinLabel, point) });
    }
    assert.ok(pinSamples[0].pixel[0] > 230 && pinSamples[1].pixel[0] < 100 && pinSamples[1].pixel[2] > 150);
    pass('real pinned-image pixels reveal the window underneath', { samples: pinSamples });
    assert.deepEqual(report.errors, []); assert.equal(sourceIdentity().fingerprint, report.source.fingerprint); report.status = 'pass';
}
main().catch(error => { report.status = 'fail'; report.failure = error.stack; process.exitCode = 1; })
    .finally(async () => { fs.writeFileSync(output, JSON.stringify(report, null, 2)); console.log(`Report: ${output}`); await browser?.close(); });
