export const REGION_TOOLS = ['rectangle', 'ellipse', 'freehand', 'multi'];

let regionSeq = 0;

export function nextRegionId() {
    regionSeq += 1;
    return `region-${Date.now()}-${regionSeq}`;
}

export function imagePointFromEvent(event, img) {
    const bounds = img.getBoundingClientRect();
    const width = bounds.width || 1;
    const height = bounds.height || 1;
    return {
        x: ((event.clientX - bounds.left) * (img.naturalWidth || width)) / width,
        y: ((event.clientY - bounds.top) * (img.naturalHeight || height)) / height,
    };
}

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

export function regionRect(region) {
    if (region.tool === 'freehand' && region.points?.length) {
        const xs = region.points.map((point) => point.x);
        const ys = region.points.map((point) => point.y);
        return normalizeRect(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    }
    return normalizeRect(region.x0, region.y0, region.x1, region.y1);
}

export function unionBounds(regions) {
    if (!regions.length) {
        return { left: 0, top: 0, width: 0, height: 0 };
    }
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const region of regions) {
        const rect = regionRect(region);
        left = Math.min(left, rect.left);
        top = Math.min(top, rect.top);
        right = Math.max(right, rect.left + rect.width);
        bottom = Math.max(bottom, rect.top + rect.height);
    }
    return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function pointInPolygon(points, x, y) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
        const xi = points[i].x;
        const yi = points[i].y;
        const xj = points[j].x;
        const yj = points[j].y;
        const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

export function pointInRegion(region, x, y) {
    const rect = regionRect(region);
    if (region.tool === 'ellipse') {
        const rx = rect.width / 2;
        const ry = rect.height / 2;
        if (rx < 1 || ry < 1) return false;
        const cx = rect.left + rx;
        const cy = rect.top + ry;
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        return dx * dx + dy * dy <= 1;
    }
    if (region.tool === 'freehand' && region.points?.length >= 3) {
        return pointInPolygon(region.points, x, y);
    }
    return x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;
}

export function moveRegion(region, dx, dy) {
    const next = {
        ...region,
        x0: region.x0 + dx,
        y0: region.y0 + dy,
        x1: region.x1 + dx,
        y1: region.y1 + dy,
    };
    if (region.points) {
        next.points = region.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
    }
    return next;
}

export function resizeRegion(region, handle, x, y) {
    const before = regionRect(region);
    const after = resizeRect(before, handle, x, y);
    return {
        ...region, x0: after.left, y0: after.top,
        x1: after.left + after.width, y1: after.top + after.height,
        points: region.points?.map((point) => ({
            x: after.left + ((point.x - before.left) * after.width) / (before.width || 1),
            y: after.top + ((point.y - before.top) * after.height) / (before.height || 1),
        })),
    };
}

export function resizeRect(rect, handle, x, y) {
    let left = rect.left, top = rect.top, right = left + rect.width, bottom = top + rect.height;
    if (handle.includes('w')) left = Math.min(x, right - 2);
    if (handle.includes('e')) right = Math.max(x, left + 2);
    if (handle.includes('n')) top = Math.min(y, bottom - 2);
    if (handle.includes('s')) bottom = Math.max(y, top + 2);
    return { left, top, width: right - left, height: bottom - top };
}

export function hitHandle(region, x, y, size = 10) {
    const rect = regionRect(region);
    const handles = {
        nw: [rect.left, rect.top],
        n: [rect.left + rect.width / 2, rect.top],
        ne: [rect.left + rect.width, rect.top],
        e: [rect.left + rect.width, rect.top + rect.height / 2],
        se: [rect.left + rect.width, rect.top + rect.height],
        s: [rect.left + rect.width / 2, rect.top + rect.height],
        sw: [rect.left, rect.top + rect.height],
        w: [rect.left, rect.top + rect.height / 2],
    };
    const nearest = Object.entries(handles)
        .filter(([, [hx, hy]]) => Math.abs(x - hx) <= size && Math.abs(y - hy) <= size)
        .sort(([, a], [, b]) => Math.hypot(x - a[0], y - a[1]) - Math.hypot(x - b[0], y - b[1]));
    return nearest[0]?.[0] || null;
}

export function cropRegionsToImageData(source, regions) {
    const bounds = unionBounds(regions);
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const data = new Uint8ClampedArray(width * height * 4);
    const srcW = source.width;
    const srcH = source.height;
    const src = source.data;
    const left = Math.round(bounds.left);
    const top = Math.round(bounds.top);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const sx = left + x;
            const sy = top + y;
            const dest = (y * width + x) * 4;
            if (sx < 0 || sy < 0 || sx >= srcW || sy >= srcH) continue;
            if (!regions.some((region) => pointInRegion(region, sx + 0.5, sy + 0.5))) continue;
            const srcIndex = (sy * srcW + sx) * 4;
            data[dest] = src[srcIndex];
            data[dest + 1] = src[srcIndex + 1];
            data[dest + 2] = src[srcIndex + 2];
            data[dest + 3] = src[srcIndex + 3];
        }
    }
    return { data, width, height, bounds };
}
