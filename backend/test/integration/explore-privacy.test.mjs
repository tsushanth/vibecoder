import '../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');

delete process.env.VIBEBUILD_ALL_FREE;
const OWNER = 'owner-1';
const OTHER = 'someone-else';
const PID = 'fedcba98-7654-3210-fedc-ba9876543210';
const writes = [];
let projectOwner = OWNER;
const row = (o) => ({ id: 'x', title: 'Nice App', creator_id: 'u1', creator_name: 'Sam Taylor', preview_url: 'p.png',
    initial_prompt: 'Build a nice app with many features', created_at: new Date().toISOString(), status: 'ready', ...o });
const rows = [
    row({ id: 'a', creator_id: 'u1', creator_name: 'Sam Taylor' }),
    row({ id: 'b', creator_id: 'u2', creator_name: 'john.smith92', initial_prompt: 'A completely different long prompt' }),
    row({ id: 'c', creator_id: 'u3', creator_name: 'maria@example.com', initial_prompt: 'Yet another unrelated long prompt' }),
];
stubSupabase(supabase, (q) => {
    if (q.table !== 'projects') return { data: q.single ? null : [], error: q.single ? { code: 'PGRST116' } : null };
    if (q.op === 'insert' || q.op === 'update') writes.push({ op: q.op, payload: q.payload });
    if (q.op === 'insert') return { data: { id: q.payload?.id }, error: null };
    if (q.op === 'update') return { data: { id: PID, ...q.payload }, error: null };
    if (q.single) {
        if (eqOf(q, 'id') === PID) return { data: { id: PID, title: 'T', creator_id: projectOwner, creator_name: 'Sam Taylor', is_public: true, bundle: 'QUJD' }, error: null };
        return { data: null, error: { code: 'PGRST116' } };
    }
    return { data: rows, error: null };
});
const { default: projects } = await import('../../routes/projects.routes.js');
supabase.auth.getUser = async (t) => (String(t).startsWith('tok-') ? { data: { user: { id: String(t).slice(4) } }, error: null } : { data: { user: null }, error: { message: 'bad token' } });

const realFetch = globalThis.fetch; let srv;
before(async () => {
    globalThis.fetch = (url, o = {}) => {
        const u = new URL(String(url));
        if (u.hostname === '127.0.0.1') return realFetch(url, o);
        return Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
    };
    const app = express(); app.set('trust proxy', true); app.use(express.json());
    app.use('/api/projects', projects);
    srv = await listen(app);
    await new Promise((r) => setTimeout(r, 100));
});
after(async () => { globalThis.fetch = realFetch; await srv.close(); });
const quiet = async (fn) => { const o = [console.log, console.warn, console.error]; console.log = console.warn = console.error = () => {}; try { return await fn(); } finally { [console.log, console.warn, console.error] = o; } };
const call = (method, path, body, user) => quiet(() => realFetch(`${srv.base}${path}`, { method, headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer tok-${user}` } : {}) }, body: body && JSON.stringify(body) }));

test('Explore never shows a full name or an email-like name', async () => {
    const b = await (await call('GET', '/api/projects/browse')).json();
    const names = Object.fromEntries(b.projects.map((p) => [p.id, p.creator_name]));
    assert.equal(names.a, 'Sam T.');
    assert.match(names.b, /^builder-[0-9a-f]{6}$/);
    assert.match(names.c, /^builder-[0-9a-f]{6}$/);
    const text = JSON.stringify(b);
    for (const leaked of ['Taylor', 'john.smith92', 'maria@example.com']) assert.ok(!text.includes(leaked), leaked);
});

test('the project page shows the public name, not the stored full name', async () => {
    const j = await (await call('GET', `/api/projects/${PID}`)).json();
    assert.equal(j.project.creatorName, 'Sam T.');
});

test('a save is unlisted by default, and the old isPublic: true is not an opt-in', async () => {
    writes.length = 0;
    const a = await call('POST', '/api/projects/save', { title: 'Mine', bundle: 'QUJD', creatorId: OWNER, isPublic: true }, OWNER);
    assert.notEqual(a.status, 400);
    assert.equal(writes.find((w) => w.op === 'insert')?.payload.is_public, false);
    writes.length = 0;
    await call('POST', '/api/projects/save', { title: 'Mine', bundle: 'QUJD', creatorId: OWNER, listed: true }, OWNER);
    assert.equal(writes.find((w) => w.op === 'insert')?.payload.is_public, true);
});

test('a new build row is unlisted until the creator lists it', async () => {
    writes.length = 0;
    // The response may stay open while the (stubbed) worker is waited on; the placeholder row is written before that.
    await quiet(() => realFetch(`${srv.base}/api/projects/generate`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer tok-${OWNER}` }, body: JSON.stringify({ prompt: 'a habit tracker with streaks', userId: OWNER, autoStart: true, entry: 'landing_prompt' }), signal: AbortSignal.timeout(1500) }).then((r) => r.text()).catch(() => {}));
    const ins = writes.find((w) => w.op === 'insert');
    assert.ok(ins, 'a placeholder row is written');
    assert.equal(ins.payload.is_public, false);
});

test('PATCH: the owner lists and unlists; another user cannot; a bad value is a 400', async () => {
    projectOwner = OWNER; writes.length = 0;
    const on = await call('PATCH', `/api/projects/${PID}`, { userId: OWNER, isPublic: true }, OWNER);
    assert.equal(on.status, 200);
    assert.equal(writes.at(-1).payload.is_public, true);
    assert.equal(writes.at(-1).payload.title, undefined);
    const off = await call('PATCH', `/api/projects/${PID}`, { userId: OWNER, isPublic: false }, OWNER);
    assert.equal(off.status, 200);
    assert.equal(writes.at(-1).payload.is_public, false);
    assert.equal((await call('PATCH', `/api/projects/${PID}`, { userId: OWNER, isPublic: 'yes' }, OWNER)).status, 400);
    const n = writes.length;
    assert.equal((await call('PATCH', `/api/projects/${PID}`, { userId: OTHER, isPublic: true }, OTHER)).status, 403);
    assert.equal(writes.length, n);
});
