import { Button, Input, Slider, Tab, Tabs } from '@nextui-org/react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Image as TauriImage } from '@tauri-apps/api/image';
import { listen } from '@tauri-apps/api/event';
import { writeHtml, writeImage, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { invoke } from '@tauri-apps/api/core';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CopyItemEditor from './components/CopyItemEditor';
import CopyList from './components/CopyList';
import HistoryList from './components/HistoryList';
import TitleBar from './components/TitleBar';
import TodoInput from './components/TodoInput';
import TodoList from './components/TodoList';
import TodoStats from './components/TodoStats';
import { sortByOrder } from './copy';
import { eventTime, timestampMs, filterHistory, paginate, statusCounts } from './history';
import './style.css';

const appWindow = getCurrentWebviewWindow();
const CLIPBOARD_TIMEOUT_MS = 1800;

const defaultSettings = {
    opacity: 0.25,
    alwaysOnTop: false,
    locked: false,
    hoverBoost: true,
    window: { x: 0, y: 0, width: 320, height: 480 },
    schemaVersion: 1,
};

function upsertById(items, item) {
    return [...items.filter((current) => current.id !== item.id), item];
}

function sortHistory(tasks) {
    return [...tasks].sort((a, b) => (timestampMs(eventTime(b)) || 0) - (timestampMs(eventTime(a)) || 0));
}

function withTimeout(promise, timeoutMs) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error('clipboard write timeout')), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

async function writeHtmlOrText(payload) {
    try {
        await withTimeout(writeHtml(payload.html, payload.text), CLIPBOARD_TIMEOUT_MS);
    } catch {
        await withTimeout(writeText(payload.text), CLIPBOARD_TIMEOUT_MS);
    }
}

async function writeNativeImage(dataUrl) {
    const image = document.createElement('img');
    await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('image decode failed'));
        image.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const tauriImage = await TauriImage.new(new Uint8Array(imageData.data), canvas.width, canvas.height);
    try {
        await withTimeout(writeImage(tauriImage), CLIPBOARD_TIMEOUT_MS);
    } finally {
        await tauriImage.close().catch(() => {});
    }
}

