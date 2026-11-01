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

import { checkBuildPathReady } from '../brokerReady.js';

const brokerDown = async () => ({ ready: false, mode: 'broker', status: 503, reason: 'all accounts failed' });
const brokerUp = async () => ({ ready: true, mode: 'broker', status: 200 });
const llm = {};

test('build path: 100% direct is ready without consulting the broker', async () => {
  let called = false;
  const out = await checkBuildPathReady({ directPercent: 100, directLlm: llm, checkBroker: async () => { called = true; return brokerDown(); } });
  assert.deepEqual(out, { ready: true, mode: 'direct', percent: 100 });
  assert.equal(called, false);
});

test('build path: 0% direct keeps the broker result exactly', async () => {
  assert.deepEqual(await checkBuildPathReady({ directPercent: 0, directLlm: llm, checkBroker: brokerDown }), await brokerDown());
  assert.deepEqual(await checkBuildPathReady({ directPercent: 0, directLlm: null, checkBroker: brokerUp }), await brokerUp());
  assert.deepEqual(await checkBuildPathReady({ checkBroker: brokerUp }), await brokerUp());
});

test('build path: a mixed split needs both paths healthy', async () => {
  const bad = await checkBuildPathReady({ directPercent: 50, directLlm: llm, checkBroker: brokerDown });
  assert.equal(bad.ready, false);
  assert.equal(bad.mode, 'mixed');
  assert.equal(bad.percent, 50);
  assert.match(bad.reason, /all accounts failed/);
  const good = await checkBuildPathReady({ directPercent: 50, directLlm: llm, checkBroker: brokerUp });
  assert.equal(good.ready, true);
  assert.equal(good.mode, 'mixed');
});

test('build path: direct enabled without a direct client is not ready, with a reason', async () => {
  for (const pct of [50, 100]) {
    const out = await checkBuildPathReady({ directPercent: pct, directLlm: null, checkBroker: brokerUp });
    assert.equal(out.ready, false);
    assert.match(out.reason, /no direct LLM client/);
  }
});
