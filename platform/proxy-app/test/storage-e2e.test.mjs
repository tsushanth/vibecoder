import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { startServer } from '../start.js';
import { createPgStores } from '../../store/pg.js';
import { loadConfig } from '../config.js';
import { readRaw } from '../server.js';
import { Readable } from 'node:stream';

const ADMIN_T = 'admin-' + 'z'.repeat(40);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]);
const R2ENV = { R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'vibe-test-files', R2_ACCESS_KEY_ID: 'k'.repeat(32), R2_SECRET_ACCESS_KEY: 's'.repeat(64) };
let db, skip, MK, mails = [], r2calls = [], r2Status = 200, srv, noStorage;
const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.startsWith('https://api.resend.com/')) { mails.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
    if (u.includes('.r2.cloudflarestorage.com')) { r2calls.push({ url: u, method: init?.method, len: init?.body?.length }); return new Response('', { status: r2Status }); }
    return new Response('{}', { status: 200 });
};
const cfg = (extra = {}) => loadConfig({ DATABASE_URL: 'postgres://unused/x', VIBE_MASTER_KEY: MK, OPENROUTER_API_KEY: 'sk-or-v1-FAKE', BASE_DOMAIN: 'vibebuild.cc', PORT: '8080', PROXY_ADMIN_TOKEN: ADMIN_T, RESEND_API_KEY: 're_testkey12345', AUTH_MAIL_FROM: 'login@mail.vibebuild.cc', PER_IP_PER_MIN: '1000', ...extra });
before(async () => {
    db = await scratchDb(); if (db.unavailable) { skip = db.unavailable; return; }
    MK = masterKey();
    const stores = createPgStores({ pool: db.pool, masterKey: MK });
    for (const a of ['app-a', 'app-b']) await stores.upsertApp({ appId: a, enabled: true });
    srv = await startServer(cfg(R2ENV), { pool: db.pool, listenPort: 0, fetchImpl });
    noStorage = await startServer(cfg(), { pool: db.pool, listenPort: 0, fetchImpl });
});
after(async () => { await srv?.close(); await noStorage?.close(); if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); mails.length = 0; r2calls.length = 0; r2Status = 200; await f(c); });
const base = (s) => `http://127.0.0.1:${s.port}`;
let ipn = 20;
const ipHdr = () => ({ 'fly-client-ip': `9.8.${++ipn}.1` });
const signIn = async (appId, email, s = srv) => {
    await fetch(`${base(s)}/${appId}/auth/request`, { method: 'POST', headers: { 'content-type': 'application/json', ...ipHdr() }, body: JSON.stringify({ email }) });
    const link = new URL(/https:\/\/\S+/.exec(mails.at(-1).text)[0]).searchParams.get('vibe_login');
    return (await (await fetch(`${base(s)}/${appId}/auth/consume`, { method: 'POST', headers: { 'content-type': 'application/json', ...ipHdr() }, body: JSON.stringify({ token: link }) })).json()).token;
};
const upload = (appId, token, { name = 'pic.png', type = 'image/png', body = PNG, query = '', s = srv, headers = {} } = {}) => fetch(`${base(s)}/${appId}/storage/upload?name=${encodeURIComponent(name)}${query}`, { method: 'POST', headers: { 'content-type': type, ...(token ? { authorization: `Bearer ${token}` } : {}), ...ipHdr(), ...headers }, body });
const call = (appId, op, token, body = {}, s = srv) => fetch(`${base(s)}/${appId}/storage/${op}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...ipHdr() }, body: JSON.stringify(body) });

t('full flow over HTTP: upload, list, signed download URL, delete', async () => {
    const tok = await signIn('app-a', 'ann@example.com');
    const up = await upload('app-a', tok); assert.equal(up.status, 200);
    const { file } = await up.json(); assert.equal(file.name, 'pic.png'); assert.equal(file.bytes, PNG.length);
    assert.equal(r2calls.length, 1); assert.equal(r2calls[0].method, 'PUT'); assert.equal(r2calls[0].len, PNG.length); assert.match(r2calls[0].url, /^https:\/\/a{32}\.r2\.cloudflarestorage\.com\/vibe-test-files\/app-a\//);
    const list = await (await call('app-a', 'list', tok)).json(); assert.deepEqual(list.files.map((f) => f.id), [file.id]);
    const u = await (await call('app-a', 'url', tok, { id: file.id })).json(); assert.match(u.url, /X-Amz-Signature=/); assert.equal(u.expiresInSec, 300); assert.equal(u.url.includes('s'.repeat(64)), false);
    assert.equal((await call('app-a', 'delete', tok, { id: file.id })).status, 200); assert.equal(r2calls.at(-1).method, 'DELETE');
    assert.equal((await call('app-a', 'url', tok, { id: file.id })).status, 404);
});

t('users cannot see or fetch each other\'s files, and another app cannot either', async () => {
    const a = await signIn('app-a', 'u1@example.com'); const b = await signIn('app-a', 'u2@example.com'); const other = await signIn('app-b', 'u1@example.com');
    const { file } = await (await upload('app-a', a)).json();
    assert.equal((await call('app-a', 'url', b, { id: file.id })).status, 404);
    assert.equal((await (await call('app-a', 'list', b)).json()).files.length, 0);
    assert.equal((await call('app-b', 'url', other, { id: file.id })).status, 404);
    assert.equal((await call('app-a', 'delete', b, { id: file.id })).status, 404);
    assert.equal((await call('app-b', 'list', a)).status, 401); // a token for app-a does not work on app-b
});

t('no token, a bad token and a malformed header are 401 and never reach the store', async () => {
    assert.equal((await upload('app-a', null)).status, 401);
    assert.equal((await upload('app-a', 'garbage.token.value')).status, 401);
    assert.equal((await call('app-a', 'list', null)).status, 401);
    assert.equal((await upload('app-a', null, { headers: { authorization: 'Basic abc' } })).status, 401);
    assert.equal(r2calls.length, 0);
});

t('type and content rules are enforced over HTTP', async () => {
    const tok = await signIn('app-a', 'rules@example.com');
    const r = async (o) => { const x = await upload('app-a', tok, o); return [x.status, (await x.json()).error]; };
    assert.deepEqual(await r({ type: 'text/html', body: Buffer.from('<script>alert(1)</script>') }), [415, 'type_not_allowed']);
    assert.deepEqual(await r({ type: 'image/svg+xml', body: Buffer.from('<svg/>') }), [415, 'type_not_allowed']);
    assert.deepEqual(await r({ type: 'image/png', body: Buffer.from('not a png at all') }), [415, 'content_mismatch']);
    assert.deepEqual(await r({ body: Buffer.alloc(0) }), [400, 'empty_file']);
    assert.equal(r2calls.length, 0);
    assert.equal((await upload('app-a', tok, { type: 'image/png; charset=binary' })).status, 200);
});

t('size limit: a declared or actual size over 5 MB is 413 and nothing is stored', async () => {
    const tok = await signIn('app-a', 'big@example.com');
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    const r = await upload('app-a', tok, { body: big }); assert.equal(r.status, 413);
    assert.equal(r2calls.length, 0);
    const exact = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 - PNG.length)]); assert.equal(exact.length, 5 * 1024 * 1024);
    assert.equal((await upload('app-a', tok, { body: exact })).status, 200);
});

t('an object store failure is 502 and leaves no file record', async () => {
    const tok = await signIn('app-a', 'fail@example.com'); r2Status = 500;
    const r = await upload('app-a', tok); assert.equal(r.status, 502); assert.deepEqual(await r.json(), { error: 'storage_unavailable' });
    assert.equal((await (await call('app-a', 'list', tok)).json()).files.length, 0);
});

t('public files can be fetched by any signed-in user of the app via their id', async () => {
    const a = await signIn('app-a', 'pa@example.com'); const b = await signIn('app-a', 'pb@example.com');
    const { file } = await (await upload('app-a', a, { query: '&public=1' })).json(); assert.equal(file.isPublic, true);
    assert.equal((await call('app-a', 'url', b, { id: file.id })).status, 200);
});

t('without storage configured the routes answer 503; an unknown op is 404; the preflight allows the app origin', async () => {
    const tok = await signIn('app-a', 'ns@example.com', noStorage);
    const r = await call('app-a', 'list', tok, {}, noStorage); assert.equal(r.status, 503); assert.deepEqual(await r.json(), { error: 'storage_unavailable' });
    assert.equal((await call('app-a', 'frobnicate', tok)).status, 404);
    const pre = await fetch(`${base(srv)}/app-a/storage/upload`, { method: 'OPTIONS', headers: { origin: 'https://app-a.vibebuild.cc', 'access-control-request-method': 'POST', ...ipHdr() } });
    assert.equal(pre.status, 204); assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
});

t('a partial R2 configuration is refused at startup, naming the settings', async () => {
    assert.throws(() => cfg({ R2_BUCKET: 'vibe-test-files' }), /R2_ACCOUNT_ID/);
    assert.throws(() => cfg({ ...R2ENV, R2_ACCOUNT_ID: 'xyz' }), /R2_ACCOUNT_ID/);
    assert.throws(() => cfg({ ...R2ENV, R2_BUCKET: 'Bad Bucket' }), /R2_BUCKET/);
    assert.equal(JSON.stringify(cfg(R2ENV)).includes('s'.repeat(64)), false);
});

const fakeReq = (chunks, headers = {}) => { const r = Readable.from(chunks); r.headers = headers; r.destroyed2 = false; const d = r.destroy.bind(r); r.destroy = () => { r.destroyed2 = true; return d(); }; return r; };

test('readRaw: a declared length over the cap is refused without reading; the cap itself is allowed', async () => {
    const r = fakeReq([Buffer.alloc(10)], { 'content-length': '11' }); assert.deepEqual(await readRaw(r, 10), { error: 413 });
    assert.equal((await readRaw(fakeReq([Buffer.alloc(10)], { 'content-length': '10' }), 10)).value.length, 10);
    assert.equal((await readRaw(fakeReq([Buffer.alloc(3), Buffer.alloc(4)], {}), 10)).value.length, 7);
});

test('readRaw: a body over the cap with no honest length is refused, and a huge one is cut off early', async () => {
    assert.deepEqual(await readRaw(fakeReq([Buffer.alloc(6), Buffer.alloc(6)], {}), 10), { error: 413 });
    let pulled = 0;
    const gen = (async function* () { for (let i = 0; i < 6; i++) { pulled++; yield Buffer.alloc(30); } })();
    const req = Readable.from(gen); req.headers = {};
    assert.deepEqual(await readRaw(req, 10), { error: 413 });
    assert.ok(pulled <= 3, `pulled ${pulled} chunks`); // 30, then 60 > 4 * 10 => stop
    pulled = 0;
    const gen2 = (async function* () { for (let i = 0; i < 3; i++) { pulled++; yield Buffer.alloc(15); } })();
    const r2 = Readable.from(gen2); r2.headers = {};
    assert.deepEqual(await readRaw(r2, 10), { error: 413 }); assert.equal(pulled, 3); // 45 > 40 only at the last chunk: all read before refusing
});

t('storage routes share the per-IP rate limit and honour the kill switch', async () => {
    const limited = await startServer(cfg({ ...R2ENV, PER_IP_PER_MIN: '3' }), { pool: db.pool, listenPort: 0, fetchImpl });
    try {
        const codes = []; for (let i = 0; i < 5; i++) codes.push((await fetch(`${base(limited)}/app-a/storage/list`, { method: 'POST', headers: { 'content-type': 'application/json', 'fly-client-ip': '4.4.4.4' }, body: '{}' })).status);
        assert.deepEqual(codes, [401, 401, 401, 429, 429]);
        const stores = createPgStores({ pool: db.pool, masterKey: MK }); await stores.upsertApp({ appId: 'app-k', enabled: true }); await stores.limiterStore.set('kill:app-k', 1, 3600);
        assert.equal((await fetch(`${base(limited)}/app-k/storage/list`, { method: 'POST', headers: { 'content-type': 'application/json', 'fly-client-ip': '5.5.5.5' }, body: '{}' })).status, 403);
    } finally { await limited.close(); }
});
