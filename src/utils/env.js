import { type, arch as archFn, version } from '@tauri-apps/plugin-os';
import { getVersion } from '@tauri-apps/api/app';

export let osType = '';
export let arch = '';
export let osVersion = '';
export let appVersion = '';

export async function initEnv() {
    const platform = type();
    osType = { windows: 'Windows_NT', macos: 'Darwin', linux: 'Linux' }[platform] ?? platform;
    arch = await archFn();
    osVersion = await version();
    appVersion = await getVersion();
}
