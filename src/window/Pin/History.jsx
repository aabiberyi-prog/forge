import { Button } from '@nextui-org/react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const appWindow = getCurrentWebviewWindow();

export default function PinHistory() {
    const { t } = useTranslation();
    const [items, setItems] = useState([]);
    const [error, setError] = useState('');
    const [page, setPage] = useState(0);
    const pageSize = 50;

    useEffect(() => {
        invoke('list_pin_history')
            .then(setItems)
            .catch((err) => setError(err?.message || String(err)));
        void appWindow.show();
    }, []);

    return (
        <div className='h-screen text-white p-3 flex flex-col gap-2' style={{ backgroundColor: 'rgb(24 24 27 / var(--pot-bg-opacity, 0.92))' }}>
            <div className='flex items-center justify-between'>
                <h1 className='text-sm font-semibold'>{t('pin.history_title')}</h1>
                <Button size='sm' variant='light' onPress={() => appWindow.close()}>
                    {t('pin.close')}
                </Button>
            </div>
            {error ? <div className='text-danger text-xs'>{error}</div> : null}
            <div className='flex-1 overflow-auto text-xs'>
                {items.slice(page * pageSize, (page + 1) * pageSize).map((item) => (
                    <button
                        key={item.id}
                        className='w-full text-left px-2 py-1.5 rounded hover:bg-white/10 disabled:opacity-40'
                        disabled={!item.exists}
                        onClick={async () => {
                            try {
                                await invoke('open_pin_from_path', { path: item.path });
                            } catch (err) {
                                setError(err?.message || t('pin.missing'));
                            }
                        }}
                    >
                        <div className='truncate'>{item.fileName}</div>
                        <div className='opacity-60'>
                            {item.source} · {item.createdAt}
                            {item.exists ? '' : ` · ${t('pin.missing')}`}
                        </div>
                    </button>
                ))}
            </div>
            <div className='flex items-center justify-between text-xs'>
                <Button size='sm' isDisabled={page === 0} onPress={() => setPage((value) => value - 1)}>{t('panel.prev')}</Button>
                <span>{page + 1} / {Math.max(1, Math.ceil(items.length / pageSize))} · {items.length}</span>
                <Button size='sm' isDisabled={(page + 1) * pageSize >= items.length} onPress={() => setPage((value) => value + 1)}>{t('panel.next')}</Button>
            </div>
        </div>
    );
}
