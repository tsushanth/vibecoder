import '../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cors from 'cors';
import { listen } from '../helpers/http.mjs';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
import { ProxyAdminError } from '../../services/proxyAdmin.js';
const { supabase } = await import('../../config/database.js');
const { createUsageRouter } = await import('../../routes/usage.routes.js');

const PID = '11111111-2222-3333-4444-555555555555';
const NOAPP_PID = 'dddddddd-2222-3333-4444-555555555555';
const EVIL_PID = 'cccccccc-2222-3333-4444-555555555555';
const projects = {
    [PID]: { id: PID, creator_id: 'owner-1', preview_url: 'https://prev-11111111.vibebuild.cc', published_url: 'https://my-app.vibebuild.cc' },
    [NOAPP_PID]: { id: NOAPP_PID, creator_id: 'owner-1', preview_url: null, published_url: null },
    [EVIL_PID]: { id: EVIL_PID, creator_id: 'owner-1', preview_url: 'https://evil.example.com', published_url: 'https://a.b.vibebuild.cc' },
};
let lookups = 0;
stubSupabase(supabase, (q) => {
    if (q.table !== 'projects') return { data: null, error: null };
    lookups++;
    const row = projects[eqOf(q, 'id')];
    return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } };
});
const tokens = { 'tok-owner': 'owner-1', 'tok-other': 'other-2' };
const verifyUser = async (req) => tokens[(req.headers.authorization || '').replace('Bearer ', '')] || null;
const cell = (calls, extra = {}) => ({ calls, errors: 0, bytes: 0, rows: 0, ms: 0, spendMicros: 0, ...extra });
const report = (n, rows) => ({ days: [{ day: '2026-10-06', byKind: { db: cell(n) } }], totals: { db: cell(n) }, limits: { rowCap: 20000 }, usage: { rows } });
const calls = []; let behavior = {};
const proxyAdmin = {
    configured: true,
    async getUsage(app, days) {
        calls.push([app, days]);
        if (behavior.get) return behavior.get(app);
        return report(app === 'my-app' ? 5 : 2, app === 'my-app' ? 50 : 7);
    },
};
const logs = []; let srv;
before(async () => {
    const app = express();
    app.use('/api/projects/:id/usage', cors({ origin: ['https://vibebuild.cc'] }), createUsageRouter({ supabase, verifyUser, proxyAdmin, log: (...a) => logs.push(a.join(' ')), maxPerMinute: 1000 }));
    srv = await listen(app);
});
after(() => srv.close());
const reset = () => { calls.length = 0; behavior = {}; logs.length = 0; lookups = 0; };
const get = (path, { token = 'tok-owner', headers = {} } = {}) => fetch(`${srv.base}/api/projects/${path}`, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });

test('no token and an unknown token are 401 and nothing reaches the proxy', async () => {
    reset();
    assert.equal((await get(`${PID}/usage`, { token: null })).status, 401);
    assert.equal((await get(`${PID}/usage`, { token: 'tok-bogus' })).status, 401);
    assert.equal(calls.length, 0); assert.equal(lookups, 0);
});

test('only the project creator may read usage; a userId in the query is ignored', async () => {
    reset();
    assert.equal((await get(`${PID}/usage?userId=owner-1`, { token: 'tok-other' })).status, 403);
    assert.equal(calls.length, 0);
});

test('unknown and malformed project ids are 404, the latter without a database lookup', async () => {
    reset();
    assert.equal((await get('99999999-2222-3333-4444-555555555555/usage')).status, 404);
    assert.equal((await get('bad_id!/usage')).status, 404);
    assert.equal(lookups, 1);
});

