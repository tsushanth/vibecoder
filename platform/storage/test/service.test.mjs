import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { createPgStores } from '../../store/pg.js';
import { createAuthStore } from '../../auth/pgStore.js';
import { createStorageStore } from '../pgStore.js';
import { createStorageService } from '../service.js';
import { checkFile, safeName } from '../policy.js';

const R2 = { host: 'acct.r2.cloudflarestorage.com', bucket: 'vibe-files', accessKeyId: 'AKIDTEST0000000000', secretAccessKey: 'SECRETTEST'.padEnd(40, 'x') };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50)]);
const PDF = Buffer.from('%PDF-1.4\nhello');
let db, skip, svc, calls, nextStatus, uA, uB, clock = Date.UTC(2026, 9, 5);
const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); if (nextStatus === 'throw') throw new Error('net'); return new Response('', { status: nextStatus }); };
const mk = (limits) => createStorageService({ store: createStorageStore({ pool: db.pool }), r2: R2, fetchImpl, now: () => clock, limits });

before(async () => {
    db = await scratchDb(); if (db.unavailable) { skip = db.unavailable; return; }
    const stores = createPgStores({ pool: db.pool, masterKey: masterKey() });
    for (const a of ['app-a', 'app-b']) await stores.upsertApp({ appId: a, enabled: true, manifest: null });
    const au = createAuthStore({ pool: db.pool });
    uA = await au.upsertUser({ appId: 'app-a', email: 'a@example.com' }); uB = await au.upsertUser({ appId: 'app-a', email: 'b@example.com' });
    svc = mk();
});
after(async () => { if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); calls = []; nextStatus = 200; await f(c); });

test('policy: allowed types must match their first bytes; svg, html and mismatches are refused', () => {
    const ok = (contentType, bytes) => checkFile({ contentType, bytes, maxBytes: 1000 });
    assert.equal(ok('image/png', PNG).ok, true); assert.equal(ok('image/jpeg', JPG).ok, true); assert.equal(ok('application/pdf', PDF).ok, true);
    assert.equal(ok('image/gif', Buffer.from('GIF89a....')).ok, true); assert.equal(ok('image/webp', Buffer.from('RIFF\0\0\0\0WEBPVP8 ')).ok, true);
    assert.equal(ok('audio/mpeg', Buffer.from('ID3....')).ok, true); assert.equal(ok('audio/mpeg', Buffer.from([0xff, 0xfb, 0x90])).ok, true);
    assert.equal(ok('text/plain', Buffer.from('héllo wörld')).ok, true);
    for (const [type, code] of [['image/svg+xml', 'type_not_allowed'], ['text/html', 'type_not_allowed'], ['application/javascript', 'type_not_allowed'], ['constructor', 'type_not_allowed'], ['__proto__', 'type_not_allowed'], [undefined, 'type_not_allowed']])
        assert.equal(ok(type, PNG).code, code, String(type));
    assert.equal(ok('audio/mpeg', Buffer.from([0xff, 0x00, 0x00])).code, 'content_mismatch'); assert.equal(ok('audio/mpeg', Buffer.from([0x00, 0xfb, 0x90])).code, 'content_mismatch');
    assert.equal(ok('image/webp', Buffer.from('RIFF\0\0\0\0WAVEfmt ')).code, 'content_mismatch'); assert.equal(ok('image/webp', Buffer.from('RIFX\0\0\0\0WEBPVP8 ')).code, 'content_mismatch');
    assert.equal(ok('image/gif', Buffer.from('GIF90a....')).code, 'content_mismatch');
    assert.equal(ok('image/png', JPG).code, 'content_mismatch'); assert.equal(ok('application/pdf', PNG).code, 'content_mismatch');
    assert.equal(ok('text/plain', Buffer.from([0x68, 0x00, 0x69])).code, 'content_mismatch'); assert.equal(ok('text/plain', Buffer.from([0xc3, 0x28])).code, 'content_mismatch');
    assert.equal(ok('image/png', Buffer.alloc(0)).code, 'empty_file'); assert.equal(ok('image/png', 'not bytes').code, 'empty_file');
    assert.equal(checkFile({ contentType: 'image/png', bytes: Buffer.concat([PNG, Buffer.alloc(2000)]), maxBytes: 1000 }).code, 'file_too_large');
    assert.equal(checkFile({ contentType: 'image/png', bytes: PNG.subarray(0, 5), maxBytes: 1000 }).code, 'content_mismatch');
});

