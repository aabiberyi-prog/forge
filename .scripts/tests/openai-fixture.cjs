const http = require('node:http');
const fs = require('node:fs');

const output = process.argv[2];
if (!output) throw new Error('Provide a temporary request-log path.');
const server = http.createServer(async (request, response) => {
    // Published Lingva .potext uses this v1 GET contract with a configurable host.
    if (request.method === 'GET' && request.url.startsWith('/api/v1/')) {
        const parts = request.url.split('/');
        let text;
        try { text = decodeURIComponent(parts.slice(5).join('/')).replaceAll('@@', '/'); } catch { response.writeHead(400).end(); return; }
        if (!text.startsWith('FORGE_NATIVE_PLUGIN_') || text.length > 4096) { response.writeHead(400).end(); return; }
        fs.appendFileSync(output, JSON.stringify({ kind: 'lingva', text, from: parts[3], to: parts[4], originAbsent: !request.headers.origin }) + '\n');
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ translation: 'PLUGIN_OK_7330@@完成' }));
        return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404).end();
        return;
    }
    if (request.headers.authorization !== 'Bearer fixture-only') {
        response.writeHead(401).end();
        return;
    }
    let raw = '';
    for await (const chunk of request) {
        raw += chunk;
        if (raw.length > 65536) {
            response.writeHead(413).end();
            return;
        }
    }
    try {
        const body = JSON.parse(raw);
        const text = body.messages?.find((message) => message.role === 'user')?.content;
        if (typeof text !== 'string' || !text.startsWith('FORGE_NATIVE_')) {
            response.writeHead(400).end();
            return;
        }
        fs.appendFileSync(
            output,
            JSON.stringify({ text, stream: !!body.stream, originAbsent: !request.headers.origin }) + '\n'
        );
        if (!body.stream) {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ choices: [{ message: { content: 'FORGE_JSON_OK_7319' } }] }));
            return;
        }
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const data = Buffer.from('data: {"choices":[{"delta":{"content":"流式通过_7319"}}]}\r\n\r\ndata: [DONE]\n\n');
        for (let offset = 0; offset < data.length; offset += 7) {
            if (response.destroyed) return;
            response.write(data.subarray(offset, offset + 7));
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        response.end();
    } catch {
        if (!response.headersSent) response.writeHead(400);
        response.end();
    }
});
server.listen(60830, '127.0.0.1', () => console.log('OpenAI fixture listening on loopback port 60830.'));
