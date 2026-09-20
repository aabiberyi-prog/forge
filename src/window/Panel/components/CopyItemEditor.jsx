import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Textarea } from '@nextui-org/react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_COPY_IMAGES, validateImageFile } from '../copy';

function fileToImageInput(file) {
    validateImageFile(file);
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            resolve({
                fileName: file.name || 'image',
                mimeType: file.type,
                dataUrl: reader.result,
            });
        };
        reader.onerror = () => reject(reader.error || new Error('Could not read image'));
        reader.readAsDataURL(file);
    });
}

export default function CopyItemEditor({ open, item, onCancel, onSave }) {
    const { t } = useTranslation();
    const fileInputRef = useRef(null);
    const [title, setTitle] = useState('');
    const [text, setText] = useState('');
    const [images, setImages] = useState([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!open) return;
        setTitle(item?.title ?? '');
        setText(item?.text ?? '');
        setImages(item?.images ?? []);
        setSaving(false);
        setError('');
    }, [item, open]);

    const appendFiles = async (files) => {
        const incoming = Array.from(files ?? []).filter((file) => file.type?.startsWith('image/'));
        if (incoming.length === 0) return;
        if (images.length + incoming.length > MAX_COPY_IMAGES) {
            setError(`At most ${MAX_COPY_IMAGES} images`);
            return;
        }
        try {
            const next = await Promise.all(incoming.map(fileToImageInput));
            setImages((current) => [...current, ...next]);
            setError('');
        } catch (err) {
            setError(err.message || 'Could not add image');
        }
    };

    const save = async () => {
        const trimmed = title.trim();
        if (!trimmed) {
            setError('Title is required');
            return;
        }
        setSaving(true);
        try {
            await onSave({
                title: trimmed,
                text,
                images: images.map((image) => ({
                    id: image.id,
                    fileName: image.fileName,
                    mimeType: image.mimeType,
                    dataUrl: image.dataUrl,
                })),
            });
        } catch (err) {
            setError(err.message || 'Save failed');
            setSaving(false);
        }
    };

    return (
        <Modal isOpen={open} onClose={onCancel} size='sm'>
            <ModalContent>
                <ModalHeader>{item ? t('panel.edit_clip') : t('panel.new_clip')}</ModalHeader>
                <ModalBody>
                    <Input size='sm' label={t('panel.title')} value={title} onValueChange={setTitle} maxLength={120} />
                    <Textarea
                        size='sm'
                        label={t('panel.text')}
                        value={text}
                        onValueChange={setText}
                        onPaste={(event) => {
                            const files = Array.from(event.clipboardData?.items ?? [])
                                .filter((entry) => entry.kind === 'file' && entry.type.startsWith('image/'))
                                .map((entry) => entry.getAsFile())
                                .filter(Boolean);
                            if (files.length > 0) {
                                event.preventDefault();
                                appendFiles(files);
                            }
                        }}
                    />
                    <input
                        ref={fileInputRef}
                        type='file'
                        accept='image/png,image/jpeg,image/webp,image/gif'
                        multiple
                        hidden
                        onChange={(event) => {
                            appendFiles(event.target.files);
                            event.target.value = '';
                        }}
                    />
                    <Button size='sm' variant='flat' onPress={() => fileInputRef.current?.click()}>
                        {t('panel.add_images')} ({images.length}/{MAX_COPY_IMAGES})
                    </Button>
                    {images.length > 0 ? (
                        <div className='flex flex-col gap-1'>
                            {images.map((image, index) => (
                                <div key={`${image.id || image.fileName}-${index}`} className='forge-clip-image-row'>
                                    {image.dataUrl ? (
                                        <img src={image.dataUrl} alt='' className='forge-clip-thumb' />
                                    ) : (
                                        <span className='forge-clip-thumb forge-clip-thumb-empty' />
                                    )}
                                    <span className='flex-1 truncate text-xs'>{image.fileName}</span>
                                    <span className='text-[11px] opacity-60'>
                                        {image.dataUrl ? t('panel.image_new') : t('panel.image_saved')}
                                    </span>
                                    <Button
                                        size='sm'
                                        variant='light'
                                        color='danger'
                                        onPress={() =>
                                            setImages((current) =>
                                                current.filter((_, imageIndex) => imageIndex !== index)
                                            )
                                        }
                                    >
                                        {t('panel.remove_image')}
                                    </Button>
                                </div>
                            ))}
                        </div>
                    ) : null}
                    {error ? <div className='text-danger text-xs'>{error}</div> : null}
                </ModalBody>
                <ModalFooter>
                    <Button size='sm' variant='light' onPress={onCancel}>
                        {t('panel.cancel')}
                    </Button>
                    <Button size='sm' color='primary' isLoading={saving} onPress={save}>
                        {t('panel.save')}
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
}
