import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { startServer } from '../start.js';
import { createPgStores } from '../../store/pg.js';
import { loadConfig } from '../config.js';

const ADMIN_T = 'admin-' + 'z'.repeat(40);
let stores0, db, skip, MK, mails = [], mailStatus = 200, srv, bare;
const fetchImpl = async (url, init) => {
    if (String(url).startsWith('https://api.resend.com/')) { mails.push(JSON.parse(init.body)); return new Response('{}', { status: mailStatus }); }
    return new Response('{}', { status: 200 });
};
const cfg = (extra = {}) => loadConfig({ DATABASE_URL: 'postgres://unused/x', VIBE_MASTER_KEY: MK, OPENROUTER_API_KEY: 'sk-or-v1-FAKE', BASE_DOMAIN: 'vibebuild.cc', PORT: '8080', PROXY_ADMIN_TOKEN: ADMIN_T, ...extra });
before(async () => {
    db = await scratchDb(); if (db.unavailable) { skip = db.unavailable; return; }
    MK = masterKey();
    const stores = createPgStores({ pool: db.pool, masterKey: MK }); stores0 = stores;
    for (const a of ['app-a', 'app-b', 'app-k']) await stores.upsertApp({ appId: a, enabled: true, domains: a === 'app-b' ? ['shop.example.com'] : [] });
    await stores.upsertApp({ appId: 'off', enabled: false });
    srv = await startServer(cfg({ RESEND_API_KEY: 're_testkey12345', AUTH_MAIL_FROM: 'login@mail.vibebuild.cc' }), { pool: db.pool, listenPort: 0, fetchImpl });
    bare = await startServer(cfg(), { pool: db.pool, listenPort: 0, fetchImpl });
});
after(async () => { await srv?.close(); await bare?.close(); if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); mails.length = 0; mailStatus = 200; await f(c); });
let ipn = 10;
const post = (s, path, body = {}, headers = {}, ip = `9.9.${++ipn}.1`) => fetch(`http://127.0.0.1:${s.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'fly-client-ip': ip, ...headers }, body: JSON.stringify(body) });
const tokenFromMail = () => new URL(/https:\/\/\S+/.exec(mails.at(-1).text)[0]).searchParams.get('vibe_login');

t('full flow over HTTP: request, email, consume, me, signout, me again', async () => {
    assert.equal((await post(srv, '/app-a/auth/request', { email: 'ann@example.com' })).status, 200);
    assert.equal(mails.length, 1); assert.deepEqual(mails[0].to, ['ann@example.com']); assert.match(mails[0].text, /^Use this link to sign in to app-a/);
    assert.match(/https:\/\/\S+/.exec(mails[0].text)[0], /^https:\/\/app-a\.vibebuild\.cc\/\?vibe_login=/);
    const c = await post(srv, '/app-a/auth/consume', { token: tokenFromMail() });
    assert.equal(c.status, 200); const { token, user } = await c.json(); assert.equal(user.email, 'ann@example.com');
    const auth = { authorization: `Bearer ${token}` };
    const me = await post(srv, '/app-a/auth/me', {}, auth); assert.equal(me.status, 200); assert.deepEqual((await me.json()).user, user);
    assert.equal((await post(srv, '/app-a/auth/signout', {}, auth)).status, 200);
    assert.equal((await post(srv, '/app-a/auth/me', {}, auth)).status, 401);
});

t('the link goes to the first custom domain when the app has one', async () => {
    await post(srv, '/app-b/auth/request', { email: 'bo@example.com' });
    assert.match(/https:\/\/\S+/.exec(mails[0].text)[0], /^https:\/\/shop\.example\.com\/\?vibe_login=/);
});

t('a token from one app does not work on another, and a reused link is refused', async () => {
    await post(srv, '/app-a/auth/request', { email: 'cy@example.com' });
    const link = tokenFromMail();
    const { token } = await (await post(srv, '/app-a/auth/consume', { token: link })).json();
    assert.equal((await post(srv, '/app-b/auth/me', {}, { authorization: `Bearer ${token}` })).status, 401);
    const again = await post(srv, '/app-a/auth/consume', { token: link }); assert.equal(again.status, 400); assert.deepEqual(await again.json(), { error: 'invalid_link' });
});

t('missing or malformed bearer is 401; bad email is 400; a mail provider failure is 503', async () => {
    assert.equal((await post(srv, '/app-a/auth/me', {})).status, 401);
    assert.equal((await post(srv, '/app-a/auth/me', {}, { authorization: 'Basic abc' })).status, 401);
    assert.equal((await post(srv, '/app-a/auth/signout', {}, { authorization: 'Bearer ' })).status, 401);
    assert.equal((await post(srv, '/app-a/auth/request', { email: 'nope' })).status, 400);
    mailStatus = 500; assert.equal((await post(srv, '/app-a/auth/request', { email: 'dee@example.com' })).status, 503);
});

t('too many link requests for one email answer 429', async () => {
    const codes = []; for (let i = 0; i < 7; i++) codes.push((await post(srv, '/app-a/auth/request', { email: 'spam@example.com' })).status);
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
});

t('a disabled app and an unknown app cannot sign anyone in', async () => {
    assert.equal((await post(srv, '/off/auth/request', { email: 'x@example.com' })).status, 403);
    assert.equal((await post(srv, '/ghost/auth/request', { email: 'x@example.com' })).status, 404);
    assert.equal(mails.length, 0);
});

t('without a mail sender configured the auth routes answer 503 and nothing is sent', async () => {
    const r = await post(bare, '/app-a/auth/request', { email: 'ed@example.com' });
    assert.equal(r.status, 503); assert.deepEqual(await r.json(), { error: 'auth_unavailable' }); assert.equal(mails.length, 0);
});

t('CORS: the preflight allows the authorization header for the app origin only', async () => {
    const pre = (origin) => fetch(`http://127.0.0.1:${srv.port}/app-a/auth/me`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'fly-client-ip': '8.8.8.8' } });
    const ok = await pre('https://app-a.vibebuild.cc'); assert.equal(ok.status, 204); assert.match(ok.headers.get('access-control-allow-headers'), /authorization/);
    assert.equal((await pre('https://evil.example.com')).status, 403);
});

t('no token, link or key ever reaches the stored rows or the usage log as plain text', async () => {
    await post(srv, '/app-a/auth/request', { email: 'zed@example.com' });
    const tok = tokenFromMail();
    const { rows } = await db.pool.query("select (select coalesce(string_agg(row_to_json(l)::text, ' '), '') from platform.login_links l) || (select coalesce(string_agg(row_to_json(u)::text, ' '), '') from platform.usage_events u) d");
    assert.equal(rows[0].d.includes(tok), false); assert.equal(rows[0].d.includes('re_testkey'), false);
});

t('the per-IP rate limit applies to auth routes', async () => {
    const codes = []; for (let i = 0; i < 32; i++) codes.push((await post(srv, '/app-a/auth/me', {}, {}, '6.6.6.6')).status);
    assert.equal(codes.filter((c) => c === 401).length, 30); assert.deepEqual(codes.slice(30), [429, 429]);
});

t('the kill switch stops sign-in with 403', async () => {
    await stores0.limiterStore.set('kill:app-k', 1, 3600);
    const r = await post(srv, '/app-k/auth/request', { email: 'k@example.com' });
    assert.equal(r.status, 403); assert.equal(mails.length, 0);
});
