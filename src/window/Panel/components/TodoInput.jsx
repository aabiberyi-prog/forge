import { useTranslation } from 'react-i18next';
import { Button, Input } from '@nextui-org/react';
import { MdAdd } from 'react-icons/md';
import React, { useState } from 'react';

export default function TodoInput({ onAddTodo, error }) {
    const { t } = useTranslation();
    const [value, setValue] = useState('');
    const [saving, setSaving] = useState(false);

    const add = async () => {
        const title = value.trim();
        if (!title || saving) return;
        setSaving(true);
        try {
            await onAddTodo(title);
            setValue('');
        } catch {
            // The panel displays the error; retain the draft for retry.
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className='flex gap-2'>
                <Input
                    size='sm'
                    value={value}
                    onValueChange={setValue}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.nativeEvent?.isComposing) add();
                    }}
                    maxLength={200}
                    placeholder={t('panel.add_task')}
                    isDisabled={saving}
                />
                <Button isIconOnly size='sm' color='primary' onPress={add} title={t('panel.add')} isLoading={saving}>
                    <MdAdd />
                </Button>
            </div>
            {error ? <div className='text-danger text-xs mt-1'>{error}</div> : null}
        </div>
    );
}
