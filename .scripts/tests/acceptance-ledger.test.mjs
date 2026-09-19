import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ledger = JSON.parse(readFileSync(new URL('../../docs/ACCEPTANCE.json', import.meta.url), 'utf8'));
const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const release = readFileSync(new URL('../../.github/workflows/windows-release.yml', import.meta.url), 'utf8');
const tauri = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));

function counts(cases) {
    return cases.reduce(
        (acc, item) => {
            acc[item.status] = (acc[item.status] || 0) + 1;
            return acc;
        },
        { pass: 0, skip: 0, blocked: 0 }
    );
}

test('acceptance ledger never counts skip or blocked as pass', () => {
    assert.equal(ledger.productVersion, tauri.version);
    assert.equal(ledger.identifier, tauri.identifier);
    for (const item of ledger.cases) {
        assert.ok(['pass', 'skip', 'blocked'].includes(item.status), item.id);
        assert.notEqual(item.status, 'failed');
    }
    const requiredUnit = ledger.cases.filter((item) => item.required && item.layer === 'unit');
    assert.ok(requiredUnit.length >= 20, 'need a meaningful unit gate');
    for (const item of requiredUnit) {
        assert.equal(item.status, 'pass', item.id);
    }
    const requiredDesktop = ledger.cases.filter((item) => item.required && item.layer === 'desktop');
    for (const item of requiredDesktop) {
        assert.notEqual(item.status, 'pass', `${item.id} cannot pass without an isolated candidate`);
        assert.equal(item.status, 'blocked', item.id);
    }
    const tally = counts(ledger.cases);
    assert.equal(tally.pass + tally.skip + tally.blocked, ledger.cases.length);
    assert.ok(tally.skip >= 1, 'OS01 or unselected groups must stay skip');
    assert.ok(tally.blocked >= 1, 'unsigned desktop cases stay blocked');
    assert.notEqual(tally.pass, ledger.cases.length);
});

test('CI runs regression tests and does not publish', () => {
    assert.match(ci, /pnpm test/);
    assert.match(ci, /cargo test --manifest-path src-tauri\/Cargo\.toml/);
    assert.doesNotMatch(ci, /action-gh-release/);
    assert.doesNotMatch(ci, /Pylogmon\.pot/);
    assert.match(release, /needs: verify/);
});

test('candidate identity is this git HEAD and is not a live install path', () => {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
    assert.match(sha, /^[0-9a-f]{40}$/);
    assert.ok(branch.length > 0);
    assert.notEqual(branch, '');
    assert.doesNotMatch(sha, /D:\\\\Pot Forge/i);
});
