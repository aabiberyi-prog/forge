import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuMousePointer2, LuRectangleHorizontal, LuCircle, LuArrowUpRight, LuMinus, LuPencil, LuType,
    LuMessageSquare, LuListOrdered, LuScanLine, LuHighlighter, LuFocus, LuZoomIn, LuCrop,
    LuCopy, LuRotateCw, LuTrash2, LuMoveUp, LuMoveDown, LuSave, LuX, LuUndo2, LuPin } from 'react-icons/lu';
import './style.css';
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

const ICONS = { select: LuMousePointer2, rectangle: LuRectangleHorizontal, ellipse: LuCircle, arrow: LuArrowUpRight,
    line: LuMinus, freehand: LuPencil, text: LuType, balloon: LuMessageSquare, step: LuListOrdered,
    blur: LuScanLine, highlight: LuHighlighter, spotlight: LuFocus, magnify: LuZoomIn, crop: LuCrop };
const TOOL_KEYS = { v: 'select', r: 'rectangle', e: 'ellipse', a: 'arrow', l: 'line', f: 'freehand',
    t: 'text', o: 'balloon', n: 'step', b: 'blur', h: 'highlight', s: 'spotlight', m: 'magnify', c: 'crop' };

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
    const [loadError, setLoadError] = useState('');
    const surfaceRef = useRef(null);

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

    const editText = (shape) => {
        if (!shape || !['text', 'balloon'].includes(shape.tool)) return;
        setTool('select');
        setSelectedId(shape.id);
        setEditing({ id: shape.id, text: shape.text || '' });
    };

    const finishText = (commit = true) => {
        if (!editing) return;
        const original = shapes.find(shape => shape.id === editing.id);
        const text = commit ? editing.text : original?.text || '';
        setShapes((current) => current.flatMap((shape) => shape.id !== editing.id ? [shape]
            : text.trim() ? [{ ...shape, text }] : []));
        if (!text.trim()) setSelectedId(null);
        setEditing(null);
        setTool('select');
    };

    const chooseTool = (name) => {
        finishText();
        setTool(name);
        setSelectedId(null);
        setDraft(null);
    };

    const deleteSelected = () => {
        setShapes((current) => current.filter((shape) => shape.id !== selectedId));
        setSelectedId(null);
    };

    const reorderSelected = (offset) => setShapes((current) => {
        const index = current.findIndex((shape) => shape.id === selectedId);
        if (index < 0 || index + offset < 0 || index + offset >= current.length) return current;
        const next = current.slice();
        const [item] = next.splice(index, 1);
        next.splice(index + offset, 0, item);
        return next;
    });

    const commitDraft = (nextDraft) => {
        if (!nextDraft) return;
        if (nextDraft.tool === 'crop' && nextDraft.rect.width > 2 && nextDraft.rect.height > 2) {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            renderScene(ctx, imageRef.current, [], {});
            const cropped = ctx.getImageData(nextDraft.rect.left, nextDraft.rect.top, nextDraft.rect.width, nextDraft.rect.height);
            canvas.width = nextDraft.rect.width;
            canvas.height = nextDraft.rect.height;
            ctx.putImageData(cropped, 0, 0);
            imageRef.current.src = canvas.toDataURL('image/png');
            const rect = nextDraft.rect;
            setShapes((current) => current.filter((shape) => {
                const bounds = shapeRect(shape);
                return bounds.left + bounds.width > rect.left && bounds.top + bounds.height > rect.top
                    && bounds.left < rect.left + rect.width && bounds.top < rect.top + rect.height;
            }).map((shape) => moveShape(shape, -rect.left, -rect.top)));
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
        const hit = [...shapes].reverse().find((shape) => hitTestShape(shape, point.x, point.y));
        if (hit && ['text', 'balloon'].includes(hit.tool) && tool === 'text' && !event.ctrlKey) {
            event.preventDefault();
            editText(hit);
            return;
        }
        if (hit && tool !== 'select' && tool !== 'crop' && !event.ctrlKey) {
            setTool('select');
            setSelectedId(hit.id);
            dragRef.current = { id: hit.id, original: hit, x: point.x, y: point.y };
            return;
        }
        if (tool === 'select') {
            const handle = selected && hitShapeHandle(selected, point.x, point.y);
            if (handle) {
                dragRef.current = { id: selected.id, original: selected, handle, x: point.x, y: point.y };
                return;
            }
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
            // Keep the new textarea focused instead of the canvas's default mousedown focus.
            event.preventDefault();
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
        if (event.nativeEvent?.isComposing || savingRef.current) return;
        if (event.ctrlKey && event.key.toLowerCase() === 's') { event.preventDefault(); void confirm(); return; }
        if (isEditingTarget(event.target)) return;
        if (event.target?.tagName === 'BUTTON' && ['Enter', ' '].includes(event.key)) return;
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
        if (event.key === 'Escape') {
            if (draft) { setDraft(null); dragRef.current = null; }
            else if (selectedId) setSelectedId(null);
            else onCancel();
        }
        if (event.key === 'Enter' && selected && ['text', 'balloon'].includes(selected.tool)) {
            event.preventDefault(); editText(selected); return;
        }
        if (event.key === 'Enter') { event.preventDefault(); void confirm(); return; }
        if (!event.ctrlKey && !event.altKey && !event.metaKey && TOOL_KEYS[event.key.toLowerCase()]) {
            event.preventDefault(); chooseTool(TOOL_KEYS[event.key.toLowerCase()]);
        }
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

    const activeTool = selected?.tool || tool;
    const textTool = ['text', 'balloon', 'step'].includes(activeTool);
    const strokeTool = ['rectangle', 'ellipse', 'arrow', 'line', 'freehand', 'balloon', 'step'].includes(activeTool);
    const properties = [
        ...(!['select', 'crop', 'blur', 'magnify'].includes(activeTool) ? [{ key: 'color', label: 'color', type: 'color' }] : []),
        ...(strokeTool ? [
            { key: 'strokeWidth', label: 'stroke', type: 'number', min: 1, max: 64 },
            { key: 'strokeStyle', label: 'stroke_style', options: ['solid', 'dash', 'dot'].map(value => [value, t(`screenshot.${value}`)]) },
        ] : []),
        ...(textTool ? [
            { key: 'fontSize', label: 'font_size', type: 'number', min: 8, max: 256 },
            { key: 'fontFamily', label: 'font_family', type: 'text' },
            { key: 'fontStyle', label: 'font_style', options: ['normal', 'bold', 'italic', 'bold italic'].map(value => [value, t(`screenshot.font_${value.replace(' ', '_')}`)]) },
        ] : []),
        ...(activeTool === 'arrow' ? [{ key: 'arrowStyle', label: 'arrow_style', options: ['single', 'double', 'none'].map(value => [value, t(`screenshot.arrow_${value}`)]) }] : []),
        ...(activeTool === 'step' ? [
            { key: 'stepKind', label: 'step_kind', options: [['number', '1, 2, 3'], ['alpha', 'A, B, C']] },
            { key: 'stepStart', label: 'step_start', type: 'number', min: 1, max: 999 },
        ] : []),
        ...(activeTool === 'blur' ? [{ key: 'blurRadius', label: 'blur', type: 'number', min: 1, max: 64 }] : []),
        ...(activeTool === 'magnify' ? [{ key: 'magnifyScale', label: 'magnify_scale', type: 'number', min: 1, max: 8, step: 0.25 }] : []),
    ];

    return (
        <div className='capture-editor' onKeyDown={onKeyDown} tabIndex={0}>
            <div className='capture-tools' role='toolbar' aria-label={t('screenshot.tools')}>
                {['select', ...TOOLS].map((name) => {
                    const Icon = ICONS[name];
                    const label = name === 'select' ? t('screenshot.select') : t(`screenshot.tool_${name}`, { defaultValue: LABELS[name] });
                    const shortcut = Object.keys(TOOL_KEYS).find(key => TOOL_KEYS[key] === name)?.toUpperCase();
                    return <button key={name} type='button' className='capture-tool' aria-label={label}
                        aria-pressed={tool === name} title={`${label} (${shortcut})`} onClick={() => chooseTool(name)}>
                        <Icon aria-hidden='true' /><span>{label}</span>
                    </button>;
                })}
            </div>
            <div className='capture-properties' role='group' aria-label={t('screenshot.properties')}>
                <span className='capture-property-context'>{selected ? t('screenshot.selected_object') : t('screenshot.new_object')}</span>
                {properties.map(({ key, label, options, type, min, max, step }) => (
                    <label className='capture-field' key={key}>
                        <span>{t(`screenshot.${label}`)}</span>
                        {options ? <select aria-label={t(`screenshot.${label}`)} value={selected?.[key] ?? style[key] ?? ''}
                            onChange={(event) => patchSelected({ [key]: event.target.value })}>
                            {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                        </select> : <input type={type} aria-label={t(`screenshot.${label}`)} min={min} max={max} step={step}
                            value={selected?.[key] ?? style[key] ?? ''} onChange={(event) => patchSelected({
                                [key]: type === 'number' ? Math.min(max, Math.max(min, Number(event.target.value) || min)) : event.target.value,
                            })} />}
                    </label>
                ))}
                {!properties.length ? <span className='capture-hint'>{t('screenshot.select_hint')}</span> : null}
                {selected && ['text', 'balloon'].includes(selected.tool) ? <button type='button' className='capture-action'
                    onClick={() => editText(selected)}><LuType aria-hidden='true' />{t('screenshot.edit_text')}</button> : null}
            </div>
            {notice ? <div role='status' className='capture-notice'>{notice}</div> : null}
            {loadError ? <div role='alert' className='capture-error'>{loadError}</div> : null}
            <div className='capture-workspace' ref={surfaceRef}>
                <img ref={imageRef} crossOrigin='anonymous' src={imageSrc} alt='' hidden
                    onError={() => { setReady(0); setLoadError(t('screenshot.load_failed')); }}
                    onLoad={(event) => {
                        setLoadError('');
                        canvasRef.current.width = event.target.naturalWidth;
                        canvasRef.current.height = event.target.naturalHeight;
                        setReady((version) => version + 1);
                    }} />
                <canvas ref={canvasRef} tabIndex={0} className='capture-canvas' aria-label={t('screenshot.canvas')}
                    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
                    onPointerCancel={() => {
                        if (dragRef.current) {
                            const { id, original } = dragRef.current;
                            setShapes((current) => current.map((shape) => shape.id === id ? original : shape));
                        }
                        dragRef.current = null; setDraft(null);
                    }}
                    onDoubleClick={(event) => {
                        const point = canvasPoint(event);
                        editText([...shapes].reverse().find((shape) => hitTestShape(shape, point.x, point.y)));
                    }} />
                {editing ? <textarea autoFocus className='capture-text-editor' aria-label={t('screenshot.edit_text')}
                    style={(() => {
                        const shape = shapes.find(item => item.id === editing.id);
                        const bounds = canvasRef.current?.getBoundingClientRect();
                        const parent = surfaceRef.current?.getBoundingClientRect();
                        if (!shape || !bounds || !parent) return {};
                        const rect = shapeRect(shape), scale = bounds.width / canvasRef.current.width;
                        return { left: Math.max(0, bounds.left - parent.left + rect.left * scale + surfaceRef.current.scrollLeft),
                            top: Math.max(0, bounds.top - parent.top + rect.top * scale + surfaceRef.current.scrollTop),
                            fontSize: Math.max(14, (shape.fontSize || 20) * scale), fontFamily: shape.fontFamily || style.fontFamily };
                    })()}
                    value={editing.text} onChange={(event) => setEditing({ ...editing, text: event.target.value })}
                    onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.nativeEvent?.isComposing) return;
                        if (event.key === 'Escape') { event.preventDefault(); finishText(false); }
                        if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); finishText(); }
                        if (event.ctrlKey && event.key.toLowerCase() === 's') { event.preventDefault(); void confirm(); }
                    }} onBlur={() => finishText()} /> : null}
            </div>
            <div className='capture-object-actions' role='toolbar' aria-label={t('screenshot.object_actions')}>
                <button type='button' title={t('screenshot.undo')} disabled={!shapes.length} onClick={() => { setShapes(current => current.slice(0, -1)); setSelectedId(null); }}><LuUndo2 />{t('screenshot.undo')}</button>
                <button type='button' disabled={!selected} onClick={() => { if (selected) { const copy = duplicateShape(selected); setShapes(current => [...current, copy]); setSelectedId(copy.id); } }}><LuCopy />{t('screenshot.duplicate')}</button>
                <button type='button' disabled={!selected} onClick={() => patchSelected({ rotation: ((selected?.rotation || 0) + 15) % 360 })}><LuRotateCw />{t('screenshot.rotate')}</button>
                <button type='button' disabled={!selected} onClick={() => reorderSelected(1)}><LuMoveUp />{t('screenshot.layer_forward')}</button>
                <button type='button' disabled={!selected} onClick={() => reorderSelected(-1)}><LuMoveDown />{t('screenshot.layer_backward')}</button>
                <button type='button' disabled={!selected} onClick={deleteSelected}><LuTrash2 />{t('screenshot.delete_object')}</button>
                <span className='capture-hint'>{t('screenshot.object_hint')}</span>
            </div>
            {error ? <div role='alert' className='capture-error'>
                <span>{error.saved ? t('screenshot.saved') : t('screenshot.save_failed')} · {error.copied ? t('screenshot.copied') : t('screenshot.copy_failed')} · {error.error}</span>
                {error.saved && !error.copied && error.path ? <button type='button' disabled={saving} onClick={() => confirm(error.path)}>{t('screenshot.retry_copy')}</button> : null}
            </div> : null}
            <footer className='capture-footer'>
                <span className='capture-hint'>{t('screenshot.editor_hint')}</span>
                <button type='button' className='capture-action' onClick={onCancel}><LuX />{t('screenshot.cancel')}</button>
                <button type='button' className='capture-save' disabled={!ready || saving} onClick={() => confirm()}>
                    {pin ? <LuPin /> : <LuSave />}{saving ? t('screenshot.saving') : pin ? t('screenshot.pin') : t('screenshot.save_copy')}
                </button>
            </footer>
        </div>
    );
}
