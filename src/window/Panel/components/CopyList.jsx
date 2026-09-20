import { useTranslation } from 'react-i18next';
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@nextui-org/react';
import { DragDropContext, Draggable, Droppable } from 'react-beautiful-dnd';
import { MdAdd, MdMoreVert } from 'react-icons/md';
import React from 'react';

export default function CopyList({ items, onCreate, onCopy, onEdit, onDelete, onReorder }) {
    const { t } = useTranslation();
    return (
        <div>
            <div className='flex justify-end mb-1'>
                <Button size='sm' variant='flat' startContent={<MdAdd />} onPress={onCreate}>
                    {t('panel.new_clip')}
                </Button>
            </div>
            {items.length === 0 ? (
                <div className='forge-panel-empty'>{t('panel.clips_empty')}</div>
            ) : (
                <DragDropContext
                    onDragEnd={(result) => {
                        if (!result.destination || result.source.index === result.destination.index) return;
                        const next = Array.from(items);
                        const [moved] = next.splice(result.source.index, 1);
                        next.splice(result.destination.index, 0, moved);
                        onReorder(next.map((item) => item.id));
                    }}
                >
                    <Droppable droppableId='clips'>
                        {(provided) => (
                            <div ref={provided.innerRef} {...provided.droppableProps}>
                                {items.map((item, index) => (
                                    <Draggable key={item.id} draggableId={item.id} index={index}>
                                        {(drag) => (
                                            <div
                                                className='forge-panel-row'
                                                ref={drag.innerRef}
                                                {...drag.draggableProps}
                                                {...drag.dragHandleProps}
                                            >
                                                <button
                                                    type='button'
                                                    className='flex-1 text-left'
                                                    onClick={() => onCopy(item.id)}
                                                    title={t('panel.copy')}
                                                >
                                                    <div className='text-sm'>{item.title}</div>
                                                    {item.text ? <div className='forge-panel-preview'>{item.text}</div> : null}
                                                    {item.images?.length > 0 ? (
                                                        <div className='forge-panel-preview'>{t('panel.image_count', { count: item.images.length })}</div>
                                                    ) : null}
                                                </button>
                                                <Dropdown>
                                                    <DropdownTrigger>
                                                        <Button isIconOnly size='sm' variant='light'>
                                                            <MdMoreVert />
                                                        </Button>
                                                    </DropdownTrigger>
                                                    <DropdownMenu
                                                        aria-label={t('panel.clip_actions')}
                                                        onAction={(key) => {
                                                            if (key === 'edit') onEdit(item.id);
                                                            if (key === 'delete') onDelete(item.id);
                                                        }}
                                                    >
                                                        <DropdownItem key='edit'>{t('panel.edit')}</DropdownItem>
                                                        <DropdownItem key='delete' color='danger'>
                                                            {t('panel.delete')}
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
            )}
        </div>
    );
}
