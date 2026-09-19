import { appCacheDir, appConfigDir, join } from '@tauri-apps/api/path';
import { readFile, readTextFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import CryptoJS from 'crypto-js';
import { osType } from './env';
import * as http from './http.js';

function fileOptions({ dir, ...options } = {}) {
    return { ...options, baseDir: options.baseDir ?? dir };
}

export async function invoke_plugin(pluginType, pluginName) {
    let configDir = await appConfigDir();
    let cacheDir = await appCacheDir();
    let pluginDir = await join(configDir, 'plugins', pluginType, pluginName);
    let entryFile = await join(pluginDir, 'main.js');
    let script = await readTextFile(entryFile);
    async function run(cmdName, args) {
        return await invoke('run_binary', {
            pluginType,
            pluginName,
            cmdName,
            args,
        });
    }
    const utils = {
        tauriFetch: http.fetch,
        http,
        readBinaryFile: (path, options) => readFile(path, fileOptions(options)),
        readTextFile: (path, options) => readTextFile(path, fileOptions(options)),
        Database,
        CryptoJS,
        run,
        cacheDir, // String
        pluginDir, // String
        osType, // "Windows_NT", "Darwin", "Linux"
    };
    if (!['translate', 'recognize', 'tts', 'collection'].includes(pluginType)) {
        throw new Error('Unsupported plugin type');
    }
    const moduleUrl = URL.createObjectURL(
        new Blob([`${script}\nexport default ${pluginType};`], { type: 'text/javascript' })
    );
    try {
        const module = await import(/* @vite-ignore */ moduleUrl);
        if (typeof module.default !== 'function') throw new Error('Plugin entry point must be a function');
        return [module.default, utils];
    } finally {
        URL.revokeObjectURL(moduleUrl);
    }
}
