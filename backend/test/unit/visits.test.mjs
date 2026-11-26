import '../helpers/env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createVisitsRouter } from '../../routes/visits.routes.js';
import { ownerToken, ownerUrl } from '../../lib/ownerVisit.js';
import { listen } from '../helpers/http.mjs';

// The same vector is checked in deploy-server/test/visits.test.mjs: the two sides must agree.
test('owner link signature matches the deploy server', () => {
    assert.equal(ownerToken('shared-test-secret', 'my-app', 1800000000), '1800000000.8fvb4gcmfibqGkGhBO_4ncfq7sio-9v1');
    const u = new URL(ownerUrl('shared-test-secret', 'https://my-app.vibebuild.cc', 'my-app', (1800000000 - 86400) * 1000));
    assert.equal(u.searchParams.get('vb_own'), ownerToken('shared-test-secret', 'my-app', 1800000000));
});

async function serve({ user = 'u1', rows = [], error = null } = {}) {
    const calls = []; const reports = [];
    const app = express();
    app.use('/api/visits', createVisitsRouter({ verifyUser: async () => user, secret: 's', report: (f) => reports.push(f), client: { rpc: async (...a) => { calls.push(a); return { data: rows, error }; } } }));
    const s = await listen(app);
    return { calls, reports, get: () => fetch(`${s.base}/api/visits?userId=someone-else`), close: s.close };
}

test('a creator sees counts for their own published apps only (identity from the token)', async () => {
    const s = await serve({ rows: [{ project_id: 'p1', subdomain: 'my-app', today: 2, last_7_days: '5', last_30_days: 6, total: 9 }] });
    const body = await (await s.get()).json();
    await s.close();
    assert.deepEqual(s.calls, [['vibebuild_creator_visits', { p_user: 'u1' }]]);
    const [a] = body.apps;
    assert.deepEqual([a.projectId, a.url, a.today, a.last7Days, a.last30Days, a.total], ['p1', 'https://my-app.vibebuild.cc', 2, 5, 6, 9]);
    assert.match(a.openUrl, /^https:\/\/my-app\.vibebuild\.cc\/\?vb_own=\d+\.[A-Za-z0-9_-]{32}$/);
    assert.equal(body.countingSince, '2026-11-26');
});

test('signed out is refused; a database error is reported and never shown as zero visits', async () => {
    const out = await serve({ user: null });
    assert.equal((await out.get()).status, 401);
    assert.equal(out.calls.length, 0);
    await out.close();
    const broken = await serve({ error: { code: '42883' } });
    assert.equal((await broken.get()).status, 503);
    assert.deepEqual(broken.reports, ['visits:read']);
    await broken.close();
});
