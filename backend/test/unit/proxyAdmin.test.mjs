import test from 'node:test';
import assert from 'node:assert/strict';
import { createProxyAdmin, ProxyAdminError } from '../../services/proxyAdmin.js';

const TOKEN = 'admin-token-' + 'x'.repeat(40);
const SECRET_VALUE = 'SecretValueThatMustNeverLeak123456';
const rig = (reply) => {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined }); return typeof reply === 'function' ? reply(url, init) : reply; };
    return { calls, admin: createProxyAdmin({ baseUrl: 'https://proxy.test', token: TOKEN, fetchImpl, timeoutMs: 200 }) };
};
const res = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('setSecret sends PUT with bearer token and a JSON value, and resolves on 204', async () => {
    const { admin, calls } = rig(res(204));
    await admin.setSecret('proj-1', 'API_KEY', SECRET_VALUE);
    assert.equal(calls[0].url, 'https://proxy.test/admin/apps/proj-1/secrets/API_KEY'); assert.equal(calls[0].init.method, 'PUT');
    assert.equal(new Headers(calls[0].init.headers).get('authorization'), `Bearer ${TOKEN}`);
    assert.deepEqual(calls[0].body, { value: SECRET_VALUE });
});

test('listSecrets returns the names and update times', async () => {
    const { admin } = rig(res(200, { secrets: [{ name: 'A_KEY', updatedAt: 't1' }] }));
    assert.deepEqual(await admin.listSecrets('proj-1'), [{ name: 'A_KEY', updatedAt: 't1' }]);
});

test('deleteSecret sends DELETE and registerApp sends PUT with the manifest, domains and enabled flag', async () => {
    const a = rig(res(204)); await a.admin.deleteSecret('proj-1', 'API_KEY');
    assert.equal(a.calls[0].init.method, 'DELETE'); assert.equal(a.calls[0].url, 'https://proxy.test/admin/apps/proj-1/secrets/API_KEY');
    const b = rig(res(204)); await b.admin.registerApp('proj-1', { manifest: { connectors: {} }, domains: ['x.example.com'], enabled: true });
    assert.equal(b.calls[0].url, 'https://proxy.test/admin/apps/proj-1'); assert.deepEqual(b.calls[0].body, { manifest: { connectors: {} }, domains: ['x.example.com'], enabled: true });
});

test('path parts are URL-encoded so an id cannot reach another route', async () => {
    const { admin, calls } = rig(res(204));
    await admin.setSecret('a/../b', 'API_KEY', 'v'.repeat(10));
    assert.ok(!calls[0].url.includes('/../')); assert.ok(calls[0].url.includes('a%2F..%2Fb'));
});

test('a non-2xx response throws ProxyAdminError with status and the proxy error code, with a generic message', async () => {
    const { admin } = rig(res(404, { error: 'unknown_app' }));
    await assert.rejects(() => admin.setSecret('p', 'API_KEY', SECRET_VALUE), (e) => e instanceof ProxyAdminError && e.status === 404 && e.code === 'unknown_app' && !e.message.includes(SECRET_VALUE) && !e.message.includes(TOKEN));
});

test('a network failure is status 0 code unreachable, and a slow proxy is code timeout', async () => {
    const down = createProxyAdmin({ baseUrl: 'https://proxy.test', token: TOKEN, fetchImpl: async () => { throw new TypeError(`connect failed ${TOKEN}`); }, timeoutMs: 200 });
    await assert.rejects(() => down.listSecrets('p'), (e) => e.status === 0 && e.code === 'unreachable' && !e.message.includes(TOKEN));
    const slow = createProxyAdmin({ baseUrl: 'https://proxy.test', token: TOKEN, timeoutMs: 40, fetchImpl: (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))) });
    await assert.rejects(() => slow.listSecrets('p'), (e) => e.code === 'timeout');
});

test('an unconfigured client reports configured false and every call fails with not_configured without any request', async () => {
    let calls = 0; const a = createProxyAdmin({ baseUrl: '', token: '', fetchImpl: async () => { calls++; return res(204); } });
    assert.equal(a.configured, false);
    await assert.rejects(() => a.setSecret('p', 'API_KEY', 'v'.repeat(10)), (e) => e.code === 'not_configured');
    assert.equal(calls, 0);
    assert.equal(createProxyAdmin({ baseUrl: 'https://p.test', token: 'short', fetchImpl: async () => res(204) }).configured, false);
});

test('redirects are not followed and the base URL must be https', async () => {
    const { admin, calls } = rig(res(204)); await admin.listSecrets('p');
    assert.equal(calls[0].init.redirect, 'manual');
    assert.equal(createProxyAdmin({ baseUrl: 'http://proxy.test', token: TOKEN, fetchImpl: async () => res(204) }).configured, false);
});

test('the client never exposes the token or a way to read a secret value', () => {
    const { admin } = rig(res(204));
    assert.equal(JSON.stringify(admin).includes(TOKEN), false);
    assert.deepEqual(Object.keys(admin).sort(), ['configured', 'deleteSecret', 'ensureApp', 'listSecrets', 'registerApp', 'setEnabled', 'setSecret']);
});

test('ensureApp posts to the ensure endpoint with no body, and setEnabled posts the flag', async () => {
    const a = rig(res(204)); await a.admin.ensureApp('my-app');
    assert.equal(a.calls[0].url, 'https://proxy.test/admin/apps/my-app/ensure'); assert.equal(a.calls[0].init.method, 'POST'); assert.equal(a.calls[0].init.body, undefined);
    const b = rig(res(204)); await b.admin.setEnabled('my-app', false);
    assert.equal(b.calls[0].url, 'https://proxy.test/admin/apps/my-app/enabled'); assert.equal(b.calls[0].init.method, 'POST'); assert.deepEqual(b.calls[0].body, { enabled: false });
    assert.equal(new Headers(b.calls[0].init.headers).get('authorization'), `Bearer ${TOKEN}`);
});

test('ensureApp and setEnabled encode the app id and report errors like the other calls', async () => {
    const a = rig(res(204)); await a.admin.ensureApp('a/../b'); assert.ok(a.calls[0].url.includes('a%2F..%2Fb'));
    const b = rig(res(404, { error: 'unknown_app' }));
    await assert.rejects(() => b.admin.setEnabled('x', true), (e) => e instanceof ProxyAdminError && e.status === 404 && e.code === 'unknown_app');
    const c = createProxyAdmin({ baseUrl: '', token: '' });
    await assert.rejects(() => c.ensureApp('x'), (e) => e.code === 'not_configured');
    await assert.rejects(() => c.setEnabled('x', true), (e) => e.code === 'not_configured');
});
