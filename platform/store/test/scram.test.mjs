import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { scratchDb } from './helpers.mjs';
import { scramVerifier } from '../scram.js';

let db, skip;
before(async () => { db = await scratchDb({ migrate: false }); if (db.unavailable) skip = db.unavailable; });
after(async () => { if (db && !db.unavailable) { await db.admin.query('drop role if exists vibe_scram_test').catch(() => {}); await db.cleanup(); } });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); await f(c); });

test('verifier has the PostgreSQL SCRAM-SHA-256 shape', () => {
    assert.match(scramVerifier('a-long-password-for-the-test'), /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/);
});

test('the same password and salt always give the same verifier, a different salt or password does not', () => {
    const salt = Buffer.alloc(16, 7);
    assert.equal(scramVerifier('pw-0123456789abcdef', { salt }), scramVerifier('pw-0123456789abcdef', { salt }));
    assert.notEqual(scramVerifier('pw-0123456789abcdef', { salt }), scramVerifier('pw-0123456789abcdeg', { salt }));
    assert.notEqual(scramVerifier('pw-0123456789abcdef', { salt }), scramVerifier('pw-0123456789abcdef', { salt: Buffer.alloc(16, 8) }));
});

test('without an explicit salt each call uses a fresh random salt', () => {
    assert.notEqual(scramVerifier('same-password-0123456789'), scramVerifier('same-password-0123456789'));
});

t('it reproduces exactly the verifier PostgreSQL itself stores for the same password, salt and iteration count', async () => {
    const pw = 'p' + randomBytes(12).toString('hex');
    await db.admin.query(`drop role if exists vibe_scram_test`);
    await db.admin.query(`create role vibe_scram_test login password '${pw}'`);
    const { rows } = await db.admin.query(`select rolpassword from pg_authid where rolname = 'vibe_scram_test'`);
    const stored = rows[0].rolpassword;
    const m = /^SCRAM-SHA-256\$(\d+):([^$]+)\$/.exec(stored);
    assert.ok(m, `postgres stored: ${stored.slice(0, 20)}`);
    assert.equal(scramVerifier(pw, { iterations: Number(m[1]), salt: Buffer.from(m[2], 'base64') }), stored);
});

test('rejects short passwords and bad iteration counts', () => {
    assert.throws(() => scramVerifier('short'), /at least 16/);
    assert.throws(() => scramVerifier('a-long-password-for-the-test', { iterations: 100 }), /iterations/);
});
