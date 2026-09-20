import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PROVIDERS } from '../../src/services/provider-status.js';

function exportedIds(source) {
    return [...source.matchAll(/^export const (\w+)/gm)].map((match) => match[1]);
}

test('provider catalog records prerequisites without claiming execution', () => {
    assert.equal(PROVIDERS.length, 40);
    const ids = new Set();
    for (const provider of PROVIDERS) {
        assert.ok(provider.id, 'provider id');
        assert.ok(['translate', 'recognize', 'tts', 'collection'].includes(provider.kind), provider.id);
        assert.ok(['local', 'network', 'requires_setup'].includes(provider.availability), provider.id);
        assert.equal(provider.testStatus, 'not_run', provider.id);
        assert.ok(provider.reason, provider.id);
        assert.equal(ids.has(provider.id), false, `duplicate ${provider.id}`);
        ids.add(provider.id);
    }
});

test('provider catalog matches service index exports', async () => {
    const translate = exportedIds(await readFile(new URL('../../src/services/translate/index.jsx', import.meta.url), 'utf8'));
    const recognize = exportedIds(await readFile(new URL('../../src/services/recognize/index.jsx', import.meta.url), 'utf8'));
    const tts = exportedIds(await readFile(new URL('../../src/services/tts/index.jsx', import.meta.url), 'utf8'));
    const collection = exportedIds(await readFile(new URL('../../src/services/collection/index.jsx', import.meta.url), 'utf8'));
    const expected = [...translate, ...recognize, ...tts, ...collection];
    assert.equal(expected.length, 40);
    const catalog = PROVIDERS.map((provider) => provider.id).sort();
    assert.deepEqual(catalog, [...expected].sort());
});
