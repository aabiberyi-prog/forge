import { readDir, BaseDirectory, readTextFile, exists } from '@tauri-apps/plugin-fs';
import { DragDropContext, Draggable, Droppable } from 'react-beautiful-dnd';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { currentMonitor } from '@tauri-apps/api/window';
import { appConfigDir, join } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Spacer, Button, Slider } from '@nextui-org/react';
import { AiFillCloseCircle } from 'react-icons/ai';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { BsPinFill } from 'react-icons/bs';
import { MdOutlineSubtitles, MdOutlineSubtitlesOff } from 'react-icons/md';
import { Tooltip } from '@nextui-org/react';

import LanguageArea from './components/LanguageArea';
import SourceArea from './components/SourceArea';
import TargetArea from './components/TargetArea';
import { osType } from '../../utils/env';
import { useConfig } from '../../hooks';
import { store } from '../../utils/store';
import { fitWindowHeight } from '../../utils/window_size';
import { info } from '@tauri-apps/plugin-log';
import { useTranslation } from 'react-i18next';
const appWindow = getCurrentWebviewWindow();

let blurTimeout = null;
let resizeTimeout = null;
let moveTimeout = null;
let translateOpacityTimer = null;

const listenBlur = () => {
    return listen('tauri://blur', () => {
        if (appWindow.label === 'translate') {
            if (blurTimeout) {
                clearTimeout(blurTimeout);
            }
            info('Blur');
            // 100ms后关闭窗口，因为在 windows 下拖动窗口时会先切换成 blur 再立即切换成 focus
            // 如果直接关闭将导致窗口无法拖动
            blurTimeout = setTimeout(async () => {
                info('Confirm Blur');
                await appWindow.close();
            }, 100);
        }
    });
};

let unlisten = listenBlur();
// 取消 blur 监听
const unlistenBlur = () => {
    unlisten.then((f) => {
        f();
    });
};

// 监听 focus 事件取消 blurTimeout 时间之内的关闭窗口
void listen('tauri://focus', () => {
    info('Focus');
    if (blurTimeout) {
        info('Cancel Close');
        clearTimeout(blurTimeout);
    }
});
// 监听 move 事件取消 blurTimeout 时间之内的关闭窗口
void listen('tauri://move', () => {
    info('Move');
    if (blurTimeout) {
        info('Cancel Close');
        clearTimeout(blurTimeout);
    }
});

