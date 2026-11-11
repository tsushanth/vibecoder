import '../helpers/env.mjs';
process.env.APP_EVENTS_TEST = '1'; // the recorder is off under NODE_ENV=test unless a test opts in
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');

// End to end through the real routes: every usage event that reaches the app_events table, with hostile content in every
// request field, must hold only ids and allow-listed codes. Nothing of the prompt, tweak text, email or worker message.
const SECRET = 'Build a diary app for secretuser@example.com codeword zanzibar';
const USER = '11111111-2222-3333-4444-555555555555';
const PID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
let events = [], tableMissing = false, surveyRows = 0, otherReady = false, projectOwner = USER, usersRow = null;
stubSupabase(supabase, (q) => {
    if (q.table === 'app_events') {
        if (tableMissing) return { data: null, error: { code: '42P01', message: 'relation "app_events" does not exist' } };
        if (q.op === 'insert') {
            if (q.payload.event === 'first_build_survey') { if (surveyRows > 0) return { data: null, error: { code: '23505' } }; surveyRows++; }
            events.push(q.payload); return { data: null, error: null };
        }
        if (q.op === 'delete') { events.push({ deleted_for: eqOf(q, 'user_id') }); return { data: null, error: null }; }
        if (q.op === 'select') return { data: null, error: null, count: surveyRows };
    }
    if (q.table === 'users' && q.op === 'select') return { data: usersRow, error: null };
    if (q.table === 'users' && q.op === 'upsert') return { data: { user_id: q.payload.user_id }, error: null };
    if (q.table === 'projects' && q.op === 'insert') return { data: { id: q.payload.id }, error: null };
    if (q.table === 'projects' && q.op === 'select' && q.single) {
        const id = eqOf(q, 'id');
        if (q.maybe) return id === PID && eqOf(q, 'creator_id') === projectOwner ? { data: { id: PID }, error: null } : { data: null, error: null };
        return { data: { id: PID, creator_id: projectOwner, bundle: 'QUJD', github_repo: 'repo-1', preview_url: null, initial_prompt: SECRET, status: 'failed' }, error: null };
    }
    if (q.table === 'projects' && q.op === 'select') return { data: otherReady ? [{ id: 'other' }] : (q.filters.some((f) => f[0] === 'in') ? [{ id: PID, creator_id: USER, created_at: new Date(Date.now() - 30 * 60_000).toISOString() }] : []), error: null };
    if (q.single) return { data: null, error: { code: 'PGRST116' } };
    return { data: [], error: null };
});
const { default: projects } = await import('../../routes/projects.routes.js');
const { appEvents } = await import('../../lib/appEventsInstance.js');
const { createAuthRouter } = await import('../../routes/auth.routes.js');
const { createEventsRouter } = await import('../../routes/events.routes.js');
const { default: deploy } = await import('../../routes/deploy.routes.js');
let verified = USER;
const verifyUser = async () => verified;

