// Admission control: past MAX_INFLIGHT requests being served, new ones are refused at once with 503 + Retry-After rather than queueing
// for a database connection. Regression test for the load gate finding: the pool queue is unbounded, so overload hung requests for
// tens of seconds, then 500s, and the backlog kept the connections busy long after callers gave up.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler } from '../server.js';
import { createLimiter, memoryStore } from '../../vibe-proxy/limits.js';
import { createMeter } from '../../vibe-proxy/meter.js';

function boot({ maxInflight }) {
    const gates = []; let failNext = false;
    const limiter = createLimiter({ store: memoryStore(), perIpPerMin: 100000, perAppPerMin: 100000, dailyCalls: 1e9, dailySpendMicros: 1e9 });
    const handler = createHandler({
        // every app lookup waits on a gate the test opens, standing in for a request queued behind a busy database
        appStore: { get: (id) => (failNext ? (failNext = false, Promise.reject(new Error('db down'))) : new Promise((ok) => gates.push(() => ok({ enabled: true, domains: [], manifest: { connectors: {} } })))) },
        secretStore: { get: async () => undefined }, limiter, globalAiLimiter: limiter, meter: createMeter({ sink: async () => {} }),
        fetchImpl: async () => new Response('{}'), resolve: async () => ['93.184.216.34'], openRouterKey: 'k', log: () => {}, baseDomain: 'vibebuild.cc', maxInflight,
    });
    const server = http.createServer(handler);
    return new Promise((ok) => server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const call = (path, method = 'POST') => fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', 'fly-client-ip': '7.7.7.7' }, body: method === 'POST' ? JSON.stringify({ connector: 'nope', method: 'GET', path: '/' }) : undefined });
        ok({ call, gates, fail: () => { failNext = true; }, close: () => { server.closeAllConnections(); server.close(); } });
    }));
}
const until = async (f) => { for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 5)); assert.ok(f(), 'condition not reached'); };

test('requests beyond the cap get 503 + Retry-After immediately; admitted ones finish; the slot frees afterwards', { timeout: 15000 }, async () => {
    const s = await boot({ maxInflight: 2 });
    try {
        const held = [s.call('/app1/api'), s.call('/app1/api')];
        await until(() => s.gates.length === 2);
        const t0 = Date.now();
        const refused = await Promise.all([s.call('/app1/api'), s.call('/app1/db'), s.call('/app1/auth/me')]);
        assert.ok(Date.now() - t0 < 1000, 'refusal does not wait for the database');
        for (const r of refused) { assert.equal(r.status, 503); assert.equal(r.headers.get('retry-after'), '1'); assert.deepEqual(await r.json(), { error: 'overloaded' }); }
        assert.equal(s.gates.length, 2, 'refused requests did no database work');
        assert.equal((await s.call('/health', 'GET')).status, 200, 'health is never refused');
        assert.equal((await s.call('/admin/apps/app1', 'GET')).status, 404, 'admin is never refused (no admin configured here: 404, not 503)');
        s.gates.forEach((g) => g());
        for (const r of await Promise.all(held)) assert.equal(r.status, 404); // unknown connector: the request really ran
        const next = s.call('/app1/api'); await until(() => s.gates.length === 3); s.gates[2]();
        assert.equal((await next).status, 404, 'slots are released once requests finish');
    } finally { s.close(); }
});

test('a request that fails with an error releases its slot', async () => {
    const s = await boot({ maxInflight: 1 });
    try {
        s.fail();
        assert.equal((await s.call('/app1/api')).status, 500);
        const ok = s.call('/app1/api'); await until(() => s.gates.length === 1); s.gates[0]();
        assert.equal((await ok).status, 404);
    } finally { s.close(); }
});

test('without a cap nothing is refused', async () => {
    const s = await boot({});
    try {
        const all = Array.from({ length: 20 }, () => s.call('/app1/api')); await until(() => s.gates.length === 20); s.gates.forEach((g) => g());
        for (const r of await Promise.all(all)) assert.equal(r.status, 404);
    } finally { s.close(); }
});