export default function Translate() {
    const [closeOnBlur] = useConfig('translate_close_on_blur', true);
    const [alwaysOnTop, setAlwaysOnTop] = useConfig('translate_always_on_top', false);
    const [windowPosition] = useConfig('translate_window_position', 'mouse');
    const [rememberWindowSize] = useConfig('translate_remember_window_size', false);
    const [translateServiceInstanceList, setTranslateServiceInstanceList] = useConfig('translate_service_list', [
        'deepl',
        'bing',
        'lingva',
        'yandex',
        'google',
        'ecdict',
    ]);
    const [recognizeServiceInstanceList] = useConfig('recognize_service_list', ['system', 'tesseract']);
    const [ttsServiceInstanceList] = useConfig('tts_service_list', ['edge_tts']);
    const [collectionServiceInstanceList] = useConfig('collection_service_list', []);
    const [hideLanguage] = useConfig('hide_language', true); // compact: language bar hidden by default
    const [hideSource, setHideSource] = useConfig('hide_source', false);
    const [uiDensity] = useConfig('ui_density', 'compact');
    const [windowOpacity, setWindowOpacity] = useConfig('window_opacity', 0.92);
    const isCompact = uiDensity !== 'standard';
    const [pined, setPined] = useState(false);
    const { t } = useTranslation();
    const [pluginList, setPluginList] = useState(null);
    const [serviceInstanceConfigMap, setServiceInstanceConfigMap] = useState(null);
    const bodyRef = useRef(null);
    const resizeTimerRef = useRef(null);
    const reorder = (list, startIndex, endIndex) => {
        const result = Array.from(list);
        const [removed] = result.splice(startIndex, 1);
        result.splice(endIndex, 0, removed);
        return result;
    };

    const onDragEnd = async (result) => {
        if (!result.destination) return;
        const items = reorder(translateServiceInstanceList, result.source.index, result.destination.index);
        setTranslateServiceInstanceList(items);
    };
    // Keep CSS shell opacity in sync (never fade text panels)
    useEffect(() => {
        if (windowOpacity !== null) {
            document.documentElement.style.setProperty('--pot-bg-opacity', String(windowOpacity));
        }
        const un = listen('window_opacity', (e) => {
            const val = e.payload;
            if (typeof val === 'number') {
                setWindowOpacity(val);
                document.documentElement.style.setProperty('--pot-bg-opacity', String(val));
            }
        });
        return () => {
            un.then((f) => f());
        };
    }, [windowOpacity]);

    // Grow window height with content; reflow wrapped text first when width changes
    const fitWindowToContent = useCallback(async () => {
        if (appWindow.label !== 'translate' || !bodyRef.current) return;
        try {
            // 1) Re-measure every textarea so wrap→line count updates scrollHeight
            bodyRef.current.querySelectorAll('textarea').forEach((ta) => {
                const minH = isCompact ? 36 : 50;
                ta.style.height = '0px';
                ta.style.overflow = 'hidden';
                ta.style.whiteSpace = 'pre-wrap';
                ta.style.wordBreak = 'break-word';
                ta.style.overflowWrap = 'anywhere';
                const next = Math.max(minH, ta.scrollHeight);
                ta.style.height = `${next}px`;
            });

            // 2) Size window to full content (includes always-visible action footers)
            const contentH = bodyRef.current.scrollHeight;
            const titleH = isCompact ? 28 : 35;
            const pad = isCompact ? 12 : 16;
            let height = contentH + titleH + pad;
            const maxH = Math.floor((window.screen?.availHeight || 900) * 0.9);
            const minH = isCompact ? 160 : 200;
            height = Math.max(minH, Math.min(height, maxH));

            await fitWindowHeight(appWindow, height);
        } catch (e) {
            info(`fitWindowToContent: ${e}`);
        }
    }, [isCompact]);

    useEffect(() => {
        if (!bodyRef.current) return;
        const el = bodyRef.current;
        const schedule = () => {
            if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
            resizeTimerRef.current = setTimeout(() => {
                fitWindowToContent();
            }, 50);
        };
        const ro = new ResizeObserver(schedule);
        ro.observe(el);
        schedule();
        // Also reflow when user drags window width
        const unlistenResize = listen('tauri://resize', () => {
            schedule();
        });
        window.addEventListener('resize', schedule);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', schedule);
            unlistenResize.then((f) => f());
            if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
        };
    }, [fitWindowToContent, pluginList, translateServiceInstanceList, hideLanguage, serviceInstanceConfigMap]);

    // 是否自动关闭窗口
    useEffect(() => {
        if (closeOnBlur !== null && !closeOnBlur) {
            unlistenBlur();
        }
    }, [closeOnBlur]);
    // Default always-on-top from config (pin reflects real window state)
    useEffect(() => {
        if (alwaysOnTop === null) return;
        if (alwaysOnTop) {
            appWindow.setAlwaysOnTop(true);
            unlistenBlur();
            setPined(true);
            store.set('translate_session_pinned', true);
        }
        // Do not force unpinned here — user may have toggled pin this session
    }, [alwaysOnTop]);
    // 保存窗口位置
    useEffect(() => {
        if (windowPosition !== null && windowPosition === 'pre_state') {
            const unlistenMove = listen('tauri://move', async () => {
                if (moveTimeout) {
                    clearTimeout(moveTimeout);
                }
                moveTimeout = setTimeout(async () => {
                    if (appWindow.label === 'translate') {
                        let position = await appWindow.outerPosition();
                        const monitor = await currentMonitor();
                        const factor = monitor.scaleFactor;
                        position = position.toLogical(factor);
                        await store.set('translate_window_position_x', parseInt(position.x));
                        await store.set('translate_window_position_y', parseInt(position.y));
                        await store.save();
                    }
                }, 100);
            });
            return () => {
                unlistenMove.then((f) => {
                    f();
                });
            };
        }
    }, [windowPosition]);
    // 保存窗口大小
    useEffect(() => {
        if (rememberWindowSize !== null && rememberWindowSize) {
            const unlistenResize = listen('tauri://resize', async () => {
                if (resizeTimeout) {
                    clearTimeout(resizeTimeout);
                }
                resizeTimeout = setTimeout(async () => {
                    if (appWindow.label === 'translate') {
                        let size = await appWindow.innerSize();
                        const monitor = await currentMonitor();
                        const factor = monitor.scaleFactor;
                        size = size.toLogical(factor);
                        await store.set('translate_window_height', parseInt(size.height));
                        await store.set('translate_window_width', parseInt(size.width));
                        await store.save();
                    }
                }, 100);
            });
            return () => {
                unlistenResize.then((f) => {
                    f();
                });
            };
        }
    }, [rememberWindowSize]);

    const loadPluginList = async () => {
        const serviceTypeList = ['translate', 'tts', 'recognize', 'collection'];
        let temp = {};
        for (const serviceType of serviceTypeList) {
            temp[serviceType] = {};
            if (await exists(`plugins/${serviceType}`, { baseDir: BaseDirectory.AppConfig })) {
                const plugins = await readDir(`plugins/${serviceType}`, { baseDir: BaseDirectory.AppConfig });
                for (const plugin of plugins) {
                    const infoStr = await readTextFile(`plugins/${serviceType}/${plugin.name}/info.json`, {
                        baseDir: BaseDirectory.AppConfig,
                    });
                    let pluginInfo = JSON.parse(infoStr);
                    if ('icon' in pluginInfo) {
                        const appConfigDirPath = await appConfigDir();
                        const iconPath = await join(
                            appConfigDirPath,
                            `/plugins/${serviceType}/${plugin.name}/${pluginInfo.icon}`
                        );
                        pluginInfo.icon = convertFileSrc(iconPath);
                    }
                    temp[serviceType][plugin.name] = pluginInfo;
                }
            }
        }
        setPluginList({ ...temp });
    };

    useEffect(() => {
        loadPluginList();
        if (!unlisten) {
            unlisten = listen('reload_plugin_list', loadPluginList);
        }
    }, []);

    const loadServiceInstanceConfigMap = async () => {
        const config = {};
        for (const serviceInstanceKey of translateServiceInstanceList) {
            config[serviceInstanceKey] = (await store.get(serviceInstanceKey)) ?? {};
        }
        for (const serviceInstanceKey of recognizeServiceInstanceList) {
            config[serviceInstanceKey] = (await store.get(serviceInstanceKey)) ?? {};
        }
        for (const serviceInstanceKey of ttsServiceInstanceList) {
            config[serviceInstanceKey] = (await store.get(serviceInstanceKey)) ?? {};
        }
        for (const serviceInstanceKey of collectionServiceInstanceList) {
            config[serviceInstanceKey] = (await store.get(serviceInstanceKey)) ?? {};
        }
        setServiceInstanceConfigMap({ ...config });
    };
    useEffect(() => {
        if (
            translateServiceInstanceList !== null &&
            recognizeServiceInstanceList !== null &&
            ttsServiceInstanceList !== null &&
            collectionServiceInstanceList !== null
        ) {
            loadServiceInstanceConfigMap();
        }
    }, [
        translateServiceInstanceList,
        recognizeServiceInstanceList,
        ttsServiceInstanceList,
        collectionServiceInstanceList,
    ]);
    // Config window toggles `enable` on the instance object; this window otherwise keeps a stale map.
    useEffect(() => {
        if (translateServiceInstanceList === null) return;
        const unlisteners = translateServiceInstanceList.map((key) => {
            const eventKey = key.replaceAll('.', '_').replaceAll('@', ':');
            return listen(`${eventKey}_changed`, (e) => {
                setServiceInstanceConfigMap((old) => {
                    if (!old) return old;
                    return { ...old, [key]: e.payload ?? {} };
                });
            });
        });
        return () => {
            unlisteners.forEach((p) => p.then((f) => f()));
        };
    }, [translateServiceInstanceList]);

    // Shell chrome opacity only — source/target text panels stay fully opaque (see SourceArea/TargetArea).
    const shellOpacity = windowOpacity ?? 0.92;
    const titleH = isCompact ? 28 : 35;
    const contentPad = isCompact ? 'px-[6px]' : 'px-[8px]';

    return (
        pluginList && (
            <div
                className={`h-screen w-screen relative overflow-hidden ${
                    osType === 'Linux' && 'rounded-[10px] border-1 border-default-100'
                } ${isCompact ? 'pot-density-compact' : ''}`}
                style={{
                    // Transparent shell; does not multiply/fade child text opacity
                    backgroundColor: `hsl(var(--nextui-background) / ${shellOpacity})`,
                    // Kill any residual scrollbars on the shell
                    scrollbarWidth: 'none',
                }}
            >
                <div
                    className={`fixed top-[3px] left-[4px] right-[4px] h-[${titleH - 4}px]`}
                    data-tauri-drag-region='true'
                />
                <div
                    className={`w-full flex items-center px-[2px] gap-0.5 ${
                        osType === 'Darwin' ? 'justify-end' : 'justify-between'
                    }`}
                    style={{ height: titleH }}
                >
                    <Button
                        isIconOnly
                        size='sm'
                        variant='flat'
                        disableAnimation
                        className='my-auto bg-transparent min-w-7 w-7 h-7'
                        onPress={async () => {
                            const next = !pined;
                            if (next) {
                                // Pin: stay above other windows; ignore blur-close
                                unlistenBlur();
                                await appWindow.setAlwaysOnTop(true);
                                if (alwaysOnTop === false) {
                                    setAlwaysOnTop(true);
                                }
                            } else {
                                // Unpin: must actually leave always-on-top
                                if (closeOnBlur) {
                                    unlisten = listenBlur();
                                }
                                await appWindow.setAlwaysOnTop(false);
                                // Config "always on top" would re-apply — turn it off with pin
                                if (alwaysOnTop) {
                                    setAlwaysOnTop(false);
                                }
                                // Second pass after a tick (Windows layered windows can race)
                                setTimeout(() => {
                                    appWindow.setAlwaysOnTop(false);
                                }, 50);
                            }
                            setPined(next);
                            try {
                                await store.set('translate_session_pinned', next);
                                await store.save();
                            } catch (_) {
                                /* ignore store errors */
                            }
                        }}
                    >
                        <BsPinFill className={`text-[16px] ${pined ? 'text-primary' : 'text-default-400'}`} />
                    </Button>
                    {/* Toggle original text only; speak/copy/clear stay available */}
                    {hideSource !== null && (
                        <Tooltip content={hideSource ? t('translate.show_source') : t('translate.hide_source')}>
                            <Button
                                isIconOnly
                                size='sm'
                                variant='flat'
                                disableAnimation
                                className='my-auto bg-transparent min-w-7 w-7 h-7'
                                onPress={() => {
                                    setHideSource(!hideSource);
                                }}
                            >
                                {hideSource ? (
                                    <MdOutlineSubtitlesOff className='text-[16px] text-primary' />
                                ) : (
                                    <MdOutlineSubtitles className='text-[16px] text-default-400' />
                                )}
                            </Button>
                        </Tooltip>
                    )}
                    {/* Compact transparency slider (default visible, slim) */}
                    {windowOpacity !== null && osType !== 'Darwin' && (
                        <div
                            className='flex items-center gap-0.5 flex-1 min-w-0 px-0.5'
                            data-tauri-drag-region='false'
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <span className='text-[10px] text-default-400 shrink-0 w-[26px] text-right tabular-nums'>
                                {Math.round(windowOpacity * 100)}%
                            </span>
                            <Slider
                                size='sm'
                                step={0.01}
                                minValue={0.15}
                                maxValue={1}
                                value={windowOpacity}
                                className='flex-1 max-w-[120px]'
                                aria-label='window opacity'
                                onChange={(v) => {
                                    const val = Array.isArray(v) ? v[0] : v;
                                    setWindowOpacity(val);
                                    document.documentElement.style.setProperty('--pot-bg-opacity', String(val));
                                    if (translateOpacityTimer) clearTimeout(translateOpacityTimer);
                                    translateOpacityTimer = setTimeout(() => {
                                        invoke('set_window_opacity', { opacity: val }).catch(() => {});
                                    }, 60);
                                }}
                            />
                        </div>
                    )}
                    <Button
                        isIconOnly
                        size='sm'
                        variant='flat'
                        disableAnimation
                        className={`my-auto min-w-7 w-7 h-7 ${osType === 'Darwin' && 'hidden'} bg-transparent`}
                        onPress={() => {
                            void appWindow.close();
                        }}
                    >
                        <AiFillCloseCircle className='text-[16px] text-default-400' />
                    </Button>
                </div>
                <div className={`${contentPad} overflow-x-hidden overflow-y-visible`}>
                    <div
                        ref={bodyRef}
                        className='overflow-x-hidden overflow-y-visible'
                    >
                        <div>
                            {serviceInstanceConfigMap !== null && (
                                <SourceArea
                                    pluginList={pluginList}
                                    serviceInstanceConfigMap={serviceInstanceConfigMap}
                                />
                            )}
                        </div>
                        <div className={`${hideLanguage && 'hidden'}`}>
                            <LanguageArea />
                            <Spacer y={isCompact ? 1 : 2} />
                        </div>
                        <DragDropContext onDragEnd={onDragEnd}>
                            <Droppable
                                droppableId='droppable'
                                direction='vertical'
                            >
                                {(provided) => (
                                    <div
                                        ref={provided.innerRef}
                                        {...provided.droppableProps}
                                    >
                                        {translateServiceInstanceList !== null &&
                                            serviceInstanceConfigMap !== null &&
                                            translateServiceInstanceList.map((serviceInstanceKey, index) => {
                                                const config = serviceInstanceConfigMap[serviceInstanceKey] ?? {};
                                                const enable = config['enable'] ?? true;

                                                return enable ? (
                                                    <Draggable
                                                        key={serviceInstanceKey}
                                                        draggableId={serviceInstanceKey}
                                                        index={index}
                                                    >
                                                        {(provided) => (
                                                            <div
                                                                ref={provided.innerRef}
                                                                {...provided.draggableProps}
                                                            >
                                                                <TargetArea
                                                                    {...provided.dragHandleProps}
                                                                    index={index}
                                                                    name={serviceInstanceKey}
                                                                    translateServiceInstanceList={
                                                                        translateServiceInstanceList
                                                                    }
                                                                    pluginList={pluginList}
                                                                    serviceInstanceConfigMap={serviceInstanceConfigMap}
                                                                />
                                                                <Spacer y={isCompact ? 1 : 2} />
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                ) : (
                                                    <></>
                                                );
                                            })}
                                    </div>
                                )}
                            </Droppable>
                        </DragDropContext>
                    </div>
                </div>
            </div>
        )
    );
}
