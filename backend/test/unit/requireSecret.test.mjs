import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { requireSecret, KNOWN_PUBLIC_SECRET_HASHES } from '../../lib/requireSecret.js';

const GOOD = 'a-strong-secret-value-0123456789';
const sha = (s) => createHash('sha256').update(s).digest('hex');

test('returns the value when it is set, long enough and not a known public value', () => {
    assert.equal(requireSecret('WORKER_SECRET', { WORKER_SECRET: GOOD }), GOOD);
});

test('an unset, empty, whitespace-only or short value throws and names the variable', () => {
    for (const v of [undefined, '', '   ', 'short', 'a'.repeat(15)]) {
        assert.throws(() => requireSecret('WORKER_SECRET', { WORKER_SECRET: v }), (e) => /WORKER_SECRET/.test(e.message), String(v));
    }
});

test('the error message never contains the secret value', () => {
    for (const v of ['tooshort', ' '.repeat(40)]) {
        assert.throws(() => requireSecret('X_SECRET', { X_SECRET: v }), (e) => !e.message.includes(v.trim() || '\u0000'));
    }
    const known = 'value-that-was-made-public-1234567';
    assert.throws(() => requireSecret('X_SECRET', { X_SECRET: known }, { publicHashes: [sha(known)] }), (e) => !e.message.includes(known));
});

test('a value whose SHA-256 is in the known-public list is refused, so a leaked value can never be rolled back in', () => {
    const leaked = 'a-leaked-secret-value-0123456789';
    assert.throws(() => requireSecret('WORKER_SECRET', { WORKER_SECRET: leaked }, { publicHashes: [sha(leaked)] }), (e) => /retired|must not be used/i.test(e.message));
    assert.equal(requireSecret('WORKER_SECRET', { WORKER_SECRET: GOOD }, { publicHashes: [sha(leaked)] }), GOOD);
});

test('the built-in known-public list has the two retired values as lowercase SHA-256 hex, and nothing readable', () => {
    assert.ok(KNOWN_PUBLIC_SECRET_HASHES.length >= 2);
    for (const h of KNOWN_PUBLIC_SECRET_HASHES) assert.match(h, /^[0-9a-f]{64}$/);
});

test('the default environment is process.env', () => {
    process.env.REQUIRE_SECRET_TEST = GOOD;
    try { assert.equal(requireSecret('REQUIRE_SECRET_TEST'), GOOD); } finally { delete process.env.REQUIRE_SECRET_TEST; }
});
