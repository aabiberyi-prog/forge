import assert from 'node:assert/strict';
import fs from 'fs';
import test from 'node:test';

const windows = JSON.parse(fs.readFileSync('src-tauri/tauri.windows.conf.json', 'utf8'));
const tauri = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/windows-release.yml', 'utf8');
const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
const packageWorkflow = fs.readFileSync('.github/workflows/package.yml', 'utf8');
const updater = fs.readFileSync('updater/updater.mjs', 'utf8');
const fromArtifacts = fs.readFileSync('updater/from-artifacts.mjs', 'utf8');
const migration = fs.readFileSync('docs/MIGRATION.md', 'utf8');

test('NSIS installer is per-machine with a Forge start menu folder', () => {
    assert.equal(windows.bundle.windows.nsis.installMode, 'perMachine');
    assert.equal(windows.bundle.windows.nsis.startMenuFolder, 'Pot Forge');
    assert.equal(windows.bundle.windows.webviewInstallMode.type, 'embedBootstrapper');
});

test('updater endpoint and pubkey stay on Forge', () => {
    assert.deepEqual(tauri.plugins.updater.endpoints, [
        'https://github.com/aabiberyi-prog/forge/releases/download/updater/update.json',
    ]);
    assert.match(tauri.plugins.updater.pubkey, /^dW50cnVzdGVkIGNvbW1lbnQ6/);
});

test('Windows 1.0 workflow builds NSIS with Tauri 2 signing env', () => {
    assert.match(workflow, /tauri build -b nsis/);
    assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY/);
    assert.doesNotMatch(workflow, /TAURI_PRIVATE_KEY[^_]/);
    assert.doesNotMatch(workflow, /Pylogmon\.pot/);
    assert.doesNotMatch(workflow, /pot-app\/pot-docs/);
});

test('CI regression workflow tests without publishing', () => {
    assert.match(ci, /pnpm test/);
    assert.match(ci, /cargo test/);
    assert.doesNotMatch(ci, /action-gh-release/);
    assert.doesNotMatch(ci, /Pylogmon\.pot/);
    assert.match(workflow, /needs: verify/);
});

test('legacy package workflow cannot publish to pot-app', () => {
    assert.match(packageWorkflow, /workflow_dispatch/);
    assert.doesNotMatch(packageWorkflow, /identifier: Pylogmon\.pot/);
    assert.doesNotMatch(packageWorkflow, /pot-app\/homebrew-tap/);
    assert.doesNotMatch(packageWorkflow, /branches: \[master\]/);
});

test('updater manifests use Forge Windows NSIS zip names', () => {
    assert.match(fromArtifacts, /productName = 'Pot Forge'/);
    assert.match(fromArtifacts, /x64-setup\.nsis\.zip/);
    assert.match(updater, /OWNER = 'aabiberyi-prog'/);
    assert.match(updater, /REPO = 'forge'/);
    assert.doesNotMatch(updater, /pot-app\/pot-desktop/);
});

test('migration guide names the three source apps and five ShareX hotkeys', () => {
    assert.match(migration, /com\.pot-app\.desktop/);
    assert.match(migration, /com\.local\.desktop-todo/);
    assert.match(migration, /com\.aabiber\.pot-forge/);
    assert.match(migration, /Alt\+1/);
    assert.match(migration, /Alt\+4/);
    assert.match(migration, /ID merge/);
    assert.match(migration, /FORGE_BACKUP_PROFILE_DIR/);
});
