import { useTranslation } from 'react-i18next';
import { Button, Progress } from '@nextui-org/react';
import React from 'react';

export default function TodoStats({ total, completed, onClearCompleted }) {
    const { t } = useTranslation();
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return (
        <div>
            <div className='flex items-center justify-between text-xs opacity-70 mb-1'>
                <span>
                    {t('panel.done_count', { completed, total })}
                </span>
                {completed > 0 && (
                    <Button size='sm' variant='light' onPress={onClearCompleted}>
                        {t('panel.clear_done')}
                    </Button>
                )}
            </div>
            <Progress size='sm' aria-label={t('panel.completed_tasks')} value={percentage} />
        </div>
    );
}
