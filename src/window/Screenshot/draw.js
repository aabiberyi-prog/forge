import { normalizeRect, resizeRect, hitHandle } from './regions.js';

export { normalizeRect };

export const SELECTED_TOOLS = [
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
];

export const TOOLS = [...SELECTED_TOOLS, 'crop'];

export const DEFAULT_STYLE = {
    color: '#ef4444',
    strokeWidth: 3,
    strokeStyle: 'solid',
    fontFamily: 'sans-serif',
    fontSize: 20,
    fontStyle: 'normal',
    arrowHead: true,
    arrowStyle: 'single',
    blurRadius: 8,
    magnifyScale: 2,
    stepKind: 'number',
    stepStart: 1,
    rotation: 0,
};

let shapeSeq = 0;

export function nextShapeId() {
    shapeSeq += 1;
    return `shape-${Date.now()}-${shapeSeq}`;
}

export function stepLabel(index, kind = 'number', start = 1) {
    const n = Math.max(0, start - 1 + index);
    if (kind === 'alpha') {
        let value = n + 1, label = '';
        while (value > 0) {
            value -= 1;
            label = String.fromCharCode(65 + value % 26) + label;
            value = Math.floor(value / 26);
        }
        return label;
    }
    return String(start + index);
}

export function applyStroke(ctx, shape) {
    ctx.lineWidth = shape.strokeWidth || DEFAULT_STYLE.strokeWidth;
    ctx.strokeStyle = shape.color || DEFAULT_STYLE.color;
    ctx.setLineDash(shape.strokeStyle === 'dash' ? [8, 6] : shape.strokeStyle === 'dot' ? [2, 4] : []);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}

export function drawArrowHead(ctx, x0, y0, x1, y1, size = 14) {
    const angle = Math.atan2(y1 - y0, x1 - x0);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - size * Math.cos(angle - 0.4), y1 - size * Math.sin(angle - 0.4));
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - size * Math.cos(angle + 0.4), y1 - size * Math.sin(angle + 0.4));
    ctx.stroke();
}

export function shapeRect(shape) {
    if (shape.tool === 'freehand' && shape.points?.length) {
        const xs = shape.points.map((point) => point.x);
        const ys = shape.points.map((point) => point.y);
        return normalizeRect(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    }
    if (shape.tool === 'step') {
        const radius = shape.stepRadius || 12;
        return { left: shape.x0 - radius, top: shape.y0 - radius, width: radius * 2, height: radius * 2 };
    }
    if (shape.tool === 'text' && (!shape.rect?.width || !shape.rect?.height)) {
        const font = shape.fontSize || 20;
        const lines = (shape.text || '').split('\n');
        return { left: shape.x0, top: shape.y0, width: Math.max(80, ...lines.map((line) => Array.from(line).length * font)), height: Math.max(1, lines.length) * font * 1.4 };
    }
    if (shape.rect) return shape.rect;
    if (shape.x0 != null && shape.x1 != null) {
        return normalizeRect(shape.x0, shape.y0, shape.x1, shape.y1);
    }
    return { left: shape.x0 || 0, top: shape.y0 || 0, width: 0, height: 0 };
}

function rotatePoint(x, y, rect, angle) {
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const radians = angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
    return { x: cx + (x - cx) * cos - (y - cy) * sin, y: cy + (x - cx) * sin + (y - cy) * cos };
}

export function hitShapeHandle(shape, x, y, size = 8) {
    const rect = shapeRect(shape);
    const point = rotatePoint(x, y, rect, -(shape.rotation || 0));
    return hitHandle({ tool: 'rectangle', x0: rect.left, y0: rect.top, x1: rect.left + rect.width, y1: rect.top + rect.height }, point.x, point.y, size);
}

export function resizeShape(shape, handle, x, y) {
    const before = shapeRect(shape);
    const point = rotatePoint(x, y, before, -(shape.rotation || 0));
    const after = resizeRect(before, handle, point.x, point.y);
    const scaleX = after.width / (before.width || 1), scaleY = after.height / (before.height || 1);
    const transform = (x, y) => ({ x: after.left + (x - before.left) * scaleX, y: after.top + (y - before.top) * scaleY });
    const start = transform(shape.x0, shape.y0), end = transform(shape.x1 ?? shape.x0, shape.y1 ?? shape.y0);
    let next = { ...shape, x0: start.x, y0: start.y, x1: end.x, y1: end.y, rect: after };
    if (shape.points) next.points = shape.points.map((p) => transform(p.x, p.y));
    if (shape.tailX != null) { const tail = transform(shape.tailX, shape.tailY); next.tailX = tail.x; next.tailY = tail.y; }
    if (shape.tool === 'text') next.fontSize = Math.max(8, (shape.fontSize || 20) * scaleY);
    if (shape.tool === 'step') next.stepRadius = Math.max(4, Math.min(after.width, after.height) / 2);
    const center = rotatePoint(after.left + after.width / 2, after.top + after.height / 2, before, shape.rotation || 0);
    return moveShape(next, center.x - (after.left + after.width / 2), center.y - (after.top + after.height / 2));
}

export function isEditingTarget(target) {
    return Boolean(target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)
        || target?.closest?.('[contenteditable="true"], [role="textbox"], [role="combobox"]'));
}

