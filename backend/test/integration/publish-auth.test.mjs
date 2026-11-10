import '../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');

// Publishing (and the ads switch) need the owner's own token for a real account; anonymous device ids still work without one.
const ACCOUNTS = { owner: 'owner@example.com', other: 'other@example.com', 'device-1': null };
let projectOwner = 'owner'; const writes = [];
stubSupabase(supabase, (q) => {
    if (q.op !== 'select') writes.push({ table: q.table, op: q.op });
    if (q.table === 'users' && q.op === 'select') { const id = eqOf(q, 'user_id'); return { data: id in ACCOUNTS ? { email: ACCOUNTS[id] } : null, error: null }; }
    if (q.table === 'deployments' && q.op === 'select' && q.single) return { data: null, error: { code: 'PGRST116' } };
    if (q.table === 'projects' && q.op === 'select' && q.single) return { data: { bundle: 'QUJD', creator_id: projectOwner, github_repo: null, preview_url: null }, error: null };
    return { data: null, error: null };
});
supabase.auth.getUser = async (t) => (String(t).startsWith('tok-') ? { data: { user: { id: String(t).slice(4) } }, error: null } : { data: { user: null }, error: { message: 'bad token' } });
const { default: deployRouter } = await import('../../routes/deploy.routes.js');

const realFetch = globalThis.fetch; let srv; let deployServer = [];
before(async () => {
    globalThis.fetch = (url, opts = {}) => {
        const u = new URL(String(url));
        if (u.hostname === '127.0.0.1') return realFetch(url, opts);
        deployServer.push({ method: opts.method, path: u.pathname, secret: opts.headers?.['x-internal-secret'] });
        return Promise.resolve(new Response('{}', { status: 200 }));
    };
    const app = express(); app.use(express.json()); app.locals.proxyAdmin = { configured: false };
    app.use('/api/deploy', deployRouter);
    srv = await listen(app);
});
after(async () => { globalThis.fetch = realFetch; await srv.close(); });
const reset = () => { writes.length = 0; deployServer = []; projectOwner = 'owner'; };
const quiet = async (fn) => { const o = { l: console.log, w: console.warn, e: console.error }; console.log = console.warn = console.error = () => {}; try { return await fn(); } finally { console.log = o.l; console.warn = o.w; console.error = o.e; } };
const call = (path, body, token) => quiet(() => realFetch(`${srv.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
const publish = (body, token) => call('/api/deploy/p1/deploy', body, token);

test('publish: a real account with no token gets 401 and nothing is deployed or written', async () => {
    reset(); const r = await publish({ userId: 'owner', subdomain: 'my-app' }); await r.text();
    assert.equal(r.status, 401); assert.deepEqual(writes, []); assert.deepEqual(deployServer, []);
});

test('publish: an invalid token for a real account is 401', async () => {
    reset(); const r = await publish({ userId: 'owner', subdomain: 'my-app' }, 'garbage'); await r.text();
    assert.equal(r.status, 401); assert.deepEqual(deployServer, []);
});

test('publish: another user\'s valid token is 403 even when the body names the owner', async () => {
    reset(); const r = await publish({ userId: 'owner', subdomain: 'my-app' }, 'tok-other'); await r.text();
    assert.equal(r.status, 403); assert.deepEqual(writes, []); assert.deepEqual(deployServer, []);
});

test('publish: a signed-in user who does not own the project gets 403 and nothing is deployed', async () => {
    reset(); const r = await publish({ userId: 'other', subdomain: 'my-app' }, 'tok-other'); await r.text();
    assert.equal(r.status, 403); assert.deepEqual(deployServer, []);
});

test('publish: missing fields are still 400', async () => {
    reset(); let r = await publish({ subdomain: 'my-app' }, 'tok-owner'); await r.text(); assert.equal(r.status, 400);
    r = await publish({ userId: 'owner' }, 'tok-owner'); await r.text(); assert.equal(r.status, 400);
});

test('publish: the owner\'s token deploys with the internal secret and records the site', async () => {
    reset(); const r = await publish({ userId: 'owner', subdomain: 'my-app' }, 'tok-owner');
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { success: true, url: 'https://my-app.vibebuild.cc' });
    assert.deepEqual(deployServer, [{ method: 'POST', path: '/deploy', secret: process.env.INTERNAL_SECRET }]);
    assert.ok(writes.some((w) => w.table === 'deployments' && w.op === 'upsert'));
});

test('publish: an anonymous device id (no account row) still publishes without a token, but only its own project', async () => {
    reset(); projectOwner = 'device-1';
    let r = await publish({ userId: 'device-1', subdomain: 'my-app' }); await r.text();
    assert.equal(r.status, 200); assert.equal(deployServer.length, 1);
    reset(); projectOwner = 'owner';
    r = await publish({ userId: 'device-1', subdomain: 'my-app' }); await r.text();
    assert.equal(r.status, 403); assert.deepEqual(deployServer, []);
});

test('ads switch: same rule (401 without a token, 403 for another user, owner and anonymous id succeed)', async () => {
    reset(); const ads = (body, token) => call('/api/deploy/p1/ads', body, token);
    let r = await ads({ userId: 'owner', enabled: true }); await r.text(); assert.equal(r.status, 401); assert.deepEqual(writes, []);
    r = await ads({ userId: 'owner', enabled: true }, 'tok-other'); await r.text(); assert.equal(r.status, 403); assert.deepEqual(writes, []);
    r = await ads({ userId: 'owner', enabled: true }, 'tok-owner'); assert.equal(r.status, 200); await r.text();
    assert.deepEqual(writes, [{ table: 'deployments', op: 'update' }]);
    reset(); projectOwner = 'device-1';
    r = await ads({ userId: 'device-1', enabled: false }); await r.text(); assert.equal(r.status, 200);
});
