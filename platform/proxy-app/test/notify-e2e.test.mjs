import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { startServer } from '../start.js';
import { createPgStores } from '../../store/pg.js';
import { loadConfig } from '../config.js';

const ADMIN_T = 'admin-' + 'z'.repeat(40);
let db, skip, MK, mails = [], resendStatus = 200, srv, noMail, stores;
const fetchImpl = async (url, init) => {
    if (String(url).startsWith('https://api.resend.com/')) { mails.push(JSON.parse(init.body)); return new Response('{}', { status: resendStatus }); }
    return new Response('{}', { status: 200 });
};
const cfg = (extra = {}) => loadConfig({ DATABASE_URL: 'postgres://unused/x', VIBE_MASTER_KEY: MK, OPENROUTER_API_KEY: 'sk-or-v1-FAKE', BASE_DOMAIN: 'vibebuild.cc', PORT: '8080', PROXY_ADMIN_TOKEN: ADMIN_T, RESEND_API_KEY: 're_testkey12345', AUTH_MAIL_FROM: 'Vibe <login@mail.vibebuild.cc>', PER_IP_PER_MIN: '1000', ...extra });
before(async () => {
    db = await scratchDb(); if (db.unavailable) { skip = db.unavailable; return; }
    MK = masterKey();
    stores = createPgStores({ pool: db.pool, masterKey: MK });
    for (const a of ['app-a', 'app-b']) await stores.upsertApp({ appId: a, enabled: true });
    await stores.upsertApp({ appId: 'app-off', enabled: false });
    srv = await startServer(cfg({ NOTIFY_USER_PER_HOUR: '3', NOTIFY_USER_PER_DAY: '10', NOTIFY_APP_PER_DAY: '500', NOTIFY_GLOBAL_PER_DAY: '600' }), { pool: db.pool, listenPort: 0, fetchImpl });
    noMail = await startServer(cfg({ RESEND_API_KEY: '', AUTH_MAIL_FROM: '' }), { pool: db.pool, listenPort: 0, fetchImpl });
});
after(async () => { await srv?.close(); await noMail?.close(); if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); mails.length = 0; resendStatus = 200; await f(c); });
const base = (s = srv) => `http://127.0.0.1:${s.port}`;
let ipn = 20;
const ipHdr = () => ({ 'fly-client-ip': `7.6.${++ipn}.1` });
let emailn = 0; const fresh = () => `n${++emailn}@example.com`;
const signIn = async (appId, email = fresh(), s = srv) => {
    await fetch(`${base(s)}/${appId}/auth/request`, { method: 'POST', headers: { 'content-type': 'application/json', ...ipHdr() }, body: JSON.stringify({ email }) });
    const link = new URL(/https:\/\/\S+/.exec(mails.at(-1).text)[0]).searchParams.get('vibe_login');
    const r = await (await fetch(`${base(s)}/${appId}/auth/consume`, { method: 'POST', headers: { 'content-type': 'application/json', ...ipHdr() }, body: JSON.stringify({ token: link }) })).json();
    mails.length = 0;
    return { token: r.token, email, id: r.user.id };
};
const me = (appId, token, body = { subject: 'Hello', text: 'World' }, { s = srv, headers = {}, raw } = {}) => fetch(`${base(s)}/${appId}/notify/me`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...ipHdr(), ...headers }, body: raw ?? JSON.stringify(body) });
const unsubPath = (mail) => new URL(/https:\/\/\S+/.exec(mail.text.split('\n').find((l) => l.includes('/notify/unsubscribe')))[0]);

t('notify.me sends one email to the signed-in user\'s own address with a footer and unsubscribe headers', async () => {
    const u = await signIn('app-a');
    const r = await me('app-a', u.token, { subject: 'Order shipped', text: 'It is on its way.' });
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
    assert.equal(mails.length, 1);
    const m = mails[0];
    assert.deepEqual(m.to, [u.email]); assert.equal(m.from, 'Vibe <login@mail.vibebuild.cc>'); assert.equal(m.subject, 'Order shipped');
    assert.ok(m.text.startsWith('It is on its way.')); assert.match(m.text, /app-a/); assert.match(m.text, /stop receiving/i);
    const link = unsubPath(m);
    assert.equal(link.origin, 'https://vibe-proxy.vibebuild.cc'); assert.equal(link.pathname, '/app-a/notify/unsubscribe');
    assert.equal(m.headers['List-Unsubscribe'], `<${link.href}>`); assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.equal('html' in m, false);
});

