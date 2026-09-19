// Explicit opt-in: no app/profile/server operation occurs without --run.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');

const repo = path.resolve(__dirname, '../..');
const binary = 'C:\\cargo-target\\forge\\native-http\\f025725010f6\\forge-migration-check.exe';
// This fingerprint belongs to the build with the isolated identifier, not the installed app.
const expectedHash = 'f025725010f62bfffebedc49171e146158685702d9ce13c2480abbb8488dc08a';
const profileId = 'com.aabiber.forge-migration-check';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let interrupted = false;

function credentialCheck(value, location = 'profile') {
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
        if (/api.?key|password|secret|token/i.test(key) && typeof entry === 'string' && entry && entry !== 'fixture-only') {
            throw new Error(`Non-fixture credential field at ${location}.${key}; profile will not be modified.`);
        }
        credentialCheck(entry, `${location}.${key}`);
    }
}

function owners(port) {
    const command = `@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess) | ConvertTo-Json -Compress`;
    const output = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
        encoding: 'utf8', windowsHide: true, timeout: 10000,
    }).trim();
    return output ? [].concat(JSON.parse(output)) : [];
}

async function waitFor(check, description, timeout = 45000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (interrupted) throw new Error('Manual test interrupted; cleaning up.');
        if (check()) return;
        await delay(500);
    }
    throw new Error(`Timed out: ${description}`);
}

function launch(executable, args, environment, logPrefix) {
    const out = fs.openSync(`${logPrefix}.stdout.log`, 'wx');
    const err = fs.openSync(`${logPrefix}.stderr.log`, 'wx');
    try {
        const child = spawn(executable, args, { cwd: repo, env: environment, windowsHide: true, stdio: ['ignore', out, err] });
        child.on('error', (error) => { child.launchError = error; });
        return child;
    } finally {
        fs.closeSync(out);
        fs.closeSync(err);
    }
}

async function stop(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
    const exited = once(child, 'exit');
    // Terminate only this child handle. Avoid the app's legacy global helper shutdown hook.
    child.kill();
    await Promise.race([exited, delay(5000).then(() => { throw new Error(`Child ${child.pid} did not exit`); })]);
}

const readHistory = String.raw`
import json, pathlib, sqlite3, sys
p = pathlib.Path(sys.argv[1])
rows = []
if p.exists():
    try:
        with sqlite3.connect(p.as_uri() + '?mode=ro', uri=True, timeout=1) as db:
            rows = db.execute('SELECT text, result FROM history WHERE text = ?', (sys.argv[2],)).fetchall()
    except sqlite3.OperationalError:
        pass
print(json.dumps(rows))
`;

