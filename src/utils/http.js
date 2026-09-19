import { fetch as pluginFetch } from '@tauri-apps/plugin-http';
import { readFile } from '@tauri-apps/plugin-fs';

export function nativeFetch(input, options = {}) {
    const headers = new Headers(
        options.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined)
    );
    // v1 native HTTP did not add the webview's Origin; the backend removes this empty sentinel.
    if (!headers.has('origin')) headers.set('origin', '');
    return pluginFetch(input, { ...options, headers });
}

// Native response chunks need not align with UTF-8 characters, lines, or SSE events.
export async function* readSseData(response) {
    if (!response.body) throw new Error('The streaming response has no body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let data = [];
    try {
        while (true) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            if (done && buffer) buffer += '\n';
            while (true) {
                const end = buffer.search(/[\r\n]/);
                if (end < 0 || (!done && buffer[end] === '\r' && end === buffer.length - 1)) break;
                const line = buffer.slice(0, end);
                buffer = buffer.slice(end + (buffer[end] === '\r' && buffer[end + 1] === '\n' ? 2 : 1));
                if (line === '') {
                    if (data.length) yield data.join('\n');
                    data = [];
                } else if (line === 'data' || line.startsWith('data:')) {
                    data.push(line.slice(5).replace(/^ /, ''));
                }
            }
            if (done) {
                if (data.length) yield data.join('\n');
                return;
            }
        }
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

// Preserve the Tauri 1 contract used by existing services and frozen .potext plugins.
export const ResponseType = { JSON: 1, Text: 2, Binary: 3 };
export class Body {
    constructor(type, payload) {
        this.type = type;
        this.payload = payload;
    }
    static json(payload) {
        return new Body('Json', payload);
    }
    static text(payload) {
        return new Body('Text', payload);
    }
    static form(payload) {
        return new Body('Form', payload);
    }
    static bytes(payload) {
        return new Body('Bytes', payload);
    }
}

const milliseconds = (duration) =>
    typeof duration === 'number' ? duration * 1000 : duration.secs * 1000 + (duration.nanos ?? 0) / 1000000;

async function encodeBody(body, headers) {
    if (!body?.type || !('payload' in body)) return body;
    switch (body.type) {
        case 'Json':
            if (!headers.has('content-type')) headers.set('content-type', 'application/json');
            return JSON.stringify(body.payload);
        case 'Text':
            return body.payload;
        case 'Bytes':
            return body.payload instanceof ArrayBuffer ? body.payload : new Uint8Array(body.payload);
        case 'Form': {
            const entries =
                body.payload instanceof FormData ? [...body.payload.entries()] : Object.entries(body.payload);
            if (!headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
                if (!headers.has('content-type')) headers.set('content-type', 'application/x-www-form-urlencoded');
                return new URLSearchParams(entries.filter(([, value]) => value != null)).toString();
            }
            // The transport must generate a boundary for legacy callers' bare multipart header.
            headers.delete('content-type');
            const form = new FormData();
            for (const [name, value] of entries) {
                if (value == null) continue;
                if (typeof value === 'string') form.append(name, value);
                else if (value instanceof Blob) form.append(name, value, value.name || 'file');
                else if (Array.isArray(value) || value instanceof Uint8Array)
                    form.append(name, new Blob([new Uint8Array(value)]));
                else {
                    const bytes =
                        typeof value.file === 'string' ? await readFile(value.file) : new Uint8Array(value.file);
                    form.append(
                        name,
                        new Blob([bytes], { type: value.mime || 'application/octet-stream' }),
                        value.fileName || 'file'
                    );
                }
            }
            return form;
        }
        default:
            throw new Error(`Unsupported HTTP body type: ${body.type}`);
    }
}

export class Response {
    constructor(response) {
        Object.assign(this, response);
    }
}

export class Client {
    constructor(options = {}) {
        this.options = options;
        this.closed = false;
    }
    async drop() {
        this.closed = true;
    }
    async request(options) {
        if (this.closed) throw new Error('HTTP client has been dropped');
        const {
            url,
            query,
            responseType = ResponseType.JSON,
            timeout,
            body,
            headers: inputHeaders,
            ...request
        } = options;
        const target = new URL(url);
        for (const [key, value] of Object.entries(query ?? {})) target.searchParams.append(key, value);
        const headers = new Headers(inputHeaders);
        const encodedBody = await encodeBody(body, headers);
        const fetchOptions = { ...this.options, ...request, headers, method: request.method ?? 'GET' };
        if (this.options.connectTimeout != null)
            fetchOptions.connectTimeout = milliseconds(this.options.connectTimeout);
        if (encodedBody != null) fetchOptions.body = encodedBody;
        if (timeout != null) {
            const signal = AbortSignal.timeout(Math.max(0, Math.ceil(milliseconds(timeout))));
            fetchOptions.signal = request.signal ? AbortSignal.any([request.signal, signal]) : signal;
        }
        const response = await nativeFetch(target.href, fetchOptions);
        let data;
        if (responseType === ResponseType.Binary) data = Array.from(new Uint8Array(await response.arrayBuffer()));
        else {
            data = await response.text();
            if (responseType === ResponseType.JSON) {
                try {
                    data = JSON.parse(data);
                } catch {
                    if (response.ok && data === '') data = {};
                    else if (response.ok)
                        throw new Error('HTTP response is not valid JSON; use ResponseType.Text or Binary.');
                }
            }
        }
        const responseHeaders = Object.fromEntries(response.headers.entries());
        const rawHeaders = Object.fromEntries(Object.entries(responseHeaders).map(([key, value]) => [key, [value]]));
        if (response.headers.getSetCookie?.().length) rawHeaders['set-cookie'] = response.headers.getSetCookie();
        return new Response({
            url: response.url || target.href,
            status: response.status,
            ok: response.ok,
            headers: responseHeaders,
            rawHeaders,
            data,
        });
    }
    get(url, options) {
        return this.request({ ...options, url, method: 'GET' });
    }
    post(url, body, options) {
        return this.request({ ...options, url, body, method: 'POST' });
    }
    put(url, body, options) {
        return this.request({ ...options, url, body, method: 'PUT' });
    }
    patch(url, body, options) {
        return this.request({ ...options, url, body, method: 'PATCH' });
    }
    delete(url, options) {
        return this.request({ ...options, url, method: 'DELETE' });
    }
}

export async function getClient(options) {
    return new Client(options);
}
const defaultClient = new Client();
export function fetch(url, options = {}) {
    return defaultClient.request({ ...options, url });
}
