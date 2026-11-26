import '../helpers/env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActivityRecorder } from '../../lib/activity.js';
import { buildRow } from '../../lib/appEvents.js';

const ID = '11111111-2222-3333-4444-555555555555';
const jwt = (sub, n = 'a') => `Bearer h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.sig${n}`;
const req = ({ auth = jwt(ID), path = '/api/projects/my', method = 'GET', headers = {} } = {}) => ({ method, path, headers: { ...(auth && { authorization: auth }), 'x-platform': 'android', 'x-app-version': '2.7.5', ...headers } });

function setup({ verified = ID, result = { ok: true } } = {}) {
    let t = Date.parse('2026-12-01T10:00:00Z');
    const rows = []; const lookups = [];
    const r = createActivityRecorder({ verify: async () => { lookups.push(1); return verified; }, record: async (event, o) => { rows.push([event, o]); return result; }, now: () => t });
    return { r, rows, lookups, at: (iso) => { t = Date.parse(iso); } };
}

test('one app_open per signed-in person per UTC day, with platform and app version', async () => {
    const s = setup();
    await s.r.note(req()); await s.r.note(req()); await s.r.note(req({ auth: jwt(ID, 'refreshed') }));
    assert.deepEqual(s.rows, [['app_open', { userId: ID, props: { source: 'android', app_version: '2.7.5' } }]]);
    assert.equal(s.lookups.length, 1);
    s.at('2026-12-02T00:00:01Z');
    await s.r.note(req());
    assert.equal(s.rows.length, 2);
    assert.deepEqual(buildRow({ event: 'app_open', userId: ID, props: s.rows[0][1].props }).props, { source: 'android', app_version: '2.7.5' });
});

test('nothing is written for an unverified or forged token, and it is not looked up again at once', async () => {
    const s = setup({ verified: null });
    await s.r.note(req()); await s.r.note(req());
    assert.equal(s.rows.length, 0);
    assert.equal(s.lookups.length, 1);
    s.at('2026-12-01T10:06:00Z');
    await s.r.note(req());
    assert.equal(s.lookups.length, 2);
});

test('polls, webhooks, token uploads, account deletion and anonymous requests are not an open', async () => {
    const s = setup();
    for (const path of ['/api/status', '/api/health/deep', '/api/webhooks/revenuecat', '/api/auth/push-token', '/api/auth/account', '/api/appdata/x', '/api/projects/abc/build-complete']) await s.r.note(req({ path }));
    await s.r.note(req({ method: 'OPTIONS' }));
    await s.r.note(req({ auth: null }));
    await s.r.note(req({ auth: 'Bearer a-webhook-secret' }));
    await s.r.note(req({ auth: jwt('not-a-user-id') }));
    assert.equal(s.lookups.length, 0);
    assert.equal(s.rows.length, 0);
});

test('a failed write is tried again; a row that already exists counts as done; the middleware never waits', async () => {
    const failing = setup({ result: { ok: false, reason: 'error' } });
    await failing.r.note(req()); await failing.r.note(req());
    assert.equal(failing.rows.length, 2);
    const dup = setup({ result: { ok: false, reason: 'duplicate' } });
    await dup.r.note(req()); await dup.r.note(req());
    assert.equal(dup.rows.length, 1);
    const never = createActivityRecorder({ verify: () => new Promise(() => {}), record: async () => ({ ok: true }) });
    let passed = false;
    never.middleware(req(), {}, () => { passed = true; });
    assert.equal(passed, true);
    const throwing = createActivityRecorder({ verify: async () => { throw new Error('auth down'); } });
    await throwing.note(req());
});
