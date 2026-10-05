import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowLimiter } from '../../lib/rateWindow.js';

const clock = (t = 1_000_000) => ({ now: () => t, advance: (ms) => { t += ms; } });

test('allows up to max events per key in the window, then refuses', () => {
    const c = clock(); const l = createWindowLimiter({ windowMs: 60_000, max: 3, now: c.now });
    assert.deepEqual([l.hit('a'), l.hit('a'), l.hit('a'), l.hit('a')], [true, true, true, false]);
});

test('keys are independent', () => {
    const c = clock(); const l = createWindowLimiter({ windowMs: 60_000, max: 1, now: c.now });
    assert.equal(l.hit('a'), true); assert.equal(l.hit('b'), true); assert.equal(l.hit('a'), false);
});

test('events expire out of the window (sliding), so the key recovers', () => {
    const c = clock(); const l = createWindowLimiter({ windowMs: 60_000, max: 2, now: c.now });
    l.hit('a'); c.advance(30_000); l.hit('a');
    assert.equal(l.hit('a'), false);
    c.advance(31_000);                       // the first event is now 61 s old
    assert.equal(l.hit('a'), true);
    assert.equal(l.hit('a'), false);
});

test('a refused hit is not counted, so it does not extend the lockout', () => {
    const c = clock(); const l = createWindowLimiter({ windowMs: 60_000, max: 1, now: c.now });
    l.hit('a'); c.advance(59_000); assert.equal(l.hit('a'), false); c.advance(2_000);
    assert.equal(l.hit('a'), true);
});

test('count reports events in the window without adding one, and retryAfterMs says when a slot frees up', () => {
    const c = clock(); const l = createWindowLimiter({ windowMs: 60_000, max: 2, now: c.now });
    l.hit('a'); c.advance(10_000); l.hit('a');
    assert.equal(l.count('a'), 2); assert.equal(l.count('a'), 2);
    assert.equal(l.retryAfterMs('a'), 50_000);
    assert.equal(l.retryAfterMs('never'), 0);
});

test('memory is bounded: oldest keys are dropped past maxKeys', () => {
    const c = clock(); const l = createWindowLimiter({ windowMs: 60_000, max: 1, maxKeys: 3, now: c.now });
    for (const k of ['a', 'b', 'c', 'd']) l.hit(k);
    assert.equal(l.size(), 3);
    assert.equal(l.hit('a'), true, 'the evicted key starts fresh');
});

test('expired keys are removed by sweep', () => {
    const c = clock(); const l = createWindowLimiter({ windowMs: 1_000, max: 1, now: c.now });
    l.hit('a'); l.hit('b'); c.advance(2_000); l.sweep();
    assert.equal(l.size(), 0);
});

test('an event exactly one window old has expired', () => {
    const c = clock(); const l = createWindowLimiter({ windowMs: 60_000, max: 1, now: c.now });
    l.hit('a'); c.advance(59_999); assert.equal(l.hit('a'), false);
    c.advance(1); assert.equal(l.hit('a'), true);
});

test('eviction drops the least recently used key, not the oldest-inserted one', () => {
    const c = clock(); const l = createWindowLimiter({ windowMs: 60_000, max: 2, maxKeys: 3, now: c.now });
    l.hit('a'); l.hit('b'); l.hit('c');
    l.hit('a');                               // a is now the most recently used
    l.hit('d');                               // evicts b, not a
    assert.equal(l.count('a'), 2, 'a must have survived'); assert.equal(l.count('b'), 0, 'b must have been evicted');
});
