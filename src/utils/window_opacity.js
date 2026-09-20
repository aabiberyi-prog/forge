export function effectiveWindowOpacity(value, transparent = true) {
    if (transparent === false) return 1;
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0.15, Math.min(1, value)) : 0.92;
}

export function applyWindowOpacity(root, value, transparent) {
    root.style.setProperty('--pot-bg-opacity', String(effectiveWindowOpacity(value, transparent)));
}
