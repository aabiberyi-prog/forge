import { Button, Slider } from '@nextui-org/react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const appWindow = getCurrentWebviewWindow();

export default function Pin() {
    const { t } = useTranslation();
    const [src, setSrc] = useState('');
    const [error, setError] = useState('');
    const [scale, setScale] = useState(1);
    const [opacity, setOpacity] = useState(1);
    const natural = useRef({ width: 320, height: 200 });

    const applySize = async (nextScale) => {
        const width = Math.max(80, Math.round(natural.current.width * nextScale));
        const height = Math.max(60, Math.round(natural.current.height * nextScale));
        await appWindow.setSize(new LogicalSize(width, height + 36));
    };

    useEffect(() => {
        const load = async () => {
            try {
                const path = await invoke('get_pin_path', { label: appWindow.label });
                setSrc(`${convertFileSrc(path)}?t=${Date.now()}`);
                setError('');
            } catch (err) {
                setError(err?.message || t('pin.missing'));
            }
        };
        load();
        const onKey = (event) => {
            if (event.key === 'Escape') void appWindow.close();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [t]);

    return (
        <div className='h-screen w-screen bg-black/40 text-white flex flex-col'>
            <div className='flex items-center gap-1 px-1 py-0.5 text-[11px]' data-tauri-drag-region>
                <Button size='sm' variant='light' onPress={() => appWindow.minimize()}>
                    {t('pin.minimize')}
                </Button>
                <Button
                    size='sm'
                    variant='light'
                    onPress={async () => {
                        try {
                            await invoke('copy_pin_image', { label: appWindow.label });
                        } catch (err) {
                            setError(err?.message || t('pin.copy_failed'));
                        }
                    }}
                >
                    {t('pin.copy')}
                </Button>
                <Button
                    size='sm'
                    variant='light'
                    onPress={() => {
                        setScale(1);
                        setOpacity(1);
                        void applySize(1);
                    }}
                >
                    {t('pin.reset')}
                </Button>
                <Button size='sm' variant='light' onPress={() => appWindow.close()}>
                    {t('pin.close')}
                </Button>
                <span className='ml-auto pr-1' data-tauri-drag-region>
                    {t('pin.title')}
                </span>
            </div>
            {error ? (
                <div className='flex-1 flex items-center justify-center text-sm px-3 text-center'>{error}</div>
            ) : (
                <img
                    src={src}
                    alt=''
                    className='flex-1 object-contain select-none'
                    style={{ opacity }}
                    draggable={false}
                    onDoubleClick={() => appWindow.close()}
                    onLoad={async (event) => {
                        natural.current = {
                            width: event.target.naturalWidth,
                            height: event.target.naturalHeight,
                        };
                        await appWindow.setAlwaysOnTop(true);
                        await applySize(scale);
                        await appWindow.show();
                    }}
                />
            )}
            <div className='flex items-center gap-2 px-2 py-1 text-[11px]'>
                <span>{t('pin.scale')}</span>
                <Slider
                    size='sm'
                    minValue={0.25}
                    maxValue={3}
                    step={0.05}
                    value={scale}
                    className='flex-1'
                    aria-label={t('pin.scale')}
                    onChange={(value) => {
                        const next = Array.isArray(value) ? value[0] : value;
                        setScale(next);
                        void applySize(next);
                    }}
                />
                <span>{t('pin.opacity')}</span>
                <Slider
                    size='sm'
                    minValue={0.15}
                    maxValue={1}
                    step={0.05}
                    value={opacity}
                    className='w-24'
                    aria-label={t('pin.opacity')}
                    onChange={(value) => setOpacity(Array.isArray(value) ? value[0] : value)}
                />
            </div>
        </div>
    );
}
