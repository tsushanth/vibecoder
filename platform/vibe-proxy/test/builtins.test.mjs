import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_CONNECTORS, resolveManifest } from '../builtins.js';
import { validateManifest } from '../manifest.js';
import { handleProxy } from '../proxy.js';

const resolve = async () => ['93.184.216.34'];

test('every built-in connector is a valid manifest entry', () => {
    assert.deepEqual(validateManifest({ connectors: BUILTIN_CONNECTORS }, { allowHeaders: true }), { ok: true, problems: [] });
});

test('every built-in carries its terms: https url, review date, and commercial use confirmed', () => {
    for (const [name, c] of Object.entries(BUILTIN_CONNECTORS)) {
        assert.match(c.terms?.url || '', /^https:\/\//, name);
        assert.match(c.terms?.reviewedOn || '', /^\d{4}-\d{2}-\d{2}$/, name);
        assert.equal(c.terms?.commercialUse, true, `${name} must be confirmed for commercial use`);
    }
});

test('the NWS weather connector is present, read-only, and sends a unique user agent', () => {
    const nws = BUILTIN_CONNECTORS.nws;
    assert.equal(nws.host, 'api.weather.gov');
    assert.deepEqual(nws.methods, ['GET']);
    assert.match(nws.headers['user-agent'], /VibeBuild/);
});

test('no built-in needs a secret from the app', () => {
    for (const c of Object.values(BUILTIN_CONNECTORS)) assert.equal(c.secret, undefined);
});

test('resolveManifest adds built-ins to an app manifest', () => {
    const app = { connectors: { mine: { host: 'api.example.com', paths: ['/x'], methods: ['GET'] } } };
    const r = resolveManifest(app);
    assert.ok(r.connectors.mine && r.connectors.nws);
});

test('resolveManifest works for an app with no manifest', () => {
    assert.ok(resolveManifest(undefined).connectors.nws);
});

test('an app cannot redefine a built-in name', () => {
    const app = { connectors: { nws: { host: 'evil.example.com', paths: ['/x'], methods: ['GET'] } } };
    assert.throws(() => resolveManifest(app), /reserved/i);
    assert.equal(resolveManifest({ connectors: {} }).connectors.nws.host, 'api.weather.gov');
});

test('an app-declared connector may not set fixed headers', () => {
    const m = { connectors: { mine: { host: 'api.example.com', paths: ['/x'], methods: ['GET'], headers: { 'x-evil': '1' } } } };
    const r = validateManifest(m);
    assert.equal(r.ok, false);
    assert.match(r.problems.join(' '), /headers/i);
});

test('the proxy sends a built-in connector fixed headers and the caller cannot override them', async () => {
    let seen;
    const fetchImpl = async (url, init) => { seen = new Headers(init.headers); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
    const manifest = resolveManifest({ connectors: {} });
    const r = await handleProxy({ req: { connector: 'nws', method: 'GET', path: '/points/39.7456,-97.0892', headers: { 'user-agent': 'attacker' } }, manifest, secrets: {}, fetchImpl, resolve });
    assert.equal(r.status, 200);
    assert.match(seen.get('user-agent'), /VibeBuild/);
});

test('the proxy refuses an NWS path outside the allowlist', async () => {
    const manifest = resolveManifest({ connectors: {} });
    const r = await handleProxy({ req: { connector: 'nws', method: 'GET', path: '/products/types' }, manifest, secrets: {}, fetchImpl: async () => { throw new Error('should not be called'); }, resolve });
    assert.equal(r.status, 403);
});
