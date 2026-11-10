import test from 'node:test';
import assert from 'node:assert/strict';
import { appLabel, thumbnailLabel, withHttpsThumbnail, isScreenshotThumbnail, neutralPlaceholderPng, createThumbnailService } from '../../lib/thumbnailService.js';

const B = 'vibebuild.cc';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const img = (body = JPEG, type = 'image/jpeg', extra = {}) => new Response(body, { status: 200, headers: { 'content-type': type, ...extra } });

test('appLabel accepts only https://<label>.<base domain>', () => {
    assert.equal(appLabel('https://prev-f4cb8371.vibebuild.cc', B), 'prev-f4cb8371');
    assert.equal(appLabel('https://Preview-53c81b18-aa6.vibebuild.cc/x?y=1', B), 'preview-53c81b18-aa6');
    for (const bad of [
        'http://prev-1.vibebuild.cc', 'https://vibebuild.cc', 'https://evil.com', 'https://prev-1.vibebuild.cc.evil.com',
        'https://evilvibebuild.cc', 'https://a.b.vibebuild.cc', 'https://x@prev-1.vibebuild.cc', 'https://u:p@prev-1.vibebuild.cc',
        'https://prev-1.vibebuild.cc:8443', 'https://127.0.0.1', 'https://169.254.169.254', 'https://localhost', 'https://[::1]',
        'https://-a.vibebuild.cc', 'https://a-.vibebuild.cc', 'https://prev_1.vibebuild.cc', 'javascript:alert(1)', 'not a url', '', null, undefined, 42,
        'https://' + 'a'.repeat(64) + '.vibebuild.cc', 'https://prev-1.vibebuild.cc.' ,
    ]) assert.equal(appLabel(bad, B), null, String(bad));
});

test('thumbnailLabel prefers the stored screenshot target, falls back to preview_url, rejects foreign hosts', () => {
    const shot = (t) => `http://178.156.231.255:3465/screenshot?url=${encodeURIComponent(t)}&width=390&height=844`;
    assert.equal(thumbnailLabel({ thumbnail_url: shot('https://prev-a1.vibebuild.cc'), preview_url: 'https://prev-b2.vibebuild.cc' }, B), 'prev-a1');
    assert.equal(thumbnailLabel({ thumbnail_url: 'https://x.supabase.co/a.jpg', preview_url: 'https://prev-b2.vibebuild.cc' }, B), 'prev-b2');
    assert.equal(thumbnailLabel({ thumbnail_url: shot('https://evil.com'), preview_url: 'https://prev-b2.vibebuild.cc' }, B), 'prev-b2');
    assert.equal(thumbnailLabel({ thumbnail_url: shot('http://169.254.169.254/latest'), preview_url: null }, B), null);
    assert.equal(thumbnailLabel({ thumbnail_url: shot('https://evil.com'), preview_url: 'https://evil.com' }, B), null);
    assert.equal(thumbnailLabel(null, B), null);
});

test('withHttpsThumbnail rewrites only plain-http screenshot thumbnails, keeps everything else, never mutates', () => {
    const p = { id: 'p1', title: 't', thumbnail_url: 'http://178.156.231.255:3465/screenshot?url=x&width=390&height=844' };
    const out = withHttpsThumbnail(p, 'https://api.example');
    assert.equal(out.thumbnail_url, 'https://api.example/api/projects/p1/thumbnail?miss=404');
    assert.equal(out.title, 't');
    assert.match(p.thumbnail_url, /^http:/);
    const store = { id: 'p2', thumbnail_url: 'https://abc.supabase.co/storage/v1/object/public/project-assets/thumbnails/x.jpg' };
    assert.equal(withHttpsThumbnail(store, 'https://api.example'), store);
    const none = { id: 'p3', thumbnail_url: null };
    assert.equal(withHttpsThumbnail(none, 'https://api.example'), none);
    assert.equal(withHttpsThumbnail({ thumbnail_url: p.thumbnail_url }, 'https://api.example').thumbnail_url, p.thumbnail_url); // no id: untouched
    assert.equal(isScreenshotThumbnail('http://h/other?url=x'), false);
});

