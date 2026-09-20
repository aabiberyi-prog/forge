import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolveCases, assertReleaseReady } from '../acceptance.mjs';

const ledger = JSON.parse(readFileSync(new URL('../../docs/ACCEPTANCE.json', import.meta.url), 'utf8'));
const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const release = readFileSync(new URL('../../.github/workflows/windows-release.yml', import.meta.url), 'utf8');

test('acceptance derives pass/fail/not_run from executed results', () => {
    const contract = { cases: [{ id: 'check', layer: 'unit', required: true, evidence: ['first', 'second'] }] };
    assert.equal(resolveCases(contract, [])[0].status, 'not_run');
    assert.equal(resolveCases(contract, [{ name: 'first', status: 'pass' }, { name: 'second', status: 'skip' }])[0].status, 'not_run');
    assert.equal(resolveCases(contract, [{ name: 'first', status: 'fail' }])[0].status, 'fail');
    assert.equal(resolveCases(contract, [{ name: 'first', status: 'pass' }, { name: 'module::second', status: 'pass' }])[0].status, 'pass');
    assert.ok(ledger.cases.filter((item) => item.layer === 'unit' && item.required).every((item) => item.status === 'pending'));
});

test('release acceptance rejects missing desktop evidence and source mismatch', () => {
    const identity = { head: 'a'.repeat(40), fingerprint: 'b'.repeat(64), dirty: false };
    const report = { source: identity, cases: [{ id: 'desktop', required: true, layer: 'desktop', status: 'blocked' }] };
    assert.throws(() => assertReleaseReady(report, identity), /incomplete/);
    report.cases[0].status = 'pass';
    assert.throws(() => assertReleaseReady(report, identity), /evidence/);
    report.cases[0].evidence = 'native-run'; report.cases[0].candidateSha256 = 'c'.repeat(64);
    assert.throws(() => assertReleaseReady(report, identity), /artifact/);
    report.candidate = { path: 'candidate.exe', sha256: 'c'.repeat(64), sourceFingerprint: identity.fingerprint };
    assertReleaseReady(report, identity);
    assert.throws(() => assertReleaseReady(report, { ...identity, fingerprint: 'd'.repeat(64) }), /source/);
});

test('CI records execution evidence and publication requires native acceptance', () => {
    assert.match(ci, /pnpm verify:ci/);
    assert.doesNotMatch(ci, /action-gh-release/);
    assert.match(release, /needs: verify/);
    assert.match(release, /check-release-acceptance.mjs/);
});

test('review build has an independent identity and no updater endpoint', () => {
    const main = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
    const review = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.review.conf.json', import.meta.url), 'utf8'));
    assert.notEqual(review.identifier, main.identifier);
    assert.notEqual(review.productName, main.productName);
    assert.deepEqual(review.plugins.updater.endpoints, []);
    assert.equal(review.bundle.createUpdaterArtifacts, false);
});
