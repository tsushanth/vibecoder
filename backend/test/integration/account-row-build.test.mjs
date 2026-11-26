// A signed-in account with no users row was refused every build (projects.creator_id foreign key) behind a generic "HTTP 500".
// The row is now created from the verified token before the route runs, and any refusal that still happens says what failed.
import '../helpers/env.mjs';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';

process.env.APP_EVENTS_TEST = '1';
const { supabase } = await import('../../config/database.js');
const { _setSink } = await import('../../lib/failureReporter.js');

const users = new Map(); // user_id -> row
let events = [], reports = [], userWrites = 0, failUserInsert = false;
let sourceCreator = 'someone-else';
stubSupabase(supabase, (q) => {
    if (q.table === 'users') {
        if (q.op === 'upsert') {
            if (failUserInsert) return { data: null, error: { code: '57P01', message: 'terminating connection' } };
            userWrites++;
            const id = q.payload.user_id;
            // The ensure step is "insert or ignore" (select without single); register merges into the row and ends in .single().
            if (!q.single && users.has(id)) return { data: [], error: null };
            users.set(id, { ...users.get(id), ...q.payload });
            return { data: q.single ? users.get(id) : [{ user_id: id }], error: null };
        }
        if (q.op === 'update') return { data: null, error: null };
        const row = users.get(eqOf(q, 'user_id'));
        return row ? { data: row, error: null } : { data: null, error: q.maybe ? null : { code: 'PGRST116' } };
    }
    if (q.table === 'projects') {
        if (q.op === 'insert') {
            if (!users.has(q.payload.creator_id)) return { data: null, error: { code: '23503', message: 'insert or update on table "projects" violates foreign key constraint "projects_creator_id_fkey"' } };
            return { data: { id: q.payload.id }, error: null };
        }
        if (q.op === 'select' && q.single) return { data: { id: eqOf(q, 'id'), title: 'Source', bundle: 'UEs=', creator_id: sourceCreator, fork_count: 0 }, error: null };
        return { data: [], error: null };
    }
    if (q.table === 'app_events' && q.op === 'insert') { events.push(q.payload); return { data: null, error: null }; }
    if (q.single) return { data: null, error: { code: 'PGRST116' } };
    return { data: [], error: null };
});
supabase.auth.getUser = async (t) => (String(t).startsWith('tok-')
    ? { data: { user: { id: String(t).slice(4), email: `${String(t).slice(4)}@example.com`, user_metadata: { full_name: 'Token Name' } } }, error: null }
    : { data: { user: null }, error: { message: 'bad token' } });

const { default: projects } = await import('../../routes/projects.routes.js');
const { createAuthRouter } = await import('../../routes/auth.routes.js');
const { userRowMiddleware } = await import('../../lib/ensureUserRow.js');
const { serverErrorReport } = await import('../../middleware/serverErrorReport.js');

const realFetch = globalThis.fetch; let srv;
before(async () => {
    _setSink((r) => reports.push(r));
    globalThis.fetch = (url, o = {}) => {
        if (new URL(String(url)).hostname === '127.0.0.1') return realFetch(url, o);
        return Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
    };
    const app = express();
    app.use(serverErrorReport());
    app.use(express.json());
    app.use(userRowMiddleware());
    app.use('/api/auth', createAuthRouter());
    app.use('/api/projects', projects);
    srv = await listen(app);
    await new Promise((r) => setTimeout(r, 100));
});
after(async () => { _setSink(null); globalThis.fetch = realFetch; await srv.close(); });
beforeEach(() => { users.clear(); events = []; reports = []; userWrites = 0; failUserInsert = false; sourceCreator = 'someone-else'; });

