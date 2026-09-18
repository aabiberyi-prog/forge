import { LogicalSize } from '@tauri-apps/api/window';

export async function fitWindowHeight(appWindow, height) {
    const scale = await appWindow.scaleFactor();
    const size = (await appWindow.innerSize()).toLogical(scale);
    const nextHeight = Math.round(height);
    // setSize accepts client dimensions. Reusing outerSize feeds the borders back into every resize.
    if (Math.round(size.height) !== nextHeight) {
        await appWindow.setSize(new LogicalSize(Math.round(size.width), nextHeight));
    }
}
