import { Button, Slider } from '@nextui-org/react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import { currentMonitor, primaryMonitor } from '@tauri-apps/api/window';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fitScale, pinLayout } from './layout';

const appWindow = getCurrentWebviewWindow();

export default function Pin() {
    const { t } = useTranslation();
    const [src, setSrc] = useState('');
    const [error, setError] = useState('');
    const [scale, setScale] = useState(1);
    const [opacity, setOpacity] = useState(1);
    const natural = useRef({ width: 320, height: 200 });
    const [layout, setLayout] = useState({ imageWidth: 320, imageHeight: 200 });
    const topBar = useRef(null);
    const bottomBar = useRef(null);
    const fit = useRef(1);
    const sizing = useRef(Promise.resolve());

    const applySize = async (nextScale) => {
        sizing.current = sizing.current.catch(() => {}).then(async () => {
            const monitor = await currentMonitor() || await primaryMonitor();
            if (!monitor) throw new Error(t('pin.monitor_missing'));
            const chrome = (topBar.current?.offsetHeight || 40) + (bottomBar.current?.offsetHeight || 40);
            const next = pinLayout(natural.current, nextScale, monitor, await appWindow.outerPosition(), chrome);
            setLayout(next);
            await appWindow.setSize(new LogicalSize(next.width, next.height));
            await appWindow.setPosition(new PhysicalPosition(Math.round(next.x), Math.round(next.y)));
        }).catch((error) => setError(error?.message || String(error)));
        return sizing.current;
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
            <div ref={topBar} className='flex flex-wrap items-center gap-1 px-1 py-0.5 text-[11px] shrink-0' data-tauri-drag-region>
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
                        setScale(fit.current);
                        setOpacity(1);
                        void applySize(fit.current);
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
                <div className='flex-1 min-h-0 overflow-auto'>
                <img
                    src={src}
                    alt=''
                    className='block max-w-none select-none'
                    style={{ opacity, width: layout.imageWidth, height: layout.imageHeight }}
                    draggable={false}
                    onDoubleClick={() => appWindow.minimize()}
                    onError={() => setError(t('pin.invalid_image'))}
                    onLoad={async (event) => {
                        natural.current = {
                            width: event.target.naturalWidth,
                            height: event.target.naturalHeight,
                        };
                        const monitor = await currentMonitor() || await primaryMonitor();
                        fit.current = monitor ? Math.max(0.01, fitScale(natural.current, monitor)) : 1;
                        setScale(fit.current);
                        await appWindow.setAlwaysOnTop(true);
                        await applySize(fit.current);
                        await appWindow.show();
                    }}
                />
                </div>
            )}
            <div ref={bottomBar} className='flex flex-wrap items-center gap-2 px-2 py-1 text-[11px] shrink-0'>
                <span>{t('pin.scale')}</span>
                <Slider
                    size='sm'
                    minValue={0.01}
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
