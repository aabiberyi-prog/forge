import { Button, Input, Select, SelectItem } from '@nextui-org/react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    DEFAULT_STYLE,
    TOOLS,
    createDraft,
    duplicateShape,
    hitTestShape,
    moveShape,
    renderScene,
    stepLabel,
} from './draw';
import { normalizeRect } from './regions';

const LABELS = {
    select: 'Select',
    rectangle: 'Rect',
    ellipse: 'Oval',
    arrow: 'Arrow',
    line: 'Line',
    freehand: 'Pen',
    text: 'Text',
    balloon: 'Balloon',
    step: 'Step',
    blur: 'Blur',
    highlight: 'Hi',
    spotlight: 'Spot',
    magnify: 'Mag',
    crop: 'Crop',
};

export default function Annotator({ imageSrc, pin, onCancel, onConfirm }) {
    const { t } = useTranslation();
    const canvasRef = useRef(null);
    const imageRef = useRef(null);
    const [tool, setTool] = useState('rectangle');
    const [shapes, setShapes] = useState([]);
    const [draft, setDraft] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const [style, setStyle] = useState(DEFAULT_STYLE);
    const [ready, setReady] = useState(false);
    const [editing, setEditing] = useState(null);
    const [error, setError] = useState(null);
    const dragRef = useRef(null);
    const clipboardRef = useRef(null);

    const selected = useMemo(
        () => shapes.find((shape) => shape.id === selectedId) || null,
        [shapes, selectedId]
    );

    const redraw = (nextShapes = shapes, nextDraft = draft, nextSelected = selectedId) => {
        const canvas = canvasRef.current;
        const image = imageRef.current;
        if (!canvas || !image || !image.complete) return;
        const ctx = canvas.getContext('2d');
        renderScene(ctx, image, nextShapes, { draft: nextDraft, selectedId: nextSelected });
    };

    useEffect(() => {
        redraw();
    }, [shapes, draft, selectedId, ready]);

    const canvasPoint = (event) => {
        const bounds = canvasRef.current.getBoundingClientRect();
        return {
            x: ((event.clientX - bounds.left) * canvasRef.current.width) / bounds.width,
            y: ((event.clientY - bounds.top) * canvasRef.current.height) / bounds.height,
        };
    };

    const patchSelected = (patch) => {
        if (!selectedId) {
            setStyle((current) => ({ ...current, ...patch }));
            return;
        }
        setShapes((current) => current.map((shape) => (shape.id === selectedId ? { ...shape, ...patch } : shape)));
        setStyle((current) => ({ ...current, ...patch }));
    };

    const commitDraft = (nextDraft) => {
        if (!nextDraft) return;
        if (nextDraft.tool === 'crop' && nextDraft.rect.width > 2 && nextDraft.rect.height > 2) {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            redraw(shapes, null, null);
            const cropped = ctx.getImageData(nextDraft.rect.left, nextDraft.rect.top, nextDraft.rect.width, nextDraft.rect.height);
            canvas.width = nextDraft.rect.width;
            canvas.height = nextDraft.rect.height;
            ctx.putImageData(cropped, 0, 0);
            imageRef.current.src = canvas.toDataURL('image/png');
            setShapes([]);
            setDraft(null);
            setSelectedId(null);
            return;
        }
        const stepShapes = [...shapes, nextDraft].filter((shape) => shape.tool === 'step');
        const labeled =
            nextDraft.tool === 'step'
                ? {
                      ...nextDraft,
                      label: stepLabel(stepShapes.length - 1, style.stepKind, style.stepStart),
                  }
                : nextDraft;
        setShapes((current) => [...current, labeled]);
        setSelectedId(labeled.id);
        setDraft(null);
        if (labeled.tool === 'text' || labeled.tool === 'balloon') {
            setEditing({ id: labeled.id, text: labeled.text || '' });
        }
    };

    const onPointerDown = (event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = canvasPoint(event);
        if (tool === 'select') {
            const hit = [...shapes].reverse().find((shape) => hitTestShape(shape, point.x, point.y));
            setSelectedId(hit?.id || null);
            if (hit) dragRef.current = { id: hit.id, x: point.x, y: point.y };
            return;
        }
        if (tool === 'step') {
            commitDraft({
                ...createDraft('step', point, style),
                x0: point.x,
                y0: point.y,
            });
            return;
        }
        if (tool === 'text') {
            commitDraft({ ...createDraft('text', point, style), text: '' });
            return;
        }
        setDraft(createDraft(tool, point, style));
    };

    const onPointerMove = (event) => {
        const point = canvasPoint(event);
        if (dragRef.current) {
            const dx = point.x - dragRef.current.x;
            const dy = point.y - dragRef.current.y;
            dragRef.current = { ...dragRef.current, x: point.x, y: point.y };
            setShapes((current) =>
                current.map((shape) => (shape.id === dragRef.current.id ? moveShape(shape, dx, dy) : shape))
            );
            return;
        }
        if (!draft) return;
        const next = {
            ...draft,
            x1: point.x,
            y1: point.y,
            points: draft.tool === 'freehand' ? [...draft.points, point] : draft.points,
            rect: normalizeRect(draft.x0, draft.y0, point.x, point.y),
            tailX: draft.tool === 'balloon' ? point.x : draft.tailX,
            tailY: draft.tool === 'balloon' ? point.y + 18 : draft.tailY,
        };
        setDraft(next);
    };

    const onPointerUp = () => {
        if (dragRef.current) {
            dragRef.current = null;
            return;
        }
        if (draft) commitDraft(draft);
    };

    const onKeyDown = (event) => {
        event.stopPropagation();
        if (editing) {
            if (event.key === 'Escape') setEditing(null);
            return;
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
            setShapes((current) => current.filter((shape) => shape.id !== selectedId));
            setSelectedId(null);
        }
        if (event.ctrlKey && event.key.toLowerCase() === 'd' && selected) {
            event.preventDefault();
            const copy = duplicateShape(selected);
            setShapes((current) => [...current, copy]);
            setSelectedId(copy.id);
        }
        if (event.ctrlKey && event.key.toLowerCase() === 'c' && selected) {
            clipboardRef.current = selected;
        }
        if (event.ctrlKey && event.key.toLowerCase() === 'v' && clipboardRef.current) {
            event.preventDefault();
            const copy = duplicateShape(clipboardRef.current);
            setShapes((current) => [...current, copy]);
            setSelectedId(copy.id);
        }
        if (event.ctrlKey && event.key === ']' && selectedId) {
            setShapes((current) => {
                const index = current.findIndex((shape) => shape.id === selectedId);
                if (index < 0 || index === current.length - 1) return current;
                const next = current.slice();
                const [item] = next.splice(index, 1);
                next.splice(index + 1, 0, item);
                return next;
            });
        }
        if (event.ctrlKey && event.key === '[' && selectedId) {
            setShapes((current) => {
                const index = current.findIndex((shape) => shape.id === selectedId);
                if (index <= 0) return current;
                const next = current.slice();
                const [item] = next.splice(index, 1);
                next.splice(index - 1, 0, item);
                return next;
            });
        }
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && selectedId) {
            event.preventDefault();
            const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
            const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
            const step = event.shiftKey ? 10 : 1;
            setShapes((current) =>
                current.map((shape) => (shape.id === selectedId ? moveShape(shape, dx * step, dy * step) : shape))
            );
        }
        if (event.key === 'Escape') onCancel();
    };

    const confirm = async () => {
        const canvas = canvasRef.current;
        const image = imageRef.current;
        const ctx = canvas.getContext('2d');
        renderScene(ctx, image, shapes, {});
        const png = canvas.toDataURL('image/png');
        try {
            const result = await onConfirm(png);
            if (result && result.error) {
                setError(result);
            }
        } catch (err) {
            setError({ error: err?.message || String(err), saved: false, copied: false, path: null });
        }
    };

    return (
        <div className='fixed inset-0 bg-black/70 flex flex-col items-center justify-center gap-2 p-3' onKeyDown={onKeyDown} tabIndex={0}>
            <img
                ref={imageRef}
                src={imageSrc}
                alt=''
                className='hidden'
                onLoad={(event) => {
                    const canvas = canvasRef.current;
                    canvas.width = event.target.naturalWidth;
                    canvas.height = event.target.naturalHeight;
                    setReady(true);
                }}
            />
            <canvas
                ref={canvasRef}
                className='max-w-[90vw] max-h-[68vh] bg-black cursor-crosshair'
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onDoubleClick={(event) => {
                    const point = canvasPoint(event);
                    const hit = [...shapes].reverse().find((shape) => hitTestShape(shape, point.x, point.y));
                    if (hit && (hit.tool === 'text' || hit.tool === 'balloon')) {
                        setEditing({ id: hit.id, text: hit.text || '' });
                    }
                }}
            />
            {editing ? (
                <textarea
                    autoFocus
                    className='absolute z-10 min-w-[180px] rounded bg-white text-black p-2 text-sm'
                    value={editing.text}
                    onChange={(event) => setEditing({ ...editing, text: event.target.value })}
                    onKeyDown={(event) => event.stopPropagation()}
                    onBlur={() => {
                        setShapes((current) =>
                            current.map((shape) => (shape.id === editing.id ? { ...shape, text: editing.text } : shape))
                        );
                        setEditing(null);
                    }}
                />
            ) : null}
            <div className='flex flex-wrap gap-1 justify-center max-w-[960px]'>
                <Button size='sm' variant={tool === 'select' ? 'solid' : 'flat'} onPress={() => setTool('select')}>
                    {t('screenshot.select')}
                </Button>
                {TOOLS.map((name) => (
                    <Button
                        key={name}
                        size='sm'
                        variant={tool === name ? 'solid' : 'flat'}
                        color={tool === name ? 'primary' : 'default'}
                        onPress={() => setTool(name)}
                    >
                        {t(`screenshot.tool_${name}`, { defaultValue: LABELS[name] })}
                    </Button>
                ))}
                <Button size='sm' variant='flat' onPress={() => setShapes((current) => current.slice(0, -1))}>
                    {t('screenshot.undo')}
                </Button>
                <Button size='sm' variant='light' onPress={onCancel}>
                    {t('screenshot.cancel')}
                </Button>
                <Button size='sm' color='success' onPress={confirm}>
                    {pin ? t('screenshot.pin') : t('screenshot.save')}
                </Button>
            </div>
            <div className='flex flex-wrap items-center gap-2 text-xs text-white/80'>
                <input
                    type='color'
                    value={selected?.color || style.color}
                    onChange={(event) => patchSelected({ color: event.target.value })}
                    aria-label={t('screenshot.color')}
                />
                <Input
                    size='sm'
                    type='number'
                    className='w-20'
                    value={String(selected?.strokeWidth || style.strokeWidth)}
                    onValueChange={(value) => patchSelected({ strokeWidth: Number(value) || 1 })}
                    aria-label={t('screenshot.stroke')}
                />
                <Select
                    size='sm'
                    className='w-28'
                    selectedKeys={[selected?.strokeStyle || style.strokeStyle]}
                    onSelectionChange={(keys) => patchSelected({ strokeStyle: Array.from(keys)[0] })}
                    aria-label={t('screenshot.stroke_style')}
                >
                    <SelectItem key='solid'>{t('screenshot.solid')}</SelectItem>
                    <SelectItem key='dash'>{t('screenshot.dash')}</SelectItem>
                </Select>
                <Input
                    size='sm'
                    type='number'
                    className='w-20'
                    value={String(selected?.fontSize || style.fontSize)}
                    onValueChange={(value) => patchSelected({ fontSize: Number(value) || 12 })}
                    aria-label={t('screenshot.font_size')}
                />
                <Input
                    size='sm'
                    className='w-28'
                    value={selected?.fontFamily || style.fontFamily}
                    onValueChange={(value) => patchSelected({ fontFamily: value })}
                    aria-label={t('screenshot.font_family')}
                />
                <Input
                    size='sm'
                    type='number'
                    className='w-20'
                    value={String(selected?.blurRadius || style.blurRadius)}
                    onValueChange={(value) => patchSelected({ blurRadius: Number(value) || 1 })}
                    aria-label={t('screenshot.blur')}
                />
                <Button
                    size='sm'
                    variant='flat'
                    onPress={() => selected && setShapes((current) => [...current, duplicateShape(selected)])}
                >
                    {t('screenshot.duplicate')}
                </Button>
                <Button
                    size='sm'
                    variant='flat'
                    onPress={() => patchSelected({ rotation: ((selected?.rotation || style.rotation || 0) + 15) % 360 })}
                >
                    {t('screenshot.rotate')}
                </Button>
            </div>
            {error ? (
                <div className='text-danger text-xs flex items-center gap-2'>
                    <span>
                        {error.saved ? t('screenshot.saved') : t('screenshot.save_failed')}
                        {error.copied ? ` · ${t('screenshot.copied')}` : ` · ${t('screenshot.copy_failed')}`}
                        {error.error ? ` · ${error.error}` : ''}
                    </span>
                    {error.saved && !error.copied && error.path ? (
                        <Button size='sm' variant='flat' onPress={() => onConfirm(null, { retryPath: error.path })}>
                            {t('screenshot.retry_copy')}
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
