// Interactive native acceptance: commands arrive over this process's stdin.
// Credentials are read from the installed app only into the isolated app config;
// they are never printed or placed in reports, backups, or source control.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { execFileSync } = require('node:child_process');
const { binary, expectedHash, credentialCheck, owners, launch, stop, readHistory } = require('./run-native-http.cjs');

async function main() {
    const hotkeys = process.argv.includes('--hotkeys');
    const pluginOnly = process.argv.includes('--plugin-only');
    const port = hotkeys ? 60828 : 60829;
    if (crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex') !== expectedHash) throw new Error('Candidate fingerprint changed');
    if (owners(port).length) throw new Error('Isolated test port is occupied');
    if (pluginOnly && owners(60830).length) throw new Error('Fixture port is occupied');
    const profileId = 'com.aabiber.forge-migration-check';
    const nominal = path.join(process.env.APPDATA, profileId);
    const physical = fs.realpathSync.native(nominal);
    const allowed = [path.join(fs.realpathSync.native(process.env.APPDATA), profileId), path.join(process.env.LOCALAPPDATA, 'Packages', 'OpenAI.Codex_2p2nqsd0c76g0', 'LocalCache', 'Roaming', profileId)];
    if (!allowed.some(p => p.toLowerCase() === physical.toLowerCase()) || fs.lstatSync(nominal).isSymbolicLink()) throw new Error('Unexpected test profile path');
    const profile = path.join(physical, 'config.json');
    if (fs.lstatSync(profile).isSymbolicLink()) throw new Error('Unexpected test profile link');
    const original = fs.readFileSync(profile, 'utf8');
    const baseline = JSON.parse(original.replace(/^\uFEFF/, ''));
    credentialCheck(baseline);
    const installedPath = path.join(process.env.APPDATA, 'com.aabiber.pot-forge', 'config.json');
    const installed = JSON.parse(fs.readFileSync(installedPath, 'utf8'));
    const id = crypto.randomUUID();
    const root = path.join(os.tmpdir(), 'forge-live-acceptance');
    fs.mkdirSync(root, { recursive: true });
    const lock = path.join(root, 'run.lock');
    const fd = fs.openSync(lock, 'wx');
    const directory = path.join(root, id);
    const launchPath = path.join(directory, hotkeys ? 'Pot Forge.exe' : 'forge-migration-check.exe');
    const result = { id, directory, profileId, checks: [], profileRestored: false, cleanupErrors: [] };
    fs.writeFileSync(fd, JSON.stringify({ id, pid: process.pid }));
    let app;
    let fixture;
    const lines = readline.createInterface({ input: process.stdin });
    const interrupt = () => lines.close();
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    try {
        fs.mkdirSync(directory);
        fs.copyFileSync(binary, launchPath);
        fs.mkdirSync(path.join(directory, 'local'));
        fs.writeFileSync(path.join(directory, 'profile-before.json'), original, { flag: 'wx' });
        const settings = {
            ...baseline, app_language: installed.app_language, server_port: port, check_update: false,
            clipboard_monitor: false, translate_auto_copy: 'disable', translate_hide_window: false,
            translate_close_on_blur: false, history_disable: false, translate_detect_engine: 'local',
            translate_service_list: pluginOnly ? [] : installed.translate_service_list, recognize_service_list: ['system'],
            tts_service_list: ['edge_tts'], edge_tts: installed.edge_tts, tts_volume: installed.tts_volume,
            hotkey_selection_translate: '', hotkey_input_translate: '', hotkey_ocr_recognize: '', hotkey_ocr_translate: hotkeys ? installed.hotkey_ocr_translate : '',
            proxy_enable: false,
        };
        for (const key of settings.translate_service_list) settings[key] = installed[key];
        fs.writeFileSync(profile, JSON.stringify(settings, null, 2));
        if (pluginOnly) {
            fixture = launch(process.execPath, [path.join(__dirname, 'openai-fixture.cjs'), path.join(directory, 'requests.ndjson')], process.env, path.join(directory, 'fixture'));
            result.fixturePid = fixture.pid;
        }
        const environment = { ...process.env, LOCALAPPDATA: path.join(directory, 'local'), WEBVIEW2_USER_DATA_FOLDER: path.join(directory, 'webview') };
        // Keep the configured helper dependency discoverable while disabling selection-helper startup.
        environment.EDGE_TTS_PATH = path.join(process.env.LOCALAPPDATA, 'hermes', 'hermes-agent', 'venv', 'Scripts', 'edge-tts.exe');
        result.binary = fs.realpathSync.native(launchPath);
        app = launch(result.binary, [], environment, path.join(directory, 'app'));
        result.appPid = app.pid;
        for (let i = 0; i < 30; i++) {
            if (app.launchError || app.exitCode !== null || app.signalCode !== null) throw new Error('Test app did not start');
            if (owners(port).includes(app.pid)) break;
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (!owners(port).includes(app.pid)) throw new Error('Test app port ownership was not confirmed');
        const address = `http://127.0.0.1:${port}`;
        await fetch(`${address}/config`, { signal: AbortSignal.timeout(5000) });
        console.log(JSON.stringify({ ready: true, id, appPid: app.pid, directory, commands: ['translate <text>', 'history <text>', 'config', 'record <json>', 'stop'] }));
        for await (const line of lines) {
            if (line === 'stop') break;
            try {
                if (line === 'config') {
                    await fetch(`${address}/config`, { signal: AbortSignal.timeout(5000) });
                    console.log('Config requested');
                } else if (line.startsWith('translate ')) {
                    const text = line.slice(10);
                    const response = await fetch(`${address}/translate`, { method: 'POST', body: text, signal: AbortSignal.timeout(10000) });
                    console.log(JSON.stringify({ submitted: response.ok, text }));
                } else if (line.startsWith('history ')) {
                    const text = line.slice(8);
                    const rows = JSON.parse(execFileSync('py.exe', ['-3.12', '-c', readHistory, path.join(physical, 'history.db'), text], { encoding: 'utf8', windowsHide: true }));
                    result.checks.push({ type: 'history', text, rows });
                    console.log(JSON.stringify({ text, rows }));
                } else if (line.startsWith('record ')) {
                    const entry = JSON.parse(line.slice(7));
                    credentialCheck(entry);
                    result.checks.push(entry);
                    console.log('Recorded');
                } else console.log('Unknown command');
            } catch (error) { console.log(JSON.stringify({ commandFailed: error.message })); }
        }
    } finally {
        lines.close();
        try { await stop(app); } catch (error) { result.cleanupErrors.push(error.message); }
        try { await stop(fixture); } catch (error) { result.cleanupErrors.push(error.message); }
        // A GUI relaunch changes PID. The per-run executable path still identifies only this test's processes.
        let remaining = false;
        if (result.binary) {
            const target = result.binary.replaceAll("'", "''");
            try {
                const cleanup = `$owned = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${target}' }); $owned | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }; Start-Sleep -Milliseconds 300; @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${target}' }).Count`;
                remaining = Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cleanup], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim()) !== 0;
            } catch (error) { remaining = true; result.cleanupErrors.push(error.message); }
        }
        if (!remaining && (!app || !app.pid || app.exitCode !== null || app.signalCode !== null)) {
            fs.writeFileSync(profile, original);
            result.profileRestored = fs.readFileSync(profile, 'utf8') === original;
        } else result.cleanupErrors.push('App still running; profile restore deferred');
        fs.closeSync(fd);
        fs.writeFileSync(path.join(root, 'latest-result.json'), JSON.stringify(result, null, 2));
        if (fs.existsSync(directory)) fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
        if (result.profileRestored && result.cleanupErrors.length === 0) fs.unlinkSync(lock);
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', interrupt);
        console.log(JSON.stringify({ profileRestored: result.profileRestored, cleanupErrors: result.cleanupErrors, result: path.join(root, 'latest-result.json') }));
    }
}
if (process.argv[2] === '--run') main().catch(error => { console.error(error.message); process.exitCode = 1; });
else console.log('Run with --run to open the isolated native acceptance session.');
