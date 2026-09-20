import test from 'node:test';
import assert from 'node:assert/strict';
import { filterHistory, paginate, statusCounts, HISTORY_PAGE_SIZE } from '../../src/window/Panel/history.js';

const tasks = [
    { id: '1', title: 'Äpfel pie', done: true, completedAt: '100', archivedAt: '100', deletedAt: null },
    { id: '2', title: '任务记录', done: true, completedAt: '200', archivedAt: null, deletedAt: null },
    { id: '3', title: 'gone', done: false, completedAt: null, archivedAt: null, deletedAt: '300' },
];

test('search is case-insensitive and covers unicode titles', () => {
    const found = filterHistory(tasks, { query: 'äpfel' });
    assert.equal(found.length, 1);
    assert.equal(found[0].id, '1');
    assert.equal(filterHistory(tasks, { query: '任务' }).length, 1);
});

test('status counts are independent and not summed', () => {
    const counts = statusCounts(tasks);
    assert.equal(counts.completed, 2);
    assert.equal(counts.archived, 1);
    assert.equal(counts.deleted, 1);
    assert.notEqual(counts.completed + counts.archived + counts.deleted, tasks.length);
});

test('overlapping completed+archived filter uses OR and does not drop the overlap row', () => {
    const found = filterHistory(tasks, { statuses: ['completed', 'archived'] });
    assert.deepEqual(found.map((task) => task.id), ['1', '2']);
});

test('pagination does not shrink the searchable set', () => {
    const many = Array.from({ length: 45 }, (_, index) => ({
        id: String(index),
        title: index === 40 ? 'needle-only' : `row ${index}`,
        done: true,
        completedAt: String(index),
    }));
    const found = filterHistory(many, { query: 'needle-only' });
    assert.equal(found.length, 1);
    const page = paginate(many, 1);
    assert.equal(page.items.length, HISTORY_PAGE_SIZE);
    assert.equal(page.total, 45);
    assert.equal(page.pageCount, 3);
});

test('restored tasks retain searchable dated lifecycle events', () => {
    const restored = { id: 'restored', title: 'Old task', done: false, completedAt: null, deletedAt: null,
        events: [{ event: 'restored', at: String(new Date('2026-09-19T12:00:00').getTime()) },
            { event: 'deleted', at: String(new Date('2026-08-01T12:00:00').getTime()) }] };
    assert.equal(filterHistory([restored], { statuses: ['deleted'], from: '2026-08-01', to: '2026-08-01' }).length, 1);
    assert.equal(filterHistory([restored], { statuses: ['deleted'], from: '2026-09-01' }).length, 0);
    assert.equal(statusCounts([restored]).deleted, 1);
});
