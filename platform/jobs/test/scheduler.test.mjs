import test from 'node:test';
import assert from 'node:assert/strict';
import { startScheduler } from '../scheduler.js';

const sleep = (n) => new Promise((r) => setTimeout(r, n));

test('ticks repeatedly on the interval and stops cleanly', async () => {
    let n = 0;
    const s = startScheduler({ tickMs: 20, tick: async () => { n++; } });
    await sleep(130);
    await s.stop();
    const after = n;
    assert.ok(after >= 3 && after <= 8, `ticked ${after} times`);
    await sleep(80);
    assert.equal(n, after, 'no ticks after stop');
});

test('nothing runs before the first interval', async () => {
    let n = 0;
    const s = startScheduler({ tickMs: 60, tick: async () => { n++; } });
    await sleep(25);
    assert.equal(n, 0);
    await s.stop();
});

test('ticks never overlap: a slow tick delays the next one', async () => {
    let active = 0; let peak = 0; let n = 0;
    const s = startScheduler({ tickMs: 10, tick: async () => { active++; peak = Math.max(peak, active); n++; await sleep(60); active--; } });
    await sleep(220);
    await s.stop();
    assert.equal(peak, 1); assert.ok(n >= 2 && n <= 4, `n=${n}`);
});

test('stop waits for the tick in flight and prevents any further tick', async () => {
    let finished = false; let n = 0;
    const s = startScheduler({ tickMs: 10, tick: async () => { n++; await sleep(80); finished = true; } });
    await sleep(30);
    await s.stop();
    assert.equal(finished, true);
    const seen = n;
    await sleep(60);
    assert.equal(n, seen);
});

test('stop is idempotent and works before the first tick', async () => {
    let n = 0;
    const s = startScheduler({ tickMs: 50, tick: async () => { n++; } });
    await s.stop(); await s.stop();
    await sleep(80);
    assert.equal(n, 0);
});

test('a throwing tick is reported and the loop keeps going; a throwing reporter does not kill it', async () => {
    const errors = []; let n = 0;
    const s = startScheduler({ tickMs: 15, tick: async () => { n++; throw new Error(`boom ${n}`); }, onError: (e) => { errors.push(e.message); if (n === 2) throw new Error('reporter broke'); } });
    await sleep(120);
    await s.stop();
    assert.ok(n >= 3, `ticked ${n}`);
    assert.deepEqual(errors.slice(0, 3), ['boom 1', 'boom 2', 'boom 3']);
});

test('a synchronously throwing tick is also contained', async () => {
    let n = 0;
    const s = startScheduler({ tickMs: 15, tick: () => { n++; throw new Error('sync'); } });
    await sleep(70);
    await s.stop();
    assert.ok(n >= 2);
});

test('bad arguments fail fast', () => {
    assert.throws(() => startScheduler({ tickMs: 100 }), /tick function/);
    assert.throws(() => startScheduler({ tick: async () => {}, tickMs: 0 }), /tickMs/);
    assert.throws(() => startScheduler({ tick: async () => {}, tickMs: 1.5 }), /tickMs/);
    assert.throws(() => startScheduler({ tick: async () => {}, tickMs: 5 }), /tickMs/);
    const s = startScheduler({ tick: async () => {} });
    return s.stop();
});
