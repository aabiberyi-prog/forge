export const HISTORY_PAGE_SIZE = 20;

export function timestampMs(value) {
    return /^\d+$/.test(String(value)) ? Number(value) : Date.parse(value);
}

export function lifecycleEvents(task) {
    const events = [...(task.events || [])];
    for (const [event, at] of [['completed', task.completedAt], ['archived', task.archivedAt], ['deleted', task.deletedAt]]) {
        if (at && !events.some((item) => item.event === event && String(item.at) === String(at))) events.push({ event, at });
    }
    if (!events.length && task.done) events.push({ event: 'completed', at: task.updatedAt });
    return events.sort((a, b) => (timestampMs(b.at) || 0) - (timestampMs(a.at) || 0));
}

export function statusOf(task) {
    return lifecycleEvents(task)[0]?.event || 'record';
}

export function eventTime(task) {
    return lifecycleEvents(task)[0]?.at || task.updatedAt || '';
}

export function formatTime(value) {
    if (!value) return '';
    const date = new Date(timestampMs(value));
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function statusCounts(tasks) {
    return Object.fromEntries(['completed', 'archived', 'deleted'].map((status) => [
        status, tasks.filter((task) => lifecycleEvents(task).some((item) => item.event === status)).length,
    ]));
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
        if (needle && !String(task.title || '').toLocaleLowerCase().includes(needle)) return false;
        if (!statuses.length && fromMs == null && toMs == null) return true;
        return lifecycleEvents(task).some((item) => {
            if (statuses.length && !statuses.includes(item.event)) return false;
            const time = timestampMs(item.at);
            if ((fromMs != null || toMs != null) && !Number.isFinite(time)) return false;
            return (fromMs == null || time >= fromMs) && (toMs == null || time <= toMs);
        });
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
