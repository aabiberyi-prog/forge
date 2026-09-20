import { Button, Input, Select, SelectItem } from '@nextui-org/react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    DEFAULT_STYLE,
    TOOLS,
    createDraft,
    duplicateShape,
    hitTestShape,
    hitShapeHandle,
    resizeShape,
    isEditingTarget,
    shapeRect,
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

export default function Annotator({ imageSrc, pin, notice, onCancel, onConfirm }) {
    const { t } = useTranslation();
    const canvasRef = useRef(null);
    const imageRef = useRef(null);
    const [tool, setTool] = useState('rectangle');
    const [shapes, setShapes] = useState([]);
    const [draft, setDraft] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const [style, setStyle] = useState(DEFAULT_STYLE);
    const [ready, setReady] = useState(0);
    const [editing, setEditing] = useState(null);
    const [error, setError] = useState(null);
    const dragRef = useRef(null);
    const clipboardRef = useRef(null);
    const savingRef = useRef(false);
    const [saving, setSaving] = useState(false);

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
        const stepShapes = shapes.filter((shape) => shape.tool === 'step');
        const stepIndex = Math.max(-1, ...stepShapes.map((shape, index) => shape.stepIndex ?? index)) + 1;
        const labeled =
            nextDraft.tool === 'step'
                ? {
                      ...nextDraft,
                      stepIndex,
                      label: stepLabel(stepIndex, style.stepKind, style.stepStart),
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
        if (event.button !== 0 || !ready || savingRef.current) return;
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = canvasPoint(event);
        if (tool === 'select') {
            const handle = selected && hitShapeHandle(selected, point.x, point.y);
            if (handle) {
                dragRef.current = { id: selected.id, original: selected, handle, x: point.x, y: point.y };
                return;
            }
            const hit = [...shapes].reverse().find((shape) => hitTestShape(shape, point.x, point.y));
            setSelectedId(hit?.id || null);
            if (hit) dragRef.current = { id: hit.id, original: hit, x: point.x, y: point.y };
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
            const { id, original, handle, x, y } = dragRef.current;
            setShapes((current) =>
                current.map((shape) => shape.id === id
                    ? handle ? resizeShape(original, handle, point.x, point.y) : moveShape(original, point.x - x, point.y - y)
                    : shape)
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
        if (isEditingTarget(event.target) || event.nativeEvent?.isComposing || savingRef.current) return;
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

    const confirm = async (retryPath = null) => {
        if (!ready || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        const canvas = canvasRef.current;
        const image = imageRef.current;
        try {
            const ctx = canvas.getContext('2d');
            const committed = editing ? shapes.map((shape) => shape.id === editing.id ? { ...shape, text: editing.text } : shape) : shapes;
            renderScene(ctx, image, committed, {});
            const result = await onConfirm(retryPath ? null : canvas.toDataURL('image/png'), retryPath ? { retryPath } : undefined);
            setError(result?.error ? result : null);
        } catch (err) {
            setError({ error: err?.message || String(err), saved: Boolean(retryPath), copied: false, path: retryPath });
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    return (
        <div className='fixed inset-0 bg-black/70 flex flex-col items-center justify-center gap-2 p-3' onKeyDown={onKeyDown} tabIndex={0}>
            {notice ? <div role='status' className='text-warning text-sm'>{notice}</div> : null}
            <img
                ref={imageRef}
                src={imageSrc}
                alt=''
                className='hidden'
                onLoad={(event) => {
                    const canvas = canvasRef.current;
                    canvas.width = event.target.naturalWidth;
                    canvas.height = event.target.naturalHeight;
                    setReady((version) => version + 1);
                }}
            />
            <canvas
                ref={canvasRef}
                tabIndex={0}
                className='max-w-[90vw] max-h-[68vh] bg-black cursor-crosshair'
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => {
                    if (dragRef.current) {
                        const { id, original } = dragRef.current;
                        setShapes((current) => current.map((shape) => shape.id === id ? original : shape));
                    }
                    dragRef.current = null;
                    setDraft(null);
                }}
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
                    style={(() => {
                        const shape = shapes.find((item) => item.id === editing.id);
                        const bounds = canvasRef.current?.getBoundingClientRect();
                        if (!shape || !bounds) return {};
                        const rect = shapeRect(shape);
                        return { left: bounds.left + rect.left * bounds.width / canvasRef.current.width,
                            top: bounds.top + rect.top * bounds.height / canvasRef.current.height };
                    })()}
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
                <Button size='sm' color='success' isDisabled={!ready} isLoading={saving} onPress={() => confirm()}>
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
                    onValueChange={(value) => patchSelected({ strokeWidth: Math.min(64, Math.max(1, Number(value) || 1)) })}
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
                    <SelectItem key='dot'>{t('screenshot.dot')}</SelectItem>
                </Select>
                <Input
                    size='sm'
                    type='number'
                    className='w-20'
                    value={String(selected?.fontSize || style.fontSize)}
                    onValueChange={(value) => patchSelected({ fontSize: Math.min(256, Math.max(8, Number(value) || 12)) })}
                    aria-label={t('screenshot.font_size')}
                />
                <Input
                    size='sm'
                    className='w-28'
                    value={selected?.fontFamily || style.fontFamily}
                    onValueChange={(value) => patchSelected({ fontFamily: value })}
                    aria-label={t('screenshot.font_family')}
                />
                <Select size='sm' className='w-32' aria-label={t('screenshot.font_style')}
                    selectedKeys={[selected?.fontStyle || style.fontStyle]}
                    onSelectionChange={(keys) => patchSelected({ fontStyle: Array.from(keys)[0] || 'normal' })}>
                    {['normal', 'bold', 'italic', 'bold italic'].map((value) => <SelectItem key={value}>{t(`screenshot.font_${value.replace(' ', '_')}`)}</SelectItem>)}
                </Select>
                <Select size='sm' className='w-32' aria-label={t('screenshot.arrow_style')}
                    selectedKeys={[selected?.arrowStyle || style.arrowStyle]}
                    onSelectionChange={(keys) => patchSelected({ arrowStyle: Array.from(keys)[0] || 'single' })}>
                    {['single', 'double', 'none'].map((value) => <SelectItem key={value}>{t(`screenshot.arrow_${value}`)}</SelectItem>)}
                </Select>
                <Select size='sm' className='w-28' aria-label={t('screenshot.step_kind')}
                    selectedKeys={[selected?.stepKind || style.stepKind]}
                    onSelectionChange={(keys) => patchSelected({ stepKind: Array.from(keys)[0] || 'number' })}>
                    <SelectItem key='number'>1, 2, 3</SelectItem><SelectItem key='alpha'>A, B, C</SelectItem>
                </Select>
                <Input size='sm' type='number' className='w-20' min={1} aria-label={t('screenshot.step_start')}
                    value={String(selected?.stepStart || style.stepStart)}
                    onValueChange={(value) => patchSelected({ stepStart: Math.max(1, Math.floor(Number(value) || 1)) })} />
                <Input size='sm' type='number' className='w-20' min={1} max={8} step={0.25} aria-label={t('screenshot.magnify_scale')}
                    value={String(selected?.magnifyScale || style.magnifyScale)}
                    onValueChange={(value) => patchSelected({ magnifyScale: Math.min(8, Math.max(1, Number(value) || 2)) })} />
                <Input
                    size='sm'
                    type='number'
                    className='w-20'
                    value={String(selected?.blurRadius || style.blurRadius)}
                    onValueChange={(value) => patchSelected({ blurRadius: Math.min(64, Math.max(1, Number(value) || 1)) })}
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
                        <Button size='sm' variant='flat' isLoading={saving} onPress={() => confirm(error.path)}>
                            {t('screenshot.retry_copy')}
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
