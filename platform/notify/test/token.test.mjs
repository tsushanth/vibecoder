import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { signUnsubscribe, verifyUnsubscribe, UNSUB_PURPOSE } from '../token.js';
import { deriveAppKey } from '../../auth/keys.js';
import { signToken } from '../../auth/jwt.js';

const MK = randomBytes(32).toString('hex');
const U = randomUUID();

test('round trip returns the user id for the same app', () => {
    const t = signUnsubscribe({ masterKey: MK, appId: 'app-a', userId: U });
    assert.deepEqual(verifyUnsubscribe({ masterKey: MK, appId: 'app-a', token: t }), { ok: true, userId: U });
});

test('token is url safe and carries no padding or separators beyond one dot', () => {
    const t = signUnsubscribe({ masterKey: MK, appId: 'app-a', userId: U });
    assert.match(t, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
});

test('a token for one app does not verify on another app', () => {
    const t = signUnsubscribe({ masterKey: MK, appId: 'app-a', userId: U });
    assert.deepEqual(verifyUnsubscribe({ masterKey: MK, appId: 'app-b', token: t }), { ok: false });
});

test('a token signed with a different master key does not verify', () => {
    const t = signUnsubscribe({ masterKey: randomBytes(32).toString('hex'), appId: 'app-a', userId: U });
    assert.equal(verifyUnsubscribe({ masterKey: MK, appId: 'app-a', token: t }).ok, false);
});

test('tampering with the user part or the mac fails', () => {
    const t = signUnsubscribe({ masterKey: MK, appId: 'app-a', userId: U });
    const [u, mac] = t.split('.');
    const other = Buffer.from(randomUUID()).toString('base64url');
    assert.equal(verifyUnsubscribe({ masterKey: MK, appId: 'app-a', token: `${other}.${mac}` }).ok, false);
    const flipped = (mac[0] === 'A' ? 'B' : 'A') + mac.slice(1);
    assert.equal(verifyUnsubscribe({ masterKey: MK, appId: 'app-a', token: `${u}.${flipped}` }).ok, false);
    // the last base64url character carries only 4 bits: every other spelling of it must be refused, not decoded to the same bytes
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const accepted = [...alphabet].filter((c) => verifyUnsubscribe({ masterKey: MK, appId: 'app-a', token: `${u}.${mac.slice(0, -1)}${c}` }).ok);
    assert.deepEqual(accepted, [mac.at(-1)]);
    // and a non-canonical spelling of the user part (padding bits set) is refused too
    assert.equal(verifyUnsubscribe({ masterKey: MK, appId: 'app-a', token: `${u}=.${mac}` }).ok, false);
    assert.equal(verifyUnsubscribe({ masterKey: MK, appId: 'app-a', token: `${u}.${mac.slice(0, 20)}` }).ok, false);
});

test('garbage and non-string tokens fail without throwing', () => {
    for (const t of [undefined, null, 5, '', '.', 'abc', 'a.b.c', 'x'.repeat(500), `${Buffer.from('not-a-uuid').toString('base64url')}.${'A'.repeat(43)}`]) assert.deepEqual(verifyUnsubscribe({ masterKey: MK, appId: 'app-a', token: t }), { ok: false }, String(t));
});

test('the signing purpose is distinct from the session key, so a session JWT key cannot forge an unsubscribe token', () => {
    assert.notEqual(UNSUB_PURPOSE, 'vibe-enduser-jwt-v1');
    assert.notDeepEqual(deriveAppKey(MK, 'app-a', UNSUB_PURPOSE), deriveAppKey(MK, 'app-a'));
    // forge with the session key and the same layout
    const mac = createHmac('sha256', deriveAppKey(MK, 'app-a')).update(`app-a:${U}`).digest('base64url');
    assert.equal(verifyUnsubscribe({ masterKey: MK, appId: 'app-a', token: `${Buffer.from(U).toString('base64url')}.${mac}` }).ok, false);
    // and the real one is accepted, proving the forge above differs only by key
    const good = createHmac('sha256', deriveAppKey(MK, 'app-a', UNSUB_PURPOSE)).update(`app-a:${U}`).digest('base64url');
    assert.equal(verifyUnsubscribe({ masterKey: MK, appId: 'app-a', token: `${Buffer.from(U).toString('base64url')}.${good}` }).ok, true);
});

test('signing refuses a user id that is not a uuid and an invalid app id', () => {
    assert.throws(() => signUnsubscribe({ masterKey: MK, appId: 'app-a', userId: 'not-a-uuid' }));
    assert.throws(() => signUnsubscribe({ masterKey: MK, appId: 'Bad App', userId: U }));
});

test('an unrelated session token is not accepted as an unsubscribe token', () => {
    const jwt = signToken({ key: deriveAppKey(MK, 'app-a'), appId: 'app-a', sub: U, jti: 'j', ttlSec: 60, now: Date.now() });
    assert.equal(verifyUnsubscribe({ masterKey: MK, appId: 'app-a', token: jwt }).ok, false);
});
