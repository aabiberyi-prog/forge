import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as draw from '../../src/window/Screenshot/draw.js';
import * as regions from '../../src/window/Screenshot/regions.js';

const require = createRequire(import.meta.url);
const { transformSync } = createRequire(require.resolve('vite/package.json'))('esbuild');
const compiled = transformSync(fs.readFileSync(new URL('../../src/window/Screenshot/Annotator.jsx', import.meta.url), 'utf8'), {
    loader: 'jsx', format: 'cjs', target: 'es2022',
}).code;

function editor(shape) {
    const state = ['select', [shape], null, shape.id, draw.DEFAULT_STYLE, 1, null, null];
    const canvas = { width: 500, height: 300, getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 300 }) };
    let index = 0, refIndex = 0;
    const React = {
        createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useState: (initial) => { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], (value) => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
        useRef: (initial) => ({ current: refIndex++ === 0 ? canvas : initial }),
        useMemo: (fn) => fn(), useEffect: () => {},
    };
    const modules = {
        react: { __esModule: true, default: React, ...React },
        '@nextui-org/react': { Button: 'Button', Input: 'Input', Select: 'Select', SelectItem: 'SelectItem' },
        'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
        './draw': draw, './regions': regions,
    };
    const context = { module: { exports: {} }, require: (name) => { assert.ok(modules[name], name); return modules[name]; } };
    vm.runInNewContext(compiled, context);
    const tree = context.module.exports.default({ imageSrc: 'fixture', onCancel: () => {}, onConfirm: () => {} });
    return { state, tree };
}

function find(tree, predicate) {
    if (!tree || typeof tree !== 'object') return null;
    if (predicate(tree)) return tree;
    for (const child of (tree.props?.children || []).flat(Infinity)) {
        const result = find(child, predicate);
        if (result) return result;
    }
    return null;
}

const rectangle = () => ({ id: 'one', tool: 'rectangle', x0: 0, y0: 0, x1: 100, y1: 10, rect: { left: 0, top: 0, width: 100, height: 10 } });

test('property editing never deletes or nudges the selected annotation', () => {
    for (const key of ['Backspace', 'Delete', 'ArrowLeft']) {
        const { tree, state } = editor(rectangle());
        tree.props.onKeyDown({ key, target: { tagName: 'INPUT' }, stopPropagation() {}, preventDefault() {} });
        assert.equal(state[1].length, 1);
        assert.equal(state[1][0].x0, 0);
    }
});

test('selected annotation is resized through the actual pointer handlers', () => {
    const { tree, state } = editor(rectangle());
    const canvas = find(tree, (node) => node.type === 'canvas');
    canvas.props.onPointerDown({ button: 0, pointerId: 1, clientX: 100, clientY: 10, currentTarget: { focus() {}, setPointerCapture() {} } });
    canvas.props.onPointerMove({ clientX: 200, clientY: 20 });
    canvas.props.onPointerUp();
    assert.equal(draw.shapeRect(state[1][0]).width, 200);
    assert.equal(draw.shapeRect(state[1][0]).height, 20);
});

test('font, arrow, and alphabetic step properties are reachable from controls', () => {
    const { tree, state } = editor({ ...rectangle(), tool: 'step' });
    for (const [label, value, property] of [['font_style', 'bold', 'fontStyle'], ['arrow_style', 'double', 'arrowStyle'], ['step_kind', 'alpha', 'stepKind']]) {
        const input = find(tree, (node) => node.props?.['aria-label'] === `screenshot.${label}`);
        assert.ok(input, label);
        input.props.onSelectionChange(new Set([value]));
        assert.equal(state[1][0][property], value);
    }
    assert.equal(draw.stepLabel(26, 'alpha', 1), 'AA');
});

test('freehand and reverse-drawn capture regions resize using canonical bounds', () => {
    const freehand = { tool: 'freehand', x0: 0, y0: 0, x1: 10, y1: 10, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] };
    assert.deepEqual(regions.regionRect(regions.resizeRegion(freehand, 'se', 20, 20)), { left: 0, top: 0, width: 20, height: 20 });
    const reverse = { tool: 'rectangle', x0: 100, y0: 100, x1: 0, y1: 0 };
    assert.deepEqual(regions.regionRect(regions.resizeRegion(reverse, 'e', 120, 50)), { left: 0, top: 0, width: 120, height: 100 });
});

test('rotated hit testing and resizing preserve the opposite world-space corner', () => {
    const original = { ...rectangle(), rotation: 90 };
    assert.equal(draw.hitTestShape(original, 50, -30), true);
    assert.equal(draw.hitTestShape(original, 20, 5, 0), false);
    const resized = draw.resizeShape(original, 'se', 45, 155);
    const bounds = draw.shapeRect(resized);
    assert.ok(Math.abs(bounds.left + 50) < 0.001);
    assert.ok(Math.abs(bounds.top - 50) < 0.001);
    assert.equal(bounds.width, 200);
    assert.equal(draw.hitShapeHandle(resized, 55, -45, 0.01), 'nw');
});
