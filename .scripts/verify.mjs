import { globSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sourceIdentity } from './source-identity.mjs';
import { resolveCases } from './acceptance.mjs';

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--out');
const output = outputIndex >= 0 ? args[outputIndex + 1] : path.join(tmpdir(), `forge-verification-${Date.now()}`, 'result.json');
if (!output) throw new Error('--out requires a path');
const source = sourceIdentity();
const files = globSync('*.test.mjs', { cwd: '.scripts/tests' }).sort().map((file) => path.join('.scripts/tests', file));
const scratch = path.join(tmpdir(), `forge-test-data-${Date.now()}`);
mkdirSync(scratch, { recursive: true });
const env = { ...process.env, TEMP: scratch, TMP: scratch, FORGE_LIVE_IMPORT: '0', FORGE_LIVE_IMPORT_APPLY: '0', CARGO_TERM_COLOR: 'never' };
if (process.platform === 'win32' && !env.CARGO_TARGET_DIR) env.CARGO_TARGET_DIR = 'C:\\cargo-target\\forge';
const js = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', '--test-reporter=tap', ...files], { encoding: 'utf8', env, maxBuffer: 20 * 1024 * 1024, windowsHide: true });
process.stdout.write(js.stdout || ''); process.stderr.write(js.stderr || '');
const rustArgs = ['test', '--locked', ...(!process.env.CI ? ['--offline'] : []), '--manifest-path', 'src-tauri/Cargo.toml', '--', '--skip', 'live_profile_merge_from_desktop_todo'];
if (!args.includes('--keychain')) rustArgs.push('--skip', 'keychain_roundtrip_uses_isolated_name');
const rust = spawnSync('cargo', rustArgs, { encoding: 'utf8', env, maxBuffer: 20 * 1024 * 1024, windowsHide: true });
process.stdout.write(rust.stdout || ''); process.stderr.write(rust.stderr || '');
const results = [];
for (const match of (js.stdout || '').matchAll(/^(not ok|ok) \d+ - (.+?)(?: # (SKIP|TODO).*)?\r?$/gm)) {
    results.push({ name: match[2], status: match[3] ? 'skip' : match[1] === 'ok' ? 'pass' : 'fail' });
}
for (const match of (rust.stdout || '').matchAll(/^test (\S+) \.\.\. (ok|FAILED|ignored[^\r\n]*)/gm)) {
    results.push({ name: match[1], status: match[2] === 'ok' ? 'pass' : match[2] === 'FAILED' ? 'fail' : 'skip' });
}
const ledger = JSON.parse(readFileSync('docs/ACCEPTANCE.json', 'utf8'));
const cases = resolveCases(ledger, results);
const after = sourceIdentity();
const report = { createdAt: new Date().toISOString(), source, unchangedDuringTests: after.fingerprint === source.fingerprint,
    suites: { javascriptExit: js.status, rustExit: rust.status }, results, cases,
    releaseReady: cases.filter((item) => item.required).every((item) => item.status === 'pass') && !source.dirty };
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2));
console.log(`Verification report: ${output}`);
if (js.error) console.error(js.error.message);
if (rust.error) console.error(rust.error.message);
process.exitCode = js.status !== 0 || rust.status !== 0 || !results.length || !report.unchangedDuringTests ? 1 : 0;
