export const HISTORY_PAGE_SIZE = 20;

export function statusOf(task) {
    if (task.deletedAt) return 'deleted';
    if (task.archivedAt) return 'archived';
    if (task.done) return 'completed';
    return 'record';
}

export function eventTime(task) {
    return task.deletedAt || task.archivedAt || task.completedAt || task.updatedAt || '';
}

export function formatTime(value) {
    if (!value) return '';
    const date = /^\d+$/.test(String(value)) ? new Date(Number(value)) : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(undefined, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function statusCounts(tasks) {
    return {
        completed: tasks.filter((task) => Boolean(task.done || task.completedAt)).length,
        archived: tasks.filter((task) => Boolean(task.archivedAt)).length,
        deleted: tasks.filter((task) => Boolean(task.deletedAt)).length,
    };
}

function matchesStatus(task, statuses) {
    if (!statuses || statuses.length === 0) return true;
    if (statuses.includes('completed') && (task.done || task.completedAt)) return true;
    if (statuses.includes('archived') && task.archivedAt) return true;
    if (statuses.includes('deleted') && task.deletedAt) return true;
    return false;
}

function dayBound(isoDate, end) {
    if (!isoDate) return null;
    const date = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    if (end) date.setHours(23, 59, 59, 999);
    return date.getTime();
}

export function filterHistory(tasks, { query = '', statuses = [], from = '', to = '' } = {}) {
    const needle = String(query).trim().toLocaleLowerCase();
    const fromMs = dayBound(from, false);
    const toMs = dayBound(to, true);
    return tasks.filter((task) => {
        if (needle && !String(task.title || '').toLocaleLowerCase().includes(needle)) {
            return false;
        }
        if (!matchesStatus(task, statuses)) return false;
        const time = Number(eventTime(task));
        if (fromMs != null && Number.isFinite(time) && time < fromMs) return false;
        if (toMs != null && Number.isFinite(time) && time > toMs) return false;
        return true;
    });
}

export function paginate(items, page, pageSize = HISTORY_PAGE_SIZE) {
    const total = items.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1);
    const current = Math.min(Math.max(1, page || 1), pageCount);
    const start = (current - 1) * pageSize;
    return {
        page: current,
        pageCount,
        total,
        items: items.slice(start, start + pageSize),
    };
}
