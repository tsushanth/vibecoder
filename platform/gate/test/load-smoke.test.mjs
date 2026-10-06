// Small, fast version of the load gate (gate/load.mjs) so connection-budget regressions fail in CI. Real proxy in its own process,
// real local Postgres, restricted login with `connection limit 8`, production pool settings. Needs a local Postgres; skips without one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLoad } from '../load.mjs';

const POOL = 5, ROLE_LIMIT = 8;
const statuses = (res) => { const all = {}; for (const s of res.steps) for (const [k, v] of Object.entries(s.byStatus)) all[k] = (all[k] || 0) + v; return all; };

test('light load: every request succeeds, Postgres connections stay within the pool and the role limit, nothing leaks', { timeout: 120000 }, async (t) => {
    const res = await runLoad({ steps: [3, 12], apps: 2, usersPerApp: 4, extLatencyMs: 5, durationMs: 1500, settleMs: 500 });
    if (res.unavailable) return t.skip(res.unavailable);
    assert.equal(res.roleConnLimit, ROLE_LIMIT, 'the proxy logs in as a role created with connection limit 8, as in production');
    for (const s of res.steps) {
        assert.ok(s.requests > 50, `${s.label}: only ${s.requests} requests`);
        assert.equal(s.fiveXX, 0, `${s.label}: 5xx ${JSON.stringify(s.byStatus)}`);
        assert.equal(s.timeoutsOrNetErrors, 0);
        assert.ok(s.pg.maxConnections >= 1 && s.pg.maxConnections <= POOL, `${s.label}: ${s.pg.maxConnections} Postgres connections (pool ${POOL})`);
        assert.ok(s.pool.maxTotal <= POOL);
        assert.ok(s.pg.maxConnections <= ROLE_LIMIT);
    }
    assert.deepEqual(res.recovery.failures, []);
    assert.equal(res.recovery.leakedClients, 0); assert.equal(res.recovery.queued, 0);
    for (const [op, n] of Object.entries(res.statementsPerOp)) assert.ok(n >= 3 && n <= 40, `${op} costs ${n} statements`);
});

test('overload: a tiny in-flight cap and a slow database give clean 503s, never 500s or hangs, and the proxy recovers at once', { timeout: 120000 }, async (t) => {
    const res = await runLoad({ steps: [80], apps: 2, usersPerApp: 4, extLatencyMs: 5, dbLatencyMs: 4, maxInflight: 8, durationMs: 3000, settleMs: 300 });
    if (res.unavailable) return t.skip(res.unavailable);
    const st = statuses(res);
    assert.ok(st[503] > 0, `no request was shed: ${JSON.stringify(st)}`);
    assert.ok(st[200] > 0);
    for (const k of Object.keys(st)) assert.ok(['200', '429', '503'].includes(k), `unexpected outcome ${k}: ${JSON.stringify(st)}`);
    assert.ok(res.steps[0].latencyMs.p99 < 3000, `p99 ${res.steps[0].latencyMs.p99} ms`);
    assert.ok(res.steps[0].pg.maxConnections <= POOL);
    assert.deepEqual(res.recovery.failures, []);
    assert.equal(res.recovery.leakedClients, 0); assert.equal(res.recovery.queued, 0);
    assert.ok(res.recovery.p95 < 500, `recovery p95 ${res.recovery.p95} ms`);
});