const quiet = async (fn) => { const o = [console.log, console.warn, console.error]; console.log = console.warn = console.error = () => {}; try { return await fn(); } finally { [console.log, console.warn, console.error] = o; } };
const post = (path, body, headers = {}) => quiet(async () => {
    const r = await realFetch(`${srv.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'okhttp/4.12.0', ...headers }, body: JSON.stringify(body) });
    const text = await r.text();
    await new Promise((res) => setTimeout(res, 40)); // 'finish' listeners and fire-and-forget inserts
    return { status: r.status, text };
});
let n = 0; const uid = () => `row-user-${++n}`;
const bearer = (u) => ({ authorization: `Bearer tok-${u}` });
const prompt = 'a habit tracker with streaks';
const named = (name) => events.filter((e) => e.event === name);

test('generate: an account with no users row gets one from its token and the build is accepted', async () => {
    const u = uid();
    const r = await post('/api/projects/generate', { prompt, userId: u, stream: false }, bearer(u));
    assert.equal(r.status, 200, r.text);
    assert.equal(users.get(u).email, `${u}@example.com`);
    assert.equal(users.get(u).display_name, 'Token Name');
    assert.equal(named('signup_completed').length, 1);
    assert.equal(named('build_refused').length, 0);
    assert.equal(reports.length, 0);
});

test('fork: the same account can fork', async () => {
    const u = uid();
    const r = await post('/api/projects/11111111-2222-3333-4444-555555555555/fork', { userId: u }, bearer(u));
    assert.equal(r.status, 200, r.text);
    assert.ok(users.has(u));
});

test('the row is created for the token\'s user only: a user id in the body creates nothing', async () => {
    const victim = uid(), caller = uid();
    await post('/api/projects/generate', { prompt, userId: victim, stream: false }, bearer(caller));
    assert.equal(users.has(victim), false);
    assert.ok(users.has(caller));
});

test('an existing row is never changed by the ensure step', async () => {
    const u = uid();
    users.set(u, { user_id: u, display_name: 'Chosen', email: 'kept@example.com' });
    await post('/api/projects/generate', { prompt, userId: u, stream: false }, bearer(u));
    assert.deepEqual(users.get(u), { user_id: u, display_name: 'Chosen', email: 'kept@example.com' });
    assert.equal(named('signup_completed').length, 0);
});

test('refused build: no token and no row is one alert that says what failed, and one build_refused event', async () => {
    const u = uid();
    const r = await post('/api/projects/generate', { prompt, userId: u, stream: false });
    assert.equal(r.status, 500);
    assert.equal(users.has(u), false);
    assert.equal(reports.length, 1, JSON.stringify(reports)); // no second generic "HTTP 500"
    assert.equal(reports[0].flow, 'build_refused');
    assert.match(reports[0].message, /new no_account_row: .*foreign key/);
    assert.equal(reports[0].context.error_name, '23503');
    assert.doesNotMatch(JSON.stringify(reports), new RegExp(`${u}|habit tracker`));
    const [e] = named('build_refused');
    assert.deepEqual([e.user_id, e.props.reason, e.props.build_kind, e.props.status, e.props.source], [u, 'no_account_row', 'new', 500, 'android']);
});

test('refused fork is reported the same way', async () => {
    const r = await post('/api/projects/11111111-2222-3333-4444-555555555555/fork', { userId: uid() });
    assert.equal(r.status, 500);
    assert.equal(reports.length, 1);
    assert.match(reports[0].message, /fork no_account_row/);
});

test('remixing your own app is refused under its own reason, not "invalid request"', async () => {
    const u = uid();
    sourceCreator = u;
    const r = await post('/api/projects/11111111-2222-3333-4444-555555555555/fork', { userId: u }, bearer(u));
    assert.equal(r.status, 400);
    assert.match(r.text, /Cannot fork your own project/);
    assert.equal(named('build_refused')[0].props.reason, 'own_project');
    assert.match(reports[0].message, /fork own_project/);
});

test('a refusal for the prompt is counted with its reason', async () => {
    const u = uid();
    const r = await post('/api/projects/generate', { prompt: 'copy https://example.com for me', userId: u, stream: false }, bearer(u));
    assert.equal(r.status, 400);
    assert.equal(named('build_refused')[0].props.reason, 'prompt_url');
    assert.match(reports[0].message, /new prompt_url/);
});

test('a probe without a user id is not counted or alerted', async () => {
    assert.equal((await post('/api/projects/generate', {})).status, 400);
    assert.equal(reports.length, 0);
    assert.equal(named('build_refused').length, 0);
});

test('a users insert that fails is reported, and the request still gets an answer', async () => {
    failUserInsert = true;
    const u = uid();
    assert.equal((await post('/api/projects/generate', { prompt, userId: u, stream: false }, bearer(u))).status, 500);
    assert.deepEqual(reports.map((r) => r.flow), ['user_row_create_failed', 'build_refused']);
});

test('register is left to create its own row, and a later register without a name keeps the stored one', async () => {
    const u = uid();
    await post('/api/auth/register', { userId: u, email: `${u}@example.com`, displayName: 'Typed Name' }, bearer(u));
    assert.equal(userWrites, 1); // the middleware did not run for register
    assert.equal(named('signup_completed').length, 1);
    await post('/api/auth/register', { userId: u, email: `${u}@example.com`, displayName: null, avatarUrl: null }, bearer(u));
    assert.equal(users.get(u).display_name, 'Typed Name');
});
