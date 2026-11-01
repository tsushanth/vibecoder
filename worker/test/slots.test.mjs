import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSlotTracker } from '../lib/slots.js';

test('acquire/release keep an exact count and full() trips at max', () => {
    const s = createSlotTracker(2);
    const a = s.acquire(), b = s.acquire();
    assert.equal(s.active, 2); assert.equal(s.full(), true);
    a(); assert.equal(s.active, 1); assert.equal(s.full(), false);
    b(); assert.equal(s.active, 0);
});

test('a double release (early-return path plus finally) does NOT steal another build\'s slot', () => {
    const anomalies = [];
    const s = createSlotTracker(2, (k) => anomalies.push(k));
    const running = s.acquire();          // a long build that is still going
    const failing = s.acquire();          // a build that releases on its error path and again in finally
    failing(); failing();
    assert.equal(s.active, 1, 'the running build still holds its slot');
    assert.deepEqual(anomalies, ['double_release']);
    running(); assert.equal(s.active, 0);
});

test('the counter can never go negative', () => {
    const s = createSlotTracker(1);
    const r = s.acquire(); r(); r(); r();
    assert.equal(s.active, 0);
});

test('server.js no longer decrements the counter by hand anywhere', () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js'), 'utf8');
    assert.ok(!/activeGenerations\s*(\+\+|--|=)/.test(src), 'hand-rolled counter arithmetic is back');
    assert.ok(!/Math\.max\(0,\s*activeGenerations/.test(src));
    assert.match(src, /createSlotTracker\(/);
});
