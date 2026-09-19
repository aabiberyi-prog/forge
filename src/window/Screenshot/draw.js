export const TOOLS = [
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
];

export function normalizeRect(x0, y0, x1, y1) {
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    return {
        left,
        top,
        width: Math.abs(x1 - x0),
        height: Math.abs(y1 - y0),
    };
}

export function drawArrowHead(ctx, x0, y0, x1, y1) {
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const length = 14;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - length * Math.cos(angle - 0.4), y1 - length * Math.sin(angle - 0.4));
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - length * Math.cos(angle + 0.4), y1 - length * Math.sin(angle + 0.4));
    ctx.stroke();
}

export function pixelateRect(ctx, rect, block = 8) {
    if (rect.width < 2 || rect.height < 2) return;
    const data = ctx.getImageData(rect.left, rect.top, rect.width, rect.height);
    const { width, height } = data;
    for (let y = 0; y < height; y += block) {
        for (let x = 0; x < width; x += block) {
            const i = (y * width + x) * 4;
            const r = data.data[i];
            const g = data.data[i + 1];
            const b = data.data[i + 2];
            const a = data.data[i + 3];
            for (let dy = 0; dy < block && y + dy < height; dy += 1) {
                for (let dx = 0; dx < block && x + dx < width; dx += 1) {
                    const j = ((y + dy) * width + x + dx) * 4;
                    data.data[j] = r;
                    data.data[j + 1] = g;
                    data.data[j + 2] = b;
                    data.data[j + 3] = a;
                }
            }
        }
    }
    ctx.putImageData(data, rect.left, rect.top);
}

export function paintShape(ctx, shape) {
    ctx.save();
    ctx.lineWidth = shape.tool === 'highlight' ? 1 : 3;
    ctx.strokeStyle = shape.color || '#ef4444';
    ctx.fillStyle = shape.tool === 'highlight' ? 'rgba(250, 204, 21, 0.35)' : 'rgba(239, 68, 68, 0.15)';
    const rect = shape.rect;

    switch (shape.tool) {
        case 'rectangle':
            ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
            break;
        case 'ellipse':
            ctx.beginPath();
            ctx.ellipse(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
                Math.max(rect.width / 2, 1),
                Math.max(rect.height / 2, 1),
                0,
                0,
                Math.PI * 2
            );
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
            drawArrowHead(ctx, shape.x0, shape.y0, shape.x1, shape.y1);
            break;
        case 'freehand':
            if (!shape.points?.length) break;
            ctx.beginPath();
            ctx.moveTo(shape.points[0].x, shape.points[0].y);
            for (const point of shape.points.slice(1)) {
                ctx.lineTo(point.x, point.y);
            }
            ctx.stroke();
            break;
        case 'highlight':
            ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
            break;
        case 'text':
            ctx.fillStyle = shape.color || '#ef4444';
            ctx.font = '20px sans-serif';
            ctx.fillText(shape.text || '', shape.x0, shape.y0);
            break;
        case 'step':
            ctx.beginPath();
            ctx.fillStyle = '#ef4444';
            ctx.arc(shape.x0, shape.y0, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(shape.step || 1), shape.x0, shape.y0);
            break;
        default:
            break;
    }
    ctx.restore();
}
