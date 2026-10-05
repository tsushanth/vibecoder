import test from 'node:test';
import assert from 'node:assert/strict';
import { registerDeployedApp } from '../../services/appRegistry.js';
import { ProxyAdminError } from '../../services/proxyAdmin.js';
import { zip, file } from '../helpers/zip.mjs';

const PID = 'abcdef12-3456-7890-abcd-ef1234567890';
const M = { connectors: { stocks: { host: 'api.example.com', paths: ['/v1/*'], methods: ['GET'], secret: { name: 'STOCKS_API_KEY', in: 'query', field: 'apikey' } } } };
const withManifest = zip([file('index.html', '<html></html>'), file('vibe.manifest.json', M)]);
const withoutManifest = zip([file('index.html', '<html></html>')]);
const emptyManifest = zip([file('index.html', 'x'), file('vibe.manifest.json', { connectors: {} })]);

const fake = (fail = {}) => {
    const calls = [];
    const rec = (name) => async (...a) => { calls.push([name, ...a]); if (fail[name]) throw fail[name]; return name === 'copySecrets' ? { copied: 1 } : null; };
    return { configured: true, calls, ensureApp: rec('ensure'), setEnabled: rec('enabled'), setManifest: rec('manifest'), copySecrets: rec('copy') };
};
const logs = () => { const l = []; return { l, log: (...a) => l.push(a.join(' ')) }; };
const reg = (p, sub, src, log = logs().log) => registerDeployedApp(p, sub, log, src);

test('with a manifest: the project-id app holds it (never enabled), the subdomain gets it and the project keys, then the subdomain is enabled', async () => {
    const p = fake();
    assert.equal(await reg(p, 'my-app', { projectId: PID, bundle: withManifest }), true);
    assert.deepEqual(p.calls, [
        ['ensure', 'my-app'], ['ensure', PID], ['enabled', PID, false],
        ['manifest', PID, M], ['manifest', 'my-app', M],
        ['copy', 'my-app', PID, { replace: true }],
        ['enabled', 'my-app', true],
    ]);
});

test('a bundle without a manifest (or an empty one) clears the manifest of existing apps and creates nothing new', async () => {
    for (const bundle of [withoutManifest, emptyManifest]) {
        const p = fake();
        assert.equal(await reg(p, 'my-app', { projectId: PID, bundle }), true);
        assert.deepEqual(p.calls, [['ensure', 'my-app'], ['manifest', 'my-app', null], ['manifest', PID, null], ['enabled', 'my-app', true]]);
    }
});

test('clearing the project-id app tolerates it not existing', async () => {
    const p = fake({ manifest: new ProxyAdminError(404, 'unknown_app') });
    const { l, log } = logs();
    assert.equal(await reg(p, 'my-app', { projectId: PID, bundle: withoutManifest }, log), true);
    assert.equal(p.calls.at(-1)[0], 'enabled'); assert.deepEqual(l, []);
});

test('an unreadable bundle leaves the registered manifest alone and behaves like before (ensure, enable)', async () => {
    for (const bundle of ['QUJD', '', undefined, null]) {
        const p = fake();
        assert.equal(await reg(p, 'my-app', { projectId: PID, bundle }), true);
        assert.deepEqual(p.calls, [['ensure', 'my-app'], ['enabled', 'my-app', true]], String(bundle));
    }
});

test('without projectId or bundle it is exactly the old behaviour', async () => {
    const p = fake();
    assert.equal(await registerDeployedApp(p, 'my-app', logs().log), true);
    assert.deepEqual(p.calls, [['ensure', 'my-app'], ['enabled', 'my-app', true]]);
    const q = fake(); await reg(q, 'my-app', { bundle: withManifest });
    assert.deepEqual(q.calls, [['ensure', 'my-app'], ['enabled', 'my-app', true]], 'a manifest cannot be registered without knowing the project');
});

test('a manifest the proxy rejects is logged by code only and the app is still enabled', async () => {
    const p = fake({ manifest: new ProxyAdminError(400, 'invalid_manifest') });
    const { l, log } = logs();
    assert.equal(await reg(p, 'my-app', { projectId: PID, bundle: withManifest }, log), true);
    assert.equal(p.calls.at(-1)[0], 'enabled');
    assert.ok(l.some((x) => /invalid_manifest/.test(x) && /my-app/.test(x)), JSON.stringify(l));
    assert.equal(l.join('\n').includes('api.example.com'), false, 'the manifest content is not logged');
});

test('a failure copying the keys is logged and does not stop the app being enabled', async () => {
    const p = fake({ copy: new ProxyAdminError(500, 'internal') });
    const { l, log } = logs();
    assert.equal(await reg(p, 'my-app', { projectId: PID, bundle: withManifest }, log), true);
    assert.equal(p.calls.at(-1)[0], 'enabled'); assert.ok(l.some((x) => /internal/.test(x)));
});

test('if the app cannot be ensured nothing else is attempted', async () => {
    const p = fake({ ensure: new ProxyAdminError(0, 'unreachable') });
    assert.equal(await reg(p, 'my-app', { projectId: PID, bundle: withManifest }), false);
    assert.deepEqual(p.calls.map((c) => c[0]), ['ensure']);
});

test('a subdomain that looks like a project id is never registered (project ids are the platform\'s own app ids)', async () => {
    const p = fake();
    assert.equal(await reg(p, PID, { projectId: PID, bundle: withManifest }), false);
    assert.equal(await reg(p, '11111111-2222-3333-4444-555555555555', { projectId: PID, bundle: withManifest }), false);
    assert.deepEqual(p.calls, []);
});

test('an invalid project id is ignored rather than sent to the proxy', async () => {
    for (const projectId of ['../x', 'UPPER', '', 42, 'a b']) {
        const p = fake(); await reg(p, 'my-app', { projectId, bundle: withManifest });
        assert.deepEqual(p.calls, [['ensure', 'my-app'], ['enabled', 'my-app', true]], String(projectId));
    }
});
