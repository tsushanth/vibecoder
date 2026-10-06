import './../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');

// The legacy register and push-token routes trusted a userId in the body, so anyone who knew a user id could overwrite that
// account's email or redirect its notifications. Real accounts now need the owner's token; anonymous device ids (iOS) still work.
const rows = new Map(); const ops = [];
stubSupabase(supabase, (q) => {
    const id = q.filters.find((f) => f[0] === 'eq' && f[1] === 'user_id')?.[2];
    ops.push({ table: q.table, op: q.op, payload: q.payload });
    if (q.table === 'users' && q.op === 'select') return { data: rows.get(id) ?? null, error: null };
    if (q.table === 'users' && q.op === 'insert') { rows.set(q.payload.user_id, q.payload); return { data: q.payload, error: null }; }
    if (q.table === 'users' && q.op === 'upsert') { rows.set(q.payload.user_id, q.payload); return { data: q.payload, error: null }; }
    return { data: null, error: null };
});
const { createAuthRouter } = await import('../../routes/auth.routes.js');
let verified = null;
let srv;
before(async () => {
    const app = express(); app.use(express.json()); app.use('/api/auth', createAuthRouter({ verifyUser: async () => verified })); srv = await listen(app);
});
after(async () => { await srv.close(); });
const post = async (p, body) => { const e = console.error; console.error = () => {}; try { return await fetch(`${srv.base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); } finally { console.error = e; } };
const reset = () => { rows.clear(); ops.length = 0; verified = null; };
const writes = () => ops.filter((o) => o.op !== 'select');

test('register: a token for another user is refused and nothing is written', async () => {
    reset(); verified = 'attacker';
    const r = await post('/api/auth/register', { userId: 'victim', email: 'evil@x.com' });
    assert.equal(r.status, 403); assert.equal(writes().length, 0);
});

test('register: a verified user can create and update their own row, email included', async () => {
    reset(); verified = 'u1';
    const r = await post('/api/auth/register', { userId: 'u1', email: 'u1@x.com', displayName: 'U' });
    assert.equal(r.status, 200); assert.equal(rows.get('u1').email, 'u1@x.com');
});

test('register: without a token an existing account is never modified', async () => {
    reset(); rows.set('victim', { user_id: 'victim', email: 'real@x.com', display_name: 'Real' });
    const r = await post('/api/auth/register', { userId: 'victim', email: 'evil@x.com', displayName: 'Evil' });
    assert.equal(r.status, 200); assert.equal(writes().length, 0); assert.equal(rows.get('victim').email, 'real@x.com');
});

test('register: without a token a new anonymous row is created, and an unproven email is not stored', async () => {
    reset();
    const r = await post('/api/auth/register', { userId: 'anon-1', email: 'claimed@x.com', displayName: 'Dev' });
    assert.equal(r.status, 200); assert.equal(rows.get('anon-1').email, null); assert.equal(rows.get('anon-1').display_name, 'Dev');
});

test('push-token: a real account needs its own token; a wrong or missing token is refused', async () => {
    reset(); rows.set('victim', { user_id: 'victim', email: 'real@x.com' });
    assert.equal((await post('/api/auth/push-token', { userId: 'victim', token: 't', platform: 'ios' })).status, 403);
    verified = 'attacker'; assert.equal((await post('/api/auth/push-token', { userId: 'victim', token: 't', platform: 'android' })).status, 403);
    assert.equal(writes().length, 0);
    verified = 'victim'; assert.equal((await post('/api/auth/push-token', { userId: 'victim', token: 't', platform: 'ios' })).status, 200);
    assert.ok(writes().some((o) => o.table === 'push_tokens'));
});

test('push-token: an anonymous device id (no email on its row) still registers without a token', async () => {
    reset(); rows.set('anon-1', { user_id: 'anon-1', email: null });
    assert.equal((await post('/api/auth/push-token', { userId: 'anon-1', token: 't', platform: 'ios' })).status, 200);
    reset(); assert.equal((await post('/api/auth/push-token', { userId: 'never-seen', token: 't', platform: 'ios' })).status, 200);
});
