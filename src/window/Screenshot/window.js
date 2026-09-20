import { LogicalSize } from '@tauri-apps/api/dpi';

export async function openEditorWindow(window, title) {
    await window.setFullscreen(false);
    await window.setAlwaysOnTop(false);
    await window.setDecorations(true);
    await window.setResizable(true);
    await window.setSkipTaskbar(false);
    await window.setTitle(title);
    await window.setMinSize(new LogicalSize(720, 520));
    await window.setSize(new LogicalSize(960, 720));
    await window.center();
    await window.show();
    await window.setFocus();
}
