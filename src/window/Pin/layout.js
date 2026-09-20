export function fitScale(image, monitor, chrome = 96) {
    const dpi = monitor.scaleFactor || 1;
    return Math.min(1, (monitor.size.width - 24 * dpi) / image.width,
        (monitor.size.height - (chrome + 48) * dpi) / image.height);
}

export function pinLayout(image, scale, monitor, position, chrome = 96) {
    const dpi = monitor.scaleFactor || 1;
    const maxWidth = Math.max(120, monitor.size.width / dpi - 24);
    const maxHeight = Math.max(chrome + 40, monitor.size.height / dpi - 48);
    const imageWidth = Math.max(1, image.width * scale / dpi);
    const imageHeight = Math.max(1, image.height * scale / dpi);
    const width = Math.min(maxWidth, Math.max(320, Math.ceil(imageWidth)));
    const height = Math.min(maxHeight, Math.max(chrome + 60, Math.ceil(imageHeight) + chrome));
    return {
        width, height, imageWidth, imageHeight,
        x: Math.max(monitor.position.x, Math.min(position.x, monitor.position.x + monitor.size.width - width * dpi)),
        y: Math.max(monitor.position.y, Math.min(position.y, monitor.position.y + monitor.size.height - (height + 40) * dpi)),
    };
}
