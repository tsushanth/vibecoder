import '../helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { makeBuilder } from '../helpers/supabaseStub.mjs';
import { _setSink } from '../../lib/failureReporter.js';
import { serverErrorReport } from '../../middleware/serverErrorReport.js';
import { errorHandler } from '../../middleware/errorHandler.js';
import { createBuildInvariantMonitor } from '../../lib/buildInvariants.js';

const sent = []; _setSink((r) => sent.push(r));
const quiet = (fn) => async () => { const e = console.error, w = console.warn; console.error = console.warn = () => {}; try { await fn(); } finally { console.error = e; console.warn = w; sent.length = 0; } };
const settle = () => new Promise((r) => setTimeout(r, 40));

test('5xx returned by a route without throwing is reported once, with the route pattern and no id', quiet(async () => {
    const app = express(); app.use(serverErrorReport());
    const r = express.Router();
    r.get('/:id/deploy', (req, res) => res.status(500).json({ error: 'secret detail' }));
    r.get('/:id/fine', (req, res) => res.json({}));
    r.get('/:id/missing', (req, res) => res.status(404).json({}));
    app.use('/api/projects', r);
    app.get('/api/health/deep', (req, res) => res.status(503).json({ ready: false }));
    const s = await listen(app);
    try {
        await fetch(`${s.base}/api/projects/abc-123-user-id/deploy`); await fetch(`${s.base}/api/projects/x/fine`); await fetch(`${s.base}/api/projects/x/missing`); await fetch(`${s.base}/api/health/deep`); await settle();
        assert.equal(sent.length, 1);
        assert.deepEqual(sent[0], { kind: 'backend_error', flow: 'GET /api/projects/:id/deploy', message: 'HTTP 500', context: { status: '500' } });
        assert.equal(JSON.stringify(sent).includes('abc-123'), false);
    } finally { await s.close(); }
}));

test('a thrown error reaches the error handler and is reported once, not twice', quiet(async () => {
    const app = express(); app.use(serverErrorReport());
    app.get('/boom/:id', (req, res, next) => next(new Error('db exploded')));
    app.use(errorHandler);
    const s = await listen(app);
    try {
        const res = await fetch(`${s.base}/boom/42`); await settle();
        assert.equal(res.status, 500);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].flow, 'GET /boom/:id'); assert.equal(sent[0].message, 'db exploded');
    } finally { await s.close(); }
}));

// ---- invariants
function fakeSupabase({ stuck = 0, attempts24 = 0, ready24 = 0, created = 0, ready = 0, failed = 0, error = null }) {
    return { from: (table) => makeBuilder(table, (q) => {
        if (error) return { count: null, error };
        const has = (n, v) => q.filters.some((f) => f[0] === n && (v === undefined || f[2] === v));
        let n;
        if (has('lt')) n = stuck;
        else if (has('eq', 'status') || q.filters.some((f) => f[0] === 'eq' && f[1] === 'status')) {
            const st = q.filters.find((f) => f[0] === 'eq' && f[1] === 'status')[2];
            const since = q.filters.find((f) => f[0] === 'gte')[2];
            const today = since.endsWith('T00:00:00.000Z');
            n = st === 'ready' ? (today ? ready : ready24) : (today ? failed : 0);
        } else n = q.filters.find((f) => f[0] === 'gte')[2].endsWith('T00:00:00.000Z') ? created : attempts24;
        return { count: n, error: null };
    }) };
}
const NOW = Date.parse('2026-10-30T12:00:00Z');
const mk = (counts, extra = {}) => { const reports = []; const usage = []; let t = NOW;
    const m = createBuildInvariantMonitor({ supabase: fakeSupabase(counts), report: (f, e, c) => reports.push({ f, m: e.message, c }), usage: (u) => usage.push(u), now: () => t, ...extra });
    return { m, reports, usage, advance: (ms) => { t += ms; } }; };

test('invariants: builds stuck past the cutoff alert once per throttle window, counts only', async () => {
    const { m, reports, advance } = mk({ stuck: 2, attempts24: 5, ready24: 3 });
    assert.deepEqual((await m.check()).alerts, ['BUILDS_STUCK']);
    assert.deepEqual(reports, [{ f: 'build_invariant', m: 'BUILDS_STUCK', c: { count: '2', older_than_min: '30' } }]);
    assert.deepEqual((await m.check()).alerts, []);
    advance(2 * 3600_000 + 1);
    assert.deepEqual((await m.check()).alerts, ['BUILDS_STUCK']);
});

test('invariants: attempts but zero ready in 24 h alerts; few attempts or any ready does not', async () => {
    let r = mk({ attempts24: 4, ready24: 0 }); await r.m.check();
    assert.deepEqual(r.reports.map((x) => x.m), ['BUILDS_NONE_READY']); assert.deepEqual(r.reports[0].c, { attempts_24h: '4', ready_24h: '0' });
    r = mk({ attempts24: 2, ready24: 0 }); await r.m.check(); assert.equal(r.reports.length, 0);
    r = mk({ attempts24: 9, ready24: 1 }); await r.m.check(); assert.equal(r.reports.length, 0);
});

test('invariants: pushes daily created/ready/failed counters; a read error never throws or alerts', quiet(async () => {
    let r = mk({ created: 7, ready: 5, failed: 2 }); await r.m.check();
    assert.deepEqual(r.usage[0], [{ metric: 'api.projects_created', value: 7, day: '2026-10-30' }, { metric: 'api.projects_ready', value: 5, day: '2026-10-30' }, { metric: 'api.projects_failed', value: 2, day: '2026-10-30' }]);
    r = mk({ error: { message: 'down' } }); assert.equal(await r.m.check(), null); assert.equal(r.reports.length, 0);
}));
