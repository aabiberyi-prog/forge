import { Slider, Tab, Tabs } from '@nextui-org/react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Image as TauriImage } from '@tauri-apps/api/image';
import { writeHtml, writeImage, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { invoke } from '@tauri-apps/api/core';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import CopyItemEditor from './components/CopyItemEditor';
import CopyList from './components/CopyList';
import HistoryList from './components/HistoryList';
import TitleBar from './components/TitleBar';
import TodoInput from './components/TodoInput';
import TodoList from './components/TodoList';
import TodoStats from './components/TodoStats';
import { sortByOrder } from './copy';
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

function isHistoryTask(task) {
    return Boolean(task.done || task.archivedAt || task.deletedAt);
}

function upsertById(items, item) {
    return [...items.filter((current) => current.id !== item.id), item];
}

function sortHistory(tasks) {
    return [...tasks].sort((a, b) => {
        const aTime = a.deletedAt || a.archivedAt || a.completedAt || a.updatedAt || '';
        const bTime = b.deletedAt || b.archivedAt || b.completedAt || b.updatedAt || '';
        return String(bTime).localeCompare(String(aTime));
    });
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
    const [todos, setTodos] = useState([]);
    const [history, setHistory] = useState([]);
    const [copyItems, setCopyItems] = useState([]);
    const [settings, setSettings] = useState(defaultSettings);
    const [view, setView] = useState('active');
    const [copyEditorOpen, setCopyEditorOpen] = useState(false);
    const [editingCopyItem, setEditingCopyItem] = useState(null);
    const [notice, setNotice] = useState('');
    const [hovering, setHovering] = useState(false);
    const noticeTimer = useRef(null);

    const showNotice = (text) => {
        if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
        setNotice(text);
        noticeTimer.current = window.setTimeout(() => setNotice(''), 1600);
    };

    useEffect(() => {
        const bootstrap = async () => {
            const [loadedSettings, loadedTasks, loadedHistory, loadedCopyItems] = await Promise.all([
                invoke('get_panel_settings').catch(() => defaultSettings),
                invoke('list_tasks').catch(() => []),
                invoke('list_history_tasks').catch(() => []),
                invoke('list_copy_items').catch(() => []),
            ]);
            setSettings({ ...defaultSettings, ...loadedSettings });
            setTodos(sortByOrder(loadedTasks));
            setHistory(sortHistory(loadedHistory));
            setCopyItems(sortByOrder(loadedCopyItems));
            await appWindow.show();
        };
        bootstrap();
        return () => {
            if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
        };
    }, []);

    const opacity = hovering && settings.hoverBoost ? Math.min(0.85, settings.opacity + 0.2) : settings.opacity;
    useEffect(() => {
        document.documentElement.style.setProperty('--panel-opacity', String(opacity));
    }, [opacity]);

    const completedTodos = useMemo(() => todos.filter((todo) => todo.done).length, [todos]);

    const patchSettings = async (patch) => {
        const next = await invoke('set_panel_settings', { patch });
        setSettings({ ...defaultSettings, ...next });
    };

    const handleAddTodo = async (title) => {
        const task = await invoke('create_task', { title });
        setTodos((current) => sortByOrder([...current, task]));
        setView('active');
    };

    const handleToggleDone = async (id, done) => {
        const task = await invoke('update_task', { patch: { id, done } });
        setTodos((current) => sortByOrder(current.map((item) => (item.id === id ? task : item))));
        setHistory((current) => {
            if (!isHistoryTask(task)) return current.filter((item) => item.id !== task.id);
            return sortHistory(upsertById(current, task));
        });
    };

    const handleEdit = async (id, title) => {
        const task = await invoke('update_task', { patch: { id, title } });
        setTodos((current) => sortByOrder(current.map((item) => (item.id === id ? task : item))));
    };

    const handleDelete = async (id) => {
        const task = await invoke('delete_task', { id });
        setTodos((current) => current.filter((todo) => todo.id !== id));
        setHistory((current) => sortHistory(upsertById(current, task)));
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
            } catch {
                try {
                    await writeNativeImage(payload.imageDataUrls[0]);
                } catch {
                    await writeHtmlOrText(payload);
                }
            }
        } else {
            await writeHtmlOrText(payload);
        }
        showNotice('Copied');
    };

    return (
        <div
            className='forge-panel'
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
        >
            <TitleBar
                settings={settings}
                onPatchSettings={patchSettings}
                onClose={() => invoke('hide_panel_window')}
            />
            <div className='forge-panel-body'>
                <div className='forge-panel-notice'>{notice}</div>
                <TodoInput onAddTodo={handleAddTodo} />
                <div className='flex items-center gap-2 text-xs opacity-70'>
                    <span>Opacity</span>
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
                            patchSettings({ opacity });
                        }}
                        className='flex-1'
                    />
                </div>
                <TodoStats total={todos.length} completed={completedTodos} onClearCompleted={handleClearCompleted} />
                <Tabs size='sm' selectedKey={view} onSelectionChange={setView}>
                    <Tab key='active' title={`Now ${todos.length}`} />
                    <Tab key='history' title={`History ${history.length}`} />
                    <Tab key='copy' title={`Clips ${copyItems.length}`} />
                </Tabs>
                <div className='forge-panel-list'>
                    {view === 'active' && (
                        <TodoList
                            todos={todos}
                            onToggleDone={handleToggleDone}
                            onDelete={handleDelete}
                            onEdit={handleEdit}
                            onReorder={handleReorder}
                        />
                    )}
                    {view === 'history' && <HistoryList tasks={history} />}
                    {view === 'copy' && (
                        <CopyList
                            items={copyItems}
                            onCreate={() => {
                                setEditingCopyItem(null);
                                setCopyEditorOpen(true);
                            }}
                            onCopy={handleCopyItem}
                            onEdit={async (id) => {
                                setEditingCopyItem(await invoke('get_copy_item', { id }));
                                setCopyEditorOpen(true);
                            }}
                            onDelete={async (id) => {
                                await invoke('delete_copy_item', { id });
                                setCopyItems((current) => current.filter((item) => item.id !== id));
                            }}
                            onReorder={async (ids) => {
                                const nextItems = sortByOrder(
                                    ids.map((id, order) => ({ ...copyItems.find((item) => item.id === id), order })),
                                );
                                await invoke('reorder_copy_items', { ids });
                                setCopyItems(nextItems);
                            }}
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
                onSave={handleSaveCopyItem}
            />
        </div>
    );
}
