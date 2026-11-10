import '../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');

// Unpublish needs the owner's own token; unpublish, project delete and account delete take the site off the deploy server.
const ACCOUNTS = { owner: 'owner@example.com', other: 'other@example.com', 'device-1': null };
let projectOwner = 'owner'; let deployRows = []; let previewUrl = null; let deploymentsDeleteFails = false; let projectsDeleteFails = false;
const writes = [];
stubSupabase(supabase, (q) => {
    if (q.op !== 'select') writes.push({ table: q.table, op: q.op });
    if (q.table === 'users' && q.op === 'select') { const id = eqOf(q, 'user_id'); return { data: id in ACCOUNTS ? { email: ACCOUNTS[id] } : null, error: null }; }
    if (q.table === 'projects' && q.op === 'select' && q.single) return { data: { id: 'p1', creator_id: projectOwner, github_repo: null, preview_url: previewUrl }, error: null };
    if (q.table === 'projects' && q.op === 'select') return { data: [{ id: 'p1', preview_url: previewUrl }], error: null };
    if (q.table === 'deployments' && q.op === 'select') return { data: deployRows, error: null };
    if (q.table === 'deployments' && q.op === 'delete' && deploymentsDeleteFails) return { data: null, error: { message: 'fk' } };
    if (q.table === 'projects' && q.op === 'delete' && projectsDeleteFails) return { data: null, error: { message: 'fk' } };
    return { data: null, error: null };
});
supabase.auth.getUser = async (t) => (String(t).startsWith('tok-') ? { data: { user: { id: String(t).slice(4) } }, error: null } : { data: { user: null }, error: { message: 'bad token' } });
const { default: deployRouter } = await import('../../routes/deploy.routes.js');
const { default: projects } = await import('../../routes/projects.routes.js');
const { createAuthRouter } = await import('../../routes/auth.routes.js');
const { removeSites, disableSiteApps, projectSiteSubdomains } = await import('../../lib/siteRemoval.js');

