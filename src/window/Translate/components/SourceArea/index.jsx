import {
    Button,
    Card,
    CardBody,
    CardFooter,
    ButtonGroup,
    Tooltip,
    Spacer,
    Dropdown,
    DropdownMenu,
    DropdownTrigger,
    DropdownItem,
} from '@nextui-org/react';
import { BaseDirectory, readTextFile } from '@tauri-apps/api/fs';
import React, { useEffect, useRef, useState } from 'react';
import { writeText } from '@tauri-apps/api/clipboard';

import { appWindow } from '@tauri-apps/api/window';
import toast, { Toaster } from 'react-hot-toast';
import { listen } from '@tauri-apps/api/event';
import { MdContentCopy } from 'react-icons/md';
import { MdSmartButton } from 'react-icons/md';
import { useTranslation } from 'react-i18next';
import { HiTranslate } from 'react-icons/hi';
import { LuDelete } from 'react-icons/lu';
import { invoke } from '@tauri-apps/api';
import { atom, useAtom } from 'jotai';
import { getServiceName, getServiceSouceType, ServiceSourceType } from '../../../../utils/service_instance';
import { useConfig, useSyncAtom, useVoice, useToastStyle } from '../../../../hooks';
import { invoke_plugin } from '../../../../utils/invoke_plugin';
import * as recognizeServices from '../../../../services/recognize';
import * as builtinTtsServices from '../../../../services/tts';
import { languageList } from '../../../../utils/language';
import detect from '../../../../utils/lang_detect';
import { store } from '../../../../utils/store';
import { info } from 'tauri-plugin-log-api';
import { debug } from 'tauri-plugin-log-api';
import { sourceLanguageAtom, targetLanguageAtom } from '../LanguageArea';
import SpeakButton from '../SpeakButton';

export const sourceTextAtom = atom('');
export const detectLanguageAtom = atom('');

let unlisten = null;
let timer = null;
// Keep typed source across tray/hotkey reopen (INPUT_TRANSLATE used to wipe it).
let lastSourceText = '';
let persistDraftTimer = null;
let draftHydrated = false;

function rememberSourceText(text) {
    const next = typeof text === 'string' ? text : '';
    lastSourceText = next;
    if (!draftHydrated && next === '') {
        return;
    }
    draftHydrated = true;
    if (persistDraftTimer) {
        clearTimeout(persistDraftTimer);
    }
    persistDraftTimer = setTimeout(() => {
        store.set('translate_input_draft', next);
        store.save();
    }, 400);
}

async function restoreInputDraft(setSourceText) {
    const keep = lastSourceText;
    if (typeof keep === 'string' && keep.length > 0) {
        draftHydrated = true;
        setSourceText((old) => (old && old.length > 0 ? old : keep));
        return;
    }
    const draft = await store.get('translate_input_draft');
    if (typeof draft === 'string' && draft.length > 0) {
        lastSourceText = draft;
        draftHydrated = true;
        setSourceText((old) => (old && old.length > 0 ? old : draft));
    } else {
        draftHydrated = true;
    }
}

