import { Store } from '@tauri-apps/plugin-store';
import { appConfigDir, join } from '@tauri-apps/api/path';
import { watch } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';

export let store;

export async function initStore() {
    const appConfigDirPath = await appConfigDir();
    const appConfigPath = await join(appConfigDirPath, 'config.json');
    store = await Store.load(appConfigPath, { autoSave: false, defaults: {} });
    await watch(
        appConfigPath,
        async (event) => {
            if (event.type && typeof event.type === 'object' && 'access' in event.type) return;
            await store.reload();
            await invoke('reload_store');
        },
        { delayMs: 200 }
    );
}
