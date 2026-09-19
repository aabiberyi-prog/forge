import { Button } from '@nextui-org/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { eventTime, formatTime, statusOf } from '../history';

export default function HistoryList({ tasks, emptyLabel, onRestore }) {
    const { t } = useTranslation();
    if (tasks.length === 0) {
        return <div className='forge-panel-empty'>{emptyLabel || t('panel.history_empty')}</div>;
    }

    return (
        <div>
            {tasks.map((task) => {
                const status = statusOf(task);
                return (
                    <div key={task.id} className='forge-panel-row forge-history-row'>
                        <div className='flex-1 min-w-0'>
                            <div className='flex items-center gap-2'>
                                <span
                                    className={`flex-1 text-sm truncate ${
                                        task.deletedAt || task.done ? 'forge-panel-title-done' : ''
                                    }`}
                                >
                                    {task.title}
                                </span>
                                <span className={`forge-status-tag forge-status-${status}`}>
                                    {t(`panel.status_${status}`)}
                                </span>
                            </div>
                            <div className='forge-history-time'>{formatTime(eventTime(task))}</div>
                        </div>
                        <Button size='sm' variant='flat' onPress={() => onRestore?.(task.id)}>
                            {t('panel.restore')}
                        </Button>
                    </div>
                );
            })}
        </div>
    );
}
