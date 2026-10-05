import '../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');
const { createTelegramRouter } = await import('../../routes/telegram.routes.js');

const SECRET = 'test-worker-secret';
const users = { u1: { user_id: 'u1', display_name: 'Ann', email: 'a@x.test', subscription_tier: 'free', total_projects: 2, telegram_id: '111' } };
const writes = [];
stubSupabase(supabase, (q) => {
    if (q.table === 'users') {
        if (q.op === 'update') { writes.push(q.payload); return { data: null, error: null }; }
        const tg = q.filters.find((f) => f[0] === 'eq' && f[1] === 'telegram_id')?.[2];
        const row = tg ? Object.values(users).find((u) => u.telegram_id === tg) : users[eqOf(q, 'user_id')];
        return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } };
    }
    return { data: [], error: null };
});

let t = 1_000_000;
const clock = { now: () => t, advance: (ms) => { t += ms; } };
const servers = [];
async function mount(limits = {}) {
    const app = express(); app.set('trust proxy', true); app.use(express.json());
    app.use('/api/telegram', createTelegramRouter({ supabase, workerSecret: SECRET, now: clock.now, limits }));
    const s = await listen(app); servers.push(s); return s;
}
after(async () => { for (const s of servers) await s.close(); });
const req = (s, method, path, { body, ip = '1.1.1.1', headers = {} } = {}) => fetch(`${s.base}/api/telegram${path}`, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const mint = async (s, userId = 'u1', ip = '1.1.1.1') => (await (await req(s, 'POST', '/link', { body: { userId }, ip })).json()).code;

test('the link and verify flow is unchanged: 6-char code, bot url, single use, user row updated', async () => {
    const s = await mount();
    const r = await req(s, 'POST', '/link', { body: { userId: 'u1' } }); const j = await r.json();
    assert.equal(r.status, 200); assert.match(j.code, /^[0-9A-F]{6}$/); assert.equal(j.expiresIn, 600); assert.ok(j.botUrl.includes(`link_${j.code}`));
    const v = await req(s, 'POST', '/verify', { body: { code: j.code.toLowerCase(), telegramId: 555, telegramUsername: 'ann' } });
    assert.equal(v.status, 200); assert.deepEqual(await v.json(), { success: true, userId: 'u1', displayName: 'Ann', subscriptionTier: 'free' });
    assert.equal(writes.at(-1).telegram_id, '555');
    assert.equal((await req(s, 'POST', '/verify', { body: { code: j.code, telegramId: 555 }, ip: '2.2.2.2' })).status, 404);
});

test('GET /connect keeps its shape; missing parameters are still 400', async () => {
    const s = await mount();
    const r = await req(s, 'GET', '/connect?tg_id=9&user_id=u1'); const j = await r.json();
    assert.equal(r.status, 200); assert.match(j.code, /^[0-9A-F]{6}$/); assert.equal(j.expiresIn, 600);
    assert.equal((await req(s, 'GET', '/connect?tg_id=9')).status, 400);
});

test('an expired code is 410 and then gone', async () => {
    const s = await mount(); const code = await mint(s);
    clock.advance(10 * 60 * 1000 + 1);
    assert.equal((await req(s, 'POST', '/verify', { body: { code, telegramId: 1 } })).status, 410);
    assert.equal((await req(s, 'POST', '/verify', { body: { code, telegramId: 1 }, ip: '3.3.3.3' })).status, 404);
});

test('verify: ten wrong codes from one address are allowed, the eleventh is 429 with Retry-After', async () => {
    const s = await mount();
    const codes = []; for (let i = 0; i < 11; i++) codes.push((await req(s, 'POST', '/verify', { body: { code: 'ZZZZZ' + i, telegramId: 1 }, ip: '4.4.4.4' })).status);
    assert.deepEqual(codes.slice(0, 10), Array(10).fill(404)); assert.equal(codes[10], 429);
    const locked = await req(s, 'POST', '/verify', { body: { code: await mint(s, 'u1', '5.5.5.5'), telegramId: 1 }, ip: '4.4.4.4' });
    assert.equal(locked.status, 429, 'a locked address cannot verify even a real code'); assert.ok(Number(locked.headers.get('retry-after')) > 0);
});

test('verify: other addresses are unaffected, and a locked address does not consume the real code', async () => {
    const s = await mount(); const code = await mint(s, 'u1', '6.6.6.6');
    for (let i = 0; i < 11; i++) await req(s, 'POST', '/verify', { body: { code: 'WRONG' + i, telegramId: 1 }, ip: '7.7.7.7' });
    assert.equal((await req(s, 'POST', '/verify', { body: { code, telegramId: 1 }, ip: '7.7.7.7' })).status, 429);
    assert.equal((await req(s, 'POST', '/verify', { body: { code, telegramId: 1 }, ip: '8.8.8.8' })).status, 200);
});

test('verify: only failures count, so a success does not use up attempts', async () => {
    const s = await mount();
    for (let i = 0; i < 9; i++) await req(s, 'POST', '/verify', { body: { code: 'NOPE0' + i, telegramId: 1 }, ip: '9.9.9.9' });
    assert.equal((await req(s, 'POST', '/verify', { body: { code: await mint(s, 'u1', '10.0.0.1'), telegramId: 1 }, ip: '9.9.9.9' })).status, 200);
    assert.equal((await req(s, 'POST', '/verify', { body: { code: 'NOPE10', telegramId: 1 }, ip: '9.9.9.9' })).status, 404);
    assert.equal((await req(s, 'POST', '/verify', { body: { code: 'NOPE11', telegramId: 1 }, ip: '9.9.9.9' })).status, 429);
});

test('verify: malformed requests are 400 and do not count as failures', async () => {
    const s = await mount();
    for (let i = 0; i < 15; i++) assert.equal((await req(s, 'POST', '/verify', { body: { telegramId: 1 }, ip: '11.0.0.1' })).status, 400);
    assert.equal((await req(s, 'POST', '/verify', { body: { code: 'NOPE00', telegramId: 1 }, ip: '11.0.0.1' })).status, 404);
});

test('verify: a global failure cap protects against many addresses, and lifts after the window', async () => {
    const s = await mount({ verifyFailGlobal: 3 });
    for (let i = 0; i < 3; i++) assert.equal((await req(s, 'POST', '/verify', { body: { code: 'ABCDE' + i, telegramId: 1 }, ip: `12.0.0.${i}` })).status, 404);
    assert.equal((await req(s, 'POST', '/verify', { body: { code: 'ABCDE9', telegramId: 1 }, ip: '12.0.0.99' })).status, 429);
    clock.advance(10 * 60 * 1000 + 1);
    assert.equal((await req(s, 'POST', '/verify', { body: { code: 'ABCDE9', telegramId: 1 }, ip: '12.0.0.99' })).status, 404);
});

test('minting codes: at most 5 per user per 10 minutes, other users unaffected', async () => {
    const s = await mount();
    const codes = []; for (let i = 0; i < 6; i++) codes.push((await req(s, 'POST', '/link', { body: { userId: 'victim' }, ip: `13.0.0.${i}` })).status);
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
    assert.equal((await req(s, 'POST', '/link', { body: { userId: 'someone-else' }, ip: '13.0.1.1' })).status, 200);
    assert.equal((await req(s, 'GET', '/connect?tg_id=1&user_id=victim', { ip: '13.0.2.2' })).status, 429, 'connect shares the per-user budget');
});

test('minting codes: at most 20 per address per 10 minutes', async () => {
    const s = await mount({ mintPerIp: 3 });
    const codes = []; for (let i = 0; i < 4; i++) codes.push((await req(s, 'POST', '/link', { body: { userId: `user-${i}` }, ip: '14.0.0.1' })).status);
    assert.deepEqual(codes, [200, 200, 200, 429]);
});

test('the number of outstanding codes is capped, and capacity returns when codes expire', async () => {
    const s = await mount({ maxOutstandingCodes: 2, mintPerIp: 100, mintPerUser: 100 });
    assert.equal((await req(s, 'POST', '/link', { body: { userId: 'a1' }, ip: '15.0.0.1' })).status, 200);
    assert.equal((await req(s, 'POST', '/link', { body: { userId: 'a2' }, ip: '15.0.0.2' })).status, 200);
    const busy = await req(s, 'POST', '/link', { body: { userId: 'a3' }, ip: '15.0.0.3' });
    assert.equal(busy.status, 503); assert.deepEqual(await busy.json(), { error: 'busy' });
    clock.advance(10 * 60 * 1000 + 1);
    assert.equal((await req(s, 'POST', '/link', { body: { userId: 'a3' }, ip: '15.0.0.3' })).status, 200);
});

test('lookup by telegram id: shape unchanged, rate limited per address', async () => {
    const s = await mount({ lookupPerMin: 3 });
    const r = await req(s, 'GET', '/user/111', { ip: '16.0.0.1' }); const j = await r.json();
    assert.equal(j.linked, true); assert.equal(j.userId, 'u1'); assert.equal(j.displayName, 'Ann');
    assert.deepEqual(await (await req(s, 'GET', '/user/999', { ip: '16.0.0.1' })).json(), { linked: false });
    await req(s, 'GET', '/user/111', { ip: '16.0.0.1' });
    assert.equal((await req(s, 'GET', '/user/111', { ip: '16.0.0.1' })).status, 429);
    assert.equal((await req(s, 'GET', '/user/111', { ip: '16.0.0.2' })).status, 200);
});

test('notify requires the internal worker secret', async () => {
    const s = await mount();
    const body = { userId: 'u1', message: 'hi' };
    assert.equal((await req(s, 'POST', '/notify', { body })).status, 401);
    assert.equal((await req(s, 'POST', '/notify', { body, headers: { 'x-worker-secret': 'wrong' } })).status, 401);
    assert.equal((await req(s, 'POST', '/notify', { body, headers: { 'x-worker-secret': SECRET + 'x' } })).status, 401);
    const ok = await req(s, 'POST', '/notify', { body, headers: { 'x-worker-secret': SECRET } });
    assert.equal(ok.status, 503, 'with the secret it reaches the existing handler (no bot token configured here)');
});

test('a router built without a worker secret refuses every notify request', async () => {
    const app = express(); app.use(express.json());
    app.use('/api/telegram', createTelegramRouter({ supabase, workerSecret: '', now: clock.now }));
    const s = await listen(app); servers.push(s);
    assert.equal((await req(s, 'POST', '/notify', { body: { userId: 'u1' }, headers: { 'x-worker-secret': '' } })).status, 401);
});

test('verify: expired-code attempts count toward the lockout like wrong codes do', async () => {
    const s = await mount({ verifyFailPerIp: 3, mintPerIp: 100, mintPerUser: 100 });
    const codes = []; for (let i = 0; i < 3; i++) codes.push(await mint(s, `exp-user-${i}`, '17.0.0.1'));
    clock.advance(10 * 60 * 1000 + 1);
    for (const code of codes) assert.equal((await req(s, 'POST', '/verify', { body: { code, telegramId: 1 }, ip: '17.0.0.2' })).status, 410);
    assert.equal((await req(s, 'POST', '/verify', { body: { code: 'WRONG1', telegramId: 1 }, ip: '17.0.0.2' })).status, 429);
});

// ---- routes are disabled unless explicitly switched on
const { selectTelegramRouter } = await import('../../routes/telegram.routes.js');
async function mountSelected(env) {
    const queries = [];
    stubSupabase(supabase, (q) => { queries.push(q.table); return { data: null, error: { code: 'PGRST116' } }; });
    const app = express(); app.set('trust proxy', true); app.use(express.json());
    app.use('/api/telegram', selectTelegramRouter(env, { supabase, workerSecret: SECRET, now: clock.now }));
    const s = await listen(app); servers.push(s);
    return { s, queries };
}
const ALL = [['GET', '/connect?tg_id=1&user_id=u1'], ['POST', '/link', { userId: 'u1' }], ['POST', '/verify', { code: 'ABCDEF', telegramId: 1 }], ['GET', '/user/111'], ['POST', '/notify', { userId: 'u1', message: 'x' }]];

test('by default every Telegram route answers 503 disabled and never touches the database', async () => {
    for (const env of [{}, { TELEGRAM_ROUTES_ENABLED: 'false' }, { TELEGRAM_ROUTES_ENABLED: '1' }, { TELEGRAM_ROUTES_ENABLED: 'TRUE ' }, { TELEGRAM_ROUTES_ENABLED: '' }]) {
        const { s, queries } = await mountSelected(env);
        for (const [m, p, body] of ALL) {
            const r = await req(s, m, p, { body, headers: { 'x-worker-secret': SECRET } });
            assert.equal(r.status, 503, `${JSON.stringify(env)} ${m} ${p}`);
            assert.deepEqual(await r.json(), { error: 'disabled' });
        }
        assert.deepEqual(queries, [], 'a disabled router must not query the database');
    }
});

test('with TELEGRAM_ROUTES_ENABLED exactly "true" the real routes are served', async () => {
    const { s } = await mountSelected({ TELEGRAM_ROUTES_ENABLED: 'true' });
    const r = await req(s, 'POST', '/link', { body: { userId: 'u1' } });
    assert.equal(r.status, 200); assert.match((await r.json()).code, /^[0-9A-F]{6}$/);
});

test('the module default export is the disabled router when the flag is unset', async () => {
    const { default: def } = await import('../../routes/telegram.routes.js');
    const app = express(); app.use(express.json()); app.use('/api/telegram', def);
    const s = await listen(app); servers.push(s);
    const r = await req(s, 'POST', '/link', { body: { userId: 'u1' } });
    assert.equal(r.status, process.env.TELEGRAM_ROUTES_ENABLED === 'true' ? 200 : 503);
});
