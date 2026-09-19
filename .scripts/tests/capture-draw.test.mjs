import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRect, TOOLS } from '../../src/window/Screenshot/draw.js';

test('annotation MVP exposes ten tools', () => {
    assert.equal(TOOLS.length, 10);
    for (const tool of [
        'rectangle',
        'ellipse',
        'arrow',
        'line',
        'freehand',
        'text',
        'step',
        'blur',
        'highlight',
        'crop',
    ]) {
        assert.equal(TOOLS.includes(tool), true);
    }
});

test('normalizeRect is order-independent', () => {
    assert.deepEqual(normalizeRect(10, 20, 4, 8), { left: 4, top: 8, width: 6, height: 12 });
});
