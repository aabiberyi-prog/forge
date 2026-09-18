import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveObjectURL } from 'node:buffer';
import path from 'node:path';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const httpSource = await readFile(new URL('../../src/utils/http.js', import.meta.url), 'utf8');
const pluginSource = await readFile(new URL('../../src/utils/invoke_plugin.js', import.meta.url), 'utf8');

test('content fitting preserves client width and settles after a resize at high DPI', async () => {
    const source = await readFile(new URL('../../src/utils/window_size.js', import.meta.url), 'utf8');
    const { fitWindowHeight } = await loadModule(source, {
        '@tauri-apps/api/window': { LogicalSize: class { constructor(width, height) { this.width = width; this.height = height; } } },
    });
    let client = { width: 600, height: 400 };
    const applied = [];
    const window = {
        scaleFactor: async () => 2,
        innerSize: async () => ({ toLogical: (scale) => ({ width: client.width / scale, height: client.height / scale }) }),
        outerSize: async () => { throw new Error('Outer dimensions include the window border'); },
        setSize: async (size) => { applied.push([size.width, size.height]); client = { width: size.width * 2, height: size.height * 2 }; },
    };
    for (let event = 0; event < 10; event++) await fitWindowHeight(window, 280);
    assert.deepEqual(applied, [[300, 280]]);
    assert.equal(client.width, 600);
});

test('every Tauri plugin client has a compatible backend API minor version', async () => {
    const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    const lock = await readFile(new URL('../../src-tauri/Cargo.lock', import.meta.url), 'utf8');
    for (const name of Object.keys(manifest.dependencies).filter((name) => name.startsWith('@tauri-apps/plugin-'))) {
        const client = JSON.parse(
            await readFile(new URL(`../../node_modules/${name}/package.json`, import.meta.url), 'utf8')
        );
        const crate = name.replace('@tauri-apps/', 'tauri-');
        const backend = lock.match(new RegExp(`name = "${crate}"\\r?\\nversion = "([^"\\r\\n]+)"`));
        assert.ok(backend, `${crate} must be registered in Cargo.lock`);
        const [clientMajor, clientMinor] = client.version.split('.').map(Number);
        const [backendMajor, backendMinor] = backend[1].split('.').map(Number);
        assert.ok(
            backendMajor === clientMajor && backendMinor >= clientMinor,
            `${name} ${client.version} requires a newer backend than ${crate} ${backend[1]}`
        );
    }
});

async function loadModule(source, imports, dynamicImport) {
    const context = createContext({
        URL,
        URLSearchParams,
        Headers,
        Blob,
        FormData,
        ArrayBuffer,
        Uint8Array,
        AbortSignal,
        TextDecoder,
    });
    const module = new SourceTextModule(source, {
        context,
        importModuleDynamically: async (specifier) => {
            const blob = resolveObjectURL(specifier);
            assert.ok(blob, 'plugin blob must exist while importing');
            dynamicImport?.(specifier);
            const child = new SourceTextModule(await blob.text(), { context });
            await child.link(() => {
                throw new Error('Unexpected plugin import');
            });
            await child.evaluate();
            return child;
        },
    });
    await module.link((specifier) => {
        const exports = imports[specifier];
        assert.ok(exports, `Missing fixture for ${specifier}`);
        return new SyntheticModule(
            Object.keys(exports),
            function () {
                for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
            },
            { context }
        );
    });
    await module.evaluate();
    return module.namespace;
}

function loadHttp(fetch) {
    return loadModule(httpSource, {
        '@tauri-apps/plugin-http': { fetch },
        '@tauri-apps/plugin-fs': { readFile: async () => new Uint8Array([1, 2, 3]) },
    });
}

test('OpenAI streaming preserves UTF-8 and SSE frames split across native chunks', async () => {
    const source = await readFile(new URL('../../src/services/translate/openai/index.jsx', import.meta.url), 'utf8');
    const bytes = new TextEncoder().encode(
        'data: {"choices":[{"delta":{"content":"Hello "}}]}\r\n\r\n' +
            'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n' +
            'data: [DONE]\n\n'
    );
    const frames = new ReadableStream({
        start(controller) {
            for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
            controller.close();
        },
    });
    const compatibility = await loadHttp(() => {});
    const api = await loadModule(source, {
        '../../../utils/http.js': {
            nativeFetch: async () => new Response(frames),
            fetch: () => {},
            Body: {},
            readSseData: compatibility.readSseData,
        },
        './info': { Language: { en: 'English' } },
        './Config': { defaultRequestArguments: '{}' },
    });
    const updates = [];
    const result = await api.translate('fresh input', 'English', 'Chinese', {
        config: {
            service: 'openai',
            requestPath: 'http://127.0.0.1:60830',
            apiKey: 'fixture-only',
            model: 'fixture',
            stream: true,
            promptList: [{ role: 'user', content: '$text' }],
        },
        detect: 'en',
        setResult: (value) => updates.push(value),
    });
    assert.equal(result, 'Hello 你好');
    assert.equal(updates.at(-1), 'Hello 你好');
});

