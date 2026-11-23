import '../helpers/env.mjs';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');

stubSupabase(supabase, (q) => {
    if (q.table === 'projects' && q.op === 'insert') return { data: { id: q.payload?.id }, error: null };
    if (q.single) return { data: null, error: { code: 'PGRST116' } };
    return { data: [], error: null };
});
supabase.auth.getUser = async (t) => (String(t).startsWith('tok-') ? { data: { user: { id: String(t).slice(4) } }, error: null } : { data: { user: null }, error: { message: 'bad token' } });
const { default: projects } = await import('../../routes/projects.routes.js');
const { createGenerateAuthRouter } = await import('../../routes/generateAuth.routes.js');
const { generateAuthStats } = await import('../../lib/generateAuth.js');
const { signInternalAuth } = await import('../../lib/internalAuth.js');
const { createLoopbackBuilds } = await import('../../lib/telegram/pipeline.js');

const realFetch = globalThis.fetch; let workerCalls = 0, srv;
before(async () => {
    globalThis.fetch = (url, o = {}) => {
        const u = new URL(String(url));
        if (u.hostname === '127.0.0.1') return realFetch(url, o);
        if (u.pathname === '/generate') workerCalls++;
        return Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
    };
    const app = express(); app.set('trust proxy', true); app.use(express.json());
    app.use('/api/generate-auth', createGenerateAuthRouter({ workerSecret: process.env.WORKER_SECRET }));
    app.use('/api/projects', projects);
    srv = await listen(app);
    await new Promise((r) => setTimeout(r, 100));
});
after(async () => { globalThis.fetch = realFetch; await srv.close(); });
beforeEach(() => { delete process.env.GENERATE_AUTH_MODE; workerCalls = 0; generateAuthStats.reset(); });

const quiet = async (fn) => { const o = [console.log, console.warn, console.error]; console.log = console.warn = console.error = () => {}; try { return await fn(); } finally { [console.log, console.warn, console.error] = o; } };
let n = 0; const uid = (p = 'ga-user') => `${p}-${++n}`; // distinct ids so the hourly cap never interferes
const gen = (userId, headers = {}, extra = {}) => quiet(async () => {
    const r = await realFetch(`${srv.base}/api/projects/generate`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ prompt: 'a habit tracker with streaks', userId, stream: false, ...extra }) });
    await r.text(); return r;
});
const bearer = (u) => ({ authorization: `Bearer tok-${u}` });
const settle = async (total) => { for (let i = 0; i < 50 && generateAuthStats.snapshot().total < total; i++) await new Promise((r) => setTimeout(r, 10)); return generateAuthStats.snapshot(); };
const SECRET = process.env.WORKER_SECRET;

test('default (flag unset) is report: nothing is refused, the request is counted by class', async () => {
    const a = uid(), b = uid(), c = uid(), d = uid();
    assert.equal((await gen(a)).status, 200);                                   // no token
    assert.equal((await gen(b, bearer(b))).status, 200);                         // matching token
    assert.equal((await gen(c, bearer(uid('someone-else')))).status, 200);       // token for a different user
    assert.equal((await gen(d, { authorization: 'Bearer garbage' })).status, 200); // invalid token
    const s = await settle(4);
    assert.deepEqual(s.totals, { no_token: 1, token_match: 1, token_mismatch: 1, token_invalid: 1 });
    assert.equal(s.wouldBlock, 3);
    assert.equal(workerCalls, 4);
});

test('report mode classifies platform and app version, and the stats never hold ids or tokens', async () => {
    const u = uid('pii-user');
    await gen(u, { ...bearer(u), 'x-platform': 'android', 'x-app-version': '2.7.3' });
    await gen(uid('pii-user'), { 'x-platform': 'android' });
    const s = await settle(2);
    assert.equal(s.byPlatform.android.token_match, 1); assert.equal(s.byVersion['2.7.3'].token_match, 1); assert.equal(s.byVersion.none.no_token, 1);
    assert.doesNotMatch(JSON.stringify(s), /pii-user|tok-/);
});

test('off: behaves as before and counts nothing', async () => {
    process.env.GENERATE_AUTH_MODE = 'off';
    assert.equal((await gen(uid())).status, 200);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(generateAuthStats.snapshot().total, 0);
});