const realFetch = globalThis.fetch; let worker, srv;
const sse = (...evts) => new Response(evts.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
before(async () => {
    globalThis.fetch = (url, o = {}) => { const u = new URL(String(url)); if (u.hostname === '127.0.0.1') return realFetch(url, o); if (u.hostname === 'worker.test') return Promise.resolve().then(() => worker(u, o)); return Promise.resolve(new Response('{}', { status: 200 })); };
    const app = express(); app.set('trust proxy', true); app.use(express.json());
    app.use('/api/projects', projects); app.use('/api/auth', createAuthRouter({ verifyUser, externalCleanup: async () => ({ failed: [] }) })); app.use('/api/events', createEventsRouter({ verifyUser })); app.use('/api/deploy', deploy);
    app.locals.verifyUser = verifyUser;
    srv = await listen(app);
    await new Promise((r) => setTimeout(r, 100));
});
after(async () => { globalThis.fetch = realFetch; await srv.close(); });
beforeEach(() => { appEvents._resetForTests(); events = []; tableMissing = false; surveyRows = 0; otherReady = false; projectOwner = USER; usersRow = null; verified = USER; worker = () => new Response('{}', { status: 200 }); });
const quiet = async (fn) => { const e = console.error, l = console.log, w = console.warn; console.error = console.log = console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.log = l; console.warn = w; } };
const call = (m, p, body, headers = {}) => quiet(() => realFetch(`${srv.base}${p}`, { method: m, headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 test', ...headers }, body: body && JSON.stringify(body) }));
const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); await new Promise((r) => setTimeout(r, 30)); };
const names = () => events.filter((e) => e.event).map((e) => e.event);
const of = (name) => events.filter((e) => e.event === name);
const nothingPrivate = () => { const all = JSON.stringify(events); for (const bad of ['secretuser', 'zanzibar', 'diary', 'example.com', 'Build a']) assert.equal(all.includes(bad), false, `an event leaked ${bad}`); for (const e of events.filter((x) => x.event)) { assert.deepEqual(Object.keys(e).sort(), ['anon_id', 'event', 'props', 'user_id']); } };

test('generate (web stream) -> build_started then build_ready with a duration; no prompt text anywhere', async () => {
    worker = () => sse({ type: 'result', bundle: 'QUJD', bundleSize: 3, files: [], generationTime: 5 });
    const r = await call('POST', '/api/projects/generate', { prompt: SECRET, userId: USER, stream: true, userName: 'Jane secretuser@example.com' }); await r.text();
    await until(() => of('build_ready').length);
    assert.deepEqual(names(), ['build_started', 'build_ready']);
    assert.deepEqual(of('build_started')[0], { user_id: USER, anon_id: null, event: 'build_started', props: { source: 'web', build_kind: 'new', prompt_length_bucket: '40_99', plan_step_skipped: true } });
    const ready = of('build_ready')[0]; assert.equal(ready.user_id, USER); assert.equal(ready.props.source, 'web'); assert.ok(ready.props.duration_ms >= 0 && ready.props.duration_ms < 10_000);
    nothingPrivate();
});

test('plan_step_skipped is false when the person asked for a plan first', async () => {
    process.env.ANTHROPIC_API_KEY = 'x'; const saved = globalThis.fetch;
    await call('POST', '/api/projects/plan', { prompt: 'a diary app', userId: USER });
    worker = () => new Response('{}', { status: 200 });
    await (await call('POST', '/api/projects/generate', { prompt: SECRET, userId: USER })).text(); await until(() => of('build_started').length);
    assert.equal(of('build_started')[0].props.plan_step_skipped, false); delete process.env.ANTHROPIC_API_KEY; globalThis.fetch = saved;
});

test('generate: worker error / no result -> build_failed with the class code only', async () => {
    worker = () => sse({ type: 'error', error: `could not build "${SECRET}" see https://x.test/a` });
    await (await call('POST', '/api/projects/generate', { prompt: SECRET, userId: USER, stream: true })).text(); await until(() => of('build_failed').length);
    assert.deepEqual(names(), ['build_started', 'build_failed']);
    assert.equal(of('build_failed')[0].props.error_code, 'WORKER_ERROR'); assert.equal(of('build_failed')[0].user_id, USER); assert.ok(of('build_failed')[0].props.duration_ms >= 0);
    nothingPrivate();
    events = []; worker = () => new Response('boom', { status: 500 });
    await (await call('POST', '/api/projects/generate', { prompt: SECRET, userId: USER })).text(); await until(() => of('build_failed').length);
    assert.equal(of('build_failed')[0].props.error_code, 'DISPATCH_ERROR'); assert.equal(of('build_failed')[0].props.status, 500); nothingPrivate();
});

test('generate: busy worker (429) -> rate_limited worker_busy; quota exhausted -> worker_quota', async () => {
    worker = () => new Response(JSON.stringify({ error: 'busy' }), { status: 429, headers: { 'content-type': 'application/json' } });
    await (await call('POST', '/api/projects/generate', { prompt: SECRET, userId: USER })).text(); await until(() => of('rate_limited').length);
    assert.deepEqual(of('rate_limited')[0].props, { cap: 'worker_busy', status: 429, source: 'web' });
    events = []; worker = () => new Response(JSON.stringify({ error: 'q', quotaExhausted: true }), { status: 429, headers: { 'content-type': 'application/json' } });
    await (await call('POST', '/api/projects/generate', { prompt: SECRET, userId: USER, stream: true })).text(); await until(() => of('rate_limited').length);
    assert.equal(of('rate_limited')[0].props.cap, 'worker_quota'); nothingPrivate();
});

test('generate: the hourly cap -> rate_limited hourly_generation with the 429', async () => {
    worker = () => new Response('{}', { status: 200 });
    const u = 'hourly-user-1';
    for (let i = 0; i < 32; i++) await (await call('POST', '/api/projects/generate', { prompt: 'x'.repeat(20), userId: u })).text();
    await until(() => of('rate_limited').length);
    assert.ok(of('rate_limited').length >= 1); assert.equal(of('rate_limited')[0].props.cap, 'hourly_generation'); assert.equal(of('rate_limited')[0].user_id, u);
});

test('build-complete callback (Android async path): ready and failed are recorded for the project owner', async () => {
    const cb = (body) => call('POST', `/api/projects/${PID}/build-complete`, { secret: 'test-worker-secret', ...body });
    await cb({ status: 'ready', bundle: 'QUJD' }); await until(() => of('build_ready').length);
    assert.equal(of('build_ready')[0].user_id, USER); assert.ok(of('build_ready')[0].props.duration_ms >= 29 * 60_000, 'duration from the project row');
    events = []; await cb({ status: 'failed', error: `Claude exited for ${SECRET}` }); await until(() => of('build_failed').length);
    assert.equal(of('build_failed')[0].props.error_code, 'WORKER_ERROR'); nothingPrivate();
    events = []; assert.equal((await call('POST', `/api/projects/${PID}/build-complete`, { secret: 'wrong', status: 'failed' })).status, 401); await until(() => false); assert.equal(events.length, 0);
});

test('retry -> build_started (retry kind) and the failure afterwards', async () => {
    worker = () => new Response('nope', { status: 500 });
    await call('POST', `/api/projects/${PID}/retry`, { userId: USER }); await until(() => of('build_failed').length);
    assert.equal(of('build_started')[0].props.build_kind, 'retry'); assert.equal(of('build_failed')[0].props.error_code, 'RETRY_EXHAUSTED'); assert.equal(of('build_failed')[0].props.build_kind, 'retry'); nothingPrivate();
});

test('tweak: started then ready / failed, with duration and codes only', async () => {
    worker = (u) => (u.pathname === '/tweak' ? sse({ type: 'result', bundle: 'QUJD', commitSha: 'abc' }) : new Response('{"repoName":"repo-1"}', { status: 200 }));
    await (await call('POST', `/api/projects/${PID}/tweak`, { userId: USER, tweakDescription: SECRET })).text(); await until(() => of('tweak_ready').length);
    assert.deepEqual(names(), ['tweak_started', 'tweak_ready']); assert.equal(of('tweak_started')[0].props.prompt_length_bucket, '40_99'); assert.ok(of('tweak_ready')[0].props.duration_ms >= 0); nothingPrivate();
    events = []; worker = (u) => (u.pathname === '/tweak' ? sse({ type: 'error', error: SECRET }) : new Response('{}', { status: 200 }));
    await (await call('POST', `/api/projects/${PID}/tweak`, { userId: USER, tweakDescription: SECRET })).text(); await until(() => of('tweak_failed').length);
    assert.deepEqual(names(), ['tweak_started', 'tweak_failed']); assert.equal(of('tweak_failed')[0].props.error_code, 'WORKER_ERROR'); nothingPrivate();
    events = []; worker = (u) => (u.pathname === '/tweak' ? new Response('{"error":"x"}', { status: 500 }) : new Response('{}', { status: 200 }));
    await (await call('POST', `/api/projects/${PID}/tweak`, { userId: USER, tweakDescription: SECRET })).text(); await until(() => of('tweak_failed').length);
    assert.deepEqual(of('tweak_failed')[0].props.error_code, 'WORKER_HTTP'); assert.equal(of('tweak_failed')[0].props.status, 500); assert.equal(of('tweak_failed').length, 1);
});

test('project delete, unpublish and publish are recorded; the project id and name are not', async () => {
    const dr = await call('DELETE', `/api/projects/${PID}`, { userId: USER }); assert.equal(dr.status, 200); await until(() => of('project_deleted').length);
    assert.deepEqual(of('project_deleted')[0], { user_id: USER, anon_id: null, event: 'project_deleted', props: { source: 'web' } });
    events = []; await call('DELETE', `/api/deploy/${PID}/deploy`, { userId: USER }); await until(() => of('unpublish').length);
    assert.equal(of('unpublish').length, 1); assert.deepEqual(of('unpublish')[0].props, { source: 'web' });
    events = []; worker = () => new Response('{"bundle":"QUJD"}', { status: 200 });
    const r = await call('POST', `/api/deploy/${PID}/deploy`, { userId: USER, subdomain: 'my-diary-secretuser' }); assert.equal(r.status, 200); await until(() => of('publish').length);
    assert.equal(of('publish').length, 1); assert.deepEqual(of('publish')[0].props, { source: 'web' }); nothingPrivate(); assert.ok(!JSON.stringify(events).includes('my-diary'));
});

test('register: signup_completed for a new account, login (throttled) for a returning one', async () => {
    const body = { userId: USER, email: 'secretuser@example.com', displayName: 'Secret User' };
    await call('POST', '/api/auth/register', body); await until(() => of('signup_completed').length);
    assert.deepEqual(of('signup_completed')[0], { user_id: USER, anon_id: null, event: 'signup_completed', props: { source: 'web' } }); nothingPrivate();
    events = []; usersRow = { user_id: 'login-user-1' }; verified = 'login-user-1';
    await call('POST', '/api/auth/register', { ...body, userId: 'login-user-1' }); await call('POST', '/api/auth/register', { ...body, userId: 'login-user-1' }); await until(() => of('login').length);
    assert.equal(of('login').length, 1, 'one login per half hour'); assert.equal(of('signup_completed').length, 0); nothingPrivate();
});

test('account deletion removes the events of that user and records account_deleted without the user id', async () => {
    const r = await call('DELETE', '/api/auth/account', { userId: USER }); assert.equal(r.status, 200); await until(() => of('account_deleted').length);
    assert.ok(events.some((e) => e.deleted_for === USER), 'events of the user are deleted');
    assert.deepEqual(of('account_deleted')[0], { user_id: null, anon_id: null, event: 'account_deleted', props: { source: 'web' } });
    events = []; tableMissing = true; assert.equal((await call('DELETE', '/api/auth/account', { userId: USER })).status, 200, 'a missing table never blocks deleting an account');
});

test('a missing app_events table never changes what a request returns', async () => {
    tableMissing = true; worker = () => new Response('{}', { status: 200 });
    const a = await call('POST', '/api/projects/generate', { prompt: SECRET, userId: USER }); assert.equal(a.status, 200); await a.text();
    const b = await call('POST', '/api/auth/register', { userId: USER, email: 'x@y.co' }); assert.equal(b.status, 200);
    const c = await call('DELETE', `/api/projects/${PID}`, { userId: USER }); assert.equal(c.status, 200);
});

test('survey: eligibility needs a token, an own project and no other ready build; the answer is a fixed choice and is stored once', async () => {
    const get = (qs = `?projectId=${PID}`) => call('GET', `/api/events/first-build-survey${qs}`);
    verified = null; assert.equal((await get()).status, 401); assert.equal((await call('POST', '/api/events/first-build-survey', { choice: 'learning' })).status, 401);
    verified = USER;
    assert.deepEqual(await (await get()).json(), { eligible: true });
    assert.deepEqual(await (await get('?projectId=nope')).json(), { eligible: false });
    projectOwner = 'someone-else'; assert.deepEqual(await (await get()).json(), { eligible: false }); projectOwner = USER;
    otherReady = true; assert.deepEqual(await (await get()).json(), { eligible: false }); otherReady = false;
    for (const bad of [{}, { choice: 'I wanted a diary for me@x.co' }, { choice: 5 }, { choice: 'constructor' }, { choice: ['learning'] }]) assert.equal((await call('POST', '/api/events/first-build-survey', bad)).status, 400);
    const ok = await call('POST', '/api/events/first-build-survey', { choice: 'learning', text: SECRET, email: 'a@b.co' });
    assert.deepEqual(await ok.json(), { success: true, recorded: true });
    assert.deepEqual(of('first_build_survey')[0], { user_id: USER, anon_id: null, event: 'first_build_survey', props: { choice: 'learning', source: 'web' } }); nothingPrivate();
    assert.deepEqual(await (await call('POST', '/api/events/first-build-survey', { choice: 'game_or_fun' })).json(), { success: true, recorded: false });
    assert.equal(of('first_build_survey').length, 1);
    assert.deepEqual(await (await get()).json(), { eligible: false }, 'never asked twice');
    surveyRows = 0; tableMissing = true; assert.deepEqual(await (await get()).json(), { eligible: false }, 'not asked when the answer could not be stored');
    assert.equal((await call('POST', '/api/events/first-build-survey', { choice: 'dismissed' })).status, 503);
});