async function run() {
    if (process.platform !== 'win32') throw new Error('This manual native test requires Windows.');
    const digest = crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex');
    if (digest !== expectedHash) throw new Error('Isolated executable fingerprint changed. Ask for a refreshed test runner before running it.');
    execFileSync('py.exe', ['-3.12', '-c', 'import sqlite3'], { windowsHide: true, timeout: 10000 });
    const profileDir = path.join(process.env.APPDATA, profileId);
    const profile = path.join(profileDir, 'config.json');
    const normalize = (file) => fs.realpathSync.native(file).toLowerCase();
    const permittedDirectories = [path.join(normalize(process.env.APPDATA), profileId).toLowerCase()];
    // MSIX virtualizes this known folder without creating a filesystem symlink.
    // Admit only the observed Codex package cache and the same isolated app ID.
    const packageRoaming = path.join(process.env.LOCALAPPDATA, 'Packages', 'OpenAI.Codex_2p2nqsd0c76g0', 'LocalCache', 'Roaming');
    if (fs.existsSync(packageRoaming)) permittedDirectories.push(path.join(normalize(packageRoaming), profileId).toLowerCase());
    const actualDirectory = normalize(profileDir);
    if (!permittedDirectories.includes(actualDirectory) || fs.lstatSync(profileDir).isSymbolicLink() || fs.lstatSync(profile).isSymbolicLink() || normalize(profile) !== path.join(actualDirectory, 'config.json')) {
        throw new Error('The isolated profile is redirected; refusing to modify it.');
    }
    const original = fs.readFileSync(profile, 'utf8');
    const baseline = JSON.parse(original.replace(/^\uFEFF/, ''));
    credentialCheck(baseline);
    for (const port of [60829, 60830]) if (owners(port).length) throw new Error(`Port ${port} is occupied; no process will be replaced.`);

    const outputRoot = path.join(os.tmpdir(), 'forge-native-http-manual');
    fs.mkdirSync(outputRoot, { recursive: true });
    const lock = path.join(outputRoot, 'run.lock');
    const lockHandle = fs.openSync(lock, 'wx');
    const id = crypto.randomUUID();
    const output = path.join(outputRoot, id);
    const result = { id, profileId, binary, binarySHA256: digest, status: 'running', cases: [], profileRestored: false, cleanupErrors: [] };
    fs.writeFileSync(lockHandle, JSON.stringify({ pid: process.pid, id, profileId }));
    const interrupt = () => { interrupted = true; console.log('Stopping the test and restoring the isolated profile...'); };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    let app;
    let fixture;
    let profileTouched = false;
    try {
        fs.mkdirSync(output);
        fs.mkdirSync(path.join(output, 'local'));
        fs.writeFileSync(path.join(output, 'profile-before.json'), original, { flag: 'wx' });
        const requestsFile = path.join(output, 'requests.ndjson');
        fixture = launch(process.execPath, [path.join(__dirname, 'openai-fixture.cjs'), requestsFile], process.env, path.join(output, 'fixture'));
        result.fixturePid = fixture.pid;
        await waitFor(() => {
            if (fixture.launchError || fixture.exitCode !== null || fixture.signalCode !== null) throw new Error('Fixture server failed; see fixture logs.');
            return owners(60830).includes(fixture.pid);
        }, 'fixture startup');

        const environment = { ...process.env };
        for (const key of Object.keys(environment)) {
            if (['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'].includes(key.toUpperCase())) delete environment[key];
        }
        Object.assign(environment, {
            LOCALAPPDATA: path.join(output, 'local'),
            WEBVIEW2_USER_DATA_FOLDER: path.join(output, 'webview'),
            NO_PROXY: '127.0.0.1,localhost',
        });
        console.log('Running two isolated cases. Leave test windows alone; this runner closes its own processes.');
        for (const stream of [false, true]) {
            if (interrupted) throw new Error('Manual test interrupted.');
            const name = stream ? 'SSE' : 'JSON';
            const text = `FORGE_NATIVE_${name}_${id}`;
            const expected = stream ? '流式通过_7319' : 'FORGE_JSON_OK_7319';
            const entry = { name, text, expected, passed: false };
            result.cases.push(entry);
            try {
                const settings = {
                    ...baseline, server_port: 60829, check_update: false, clipboard_monitor: false,
                    translate_auto_copy: 'disable', translate_close_on_blur: false, translate_hide_window: false,
                    history_disable: false, translate_detect_engine: 'local', translate_service_list: ['openai'],
                    recognize_service_list: ['system'], hotkey_selection_translate: '', hotkey_input_translate: '',
                    hotkey_ocr_recognize: '', hotkey_ocr_translate: '',
                    openai: {
                        instanceName: 'Local fixture', enable: 'true', service: 'openai', requestPath: 'http://127.0.0.1:60830',
                        apiKey: 'fixture-only', model: 'fixture', stream, promptList: [{ role: 'user', content: '$text' }], requestArguments: '{}',
                    },
                };
                profileTouched = true;
                fs.writeFileSync(profile, JSON.stringify(settings, null, 2));
                app = launch(binary, [], environment, path.join(output, name));
                entry.appPid = app.pid;
                await waitFor(() => {
                    if (app.launchError || app.exitCode !== null || app.signalCode !== null) throw new Error('Isolated app failed; see case logs.');
                    return owners(60829).includes(app.pid);
                }, `${name} app startup`);
                const response = await fetch('http://127.0.0.1:60829/translate', {
                    method: 'POST', body: text, headers: { 'Content-Type': 'text/plain' }, signal: AbortSignal.timeout(10000),
                });
                if (!response.ok) throw new Error(`App input returned HTTP ${response.status}`);
                // Python does not inherit Node's MSIX virtual path view; use the verified physical directory.
                const history = () => JSON.parse(execFileSync('py.exe', ['-3.12', '-c', readHistory, path.join(actualDirectory, 'history.db'), text], {
                    encoding: 'utf8', windowsHide: true, timeout: 5000,
                }));
                await waitFor(() => history().some((row) => row[1] === expected), `${name} history result`);
                await stop(app);
                app = undefined;
                entry.history = history();
                const requests = fs.readFileSync(requestsFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((request) => request.text === text);
                entry.requestCount = requests.length;
                entry.originAbsent = requests.every((request) => request.originAbsent);
                entry.passed = entry.history.length === 1 && requests.length === 1 && requests[0].stream === stream && entry.originAbsent;
                if (!entry.passed) throw new Error('Duplicate execution or unexpected request metadata; see result file.');
                console.log(`${name}: PASS`);
            } catch (error) {
                entry.error = error.message;
                console.log(`${name}: FAIL — ${error.message}`);
            } finally {
                await stop(app);
                app = undefined;
            }
        }
        result.status = result.cases.every((entry) => entry.passed) ? 'passed' : 'failed';
    } catch (error) {
        result.status = 'failed';
        result.error = error.message;
    } finally {
        for (const child of [app, fixture]) {
            try { await stop(child); } catch (error) { result.cleanupErrors.push(error.message); }
        }
        const appStopped = !app || !app.pid || app.exitCode !== null || app.signalCode !== null;
        const fixtureStopped = !fixture || !fixture.pid || fixture.exitCode !== null || fixture.signalCode !== null;
        if (profileTouched && appStopped) {
            try { fs.writeFileSync(profile, original); result.profileRestored = fs.readFileSync(profile, 'utf8') === original; }
            catch (error) { result.cleanupErrors.push(error.message); }
        } else if (!profileTouched) result.profileRestored = true;
        else result.cleanupErrors.push('Profile was not restored because the owned app may still be running.');
        if (result.cleanupErrors.length || !result.profileRestored) result.status = 'failed';
        fs.closeSync(lockHandle);
        const serialized = JSON.stringify(result, null, 2);
        if (fs.existsSync(output)) fs.writeFileSync(path.join(output, 'result.json'), serialized);
        fs.writeFileSync(path.join(outputRoot, 'latest-result.json'), serialized);
        if (appStopped && fixtureStopped) fs.unlinkSync(lock);
        else console.log(`Cleanup needs attention; lock retained at ${lock}`);
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', interrupt);
        console.log(`Result: ${path.join(outputRoot, 'latest-result.json')}`);
        console.log(`Logs: ${output}`);
    }
    if (result.status !== 'passed') process.exitCode = 1;
}

module.exports = { binary, expectedHash, credentialCheck, owners, launch, stop, readHistory };

if (require.main === module) {
    if (process.argv.length === 3 && process.argv[2] === '--run') {
        run().catch((error) => { console.error(error.message); process.exitCode = 1; });
    } else {
        console.log('Manual Windows test: node .scripts/tests/run-native-http.cjs --run');
        console.log('Uses only the fingerprinted isolated build, its test profile, and loopback ports 60829/60830.');
        console.log('No app, profile, or server operation occurs without --run.');
    }
}
