import './../helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { markProjectFailed, safeContext, sanitizeReason, FAIL_CLASS, _deps, _resetWarnings } from '../../lib/buildFailure.js';
import { createFailureRateMonitor } from '../../lib/buildFailureRate.js';
import { makeBuilder } from '../helpers/supabaseStub.mjs';

const client = (handler) => ({ from: (t) => makeBuilder(t, handler) });

test('the stable classes are exactly the agreed vocabulary', () => {
    assert.deepEqual(Object.keys(FAIL_CLASS).sort(), ['DISPATCH_ERROR', 'NO_RESULT', 'PLAN_LLM', 'RETRY_EXHAUSTED', 'TIMEOUT_STUCK', 'UNKNOWN', 'WORKER_ERROR']);
});

test('safeContext keeps short plain tokens and drops free text, emails, ids and unknown keys', () => {
    assert.deepEqual(safeContext({ phase: 'dispatch', httpStatus: 502, attempt: 3, planTier: 'free', prompt: 'build me an app', userId: 'u1' }), { phase: 'dispatch', http_status: '502', attempt: '3', plan_tier: 'free' });
    assert.deepEqual(safeContext({ phase: 'a@b.com', path: 'make me a todo app, please do it now and quickly' }), {});
});

test('sanitizeReason masks quotes, urls, emails, uuids and long tokens, and caps the length', () => {
    assert.equal(sanitizeReason('failed for "my secret idea" at https://a.b/c by me@x.io'), 'failed for [text] at [url] by [email]');
    assert.equal(sanitizeReason('id 123e4567-e89b-12d3-a456-426614174000 tok abcdefghijklmnopqrstuvwxyz0123'), 'id [id] tok [token]');
    assert.equal(sanitizeReason('x'.repeat(500)).length <= 120, true);
    assert.equal(sanitizeReason(undefined), '');
});

test('markProjectFailed: reports once before writing, writes status then reason; an unknown class becomes UNKNOWN', async () => {
    const seen = []; const ops = [];
    _deps.report = (f, e, c) => seen.push([f, e.message, c]);
    const db = client((q) => { ops.push(q.payload); return { data: null, error: null }; });
    await markProjectFailed(db, 'p1', 'NOT_A_CLASS', { phase: 'x' });
    assert.deepEqual(seen, [['build_failed', 'UNKNOWN', { phase: 'x' }]]);
    assert.deepEqual(ops, [{ status: 'failed' }, { error_reason: 'UNKNOWN' }]);
});

test('markProjectFailed: a throwing reporter or a failing reason write never breaks the status write; a failing status write skips the reason', async () => {
    const ops = []; _resetWarnings(); const w = console.warn; console.warn = () => {};
    try {
        _deps.report = () => { throw new Error('reporter down'); };
        await markProjectFailed(client((q) => { ops.push(q.payload); return q.payload.error_reason ? { error: { code: 'PGRST204', message: 'Could not find the error_reason column' } } : { error: null }; }), 'p1', 'NO_RESULT');
        assert.deepEqual(ops, [{ status: 'failed' }, { error_reason: 'NO_RESULT' }]);
        ops.length = 0;
        await markProjectFailed(client((q) => { ops.push(q.payload); return { error: { code: 'XX', message: 'db down' } }; }), 'p1', 'NO_RESULT');
        assert.deepEqual(ops, [{ status: 'failed' }]);
        ops.length = 0;
        await markProjectFailed(client((q) => { ops.push(q.payload); if (q.payload.error_reason) throw new Error('boom'); return { error: null }; }), 'p1', 'NO_RESULT');
        assert.equal(ops.length, 2);
    } finally { console.warn = w; }
});

// ---- failure-rate signal ----
const HOUR = 3600_000;
function rate({ total, failed, t = { now: 1_000_000_000_000 } }) {
    const calls = [];
    const db = client((q) => {
        const statuses = q.filters.find((f) => f[0] === 'in')?.[2]; calls.push(q.filters);
        return { count: statuses.length === 1 ? failed : total, error: null };
    });
    const reports = [];
    const monitor = createFailureRateMonitor({ supabase: db, report: (f, e, c) => reports.push({ f, m: e.message, c }), now: () => t.now });
    return { monitor, reports, t, calls };
}

test('rate signal: fires above 40% with at least 5 builds, counts only, filtered to ai_generated and the 6 h window', async () => {
    const { monitor, reports, calls } = rate({ total: 10, failed: 5 });
    const r = await monitor.check();
    assert.equal(r.alerted, true); assert.equal(reports.length, 1);
    assert.deepEqual(reports[0], { f: 'build_failure_rate', m: 'BUILD_FAILURE_RATE_HIGH', c: { failed: '5', total: '10', rate_pct: '50', window_hours: '6' } });
    assert.ok(calls.every((f) => f.some((x) => x[0] === 'eq' && x[1] === 'creation_method' && x[2] === 'ai_generated')));
    assert.equal(new Date(calls[0].find((x) => x[0] === 'gte')[2]).getTime(), 1_000_000_000_000 - 6 * HOUR);
});

test('rate signal: silent at exactly 40%, below 5 builds, or when counts cannot be read', async () => {
    for (const [total, failed] of [[10, 4], [4, 4], [0, 0], [100, 10]]) {
        const { monitor, reports } = rate({ total, failed }); assert.equal((await monitor.check()).alerted, false); assert.equal(reports.length, 0);
    }
    const bad = createFailureRateMonitor({ supabase: client(() => ({ count: null, error: { message: 'x' } })), report: () => assert.fail('must not report') });
    const w = console.warn; console.warn = () => {}; try { assert.equal(await bad.check(), null); } finally { console.warn = w; }
});

test('rate signal: one alert per 6 hours, then again after the throttle', async () => {
    const { monitor, reports, t } = rate({ total: 10, failed: 9 });
    await monitor.check(); t.now += 5 * HOUR; await monitor.check(); await monitor.check();
    assert.equal(reports.length, 1);
    t.now += 1 * HOUR + 1; await monitor.check();
    assert.equal(reports.length, 2);
});

test('rate signal: a quiet check does not start the throttle', async () => {
    const t = { now: 5_000_000_000_000 }; let failed = 1; const reports = [];
    const db = client((q) => ({ count: q.filters.find((f) => f[0] === 'in')[2].length === 1 ? failed : 10, error: null }));
    const m = createFailureRateMonitor({ supabase: db, report: (f) => reports.push(f), now: () => t.now });
    await m.check(); failed = 8; await m.check(); assert.equal(reports.length, 1);
});
