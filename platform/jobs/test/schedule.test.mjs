import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRunAt, dayStartMs, backoffMs, EVERY_MS } from '../schedule.js';

const T = Date.UTC(2026, 9, 5, 10, 30, 0);
test('every schedules add exactly the interval', () => {
    assert.equal(nextRunAt({ every: '15m' }, T), T + 15 * 60_000);
    assert.equal(nextRunAt({ every: '1h' }, T), T + 3_600_000);
    assert.equal(nextRunAt({ every: '6h' }, T), T + 6 * 3_600_000);
    assert.equal(nextRunAt({ every: '1d' }, T), T + 86_400_000);
    assert.deepEqual(Object.keys(EVERY_MS), ['15m', '1h', '6h', '1d']);
});
test('dailyAt picks the next occurrence strictly after now, in UTC', () => {
    assert.equal(nextRunAt({ dailyAt: '11:00', tz: 'UTC' }, T), Date.UTC(2026, 9, 5, 11, 0));
    assert.equal(nextRunAt({ dailyAt: '09:15', tz: 'UTC' }, T), Date.UTC(2026, 9, 6, 9, 15));
    assert.equal(nextRunAt({ dailyAt: '10:30', tz: 'UTC' }, T), Date.UTC(2026, 9, 6, 10, 30), 'exactly now means tomorrow');
    assert.equal(nextRunAt({ dailyAt: '00:00', tz: 'UTC' }, Date.UTC(2026, 11, 31, 23, 59)), Date.UTC(2027, 0, 1, 0, 0));
});
test('dayStartMs truncates to 00:00 UTC', () => {
    assert.equal(dayStartMs(T), Date.UTC(2026, 9, 5));
    assert.equal(dayStartMs(Date.UTC(2026, 9, 5, 23, 59, 59)), Date.UTC(2026, 9, 5));
});
test('backoff doubles from 5 minutes and caps at 6 hours', () => {
    assert.deepEqual([1, 2, 3, 4].map(backoffMs), [300_000, 600_000, 1_200_000, 2_400_000]);
    assert.equal(backoffMs(30), 6 * 3_600_000);
});
