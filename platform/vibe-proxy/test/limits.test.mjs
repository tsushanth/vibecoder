import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, memoryStore } from '../limits.js';

function setup(opts = {}) {
    let t = Date.UTC(2026, 9, 5, 12, 0, 10);
    const clock = { now: () => t, advance: (ms) => { t += ms; } };
    const store = memoryStore({ now: clock.now });
    const limiter = createLimiter({ store, now: clock.now, perIpPerMin: 3, perAppPerMin: 5, dailyCalls: 8, dailySpendMicros: 1000, ...opts });
    return { clock, store, limiter };
}
const call = (l, o = {}) => l.check({ appId: 'app1', ip: '1.1.1.1', ...o });

test('allows requests up to the per-IP limit then blocks with a retry time', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i++) assert.equal((await call(limiter)).ok, true);
    const r = await call(limiter);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'rate_limited_ip');
    assert.equal(r.retryAfterSec, 50); // window started at :00, now :10
});

test('the window resets after a minute', async () => {
    const { limiter, clock } = setup();
    for (let i = 0; i < 4; i++) await call(limiter);
    clock.advance(60_000);
    assert.equal((await call(limiter)).ok, true);
});

test('a noisy IP cannot use up the app budget for other IPs', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 50; i++) await call(limiter, { ip: '9.9.9.9' });
    assert.equal((await call(limiter, { ip: '2.2.2.2' })).ok, true);
});

test('the per-app limit applies across different IPs', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i++) assert.equal((await call(limiter, { ip: `3.3.3.${i}` })).ok, true);
    const r = await call(limiter, { ip: '3.3.3.99' });
    assert.equal(r.ok, false); assert.equal(r.reason, 'rate_limited_app');
});

test('apps do not share budgets', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i++) await call(limiter, { ip: `4.4.4.${i}` });
    assert.equal((await call(limiter, { appId: 'app2', ip: '4.4.4.200' })).ok, true);
});

test('a killed app is always blocked, even with budget left', async () => {
    const { limiter, store } = setup();
    await store.set('kill:app1', 1);
    const r = await call(limiter);
    assert.equal(r.ok, false); assert.equal(r.reason, 'app_disabled');
});

test('the daily call cap blocks once reached and resets the next day', async () => {
    const { limiter, clock } = setup({ perIpPerMin: 1000, perAppPerMin: 1000 });
    for (let i = 0; i < 8; i++) assert.equal((await call(limiter)).ok, true);
    const r = await call(limiter);
    assert.equal(r.ok, false); assert.equal(r.reason, 'daily_call_cap');
    clock.advance(24 * 3600_000);
    assert.equal((await call(limiter)).ok, true);
});

test('the daily spend cap blocks once recorded spend reaches it', async () => {
    const { limiter } = setup();
    assert.equal((await call(limiter)).ok, true);
    await limiter.recordSpend({ appId: 'app1', micros: 1000 });
    const r = await call(limiter, { ip: '5.5.5.5' });
    assert.equal(r.ok, false); assert.equal(r.reason, 'spend_cap');
});

test('spend below the cap does not block', async () => {
    const { limiter } = setup();
    await limiter.recordSpend({ appId: 'app1', micros: 999 });
    assert.equal((await call(limiter)).ok, true);
});

test('if the store fails the limiter fails closed', async () => {
    const store = { incr: async () => { throw new Error('db down'); }, get: async () => { throw new Error('db down'); }, set: async () => {}, add: async () => {} };
    const limiter = createLimiter({ store });
    const r = await limiter.check({ appId: 'a', ip: '1.1.1.1' });
    assert.equal(r.ok, false); assert.equal(r.reason, 'limiter_unavailable');
});

test('a missing app id or ip is refused rather than shared into one bucket', async () => {
    const { limiter } = setup();
    assert.equal((await limiter.check({ appId: '', ip: '1.1.1.1' })).ok, false);
    assert.equal((await limiter.check({ appId: 'a', ip: '' })).ok, false);
});

test('limitsFor overrides the daily call cap per app, and other apps keep the default', async () => {
    const { limiter } = setup({ perIpPerMin: 100, perAppPerMin: 100, limitsFor: async (id) => (id === 'app1' ? { dailyCalls: 2 } : {}) });
    assert.equal((await call(limiter)).ok, true); assert.equal((await call(limiter)).ok, true);
    assert.equal((await call(limiter)).reason, 'daily_call_cap');
    for (let i = 0; i < 8; i++) assert.equal((await call(limiter, { appId: 'app2' })).ok, true);
    assert.equal((await call(limiter, { appId: 'app2' })).reason, 'daily_call_cap');
});

test('limitsFor overrides the daily AI spend cap, including 0 (no AI spend at all)', async () => {
    const { limiter } = setup({ limitsFor: async () => ({ dailySpendMicros: 0 }) });
    assert.equal((await call(limiter)).reason, 'spend_cap');
    const b = setup({ limitsFor: async () => ({ dailySpendMicros: 500 }) });
    assert.equal((await call(b.limiter)).ok, true);
    await b.limiter.recordSpend({ appId: 'app1', micros: 500 });
    assert.equal((await call(b.limiter)).reason, 'spend_cap');
});

test('a throwing limitsFor fails closed (limiter_unavailable), never open', async () => {
    const { limiter } = setup({ limitsFor: async () => { throw new Error('x'); } });
    assert.equal((await call(limiter)).reason, 'limiter_unavailable');
});

test('junk override values (strings, floats) are ignored in favour of the defaults', async () => {
    const { limiter } = setup({ perIpPerMin: 100, perAppPerMin: 100, dailyCalls: 2, limitsFor: async () => ({ dailyCalls: '999', dailySpendMicros: 1.5 }) });
    await call(limiter); await call(limiter);
    assert.equal((await call(limiter)).reason, 'daily_call_cap');
    const b = setup({ dailySpendMicros: 1000, limitsFor: async () => ({ dailySpendMicros: 1.5 }) });
    await b.limiter.recordSpend({ appId: 'app1', micros: 2 });
    assert.equal((await call(b.limiter)).ok, true);
});