test('policy: names are reduced to a safe base name', () => {
    assert.equal(safeName('../../etc/passwd'), 'passwd'); assert.equal(safeName('C:\\x\\a b.png'), 'a b.png'); assert.equal(safeName('.hidden'), 'hidden');
    assert.equal(safeName('a"; filename="x'), 'a__ filename__x'); assert.equal(safeName('\u202egnp.exe'), '_gnp.exe'); assert.equal(safeName(''), 'file'); assert.equal(safeName(undefined), 'file'); assert.equal(safeName('...'), 'file');
    assert.equal(safeName('x'.repeat(300)).length, 100); assert.equal(safeName('a\r\nb: c'), 'a__b_ c');
});

t('an upload records the file, PUTs the bytes to the store with a presigned content-typed URL, and returns metadata', async () => {
    const r = await svc.upload({ appId: 'app-a', userId: uA, name: 'pic.png', contentType: 'image/png', bytes: PNG });
    assert.equal(r.ok, true); assert.deepEqual({ ...r.file, id: undefined }, { id: undefined, name: 'pic.png', contentType: 'image/png', bytes: PNG.length, isPublic: false });
    assert.equal(calls.length, 1); const u = new URL(calls[0].url);
    assert.equal(u.host, R2.host); assert.equal(u.pathname, `/vibe-files/app-a/${uA}/${r.file.id}-pic.png`); assert.equal(calls[0].init.method, 'PUT');
    assert.equal(u.searchParams.get('X-Amz-SignedHeaders'), 'content-type;host'); assert.equal(calls[0].init.headers['content-type'], 'image/png'); assert.equal(calls[0].init.body, PNG);
    assert.equal(calls[0].url.includes(R2.secretAccessKey), false); assert.equal(calls[0].init.redirect, 'manual');
    const row = (await db.pool.query('select app_id, user_id, bytes, is_public from platform.files where id = $1', [r.file.id])).rows[0];
    assert.deepEqual([row.app_id, row.user_id, Number(row.bytes), row.is_public], ['app-a', uA, PNG.length, false]);
});

t('a refused file never reaches the store or the database', async () => {
    const before = (await db.pool.query('select count(*)::int n from platform.files')).rows[0].n;
    for (const bad of [{ contentType: 'text/html', bytes: Buffer.from('<script>') }, { contentType: 'image/png', bytes: JPG }, { contentType: 'image/png', bytes: Buffer.alloc(0) }])
        assert.equal((await svc.upload({ appId: 'app-a', userId: uA, name: 'x', ...bad })).ok, false);
    assert.equal(calls.length, 0); assert.equal((await db.pool.query('select count(*)::int n from platform.files')).rows[0].n, before);
});

t('if the object store fails or refuses, the reservation is released and the caller gets 502', async () => {
    const before = (await db.pool.query('select count(*)::int n from platform.files')).rows[0].n;
    nextStatus = 500; assert.deepEqual(await svc.upload({ appId: 'app-a', userId: uA, name: 'x.png', contentType: 'image/png', bytes: PNG }), { ok: false, status: 502, code: 'storage_unavailable' });
    nextStatus = 'throw'; assert.equal((await svc.upload({ appId: 'app-a', userId: uA, name: 'x.png', contentType: 'image/png', bytes: PNG })).code, 'storage_unavailable');
    assert.equal((await db.pool.query('select count(*)::int n from platform.files')).rows[0].n, before);
});

t('quotas: bytes and file count per app are enforced atomically, also under concurrency', async () => {
    const s = mk({ maxAppBytes: 100000, maxAppFiles: 10000 });
    const used = (await db.pool.query("select coalesce(sum(bytes),0)::int b from platform.files where app_id='app-b'")).rows[0].b; assert.equal(used, 0);
    const au = createAuthStore({ pool: db.pool }); const ub = await au.upsertUser({ appId: 'app-b', email: 'q@example.com' });
    const big = Buffer.concat([PNG, Buffer.alloc(40000 - PNG.length)]);
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => s.upload({ appId: 'app-b', userId: ub, name: 'big.png', contentType: 'image/png', bytes: big })));
    assert.equal(rs.filter((r) => r.ok).length, 2); assert.equal(rs.filter((r) => r.code === 'quota_bytes').length, 3);
    const s2 = mk({ maxAppBytes: 1e9, maxAppFiles: 2 });
    assert.equal((await s2.upload({ appId: 'app-b', userId: ub, name: 'c.png', contentType: 'image/png', bytes: PNG })).code, 'quota_files');
});

