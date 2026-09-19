import { invoke } from '@tauri-apps/api/core';

export async function resolveApiKey(instanceKey, config) {
    const fromConfig = config?.apiKey;
    if (typeof fromConfig === 'string' && fromConfig.trim() && fromConfig !== 'fixture-only') {
        return fromConfig;
    }
    if (!instanceKey) {
        return '';
    }
    try {
        return await invoke('secret_get', { name: `${instanceKey}.apiKey` });
    } catch {
        return '';
    }
}

export async function persistApiKey(instanceKey, apiKey) {
    if (!instanceKey) {
        return;
    }
    await invoke('secret_set', { name: `${instanceKey}.apiKey`, value: apiKey ?? '' });
}

export async function hydrateSecrets(instanceKey, config) {
    if (!config || typeof config !== 'object') {
        return config;
    }
    const apiKey = await resolveApiKey(instanceKey, config);
    if (apiKey === (config.apiKey ?? '')) {
        return config;
    }
    return { ...config, apiKey };
}
