import test from 'node:test';
import assert from 'node:assert/strict';
import { captureChatSecrets, redactForLog } from '../../services/chatSecrets.js';
import { ProxyAdminError } from '../../services/proxyAdmin.js';

const j = (...p) => p.join('');
const GOOGLE = j('AIza', 'SyA1234567890abcdefghijklmnopqrstuv');
const STRIPE = j('sk_', 'live_abcdefghijklmnopqrstuv1234');
const APP = 'abcdef12-3456-7890-abcd-ef1234567890';

const rig = ({ configured = true, ensureErr, listErr, setErr, existing = [] } = {}) => {
    const calls = [];
    const logs = [];
    const proxyAdmin = {
        configured,
        ensureApp: async (a) => { calls.push(['ensure', a]); if (ensureErr) throw ensureErr; },
        listSecrets: async (a) => { calls.push(['list', a]); if (listErr) throw listErr; return existing.map((name) => ({ name, updatedAt: 't' })); },
        setSecret: async (a, n, v) => { calls.push(['set', a, n, v]); if (setErr) throw setErr; },
    };
    return { proxyAdmin, calls, logs, log: (...a) => logs.push(a.join(' ')) };
};

test('a pasted key is stored under the project and the returned text is the redacted one', async () => {
    const r = rig();
    const out = await captureChatSecrets({ text: `build a map app, my key is ${GOOGLE}`, appId: APP, proxyAdmin: r.proxyAdmin, log: r.log });
    assert.equal(out.text, 'build a map app, my key is [SECRET:GOOGLE_API_KEY]');
    assert.deepEqual(out.stored, ['GOOGLE_API_KEY']);
    assert.deepEqual(out.failed, []);
    assert.deepEqual(r.calls.find((c) => c[0] === 'set'), ['set', APP, 'GOOGLE_API_KEY', GOOGLE]);
});

test('the project is registered with the proxy (ensureApp) before any secret is set', async () => {
    const r = rig();
    await captureChatSecrets({ text: `k ${GOOGLE} and ${STRIPE}`, appId: APP, proxyAdmin: r.proxyAdmin, log: r.log });
    const kinds = r.calls.map((c) => c[0]);
    assert.equal(kinds[0], 'ensure');
    assert.ok(kinds.indexOf('ensure') < kinds.indexOf('set'));
    assert.equal(kinds.filter((k) => k === 'set').length, 2);
});

test('existing vault names are respected so a new key never overwrites a different one', async () => {
    const r = rig({ existing: ['GOOGLE_API_KEY'] });
    const out = await captureChatSecrets({ text: `k ${GOOGLE}`, appId: APP, proxyAdmin: r.proxyAdmin, log: r.log });
    assert.equal(out.text, 'k [SECRET:GOOGLE_API_KEY_2]');
    assert.deepEqual(r.calls.find((c) => c[0] === 'set').slice(1, 3), [APP, 'GOOGLE_API_KEY_2']);
});

test('text without credentials makes no proxy calls and comes back unchanged', async () => {
    const r = rig();
    const out = await captureChatSecrets({ text: 'a simple tip calculator', appId: APP, proxyAdmin: r.proxyAdmin, log: r.log });
    assert.deepEqual(out, { text: 'a simple tip calculator', stored: [], failed: [] });
    assert.deepEqual(r.calls, []);
});

test('proxy unconfigured: nothing is stored, the text is still redacted, names are reported failed', async () => {
    const r = rig({ configured: false });
    r.proxyAdmin.ensureApp = async () => { throw new ProxyAdminError(0, 'not_configured'); };
    const out = await captureChatSecrets({ text: `k ${GOOGLE}`, appId: APP, proxyAdmin: r.proxyAdmin, log: r.log });
    assert.equal(out.text.includes(GOOGLE), false);
    assert.equal(out.text, 'k [SECRET:GOOGLE_API_KEY]');
    assert.deepEqual(out.failed, ['GOOGLE_API_KEY']);
    assert.equal(r.calls.some((c) => c[0] === 'set'), false);
});

test('no proxyAdmin object at all (undefined) still redacts and never throws', async () => {
    const out = await captureChatSecrets({ text: `k ${GOOGLE}`, appId: APP, proxyAdmin: undefined, log: () => {} });
    assert.equal(out.text, 'k [SECRET:GOOGLE_API_KEY]');
    assert.deepEqual(out.failed, ['GOOGLE_API_KEY']);
});

test('proxy down (ensureApp fails): nothing is stored, text redacted, no secret value in any log line', async () => {
    const r = rig({ ensureErr: new ProxyAdminError(0, 'unreachable') });
    const out = await captureChatSecrets({ text: `k ${GOOGLE}`, appId: APP, proxyAdmin: r.proxyAdmin, log: r.log });
    assert.equal(out.text, 'k [SECRET:GOOGLE_API_KEY]');
    assert.deepEqual(out.failed, ['GOOGLE_API_KEY']);
    assert.equal(r.calls.some((c) => c[0] === 'set'), false);
    assert.equal(r.logs.join('\n').includes(GOOGLE), false);
});

test('setSecret failing with an error that echoes the value: text redacted, result and logs never carry the value', async () => {
    const r = rig({ setErr: new Error(`rejected ${GOOGLE}`) });
    const out = await captureChatSecrets({ text: `k ${GOOGLE}`, appId: APP, proxyAdmin: r.proxyAdmin, log: r.log });
    assert.deepEqual(out.failed, ['GOOGLE_API_KEY']);
    assert.equal(JSON.stringify(out).includes(GOOGLE), false);
    assert.equal(r.logs.join('\n').includes(GOOGLE), false);
});

test('a successful capture is logged by name only, never with the value', async () => {
    const r = rig();
    await captureChatSecrets({ text: `k ${GOOGLE}`, appId: APP, proxyAdmin: r.proxyAdmin, log: r.log });
    assert.ok(r.logs.length >= 1);
    assert.equal(r.logs.join('\n').includes(GOOGLE), false);
});

test('non-string input yields an empty string and no calls', async () => {
    const r = rig();
    const out = await captureChatSecrets({ text: undefined, appId: APP, proxyAdmin: r.proxyAdmin, log: r.log });
    assert.equal(out.text, '');
    assert.deepEqual(r.calls, []);
});

test('redactForLog removes keys without any network or storage', () => {
    assert.equal(redactForLog(`use ${STRIPE} please`), 'use [SECRET:STRIPE_SECRET_KEY] please');
    assert.equal(redactForLog(undefined), '');
});
