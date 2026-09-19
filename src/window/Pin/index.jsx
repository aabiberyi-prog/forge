import { convertFileSrc } from '@tauri-apps/api/core';
import { appCacheDir, join } from '@tauri-apps/api/path';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import React, { useEffect, useState } from 'react';

const appWindow = getCurrentWebviewWindow();

export default function Pin() {
    const [src, setSrc] = useState('');

    useEffect(() => {
        const load = async () => {
            const path = await join(await appCacheDir(), 'pot_screenshot_cut.png');
            setSrc(`${convertFileSrc(path)}?t=${Date.now()}`);
        };
        load();
        const onKey = (event) => {
            if (event.key === 'Escape') {
                void appWindow.close();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    return (
        <img
            src={src}
            alt='Pinned capture'
            className='block max-w-screen max-h-screen select-none'
            draggable={false}
            data-tauri-drag-region
            onDoubleClick={() => appWindow.close()}
            onLoad={async (event) => {
                const width = Math.min(event.target.naturalWidth, 1200);
                const height = Math.min(event.target.naturalHeight, 800);
                await appWindow.setSize(new LogicalSize(Math.max(width, 120), Math.max(height, 80)));
                await appWindow.setAlwaysOnTop(true);
                await appWindow.show();
                await appWindow.setFocus();
            }}
        />
    );
}
