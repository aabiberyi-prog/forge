import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@nextui-org/react';
import { appCacheDir, join } from '@tauri-apps/api/path';
import { currentMonitor } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emit } from '@tauri-apps/api/event';
import { warn } from '@tauri-apps/plugin-log';
import { useTranslation } from 'react-i18next';
import Annotator from './Annotator';
import {
    REGION_TOOLS,
    cropRegionsToImageData,
    hitHandle,
    imagePointFromEvent,
    moveRegion,
    nextRegionId,
    regionRect,
    resizeRegion,
    unionBounds,
} from './regions';

const appWindow = getCurrentWebviewWindow();

export default function Screenshot() {
    const { t } = useTranslation();
    const [imgurl, setImgurl] = useState('');
    const [cutUrl, setCutUrl] = useState('');
    const [mode, setMode] = useState('ocr');
    const [stage, setStage] = useState('select');
    const [regionTool, setRegionTool] = useState('rectangle');
    const [regions, setRegions] = useState([]);
    const [draft, setDraft] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const imgRef = useRef();
    const dragRef = useRef(null);

    useEffect(() => {
        invoke('get_capture_mode')
            .then((value) => {
                if (value === 'save' || value === 'pin' || value === 'ocr' || value === 'scroll') {
                    setMode(value);
                }
            })
            .catch(() => {});
        currentMonitor().then((monitor) => {
            const position = monitor.position;
            invoke('screenshot', { x: position.x, y: position.y }).then(() => {
                appCacheDir().then((appCacheDirPath) => {
                    join(appCacheDirPath, 'pot_screenshot.png').then((filePath) => {
                        setImgurl(convertFileSrc(filePath));
                    });
                });
            });
        });
    }, []);

    const imagePoint = (event) => imagePointFromEvent(event, imgRef.current);

    const confirmRegions = async () => {
        const list = draft ? [...regions, draft] : regions;
        if (!list.length) return;
        const img = imgRef.current;
        const bounds = unionBounds(list);
        if (bounds.width <= 1 || bounds.height <= 1) {
            warn('Screenshot area is too small');
            await appWindow.close();
            return;
        }
        const left = Math.max(0, Math.floor(bounds.left));
        const top = Math.max(0, Math.floor(bounds.top));
        const width = Math.floor(bounds.width);
        const height = Math.floor(bounds.height);
        if (mode === 'scroll') {
            const monitor = await currentMonitor();
            const originX = monitor?.position?.x ?? 0;
            const originY = monitor?.position?.y ?? 0;
            appWindow.hide();
            await appWindow.setAlwaysOnTop(false);
            const result = await invoke('scrolling_capture', {
                left: originX + left,
                top: originY + top,
                width,
                height,
            });
            if (result?.stopped === 'cancel' || !result?.cutPath) {
                await appWindow.close();
                return;
            }
            setCutUrl(`${convertFileSrc(result.cutPath)}?t=${Date.now()}`);
            setStage('annotate');
            await appWindow.setFullscreen(false);
            await appWindow.center();
            await appWindow.setSize(new LogicalSize(960, 720));
            await appWindow.show();
            await appWindow.setFocus();
            return;
        }
        if (mode === 'ocr') {
            appWindow.hide();
            await invoke('cut_image', { left, top, width, height });
            await emit('success');
            await appWindow.close();
            return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const source = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const cropped = cropRegionsToImageData(source, list);
        const out = document.createElement('canvas');
        out.width = cropped.width;
        out.height = cropped.height;
        out.getContext('2d').putImageData(new ImageData(cropped.data, cropped.width, cropped.height), 0, 0);
        setCutUrl(out.toDataURL('image/png'));
        setStage('annotate');
        await appWindow.setFullscreen(false);
        await appWindow.center();
        await appWindow.setSize(new LogicalSize(960, 720));
        await appWindow.show();
        await appWindow.setFocus();
    };

    if (stage === 'annotate') {
        return (
            <Annotator
                imageSrc={cutUrl}
                pin={mode === 'pin'}
                onCancel={() => appWindow.close()}
                onConfirm={async (png, extra) => {
                    const result = extra?.retryPath
                        ? await invoke('retry_capture_copy', { path: extra.retryPath, pin: mode === 'pin' })
                        : await invoke('finish_capture', { pngBase64: png, pin: mode === 'pin' });
                    if (!result?.error) await appWindow.close();
                    return result;
                }}
            />
        );
    }

    return (
        <>
            <img
                ref={imgRef}
                className='fixed top-0 left-0 w-full h-full object-fill select-none'
                src={imgurl}
                draggable={false}
                onLoad={() => {
                    if (imgurl !== '' && imgRef.current.complete) {
                        void appWindow.show();
                        void appWindow.setFocus();
                        void appWindow.setResizable(false);
                    }
                }}
            />
            {regions.map((region) => {
                const rect = regionRect(region);
                const selected = region.id === selectedId;
                return (
                    <div
                        key={region.id}
                        className={`fixed border border-solid ${selected ? 'border-sky-300' : 'border-sky-500'} bg-[#2080f020]`}
                        style={{
                            left: `${(rect.left / (imgRef.current?.naturalWidth || 1)) * 100}%`,
                            top: `${(rect.top / (imgRef.current?.naturalHeight || 1)) * 100}%`,
                            width: `${(rect.width / (imgRef.current?.naturalWidth || 1)) * 100}%`,
                            height: `${(rect.height / (imgRef.current?.naturalHeight || 1)) * 100}%`,
                            borderRadius: region.tool === 'ellipse' ? '50%' : 0,
                        }}
                    />
                );
            })}
            {draft ? (
                <div
                    className='fixed border border-solid border-sky-500 bg-[#2080f020]'
                    style={{
                        left: `${(regionRect(draft).left / (imgRef.current?.naturalWidth || 1)) * 100}%`,
                        top: `${(regionRect(draft).top / (imgRef.current?.naturalHeight || 1)) * 100}%`,
                        width: `${(regionRect(draft).width / (imgRef.current?.naturalWidth || 1)) * 100}%`,
                        height: `${(regionRect(draft).height / (imgRef.current?.naturalHeight || 1)) * 100}%`,
                        borderRadius: draft.tool === 'ellipse' ? '50%' : 0,
                    }}
                />
            ) : null}
            <div
                className='fixed top-0 left-0 bottom-0 right-0 cursor-crosshair select-none'
                onPointerDown={(event) => {
                    if (event.button !== 0) {
                        void appWindow.close();
                        return;
                    }
                    if (!imgRef.current) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    const point = imagePoint(event);
                    const current = [...regions].reverse().find((region) => {
                        const handle = hitHandle(region, point.x, point.y);
                        return handle || (point.x >= regionRect(region).left && point.x <= regionRect(region).left + regionRect(region).width && point.y >= regionRect(region).top && point.y <= regionRect(region).top + regionRect(region).height);
                    });
                    if (current) {
                        const handle = hitHandle(current, point.x, point.y);
                        setSelectedId(current.id);
                        dragRef.current = { id: current.id, handle, x: point.x, y: point.y };
                        return;
                    }
                    const tool = regionTool === 'multi' ? 'rectangle' : regionTool;
                    const next = {
                        id: nextRegionId(),
                        tool,
                        x0: point.x,
                        y0: point.y,
                        x1: point.x,
                        y1: point.y,
                        points: [{ x: point.x, y: point.y }],
                    };
                    setDraft(next);
                }}
                onPointerMove={(event) => {
                    if (!imgRef.current) return;
                    const point = imagePoint(event);
                    if (dragRef.current) {
                        const { id, handle, x, y } = dragRef.current;
                        setRegions((current) =>
                            current.map((region) => {
                                if (region.id !== id) return region;
                                if (handle) return resizeRegion(region, handle, point.x, point.y);
                                return moveRegion(region, point.x - x, point.y - y);
                            })
                        );
                        dragRef.current = { ...dragRef.current, x: point.x, y: point.y };
                        return;
                    }
                    if (!draft) return;
                    setDraft({
                        ...draft,
                        x1: point.x,
                        y1: point.y,
                        points: draft.tool === 'freehand' ? [...draft.points, point] : draft.points,
                    });
                }}
                onPointerUp={() => {
                    if (dragRef.current) {
                        dragRef.current = null;
                        return;
                    }
                    if (!draft) return;
                    const rect = regionRect(draft);
                    if (rect.width > 2 && rect.height > 2) {
                        setRegions((current) => (regionTool === 'multi' ? [...current, draft] : [draft]));
                        setSelectedId(draft.id);
                    }
                    setDraft(null);
                }}
            />
            <div className='fixed bottom-4 left-1/2 -translate-x-1/2 flex gap-1 bg-black/60 p-1 rounded'>
                {REGION_TOOLS.map((name) => (
                    <Button
                        key={name}
                        size='sm'
                        variant={regionTool === name ? 'solid' : 'flat'}
                        onPress={() => setRegionTool(name)}
                    >
                        {t(`screenshot.region_${name}`)}
                    </Button>
                ))}
                <Button size='sm' color='success' onPress={confirmRegions}>
                    {t('screenshot.confirm')}
                </Button>
                <Button size='sm' variant='light' onPress={() => appWindow.close()}>
                    {t('screenshot.cancel')}
                </Button>
            </div>
        </>
    );
}
