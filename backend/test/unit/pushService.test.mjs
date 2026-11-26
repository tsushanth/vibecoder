import '../helpers/env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createFcmSender, createPushSender, parseServiceAccount } from '../../services/pushService.js';
import { buildRow } from '../../lib/appEvents.js';
import { makeBuilder } from '../helpers/supabaseStub.mjs';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const ACCOUNT = { client_email: 'sender@example.iam.gserviceaccount.com', private_key: privateKey };

test('the service account is read from one-line or pretty-printed JSON; anything else is "not configured"', () => {
    assert.equal(parseServiceAccount(JSON.stringify(ACCOUNT)).client_email, ACCOUNT.client_email);
    assert.equal(parseServiceAccount(JSON.stringify(ACCOUNT, null, 2)).private_key, privateKey);
    const literalNewlines = JSON.stringify(ACCOUNT).replace(/\\n/g, '\n');
    assert.equal(parseServiceAccount(literalNewlines).client_email, ACCOUNT.client_email);
    for (const bad of [undefined, '', 'nope', '{}', '[1]']) assert.equal(parseServiceAccount(bad), null);
});

function fcm({ send = { ok: true, status: 200 }, token = { ok: true } } = {}) {
    const calls = [];
    const fetchFn = async (url, init) => {
        calls.push([url, init]);
        if (url.includes('oauth2')) return { ok: token.ok, status: 200, json: async () => ({ access_token: 'at', expires_in: 3600 }) };
        return { ok: send.ok, status: send.status, text: async () => send.body || '' };
    };
    return { calls, sendFcm: createFcmSender({ serviceAccount: ACCOUNT, projectId: 'p', fetchFn }) };
}

test('a notice carries the project id, the app channel and a per-project tag', async () => {
    const f = fcm();
    assert.deepEqual(await f.sendFcm('device', 'T', 'B', { projectId: 'p1', kind: 'build_ready', empty: undefined }), { outcome: 'sent', status: 200 });
    const message = JSON.parse(f.calls[1][1].body).message;
    assert.deepEqual(message.data, { projectId: 'p1', kind: 'build_ready' });
    assert.deepEqual(message.android.notification, { sound: 'default', channel_id: 'generation_complete', tag: 'p1' });
});

test('outcomes: not configured, unregistered, rejected, no access token', async () => {
    assert.deepEqual(await createFcmSender({ serviceAccount: null, fetchFn: () => assert.fail('no call') })('d', 'T', 'B'), { outcome: 'not_configured' });
    assert.equal((await fcm({ send: { ok: false, status: 404, body: '{"errorCode":"UNREGISTERED"}' } }).sendFcm('d', 'T', 'B')).outcome, 'unregistered');
    assert.deepEqual(await fcm({ send: { ok: false, status: 403 } }).sendFcm('d', 'T', 'B'), { outcome: 'failed', status: 403 });
    assert.equal((await fcm({ token: { ok: false } }).sendFcm('d', 'T', 'B')).outcome, 'failed');
});

function sender({ user, ios = null, outcome = 'sent' }) {
    const seen = { events: [], mails: [], reports: [], updates: [] };
    const client = { from: (table) => makeBuilder(table, (q) => {
        if (q.op === 'update') { seen.updates.push(q); return { error: null }; }
        return { data: table === 'push_tokens' ? ios : user, error: null };
    }) };
    const send = createPushSender({
        client, sendFcm: async () => ({ outcome }), sendApns: async () => {}, sendMail: async (...a) => seen.mails.push(a),
        events: { emit: (event, o) => seen.events.push(buildRow({ event, userId: o.userId, props: o.props })) }, report: (flow) => seen.reports.push(flow),
    });
    return { seen, send };
}

test('every Android notice records what happened to it', async () => {
    for (const [user, outcome, expected] of [
        [{ fcm_token: 't', platform: 'android', email: 'a@b.c' }, 'sent', 'sent'],
        [{ fcm_token: 't', platform: 'android', email: 'a@b.c' }, 'not_configured', 'not_configured'],
        [{ fcm_token: null, platform: 'android', email: 'a@b.c' }, 'sent', 'no_token'],
    ]) {
        const s = sender({ user, outcome });
        await s.send('u1', 'Project Ready!', 'b', { kind: 'build_ready', projectId: 'p1' });
        assert.equal(s.seen.events.length, 1);
        assert.deepEqual(s.seen.events[0].props, { push_kind: 'build_ready', push_outcome: expected, source: 'android' });
        assert.equal(s.seen.mails.length, expected === 'sent' ? 0 : 1, expected);
        assert.equal(s.seen.reports.length, 0);
    }
});

test('a dead token is cleared only if unchanged; a delivery failure is reported; iPhone-only people are not counted', async () => {
    const dead = sender({ user: { fcm_token: 'old', platform: 'android' }, outcome: 'unregistered' });
    await dead.send('u1', 'T', 'B');
    assert.equal(dead.seen.updates.length, 1);
    assert.deepEqual(dead.seen.updates[0].payload, { fcm_token: null });
    assert.deepEqual(dead.seen.updates[0].filters, [['eq', 'user_id', 'u1'], ['eq', 'fcm_token', 'old']]);
    const failed = sender({ user: { fcm_token: 't' }, outcome: 'failed' });
    await failed.send('u1', 'T', 'B');
    assert.deepEqual(failed.seen.reports, ['push:fcm_send']);
    const iphone = sender({ user: { fcm_token: null }, ios: { apns_token: 'a' } });
    await iphone.send('u1', 'T', 'B');
    assert.equal(iphone.seen.events.length, 0);
    assert.equal(iphone.seen.mails.length, 0);
});