test('placeholder is a valid PNG', () => {
    const png = neutralPlaceholderPng();
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(png.readUInt32BE(16), 78); assert.equal(png.readUInt32BE(20), 169);
    assert.ok(png.length < 4000);
});

test('rejects a bad base domain at construction', () => {
    assert.throws(() => createThumbnailService({ baseDomain: 'evil.com/path' }));
    assert.throws(() => createThumbnailService({ baseDomain: '' }));
});

test('get: renders once, then serves from cache; asks the service for the validated host only', async () => {
    const calls = [];
    const svc = createThumbnailService({ serviceUrl: 'http://svc.test:3465', fetchImpl: async (u, o) => { calls.push({ u, o }); return img(); } });
    const a = await svc.get('prev-a1');
    assert.equal(a.state, 'miss'); assert.equal(a.entry.type, 'image/jpeg');
    const b = await svc.get('prev-a1');
    assert.equal(b.state, 'hit'); assert.equal(calls.length, 1);
    assert.equal(calls[0].u, `http://svc.test:3465/screenshot?url=${encodeURIComponent('https://prev-a1.vibebuild.cc')}&width=390&height=844`);
    assert.equal(calls[0].o.redirect, 'error');
});

test('get: refuses labels that are not a single DNS label, without calling the service', async () => {
    let n = 0;
    const svc = createThumbnailService({ fetchImpl: async () => { n++; return img(); } });
    for (const bad of ['a.b', '../x', 'a/b', 'a?b', 'A B', '', null, 'x'.repeat(64), '-a']) assert.equal((await svc.get(bad)).state, 'busy', String(bad));
    assert.equal(n, 0);
});

test('get: concurrent requests for one app share one render; renders are capped by the concurrency setting', async () => {
    let running = 0, peak = 0, n = 0;
    const svc = createThumbnailService({ concurrency: 2, fetchImpl: async () => { n++; running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 20)); running--; return img(); } });
    const same = await Promise.all([svc.get('a1'), svc.get('a1'), svc.get('a1')]);
    assert.ok(same.every((r) => r.entry)); assert.equal(n, 1);
    n = 0; peak = 0;
    const many = await Promise.all(['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map((l) => svc.get(l)));
    assert.ok(many.every((r) => r.entry)); assert.equal(n, 6); assert.equal(peak, 2);
});

test('get: a full queue answers busy at once instead of piling more on the service', async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const svc = createThumbnailService({ concurrency: 1, maxQueue: 2, waitMs: 5000, fetchImpl: async () => { await gate; return img(); } });
    const pending = ['q1', 'q2', 'q3'].map((l) => svc.get(l)); // q1 running, q2 and q3 queued
    await new Promise((r) => setTimeout(r, 5));
    assert.equal((await svc.get('q4')).state, 'busy');
    release(); await Promise.all(pending);
});

test('get: a render slower than waitMs answers busy, keeps rendering, and the next request is a hit', async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const svc = createThumbnailService({ waitMs: 20, fetchImpl: async () => { await gate; return img(); } });
    assert.equal((await svc.get('s1')).state, 'busy');
    release(); await new Promise((r) => setTimeout(r, 20));
    assert.equal((await svc.get('s1')).state, 'hit');
});

test('get: upstream failures give busy, and a run of them opens the breaker so the service is left alone', async () => {
    let t = 1000, n = 0;
    const svc = createThumbnailService({ now: () => t, breakerFailures: 3, breakerOpenMs: 60_000, fetchImpl: async () => { n++; throw new Error('boom'); } });
    for (const l of ['f1', 'f2', 'f3']) assert.equal((await svc.get(l)).state, 'busy');
    assert.equal(n, 3); assert.equal(svc.stats().breakerOpen, true);
    assert.equal((await svc.get('f4')).state, 'busy'); assert.equal(n, 3);
    t += 61_000;
    assert.equal(svc.stats().breakerOpen, false);
    assert.equal((await svc.get('f5')).state, 'busy'); assert.equal(n, 4);
});