test('the preview and published apps are both read and merged; caps and usage are the published app\'s', async () => {
    reset();
    const r = await get(`${PID}/usage?days=14`);
    assert.equal(r.status, 200);
    assert.deepEqual(calls, [['prev-11111111', 14], ['my-app', 14]]);
    const j = await r.json();
    assert.equal(j.totals.db.calls, 7); assert.equal(j.days[0].byKind.db.calls, 7);
    assert.deepEqual(j.usage, { rows: 50 }); assert.deepEqual(j.limits, { rowCap: 20000 }); assert.equal(j.apps, 2);
    assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('days default to 7 and must be 1..30', async () => {
    reset();
    await get(`${PID}/usage`); assert.equal(calls[0][1], 7);
    for (const bad of ['0', '31', 'x', '1.5', '-2', '007', '1&days=2']) assert.equal((await get(`${PID}/usage?days=${bad}`)).status, 400, bad);
    assert.equal((await get(`${PID}/usage?days=1&days=2`)).status, 400, 'a repeated parameter');
    assert.equal((await get(`${PID}/usage?days[]=3`)).status, 400, 'an array parameter');
    assert.equal((await get(`${PID}/usage?days=30`)).status, 200);
});

test('a project with no app of its own yet gets an empty answer, and a foreign host is never queried', async () => {
    reset();
    const none = await (await get(`${NOAPP_PID}/usage`)).json();
    assert.deepEqual(none, { days: [], totals: {}, limits: {}, usage: {}, apps: 0 });
    await get(`${EVIL_PID}/usage`);
    assert.deepEqual(calls.map((c) => c[0]), []);
});

test('an app the proxy does not know yet is skipped; a proxy failure is 502 with a code-only log', async () => {
    reset();
    behavior = { get: async (app) => { if (app === 'prev-11111111') throw new ProxyAdminError(404, 'unknown_app'); return report(5, 50); } };
    const j = await (await get(`${PID}/usage`)).json(); assert.equal(j.apps, 1); assert.equal(j.totals.db.calls, 5);
    behavior = { get: async () => { throw new ProxyAdminError(0, 'unreachable'); } };
    const r = await get(`${PID}/usage`);
    assert.equal(r.status, 502); assert.deepEqual(await r.json(), { error: 'usage_unavailable' });
    assert.ok(logs.some((l) => l.includes('code=unreachable')) && logs.every((l) => !l.includes('Bearer')));
});

test('anything but numbers the proxy might send is stripped before it reaches the browser', async () => {
    reset();
    behavior = { get: async () => ({ days: [{ day: '2026-10-06', byKind: { db: { ...cell(1), email: 'leak@example.com' } } }], totals: {}, limits: { rowCap: 'x' }, usage: { rows: 'a@b.c', secretToken: 'tok' } }) };
    const text = await (await get(`${PID}/usage`)).text();
    assert.ok(!text.includes('leak@example.com') && !text.includes('a@b.c'));
});

test('503 when the proxy admin is not configured', async () => {
    reset();
    const app = express();
    app.use('/api/projects/:id/usage', createUsageRouter({ supabase, verifyUser, proxyAdmin: { configured: false }, log: () => {} }));
    const s = await listen(app);
    try { assert.equal((await fetch(`${s.base}/api/projects/${PID}/usage`, { headers: { authorization: 'Bearer tok-owner' } })).status, 503); } finally { await s.close(); }
});

test('the route is rate limited per client', async () => {
    const app = express();
    app.use('/api/projects/:id/usage', createUsageRouter({ supabase, verifyUser, proxyAdmin, log: () => {}, maxPerMinute: 3 }));
    const s = await listen(app);
    try {
        const codes = []; for (let i = 0; i < 5; i++) codes.push((await fetch(`${s.base}/api/projects/${PID}/usage`, { headers: { authorization: 'Bearer tok-owner' } })).status);
        assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    } finally { await s.close(); }
});

test('CORS allows the web origin and not others', async () => {
    reset();
    const ok = await get(`${PID}/usage`, { headers: { origin: 'https://vibebuild.cc' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://vibebuild.cc');
    const bad = await get(`${PID}/usage`, { headers: { origin: 'https://evil.example.com' } });
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
});
