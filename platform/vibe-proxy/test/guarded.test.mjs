import test from 'node:test';
import assert from 'node:assert/strict';
import { guardedProxy } from '../guarded.js';
import { createLimiter, memoryStore } from '../limits.js';
import { createMeter, summarize } from '../meter.js';

const SECRET = 'S3cr3tValueXYZ';
const manifest = { connectors: { weather: { host: 'api.open-meteo.com', paths: ['/v1/forecast'], methods: ['GET'] }, keyed: { host: 'api.example.com', paths: ['/v1/x'], methods: ['GET'], secret: { name: 'K', in: 'query', field: 'key' } } } };
const resolve = async () => ['93.184.216.34'];

function rig(o = {}) {
    let t = Date.UTC(2026, 9, 5, 12, 0, 10);
    const now = () => t;
    const store = memoryStore({ now });
    const limiter = createLimiter({ store, now, perIpPerMin: 3, perAppPerMin: 100, dailyCalls: 1000, dailySpendMicros: 100, ...o.limits });
    const events = [];
    const meter = createMeter({ sink: o.sink || (async (e) => { events.push(e); }), now });
    const calls = [];
    const fetchImpl = o.fetchImpl || (async (url) => { calls.push(String(url)); return new Response('{"t":1}', { status: o.upstreamStatus || 200, headers: { 'content-type': 'application/json' } }); });
    const run = (req, extra = {}) => guardedProxy({ limiter, meter, appId: 'app1', ip: '1.1.1.1', req, manifest, secrets: { K: SECRET }, fetchImpl, resolve, callCostMicros: o.cost || 0, ...extra });
    return { run, events, calls, store, limiter };
}
const wreq = { connector: 'weather', method: 'GET', path: '/v1/forecast', query: { latitude: '1' } };

test('an allowed call returns the proxy result and records one usage event', async () => {
    const { run, events } = rig();
    const r = await run(wreq);
    assert.equal(r.status, 200);
    assert.equal(events.length, 1);
    assert.equal(events[0].appId, 'app1'); assert.equal(events[0].connector, 'weather'); assert.equal(events[0].status, 200); assert.equal(events[0].outcome, 'ok');
    assert.ok(events[0].responseBytes > 0 && events[0].ms >= 0 && events[0].day === '2026-10-05');
});

test('a rate-limited call is 429 with retry-after, never reaches the upstream, and is metered as denied', async () => {
    const { run, events, calls } = rig();
    for (let i = 0; i < 3; i++) await run(wreq);
    const r = await run(wreq);
    assert.equal(r.status, 429);
    assert.equal(r.headers['retry-after'], '50');
    assert.equal(calls.length, 3);
    assert.equal(events.at(-1).outcome, 'rate_limited_ip');
});

test('a killed app is 403 and an unavailable limiter is 503', async () => {
    const a = rig(); await a.store.set('kill:app1', 1);
    assert.equal((await a.run(wreq)).status, 403);
    const b = await (async () => { const { run } = rig(); return run(wreq, { limiter: { check: async () => ({ ok: false, reason: 'limiter_unavailable', retryAfterSec: 30 }) } }); })();
    assert.equal(b.status, 503);
});

test('a failing usage sink never breaks the request', async () => {
    const { run } = rig({ sink: async () => { throw new Error('db down'); } });
    assert.equal((await run(wreq)).status, 200);
});

test('usage events never contain secrets, query values or bodies', async () => {
    const { run, events } = rig();
    await run({ connector: 'keyed', method: 'GET', path: '/v1/x', query: { city: 'Springfield-Private' } });
    const text = JSON.stringify(events);
    assert.equal(text.includes(SECRET), false);
    assert.equal(text.includes('Springfield-Private'), false);
});

test('a successful call with a per-call cost adds to spend, and the cap then blocks the next call', async () => {
    const { run, events } = rig({ cost: 60, limits: { perIpPerMin: 100 } });
    assert.equal((await run(wreq)).status, 200);
    assert.equal((await run(wreq)).status, 200);
    const r = await run(wreq);
    assert.equal(r.status, 429);
    assert.equal(events.at(-1).outcome, 'spend_cap');
});

test('a failed upstream call is not charged', async () => {
    const { run } = rig({ cost: 60, upstreamStatus: 500, limits: { perIpPerMin: 100 } });
    for (let i = 0; i < 5; i++) assert.equal((await run(wreq)).status, 500);
});

test('summarize groups events per connector with calls, errors and bytes', () => {
    const ev = (c, status, b) => ({ connector: c, status, outcome: status < 400 ? 'ok' : 'error', responseBytes: b });
    assert.deepEqual(summarize([ev('weather', 200, 10), ev('weather', 502, 5), ev('keyed', 200, 7)]), {
        weather: { calls: 2, errors: 1, responseBytes: 15 },
        keyed: { calls: 1, errors: 0, responseBytes: 7 },
    });
});
