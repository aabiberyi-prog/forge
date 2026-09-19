import React from 'react';

export default function HistoryList({ tasks }) {
    if (tasks.length === 0) {
        return <div className='forge-panel-empty'>No history</div>;
    }

    return (
        <div>
            {tasks.map((task) => (
                <div key={task.id} className='forge-panel-row'>
                    <span className={`flex-1 text-sm ${task.done ? 'forge-panel-title-done' : ''}`}>{task.title}</span>
                </div>
            ))}
        </div>
    );
}
