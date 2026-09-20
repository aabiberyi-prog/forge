// Native Review-only UX regression. No live profile changes or mode/trigger claims.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.FORGE_PLAYWRIGHT_MODULE || 'playwright');
const labels = require(`../../src/i18n/locales/${process.env.FORGE_UX_LANG || 'zh_CN'}.json`).translation.screenshot;
const output = process.env.FORGE_UX_OUTPUT || path.join(os.tmpdir(), 'forge-editor-ux');
fs.mkdirSync(output, { recursive: true });
const report = { createdAt: new Date().toISOString(), checks: [], errors: [], limitation: 'Review native WebView; save mode is injected. Fixture pixels avoid capturing private desktop content in report screenshots. Native drag gestures and complete ShareX parity are not claimed.' };
let browser, context, daemon;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const invoke = (page, cmd, args = {}) => page.evaluate(([name, payload]) => window.__TAURI_INTERNALS__.invoke(name, payload), [cmd, args]);
const button = (page, key) => page.getByRole('button', { name: labels[key], exact: true });
const pass = (name, detail = {}) => { report.checks.push({ name, status: 'pass', ...detail }); console.log(`PASS ${name}`); };
async function findPage(label) {
    for (let count = 0; count < 60; count++) {
        for (const p of context.pages()) {
            if (await p.evaluate(() => window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label).catch(() => '') === label) return p;
        }
        await wait(100);
    }
    throw new Error(`Missing window ${label}`);
}
async function drag(page, from, to) {
    await page.mouse.move(...from); await page.mouse.down(); await page.mouse.move(...to, { steps: 8 }); await page.mouse.up();
}
async function capture() {
    await fetch('http://127.0.0.1:60829/ocr_recognize', { method: 'POST', signal: AbortSignal.timeout(5000) });
    const p = await findPage('screenshot'); p.setDefaultTimeout(5000);
    p.on('pageerror', error => report.errors.push(error.message));
    await p.waitForFunction(() => document.querySelector('img')?.naturalWidth > 0);
    await p.evaluate(() => {
        const c = document.createElement('canvas'); c.width = 3840; c.height = 2160;
        const x = c.getContext('2d'); x.fillStyle = '#f7f8fa'; x.fillRect(0, 0, c.width, c.height);
        x.fillStyle = '#182334'; x.font = '40px Segoe UI'; x.fillText('截图编辑验收 / Sample workspace', 360, 300);
        for (let row = 0; row < 12; row++) {
            x.fillStyle = row % 2 ? '#fff' : '#edf1f5'; x.fillRect(350, 360 + row * 95, 1600, 90);
            x.fillStyle = '#334155'; x.font = '26px Segoe UI'; x.fillText(`测试条目 ${row + 1} · 文字与标注`, 390, 417 + row * 95);
        }
        document.querySelector('img').src = c.toDataURL();
    });
    return p;
}
async function main() {
    const { sourceIdentity } = await import(pathToFileURL(path.resolve(__dirname, '../source-identity.mjs')));
    report.source = sourceIdentity();
    if (process.env.FORGE_REVIEW_BINARY) report.candidateSha256 = crypto.createHash('sha256').update(fs.readFileSync(process.env.FORGE_REVIEW_BINARY)).digest('hex');
    browser = await chromium.connectOverCDP('http://127.0.0.1:19229'); context = browser.contexts()[0];
    daemon = await findPage('daemon'); assert.equal(await invoke(daemon, 'plugin:app|identifier'), 'com.aabiber.pot-forge.review');
    await context.addInitScript(() => {
        const original = window.fetch.bind(window);
        window.fetch = async (input, ...args) => String(input?.url || input).endsWith('/get_capture_mode')
            ? new Response(JSON.stringify('save'), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' } }) : original(input, ...args);
    });
    const p = await capture();
    await p.screenshot({ path: path.join(output, '01-selection.png') });
    await drag(p, [200, 150], [1400, 1050]); await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelector('canvas') && innerWidth === 960);
    pass('Enter confirms the selected region');
    const state = {};
    for (const key of ['is_always_on_top', 'is_resizable', 'is_decorated', 'is_fullscreen']) state[key] = await invoke(p, `plugin:window|${key}`, { label: 'screenshot' });
    assert.deepEqual(state, { is_always_on_top: false, is_resizable: true, is_decorated: true, is_fullscreen: false });
    pass('editor is a normal decorated resizable non-topmost window', state);
    await invoke(p, 'plugin:window|unminimize', { label: 'screenshot' });
    await invoke(p, 'plugin:window|show', { label: 'screenshot' });
    await invoke(p, 'plugin:window|set_position', { label: 'screenshot', value: { Physical: { x: 500, y: 250 } } });
    await invoke(p, 'plugin:window|set_size', { label: 'screenshot', value: { Logical: { width: 1100, height: 780 } } });
    await p.waitForFunction(() => innerWidth === 1100 && innerHeight === 780);
    const position = await invoke(p, 'plugin:window|outer_position', { label: 'screenshot' });
    assert.equal(position.x, 500); assert.equal(position.y, 250);
    pass('native window position and client size change', { position });
    await fetch('http://127.0.0.1:60829/ocr_recognize', { method: 'POST' });
    assert.equal(await invoke(p, 'plugin:window|is_fullscreen', { label: 'screenshot' }), false);
    assert.equal(await invoke(p, 'plugin:window|is_always_on_top', { label: 'screenshot' }), false);
    assert.equal(await p.locator('canvas').count(), 1);
    pass('repeat capture request preserves the editor');
    assert.equal(await p.locator('.capture-properties input,.capture-properties select').count(), 3);
    await button(p, 'tool_blur').click(); assert.equal(await p.locator('.capture-properties input,.capture-properties select').count(), 1);
    await button(p, 'tool_text').click(); assert.equal(await p.locator('.capture-properties input,.capture-properties select').count(), 4);
    pass('rectangle blur and text show only relevant labelled properties');
    const b = await p.locator('canvas').boundingBox(), point = { x: b.x + 130, y: b.y + 160 };
    const textarea = p.getByRole('textbox', { name: labels.edit_text, exact: true });
    await p.mouse.click(point.x, point.y); await textarea.fill('第一版文字'); await button(p, 'tool_text').click();
    await p.mouse.dblclick(point.x + 8, point.y + 5); assert.equal(await textarea.inputValue(), '第一版文字');
    await textarea.fill('第二次修改成功'); await textarea.press('Control+Enter');
    await button(p, 'edit_text').click(); assert.equal(await textarea.inputValue(), '第二次修改成功');
    await p.screenshot({ path: path.join(output, '02-text-edit.png') }); await textarea.press('Control+Enter');
    pass('text reopens by double click and explicit Edit text action');
    await p.getByRole('textbox', { name: labels.font_family, exact: true }).fill('Arial');
    await p.getByRole('textbox', { name: labels.font_family, exact: true }).press('Backspace');
    await button(p, 'edit_text').click(); assert.equal(await textarea.inputValue(), '第二次修改成功'); await textarea.press('Control+Enter');
    pass('editing properties does not delete the selected object');
    await button(p, 'select').click(); await drag(p, [point.x + 8, point.y + 5], [point.x + 68, point.y + 35]);
    await p.mouse.dblclick(point.x + 70, point.y + 37); assert.equal(await textarea.inputValue(), '第二次修改成功'); await textarea.press('Control+Enter');
    pass('text remains editable after moving');
    await button(p, 'duplicate').click(); await button(p, 'layer_forward').click(); await button(p, 'layer_backward').click(); await button(p, 'delete_object').click();
    await button(p, 'select').click(); await p.mouse.dblclick(point.x + 70, point.y + 37); assert.equal(await textarea.inputValue(), '第二次修改成功'); await textarea.press('Control+Enter');
    pass('duplicate layer actions and delete preserve the original object');
    const natural = await p.locator('canvas').evaluate(c => ({ width: c.width, height: c.height }));
    await button(p, 'tool_crop').click(); await drag(p, [b.x + 60, b.y + 70], [b.x + 500, b.y + 340]);
    await p.waitForFunction(w => document.querySelector('canvas').width < w, natural.width);
    await button(p, 'select').click();
    const after = await p.locator('canvas').boundingBox();
    const cropSize = await p.locator('canvas').evaluate(c => ({ width: c.width, height: c.height }));
    const textX = ((130 + 60 - 60) * natural.width / b.width) / cropSize.width;
    const textY = ((160 + 30 - 70) * natural.height / b.height) / cropSize.height;
    await p.mouse.dblclick(after.x + textX * after.width + 5, after.y + textY * after.height + 5);
    assert.equal(await textarea.inputValue(), '第二次修改成功'); await textarea.press('Control+Enter');
    pass('crop retains editable text instead of flattening it');
    await p.screenshot({ path: path.join(output, '03-cropped.png') });
    await p.locator('canvas').focus(); await p.keyboard.press('Escape');
    assert.ok(!p.isClosed()); assert.equal(await button(p, 'delete_object').isDisabled(), true);
    pass('Escape first clears selected object without losing the capture');
    await button(p, 'tool_text').click(); await p.mouse.click(after.x + after.width - 70, after.y + after.height - 50); await textarea.press('Escape');
    await p.mouse.click(after.x + after.width - 70, after.y + after.height - 50);
    assert.equal(await button(p, 'edit_text').count(), 0);
    pass('cancelled new text leaves no invisible empty object');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await p.screenshot({ path: path.join(output, '04-editor.png') });
    pass('toolbars fit inside the window');
    await button(p, 'tool_text').click();
    const historyBefore = new Set((await invoke(daemon, 'list_pin_history')).filter(x => x.source === 'forge').map(x => x.path));
    await p.getByRole('textbox', { name: labels.font_family, exact: true }).press('Control+s');
    if (!p.isClosed()) await p.waitForEvent('close', { timeout: 10000 });
    const added = (await invoke(daemon, 'list_pin_history')).filter(x => x.source === 'forge' && !historyBefore.has(x.path));
    assert.equal(added.length, 1); assert.ok(added[0].exists);
    const pinLabel = await invoke(daemon, 'pin_from_clipboard'), pin = await findPage(pinLabel);
    await pin.waitForFunction(() => document.querySelector('img')?.naturalWidth > 0);
    pass('Ctrl+S from a property input saves records and copies a readable image');
    await invoke(daemon, 'plugin:window|close', { label: pinLabel });
    const cancel = await capture(); await cancel.keyboard.press('Escape');
    if (!cancel.isClosed()) await cancel.waitForEvent('close', { timeout: 5000 });
    pass('Escape cancels capture selection');
    assert.deepEqual(report.errors, []); assert.equal(sourceIdentity().fingerprint, report.source.fingerprint);
    report.status = 'pass';
}
main().catch(error => { report.status = 'fail'; report.failure = error.stack; process.exitCode = 1; })
    .finally(async () => { fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2)); console.log(`Report: ${output}`); await browser?.close(); });