t('the recipient cannot be chosen by the browser: to, cc, bcc, from and email fields are ignored', async () => {
    const u = await signIn('app-a'); const other = await signIn('app-a');
    const r = await me('app-a', u.token, { subject: 's', text: 't', userId: other.id, user_id: other.id, sub: other.id, to: 'victim@example.com', cc: 'v2@example.com', bcc: 'v3@example.com', from: 'ceo@bank.example', email: 'victim@example.com', headers: { Bcc: 'v4@example.com' }, html: '<b>x</b>' });
    assert.equal(r.status, 200);
    assert.deepEqual(mails[0].to, [u.email]); assert.equal(mails[0].from, 'Vibe <login@mail.vibebuild.cc>');
    const s = JSON.stringify(mails[0]); assert.equal(/victim|v2@|v3@|v4@|ceo@bank|<b>/.test(s), false);
    assert.deepEqual(Object.keys(mails[0].headers).sort(), ['List-Unsubscribe', 'List-Unsubscribe-Post']);
});

t('the unsubscribe link uses NOTIFY_PUBLIC_URL when set', async () => {
    const custom = await startServer(cfg({ NOTIFY_PUBLIC_URL: 'https://notify.example.org/' }), { pool: db.pool, listenPort: 0, fetchImpl });
    try { const u = await signIn('app-a'); assert.equal((await me('app-a', u.token, undefined, { s: custom })).status, 200); assert.equal(unsubPath(mails[0]).origin, 'https://notify.example.org'); } finally { await custom.close(); }
});

t('an http origin is refused even on the app host', async () => {
    const u = await signIn('app-a');
    assert.equal((await me('app-a', u.token, undefined, { headers: { origin: 'http://app-a.vibebuild.cc' } })).status, 403);
    assert.equal(mails.length, 0);
});

t('a CR/LF in the subject cannot add headers', async () => {
    const u = await signIn('app-a');
    assert.equal((await me('app-a', u.token, { subject: 'Hi\r\nBcc: evil@example.com', text: 't' })).status, 200);
    assert.equal(mails[0].subject, 'Hi Bcc: evil@example.com'); assert.equal(/[\r\n]/.test(mails[0].subject), false);
});

t('content limits: 120 and 2000 pass, one more fails with 400 and nothing is sent', async () => {
    const u = await signIn('app-a');
    assert.equal((await me('app-a', u.token, { subject: 'a'.repeat(120), text: 'b'.repeat(2000) })).status, 200);
    const r1 = await me('app-a', u.token, { subject: 'a'.repeat(121), text: 'x' }); assert.equal(r1.status, 400); assert.deepEqual(await r1.json(), { error: 'invalid_content', detail: 'subject_too_long' });
    const r2 = await me('app-a', u.token, { subject: 'a', text: 'b'.repeat(2001) }); assert.equal(r2.status, 400); assert.equal((await r2.json()).detail, 'text_too_long');
    assert.equal((await me('app-a', u.token, { subject: '', text: 'x' })).status, 400);
    assert.equal((await me('app-a', u.token, {})).status, 400);
    assert.equal(mails.length, 1);
});

t('no token, a garbage token and a malformed header are 401 and send nothing', async () => {
    assert.equal((await me('app-a', null)).status, 401);
    assert.equal((await me('app-a', 'garbage.token.value')).status, 401);
    assert.equal((await me('app-a', null, undefined, { headers: { authorization: 'Basic abc' } })).status, 401);
    assert.equal(mails.length, 0);
});

t('a token for another app, and a signed-out token, do not work', async () => {
    const a = await signIn('app-a'); const b = await signIn('app-b');
    assert.equal((await me('app-b', a.token)).status, 401); assert.equal((await me('app-a', b.token)).status, 401);
    await fetch(`${base()}/app-a/auth/signout`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${a.token}`, ...ipHdr() }, body: '{}' });
    assert.equal((await me('app-a', a.token)).status, 401);
    assert.equal(mails.length, 0);
});

t('rate limits: the 4th message in an hour is 429 with Retry-After', async () => {
    const u = await signIn('app-a');
    for (let i = 0; i < 3; i++) assert.equal((await me('app-a', u.token)).status, 200);
    const r = await me('app-a', u.token); assert.equal(r.status, 429); assert.deepEqual(await r.json(), { error: 'rate_limited' });
    const ra = Number(r.headers.get('retry-after')); assert.ok(ra >= 1 && ra <= 3600, String(ra));
    assert.equal(mails.length, 3);
    assert.equal((await me('app-a', (await signIn('app-a')).token)).status, 200); // another user is unaffected
});

t('an opted-out user is not emailed; opting out of one app leaves another alone', async () => {
    const email = fresh(); const a = await signIn('app-a', email); const b = await signIn('app-b', email);
    await me('app-a', a.token); const url = unsubPath(mails.at(-1)); mails.length = 0;
    const post = await fetch(`${base()}${url.pathname}${url.search}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...ipHdr() }, body: 'List-Unsubscribe=One-Click' });
    assert.equal(post.status, 200); assert.match(post.headers.get('content-type'), /text\/html/);
    const r = await me('app-a', a.token); assert.equal(r.status, 409); assert.deepEqual(await r.json(), { error: 'opted_out' });
    assert.equal(mails.length, 0);
    assert.equal((await me('app-b', b.token)).status, 200);
});

