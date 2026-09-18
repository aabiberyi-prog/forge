import { invoke } from '@tauri-apps/api/core';

/**
 * Built-in Edge neural TTS (少御向 defaults).
 * Returns audio as number[] (raw mp3 bytes), compatible with Lingva playback.
 */
export async function tts(text, lang, options = {}) {
    const { config = {} } = options;
    const { voice_zh = 'zh-CN-XiaoxiaoNeural', voice_en = 'en-US-AriaNeural', rate = '-20%', pitch = '+0Hz' } = config;

    const bytes = await invoke('edge_tts_synthesize', {
        text,
        lang: lang || 'en',
        voiceZh: voice_zh,
        voiceEn: voice_en,
        rate,
        pitch,
    });

    // Tauri returns number[] for Vec<u8>
    return bytes;
}

export * from './Config';
export * from './info';