const proxyCalls = []; let proxyFails = false;
const proxy = { configured: true, setEnabled: async (app, on) => { proxyCalls.push([app, on]); if (proxyFails) throw Object.assign(new Error('x'), { code: 'unreachable' }); } };
const realFetch = globalThis.fetch; let srv; let deployServer = []; let deployServerStatus = 200; let deployServerThrows = false;
const origLog = { log: console.log, warn: console.warn, error: console.error };
before(async () => {
    globalThis.fetch = (url, opts = {}) => {
        const u = new URL(String(url));
        if (u.hostname === '127.0.0.1') return realFetch(url, opts);
        deployServer.push({ method: opts.method, path: u.pathname, secret: opts.headers?.['x-internal-secret'] });
        if (deployServerThrows) return Promise.reject(new Error('connect ECONNREFUSED'));
        return Promise.resolve(new Response('{}', { status: deployServerStatus }));
    };
    const app = express(); app.use(express.json()); app.locals.proxyAdmin = proxy;
    app.use('/api/deploy', deployRouter); app.use('/api/projects', projects); app.use('/api/auth', createAuthRouter());
    srv = await listen(app);
});
after(async () => { globalThis.fetch = realFetch; Object.assign(console, origLog); await srv.close(); });
const reset = () => { proxyCalls.length = 0; proxyFails = false; writes.length = 0; deployServer = []; deployServerStatus = 200; deployServerThrows = false; projectOwner = 'owner'; deployRows = [{ subdomain: 'my-app' }]; previewUrl = null; deploymentsDeleteFails = false; projectsDeleteFails = false; };
const call = async (method, path, body, token) => {
    console.log = console.warn = console.error = () => {};
    try { return await realFetch(`${srv.base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); }
    finally { Object.assign(console, origLog); }
};
const unpublish = (body, token) => call('DELETE', '/api/deploy/p1/deploy', body, token);

test('unpublish: a real account with no token gets 401 and nothing is written or removed', async () => {
    reset(); const r = await unpublish({ userId: 'owner' }); await r.text();
    assert.equal(r.status, 401); assert.deepEqual(writes, []); assert.deepEqual(deployServer, []);
});

test('unpublish: a different user\'s valid token is refused (403) even when the body names the owner', async () => {
    reset(); const r = await unpublish({ userId: 'owner' }, 'tok-other'); await r.text();
    assert.equal(r.status, 403); assert.deepEqual(writes, []); assert.deepEqual(deployServer, []);
});

test('unpublish: an invalid token for a real account is 401', async () => {
    reset(); const r = await unpublish({ userId: 'owner' }, 'garbage'); await r.text();
    assert.equal(r.status, 401); assert.deepEqual(writes, []);
});

test('unpublish: a signed-in user who does not own the project gets 403 and nothing changes', async () => {
    reset(); const r = await unpublish({ userId: 'other' }, 'tok-other'); await r.text();
    assert.equal(r.status, 403); assert.deepEqual(writes, []); assert.deepEqual(deployServer, []);
});

test('unpublish: a missing userId is 400', async () => {
    reset(); projectOwner = null;
    let r = await unpublish({}, 'tok-owner'); await r.text(); assert.equal(r.status, 400);
});

test('unpublish: the owner\'s token marks the deployment deleted and removes the site with the internal secret', async () => {
    reset(); const r = await unpublish({ userId: 'owner' }, 'tok-owner');
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { success: true });
    assert.deepEqual(writes, [{ table: 'deployments', op: 'update' }, { table: 'projects', op: 'update' }]);
    assert.deepEqual(deployServer, [{ method: 'DELETE', path: '/deploy/my-app', secret: process.env.INTERNAL_SECRET }]);
});

test('unpublish: an anonymous device id keeps working without a token', async () => {
    reset(); projectOwner = 'device-1';
    const r = await unpublish({ userId: 'device-1' }); await r.text();
    assert.equal(r.status, 200); assert.equal(deployServer.length, 1);
});

test('unpublish: a deploy-server failure does not undo the unpublish, is flagged, and repeating it retries the removal', async () => {
    reset(); deployServerStatus = 500;
    let r = await unpublish({ userId: 'owner' }, 'tok-owner');
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { success: true, siteRemoval: 'failed' });
    deployServerStatus = 200; deployServer = [];
    r = await unpublish({ userId: 'owner' }, 'tok-owner');
    assert.deepEqual(await r.json(), { success: true }); assert.equal(deployServer.length, 1);
    reset(); deployServerThrows = true;
    r = await unpublish({ userId: 'owner' }, 'tok-owner'); assert.equal(r.status, 200); assert.equal((await r.json()).siteRemoval, 'failed');
});

test('project delete: removes the published site and the preview after the rows are deleted', async () => {
    reset(); previewUrl = 'https://preview-0123456789ab.vibebuild.cc'; deployRows = [{ subdomain: 'my-app' }, { subdomain: 'second-app' }];
    const r = await call('DELETE', '/api/projects/p1', { userId: 'owner' }, 'tok-owner');
    assert.equal(r.status, 200);
    assert.deepEqual(deployServer.map((c) => `${c.method} ${c.path}`), ['DELETE /deploy/my-app', 'DELETE /deploy/second-app', 'DELETE /deploy/preview-0123456789ab']);
    assert.ok(deployServer.every((c) => c.secret === process.env.INTERNAL_SECRET));
});

test('project delete: a deploy-server outage does not block the delete', async () => {
    reset(); deployServerThrows = true;
    const r = await call('DELETE', '/api/projects/p1', { userId: 'owner' }, 'tok-owner'); await r.text();
    assert.equal(r.status, 200); assert.ok(writes.some((w) => w.table === 'projects' && w.op === 'delete'));
});

test('project delete: when the rows cannot be deleted the site is left up', async () => {
    reset(); deploymentsDeleteFails = true;
    const r = await call('DELETE', '/api/projects/p1', { userId: 'owner' }, 'tok-owner'); await r.text();
    assert.equal(r.status, 500); assert.deepEqual(deployServer, []);
});

test('project delete: someone else\'s project removes nothing', async () => {
    reset();
    const r = await call('DELETE', '/api/projects/p1', { userId: 'other' }, 'tok-other'); await r.text();
    assert.equal(r.status, 403); assert.deepEqual(deployServer, []);
});

test('account delete: removes every published site and preview of the account\'s projects', async () => {
    reset(); previewUrl = 'https://preview-0123456789ab.vibebuild.cc'; deployRows = [{ subdomain: 'my-app' }];
    const r = await call('DELETE', '/api/auth/account', {}, 'tok-owner'); await r.text();
    assert.equal(r.status, 200);
    assert.deepEqual(deployServer.map((c) => c.path).sort(), ['/deploy/my-app', '/deploy/preview-0123456789ab']);
    assert.ok(deployServer.every((c) => c.method === 'DELETE' && c.secret === process.env.INTERNAL_SECRET));
});

test('account delete: a deploy-server outage does not block the deletion', async () => {
    reset(); deployServerThrows = true;
    const r = await call('DELETE', '/api/auth/account', {}, 'tok-owner'); await r.text();
    assert.equal(r.status, 200);
});

test('account delete: nothing is removed without the account\'s own token, or when the projects could not be deleted', async () => {
    reset();
    let r = await call('DELETE', '/api/auth/account', { userId: 'owner' }); await r.text();
    assert.equal(r.status, 401); assert.deepEqual(deployServer, []);
    reset(); projectsDeleteFails = true;
    r = await call('DELETE', '/api/auth/account', {}, 'tok-owner'); await r.text();
    assert.equal(r.status, 500); assert.deepEqual(deployServer, []);
});

test('removeSites: idempotent (404 counts as removed), skips invalid names, never throws', async () => {
    reset(); deployServerStatus = 404;
    const quiet = () => {};
    assert.deepEqual(await removeSites(['my-app', 'my-app', '../etc', 'A', 'x'], { log: quiet }), { removed: ['my-app'], failed: [] });
    assert.equal(deployServer.length, 1);
    assert.deepEqual(await removeSites([], { log: quiet }), { removed: [], failed: [] });
    deployServerThrows = true;
    assert.deepEqual(await removeSites(['my-app'], { log: quiet }), { removed: [], failed: ['my-app'] });
});

test('projectSiteSubdomains: deployment rows plus only a preview- name under our own domain', () => {
    assert.deepEqual(projectSiteSubdomains({ deployments: [{ subdomain: 'My-App' }, { subdomain: null }, { subdomain: 'my-app' }], previewUrl: 'https://preview-abc123.vibebuild.cc' }, 'vibebuild.cc'), ['my-app', 'preview-abc123']);
    assert.deepEqual(projectSiteSubdomains({ previewUrl: 'https://other-app.vibebuild.cc' }, 'vibebuild.cc'), []);
    assert.deepEqual(projectSiteSubdomains({ previewUrl: 'https://preview-abc123.evil.com' }, 'vibebuild.cc'), []);
    assert.deepEqual(projectSiteSubdomains({ previewUrl: 'garbage' }, 'vibebuild.cc'), []);
});

test('removeSites: an unreachable deploy server is tried once, not once per site', async () => {
    reset(); deployServerThrows = true;
    const r = await removeSites(['a-one', 'b-two', 'c-three'], { log: () => {} });
    assert.deepEqual(r, { removed: [], failed: ['a-one', 'b-two', 'c-three'] }); assert.equal(deployServer.length, 1);
});

test('project delete: the data-proxy apps of the site and the preview are switched off, before the site is removed', async () => {
    reset(); previewUrl = 'https://preview-0123456789ab.vibebuild.cc'; deployRows = [{ subdomain: 'my-app' }, { subdomain: 'second-app' }];
    const r = await call('DELETE', '/api/projects/p1', { userId: 'owner' }, 'tok-owner'); await r.text();
    assert.equal(r.status, 200);
    assert.deepEqual(proxyCalls, [['my-app', false], ['second-app', false], ['preview-0123456789ab', false]]);
});

test('project delete: a proxy outage does not block the delete or the site removal; a refused or foreign delete disables nothing', async () => {
    reset(); proxyFails = true;
    let r = await call('DELETE', '/api/projects/p1', { userId: 'owner' }, 'tok-owner'); await r.text();
    assert.equal(r.status, 200); assert.equal(deployServer.length, 1);
    reset();
    r = await call('DELETE', '/api/projects/p1', { userId: 'other' }, 'tok-other'); await r.text();
    assert.equal(r.status, 403); assert.deepEqual(proxyCalls, []);
    reset(); deploymentsDeleteFails = true;
    r = await call('DELETE', '/api/projects/p1', { userId: 'owner' }, 'tok-owner'); await r.text();
    assert.equal(r.status, 500); assert.deepEqual(proxyCalls, []);
});

test('account delete: the data-proxy apps of every site and preview are switched off; nothing without the account\'s token', async () => {
    reset(); previewUrl = 'https://preview-0123456789ab.vibebuild.cc'; deployRows = [{ subdomain: 'my-app' }];
    let r = await call('DELETE', '/api/auth/account', {}, 'tok-owner'); await r.text();
    assert.equal(r.status, 200); assert.deepEqual(proxyCalls.map((c) => c.join(':')).sort(), ['my-app:false', 'preview-0123456789ab:false']);
    reset(); r = await call('DELETE', '/api/auth/account', {}); await r.text();
    assert.equal(r.status, 401); assert.deepEqual(proxyCalls, []);
    reset(); projectsDeleteFails = true; r = await call('DELETE', '/api/auth/account', {}, 'tok-owner'); await r.text();
    assert.equal(r.status, 500); assert.deepEqual(proxyCalls, []);
    reset(); proxyFails = true; r = await call('DELETE', '/api/auth/account', {}, 'tok-owner'); await r.text();
    assert.equal(r.status, 200);
});

test('disableSiteApps: idempotent, skips duplicates, never throws, ignores an unconfigured proxy', async () => {
    reset(); const quiet = () => {};
    assert.deepEqual(await disableSiteApps(proxy, ['my-app', 'my-app', 'preview-abc123'], { log: quiet }), { disabled: ['my-app', 'preview-abc123'], failed: [] });
    assert.deepEqual(await disableSiteApps(proxy, ['my-app'], { log: quiet }), { disabled: ['my-app'], failed: [] });
    proxyFails = true;
    assert.deepEqual(await disableSiteApps(proxy, ['my-app'], { log: quiet }), { disabled: [], failed: ['my-app'] });
    proxy.setEnabled = async () => { throw Object.assign(new Error('x'), { code: 'unknown_app' }); };
    assert.deepEqual(await disableSiteApps(proxy, ['my-app'], { log: quiet }), { disabled: ['my-app'], failed: [] });
    assert.deepEqual(await disableSiteApps({ configured: false }, ['my-app'], { log: quiet }), { disabled: [], failed: ['my-app'] });
    assert.deepEqual(await disableSiteApps(proxy, [], { log: quiet }), { disabled: [], failed: [] });
});
