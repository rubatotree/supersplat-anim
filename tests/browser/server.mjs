import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const roots = {
    '/fixtures/stress/': resolve('.git/bgs-synthetic-stress'),
    '/fixtures/output/': resolve('test-results'),
    '/fixtures/conformance/': resolve('tests/fixtures/bgs'),
    '/fixtures/real/': process.env.BGS_REAL_SAMPLE ?? '/data/zhuyutian/data/bgs/samples/pick-the-block-20261004/'
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const prefix = Object.keys(roots).find(p => pathname.startsWith(p));
        const root = resolve(prefix ? roots[prefix] : 'dist');
        const name = prefix ? pathname.slice(prefix.length) : pathname.slice(1) || 'index.html';
        const filename = resolve(root, name);
        if (!filename.startsWith(root + sep) || !(await stat(filename)).isFile()) throw new Error('Not found');
        response.setHeader('Content-Type', types[extname(filename)] ?? 'application/octet-stream');
        createReadStream(filename).pipe(response);
    } catch {
        response.writeHead(404).end();
    }
}).listen(4173, '127.0.0.1');
