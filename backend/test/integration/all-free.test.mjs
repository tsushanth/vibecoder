import '../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
import { _setSink } from '../../lib/failureReporter.js';
const { supabase } = await import('../../config/database.js');

// VIBEBUILD_ALL_FREE is deliberately NOT set here: the default (unset) must be "everything free".
delete process.env.VIBEBUILD_ALL_FREE; delete process.env.VIBEBUILD_FAIR_USE_DAILY_GENERATIONS; delete process.env.VIBEBUILD_FAIR_USE_TWEAKS_PER_PROJECT;

const OWNER = 'never-subscribed-user';
const PID = 'fedcba98-7654-3210-fedc-ba9876543210';
let generationRows = 0, tweakRows = 0, usageError = null, subRow = null; const writes = [];
stubSupabase(supabase, (q) => {
    if (q.op === 'insert' || q.op === 'update' || q.op === 'upsert') writes.push({ table: q.table, op: q.op, payload: q.payload });
    if (q.table === 'user_subscriptions') return subRow ? { data: subRow, error: null } : { data: null, error: { code: 'PGRST116' } };
    if (q.table === 'subscription_usage' && q.op === 'select') {
        if (usageError) return { data: null, error: usageError };
        const n = eqOf(q, 'action_type') === 'tweak' ? tweakRows : generationRows;
        return { data: Array.from({ length: n }, () => ({ id: 'r' })), error: null, count: n };
    }
    if (q.table === 'projects' && q.op === 'insert') return { data: { id: q.payload?.id }, error: null };
    if (q.table === 'projects' && q.single && q.op === 'select') return { data: { id: PID, title: 'T', creator_id: OWNER, bundle: 'QUJD', github_repo: 'app-1', free_tweaks_remaining: 3 }, error: null };
    if (q.single) return { data: null, error: { code: 'PGRST116' } };
    return { data: [], error: null };
});
const { default: projects } = await import('../../routes/projects.routes.js');
const { default: subscriptions } = await import('../../routes/subscriptions.routes.js');
const { default: domains } = await import('../../routes/domains.routes.js');
supabase.auth.getUser = async (t) => (String(t).startsWith('tok-') ? { data: { user: { id: String(t).slice(4) } }, error: null } : { data: { user: null }, error: { message: 'bad token' } });