test('legacy JSON body, query, authorization, and response contract survive migration', async () => {
    const http = await loadHttp(async (url, options) => {
        assert.equal(url, 'https://example.test/api?existing=yes&q=hello+world');
        assert.equal(options.headers.get('authorization'), 'Bearer fixture-only');
        assert.equal(options.headers.get('content-type'), 'application/json');
        assert.equal(options.body, '{"text":"你好"}');
        return new Response('{"translated":"hello"}', { headers: { 'x-fixture': 'yes' } });
    });
    const result = await http.fetch('https://example.test/api?existing=yes', {
        method: 'POST',
        query: { q: 'hello world' },
        headers: { Authorization: 'Bearer fixture-only' },
        body: http.Body.json({ text: '你好' }),
    });
    assert.equal(result.data.translated, 'hello');
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.headers['x-fixture'], 'yes');
    assert.deepEqual([...result.rawHeaders['x-fixture']], ['yes']);
});

test('legacy URL-encoded forms preserve Unicode and reserved characters', async () => {
    const http = await loadHttp(async (_, options) => {
        assert.equal(options.headers.get('content-type'), 'application/x-www-form-urlencoded');
        assert.equal(options.body, 'query=%E4%BD%A0%E5%A5%BD+%26+yes');
        return new Response('{}');
    });
    await http.fetch('https://example.test', {
        method: 'POST',
        body: http.Body.form({ query: '你好 & yes', ignored: null }),
    });
});

test('OCR multipart files get a transport boundary, filename, MIME type, and bytes', async () => {
    const http = await loadHttp(async (_, options) => {
        assert.equal(options.headers.has('content-type'), false);
        const file = options.body.get('image');
        assert.equal(file.name, 'capture.png');
        assert.equal(file.type, 'image/png');
        assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [1, 2, 3]);
        assert.equal(options.body.get('language'), 'zh');
        return new Response('{}');
    });
    await http.fetch('https://example.test', {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data' },
        body: http.Body.form({
            image: { file: 'fixture.png', fileName: 'capture.png', mime: 'image/png' },
            language: 'zh',
        }),
    });
});

test('text requests and binary audio responses preserve their exact content', async () => {
    const http = await loadHttp(async (_, options) => {
        assert.equal(options.body, 'plain text');
        return new Response(new Uint8Array([0, 128, 255]));
    });
    const response = await http.fetch('https://example.test', {
        method: 'POST',
        body: http.Body.text('plain text'),
        responseType: http.ResponseType.Binary,
    });
    assert.deepEqual([...response.data], [0, 128, 255]);
});

test('bytes, client timeouts, redirect options, and dropped clients retain v1 behavior', async () => {
    const http = await loadHttp(async (_, options) => {
        assert.deepEqual([...options.body], [0, 255]);
        assert.equal(options.connectTimeout, 2500);
        assert.equal(options.maxRedirections, 2);
        assert.ok(options.signal);
        return new Response('ok');
    });
    const client = await http.getClient({ connectTimeout: { secs: 2, nanos: 500000000 }, maxRedirections: 2 });
    const result = await client.post('https://example.test', http.Body.bytes([0, 255]), {
        timeout: 5,
        responseType: http.ResponseType.Text,
    });
    assert.equal(result.data, 'ok');
    await client.drop();
    await assert.rejects(client.get('https://example.test'), /dropped/);
});

test('JSON mode accepts empty success, preserves error text, and rejects malformed success', async () => {
    const empty = await loadHttp(async () => new Response(null, { status: 204 }));
    assert.equal(JSON.stringify((await empty.fetch('https://example.test')).data), '{}');
    const success = await loadHttp(async () => new Response(''));
    assert.equal(JSON.stringify((await success.fetch('https://example.test')).data), '{}');
    const failure = await loadHttp(async () => new Response('upstream unavailable', { status: 503 }));
    assert.equal((await failure.fetch('https://example.test')).data, 'upstream unavailable');
    const malformed = await loadHttp(async () => new Response('not JSON'));
    await assert.rejects(malformed.fetch('https://example.test'), /not valid JSON/);
});

for (const type of ['translate', 'recognize', 'tts', 'collection']) {
    test(`frozen ${type} plugin entry loads without eval and keeps legacy utilities`, async () => {
        let blobUrl;
        let fileOptions;
        const module = await loadModule(
            pluginSource,
            {
                '@tauri-apps/api/path': {
                    appConfigDir: async () => 'C:/fixture/config',
                    appCacheDir: async () => 'C:/fixture/cache',
                    join: async (...parts) => path.posix.join(...parts),
                },
                '@tauri-apps/plugin-fs': {
                    readFile: async (_, options) => {
                        fileOptions = options;
                        return new Uint8Array([7]);
                    },
                    readTextFile: async () => `async function ${type}(text, options) { return text + ':loaded'; }`,
                },
                '@tauri-apps/api/core': { invoke: async () => ({ status: 0 }) },
                '@tauri-apps/plugin-sql': { default: class Database {} },
                'crypto-js': { default: {} },
                './env': { osType: 'Windows_NT' },
                './http.js': { fetch: async () => ({ data: {} }), Body: {}, ResponseType: {} },
            },
            (url) => {
                blobUrl = url;
            }
        );
        const [entry, utils] = await module.invoke_plugin(type, 'plugin_fixture');
        assert.equal(await entry('fresh input'), 'fresh input:loaded');
        assert.equal(utils.osType, 'Windows_NT');
        assert.equal(typeof utils.tauriFetch, 'function');
        assert.equal(typeof utils.readBinaryFile, 'function');
        assert.deepEqual([...(await utils.readBinaryFile('fixture.png', { dir: 24 }))], [7]);
        assert.equal(fileOptions.baseDir, 24);
        assert.equal('dir' in fileOptions, false);
        assert.equal(typeof utils.run, 'function');
        assert.equal(resolveObjectURL(blobUrl), undefined, 'blob URL must be released');
    });
}