t('GET on the unsubscribe link only shows a confirmation form and changes nothing (mail scanners prefetch links)', async () => {
    const a = await signIn('app-a'); await me('app-a', a.token); const url = unsubPath(mails.at(-1)); mails.length = 0;
    const g = await fetch(`${base()}${url.pathname}${url.search}`, { headers: ipHdr() });
    assert.equal(g.status, 200); assert.match(g.headers.get('content-type'), /text\/html/);
    const html = await g.text(); assert.match(html, /<form method="post"/); assert.match(html, /app-a/);
    assert.match(g.headers.get('content-security-policy'), /default-src 'none'/); assert.equal(g.headers.get('x-frame-options'), 'DENY'); assert.match(g.headers.get('cache-control'), /no-store/); assert.equal(g.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await me('app-a', a.token)).status, 200); // still subscribed
    const form = /action="([^"]+)"/.exec(html)[1];
    assert.equal((await fetch(`${base()}${form}`, { method: 'POST', headers: ipHdr() })).status, 200);
    assert.equal((await me('app-a', a.token)).status, 409);
});

t('unsubscribe links: another app\'s app id, a tampered or missing token are 400 and record nothing', async () => {
    const a = await signIn('app-a'); await me('app-a', a.token); const url = unsubPath(mails.at(-1)); mails.length = 0;
    const tok = url.searchParams.get('t');
    for (const p of [`/app-b/notify/unsubscribe?t=${tok}`, `/app-a/notify/unsubscribe?t=${tok.slice(0, -2)}zz`, '/app-a/notify/unsubscribe', '/app-a/notify/unsubscribe?t=']) {
        for (const method of ['GET', 'POST']) { const r = await fetch(`${base()}${p}`, { method, headers: ipHdr() }); assert.equal(r.status, 400, `${method} ${p}`); assert.equal((await r.text()).includes(tok), false); }
    }
    assert.equal((await me('app-a', a.token)).status, 200);
});

t('unsubscribe works on a disabled app and for a killed app (opting out is never blocked)', async () => {
    const a = await signIn('app-a'); await me('app-a', a.token); const url = unsubPath(mails.at(-1));
    await stores.setEnabled('app-a', false); await stores.limiterStore.set('kill:app-a', 1, 3600);
    try { assert.equal((await fetch(`${base()}${url.pathname}${url.search}`, { method: 'POST', headers: ipHdr() })).status, 200); }
    finally { await stores.setEnabled('app-a', true); await stores.limiterStore.set('kill:app-a', 0, 1); }
});

t('unsubscribe on an unknown app is 404; other methods are 405', async () => {
    assert.equal((await fetch(`${base()}/nope/notify/unsubscribe?t=x`, { headers: ipHdr() })).status, 404);
    assert.equal((await fetch(`${base()}/app-a/notify/unsubscribe?t=x`, { method: 'PUT', headers: ipHdr() })).status, 405);
});

t('the kill switch and a disabled app stop notify.me with 403', async () => {
    const a = await signIn('app-a'); await stores.limiterStore.set('kill:app-a', 1, 3600);
    try { const r = await me('app-a', a.token); assert.equal(r.status, 403); assert.deepEqual(await r.json(), { error: 'app_disabled' }); }
    finally { await stores.limiterStore.set('kill:app-a', 0, 1); }
    assert.equal((await me('app-off', a.token)).status, 403);
    assert.equal(mails.length, 0);
    assert.equal((await me('app-a', a.token)).status, 200);
});

t('the per-IP limit applies to notify routes', async () => {
    const limited = await startServer(cfg({ PER_IP_PER_MIN: '2' }), { pool: db.pool, listenPort: 0, fetchImpl });
    try {
        const codes = []; for (let i = 0; i < 4; i++) codes.push((await fetch(`${base(limited)}/app-a/notify/me`, { method: 'POST', headers: { 'content-type': 'application/json', 'fly-client-ip': '3.3.3.3' }, body: '{}' })).status);
        assert.deepEqual(codes, [401, 401, 429, 429]);
    } finally { await limited.close(); }
});

