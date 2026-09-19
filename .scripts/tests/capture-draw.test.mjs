import assert from 'node:assert/strict';
import test from 'node:test';
import { SELECTED_TOOLS, TOOLS, boxBlurImageData, hitTestShape, normalizeRect, stepLabel } from '../../src/window/Screenshot/draw.js';
import { cropRegionsToImageData, imagePointFromEvent, pointInRegion, REGION_TOOLS } from '../../src/window/Screenshot/regions.js';

test('annotation selection exposes twelve tools plus crop', () => {
    assert.equal(SELECTED_TOOLS.length, 12);
    assert.equal(TOOLS.includes('crop'), true);
    for (const tool of [
        'rectangle',
        'ellipse',
        'arrow',
        'line',
        'freehand',
        'text',
        'balloon',
        'step',
        'blur',
        'highlight',
        'spotlight',
        'magnify',
    ]) {
        assert.equal(SELECTED_TOOLS.includes(tool), true);
    }
});

test('normalizeRect is order-independent', () => {
    assert.deepEqual(normalizeRect(10, 20, 4, 8), { left: 4, top: 8, width: 6, height: 12 });
});

test('blur mixes neighboring pixels instead of copying a block', () => {
    const width = 5;
    const height = 5;
    const data = new Uint8ClampedArray(width * height * 4);
    const center = (2 * width + 2) * 4;
    data[center] = 255;
    data[center + 1] = 255;
    data[center + 2] = 255;
    data[center + 3] = 255;
    boxBlurImageData({ data, width, height }, 1);
    assert.ok(data[center] < 255, 'center should soften');
    const neighbor = (2 * width + 3) * 4;
    assert.ok(data[neighbor] > 0, 'neighbor should receive blur');
});

test('multi-region crop keeps interior pixels and clears outside alpha', () => {
    const width = 8;
    const height = 8;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = 10;
        data[i + 1] = 20;
        data[i + 2] = 30;
        data[i + 3] = 255;
    }
    const regions = [
        { tool: 'rectangle', x0: 1, y0: 1, x1: 3, y1: 3, points: [] },
        { tool: 'rectangle', x0: 5, y0: 5, x1: 7, y1: 7, points: [] },
    ];
    const cropped = cropRegionsToImageData({ data, width, height }, regions);
    assert.equal(cropped.width, 6);
    assert.equal(cropped.height, 6);
    const inside = (1 * cropped.width + 1) * 4;
    assert.equal(cropped.data[inside + 3], 255);
    const gap = (2 * cropped.width + 3) * 4;
    assert.equal(cropped.data[gap + 3], 0);
});

test('ellipse region uses ellipse containment', () => {
    const region = { tool: 'ellipse', x0: 0, y0: 0, x1: 10, y1: 10, points: [] };
    assert.equal(pointInRegion(region, 5, 5), true);
    assert.equal(pointInRegion(region, 0, 0), false);
});

test('step labels support numbers and letters', () => {
    assert.equal(stepLabel(0, 'number', 1), '1');
    assert.equal(stepLabel(1, 'alpha', 1), 'B');
});

test('hit testing keeps line strokes selectable', () => {
    const line = { tool: 'line', x0: 0, y0: 0, x1: 10, y1: 0 };
    assert.equal(hitTestShape(line, 5, 1, 4), true);
    assert.equal(hitTestShape(line, 5, 20, 4), false);
});

test('region tools include the four A1 modes', () => {
    assert.deepEqual(REGION_TOOLS, ['rectangle', 'ellipse', 'freehand', 'multi']);
});

test('image points map through display size so 200% DPI stays in image pixels', () => {
    const img = {
        naturalWidth: 200,
        naturalHeight: 100,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 50 }),
    };
    assert.deepEqual(imagePointFromEvent({ clientX: 50, clientY: 25 }, img), { x: 100, y: 50 });
});