test('enforce: no token, invalid token and a token for another user are 401 and never reach the worker', async () => {
    process.env.GENERATE_AUTH_MODE = 'enforce';
    const a = uid();
    for (const headers of [{}, { authorization: 'Bearer garbage' }, bearer(uid('other'))]) {
        const r = await gen(a, headers);
        assert.equal(r.status, 401);
    }
    assert.equal(workerCalls, 0);
    const s = generateAuthStats.snapshot();
    assert.deepEqual(s.totals, { no_token: 1, token_invalid: 1, token_mismatch: 1 });
});

test('enforce: a missing userId with a valid token is refused too', async () => {
    process.env.GENERATE_AUTH_MODE = 'enforce';
    const t = uid();
    const r = await quiet(() => realFetch(`${srv.base}/api/projects/generate`, { method: 'POST', headers: { 'content-type': 'application/json', ...bearer(t) }, body: JSON.stringify({ prompt: 'a habit tracker with streaks' }) }));
    assert.equal(r.status, 401); await r.text();
});

test('enforce: the owner with their own token builds', async () => {
    process.env.GENERATE_AUTH_MODE = 'enforce';
    const u = uid();
    assert.equal((await gen(u, bearer(u))).status, 200);
    assert.equal(workerCalls, 1);
});

test('enforce: the Telegram bot path (loopback builder, bot-owned id, no token) is let through; the same call without the header is not', async () => {
    process.env.GENERATE_AUTH_MODE = 'enforce';
    const bot = createLoopbackBuilds({ baseUrl: srv.base, fetchImpl: (...a) => realFetch(...a), secret: () => SECRET });
    const r = await quiet(() => bot.start({ prompt: 'a habit tracker with streaks', userId: uid('tg_'), userName: 'Sam' }));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(generateAuthStats.snapshot().totals.internal_ok, 1);
    const noSecret = createLoopbackBuilds({ baseUrl: srv.base, fetchImpl: (...a) => realFetch(...a), secret: () => undefined });
    const r2 = await quiet(() => noSecret.start({ prompt: 'a habit tracker with streaks', userId: uid('tg_'), userName: 'Sam' }));
    assert.equal(r2.ok, false); assert.equal(r2.status, 401);
});

test('enforce: forged internal headers are refused (wrong secret, another user, expired, malformed, raw secret, spoofed loopback address)', async () => {
    process.env.GENERATE_AUTH_MODE = 'enforce';
    const victim = uid('victim');
    const forged = [
        signInternalAuth('attacker-guess-0123456789', victim),
        signInternalAuth(SECRET, uid('other-user')),
        signInternalAuth(SECRET, victim, Date.now() - 10 * 60_000),
        'v1.123.' + 'a'.repeat(64),
        'garbage',
        SECRET,
    ];
    for (const h of forged) assert.equal((await gen(victim, { 'x-internal-auth': h })).status, 401, String(h).slice(0, 12));
    assert.equal((await gen(victim, { 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1', 'x-internal': 'true' })).status, 401);
    assert.equal(workerCalls, 0);
    assert.equal(generateAuthStats.snapshot().forgedInternalHeader, forged.length);
});

test('enforce: a forged internal header does not block a request that also carries a valid token', async () => {
    process.env.GENERATE_AUTH_MODE = 'enforce';
    const u = uid();
    assert.equal((await gen(u, { ...bearer(u), 'x-internal-auth': 'garbage' })).status, 200);
});

test('report mode: a forged internal header is counted but not refused', async () => {
    const u = uid();
    assert.equal((await gen(u, { 'x-internal-auth': 'garbage' })).status, 200);
    const s = await settle(1);
    assert.equal(s.forgedInternalHeader, 1); assert.equal(s.totals.no_token, 1);
});

test('stats endpoint: worker secret required; returns mode and counters', async () => {
    await gen(uid()); await settle(1);
    const no = await realFetch(`${srv.base}/api/generate-auth/stats`);
    assert.equal(no.status, 401);
    const bad = await realFetch(`${srv.base}/api/generate-auth/stats`, { headers: { 'x-worker-secret': 'nope' } });
    assert.equal(bad.status, 401);
    const ok = await realFetch(`${srv.base}/api/generate-auth/stats`, { headers: { 'x-worker-secret': SECRET } });
    assert.equal(ok.status, 200);
    const j = await ok.json();
    assert.equal(j.success, true); assert.equal(j.mode, 'report'); assert.equal(j.totals.no_token, 1);
});
