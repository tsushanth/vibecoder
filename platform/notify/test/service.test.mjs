import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { memoryStore } from '../../vibe-proxy/limits.js';
import { createNotifyService, DEFAULT_LIMITS } from '../service.js';
import { verifyUnsubscribe } from '../token.js';

const MK = randomBytes(32).toString('hex');
const T0 = Date.UTC(2026, 9, 5, 12, 0, 0);

function rig({ limits, apps = { 'app-a': { enabled: true }, 'app-b': { enabled: true } }, users } = {}) {
    let clock = T0;
    const sent = [];
    const u1 = randomUUID(), u2 = randomUUID(), u3 = randomUUID();
    const db = users ?? { [`app-a:${u1}`]: 'one@example.com', [`app-a:${u2}`]: 'two@example.com', [`app-a:${u3}`]: 'three@example.com', [`app-b:${u1}`]: 'one@example.com' };
    const optouts = new Set();
    const r = {
        sent, optouts, u1, u2, u3, mailFails: false, limiterFails: false,
        advance: (ms) => { clock += ms; },
        limiterStore: memoryStore({ now: () => clock }),
        mailer: { async sendMessage(m) { if (r.mailFails) throw new Error('smtp down SECRET-KEY'); sent.push(m); } },
        store: {
            async getRecipient({ appId, userId }) { if (!/^[0-9a-f-]{36}$/.test(userId)) throw new Error('invalid input syntax for type uuid'); const email = db[`${appId}:${userId}`]; return email ? { email, optedOut: optouts.has(`${appId}:${userId}`) } : null; },
            async optOut({ appId, userId }) { optouts.add(`${appId}:${userId}`); },
        },
        appStore: { async get(id) { return apps[id] ?? null; } },
    };
    const ls = new Proxy(r.limiterStore, { get: (t, k) => (r.limiterFails && typeof t[k] === 'function' ? async () => { throw new Error('db down'); } : t[k]) });
    r.svc = createNotifyService({ store: r.store, limiterStore: ls, mailer: r.mailer, appStore: r.appStore, masterKey: MK, baseUrl: 'https://vibe-proxy.test', now: () => clock, limits });
    return r;
}
const send = (r, o = {}) => r.svc.sendToUser({ appId: 'app-a', userId: r.u1, subject: 'Hi', text: 'Body', ...o });

test('sends one email to the recipient the platform has on file, never one supplied by the caller', async () => {
    const r = rig();
    assert.deepEqual(await send(r, { to: 'victim@example.com', email: 'victim@example.com', recipient: 'victim@example.com' }), { ok: true });
    assert.equal(r.sent.length, 1);
    assert.equal(r.sent[0].to, 'one@example.com');
    assert.equal(r.sent[0].subject, 'Hi');
    assert.ok(r.sent[0].text.startsWith('Body'));
    assert.equal(JSON.stringify(r.sent[0]).includes('victim@example.com'), false);
});

