export const MAX_COPY_IMAGES = 20;
export const MAX_COPY_IMAGE_BYTES = 10 * 1024 * 1024;
export const SUPPORTED_COPY_IMAGE_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
]);

export function sortByOrder(items) {
    return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function validateImageFile(file) {
    if (!SUPPORTED_COPY_IMAGE_TYPES.has(file.type)) {
        throw new Error('Use png, jpg, jpeg, webp, or gif');
    }
    if (file.size > MAX_COPY_IMAGE_BYTES) {
        throw new Error('Each image must be 10MB or smaller');
    }
}
