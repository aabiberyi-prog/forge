import { Button, Checkbox, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Input } from '@nextui-org/react';
import { DragDropContext, Draggable, Droppable } from 'react-beautiful-dnd';
import { MdMoreVert } from 'react-icons/md';
import React, { useState } from 'react';

export default function TodoList({ todos, onToggleDone, onDelete, onEdit, onReorder }) {
    const [editingId, setEditingId] = useState(null);
    const [editValue, setEditValue] = useState('');

    const saveEdit = (id) => {
        const title = editValue.trim();
        if (title) onEdit(id, title);
        setEditingId(null);
        setEditValue('');
    };

    if (todos.length === 0) {
        return <div className='forge-panel-empty'>No tasks</div>;
    }

    return (
        <DragDropContext
            onDragEnd={(result) => {
                if (!result.destination || result.source.index === result.destination.index) return;
                const next = Array.from(todos);
                const [moved] = next.splice(result.source.index, 1);
                next.splice(result.destination.index, 0, moved);
                onReorder(next.map((todo) => todo.id));
            }}
        >
            <Droppable droppableId='tasks'>
                {(provided) => (
                    <div ref={provided.innerRef} {...provided.droppableProps}>
                        {todos.map((todo, index) => (
                            <Draggable key={todo.id} draggableId={todo.id} index={index}>
                                {(drag) => (
                                    <div
                                        className='forge-panel-row'
                                        ref={drag.innerRef}
                                        {...drag.draggableProps}
                                        {...drag.dragHandleProps}
                                    >
                                        <Checkbox
                                            isSelected={todo.done}
                                            onValueChange={(done) => onToggleDone(todo.id, done)}
                                        />
                                        {editingId === todo.id ? (
                                            <Input
                                                size='sm'
                                                autoFocus
                                                value={editValue}
                                                onValueChange={setEditValue}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter') saveEdit(todo.id);
                                                    if (event.key === 'Escape') setEditingId(null);
                                                }}
                                                onBlur={() => saveEdit(todo.id)}
                                            />
                                        ) : (
                                            <span
                                                className={`flex-1 text-sm ${todo.done ? 'forge-panel-title-done' : ''}`}
                                                onDoubleClick={() => {
                                                    setEditingId(todo.id);
                                                    setEditValue(todo.title);
                                                }}
                                            >
                                                {todo.title}
                                            </span>
                                        )}
                                        <Dropdown>
                                            <DropdownTrigger>
                                                <Button isIconOnly size='sm' variant='light'>
                                                    <MdMoreVert />
                                                </Button>
                                            </DropdownTrigger>
                                            <DropdownMenu
                                                aria-label='Task actions'
                                                onAction={(key) => {
                                                    if (key === 'edit') {
                                                        setEditingId(todo.id);
                                                        setEditValue(todo.title);
                                                    }
                                                    if (key === 'delete') onDelete(todo.id);
                                                }}
                                            >
                                                <DropdownItem key='edit'>Edit</DropdownItem>
                                                <DropdownItem key='delete' color='danger'>
                                                    Delete
                                                </DropdownItem>
                                            </DropdownMenu>
                                        </Dropdown>
                                    </div>
                                )}
                            </Draggable>
                        ))}
                        {provided.placeholder}
                    </div>
                )}
            </Droppable>
        </DragDropContext>
    );
}