t('the platform cap is global across apps', async () => {
    const tiny = await startServer(cfg({ NOTIFY_GLOBAL_PER_DAY: '2', NOTIFY_USER_PER_HOUR: '100', NOTIFY_USER_PER_DAY: '100', NOTIFY_APP_PER_DAY: '100' }), { pool: db.pool, listenPort: 0, fetchImpl });
    try {
        await db.pool.query("delete from platform.limiter_counters where key like 'notify:global:%'");
        const a = await signIn('app-a'); const b = await signIn('app-b');
        assert.equal((await me('app-a', a.token, undefined, { s: tiny })).status, 200); assert.equal((await me('app-b', b.token, undefined, { s: tiny })).status, 200);
        assert.equal((await me('app-a', a.token, undefined, { s: tiny })).status, 429);
        assert.equal(mails.length, 2);
    } finally { await tiny.close(); await db.pool.query("delete from platform.limiter_counters where key like 'notify:global:%'"); }
});

t('a mail provider failure is 502 and the body does not leak the key or the message', async () => {
    const u = await signIn('app-a'); resendStatus = 500;
    const r = await me('app-a', u.token, { subject: 's', text: 'PRIVATEBODY' }); assert.equal(r.status, 502);
    const body = await r.text(); assert.deepEqual(JSON.parse(body), { error: 'send_failed' }); assert.equal(/re_testkey|PRIVATEBODY/.test(body), false);
});

t('without a mail sender configured the notify route answers 503', async () => {
    const r = await me('app-a', 'whatever', undefined, { s: noMail }); assert.equal(r.status, 503); assert.deepEqual(await r.json(), { error: 'notify_unavailable' });
    assert.equal(mails.length, 0);
});

t('bad JSON and an oversized body are refused; only POST is accepted; unknown app is 404', async () => {
    const u = await signIn('app-a');
    assert.equal((await me('app-a', u.token, undefined, { raw: '{nope' })).status, 400);
    assert.equal((await me('app-a', u.token, undefined, { raw: JSON.stringify({ subject: 's', text: 'x'.repeat(20_000) }) })).status, 413);
    assert.equal((await fetch(`${base()}/app-a/notify/me`, { headers: ipHdr() })).status, 405);
    assert.equal((await me('nope', u.token)).status, 404);
    assert.equal(mails.length, 0);
});

t('CORS: the app\'s own origin is allowed on notify.me, other origins are refused, and the preflight allows authorization', async () => {
    const u = await signIn('app-a');
    const ok = await me('app-a', u.token, undefined, { headers: { origin: 'https://app-a.vibebuild.cc' } });
    assert.equal(ok.status, 200); assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app-a.vibebuild.cc');
    const bad = await me('app-a', u.token, undefined, { headers: { origin: 'https://evil.example.com' } }); assert.equal(bad.status, 403); assert.equal(bad.headers.get('access-control-allow-origin'), null);
    const pre = await fetch(`${base()}/app-a/notify/me`, { method: 'OPTIONS', headers: { origin: 'https://app-a.vibebuild.cc', 'access-control-request-method': 'POST', ...ipHdr() } });
    assert.equal(pre.status, 204); assert.match(pre.headers.get('access-control-allow-headers'), /authorization/); assert.equal(pre.headers.get('access-control-allow-methods'), 'POST');
    assert.equal((await fetch(`${base()}/app-a/notify/me`, { method: 'OPTIONS', headers: { origin: 'https://evil.example.com', ...ipHdr() } })).status, 403);
    assert.equal(mails.length, 1);
});

t('the internal sendToUser path enforces the same opt-out and limits, and is not reachable over HTTP', async () => {
    const u = await signIn('app-a');
    assert.deepEqual(await srv.notify.sendToUser({ appId: 'app-a', userId: u.id, subject: 'Daily digest', text: 'x' }), { ok: true });
    assert.deepEqual(mails.at(-1).to, [u.email]);
    const url = unsubPath(mails.at(-1));
    await fetch(`${base()}${url.pathname}${url.search}`, { method: 'POST', headers: ipHdr() });
    assert.deepEqual(await srv.notify.sendToUser({ appId: 'app-a', userId: u.id, subject: 's', text: 'x' }), { ok: false, reason: 'opted_out' });
    for (const p of ['send', 'sendToUser', 'to-user', 'user', 'send-to-user']) assert.equal((await fetch(`${base()}/app-a/notify/${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...ipHdr() }, body: JSON.stringify({ userId: u.id, subject: 's', text: 't' }) })).status, 404, p);
});

t('sign-in mail still works and is unaffected by the notification limits', async () => {
    const u = await signIn('app-a'); assert.ok(u.token);
    for (let i = 0; i < 3; i++) await me('app-a', u.token);
    await fetch(`${base()}/app-a/auth/request`, { method: 'POST', headers: { 'content-type': 'application/json', ...ipHdr() }, body: JSON.stringify({ email: fresh() }) });
    assert.equal(mails.at(-1).subject, 'Your sign-in link');
});