export default function Panel() {
    const { t } = useTranslation();
    const [todos, setTodos] = useState([]);
    const [history, setHistory] = useState([]);
    const [copyItems, setCopyItems] = useState([]);
    const [settings, setSettings] = useState(defaultSettings);
    const [view, setView] = useState('active');
    const [copyEditorOpen, setCopyEditorOpen] = useState(false);
    const [editingCopyItem, setEditingCopyItem] = useState(null);
    const [notice, setNotice] = useState('');
    const [noticeKind, setNoticeKind] = useState('ok');
    const [hovering, setHovering] = useState(false);
    const [loadState, setLoadState] = useState('loading');
    const [loadError, setLoadError] = useState('');
    const [actionError, setActionError] = useState('');
    const [historyQuery, setHistoryQuery] = useState('');
    const [historyStatuses, setHistoryStatuses] = useState([]);
    const [historyFrom, setHistoryFrom] = useState('');
    const [historyTo, setHistoryTo] = useState('');
    const [historyPage, setHistoryPage] = useState(1);
    const noticeTimer = useRef(null);

    const showNotice = (text, kind = 'ok') => {
        if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
        setNoticeKind(kind);
        setNotice(text);
        noticeTimer.current = window.setTimeout(() => setNotice(''), 2200);
    };

    const reload = async ({ showWindow = false } = {}) => {
        const [settingsResult, tasksResult, historyResult, copyResult] = await Promise.allSettled([
            invoke('get_panel_settings'),
            invoke('list_tasks'),
            invoke('list_history_tasks'),
            invoke('list_copy_items'),
        ]);
        const failures = [settingsResult, tasksResult, historyResult, copyResult]
            .filter((result) => result.status === 'rejected')
            .map((result) => result.reason?.message || String(result.reason || 'load failed'));
        if (settingsResult.status === 'fulfilled') {
            setSettings({ ...defaultSettings, ...settingsResult.value });
        }
        if (tasksResult.status === 'fulfilled') setTodos(sortByOrder(tasksResult.value));
        if (historyResult.status === 'fulfilled') setHistory(sortHistory(historyResult.value));
        if (copyResult.status === 'fulfilled') setCopyItems(sortByOrder(copyResult.value));
        if (failures.length > 0) {
            setLoadState('error');
            setLoadError(failures[0]);
        } else {
            setLoadState('ready');
            setLoadError('');
        }
        if (showWindow) await appWindow.show();
    };

    useEffect(() => {
        reload({ showWindow: true });
        let unlisten = () => {};
        listen('desktop-todo-imported', () => {
            reload();
        }).then((fn) => {
            unlisten = fn;
        });
        return () => {
            unlisten();
            if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
        };
    }, []);

    const opacity = hovering && settings.hoverBoost ? Math.min(0.85, settings.opacity + 0.2) : settings.opacity;
    useEffect(() => {
        document.documentElement.style.setProperty('--panel-opacity', String(opacity));
    }, [opacity]);

    const completedTodos = useMemo(() => todos.filter((todo) => todo.done).length, [todos]);

    const perform = async (action, rethrow = false) => {
        try {
            const result = await action();
            setActionError('');
            return result;
        } catch (error) {
            const text = error?.message || String(error);
            setActionError(text);
            showNotice(text, 'error');
            if (rethrow) throw error;
            return undefined;
        }
    };

    const patchSettings = async (patch) => {
        const next = await invoke('set_panel_settings', { patch });
        setSettings({ ...defaultSettings, ...next });
    };

    const handleAddTodo = async (title) => {
        try {
            const task = await invoke('create_task', { title });
            setTodos((current) => sortByOrder([...current, task]));
            setView('active');
            setActionError('');
        } catch (error) {
            setActionError(error?.message || String(error));
            throw error;
        }
    };

    const handleToggleDone = async (id, done) => {
        await invoke('update_task', { patch: { id, done } });
        await reload();
    };

    const handleEdit = async (id, title) => {
        await invoke('update_task', { patch: { id, title } });
        await reload();
    };

    const handleRestore = async (id) => {
        await invoke('restore_task', { id });
        setView('active');
        await reload();
    };

    const handleDelete = async (id) => {
        await invoke('delete_task', { id });
        await reload();
    };

    const handleReorder = async (ids) => {
        const nextTodos = sortByOrder(
            ids.map((id, order) => ({ ...todos.find((item) => item.id === id), order })),
        );
        await invoke('reorder_tasks', { ids });
        setTodos(nextTodos);
    };

    const handleClearCompleted = async () => {
        const activeTasks = await invoke('clear_completed_tasks');
        const historyTasks = await invoke('list_history_tasks');
        setTodos(sortByOrder(activeTasks));
        setHistory(sortHistory(historyTasks));
        setView('history');
    };

    const handleSaveCopyItem = async (input) => {
        const item = editingCopyItem
            ? await invoke('update_copy_item', { id: editingCopyItem.id, input })
            : await invoke('create_copy_item', { input });
        setCopyItems((current) => sortByOrder(upsertById(current, item)));
        setCopyEditorOpen(false);
        setEditingCopyItem(null);
        setView('copy');
    };

    const handleCopyItem = async (id) => {
        const payload = await invoke('get_copy_payload', { id });
        if (payload.imageDataUrls?.length > 0) {
            try {
                await invoke('copy_image_files_to_clipboard', { id });
                showNotice(t('panel.copied_files'));
                return;
            } catch {
                try {
                    await writeNativeImage(payload.imageDataUrls[0]);
                    showNotice(t('panel.copied_image'));
                    return;
                } catch {
                    try {
                        await writeHtmlOrText(payload);
                        showNotice(t('panel.copied_text'), 'warn');
                    } catch (error) {
                        showNotice(error?.message || t('panel.copy_failed'), 'error');
                    }
                    return;
                }
            }
        }
        try {
            await writeHtmlOrText(payload);
            showNotice(t('panel.copied_text'));
        } catch (error) {
            showNotice(error?.message || t('panel.copy_failed'), 'error');
        }
    };

    const searchedHistory = useMemo(
        () =>
            filterHistory(history, {
                query: historyQuery,
                statuses: historyStatuses,
                from: historyFrom,
                to: historyTo,
            }),
        [history, historyQuery, historyStatuses, historyFrom, historyTo]
    );
    const counts = useMemo(
        () =>
            statusCounts(
                filterHistory(history, {
                    query: historyQuery,
                    statuses: [],
                    from: historyFrom,
                    to: historyTo,
                })
            ),
        [history, historyQuery, historyFrom, historyTo]
    );
    const historyPageView = useMemo(
        () => paginate(searchedHistory, historyPage),
        [searchedHistory, historyPage]
    );
    const resetHistoryFilters = () => {
        setHistoryQuery('');
        setHistoryStatuses([]);
        setHistoryFrom('');
        setHistoryTo('');
        setHistoryPage(1);
    };
    const toggleStatus = (status) => {
        setHistoryPage(1);
        setHistoryStatuses((current) =>
            current.includes(status) ? current.filter((item) => item !== status) : [...current, status]
        );
    };

    return (
        <div
            className='forge-panel'
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
        >
            <TitleBar
                settings={settings}
                onPatchSettings={(patch) => perform(() => patchSettings(patch))}
                onClose={() => perform(() => invoke('hide_panel_window'))}
            />
            <div className='forge-panel-body'>
                <div className={`forge-panel-notice ${noticeKind === 'error' ? 'is-error' : noticeKind === 'warn' ? 'is-warn' : ''}`}>
                    {notice}
                </div>
                {loadState === 'loading' ? <div className='text-xs opacity-70'>{t('panel.loading')}</div> : null}
                {loadState === 'error' ? (
                    <div className='flex items-center gap-2'>
                        <div className='text-danger text-xs flex-1'>{loadError || t('panel.load_failed')}</div>
                        <Button size='sm' variant='flat' onPress={() => reload()}>
                            {t('panel.retry')}
                        </Button>
                    </div>
                ) : null}
                <TodoInput onAddTodo={handleAddTodo} error={actionError} />
                <div className='flex items-center gap-2 text-xs opacity-70'>
                    <span>{t('panel.opacity')}</span>
                    <Slider
                        size='sm'
                        minValue={0.05}
                        maxValue={0.85}
                        step={0.05}
                        value={settings.opacity}
                        aria-label='panel opacity'
                        onChange={(value) => {
                            const opacity = Array.isArray(value) ? value[0] : value;
                            setSettings((current) => ({ ...current, opacity }));
                        }}
                        onChangeEnd={(value) => {
                            const opacity = Array.isArray(value) ? value[0] : value;
                            perform(() => patchSettings({ opacity }));
                        }}
                        className='flex-1'
                    />
                </div>
                <TodoStats total={todos.length} completed={completedTodos} onClearCompleted={() => perform(handleClearCompleted)} />
                <Tabs size='sm' selectedKey={view} onSelectionChange={setView}>
                    <Tab key='active' title={`${t('panel.active')} ${todos.length}`} />
                    <Tab key='history' title={`${t('panel.history')} ${history.length}`} />
                    <Tab key='copy' title={`${t('panel.clips')} ${copyItems.length}`} />
                </Tabs>
                <div className='forge-panel-list'>
                    {view === 'active' && (
                        <TodoList
                            todos={todos}
                            onToggleDone={(id, done) => perform(() => handleToggleDone(id, done))}
                            onDelete={(id) => perform(() => handleDelete(id))}
                            onEdit={(id, title) => perform(() => handleEdit(id, title), true)}
                            onReorder={(ids) => perform(() => handleReorder(ids))}
                        />
                    )}
                    {view === 'history' && (
                        <div>
                            <Input
                                size='sm'
                                value={historyQuery}
                                onValueChange={(value) => {
                                    setHistoryQuery(value);
                                    setHistoryPage(1);
                                }}
                                placeholder={t('panel.search_placeholder')}
                                className='mb-2'
                            />
                            <div className='flex flex-wrap gap-1 mb-2'>
                                {['completed', 'archived', 'deleted'].map((status) => (
                                    <Button
                                        key={status}
                                        size='sm'
                                        variant={historyStatuses.includes(status) ? 'solid' : 'flat'}
                                        onPress={() => toggleStatus(status)}
                                    >
                                        {t(`panel.status_${status}`)} {counts[status]}
                                    </Button>
                                ))}
                                <Button size='sm' variant='light' onPress={resetHistoryFilters}>
                                    {t('panel.reset_filters')}
                                </Button>
                            </div>
                            <div className='flex gap-2 mb-2'>
                                <Input
                                    size='sm'
                                    type='date'
                                    value={historyFrom}
                                    onValueChange={(value) => {
                                        setHistoryFrom(value);
                                        setHistoryPage(1);
                                    }}
                                    aria-label={t('panel.from_date')}
                                />
                                <Input
                                    size='sm'
                                    type='date'
                                    value={historyTo}
                                    onValueChange={(value) => {
                                        setHistoryTo(value);
                                        setHistoryPage(1);
                                    }}
                                    aria-label={t('panel.to_date')}
                                />
                            </div>
                            <div className='text-[11px] opacity-60 mb-1'>
                                {t('panel.history_count', { count: historyPageView.total })}
                            </div>
                            <HistoryList
                                tasks={historyPageView.items}
                                emptyLabel={
                                    loadState === 'error' ? t('panel.load_failed') : t('panel.history_empty')
                                }
                                onRestore={(id) => perform(() => handleRestore(id))}
                            />
                            {historyPageView.pageCount > 1 ? (
                                <div className='flex items-center justify-between mt-2 text-xs'>
                                    <Button
                                        size='sm'
                                        variant='light'
                                        isDisabled={historyPageView.page <= 1}
                                        onPress={() => setHistoryPage((page) => page - 1)}
                                    >
                                        {t('panel.prev')}
                                    </Button>
                                    <span>
                                        {historyPageView.page} / {historyPageView.pageCount}
                                    </span>
                                    <Button
                                        size='sm'
                                        variant='light'
                                        isDisabled={historyPageView.page >= historyPageView.pageCount}
                                        onPress={() => setHistoryPage((page) => page + 1)}
                                    >
                                        {t('panel.next')}
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    )}
                    {view === 'copy' && (
                        <CopyList
                            items={copyItems}
                            onCreate={() => {
                                setEditingCopyItem(null);
                                setCopyEditorOpen(true);
                            }}
                            onCopy={(id) => perform(() => handleCopyItem(id))}
                            onEdit={(id) => perform(async () => {
                                setEditingCopyItem(await invoke('get_copy_item', { id }));
                                setCopyEditorOpen(true);
                            })}
                            onDelete={(id) => perform(async () => {
                                await invoke('delete_copy_item', { id });
                                setCopyItems((current) => current.filter((item) => item.id !== id));
                            })}
                            onReorder={(ids) => perform(async () => {
                                const nextItems = sortByOrder(
                                    ids.map((id, order) => ({ ...copyItems.find((item) => item.id === id), order })),
                                );
                                await invoke('reorder_copy_items', { ids });
                                setCopyItems(nextItems);
                            })}
                        />
                    )}
                </div>
            </div>
            <CopyItemEditor
                open={copyEditorOpen}
                item={editingCopyItem}
                onCancel={() => {
                    setCopyEditorOpen(false);
                    setEditingCopyItem(null);
                }}
                onSave={(input) => perform(() => handleSaveCopyItem(input), true)}
            />
        </div>
    );
}
