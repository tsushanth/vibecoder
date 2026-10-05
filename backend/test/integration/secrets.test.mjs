import '../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
import { ProxyAdminError } from '../../services/proxyAdmin.js';
const { supabase } = await import('../../config/database.js');
const { createSecretsRouter } = await import('../../routes/secrets.routes.js');

const PID = '11111111-2222-3333-4444-555555555555';
const SECRET = 'RouteSecretValue1234567890';
const ERR_PID = 'eeeeeeee-2222-3333-4444-555555555555';
const projects = { [PID]: { id: PID, creator_id: 'owner-1' }, [ERR_PID]: { id: ERR_PID, creator_id: 'owner-1' } };
let lookups = 0;
stubSupabase(supabase, (q) => {
    if (q.table !== 'projects') return { data: null, error: null };
    lookups++;
    const row = projects[eqOf(q, 'id')];
    if (eqOf(q, 'id') === ERR_PID) return { data: row, error: { message: 'partial failure' } };
    return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } };
});

const tokens = { 'tok-owner': 'owner-1', 'tok-other': 'other-2' };
const verifyUser = async (req) => tokens[(req.headers.authorization || '').replace('Bearer ', '')] || null;
const calls = []; let proxyBehavior = {};
const proxyAdmin = {
    configured: true,
    async setSecret(app, name, value) { calls.push(['set', app, name, value]); if (proxyBehavior.set) return proxyBehavior.set(calls.filter((c) => c[0] === 'set').length); return null; },
    async listSecrets(app) { calls.push(['list', app]); if (proxyBehavior.list) return proxyBehavior.list(); return [{ name: 'API_KEY', updatedAt: 't1' }]; },
    async deleteSecret(app, name) { calls.push(['delete', app, name]); if (proxyBehavior.del) return proxyBehavior.del(); return null; },
    async registerApp(app, o) { calls.push(['register', app, o]); return null; },
};
const logs = [];
let srv;
before(async () => {
    const app = express();
    app.use('/api/projects/:id/secrets', createSecretsRouter({ supabase, verifyUser, proxyAdmin, log: (...a) => logs.push(a.join(' ')) }));
    srv = await listen(app);
});
after(() => srv.close());
const reset = () => { calls.length = 0; proxyBehavior = {}; logs.length = 0; lookups = 0; };
const call = (method, path, { token = 'tok-owner', body, headers = {} } = {}) => fetch(`${srv.base}/api/projects/${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });

test('no token and an unknown token are 401 and nothing reaches the proxy', async () => {
    reset();
    assert.equal((await call('PUT', `${PID}/secrets/API_KEY`, { token: null, body: { value: SECRET } })).status, 401);
    assert.equal((await call('GET', `${PID}/secrets`, { token: 'tok-bogus' })).status, 401);
    assert.equal(calls.length, 0);
});

test('a verified user who is not the project creator is 403, even when the body claims to be the creator', async () => {
    reset();
    const r = await call('PUT', `${PID}/secrets/API_KEY`, { token: 'tok-other', body: { value: SECRET, userId: 'owner-1', creator_id: 'owner-1' } });
    assert.equal(r.status, 403); assert.equal(calls.length, 0);
    assert.equal((await call('GET', `${PID}/secrets`, { token: 'tok-other' })).status, 403);
    assert.equal((await call('DELETE', `${PID}/secrets/API_KEY`, { token: 'tok-other' })).status, 403);
});

test('an unknown project is 404 and a malformed project id is 404 without a database lookup', async () => {
    reset();
    assert.equal((await call('GET', `99999999-2222-3333-4444-555555555555/secrets`)).status, 404);
    assert.equal(lookups, 1);
    assert.equal((await call('GET', `bad%20id%2F..%2Fx/secrets`)).status, 404);
    assert.equal(lookups, 1, 'a malformed id must not reach the database');
    assert.equal(calls.length, 0);
    assert.equal((await call('GET', `${ERR_PID}/secrets`)).status, 404, 'a lookup that reports an error is not trusted even if it returned a row');
});

test('the owner can PUT a secret: 204, no body, and the proxy gets the project id, name and value', async () => {
    reset();
    const r = await call('PUT', `${PID}/secrets/API_KEY`, { body: { value: SECRET } });
    assert.equal(r.status, 204); assert.equal(await r.text(), '');
    assert.deepEqual(calls, [['set', PID, 'API_KEY', SECRET]]);
    assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('PUT validates the name and the value before calling the proxy', async () => {
    reset();
    assert.equal((await call('PUT', `${PID}/secrets/lower_case`, { body: { value: SECRET } })).status, 400);
    assert.equal((await call('PUT', `${PID}/secrets/API_KEY`, { body: { value: '' } })).status, 400);
    assert.equal((await call('PUT', `${PID}/secrets/API_KEY`, { body: { value: 'x'.repeat(5000) } })).status, 400);
    assert.equal((await call('PUT', `${PID}/secrets/API_KEY`, { body: { value: 123 } })).status, 400);
    assert.equal((await call('PUT', `${PID}/secrets/API_KEY`, { body: '{nope' })).status, 400);
    assert.equal(calls.length, 0);
});

test('an oversized body is 413 and never reaches the proxy', async () => {
    reset();
    assert.equal((await call('PUT', `${PID}/secrets/API_KEY`, { body: JSON.stringify({ value: 'a'.repeat(40000) }) })).status, 413);
    assert.equal(calls.length, 0);
});

test('if the proxy does not know the app yet it is registered once with an empty manifest and the secret is retried', async () => {
    reset();
    proxyBehavior.set = (n) => { if (n === 1) throw new ProxyAdminError(404, 'unknown_app'); return null; };
    const r = await call('PUT', `${PID}/secrets/API_KEY`, { body: { value: SECRET } });
    assert.equal(r.status, 204);
    assert.deepEqual(calls.map((c) => c[0]), ['set', 'register', 'set']);
    assert.deepEqual(calls[1], ['register', PID, { manifest: null, domains: [], enabled: true }]);
});

test('if it is still unknown after registering, or the proxy is down, the answer is a generic 502 that never contains the value', async () => {
    reset();
    proxyBehavior.set = () => { throw new ProxyAdminError(404, 'unknown_app'); };
    const a = await call('PUT', `${PID}/secrets/API_KEY`, { body: { value: SECRET } }); const at = await a.text();
    assert.equal(a.status, 502); assert.equal(at.includes(SECRET), false);
    reset(); proxyBehavior.set = () => { throw new ProxyAdminError(0, 'unreachable'); };
    const b = await call('PUT', `${PID}/secrets/API_KEY`, { body: { value: SECRET } });
    assert.equal(b.status, 502); assert.equal((await b.text()).includes(SECRET), false);
    assert.deepEqual(calls.map((c) => c[0]), ['set'], 'only an unknown_app error triggers registration');
    reset(); proxyBehavior.set = () => { throw new ProxyAdminError(500, 'internal'); };
    const c = await call('PUT', `${PID}/secrets/API_KEY`, { body: { value: SECRET } });
    assert.deepEqual(await c.json(), { error: 'secret_store_unavailable' });
});

test('GET lists names only and an app the proxy has never seen is an empty list', async () => {
    reset();
    const r = await call('GET', `${PID}/secrets`);
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { secrets: [{ name: 'API_KEY', updatedAt: 't1' }] });
    reset(); proxyBehavior.list = () => { throw new ProxyAdminError(404, 'unknown_app'); };
    assert.deepEqual(await (await call('GET', `${PID}/secrets`)).json(), { secrets: [] });
});

test('DELETE removes a secret, is idempotent for an unknown app, and validates the name', async () => {
    reset();
    assert.equal((await call('DELETE', `${PID}/secrets/API_KEY`)).status, 204); assert.deepEqual(calls, [['delete', PID, 'API_KEY']]);
    reset(); proxyBehavior.del = () => { throw new ProxyAdminError(404, 'unknown_app'); };
    assert.equal((await call('DELETE', `${PID}/secrets/API_KEY`)).status, 204);
    assert.equal((await call('DELETE', `${PID}/secrets/bad%20name`)).status, 400);
    reset(); proxyBehavior.del = () => { throw new ProxyAdminError(0, 'unreachable'); };
    assert.equal((await call('DELETE', `${PID}/secrets/API_KEY`)).status, 502);
});

test('there is no route that reads a secret value back', async () => {
    reset();
    for (const m of ['GET', 'POST', 'PATCH']) { const r = await call(m, `${PID}/secrets/API_KEY`, { body: m === 'GET' ? undefined : {} }); assert.ok([404, 405].includes(r.status), m); assert.equal((await r.text()).includes(SECRET), false); }
});

test('when the proxy is not configured every route is 503 after authentication', async () => {
    const app = express();
    app.use('/api/projects/:id/secrets', createSecretsRouter({ supabase, verifyUser, proxyAdmin: { ...proxyAdmin, configured: false }, log: () => {} }));
    const s = await listen(app);
    try {
        const ok = await fetch(`${s.base}/api/projects/${PID}/secrets`, { headers: { authorization: 'Bearer tok-owner' } });
        assert.equal(ok.status, 503);
        const anon = await fetch(`${s.base}/api/projects/${PID}/secrets`);
        assert.equal(anon.status, 401);
    } finally { await s.close(); }
});

test('logs and error bodies never contain a secret value', async () => {
    reset();
    await call('PUT', `${PID}/secrets/API_KEY`, { body: { value: SECRET } });
    assert.ok(logs.some((l) => /set project=/.test(l)), 'a successful set is logged');
    assert.equal(logs.join('\n').includes(SECRET), false);
    reset();
    proxyBehavior.set = () => { throw new ProxyAdminError(500, 'internal'); };
    const r = await call('PUT', `${PID}/secrets/API_KEY`, { body: { value: SECRET } });
    assert.equal((await r.text()).includes(SECRET), false);
    assert.equal(logs.join('\n').includes(SECRET), false);
});

test('repeated requests from one address are rate limited', async () => {
    reset();
    const app = express();
    app.set('trust proxy', true);
    app.use('/api/projects/:id/secrets', createSecretsRouter({ supabase, verifyUser, proxyAdmin, log: () => {}, maxPerMinute: 5 }));
    const s = await listen(app);
    try {
        const codes = [];
        for (let i = 0; i < 7; i++) codes.push((await fetch(`${s.base}/api/projects/${PID}/secrets`, { headers: { authorization: 'Bearer tok-owner', 'x-forwarded-for': '8.8.4.4' } })).status);
        assert.deepEqual(codes.slice(0, 5), [200, 200, 200, 200, 200]); assert.equal(codes[6], 429);
    } finally { await s.close(); }
});
