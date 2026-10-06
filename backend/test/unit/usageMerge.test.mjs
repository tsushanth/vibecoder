import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeUsageReports, cleanReport } from '../../lib/usageMerge.js';

const cell = (calls, extra = {}) => ({ calls, errors: 0, bytes: 0, rows: 0, ms: 0, spendMicros: 0, ...extra });
const rep = (days, limits, usage) => ({ days, totals: days.reduce((t, d) => { for (const [k, m] of Object.entries(d.byKind)) { t[k] = t[k] || cell(0); for (const f of Object.keys(m)) t[k][f] += m[f]; } return t; }, {}), limits, usage });

test('days and totals are summed across a project\'s apps; limits and usage come from the last (published) app', () => {
    const preview = rep([{ day: '2026-10-05', byKind: { db: cell(2) } }, { day: '2026-10-06', byKind: { db: cell(1, { errors: 1 }) } }], { rowCap: 100 }, { rows: 7 });
    const published = rep([{ day: '2026-10-05', byKind: { db: cell(5), ai: cell(1, { spendMicros: 900 }) } }, { day: '2026-10-06', byKind: {} }], { rowCap: 20000 }, { rows: 50 });
    const m = mergeUsageReports([preview, published]);
    assert.deepEqual(m.days.map((d) => d.day), ['2026-10-05', '2026-10-06']);
    assert.equal(m.days[0].byKind.db.calls, 7); assert.equal(m.days[0].byKind.ai.spendMicros, 900);
    assert.equal(m.days[1].byKind.db.errors, 1);
    assert.equal(m.totals.db.calls, 8); assert.equal(m.totals.db.errors, 1);
    assert.deepEqual(m.limits, { rowCap: 20000 }); assert.deepEqual(m.usage, { rows: 50 });
    assert.equal(m.apps, 2);
});

test('no apps merges to an empty, well-formed answer', () => {
    assert.deepEqual(mergeUsageReports([]), { days: [], totals: {}, limits: {}, usage: {}, apps: 0 });
});

test('only numbers survive: strings, nested junk, bad days and odd names are dropped or zeroed', () => {
    const dirty = {
        days: [{ day: '2026-10-06', byKind: { db: { calls: 3, errors: '2', bytes: -4, rows: NaN, ms: 5, spendMicros: 1, email: 'a@b.c' }, 'bad kind!': cell(9), ai: 'oops' } }, { day: 'yesterday', byKind: { db: cell(1) } }, null],
        totals: { db: { calls: 3, secret: 'x' } },
        limits: { rowCap: 100, evil: 'x', 'bad name': 5 }, usage: { rows: 'ten', files: 4, storageBytes: null, callsToday: -3 },
    };
    const c = cleanReport(dirty);
    assert.deepEqual(c.days, [{ day: '2026-10-06', byKind: { db: { calls: 3, errors: 0, bytes: 0, rows: 0, ms: 5, spendMicros: 1 } } }]);
    assert.deepEqual(c.totals, { db: { calls: 3, errors: 0, bytes: 0, rows: 0, ms: 0, spendMicros: 0 } });
    assert.deepEqual(c.limits, { rowCap: 100, evil: 0 });
    assert.deepEqual(c.usage, { rows: null, files: 4, storageBytes: null, callsToday: null });
    assert.ok(!JSON.stringify(c).includes('a@b.c'));
    assert.deepEqual(cleanReport(undefined), { days: [], totals: {}, limits: {}, usage: {} });
    assert.deepEqual(cleanReport({ days: 'x', totals: 5 }), { days: [], totals: {}, limits: {}, usage: {} });
});

test('days come back sorted even when the apps list them differently', () => {
    const a = rep([{ day: '2026-10-06', byKind: {} }, { day: '2026-10-05', byKind: {} }], {}, {});
    assert.deepEqual(mergeUsageReports([a]).days.map((d) => d.day), ['2026-10-05', '2026-10-06']);
});