test('get: an app whose render failed is not re-rendered on every request, and does not trip the breaker', async () => {
    let t = 0, n = 0;
    const svc = createThumbnailService({ now: () => t, retryMs: 5000, breakerFailures: 2, fetchImpl: async () => { n++; return new Response('boom', { status: 500 }); } });
    assert.equal((await svc.get('dead1')).state, 'busy'); assert.equal(n, 1);
    assert.equal((await svc.get('dead1')).state, 'busy'); assert.equal(n, 1); // inside the retry window
    for (const l of ['dead2', 'dead3', 'dead4']) await svc.get(l);
    assert.equal(n, 4); assert.equal(svc.stats().breakerOpen, false); // broken apps are not a sick service
    t = 6000;
    await svc.get('dead1'); assert.equal(n, 5);
});

test('get: a stale image is served at once while it refreshes; a failed refresh keeps serving it', async () => {
    let t = 0, mode = 'ok', n = 0;
    const svc = createThumbnailService({ now: () => t, freshMs: 1000, staleMs: 100_000, retryMs: 5000, fetchImpl: async () => { n++; if (mode === 'fail') throw new Error('down'); return img(Buffer.concat([JPEG, Buffer.from([n])])); } });
    const first = await svc.get('r1'); assert.equal(first.state, 'miss');
    t = 2000; mode = 'fail';
    const second = await svc.get('r1'); assert.equal(second.state, 'stale'); assert.equal(second.entry.etag, first.entry.etag);
    await new Promise((r) => setTimeout(r, 10)); assert.equal(n, 2);
    const third = await svc.get('r1'); assert.equal(third.state, 'stale'); assert.equal(n, 2); // retry window: not hammered
    t = 9000; mode = 'ok';
    await svc.get('r1'); await new Promise((r) => setTimeout(r, 10));
    const fourth = await svc.get('r1'); assert.equal(fourth.state, 'hit'); assert.notEqual(fourth.entry.etag, first.entry.etag);
});

test('get: not an image, wrong type, lying type, empty and non-200 are all refused', async () => {
    const cases = [
        img('<html>hi</html>', 'text/html'),
        img('<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml'),
        img(Buffer.from('<html>'), 'image/jpeg'),            // header says image, bytes are not
        img(Buffer.alloc(0), 'image/jpeg'),
        img(JPEG, 'image/png'),                              // header and bytes disagree
        new Response('nope', { status: 500, headers: { 'content-type': 'image/jpeg' } }),
    ];
    for (const [i, r] of cases.entries()) {
        const svc = createThumbnailService({ fetchImpl: async () => r });
        assert.equal((await svc.get('x' + i)).state, 'busy', `case ${i}`);
    }
});

test('get: oversize is refused, by declared length and by actual bytes without one', async () => {
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5000)]);
    let svc = createThumbnailService({ maxImageBytes: 1000, fetchImpl: async () => img(big, 'image/jpeg', { 'content-length': String(big.length) }) });
    assert.equal((await svc.get('o1')).state, 'busy');
    const stream = new ReadableStream({ start(c) { for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(1000).fill(0xff)); c.close(); } });
    svc = createThumbnailService({ maxImageBytes: 1000, fetchImpl: async () => new Response(stream, { status: 200, headers: { 'content-type': 'image/jpeg' } }) });
    assert.equal((await svc.get('o2')).state, 'busy');
});

test('get: the cache is bounded by entry count and by bytes', async () => {
    const svc = createThumbnailService({ maxEntries: 3, fetchImpl: async () => img() });
    for (const l of ['c1', 'c2', 'c3', 'c4', 'c5']) await svc.get(l);
    assert.equal(svc.stats().entries, 3);
    const svc2 = createThumbnailService({ maxTotalBytes: 450, fetchImpl: async () => img() }); // each image is 204 bytes
    for (const l of ['d1', 'd2', 'd3']) await svc2.get(l);
    assert.ok(svc2.stats().bytes <= 450); assert.equal(svc2.stats().entries, 2);
});
