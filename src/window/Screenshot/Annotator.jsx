import { Button } from '@nextui-org/react';
import React, { useEffect, useRef, useState } from 'react';
import { normalizeRect, paintShape, pixelateRect, TOOLS } from './draw';

const LABELS = {
    rectangle: 'Rect',
    ellipse: 'Oval',
    arrow: 'Arrow',
    line: 'Line',
    freehand: 'Pen',
    text: 'Text',
    step: 'Step',
    blur: 'Blur',
    highlight: 'Hi',
    crop: 'Crop',
};

export default function Annotator({ imageSrc, pin, onCancel, onConfirm }) {
    const canvasRef = useRef(null);
    const imageRef = useRef(null);
    const [tool, setTool] = useState('rectangle');
    const [shapes, setShapes] = useState([]);
    const [draft, setDraft] = useState(null);
    const [step, setStep] = useState(1);
    const [ready, setReady] = useState(false);

    const redraw = (nextShapes = shapes, nextDraft = draft) => {
        const canvas = canvasRef.current;
        const image = imageRef.current;
        if (!canvas || !image || !image.complete) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        for (const shape of nextShapes) {
            if (shape.tool === 'blur' && shape.rect) {
                pixelateRect(ctx, shape.rect);
            } else {
                paintShape(ctx, shape);
            }
        }
        if (nextDraft) {
            if (nextDraft.tool === 'blur' && nextDraft.rect) {
                pixelateRect(ctx, nextDraft.rect);
            } else {
                paintShape(ctx, nextDraft);
            }
        }
    };

    useEffect(() => {
        redraw();
    }, [shapes, draft, ready]);

    const canvasPoint = (event) => {
        const bounds = canvasRef.current.getBoundingClientRect();
        const scaleX = canvasRef.current.width / bounds.width;
        const scaleY = canvasRef.current.height / bounds.height;
        return {
            x: (event.clientX - bounds.left) * scaleX,
            y: (event.clientY - bounds.top) * scaleY,
        };
    };

    const onDown = (event) => {
        const point = canvasPoint(event);
        if (tool === 'text') {
            const text = window.prompt('Text');
            if (text) {
                setShapes((current) => [...current, { tool: 'text', x0: point.x, y0: point.y, text }]);
            }
            return;
        }
        if (tool === 'step') {
            setShapes((current) => [...current, { tool: 'step', x0: point.x, y0: point.y, step }]);
            setStep((value) => value + 1);
            return;
        }
        setDraft({
            tool,
            x0: point.x,
            y0: point.y,
            x1: point.x,
            y1: point.y,
            points: [{ x: point.x, y: point.y }],
            rect: normalizeRect(point.x, point.y, point.x, point.y),
        });
    };

    const onMove = (event) => {
        if (!draft) return;
        const point = canvasPoint(event);
        const next = {
            ...draft,
            x1: point.x,
            y1: point.y,
            points: draft.tool === 'freehand' ? [...draft.points, point] : draft.points,
            rect: normalizeRect(draft.x0, draft.y0, point.x, point.y),
        };
        setDraft(next);
    };

    const onUp = () => {
        if (!draft) return;
        if (draft.tool === 'crop' && draft.rect.width > 2 && draft.rect.height > 2) {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            redraw(shapes, null);
            const cropped = ctx.getImageData(draft.rect.left, draft.rect.top, draft.rect.width, draft.rect.height);
            canvas.width = draft.rect.width;
            canvas.height = draft.rect.height;
            ctx.putImageData(cropped, 0, 0);
            imageRef.current.src = canvas.toDataURL('image/png');
            setShapes([]);
            setDraft(null);
            setStep(1);
            return;
        }
        setShapes((current) => [...current, draft]);
        setDraft(null);
    };

    return (
        <div className='fixed inset-0 bg-black/70 flex flex-col items-center justify-center gap-3 p-4'>
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
                className='max-w-[90vw] max-h-[75vh] bg-black cursor-crosshair'
                onMouseDown={onDown}
                onMouseMove={onMove}
                onMouseUp={onUp}
            />
            <div className='flex flex-wrap gap-1 justify-center'>
                {TOOLS.map((name) => (
                    <Button
                        key={name}
                        size='sm'
                        variant={tool === name ? 'solid' : 'flat'}
                        color={tool === name ? 'primary' : 'default'}
                        onPress={() => setTool(name)}
                    >
                        {LABELS[name]}
                    </Button>
                ))}
                <Button size='sm' variant='flat' onPress={() => setShapes((current) => current.slice(0, -1))}>
                    Undo
                </Button>
                <Button size='sm' variant='light' onPress={onCancel}>
                    Cancel
                </Button>
                <Button
                    size='sm'
                    color='success'
                    onPress={() => {
                        redraw(shapes, null);
                        onConfirm(canvasRef.current.toDataURL('image/png'));
                    }}
                >
                    {pin ? 'Pin' : 'Save'}
                </Button>
            </div>
        </div>
    );
}
