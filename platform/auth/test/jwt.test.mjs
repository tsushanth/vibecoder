import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { deriveAppKey } from '../keys.js';
import { signToken, verifyToken } from '../jwt.js';

const MASTER = randomBytes(32).toString('hex');
const key = (app) => deriveAppKey(MASTER, app);
const NOW = Date.UTC(2026, 9, 5);
const mint = (o = {}) => signToken({ key: key('app-a'), appId: 'app-a', sub: 'u1', jti: 'j1', now: NOW, ...o });
const check = (token, o = {}) => verifyToken({ key: key('app-a'), appId: 'app-a', token, now: NOW + 1000, ...o });
const forge = (header, payload, k = key('app-a')) => {
    const b = (x) => Buffer.from(JSON.stringify(x)).toString('base64url');
    const body = `${b(header)}.${b(payload)}`;
    return `${body}.${createHmac('sha256', k).update(body).digest('base64url')}`;
};

test('keys: deterministic per app and master, different per app, purpose and master', () => {
    assert.deepEqual(key('app-a'), key('app-a'));
    assert.notDeepEqual(key('app-a'), key('app-b'));
    assert.notDeepEqual(key('app-a'), deriveAppKey(MASTER, 'app-a', 'other-purpose'));
    assert.notDeepEqual(key('app-a'), deriveAppKey(randomBytes(32).toString('hex'), 'app-a'));
    assert.equal(key('app-a').length, 32);
});

test('keys: bad master or app id throws', () => {
    for (const m of ['', 'abc', 'z'.repeat(64), undefined]) assert.throws(() => deriveAppKey(m, 'app-a'));
    for (const a of ['', 'A', '../x', 'a b', undefined, 'a'.repeat(64)]) assert.throws(() => deriveAppKey(MASTER, a));
});

test('a signed token verifies and carries the claims', () => {
    const r = check(mint());
    assert.equal(r.ok, true);
    assert.deepEqual(r.claims, { app_id: 'app-a', sub: 'u1', jti: 'j1', iat: NOW / 1000, exp: NOW / 1000 + 30 * 24 * 3600 });
});

test('a token for another app is refused, even when the signature is valid for that app', () => {
    assert.deepEqual(check(mint()), check(mint()));
    const other = signToken({ key: key('app-b'), appId: 'app-b', sub: 'u1', jti: 'j1', now: NOW });
    assert.equal(verifyToken({ key: key('app-a'), appId: 'app-a', token: other, now: NOW }).reason, 'bad_signature');
    assert.equal(verifyToken({ key: key('app-b'), appId: 'app-a', token: other, now: NOW }).reason, 'wrong_app');
});

test('expiry boundary: valid until exp, refused at exp', () => {
    const t = mint({ ttlSec: 100 });
    assert.equal(check(t, { now: NOW + 99_000 }).ok, true);
    assert.equal(check(t, { now: NOW + 100_000 }).reason, 'expired');
});

test('a token from the future is refused beyond a 60 second skew', () => {
    const t = mint({ now: NOW + 120_000 });
    assert.equal(check(t).reason, 'not_yet_valid');
    assert.equal(check(mint({ now: NOW + 30_000 })).ok, true);
});

test('tampering: changed payload, changed signature, alg none, other algorithms, extra parts', () => {
    const [h, p, s] = mint().split('.');
    const evil = Buffer.from(JSON.stringify({ app_id: 'app-a', sub: 'admin', jti: 'j1', iat: NOW / 1000, exp: NOW / 1000 + 999999 })).toString('base64url');
    assert.equal(check(`${h}.${evil}.${s}`).reason, 'bad_signature');
    assert.equal(check(`${h}.${p}.${s.slice(0, -2)}AA`).reason, 'bad_signature');
    assert.equal(check(`${h}.${p}.`).reason, 'bad_signature');
    assert.equal(check(forge({ alg: 'none', typ: 'JWT' }, { app_id: 'app-a', sub: 'u', jti: 'j', iat: 1, exp: 9e9 })).reason, 'bad_header');
    assert.equal(check(forge({ alg: 'HS512', typ: 'JWT' }, { app_id: 'app-a', sub: 'u', jti: 'j', iat: 1, exp: 9e9 })).reason, 'bad_header');
    assert.equal(check(`${h}.${p}.${s}.x`).reason, 'malformed');
});

test('required claims are enforced even with a valid signature', () => {
    const H = { alg: 'HS256', typ: 'JWT' }; const base = { app_id: 'app-a', sub: 'u', jti: 'j', iat: NOW / 1000, exp: NOW / 1000 + 100 };
    for (const drop of ['sub', 'jti', 'exp', 'iat']) { const c = { ...base }; delete c[drop]; assert.equal(check(forge(H, c)).reason, 'missing_claims', drop); }
    assert.equal(check(forge(H, { ...base, sub: '' })).reason, 'missing_claims');
    assert.equal(check(forge(H, { ...base, exp: '9999999999' })).reason, 'missing_claims');
    assert.equal(check(forge(H, { ...base, app_id: 'app-b' })).reason, 'wrong_app');
});

test('garbage input never throws', () => {
    for (const t of [undefined, null, 42, '', 'a.b', '....', 'x'.repeat(5000), {}, 'a.b.c']) assert.equal(check(t).ok, false);
    assert.equal(check(forge({ alg: 'HS256', typ: 'JWT' }, 'notanobject')).ok, false);
});

test('an oversize token is refused before any work, even when correctly signed', () => {
    const t = forge({ alg: 'HS256', typ: 'JWT' }, { app_id: 'app-a', sub: 'u', jti: 'j', iat: NOW / 1000, exp: NOW / 1000 + 100, pad: 'x'.repeat(3000) });
    assert.equal(t.length > 2048, true);
    assert.equal(check(t).reason, 'malformed');
});
