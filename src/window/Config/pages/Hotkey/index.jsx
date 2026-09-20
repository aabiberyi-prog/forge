import toast, { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { CardBody } from '@nextui-org/react';
import { Button } from '@nextui-org/react';
import { Input } from '@nextui-org/react';
import { Card } from '@nextui-org/react';
import React, { useEffect, useRef, useState } from 'react';

import { useConfig } from '../../../../hooks/useConfig';
import { useToastStyle } from '../../../../hooks';
import { osType } from '../../../../utils/env';
import { invoke } from '@tauri-apps/api/core';

const keyMap = {
    Backquote: '`',
    Backslash: '\\',
    BracketLeft: '[',
    BracketRight: ']',
    Comma: ',',
    Equal: '=',
    Minus: '-',
    Plus: 'PLUS',
    Period: '.',
    Quote: "'",
    Semicolon: ';',
    Slash: '/',
    Backspace: 'Backspace',
    CapsLock: 'Capslock',
    ContextMenu: 'Contextmenu',
    Space: 'Space',
    Tab: 'Tab',
    Convert: 'Convert',
    Delete: 'Delete',
    End: 'End',
    Help: 'Help',
    Home: 'Home',
    PageDown: 'Pagedown',
    PageUp: 'Pageup',
    Escape: 'Esc',
    PrintScreen: 'Printscreen',
    ScrollLock: 'Scrolllock',
    Pause: 'Pause',
    Insert: 'Insert',
    Suspend: 'Suspend',
};

function keyDown(e, setKey) {
    e.preventDefault();
    if (e.key === 'Escape') {
        return;
    }
    if (e.keyCode === 8) {
        setKey('');
        return;
    }
    let newValue = '';
    if (e.ctrlKey) newValue = 'Ctrl';
    if (e.shiftKey) newValue = `${newValue}${newValue.length > 0 ? '+' : ''}Shift`;
    if (e.metaKey) newValue = `${newValue}${newValue.length > 0 ? '+' : ''}${osType === 'Darwin' ? 'Command' : 'Super'}`;
    if (e.altKey) newValue = `${newValue}${newValue.length > 0 ? '+' : ''}Alt`;
    let code = e.code;
    if (code.startsWith('Key')) code = code.substring(3);
    else if (code.startsWith('Digit')) code = code.substring(5);
    else if (code.startsWith('Numpad')) code = 'Num' + code.substring(6);
    else if (code.startsWith('Arrow')) code = code.substring(5);
    else if (code.startsWith('Intl')) code = code.substring(4);
    else if (/F\d+/.test(code)) {
        /* keep Fx */
    } else if (keyMap[code] !== undefined) code = keyMap[code];
    else code = '';
    setKey(`${newValue}${newValue.length > 0 && code.length > 0 ? '+' : ''}${code}`);
}

function HotkeyField({ name, title, stored, persist, t, toastStyle, onChanged }) {
    const [draft, setDraft] = useState(stored || '');
    const previous = useRef(stored || '');

    useEffect(() => {
        setDraft(stored || '');
        previous.current = stored || '';
    }, [stored]);
    useEffect(() => () => { invoke('end_shortcut_edit').catch(() => {}); }, []);

    const confirm = async () => {
        try {
            await invoke('register_shortcut_by_frontend', { name, shortcut: draft || '' });
            persist(draft || '', false);
            previous.current = draft || '';
            toast.success(
                draft ? t('config.hotkey.success') : t('config.hotkey.disabled', { defaultValue: 'Hotkey disabled' }),
                { style: toastStyle }
            );
        } catch (error) {
            setDraft(previous.current);
            toast.error(String(error), { style: toastStyle });
        }
        onChanged?.();
    };

    return (
        <div className='config-item'>
            <h3 className='my-auto'>{title}</h3>
            <Input
                type='hotkey'
                variant='bordered'
                value={draft}
                label={t('config.hotkey.set_hotkey')}
                className='max-w-[50%]'
                onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        setDraft(previous.current);
                        invoke('end_shortcut_edit').catch((error) => toast.error(String(error), { style: toastStyle }));
                        return;
                    }
                    keyDown(event, setDraft);
                }}
                onFocus={() => invoke('begin_shortcut_edit', { name }).catch((error) => toast.error(String(error), { style: toastStyle }))}
                onBlur={() => invoke('end_shortcut_edit').catch((error) => toast.error(String(error), { style: toastStyle }))}
                endContent={
                    <Button size='sm' variant='flat' onPress={confirm}>
                        {t('common.ok')}
                    </Button>
                }
            />
        </div>
    );
}