test('the message carries a working unsubscribe link and list headers for exactly this user and app', async () => {
    const r = rig(); await send(r);
    const url = /https:\/\/vibe-proxy\.test\/app-a\/notify\/unsubscribe\?t=([A-Za-z0-9_.-]+)/.exec(r.sent[0].text);
    assert.ok(url, r.sent[0].text);
    assert.deepEqual(verifyUnsubscribe({ masterKey: MK, appId: 'app-a', token: url[1] }), { ok: true, userId: r.u1 });
    assert.equal(r.sent[0].headers['List-Unsubscribe'], `<${url[0]}>`);
    assert.equal(r.sent[0].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.match(r.sent[0].text, /app-a/);
});

test('header injection in the subject is neutralised before it reaches the mailer', async () => {
    const r = rig(); await send(r, { subject: 'Hello\r\nBcc: evil@example.com' });
    assert.equal(/[\r\n]/.test(r.sent[0].subject), false); assert.equal(r.sent[0].subject, 'Hello Bcc: evil@example.com');
});

test('invalid content is refused before anything is counted or sent', async () => {
    const r = rig();
    assert.deepEqual(await send(r, { subject: '' }), { ok: false, reason: 'invalid_content', detail: 'subject_required' });
    assert.equal((await send(r, { text: 'x'.repeat(2001) })).reason, 'invalid_content');
    assert.equal(r.sent.length, 0);
    for (let i = 0; i < 3; i++) assert.equal((await send(r)).ok, true); // the refused calls did not eat the hourly allowance of 3
});

test('unknown user, malformed user id, unknown app and invalid app id are refused without sending', async () => {
    const r = rig();
    assert.equal((await send(r, { userId: randomUUID() })).reason, 'unknown_user');
    assert.equal((await send(r, { userId: 'not-a-uuid' })).reason, 'unknown_user');
    assert.equal((await send(r, { appId: 'nope' })).reason, 'unknown_app');
    assert.equal((await send(r, { appId: 'Bad App!' })).reason, 'unknown_app');
    assert.equal((await send(r, { userId: undefined })).reason, 'unknown_user');
    assert.equal(r.sent.length, 0);
});

test('a user in another app cannot be reached through this app id', async () => {
    const r = rig();
    assert.equal((await send(r, { appId: 'app-b', userId: r.u2 })).reason, 'unknown_user'); // u2 only exists in app-a
});

test('an opted-out user gets nothing and the attempt costs no quota', async () => {
    const r = rig({ limits: { perUserPerHour: 2, perUserPerDay: 5, perAppPerDay: 5, globalPerDay: 5 } });
    r.optouts.add(`app-a:${r.u1}`);
    for (let i = 0; i < 10; i++) assert.deepEqual(await send(r), { ok: false, reason: 'opted_out' });
    assert.equal(r.sent.length, 0);
    assert.equal((await send(r, { userId: r.u2 })).ok, true); // app and global allowances untouched by the ten refusals
    assert.equal(await r.limiterStore.get(`notify:app:app-a:${new Date(T0).toISOString().slice(0, 10)}`), 1);
    assert.equal(await r.limiterStore.get(`notify:global:${new Date(T0).toISOString().slice(0, 10)}`), 1);
});

test('opt-out is per app: opting out of app-a does not silence app-b', async () => {
    const r = rig(); r.optouts.add(`app-a:${r.u1}`);
    assert.equal((await send(r, { appId: 'app-b' })).ok, true);
});

test('per user per hour: default 3, the next is rate limited with a retry hint, and the next hour resets', async () => {
    const r = rig();
    for (let i = 0; i < 3; i++) assert.equal((await send(r)).ok, true);
    const x = await send(r); assert.deepEqual([x.ok, x.reason], [false, 'rate_limited']); assert.equal(x.retryAfterSec, 3600); // T0 is on the hour
    assert.equal(r.sent.length, 3);
    r.advance(1800_000); assert.equal((await send(r)).retryAfterSec, 1800);
    r.advance(1800_000); assert.equal((await send(r)).ok, true);
});

test('per user per day: default 10 even when the hourly limit keeps resetting; next UTC day resets', async () => {
    const r = rig({ limits: { perUserPerHour: 100 } });
    for (let i = 0; i < 10; i++) assert.equal((await send(r)).ok, true);
    const x = await send(r); assert.deepEqual([x.ok, x.reason], [false, 'rate_limited']); assert.equal(x.retryAfterSec, 12 * 3600);
    r.advance(12 * 3600_000); assert.equal((await send(r)).ok, true);
});

test('per app per day: shared across that app\'s users, not across apps', async () => {
    const r = rig({ limits: { perUserPerHour: 100, perUserPerDay: 100, perAppPerDay: 4, globalPerDay: 100 } });
    for (const u of [r.u1, r.u2, r.u3, r.u1]) assert.equal((await send(r, { userId: u })).ok, true);
    assert.equal((await send(r, { userId: r.u2 })).reason, 'rate_limited');
    assert.equal((await send(r, { appId: 'app-b' })).ok, true);
    assert.equal(r.sent.length, 5);
});

test('global per day: a platform-wide cap across apps', async () => {
    const r = rig({ limits: { perUserPerHour: 100, perUserPerDay: 100, perAppPerDay: 100, globalPerDay: 3 } });
    assert.equal((await send(r)).ok, true); assert.equal((await send(r, { userId: r.u2 })).ok, true); assert.equal((await send(r, { appId: 'app-b' })).ok, true);
    const x = await send(r, { userId: r.u3 }); assert.deepEqual([x.ok, x.reason], [false, 'rate_limited']);
    assert.equal(r.sent.length, 3);
});

test('limit checks run user, then app, then global: a capped user does not burn the app or global allowance', async () => {
    const r = rig({ limits: { perUserPerHour: 1, perUserPerDay: 100, perAppPerDay: 2, globalPerDay: 2 } });
    assert.equal((await send(r)).ok, true);
    for (let i = 0; i < 20; i++) assert.equal((await send(r)).reason, 'rate_limited'); // same user hammering
    assert.equal((await send(r, { userId: r.u2 })).ok, true); // app and global still have their second slot
    assert.equal(r.sent.length, 2);
});

test('the kill switch and a disabled app stop sends', async () => {
    const r = rig(); await r.limiterStore.set('kill:app-a', 1, 3600);
    assert.deepEqual(await send(r), { ok: false, reason: 'app_disabled' });
    assert.equal((await send(r, { appId: 'app-b' })).ok, true); // other apps unaffected
    const d = rig({ apps: { 'app-a': { enabled: false } } });
    assert.deepEqual(await send(d), { ok: false, reason: 'app_disabled' });
    assert.equal(r.sent.length, 1); assert.equal(d.sent.length, 0);
});

test('the kill switch is checked before recipient lookup, so a killed app learns nothing about users', async () => {
    const r = rig(); await r.limiterStore.set('kill:app-a', 1, 3600);
    assert.equal((await send(r, { userId: randomUUID() })).reason, 'app_disabled');
});

test('a limiter store failure fails closed with no send', async () => {
    const r = rig(); r.limiterFails = true;
    assert.deepEqual(await send(r), { ok: false, reason: 'unavailable' });
    assert.equal(r.sent.length, 0);
});

test('a mail provider failure is send_failed and the error text is not exposed', async () => {
    const r = rig(); r.mailFails = true;
    const x = await send(r); assert.deepEqual(x, { ok: false, reason: 'send_failed' });
    assert.equal(JSON.stringify(x).includes('SECRET-KEY'), false);
});

test('unsubscribe with a valid token records the opt-out, is idempotent, and stops later sends', async () => {
    const r = rig(); await send(r);
    const t = /\?t=([A-Za-z0-9_.-]+)/.exec(r.sent[0].text)[1];
    assert.deepEqual(await r.svc.unsubscribe({ appId: 'app-a', token: t }), { ok: true });
    assert.deepEqual(await r.svc.unsubscribe({ appId: 'app-a', token: t }), { ok: true });
    assert.ok(r.optouts.has(`app-a:${r.u1}`));
    assert.equal((await send(r)).reason, 'opted_out');
});

test('unsubscribe rejects a token for another app, a forged token and junk, and records nothing', async () => {
    const r = rig(); await send(r);
    const t = /\?t=([A-Za-z0-9_.-]+)/.exec(r.sent[0].text)[1];
    assert.deepEqual(await r.svc.unsubscribe({ appId: 'app-b', token: t }), { ok: false, reason: 'invalid_link' });
    assert.deepEqual(await r.svc.unsubscribe({ appId: 'app-a', token: t.slice(0, -2) + 'xx' }), { ok: false, reason: 'invalid_link' });
    assert.deepEqual(await r.svc.unsubscribe({ appId: 'app-a', token: undefined }), { ok: false, reason: 'invalid_link' });
    assert.equal(r.optouts.size, 0);
});

test('unsubscribe still works when the app is disabled or killed (opting out must never be blocked)', async () => {
    const r = rig(); await send(r); await r.limiterStore.set('kill:app-a', 1, 3600);
    const t = /\?t=([A-Za-z0-9_.-]+)/.exec(r.sent[0].text)[1];
    assert.deepEqual(await r.svc.unsubscribe({ appId: 'app-a', token: t }), { ok: true });
});

test('a store failure while unsubscribing is reported as unavailable, not as success', async () => {
    const r = rig(); await send(r);
    const t = /\?t=([A-Za-z0-9_.-]+)/.exec(r.sent[0].text)[1];
    r.store.optOut = async () => { throw new Error('db down'); };
    assert.deepEqual(await r.svc.unsubscribe({ appId: 'app-a', token: t }), { ok: false, reason: 'unavailable' });
});

test('default limits are 3 per user per hour, 10 per user per day, 200 per app per day, 2000 platform per day', () => {
    assert.deepEqual(DEFAULT_LIMITS, { perUserPerHour: 3, perUserPerDay: 10, perAppPerDay: 200, globalPerDay: 2000 });
});

test('construction validates its inputs', () => {
    const base = { store: {}, limiterStore: {}, mailer: {}, appStore: {}, masterKey: MK, baseUrl: 'https://p.test' };
    assert.doesNotThrow(() => createNotifyService(base));
    assert.throws(() => createNotifyService({ ...base, baseUrl: 'http://p.test' }));
    assert.throws(() => createNotifyService({ ...base, baseUrl: undefined }));
    assert.throws(() => createNotifyService({ ...base, masterKey: 'short' }));
});
