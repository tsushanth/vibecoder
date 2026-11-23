import '../helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { signInternalAuth, checkInternalAuth } = await import('../../lib/internalAuth.js');
const { generateAuthMode, labelsFor, classifyGenerateRequest, createGenerateAuthStats } = await import('../../lib/generateAuth.js');

const SECRET = 'unit-test-secret-0123456789';
const req = (headers = {}) => ({ headers });
const NOW = 1_800_000_000_000;

test('mode: unset and unknown values are report; off/report/enforce are honoured (case-insensitive)', () => {
    assert.equal(generateAuthMode({}), 'report');
    assert.equal(generateAuthMode({ GENERATE_AUTH_MODE: '' }), 'report');
    assert.equal(generateAuthMode({ GENERATE_AUTH_MODE: 'enforced' }), 'report');
    assert.equal(generateAuthMode({ GENERATE_AUTH_MODE: 'off' }), 'off');
    assert.equal(generateAuthMode({ GENERATE_AUTH_MODE: ' ENFORCE ' }), 'enforce');
});

test('internal auth: a signature for this user verifies; another user, another secret, expired and malformed do not', () => {
    const h = signInternalAuth(SECRET, 'tg_1', NOW);
    const at = (headers, uid, nowMs = NOW, secret = SECRET) => checkInternalAuth(req(headers), uid, { secret, nowMs });
    assert.equal(at({ 'x-internal-auth': h }, 'tg_1'), 'valid');
    assert.equal(at({ 'x-internal-auth': h }, 'tg_2'), 'invalid');
    assert.equal(at({ 'x-internal-auth': h }, 'tg_1', NOW, 'another-secret-0123456789'), 'invalid');
    assert.equal(at({ 'x-internal-auth': h }, 'tg_1', NOW + 301_000), 'invalid');
    assert.equal(at({ 'x-internal-auth': h }, 'tg_1', NOW + 299_000), 'valid');
    assert.equal(at({ 'x-internal-auth': 'v1.1.zz' }, 'tg_1'), 'invalid');
    assert.equal(at({ 'x-internal-auth': SECRET }, 'tg_1'), 'invalid'); // the raw secret is not accepted
    assert.equal(at({}, 'tg_1'), 'absent');
});

test('internal auth fails closed: no or short secret never validates, and nothing is signed', () => {
    const h = signInternalAuth(SECRET, 'tg_1', NOW);
    for (const secret of [undefined, '', 'short']) {
        assert.equal(checkInternalAuth(req({ 'x-internal-auth': h }), 'tg_1', { secret, nowMs: NOW }), 'invalid');
        assert.equal(signInternalAuth(secret, 'tg_1', NOW), null);
    }
    assert.equal(signInternalAuth(SECRET, '', NOW), null);
});

test('internal auth ignores source address headers entirely', () => {
    const r = { headers: { 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1' }, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } };
    assert.equal(checkInternalAuth(r, 'tg_1', { secret: SECRET, nowMs: NOW }), 'absent');
});

test('labels: platform from x-platform, else the existing client detection; version only when well-formed', () => {
    assert.deepEqual(labelsFor(req({ 'x-platform': 'android', 'x-app-version': '2.7.3' })), { platform: 'android', version: '2.7.3' });
    assert.deepEqual(labelsFor(req({ 'user-agent': 'okhttp/4.12.0' })), { platform: 'android', version: 'none' });
    assert.deepEqual(labelsFor(req({ 'user-agent': 'Mozilla/5.0 (Mac)' })), { platform: 'web', version: 'none' });
    assert.deepEqual(labelsFor(req({ 'user-agent': 'vibebuild-messaging/1.0' })), { platform: 'api', version: 'none' });
    assert.equal(labelsFor(req({ 'x-app-version': 'u1@example.com' })).version, 'invalid');
});

test('classify: each outcome', async () => {
    const internal = () => 'absent';
    const c = (headers, userId, verified) => classifyGenerateRequest(req(headers), userId, { verifyUser: async () => verified, internal });
    assert.equal((await c({}, 'u1', null)).outcome, 'no_token');
    assert.equal((await c({ authorization: 'Bearer abc' }, 'u1', null)).outcome, 'token_invalid');
    assert.equal((await c({ authorization: 'Bearer abc' }, 'u1', 'u2')).outcome, 'token_mismatch');
    assert.equal((await c({ authorization: 'Bearer abc' }, undefined, 'u2')).outcome, 'token_mismatch');
    const ok = await c({ authorization: 'Bearer abc' }, 'u1', 'u1');
    assert.deepEqual([ok.outcome, ok.allow], ['token_match', true]);
    const viaInternal = await classifyGenerateRequest(req({}), 'tg_1', { verifyUser: async () => null, internal: () => 'valid' });
    assert.deepEqual([viaInternal.outcome, viaInternal.allow], ['internal_ok', true]);
});

test('stats: counts without identity, caps distinct versions, and logs at most once a minute per class', () => {
    let t = 1000; const lines = [];
    const s = createGenerateAuthStats({ now: () => t, log: (l) => lines.push(l), maxVersions: 2 });
    const rec = (outcome, version = '2.7.3') => s.record('report', { outcome, allow: outcome === 'token_match', platform: 'android', version, forgedInternal: false });
    for (let i = 0; i < 5; i++) rec('no_token');
    assert.equal(lines.length, 1); // the first one logs, the rest of that minute do not
    rec('token_match');           // a different class logs on its own
    assert.equal(lines.length, 2);
    t += 61_000; rec('no_token');
    assert.equal(lines.length, 3);
    assert.match(lines[2], /count_since_last_log=5/);
    rec('no_token', '9.1.1'); rec('no_token', '9.1.2'); // third distinct version collapses to "other"
    const snap = s.snapshot();
    assert.equal(snap.total, 9); assert.equal(snap.wouldBlock, 8);
    assert.ok(snap.byVersion.other);
    assert.doesNotMatch(JSON.stringify(snap) + lines.join('\n'), /Bearer|userId|@/);
});
