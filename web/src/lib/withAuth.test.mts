import test from 'node:test';
import assert from 'node:assert/strict';
import { withAuth } from './withAuth.ts';

test('adds a bearer token and keeps the other headers', async () => {
  assert.deepEqual(await withAuth({ 'Content-Type': 'application/json' }, async () => 'tok'), { 'Content-Type': 'application/json', Authorization: 'Bearer tok' });
});
test('signed out, or a failing lookup, sends no Authorization header', async () => {
  assert.deepEqual(await withAuth({ a: 'b' }, async () => null), { a: 'b' });
  assert.deepEqual(await withAuth({ a: 'b' }, async () => { throw new Error('x'); }), { a: 'b' });
});
test('does not mutate the caller headers', async () => {
  const h = { a: 'b' }; await withAuth(h, async () => 'tok'); assert.deepEqual(h, { a: 'b' });
});
