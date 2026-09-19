import { Button, Input } from '@nextui-org/react';
import { MdAdd } from 'react-icons/md';
import React, { useState } from 'react';

export default function TodoInput({ onAddTodo, error }) {
    const [value, setValue] = useState('');
    const [saving, setSaving] = useState(false);

    const add = async () => {
        const title = value.trim();
        if (!title || saving) return;
        setSaving(true);
        try {
            await onAddTodo(title);
            setValue('');
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
                        if (event.key === 'Enter') add();
                    }}
                    maxLength={200}
                    placeholder='Add a task'
                    isDisabled={saving}
                />
                <Button isIconOnly size='sm' color='primary' onPress={add} title='Add' isLoading={saving}>
                    <MdAdd />
                </Button>
            </div>
            {error ? <div className='text-danger text-xs mt-1'>{error}</div> : null}
        </div>
    );
}