const realFetch = globalThis.fetch; let workerGenerateCalls = 0, srv;
before(async () => {
    globalThis.fetch = (url, o = {}) => {
        const u = new URL(String(url));
        if (u.hostname === '127.0.0.1') return realFetch(url, o);
        if (u.pathname === '/generate') workerGenerateCalls++;
        return Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
    };
    const app = express(); app.set('trust proxy', true); app.use(express.json());
    app.use('/api/projects', projects); app.use('/api/subscriptions', subscriptions); app.use('/api/domains', domains);
    srv = await listen(app);
    await new Promise((r) => setTimeout(r, 100));
});
after(async () => { globalThis.fetch = realFetch; await srv.close(); });
const quiet = async (fn) => { const o = [console.log, console.warn, console.error]; console.log = console.warn = console.error = () => {}; try { return await fn(); } finally { [console.log, console.warn, console.error] = o; } };
const call = (method, path, body, user) => quiet(() => realFetch(`${srv.base}${path}`, { method, headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer tok-${user}` } : {}) }, body: body && JSON.stringify(body) }));
const reset = () => { generationRows = 0; tweakRows = 0; usageError = null; subRow = null; writes.length = 0; workerGenerateCalls = 0; _setSink(null); delete process.env.VIBEBUILD_ALL_FREE; };

test('status: a never-subscribed user gets tier pro, allFree, the stored tier as data and the real fair-use numbers', async () => {
    reset(); generationRows = 4;
    const r = await call('GET', `/api/subscriptions/status?userId=${OWNER}`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.success, true); assert.equal(j.tier, 'pro'); assert.equal(j.allFree, true); assert.equal(j.storedTier, 'free'); assert.equal(j.status, 'active');
    assert.equal(j.limits.canCreatePrivateProjects, true);
    assert.deepEqual([j.fairUse.dailyGenerations.used, j.fairUse.dailyGenerations.limit, j.fairUse.dailyGenerations.remaining], [4, 30, 26]);
    assert.match(j.fairUse.dailyGenerations.resetsAt, /T00:00:00\.000Z$/);
    assert.equal(j.fairUse.tweaksPerProject.limit, 50);
});

test('status with the switch off: the old body (free, 10/day, allFree false) and no fair-use block', async () => {
    reset(); process.env.VIBEBUILD_ALL_FREE = '0';
    const j = await (await call('GET', `/api/subscriptions/status?userId=${OWNER}`)).json();
    assert.equal(j.tier, 'free'); assert.equal(j.allFree, false); assert.equal(j.limits.dailyGenerations, 10); assert.equal(j.fairUse, undefined);
});

test('plans: one $0 plan while free; the three paid-tier plans again when off. create-checkout is dormant (409) while free', async () => {
    reset();
    const p = await (await call('GET', '/api/subscriptions/plans')).json();
    assert.equal(p.allFree, true); assert.equal(p.plans.length, 1); assert.equal(p.plans[0].price, '$0');
    const c = await call('POST', '/api/subscriptions/create-checkout', { userId: OWNER, tier: 'pro' });
    assert.equal(c.status, 409); assert.equal((await c.json()).allFree, true);
    process.env.VIBEBUILD_ALL_FREE = '0';
    const off = await (await call('GET', '/api/subscriptions/plans')).json();
    assert.deepEqual(off.plans.map((x) => x.tier), ['free', 'pro', 'team']);
    assert.notEqual((await call('POST', '/api/subscriptions/create-checkout', { userId: OWNER, tier: 'pro' })).status, 409);
});

test('private project: a never-subscribed user saves it (was 403 requiring Pro); with the switch off it is 403 again', async () => {
    reset();
    const body = { title: 'Mine', bundle: 'QUJD', creatorId: OWNER, isPublic: false };
    const ok = await call('POST', '/api/projects/save', body, OWNER);
    assert.notEqual(ok.status, 403);
    assert.equal(writes.find((w) => w.table === 'projects' && w.op === 'insert')?.payload.is_public, false);
    reset(); process.env.VIBEBUILD_ALL_FREE = '0';
    const no = await call('POST', '/api/projects/save', body, OWNER);
    assert.equal(no.status, 403); assert.equal((await no.json()).requiresTier, 'pro');
});

test('custom domains: the Pro gate is gone for a never-subscribed user (a bad domain now gets the format 400, not the plan 403); off restores the 403', async () => {
    reset();
    const a = await call('POST', '/api/domains/dep-1/add', { userId: OWNER, domain: 'not a domain' });
    assert.equal(a.status, 400);
    reset(); process.env.VIBEBUILD_ALL_FREE = '0';
    const b = await call('POST', '/api/domains/dep-1/add', { userId: OWNER, domain: 'not a domain' });
    assert.equal(b.status, 403); assert.equal((await b.json()).upgrade, true);
});

test('tweak: 49 earlier tweaks pass the gate; the 51st is HTTP 429 with the fair-use body, never 402 or 403', async () => {
    reset(); tweakRows = 50;
    const r = await call('POST', `/api/projects/${PID}/tweak`, { userId: OWNER, tweakDescription: 'make it blue' }, OWNER);
    assert.equal(r.status, 429);
    const j = await r.json();
    assert.deepEqual([j.code, j.fairUse, j.scope, j.used, j.limit, j.remaining], ['fair_use_limit', true, 'tweaks_per_project', 50, 50, 0]);
    assert.match(j.error, /fair-use limit/i); assert.equal(j.requiresTier, undefined); assert.equal(j.currentTier, undefined);
    reset(); tweakRows = 49;
    const ok = await call('POST', `/api/projects/${PID}/tweak`, { userId: OWNER, tweakDescription: 'make it blue' }, OWNER);
    assert.notEqual(ok.status, 429); assert.notEqual(ok.status, 403); assert.notEqual(ok.status, 402);
});

test('tweak with the switch off: the old 3-per-project cap is a 403 with requiresTier pro', async () => {
    reset(); process.env.VIBEBUILD_ALL_FREE = '0'; tweakRows = 3;
    const r = await call('POST', `/api/projects/${PID}/tweak`, { userId: OWNER, tweakDescription: 'make it blue' }, OWNER);
    assert.equal(r.status, 403); assert.equal((await r.json()).requiresTier, 'pro');
});

test('generate: the 31st build of the UTC day is HTTP 429 with the friendly fair-use body and the worker is never called', async () => {
    reset(); generationRows = 30;
    const r = await call('POST', '/api/projects/generate', { prompt: 'a habit tracker with streaks', userId: OWNER }, OWNER);
    assert.equal(r.status, 429);
    const j = await r.json();
    assert.equal(j.error, "You have reached today's fair-use limit, try again tomorrow.");
    assert.deepEqual([j.code, j.fairUse, j.scope, j.used, j.limit, j.remaining], ['fair_use_limit', true, 'daily_generations', 30, 30, 0]);
    assert.match(j.resetsAt, /T00:00:00\.000Z$/); assert.equal(j.requiresTier, undefined);
    assert.equal(workerGenerateCalls, 0);
    assert.equal(writes.some((w) => w.table === 'projects'), false, 'no placeholder project is created for a refused build');
});

test('generate: under the cap it builds (29 used), and a usage-lookup failure FAILS OPEN (build starts, failure reported)', async () => {
    reset(); generationRows = 29;
    const r1 = await call('POST', '/api/projects/generate', { prompt: 'a habit tracker with streaks', userId: OWNER }, OWNER);
    assert.equal(r1.status, 200); assert.equal(workerGenerateCalls, 1);
    reset(); usageError = { code: 'XX', message: 'db down' };
    const reports = []; _setSink((x) => reports.push(x));
    const r2 = await call('POST', '/api/projects/generate', { prompt: 'a habit tracker with streaks', userId: OWNER }, OWNER);
    assert.equal(r2.status, 200); assert.equal(workerGenerateCalls, 1);
    assert.ok(reports.some((x) => x.message === 'Fair-use usage lookup failed; request allowed'));
});

test('generate with the switch off keeps the old behaviour: no fair-use gate at all', async () => {
    reset(); process.env.VIBEBUILD_ALL_FREE = '0'; generationRows = 500;
    const r = await call('POST', '/api/projects/generate', { prompt: 'a habit tracker with streaks', userId: OWNER }, OWNER);
    assert.equal(r.status, 200); assert.equal(workerGenerateCalls, 1);
});

test('usage route: a fair-use refusal is 429 (not the old 403)', async () => {
    reset(); generationRows = 30;
    const r = await call('POST', '/api/subscriptions/usage', { userId: OWNER, actionType: 'generation' });
    assert.equal(r.status, 429); assert.equal((await r.json()).fairUse, true);
});