t('downloads: owner gets a short-lived signed URL with safe disposition; others get 404; public files are open; bad ids are 404', async () => {
    const png = await svc.upload({ appId: 'app-a', userId: uA, name: 'my pic.png', contentType: 'image/png', bytes: PNG });
    const pdf = await svc.upload({ appId: 'app-a', userId: uA, name: 'doc.pdf', contentType: 'application/pdf', bytes: PDF });
    const pub = await svc.upload({ appId: 'app-a', userId: uA, name: 'pub.png', contentType: 'image/png', bytes: PNG, isPublic: true });
    const own = await svc.downloadUrl({ appId: 'app-a', userId: uA, id: png.file.id });
    assert.equal(own.ok, true); assert.equal(own.expiresInSec, 300);
    const u = new URL(own.url); assert.equal(u.searchParams.get('X-Amz-Expires'), '300'); assert.equal(u.searchParams.get('response-content-type'), 'image/png'); assert.equal(u.searchParams.get('response-content-disposition'), 'inline; filename="my pic.png"');
    assert.match(new URL((await svc.downloadUrl({ appId: 'app-a', userId: uA, id: pdf.file.id })).url).searchParams.get('response-content-disposition'), /^attachment;/);
    assert.equal((await svc.downloadUrl({ appId: 'app-a', userId: uB, id: png.file.id })).status, 404);
    assert.equal((await svc.downloadUrl({ appId: 'app-a', userId: null, id: png.file.id })).status, 404);
    assert.equal((await svc.downloadUrl({ appId: 'app-b', userId: uA, id: png.file.id })).status, 404);
    assert.equal((await svc.downloadUrl({ appId: 'app-a', userId: uB, id: pub.file.id })).ok, true); assert.equal((await svc.downloadUrl({ appId: 'app-a', userId: null, id: pub.file.id })).ok, true);
    for (const bad of ['x', '', undefined, '00000000-0000-0000-0000-000000000000', "1' or '1'='1"]) assert.equal((await svc.downloadUrl({ appId: 'app-a', userId: uA, id: bad })).status, 404, String(bad));
    assert.equal(calls.filter((c) => c.init.method !== 'PUT').length, 0);
});

t('list shows only the caller\'s files, newest first, with no object keys', async () => {
    const r = await svc.list({ appId: 'app-a', userId: uB }); assert.equal(r.files.length, 0);
    const mine = await svc.list({ appId: 'app-a', userId: uA }); assert.ok(mine.files.length >= 3);
    assert.deepEqual(Object.keys(mine.files[0]).sort(), ['bytes', 'contentType', 'createdAt', 'id', 'isPublic', 'name']);
    const times = mine.files.map((f) => +new Date(f.createdAt)); assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

t('remove deletes only the owner\'s file, calls DELETE on the store, and a second remove is 404', async () => {
    const f = await svc.upload({ appId: 'app-a', userId: uA, name: 'gone.png', contentType: 'image/png', bytes: PNG }); calls = [];
    assert.equal((await svc.remove({ appId: 'app-a', userId: uB, id: f.file.id })).status, 404); assert.equal(calls.length, 0);
    assert.equal((await svc.remove({ appId: 'app-a', userId: uA, id: f.file.id })).ok, true);
    assert.equal(calls.length, 1); assert.equal(calls[0].init.method, 'DELETE'); assert.match(new URL(calls[0].url).pathname, new RegExp(`${f.file.id}-gone\\.png$`));
    assert.equal((await svc.remove({ appId: 'app-a', userId: uA, id: f.file.id })).status, 404);
    assert.equal((await svc.remove({ appId: 'app-a', userId: uA, id: 'nope' })).status, 404);
});

t('a store failure while deleting does not fail the removal', async () => {
    const f = await svc.upload({ appId: 'app-a', userId: uA, name: 'g2.png', contentType: 'image/png', bytes: PNG });
    nextStatus = 'throw'; assert.equal((await svc.remove({ appId: 'app-a', userId: uA, id: f.file.id })).ok, true);
});
