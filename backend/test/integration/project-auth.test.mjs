import '../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');

// A project's creator id is public, so a body userId proves nothing. Every route that changes an existing project must make a real
// account prove itself with its own token, while anonymous device ids (iOS has no login) keep working.
const PID = '01234567-89ab-cdef-0123-456789abcdef';
const ACCOUNTS = { 'real-owner': 'owner@example.com', 'real-other': 'other@example.com', 'device-1': null };
let projectOwner = 'real-owner'; let projectReads = 0; const writes = [];
stubSupabase(supabase, (q) => {
    if (q.op !== 'select') writes.push({ table: q.table, op: q.op });
    if (q.table === 'users') { const id = eqOf(q, 'user_id'); return { data: id in ACCOUNTS ? { email: ACCOUNTS[id] } : null, error: null }; }
    if (q.table === 'projects') {
        projectReads += 1;
        if (q.single) return { data: { id: PID, title: 'T', creator_id: projectOwner, status: 'failed', initial_prompt: 'a todo app', bundle: 'QUJD', github_repo: 'app-1', free_tweaks_remaining: 3, project_type: 'react', description: 'd', creator_name: 'n' }, error: null };
        return { data: [], error: null };
    }
    return q.single ? { data: null, error: { code: 'PGRST116' } } : { data: [], error: null };
});
supabase.auth.getUser = async (t) => (String(t).startsWith('tok-') ? { data: { user: { id: String(t).slice(4) } }, error: null } : { data: { user: null }, error: { message: 'bad token' } });
const { default: router } = await import('../../routes/projects.routes.js');

const realFetch = globalThis.fetch; let srv;
const origLog = { log: console.log, warn: console.warn, error: console.error };
before(async () => {
    globalThis.fetch = (url, opts = {}) => { const u = new URL(String(url)); if (u.hostname === '127.0.0.1') return realFetch(url, opts); return Promise.resolve(new Response('{"error":"stop"}', { status: 500, headers: { 'content-type': 'application/json' } })); };
    const app = express(); app.use(express.json({ limit: '5mb' })); app.locals.proxyAdmin = { configured: false }; app.use('/api/projects', router);
    srv = await listen(app);
});
after(async () => { globalThis.fetch = realFetch; Object.assign(console, origLog); await srv.close(); });

const ROUTES = [
    ['retry', 'POST', `/${PID}/retry`, {}],
    ['export-apk', 'POST', `/${PID}/export-apk`, {}],
    ['tweak', 'POST', `/${PID}/tweak`, { tweakDescription: 'make the buttons blue' }],
    ['revert', 'POST', `/${PID}/revert/abc1234`, {}],
    ['rename', 'PATCH', `/${PID}`, { title: 'New name' }],
    ['fork', 'POST', `/${PID}/fork`, {}],
    ['delete', 'DELETE', `/${PID}`, {}],
];
const call = async (method, path, body, token) => {
    projectReads = 0; writes.length = 0;
    console.log = console.warn = console.error = () => {};
    try { return await realFetch(`${srv.base}/api/projects${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); }
    finally { Object.assign(console, origLog); }
};

for (const [name, method, path, extra] of ROUTES) {
    test(`${name}: a real account with no token is turned away (401) before the project is read or anything is written`, async () => {
        projectOwner = 'real-owner';
        const r = await call(method, path, { userId: 'real-owner', ...extra });
        assert.equal(r.status, 401); await r.text();
        assert.equal(projectReads, 0); assert.deepEqual(writes, []);
    });

    test(`${name}: a token for a different user is refused (403) before the project is read or anything is written`, async () => {
        projectOwner = 'real-owner';
        const r = await call(method, path, { userId: 'real-owner', ...extra }, 'tok-real-other');
        assert.equal(r.status, 403); await r.text();
        assert.equal(projectReads, 0); assert.deepEqual(writes, []);
    });

    test(`${name}: the owner's own token gets through to the project`, async () => {
        projectOwner = 'real-owner';
        const r = await call(method, path, { userId: 'real-owner', ...extra }, 'tok-real-owner');
        await r.text();
        assert.ok(![401, 403].includes(r.status), `status ${r.status}`); assert.ok(projectReads >= 1);
    });

    test(`${name}: an anonymous device id keeps working without a token`, async () => {
        projectOwner = 'device-1';
        const r = await call(method, path, { userId: 'device-1', ...extra });
        await r.text();
        assert.ok(![401, 403].includes(r.status), `status ${r.status}`); assert.ok(projectReads >= 1);
    });
}

test('an invalid token is treated as no token: a real account is refused, not trusted', async () => {
    projectOwner = 'real-owner';
    const r = await call('DELETE', `/${PID}`, { userId: 'real-owner' }, 'garbage');
    assert.equal(r.status, 401); await r.text(); assert.equal(projectReads, 0); assert.deepEqual(writes, []);
});
