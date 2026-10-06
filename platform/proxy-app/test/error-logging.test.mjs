import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler } from '../server.js';
import { createLimiter, memoryStore } from '../../vibe-proxy/limits.js';

async function boot(appStore) {
    const logs = [];
    const mk = () => createLimiter({ store: memoryStore(), perIpPerMin: 100, perAppPerMin: 100, dailyCalls: 1000, dailySpendMicros: 1e6 });
    const handler = createHandler({ appStore, secretStore: { get: async () => undefined }, limiter: mk(), globalAiLimiter: mk(), meter: { record: async () => {} }, fetchImpl: async () => new Response('{}'), resolve: async () => ['93.184.216.34'], openRouterKey: 'k', log: (l) => logs.push(l), baseDomain: 'vibebuild.cc' });
    const server = http.createServer(handler); await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return { logs, port: server.address().port, close: () => server.close() };
}
const call = (s, path = '/app1/api') => fetch(`http://127.0.0.1:${s.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'fly-client-ip': '1.2.3.4' }, body: '{"connector":"nws","method":"GET","path":"/x"}' });
const parsed = (logs) => logs.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

test('an unexpected failure answers 500 and logs the app, route, error name and code, never the message', async () => {
    const SECRET = 'sk_test_' + 'x'.repeat(24);
    const err = Object.assign(new Error(`insert failed for value ${SECRET}`), { name: 'DatabaseError', code: '42501' });
    const s = await boot({ get: async () => { throw err; } });
    try {
        const r = await call(s); assert.equal(r.status, 500); assert.deepEqual(await r.json(), { error: 'internal' });
        const e = parsed(s.logs).find((l) => l.event === 'error');
        assert.deepEqual({ event: e.event, appId: e.appId, route: e.route, name: e.name, code: e.code }, { event: 'error', appId: 'app1', route: 'api', name: 'DatabaseError', code: '42501' });
        assert.equal(s.logs.join('\n').includes(SECRET), false); assert.equal(s.logs.join('\n').includes('insert failed'), false);
    } finally { s.close(); }
});

test('a hostile code or name is sanitized, and a missing code is omitted', async () => {
    const s = await boot({ get: async () => { throw Object.assign(new Error('x'), { name: 'N'.repeat(200), code: 'bad code; drop' }); } });
    try { await call(s); const e = parsed(s.logs).find((l) => l.event === 'error'); assert.equal(e.name.length, 40); assert.equal(e.code, undefined); } finally { s.close(); }
    const t = await boot({ get: async () => { throw 'plain string'; } });
    try { await call(t); const e = parsed(t.logs).find((l) => l.event === 'error'); assert.equal(e.name, 'Error'); assert.equal(e.code, undefined); } finally { t.close(); }
});

test('normal requests log no error event', async () => {
    const s = await boot({ get: async () => null });
    try { assert.equal((await call(s)).status, 404); assert.equal(parsed(s.logs).some((l) => l.event === 'error'), false); } finally { s.close(); }
});
