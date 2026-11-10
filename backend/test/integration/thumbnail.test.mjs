import '../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { createThumbnailRouter } from '../../routes/thumbnail.routes.js';
import { createThumbnailService } from '../../lib/thumbnailService.js';

// A real local "screenshot service" (loopback) so the real fetch is exercised: redirects, oversize, content types.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);
const seen = []; // [{host param}] every render the fake service was asked for
let behaviour = 'ok';
let shot;
let trapHits = 0; // a second loopback server standing in for "wherever a redirect points" (e.g. an internal address)
const trap = http.createServer((req, res) => { trapHits++; res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(JPEG); });
const fakeShot = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    seen.push(u.searchParams.get('url'));
    if (behaviour === 'redirect') { res.writeHead(302, { location: `http://127.0.0.1:${trap.address().port}/secret` }); return res.end(); }
    if (behaviour === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<script>1</script>'); }
    if (behaviour === 'oversize') { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(3 * 1024 * 1024)])); }
    res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(JPEG);
});

const PID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projects = {
    [PID(1)]: { id: PID(1), preview_url: 'https://prev-aaaa1111.vibebuild.cc', thumbnail_url: 'http://178.156.231.255:3465/screenshot?url=https%3A%2F%2Fprev-aaaa1111.vibebuild.cc&width=390&height=844' },
    [PID(2)]: { id: PID(2), preview_url: 'https://evil.example.com', thumbnail_url: 'http://178.156.231.255:3465/screenshot?url=https%3A%2F%2Fevil.example.com&width=390&height=844' },
    [PID(3)]: { id: PID(3), preview_url: 'http://169.254.169.254/latest/meta-data', thumbnail_url: null },
    [PID(4)]: { id: PID(4), preview_url: 'https://prev-aaaa1111.vibebuild.cc.evil.com', thumbnail_url: 'http://x/screenshot?url=https%3A%2F%2Fprev-bbbb2222.vibebuild.cc.evil.com' },
    [PID(5)]: { id: PID(5), preview_url: 'https://127.0.0.1:8080', thumbnail_url: null },
    [PID(6)]: { id: PID(6), preview_url: 'https://prev-cccc3333.vibebuild.cc', thumbnail_url: null },
    [PID(7)]: { id: PID(7), preview_url: 'https://prev-dddd4444.vibebuild.cc', thumbnail_url: null },
    [PID(8)]: { id: PID(8), preview_url: 'https://prev-eeee5555.vibebuild.cc', thumbnail_url: null },
};
let lookups = 0;
const supabase = { from: () => ({ select: () => ({ eq: (_c, id) => ({ single: async () => { lookups++; return projects[id] ? { data: projects[id], error: null } : { data: null, error: { code: 'PGRST116' } }; } }) }) }) };

let api;
before(async () => {
    await new Promise((r) => trap.listen(0, '127.0.0.1', r));
    await new Promise((r) => fakeShot.listen(0, '127.0.0.1', r));
    shot = `http://127.0.0.1:${fakeShot.address().port}`;
    const mk = () => createThumbnailRouter({ supabase, service: createThumbnailService({ serviceUrl: shot, concurrency: 1, waitMs: 3000 }) });
    const app = express();
    app.use('/api/projects/:id/thumbnail', mk());
    api = await listen(app);
});
after(async () => { await api.close(); trap.closeAllConnections?.(); await new Promise((r) => trap.close(r)); fakeShot.closeAllConnections?.(); await new Promise((r) => fakeShot.close(r)); });

const get = (id, q = '', headers = {}) => fetch(`${api.base}/api/projects/${id}/thumbnail${q}`, { headers });

test('serves the rendered image with caching headers and an ETag, then 304s on If-None-Match', async () => {
    behaviour = 'ok'; seen.length = 0;
    const r = await get(PID(1));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/jpeg');
    assert.match(r.headers.get('cache-control'), /public, max-age=86400/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), JPEG);
    assert.deepEqual(seen, ['https://prev-aaaa1111.vibebuild.cc']);
    const etag = r.headers.get('etag'); assert.ok(etag);
    const again = await get(PID(1), '', { 'If-None-Match': etag });
    assert.equal(again.status, 304);
    const hit = await get(PID(1));
    assert.equal(hit.headers.get('x-thumbnail'), 'hit'); assert.equal(seen.length, 1); // cache: no second render
});

test('SSRF: other hosts, internal addresses and look-alike hosts never reach the screenshot service', async () => {
    behaviour = 'ok'; seen.length = 0;
    for (const n of [2, 3, 4, 5]) {
        const placeholder = await get(PID(n));
        assert.equal(placeholder.status, 404, `project ${n}`); // no usable app host: not found, nothing fetched
        const client = await get(PID(n), '?miss=404');
        assert.equal(client.status, 404);
    }
    assert.equal(seen.length, 0);
});

test('a client cannot choose the page to render: query parameters are ignored', async () => {
    behaviour = 'ok'; seen.length = 0;
    const r = await get(PID(6), `?url=${encodeURIComponent('https://evil.example.com')}&sub=evil&host=169.254.169.254`);
    assert.equal(r.status, 200);
    assert.deepEqual(seen, ['https://prev-cccc3333.vibebuild.cc']);
});

test('unknown and malformed ids are 404, and malformed ids never reach the database', async () => {
    const before = lookups;
    for (const bad of ['nope', '123', '..%2F..%2Fetc', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz']) assert.equal((await get(bad)).status, 404, bad);
    assert.equal(lookups, before);
    assert.equal((await get(PID(99))).status, 404);
});

test('a redirecting screenshot service is not followed: placeholder (or 404 with miss=404), never the redirect target', async () => {
    behaviour = 'redirect'; seen.length = 0;
    const r = await get(PID(7));
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/png'); assert.equal(r.headers.get('x-thumbnail'), 'unavailable');
    assert.match(r.headers.get('cache-control'), /max-age=30/);
    assert.equal(seen.length, 1);
    assert.equal(trapHits, 0, 'the redirect target was never requested');
    behaviour = 'ok';
});

test('an HTML or oversize reply from the screenshot service becomes a placeholder', async () => {
    for (const b of ['html', 'oversize']) {
        behaviour = b;
        const id = b === 'html' ? PID(7) : PID(8);
        const r = await get(id);
        assert.equal(r.headers.get('content-type'), 'image/png', b);
        assert.equal(r.headers.get('x-thumbnail'), 'unavailable', b);
        const client = await get(id, '?miss=404');
        assert.equal(client.status, 404, b);
    }
    behaviour = 'ok';
});

test('database failure: placeholder, or 503 with miss=404', async () => {
    const failing = { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { code: 'XX000', message: 'db down' } }) }) }) }) };
    const app = express();
    app.use('/api/projects/:id/thumbnail', createThumbnailRouter({ supabase: failing, service: createThumbnailService({ serviceUrl: shot }) }));
    const srv = await listen(app);
    try {
        const a = await fetch(`${srv.base}/api/projects/${PID(1)}/thumbnail`); assert.equal(a.status, 200); assert.equal(a.headers.get('content-type'), 'image/png');
        const b = await fetch(`${srv.base}/api/projects/${PID(1)}/thumbnail?miss=404`); assert.equal(b.status, 503);
    } finally { await srv.close(); }
});
