import { Button, Progress } from '@nextui-org/react';
import React from 'react';

export default function TodoStats({ total, completed, onClearCompleted }) {
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return (
        <div>
            <div className='flex items-center justify-between text-xs opacity-70 mb-1'>
                <span>
                    Done {completed} / {total}
                </span>
                {completed > 0 && (
                    <Button size='sm' variant='light' onPress={onClearCompleted}>
                        Clear done
                    </Button>
                )}
            </div>
            <Progress size='sm' aria-label='Completed tasks' value={percentage} />
        </div>
    );
}