export function distanceToSegment(x, y, x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(x - x0, y - y0);
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
    return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
}

export function hitTestShape(shape, x, y, tol = 8) {
    const rect = shapeRect(shape);
    ({ x, y } = rotatePoint(x, y, rect, -(shape.rotation || 0)));
    if (shape.tool === 'line' || shape.tool === 'arrow') {
        return distanceToSegment(x, y, shape.x0, shape.y0, shape.x1, shape.y1) <= tol + (shape.strokeWidth || 3);
    }
    if (shape.tool === 'freehand') {
        const points = shape.points || [];
        for (let i = 1; i < points.length; i += 1) {
            if (distanceToSegment(x, y, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y) <= tol) {
                return true;
            }
        }
        return false;
    }
    if (shape.tool === 'step') {
        return Math.hypot(x - shape.x0, y - shape.y0) <= (shape.stepRadius || 12) + tol;
    }
    return (
        x >= rect.left - tol &&
        x <= rect.left + rect.width + tol &&
        y >= rect.top - tol &&
        y <= rect.top + rect.height + tol
    );
}

export function moveShape(shape, dx, dy) {
    const next = { ...shape, x0: (shape.x0 || 0) + dx, y0: (shape.y0 || 0) + dy };
    if (shape.x1 != null) next.x1 = shape.x1 + dx;
    if (shape.y1 != null) next.y1 = shape.y1 + dy;
    if (shape.rect) {
        next.rect = { ...shape.rect, left: shape.rect.left + dx, top: shape.rect.top + dy };
    }
    if (shape.points) {
        next.points = shape.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
    }
    if (shape.tailX != null) {
        next.tailX = shape.tailX + dx;
        next.tailY = shape.tailY + dy;
    }
    return next;
}

export function duplicateShape(shape) {
    return { ...moveShape(shape, 12, 12), id: nextShapeId() };
}

export function boxBlurImageData(imageData, radius) {
    const r = Math.max(1, Math.round(radius));
    const { width, height, data } = imageData;
    const src = new Uint8ClampedArray(data);
    const tmp = new Uint8ClampedArray(data.length);
    const pass = (input, output, horizontal) => {
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                let rSum = 0;
                let gSum = 0;
                let bSum = 0;
                let aSum = 0;
                let count = 0;
                for (let k = -r; k <= r; k += 1) {
                    const sx = horizontal ? Math.min(width - 1, Math.max(0, x + k)) : x;
                    const sy = horizontal ? y : Math.min(height - 1, Math.max(0, y + k));
                    const i = (sy * width + sx) * 4;
                    rSum += input[i];
                    gSum += input[i + 1];
                    bSum += input[i + 2];
                    aSum += input[i + 3];
                    count += 1;
                }
                const o = (y * width + x) * 4;
                output[o] = rSum / count;
                output[o + 1] = gSum / count;
                output[o + 2] = bSum / count;
                output[o + 3] = aSum / count;
            }
        }
    };
    pass(src, tmp, true);
    pass(tmp, data, false);
    return imageData;
}