export default function Hotkey() {
    const [selectionTranslate, setSelectionTranslate] = useConfig('hotkey_selection_translate', '', { sync: false });
    const [inputTranslate, setInputTranslate] = useConfig('hotkey_input_translate', '', { sync: false });
    const [ocrRecognize, setOcrRecognize] = useConfig('hotkey_ocr_recognize', '', { sync: false });
    const [ocrTranslate, setOcrTranslate] = useConfig('hotkey_ocr_translate', '', { sync: false });
    const [captureRegion, setCaptureRegion] = useConfig('hotkey_capture_region', 'Alt+1', { sync: false });
    const [pinToScreen, setPinToScreen] = useConfig('hotkey_pin_to_screen', 'Alt+3', { sync: false });
    const [screenRecording, setScreenRecording] = useConfig('hotkey_screen_recording', 'Alt+4', { sync: false });
    const [scrollingCapture, setScrollingCapture] = useConfig('hotkey_scrolling_capture', 'Alt+2', { sync: false });
    const { t } = useTranslation();
    const toastStyle = useToastStyle();
    const [registry, setRegistry] = useState([]);

    const refreshRegistry = () => {
        invoke('list_hotkey_registry')
            .then((items) => setRegistry(Array.isArray(items) ? items : []))
            .catch(() => setRegistry([]));
    };

    useEffect(() => {
        refreshRegistry();
    }, []);

    const rows = [
        ['hotkey_selection_translate', t('config.hotkey.selection_translate'), selectionTranslate, setSelectionTranslate],
        ['hotkey_input_translate', t('config.hotkey.input_translate'), inputTranslate, setInputTranslate],
        ['hotkey_ocr_recognize', t('config.hotkey.ocr_recognize'), ocrRecognize, setOcrRecognize],
        ['hotkey_ocr_translate', t('config.hotkey.ocr_translate'), ocrTranslate, setOcrTranslate],
        ['hotkey_capture_region', t('config.hotkey.capture_region'), captureRegion, setCaptureRegion],
        ['hotkey_pin_to_screen', t('config.hotkey.pin_to_screen'), pinToScreen, setPinToScreen],
        ['hotkey_screen_recording', t('config.hotkey.screen_recording'), screenRecording, setScreenRecording],
        ['hotkey_scrolling_capture', t('config.hotkey.scrolling_capture'), scrollingCapture, setScrollingCapture],
    ];

    return (
        <Card>
            <Toaster />
            <CardBody>
                {rows.map(([name, title, stored, persist]) =>
                    stored === null ? null : (
                        <HotkeyField
                            key={name}
                            name={name}
                            title={title}
                            stored={stored}
                            persist={persist}
                            t={t}
                            toastStyle={toastStyle}
                            onChanged={refreshRegistry}
                        />
                    )
                )}
                <div className='mt-4'>
                    <h3 className='mb-2'>{t('config.hotkey.registry', { defaultValue: 'Hotkey status' })}</h3>
                    {registry.map((item) => (
                        <div key={item.id} className='config-item text-small'>
                            <span>
                                {item.shortcut || t('config.hotkey.none', { defaultValue: '(none)' })} · {item.action} (
                                {item.source})
                            </span>
                            <span className='text-default-400'>
                                {item.registered
                                    ? t('config.hotkey.ready', { defaultValue: 'registered' })
                                    : item.error || t('config.hotkey.later', { defaultValue: 'not registered' })}
                            </span>
                        </div>
                    ))}
                </div>
            </CardBody>
        </Card>
    );
}
