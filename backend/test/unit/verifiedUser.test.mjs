import '../helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifiedUserId } from '../../lib/verifiedUser.js';

const req = (authorization) => ({ headers: authorization === undefined ? {} : { authorization } });
const client = (impl) => ({ auth: { getUser: impl } });

test('returns the verified user id for a valid bearer token and passes the token to Supabase unchanged', async () => {
    let seen;
    const id = await verifiedUserId(req('Bearer abc.def.ghi'), client(async (t) => { seen = t; return { data: { user: { id: 'user-1' } }, error: null }; }));
    assert.equal(id, 'user-1'); assert.equal(seen, 'abc.def.ghi');
});

test('no Authorization header, a wrong scheme, an empty token or an overlong token is null and never calls Supabase', async () => {
    let calls = 0; const c = client(async () => { calls++; return { data: { user: { id: 'x' } }, error: null }; });
    for (const h of [undefined, '', 'Basic abc', 'Bearer', 'Bearer ', 'bearer abc', 'Bearer ' + 'a'.repeat(5000)]) assert.equal(await verifiedUserId(req(h), c), null, String(h).slice(0, 20));
    assert.equal(calls, 0);
});

test('an error from Supabase, a thrown error, or a missing or non-string user id is null', async () => {
    assert.equal(await verifiedUserId(req('Bearer t'), client(async () => ({ data: { user: null }, error: { message: 'bad jwt' } }))), null);
    assert.equal(await verifiedUserId(req('Bearer t'), client(async () => { throw new Error('network'); })), null);
    assert.equal(await verifiedUserId(req('Bearer t'), client(async () => ({ data: { user: {} }, error: null }))), null);
    assert.equal(await verifiedUserId(req('Bearer t'), client(async () => ({ data: { user: { id: 42 } }, error: null }))), null);
    assert.equal(await verifiedUserId(req('Bearer t'), client(async () => ({ data: null, error: null }))), null);
});

test('a client without auth.getUser (misconfiguration) is null, not a crash', async () => {
    assert.equal(await verifiedUserId(req('Bearer t'), {}), null);
    assert.equal(await verifiedUserId(req('Bearer t'), undefined), null);
});

test('the user id comes only from the verified token: a userId in the body or query is ignored', async () => {
    const r = { headers: { authorization: 'Bearer t' }, body: { userId: 'attacker' }, query: { userId: 'attacker' } };
    assert.equal(await verifiedUserId(r, client(async () => ({ data: { user: { id: 'real-user' } }, error: null }))), 'real-user');
});
