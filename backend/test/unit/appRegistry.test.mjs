import test from 'node:test';
import assert from 'node:assert/strict';
import { registerDeployedApp, disableDeployedApp, syncCustomDomain } from '../../services/appRegistry.js';
import { ProxyAdminError } from '../../services/proxyAdmin.js';

const fake = (over = {}) => { const calls = []; return { configured: true, calls, ensureApp: async (a) => { calls.push(['ensure', a]); if (over.ensure) throw over.ensure; }, setEnabled: async (a, e) => { calls.push(['enabled', a, e]); if (over.enabled) throw over.enabled; }, setDomains: async (a, d) => { calls.push(['domains', a, d]); if (over.domains) throw over.domains; } }; };
const logs = () => { const l = []; return { l, log: (...a) => l.push(a.join(' ')) }; };

test('registering ensures the app exists and then enables it, in that order', async () => {
    const p = fake(); assert.equal(await registerDeployedApp(p, 'my-app', logs().log), true);
    assert.deepEqual(p.calls, [['ensure', 'my-app'], ['enabled', 'my-app', true]]);
});

test('a proxy failure never throws: it returns false and logs only the app and the error code', async () => {
    const { l, log } = logs();
    const p = fake({ ensure: new ProxyAdminError(0, 'unreachable') });
    assert.equal(await registerDeployedApp(p, 'my-app', log), false);
    assert.equal(l.length, 1); assert.match(l[0], /my-app/); assert.match(l[0], /unreachable/);
    assert.deepEqual(p.calls, [['ensure', 'my-app']], 'it does not go on to enable an app that could not be ensured');
});

test('an unconfigured or missing proxy client does nothing and returns false', async () => {
    const p = fake(); p.configured = false;
    assert.equal(await registerDeployedApp(p, 'x-app', logs().log), false); assert.deepEqual(p.calls, []);
    assert.equal(await registerDeployedApp(undefined, 'x-app', logs().log), false);
    assert.equal(await disableDeployedApp(undefined, 'x-app', logs().log), false);
});

test('an invalid subdomain is never sent to the proxy', async () => {
    const p = fake();
    for (const bad of ['', 'UPPER', 'a', '../x', 'has space', undefined, 'x'.repeat(70)]) assert.equal(await registerDeployedApp(p, bad, logs().log), false, String(bad));
    assert.deepEqual(p.calls, []);
});

test('disabling switches the app off, treats an unknown app as already off, and never throws', async () => {
    const p = fake(); assert.equal(await disableDeployedApp(p, 'my-app', logs().log), true); assert.deepEqual(p.calls, [['enabled', 'my-app', false]]);
    assert.equal(await disableDeployedApp(fake({ enabled: new ProxyAdminError(404, 'unknown_app') }), 'my-app', logs().log), true);
    const { l, log } = logs(); assert.equal(await disableDeployedApp(fake({ enabled: new ProxyAdminError(500, 'internal') }), 'my-app', log), false); assert.match(l[0], /internal/);
});

test('an unconfigured client never receives a disable call either', async () => {
    const p = fake(); p.configured = false;
    assert.equal(await disableDeployedApp(p, 'my-app', logs().log), false); assert.deepEqual(p.calls, []);
});

test('log lines carry only the app and an error code, never an error message or stack', async () => {
    const { l, log } = logs();
    const leaky = Object.assign(new Error('connect failed with Bearer SECRET-TOKEN-123'), { code: undefined });
    await registerDeployedApp(fake({ ensure: leaky }), 'my-app', log);
    await disableDeployedApp(fake({ enabled: leaky }), 'my-app', log);
    assert.equal(l.length, 2); for (const line of l) { assert.equal(line.includes('SECRET-TOKEN-123'), false); assert.match(line, /code=error/); }
});

test('syncCustomDomain ensures the app and sets its single custom domain, or clears it', async () => {
    const p = fake(); assert.equal(await syncCustomDomain(p, { subdomain: 'my-app', domain: 'shop.example.com' }, logs().log), true);
    assert.deepEqual(p.calls, [['ensure', 'my-app'], ['domains', 'my-app', ['shop.example.com']]]);
    const q = fake(); assert.equal(await syncCustomDomain(q, { subdomain: 'my-app', domain: null }, logs().log), true);
    assert.deepEqual(q.calls, [['ensure', 'my-app'], ['domains', 'my-app', []]]);
});

test('syncCustomDomain never throws, logs only the app and a code, and ignores bad input or an unconfigured client', async () => {
    const { l, log } = logs();
    assert.equal(await syncCustomDomain(fake({ domains: new ProxyAdminError(0, 'unreachable') }), { subdomain: 'my-app', domain: 'a.example.com' }, log), false);
    assert.equal(l.length, 1); assert.match(l[0], /my-app/); assert.match(l[0], /unreachable/); assert.equal(l[0].includes('a.example.com'), false);
    const p = fake(); p.configured = false;
    assert.equal(await syncCustomDomain(p, { subdomain: 'my-app', domain: 'a.example.com' }, logs().log), false); assert.deepEqual(p.calls, []);
    const r = fake();
    assert.equal(await syncCustomDomain(r, { subdomain: '../x', domain: 'a.example.com' }, logs().log), false);
    assert.equal(await syncCustomDomain(r, { subdomain: 'my-app', domain: 42 }, logs().log), false);
    assert.equal(await syncCustomDomain(undefined, { subdomain: 'my-app', domain: null }, logs().log), false);
    assert.deepEqual(r.calls, []);
});
