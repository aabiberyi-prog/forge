import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveWindowOpacity, applyWindowOpacity } from '../../src/utils/window_opacity.js';

test('window background opacity preserves valid values and clamps invalid bounds', () => {
    for (const [input, expected] of [[0.15, 0.15], [0.25, 0.25], [0.92, 0.92], [1, 1], [-1, 0.15], [2, 1]]) {
        assert.equal(effectiveWindowOpacity(input), expected);
    }
    for (const input of [null, undefined, NaN, Infinity, '0.25']) assert.equal(effectiveWindowOpacity(input), 0.92);
});

test('turning off the transparent effect restores an opaque background without changing the saved fraction', () => {
    const saved = 0.25;
    assert.equal(effectiveWindowOpacity(saved, false), 1);
    assert.equal(effectiveWindowOpacity(saved, true), saved);
});

test('opacity synchronization changes only the background variable, never the entire document opacity', () => {
    const properties = new Map([['opacity', '1']]);
    const root = { style: { setProperty: (key, value) => properties.set(key, value) } };
    applyWindowOpacity(root, 0.35, true);
    assert.equal(properties.get('--pot-bg-opacity'), '0.35');
    assert.equal(properties.get('opacity'), '1');
    applyWindowOpacity(root, 0.35, false);
    assert.equal(properties.get('--pot-bg-opacity'), '1');
    assert.equal(properties.get('opacity'), '1');
});