export default function SourceArea(props) {
    const { pluginList, serviceInstanceConfigMap } = props;
    const [appFontSize] = useConfig('app_font_size', 14);
    const [uiDensity] = useConfig('ui_density', 'compact');
    const isCompact = uiDensity !== 'standard';
    const [sourceText, setSourceText, syncSourceText] = useSyncAtom(sourceTextAtom);
    const [detectLanguage, setDetectLanguage] = useAtom(detectLanguageAtom);
    const [sourceLanguage, setSourceLanguage] = useAtom(sourceLanguageAtom);
    const [targetLanguage, setTargetLanguage] = useAtom(targetLanguageAtom);
    const [incrementalTranslate] = useConfig('incremental_translate', false);
    const [dynamicTranslate] = useConfig('dynamic_translate', false);
    const [deleteNewline] = useConfig('translate_delete_newline', false);
    const [recognizeLanguage] = useConfig('recognize_language', 'auto');
    const [recognizeServiceList] = useConfig('recognize_service_list', ['system', 'tesseract']);
    const [ttsServiceList] = useConfig('tts_service_list', ['edge_tts']);
    const [hideWindow] = useConfig('translate_hide_window', false);
    const [translateTargetLanguage] = useConfig('translate_target_language', 'zh_cn');
    const [translateSecondLanguage] = useConfig('translate_second_language', 'en');
    // hide_source only hides the original *text*, not speak/copy/clear controls
    const [hideSource] = useConfig('hide_source', false);
    const [ttsPluginInfo, setTtsPluginInfo] = useState();
    const [windowType, setWindowType] = useState('[SELECTION_TRANSLATE]');
    // When true, user overrode auto-detect; keep their pick until new text arrives
    const languageManualRef = useRef(false);
    const [languageManual, setLanguageManual] = useState(false);
    const toastStyle = useToastStyle();
    const { t } = useTranslation();
    const textAreaRef = useRef();
    const speak = useVoice();

    const handleNewText = async (text) => {
        text = text.trim();
        if (hideWindow) {
            appWindow.hide();
        } else {
            appWindow.show();
            appWindow.setFocus();
        }
        if (text === '[INPUT_TRANSLATE]') {
            setWindowType('[INPUT_TRANSLATE]');
            appWindow.show();
            appWindow.setFocus();
            // Reopen (tray icon / Alt+E) must not wipe a draft the user already typed.
            await restoreInputDraft(setSourceText);
        } else if (text === '[IMAGE_TRANSLATE]') {
            // New text: allow auto-detect again
            languageManualRef.current = false;
            setLanguageManual(false);
            setDetectLanguage('');
            setWindowType('[IMAGE_TRANSLATE]');
            const base64 = await invoke('get_base64');
            const serviceInstanceKey = recognizeServiceList[0];
            if (getServiceSouceType(serviceInstanceKey) === ServiceSourceType.PLUGIN) {
                if (recognizeLanguage in pluginList['recognize'][getServiceName(serviceInstanceKey)].language) {
                    const pluginConfig = serviceInstanceConfigMap[serviceInstanceKey];

                    let [func, utils] = await invoke_plugin('recognize', getServiceName(serviceInstanceKey));
                    func(
                        base64,
                        pluginList['recognize'][getServiceName(serviceInstanceKey)].language[recognizeLanguage],
                        {
                            config: pluginConfig,
                            utils,
                        }
                    ).then(
                        (v) => {
                            let newText = v.trim();
                            if (deleteNewline) {
                                newText = v.replace(/\-\s+/g, '').replace(/\s+/g, ' ');
                            } else {
                                newText = v.trim();
                            }
                            if (incrementalTranslate) {
                                setSourceText((old) => {
                                    return old + ' ' + newText;
                                });
                            } else {
                                setSourceText(newText);
                            }
                            detect_language(newText).then(syncAfterDetect);
                        },
                        (e) => {
                            setSourceText(e.toString());
                        }
                    );
                } else {
                    setSourceText('Language not supported');
                }
            } else {
                if (recognizeLanguage in recognizeServices[getServiceName(serviceInstanceKey)].Language) {
                    const instanceConfig = serviceInstanceConfigMap[serviceInstanceKey];
                    recognizeServices[getServiceName(serviceInstanceKey)]
                        .recognize(
                            base64,
                            recognizeServices[getServiceName(serviceInstanceKey)].Language[recognizeLanguage],
                            {
                                config: instanceConfig,
                            }
                        )
                        .then(
                            (v) => {
                                let newText = v.trim();
                                if (deleteNewline) {
                                    newText = v.replace(/\-\s+/g, '').replace(/\s+/g, ' ');
                                } else {
                                    newText = v.trim();
                                }
                                if (incrementalTranslate) {
                                    setSourceText((old) => {
                                        return old + ' ' + newText;
                                    });
                                } else {
                                    setSourceText(newText);
                                }
                                detect_language(newText).then(syncAfterDetect);
                            },
                            (e) => {
                                setSourceText(e.toString());
                            }
                        );
                } else {
                    setSourceText('Language not supported');
                }
            }
        } else {
            // New text: allow auto-detect again
            languageManualRef.current = false;
            setLanguageManual(false);
            setDetectLanguage('');
            setWindowType('[SELECTION_TRANSLATE]');
            let newText = text.trim();
            if (deleteNewline) {
                newText = text.replace(/\-\s+/g, '').replace(/\s+/g, ' ');
            } else {
                newText = text.trim();
            }
            if (incrementalTranslate) {
                setSourceText((old) => {
                    return old + ' ' + newText;
                });
            } else {
                setSourceText(newText);
            }
            detect_language(newText).then(syncAfterDetect);
        }
    };

    const keyDown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            detect_language(sourceText).then(syncAfterDetect);
        }
        if (event.key === 'Escape') {
            appWindow.close();
        }
    };

    const handleSpeak = async () => {
        const instanceKey = ttsServiceList[0];
        let detected = detectLanguage;
        if (detected === '') {
            detected = await detect(sourceText);
            setDetectLanguage(detected);
        }
        if (getServiceSouceType(instanceKey) === ServiceSourceType.PLUGIN) {
            if (!(detected in ttsPluginInfo.language)) {
                throw new Error('Language not supported');
            }
            const pluginConfig = serviceInstanceConfigMap[instanceKey];
            let [func, utils] = await invoke_plugin('tts', getServiceName(instanceKey));
            let data = await func(sourceText, ttsPluginInfo.language[detected], {
                config: pluginConfig,
                utils,
            });
            speak(data);
        } else {
            if (!(detected in builtinTtsServices[getServiceName(instanceKey)].Language)) {
                throw new Error('Language not supported');
            }
            const instanceConfig = serviceInstanceConfigMap[instanceKey];
            let data = await builtinTtsServices[getServiceName(instanceKey)].tts(
                sourceText,
                builtinTtsServices[getServiceName(instanceKey)].Language[detected],
                {
                    config: instanceConfig,
                }
            );
            speak(data);
        }
    };

    useEffect(() => {
        rememberSourceText(sourceText);
    }, [sourceText]);

    useEffect(() => {
        if (hideWindow !== null) {
            if (unlisten) {
                unlisten.then((f) => {
                    f();
                });
            }
            unlisten = listen('new_text', (event) => {
                appWindow.setFocus();
                handleNewText(event.payload);
            });
        }
    }, [hideWindow]);

    useEffect(() => {
        if (ttsServiceList && getServiceSouceType(ttsServiceList[0]) === ServiceSourceType.PLUGIN) {
            readTextFile(`plugins/tts/${getServiceName(ttsServiceList[0])}/info.json`, {
                dir: BaseDirectory.AppConfig,
            }).then((infoStr) => {
                setTtsPluginInfo(JSON.parse(infoStr));
            });
        }
    }, [ttsServiceList]);

    useEffect(() => {
        if (
            deleteNewline !== null &&
            incrementalTranslate !== null &&
            recognizeLanguage !== null &&
            recognizeServiceList !== null &&
            hideWindow !== null
        ) {
            invoke('get_text').then((v) => {
                handleNewText(v);
            });
        }
    }, [deleteNewline, incrementalTranslate, recognizeLanguage, recognizeServiceList, hideWindow]);

    // Grow height with wrapped lines; re-measure when text or container width changes
    useEffect(() => {
        if (!textAreaRef.current) return;
        const el = textAreaRef.current;
        const minH = isCompact ? 36 : 50;
        const fitHeight = () => {
            el.style.height = '0px';
            el.style.height = Math.max(minH, el.scrollHeight) + 'px';
        };
        fitHeight();
        const parent = el.parentElement;
        const ro = new ResizeObserver(() => fitHeight());
        if (parent) ro.observe(parent);
        window.addEventListener('resize', fitHeight);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', fitHeight);
        };
    }, [sourceText, appFontSize, isCompact]);

    const detect_language = async (text) => {
        // Keep manual override when user fixed a wrong auto-detect
        if (languageManualRef.current && detectLanguage) {
            return detectLanguage;
        }
        const detected = await detect(text);
        setDetectLanguage(detected);
        return detected;
    };

    // Fixed pairing for this product: English ↔ Chinese
    // English selected → EN→ZH; Chinese selected → ZH→EN
    const pairTargetForSource = (fromKey) => {
        if (fromKey === 'en') return 'zh_cn';
        if (fromKey === 'zh_cn' || fromKey === 'zh_tw') return 'en';
        // Other languages: prefer config target if different, else second, else zh/en flip
        if (translateTargetLanguage && translateTargetLanguage !== fromKey) {
            return translateTargetLanguage;
        }
        if (translateSecondLanguage && translateSecondLanguage !== fromKey) {
            return translateSecondLanguage;
        }
        return String(fromKey).startsWith('zh') ? 'en' : 'zh_cn';
    };

    const syncAfterDetect = (detected) => {
        if (detected && !languageManualRef.current) {
            setTargetLanguage(pairTargetForSource(detected));
        }
        syncSourceText();
    };

    const applySourceLanguage = (key) => {
        if (key === 'auto') {
            languageManualRef.current = false;
            setLanguageManual(false);
            setSourceLanguage('auto');
            detect(sourceText || '').then((detected) => {
                setDetectLanguage(detected);
                // Auto: still avoid same-language target
                if (detected) {
                    setTargetLanguage(pairTargetForSource(detected));
                }
                syncSourceText();
            });
            return;
        }
        languageManualRef.current = true;
        setLanguageManual(true);
        setDetectLanguage(key);
        setSourceLanguage(key);
        // Always set the paired target (EN→ZH / ZH→EN)
        setTargetLanguage(pairTargetForSource(key));
        syncSourceText();
    };

    let sourceTextChangeTimer = null;
    const changeSourceText = async (text) => {
        if (!languageManualRef.current) {
            setDetectLanguage('');
        }
        await setSourceText(text);
        if (dynamicTranslate) {
            if (sourceTextChangeTimer) {
                clearTimeout(sourceTextChangeTimer);
            }
            sourceTextChangeTimer = setTimeout(() => {
                detect_language(text).then(syncAfterDetect);
            }, 1000);
        }
    };

    const transformVarName = function (str) {
        let str2 = str;

        // snake_case to SNAKE_CASE
        if (/_[a-z]/.test(str2)) {
            str2 = str2.split('_').map(it => it.toLocaleUpperCase()).join('_');
        }
        if (str2 !== str) {
            return str2;
        }

        // SNAKE_CASE to kebab-case
        if (/^[A-Z]+(_[A-Z]+)*$/.test(str2)) {
            str2 = str2.split('_').map(it => it.toLocaleLowerCase()).join('-');
        }
        if (str2 !== str) {
            return str2;
        }

        // kebab-case to dot.notation
        if (/-/.test(str2)) {
            str2 = str2.split('-').map(it => it.toLocaleLowerCase()).join('.');
        }
        if (str2 !== str) {
            return str2;
        }

        // dot.notation to space separated
        if (/\.[a-z]/.test(str2)) {
            str2 = str2.replaceAll(/(\.)([a-z])/g, (_, _2, it) => ' ' + it);
        }
        if (str2 !== str) {
            return str2;
        }

        // space separated to Title Case
        if (/\s[a-z]/.test(str2)) {
            str2 = str2.replaceAll(/\s([a-z])/g, (_, it) => ' ' + it.toLocaleUpperCase());
            str2 = str2.substring(0, 1).toLocaleUpperCase() + str2.substring(1);
        }
        if (str2 !== str) {
            return str2;
        }

        // Title Case to CamelCase
        if (/\s[A-Z]/.test(str2)) {
            str2 = str2.replaceAll(/\s([A-Z])/g, (_, it) => it);
            str2 = str2.substring(0, 1).toLocaleLowerCase() + str2.substring(1);
        }
        if (str2 !== str) {
            return str2;
        }

        // CamelCase to PascalCase
        if (/^[a-z]+[A-Z]+/.test(str2)) {
            str2 = str2.substring(0, 1).toLocaleUpperCase() + str2.substring(1);
        }
        if (str2 !== str) {
            return str2;
        }

        // PascalCase to snake_case
        if (/[^\s][A-Z]/.test(str2)) {
            str2 = str2.replaceAll(/[A-Z]/g, (it, offset) => {
                return (offset == 0 ? '' : '_') + it.toLocaleLowerCase();
            });
        }

        return str2;
    }
    useEffect(() => {
        textAreaRef.current.addEventListener("keydown", async (event) => {
            if (event.altKey && event.shiftKey && event.code === 'KeyU') {
                const originText = textAreaRef.current.value;
                const selectionStart = textAreaRef.current.selectionStart;
                const selectionEnd = textAreaRef.current.selectionEnd;
                const selectionText = originText.substring(selectionStart, selectionEnd);

                const convertedText = transformVarName(selectionText);
                const targetText = originText.substring(0, selectionStart) + convertedText + originText.substring(selectionEnd);

                await changeSourceText(targetText);
                textAreaRef.current.selectionStart = selectionStart;
                textAreaRef.current.selectionEnd = selectionStart + convertedText.length;
            }
        });
    }, [textAreaRef]);


    // hide_source only hides the text body; action row stays visible.
    const textHidden = hideSource && windowType !== '[INPUT_TRANSLATE]';

    return (
        <div>
            <Card
                shadow='none'
                // Fully opaque panel so window chrome transparency never fades source text
                className={`bg-content1 rounded-[8px] mt-[1px] pb-0 opacity-100 group ${isCompact ? 'source-card-compact' : ''}`}
                style={{ opacity: 1, backgroundColor: 'hsl(var(--nextui-content1) / 1)' }}
            >
                <Toaster />
                <CardBody
                    className={`bg-content1 overflow-hidden ${
                        isCompact ? 'p-[8px] pb-0' : 'p-[12px] pb-0'
                    } ${textHidden ? 'hidden h-0 p-0 min-h-0' : ''}`}
                >
                    <textarea
                        autoFocus
                        ref={textAreaRef}
                        // Wrap to window width; height grows with content (no scrollbar)
                        className={`text-[${appFontSize}px] bg-content1 w-full max-w-full resize-none outline-none leading-snug overflow-hidden break-words`}
                        style={{
                            minHeight: isCompact ? 36 : 50,
                            overflow: 'hidden',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            overflowWrap: 'anywhere',
                        }}
                        value={sourceText}
                        onKeyDown={keyDown}
                        onChange={(e) => {
                            const v = e.target.value;
                            changeSourceText(v);
                        }}
                    />
                </CardBody>

                {/* Action buttons always visible (speak / copy / clear, etc.) */}
                <CardFooter
                    className={`bg-content1 rounded-none rounded-b-[8px] flex justify-between shrink-0 ${
                        isCompact ? 'px-[6px] py-[4px] min-h-[36px]' : 'px-[12px] p-[5px] min-h-[40px]'
                    }`}
                    style={{ opacity: 1, maxHeight: 'none', overflow: 'visible' }}
                >
                    <div className='flex justify-start'>
                        <ButtonGroup className='mr-[5px]'>
                            <SpeakButton
                                onSpeak={() => {
                                    handleSpeak().catch((e) => {
                                        toast.error(e.toString(), { style: toastStyle });
                                    });
                                }}
                            />
                            <Tooltip content={t('translate.copy')}>
                                <Button
                                    isIconOnly
                                    variant='light'
                                    size='sm'
                                    onPress={() => {
                                        writeText(sourceText);
                                    }}
                                >
                                    <MdContentCopy className='text-[16px]' />
                                </Button>
                            </Tooltip>
                            <Tooltip content={t('translate.delete_newline')}>
                                <Button
                                    isIconOnly
                                    variant='light'
                                    size='sm'
                                    onPress={() => {
                                        const newText = sourceText.replace(/\-\s+/g, '').replace(/\s+/g, ' ');
                                        setSourceText(newText);
                                        detect_language(newText).then(syncAfterDetect);
                                    }}
                                >
                                    <MdSmartButton className='text-[16px]' />
                                </Button>
                            </Tooltip>
                            <Tooltip content={t('common.clear')}>
                                <Button
                                    variant='light'
                                    size='sm'
                                    isIconOnly
                                    isDisabled={sourceText === ''}
                                    onPress={() => {
                                        setSourceText('');
                                    }}
                                >
                                    <LuDelete className='text-[16px]' />
                                </Button>
                            </Tooltip>
                        </ButtonGroup>
                        {/* Manual source-language picker (fixes wrong auto-detect, e.g. EN→zh misread) */}
                        <Tooltip content={t('translate.select_source_language')}>
                            <div className='my-auto'>
                                <Dropdown>
                                    <DropdownTrigger>
                                        <Button
                                            size='sm'
                                            variant='flat'
                                            color={languageManual ? 'primary' : 'secondary'}
                                            className='h-7 min-w-0 px-2'
                                        >
                                            {detectLanguage
                                                ? t(`languages.${detectLanguage}`)
                                                : t('languages.auto')}
                                            {languageManual ? ' ✓' : ''}
                                        </Button>
                                    </DropdownTrigger>
                                    <DropdownMenu
                                        aria-label={t('translate.select_source_language')}
                                        className='max-h-[50vh] overflow-y-auto'
                                        selectionMode='single'
                                        selectedKeys={
                                            languageManual && detectLanguage
                                                ? new Set([detectLanguage])
                                                : detectLanguage
                                                  ? new Set([detectLanguage])
                                                  : new Set(['auto'])
                                        }
                                        onAction={(key) => {
                                            applySourceLanguage(String(key));
                                        }}
                                    >
                                        <DropdownItem key='auto'>{t('languages.auto')}</DropdownItem>
                                        {languageList.map((lang) => (
                                            <DropdownItem key={lang}>
                                                {t(`languages.${lang}`)}
                                            </DropdownItem>
                                        ))}
                                    </DropdownMenu>
                                </Dropdown>
                            </div>
                        </Tooltip>
                    </div>
                    <Tooltip content={t('translate.translate')}>
                        <Button
                            size='sm'
                            color='primary'
                            variant='light'
                            isIconOnly
                            className='text-[14px] font-bold'
                            startContent={<HiTranslate className='text-[16px]' />}
                            onPress={() => {
                                detect_language(sourceText).then(syncAfterDetect);
                            }}
                        />
                    </Tooltip>
                </CardFooter>
            </Card>
            <Spacer y={isCompact ? 1 : 2} />
        </div>
    );
}
