import test from 'node:test';
import assert from 'node:assert/strict';
import { fitScale, pinLayout } from '../../src/window/Pin/layout.js';

test('large pins fit a high-DPI negative-position monitor without stretching', () => {
    const monitor = { scaleFactor: 2, size: { width: 2560, height: 1440 }, position: { x: -2560, y: -1440 } };
    const image = { width: 3840, height: 2160 };
    const scale = fitScale(image, monitor);
    const layout = pinLayout(image, scale, monitor, { x: -100, y: -50 });
    assert.ok(layout.width * 2 <= 2560);
    assert.ok(layout.height * 2 <= 1440);
    assert.ok(layout.x >= -2560 && layout.x + layout.width * 2 <= 0);
    assert.ok(layout.y >= -1440 && layout.y + layout.height * 2 <= 0);
    assert.equal(layout.imageWidth / layout.imageHeight, image.width / image.height);
});

test('zoomed pins keep their window on screen and allow larger image contents', () => {
    const monitor = { scaleFactor: 1, size: { width: 1920, height: 1080 }, position: { x: 0, y: 0 } };
    const layout = pinLayout({ width: 1920, height: 1080 }, 3, monitor, { x: 0, y: 0 });
    assert.ok(layout.imageWidth > layout.width);
    assert.ok(layout.imageHeight > layout.height);
    assert.ok(layout.width <= 1920 && layout.height <= 1080);
});
