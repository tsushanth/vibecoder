import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBrokerReady } from '../brokerReady.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const base = { readSecret: () => 'abc\n', brokerUrl: 'http://broker.test' };

test('ready when the broker hands out a token, and the token is never returned', async () => {
  let seen;
  const out = await checkBrokerReady({ ...base, fetchImpl: async (url, init) => { seen = { url, auth: init.headers.Authorization }; return json(200, { access_token: 'secret-token' }); } });
  assert.deepEqual(out, { ready: true, mode: 'broker', status: 200 });
  assert.equal(seen.url, 'http://broker.test/token');
  assert.equal(seen.auth, 'Bearer abc');
  assert.equal(JSON.stringify(out).includes('secret-token'), false);
});

test('not ready when every Claude account failed (the 2026-09-30 outage)', async () => {
  const out = await checkBrokerReady({ ...base, fetchImpl: async () => json(503, { error: 'all accounts failed (active + failover)', tried: ['A', 'B'] }) });
  assert.equal(out.ready, false);
  assert.equal(out.status, 503);
  assert.match(out.reason, /all accounts failed/);
});

test('not ready when the secret is rejected or the broker is unreachable', async () => {
  assert.equal((await checkBrokerReady({ ...base, fetchImpl: async () => json(401, { error: 'unauthorized' }) })).ready, false);
  const down = await checkBrokerReady({ ...base, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(down.ready, false);
  assert.equal(down.reason, 'broker unreachable');
});

test('a machine without the secret file (local dev) is not blocked by the broker', async () => {
  const out = await checkBrokerReady({ ...base, readSecret: () => { const e = new Error('nf'); e.code = 'ENOENT'; throw e; }, fetchImpl: async () => { throw new Error('must not be called'); } });
  assert.deepEqual(out, { ready: true, mode: 'direct' });
});

test('an unreadable or empty secret is a failure, not a pass', async () => {
  const denied = await checkBrokerReady({ ...base, readSecret: () => { const e = new Error('x'); e.code = 'EACCES'; throw e; }, fetchImpl: async () => json(200, {}) });
  assert.equal(denied.ready, false);
  const empty = await checkBrokerReady({ ...base, readSecret: () => '  \n', fetchImpl: async () => json(200, {}) });
  assert.equal(empty.ready, false);
});
