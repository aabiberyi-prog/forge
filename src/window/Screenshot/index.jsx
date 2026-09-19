import React, { useEffect, useState, useRef } from 'react';
import { appCacheDir, join } from '@tauri-apps/api/path';
import { currentMonitor } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emit } from '@tauri-apps/api/event';
import { warn } from '@tauri-apps/plugin-log';
import { invoke } from '@tauri-apps/api/core';
import Annotator from './Annotator';

const appWindow = getCurrentWebviewWindow();

export default function Screenshot() {
    const [imgurl, setImgurl] = useState('');
    const [cutUrl, setCutUrl] = useState('');
    const [mode, setMode] = useState('ocr');
    const [stage, setStage] = useState('select');
    const [isMoved, setIsMoved] = useState(false);
    const [isDown, setIsDown] = useState(false);
    const [mouseDownX, setMouseDownX] = useState(0);
    const [mouseDownY, setMouseDownY] = useState(0);
    const [mouseMoveX, setMouseMoveX] = useState(0);
    const [mouseMoveY, setMouseMoveY] = useState(0);
    const imgRef = useRef();

    useEffect(() => {
        invoke('get_capture_mode')
            .then((value) => {
                if (value === 'save' || value === 'pin' || value === 'ocr') {
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

    const finishRegion = async (event) => {
        appWindow.hide();
        setIsDown(false);
        setIsMoved(false);
        const imgWidth = imgRef.current.naturalWidth;
        const dpi = imgWidth / screen.width;
        const left = Math.floor(Math.min(mouseDownX, event.clientX) * dpi);
        const top = Math.floor(Math.min(mouseDownY, event.clientY) * dpi);
        const right = Math.floor(Math.max(mouseDownX, event.clientX) * dpi);
        const bottom = Math.floor(Math.max(mouseDownY, event.clientY) * dpi);
        const width = right - left;
        const height = bottom - top;
        if (width <= 0 || height <= 0) {
            warn('Screenshot area is too small');
            await appWindow.close();
            return;
        }
        await invoke('cut_image', { left, top, width, height });
        if (mode === 'ocr') {
            await emit('success');
            await appWindow.close();
            return;
        }
        const cutPath = await join(await appCacheDir(), 'pot_screenshot_cut.png');
        setCutUrl(`${convertFileSrc(cutPath)}?t=${Date.now()}`);
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
                onConfirm={async (png) => {
                    await invoke('finish_capture', { pngBase64: png, pin: mode === 'pin' });
                    await appWindow.close();
                }}
            />
        );
    }

    return (
        <>
            <img
                ref={imgRef}
                className='fixed top-0 left-0 w-full select-none'
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
            <div
                className={`fixed bg-[#2080f020] border border-solid border-sky-500 ${!isMoved && 'hidden'}`}
                style={{
                    top: Math.min(mouseDownY, mouseMoveY),
                    left: Math.min(mouseDownX, mouseMoveX),
                    bottom: screen.height - Math.max(mouseDownY, mouseMoveY),
                    right: screen.width - Math.max(mouseDownX, mouseMoveX),
                }}
            />
            <div
                className='fixed top-0 left-0 bottom-0 right-0 cursor-crosshair select-none'
                onMouseDown={(e) => {
                    if (e.buttons === 1) {
                        setIsDown(true);
                        setMouseDownX(e.clientX);
                        setMouseDownY(e.clientY);
                    } else {
                        void appWindow.close();
                    }
                }}
                onMouseMove={(e) => {
                    if (isDown) {
                        setIsMoved(true);
                        setMouseMoveX(e.clientX);
                        setMouseMoveY(e.clientY);
                    }
                }}
                onMouseUp={finishRegion}
            />
        </>
    );
}
