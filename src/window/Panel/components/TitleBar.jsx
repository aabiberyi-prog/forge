import { Button } from '@nextui-org/react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { AiFillCloseCircle, AiFillPushpin, AiOutlinePushpin } from 'react-icons/ai';
import { MdLock, MdLockOpen } from 'react-icons/md';
import React from 'react';

const appWindow = getCurrentWebviewWindow();

export default function TitleBar({ settings, onPatchSettings, onClose }) {
    const locked = Boolean(settings?.locked);
    const alwaysOnTop = Boolean(settings?.alwaysOnTop);

    return (
        <div className='forge-panel-titlebar'>
            <div
                className='forge-panel-title'
                data-tauri-drag-region
                onPointerDown={async (event) => {
                    if (event.button !== 0) return;
                    await appWindow.startDragging();
                }}
            >
                Tasks
            </div>
            <div className='flex gap-1'>
                <Button
                    isIconOnly
                    size='sm'
                    variant='light'
                    onPress={() => onPatchSettings({ locked: !locked })}
                    title={locked ? 'Unlock size' : 'Lock size'}
                >
                    {locked ? <MdLock /> : <MdLockOpen />}
                </Button>
                <Button
                    isIconOnly
                    size='sm'
                    variant='light'
                    onPress={() => onPatchSettings({ alwaysOnTop: !alwaysOnTop })}
                    title={alwaysOnTop ? 'Unpin' : 'Always on top'}
                >
                    {alwaysOnTop ? <AiFillPushpin /> : <AiOutlinePushpin />}
                </Button>
                <Button isIconOnly size='sm' variant='light' onPress={onClose} title='Hide'>
                    <AiFillCloseCircle />
                </Button>
            </div>
        </div>
    );
}