function blurRect(ctx, image, rect, radius) {
    if (!rect || rect.width < 2 || rect.height < 2) return;
    const left = Math.max(0, Math.floor(rect.left));
    const top = Math.max(0, Math.floor(rect.top));
    const width = Math.min(ctx.canvas.width - left, Math.ceil(rect.width));
    const height = Math.min(ctx.canvas.height - top, Math.ceil(rect.height));
    if (width < 2 || height < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    if (image) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.filter = `blur(${Math.max(1, radius)}px)`;
        ctx.drawImage(image, 0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.filter = 'none';
    } else {
        const sample = ctx.getImageData(left, top, width, height);
        boxBlurImageData(sample, radius);
        ctx.putImageData(sample, left, top);
    }
    ctx.restore();
}

function paintBalloon(ctx, shape) {
    const rect = shapeRect(shape);
    const r = 12;
    ctx.beginPath();
    ctx.moveTo(rect.left + r, rect.top);
    ctx.lineTo(rect.left + rect.width - r, rect.top);
    ctx.quadraticCurveTo(rect.left + rect.width, rect.top, rect.left + rect.width, rect.top + r);
    ctx.lineTo(rect.left + rect.width, rect.top + rect.height - r);
    ctx.quadraticCurveTo(
        rect.left + rect.width,
        rect.top + rect.height,
        rect.left + rect.width - r,
        rect.top + rect.height
    );
    ctx.lineTo(rect.left + r, rect.top + rect.height);
    ctx.quadraticCurveTo(rect.left, rect.top + rect.height, rect.left, rect.top + rect.height - r);
    ctx.lineTo(rect.left, rect.top + r);
    ctx.quadraticCurveTo(rect.left, rect.top, rect.left + r, rect.top);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fill();
    applyStroke(ctx, shape);
    ctx.stroke();
    const tailX = shape.tailX ?? rect.left + rect.width / 2;
    const tailY = shape.tailY ?? rect.top + rect.height + 18;
    ctx.beginPath();
    ctx.moveTo(rect.left + rect.width / 2 - 8, rect.top + rect.height);
    ctx.lineTo(tailX, tailY);
    ctx.lineTo(rect.left + rect.width / 2 + 8, rect.top + rect.height);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (shape.text) {
        ctx.fillStyle = shape.color || '#111';
        ctx.font = `${shape.fontStyle || 'normal'} ${shape.fontSize || 16}px ${shape.fontFamily || 'sans-serif'}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        wrapText(ctx, shape.text, rect.left + rect.width / 2, rect.top + rect.height / 2, rect.width - 16);
    }
}

function wrapText(ctx, text, x, y, maxWidth) {
    const lines = String(text).split('\n');
    const lineHeight = (Number(ctx.font.match(/([\d.]+)px/)?.[1]) || 16) * 1.4;
    const drawn = [];
    for (const line of lines) {
        const words = line.split(' ');
        let current = '';
        for (const word of words) {
            const next = current ? `${current} ${word}` : word;
            if (ctx.measureText(next).width > maxWidth && current) {
                drawn.push(current);
                current = word;
            } else {
                current = next;
            }
        }
        drawn.push(current);
    }
    const startY = y - ((drawn.length - 1) * lineHeight) / 2;
    drawn.forEach((line, index) => ctx.fillText(line, x, startY + index * lineHeight));
}

export function paintShape(ctx, shape, image) {
    ctx.save();
    const rect = shapeRect(shape);
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    if (shape.rotation) {
        ctx.translate(cx, cy);
        ctx.rotate((shape.rotation * Math.PI) / 180);
        ctx.translate(-cx, -cy);
    }
    applyStroke(ctx, shape);

    switch (shape.tool) {
        case 'rectangle':
            ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
            break;
        case 'ellipse':
            ctx.beginPath();
            ctx.ellipse(cx, cy, Math.max(rect.width / 2, 1), Math.max(rect.height / 2, 1), 0, 0, Math.PI * 2);
            ctx.stroke();
            break;
        case 'line':
            ctx.beginPath();
            ctx.moveTo(shape.x0, shape.y0);
            ctx.lineTo(shape.x1, shape.y1);
            ctx.stroke();
            break;
        case 'arrow':
            ctx.beginPath();
            ctx.moveTo(shape.x0, shape.y0);
            ctx.lineTo(shape.x1, shape.y1);
            ctx.stroke();
            if (shape.arrowHead !== false && shape.arrowStyle !== 'none') {
                drawArrowHead(ctx, shape.x0, shape.y0, shape.x1, shape.y1, 8 + (shape.strokeWidth || 3));
                if (shape.arrowStyle === 'double') drawArrowHead(ctx, shape.x1, shape.y1, shape.x0, shape.y0, 8 + (shape.strokeWidth || 3));
            }
            break;
        case 'freehand':
            if (!shape.points?.length) break;
            ctx.beginPath();
            ctx.moveTo(shape.points[0].x, shape.points[0].y);
            for (const point of shape.points.slice(1)) ctx.lineTo(point.x, point.y);
            ctx.stroke();
            break;
        case 'highlight':
            ctx.fillStyle = shape.color ? hexToRgba(shape.color, 0.35) : 'rgba(250, 204, 21, 0.35)';
            ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
            break;
        case 'text':
            ctx.fillStyle = shape.color || DEFAULT_STYLE.color;
            ctx.font = `${shape.fontStyle || 'normal'} ${shape.fontSize || 20}px ${shape.fontFamily || 'sans-serif'}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            wrapText(ctx, shape.text || '', rect.left, rect.top + rect.height / 2, Math.max(80, rect.width));
            break;
        case 'balloon':
            paintBalloon(ctx, shape);
            break;
        case 'step': {
            ctx.beginPath();
            ctx.fillStyle = shape.color || DEFAULT_STYLE.color;
            ctx.arc(shape.x0, shape.y0, shape.stepRadius || 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = `${shape.stepRadius || 12}px ${shape.fontFamily || 'sans-serif'}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(stepLabel(shape.stepIndex || 0, shape.stepKind, shape.stepStart), shape.x0, shape.y0);
            break;
        }
        case 'blur':
            blurRect(ctx, image, rect, shape.blurRadius || DEFAULT_STYLE.blurRadius);
            break;
        case 'spotlight':
            if (image) {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.fillStyle = 'rgba(0,0,0,0.55)';
                ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                ctx.restore();
                ctx.save();
                ctx.beginPath();
                ctx.ellipse(cx, cy, Math.max(rect.width / 2, 1), Math.max(rect.height / 2, 1), 0, 0, Math.PI * 2);
                ctx.clip();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.drawImage(image, 0, 0, ctx.canvas.width, ctx.canvas.height);
                ctx.restore();
            }
            break;
        case 'magnify': {
            if (!image) break;
            const scale = shape.magnifyScale || DEFAULT_STYLE.magnifyScale;
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(cx, cy, Math.max(rect.width / 2, 1), Math.max(rect.height / 2, 1), 0, 0, Math.PI * 2);
            ctx.clip();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(
                image,
                0,
                0,
                image.naturalWidth || ctx.canvas.width,
                image.naturalHeight || ctx.canvas.height,
                cx - cx * scale,
                cy - cy * scale,
                ctx.canvas.width * scale,
                ctx.canvas.height * scale
            );
            ctx.restore();
            applyStroke(ctx, shape);
            ctx.beginPath();
            ctx.ellipse(cx, cy, Math.max(rect.width / 2, 1), Math.max(rect.height / 2, 1), 0, 0, Math.PI * 2);
            ctx.stroke();
            break;
        }
        default:
            break;
    }
    ctx.restore();
}

function hexToRgba(hex, alpha) {
    const value = hex.replace('#', '');
    const n = parseInt(value.length === 3 ? value.split('').map((ch) => ch + ch).join('') : value, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function renderScene(ctx, image, shapes, { draft, selectedId } = {}) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (image) {
        ctx.drawImage(image, 0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    for (const shape of [...shapes, ...(draft ? [draft] : [])]) {
        let source = image;
        if (['blur', 'spotlight', 'magnify'].includes(shape.tool) && ctx.canvas.ownerDocument) {
            // Effects sample the current composition, preserving earlier redactions/annotations.
            source = ctx.canvas.ownerDocument.createElement('canvas');
            source.width = ctx.canvas.width;
            source.height = ctx.canvas.height;
            source.getContext('2d').drawImage(ctx.canvas, 0, 0);
        }
        paintShape(ctx, shape, source);
    }
    const selected = shapes.find((shape) => shape.id === selectedId);
    if (selected) {
        const rect = shapeRect(selected);
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((selected.rotation || 0) * Math.PI / 180);
        ctx.translate(-cx, -cy);
        ctx.strokeStyle = '#38bdf8';
        ctx.fillStyle = '#38bdf8';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
        for (const [x, y] of [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]) {
            ctx.fillRect(rect.left + x * rect.width - 4, rect.top + y * rect.height - 4, 8, 8);
        }
        ctx.restore();
    }
}

export function createDraft(tool, point, style = DEFAULT_STYLE) {
    return {
        id: nextShapeId(),
        tool,
        x0: point.x,
        y0: point.y,
        x1: point.x,
        y1: point.y,
        points: [{ x: point.x, y: point.y }],
        rect: normalizeRect(point.x, point.y, point.x, point.y),
        text: '',
        rotation: 0,
        ...DEFAULT_STYLE,
        ...style,
    };
}
