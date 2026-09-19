import { Button, Input } from '@nextui-org/react';
import { MdAdd } from 'react-icons/md';
import React, { useState } from 'react';

export default function TodoInput({ onAddTodo }) {
    const [value, setValue] = useState('');

    const add = () => {
        const title = value.trim();
        if (!title) return;
        onAddTodo(title);
        setValue('');
    };

    return (
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
            />
            <Button isIconOnly size='sm' color='primary' onPress={add} title='Add'>
                <MdAdd />
            </Button>
        </div>
    );
}
