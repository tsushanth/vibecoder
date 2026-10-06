import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { startServer } from '../start.js';
import { createPgStores } from '../../store/pg.js';
import { createDataExecutor } from '../../data/executor.js';
import { validateSpec } from '../../data/schema.js';
import { loadConfig } from '../config.js';

const ADMIN_T = 'admin-' + 'u'.repeat(40);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300)]);
const R2ENV = { R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'vibe-test-files', R2_ACCESS_KEY_ID: 'k'.repeat(32), R2_SECRET_ACCESS_KEY: 's'.repeat(64) };
const SPEC = validateSpec({ version: 1, tables: { notes: { access: 'owner', columns: { body: { type: 'text' } } }, readings: { access: 'public_read', columns: { temp: { type: 'number' } } } } }).spec;
const JOB = { id: 'wx', schedule: { every: '15m' }, action: { type: 'connector', connector: 'nws', method: 'GET', path: '/alerts/active', save: { table: 'readings', map: { temp: '/properties/temp' } } } };
const EMAIL = 'ann.private@example.com';
let db, skip, MK, srv, mails = [];
const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.startsWith('https://api.resend.com/')) { mails.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
    if (u.includes('.r2.cloudflarestorage.com')) return new Response('', { status: 200 });
    return new Response(JSON.stringify({ properties: { temp: 12.5 } }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const cfg = () => loadConfig({ DATABASE_URL: 'postgres://unused/x', VIBE_MASTER_KEY: MK, OPENROUTER_API_KEY: 'sk-or-v1-FAKE', BASE_DOMAIN: 'vibebuild.cc', PORT: '8080', PROXY_ADMIN_TOKEN: ADMIN_T, RESEND_API_KEY: 're_testkey12345', AUTH_MAIL_FROM: 'login@mail.vibebuild.cc', PER_IP_PER_MIN: '10000', PER_APP_PER_MIN: '10000', USAGE_FLUSH_MS: '0', JOBS_ENABLED: 'true', JOBS_TICK_MS: '1000', ...R2ENV });
before(async () => {
    db = await scratchDb(); if (db.unavailable) { skip = db.unavailable; return; }
    MK = masterKey();
    const stores = createPgStores({ pool: db.pool, masterKey: MK });
    const ex = createDataExecutor({ pool: db.pool });
    for (const a of ['usage-app', 'cap-app']) { await stores.upsertApp({ appId: a, enabled: true }); assert.equal((await ex.applySchema({ appId: a, spec: SPEC })).ok, true); }
    srv = await startServer(cfg(), { pool: db.pool, listenPort: 0, fetchImpl, resolve: async () => ['93.184.216.34'] });
});
after(async () => { await srv?.close(); if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); await f(c); });
const base = () => `http://127.0.0.1:${srv.port}`;
let ipn = 10; const ipHdr = () => ({ 'fly-client-ip': `9.5.${++ipn}.1` });
const post = (appId, path, body, token, extra = {}) => fetch(`${base()}/${appId}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...ipHdr(), ...extra }, body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
const signIn = async (appId, email) => {
    await post(appId, 'auth/request', { email });
    const link = new URL(/https:\/\/\S+/.exec(mails.at(-1).text)[0]).searchParams.get('vibe_login');
    return (await (await post(appId, 'auth/consume', { token: link })).json()).token;
};
const admin = (method, path, body, token = ADMIN_T) => fetch(`${base()}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'fly-client-ip': '8.8.4.4' }, body: body === undefined ? undefined : JSON.stringify(body) });
const usage = async (appId, q = '') => (await admin('GET', `/admin/apps/${appId}/usage${q}`)).json();
const today = () => new Date().toISOString().slice(0, 10);
const sleep = (n) => new Promise((r) => setTimeout(r, n));

t('every platform feature is metered per app, with counts and bytes only, and the usage endpoint reports them against the caps', async () => {
    const a = 'usage-app';
    const tok = await signIn(a, EMAIL);
    await post(a, 'db', { op: 'insert', table: 'notes', rows: [{ body: 'my private diary entry' }, { body: 'another' }] }, tok);
    await post(a, 'db', { op: 'select', table: 'notes' }, tok);
    await post(a, 'db', { op: 'select', table: 'notes' }); // anonymous on an owner table: 401, counted as an error
    const up = await post(a, 'storage/upload?name=pic.png', PNG, tok, { 'content-type': 'image/png' });
    const { file } = await up.json();
    await post(a, 'storage/url', { id: file.id }, tok); await post(a, 'storage/url', { id: file.id }, tok);
    await post(a, 'storage/list', {}, tok);
    assert.equal((await post(a, 'notify/me', { subject: 'Hi', text: 'secret body text' }, tok)).status, 200);
    await post(a, 'pay/webhook', '{}', undefined, { 'stripe-signature': 't=1,v1=bad' });
    const recorded = []; const realRecord = srv.usage.record; srv.usage.record = async (e) => { recorded.push(e.appId); return realRecord(e); };
    try { await post('ghost-app', 'db', { op: 'select', table: 'x' }, tok); await post('ghost-app', 'pay/checkout', {}, tok); } finally { srv.usage.record = realRecord; }
    assert.deepEqual(recorded, [], 'a 404 for an unknown app is never metered');

    const out = await usage(a);
    const k = out.totals;
    assert.deepEqual([k.auth_email.calls, k.auth_email.errors, k.auth_signin.calls], [1, 0, 1]);
    assert.deepEqual([k.db.calls, k.db.errors, k.db.rows], [3, 1, 4], 'two inserted rows returned + two selected rows');
    assert.deepEqual([k.storage_upload.calls, k.storage_upload.bytes], [1, PNG.length]);
    assert.equal(k.storage_download.calls, 2);
    assert.equal(k.storage_other.calls, 1);
    assert.equal(k.notify.calls, 1);
    assert.equal(k.pay_webhook.calls, 1); assert.equal(k.pay_webhook.errors, 1);
    assert.ok(k.db.ms >= 0);
    assert.equal(out.days.length, 7); assert.equal(out.days.at(-1).day, today());
    assert.equal(out.days.at(-1).byKind.db.calls, 3);
    assert.deepEqual(out.usage.rows, 2);
    assert.deepEqual([out.usage.storageBytes, out.usage.files], [PNG.length, 1]);
    assert.equal(out.usage.emailsToday, 2);                    // the sign-in link and the notification
    assert.ok(out.usage.callsToday >= 10);
    assert.equal(out.limits.rowCap, 20000); assert.equal(out.limits.emailsPerDay, 200);
    const text = JSON.stringify(out);
    for (const secret of [EMAIL, tok, 'diary', 'secret body text', 'pic.png', file.id]) assert.equal(text.includes(secret), false, `no ${secret.slice(0, 8)} in usage output`);
    const rawRows = JSON.stringify((await db.pool.query('select * from platform.usage_daily')).rows);
    for (const secret of [EMAIL, tok, 'diary', 'secret body text']) assert.equal(rawRows.includes(secret), false);
    assert.equal((await db.pool.query("select count(*)::int n from platform.usage_daily where app_id = 'ghost-app'")).rows[0].n, 0, 'an unknown app is never metered');
});

t('the row cap fails closed with 413 row_cap, can be overridden per app through the admin API, and takes effect at once', async () => {
    const a = 'cap-app';
    const tok = await signIn(a, 'cap@example.com');
    const rows = (n) => Array.from({ length: n }, (_, i) => ({ body: `r${i}` }));
    assert.equal((await post(a, 'db', { op: 'insert', table: 'notes', rows: rows(50) }, tok)).status, 200);
    assert.equal((await admin('POST', `/admin/apps/${a}/limits`, { overrides: { rowCap: 100 } })).status, 200);
    assert.equal((await post(a, 'db', { op: 'insert', table: 'notes', rows: rows(50) }, tok)).status, 200); // exactly at the cap
    const over = await post(a, 'db', { op: 'insert', table: 'notes', rows: rows(1) }, tok);
    assert.equal(over.status, 413);
    const body = await over.json(); assert.equal(body.error, 'row_cap'); assert.match(body.message, /limit of 100 rows/);
    assert.equal((await post(a, 'db', { op: 'select', table: 'notes' }, tok)).status, 200, 'reads still work at the cap');
    assert.equal((await usage(a)).usage.rows, 100);
    assert.equal((await admin('POST', `/admin/apps/${a}/limits`, { overrides: { rowCap: 150 } })).status, 200);
    assert.equal((await post(a, 'db', { op: 'insert', table: 'notes', rows: rows(1) }, tok)).status, 200);
    assert.equal((await admin('POST', `/admin/apps/${a}/limits`, { overrides: {} })).status, 200);
    assert.equal((await post(a, 'db', { op: 'insert', table: 'notes', rows: rows(1) }, tok)).status, 200, 'back to the 20000 default');
    const got = await (await admin('GET', `/admin/apps/${a}/limits`)).json();
    assert.deepEqual(got.overrides, {}); assert.equal(got.limits.rowCap, 20000);
});

t('the usage and limits admin endpoints need the admin token, validate input and 404 an unknown app', async () => {
    assert.equal((await admin('GET', '/admin/apps/usage-app/usage', undefined, 'wrong')).status, 401);
    assert.equal((await fetch(`${base()}/admin/apps/usage-app/limits`)).status, 401);
    assert.equal((await admin('GET', '/admin/apps/usage-app/usage?days=0')).status, 400);
    assert.equal((await admin('GET', '/admin/apps/usage-app/usage?days=31')).status, 400);
    assert.equal((await admin('GET', '/admin/apps/usage-app/usage?days=30')).status, 200);
    assert.equal((await admin('GET', '/admin/apps/ghost-app/usage')).status, 404);
    assert.equal((await admin('POST', '/admin/apps/usage-app/limits', { overrides: { rowCap: 5 } })).status, 400);
    assert.equal((await admin('POST', '/admin/apps/usage-app/limits', { overrides: { bogus: 5000 } })).status, 400);
    assert.equal((await admin('POST', '/admin/apps/ghost-app/limits', { overrides: { rowCap: 500 } })).status, 404);
    assert.equal((await admin('POST', '/admin/apps/usage-app/usage', {})).status, 405);
});

t('a scheduled job run and its connector call are metered', async () => {
    const a = 'usage-app';
    assert.equal((await admin('POST', `/admin/apps/${a}/jobs`, { jobs: [JOB] })).status, 200);
    await db.pool.query("update platform.jobs set next_run_at = now() - interval '1 minute' where app_id = $1", [a]);
    let out;
    for (let i = 0; i < 100; i++) { await sleep(60); out = await usage(a); if (out.totals.job?.calls) break; }
    assert.equal(out.totals.job.calls, 1); assert.equal(out.totals.job.errors, 0);
    assert.equal(out.usage.jobRunsToday, 1);
    assert.ok(out.totals.api.calls >= 1, 'the connector call made by the job counts as an api call');
});

t('the per-app daily call cap override reaches the limiter (429 daily_call_cap), and other apps are unaffected', async () => {
    const stores = createPgStores({ pool: db.pool, masterKey: MK });
    await stores.upsertApp({ appId: 'calls-app', enabled: true });
    assert.equal((await createDataExecutor({ pool: db.pool }).applySchema({ appId: 'calls-app', spec: SPEC })).ok, true);
    assert.equal((await admin('POST', '/admin/apps/calls-app/limits', { overrides: { dailyCalls: 10 } })).status, 200);
    const codes = []; for (let i = 0; i < 12; i++) codes.push((await post('calls-app', 'db', { op: 'select', table: 'readings' })).status);
    assert.deepEqual(codes, [...Array(10).fill(200), 429, 429]);
    const r = await post('calls-app', 'db', { op: 'select', table: 'readings' }); assert.equal((await r.json()).error, 'daily_call_cap');
    assert.equal((await post('usage-app', 'db', { op: 'select', table: 'readings' })).status, 200);
});

t('the per-app job-run cap override reaches the scheduler: a due job is skipped with daily_cap', async () => {
    const a = 'jobcap-app';
    const stores = createPgStores({ pool: db.pool, masterKey: MK });
    await stores.upsertApp({ appId: a, enabled: true });
    assert.equal((await createDataExecutor({ pool: db.pool }).applySchema({ appId: a, spec: SPEC })).ok, true);
    assert.equal((await admin('POST', `/admin/apps/${a}/limits`, { overrides: { jobRunsPerDay: 0 } })).status, 200);
    assert.equal((await admin('POST', `/admin/apps/${a}/jobs`, { jobs: [JOB] })).status, 200);
    await db.pool.query("update platform.jobs set next_run_at = now() - interval '1 minute' where app_id = $1", [a]);
    let runs = [];
    for (let i = 0; i < 100 && !runs.length; i++) { await sleep(60); runs = (await db.pool.query("select status, error_code from platform.job_runs where app_id = $1", [a])).rows; }
    assert.deepEqual(runs, [{ status: 'skipped', error_code: 'daily_cap' }]);
});

t('with buffered metering (the production default) close() flushes what is pending', async () => {
    const stores = createPgStores({ pool: db.pool, masterKey: MK });
    await stores.upsertApp({ appId: 'flush-app', enabled: true });
    await createDataExecutor({ pool: db.pool }).applySchema({ appId: 'flush-app', spec: SPEC });
    const s = await startServer(loadConfig({ DATABASE_URL: 'postgres://unused/x', VIBE_MASTER_KEY: MK, OPENROUTER_API_KEY: 'sk-or-v1-FAKE', BASE_DOMAIN: 'vibebuild.cc', PROXY_ADMIN_TOKEN: ADMIN_T, RESEND_API_KEY: 're_testkey12345', AUTH_MAIL_FROM: 'login@mail.vibebuild.cc' }), { pool: db.pool, listenPort: 0, fetchImpl });
    await fetch(`http://127.0.0.1:${s.port}/flush-app/db`, { method: 'POST', headers: { 'content-type': 'application/json', 'fly-client-ip': '7.7.7.7' }, body: JSON.stringify({ op: 'select', table: 'readings' }) });
    assert.equal((await db.pool.query("select count(*)::int n from platform.usage_daily where app_id = 'flush-app'")).rows[0].n, 0, 'held in memory until the flush');
    await s.close();
    assert.equal((await db.pool.query("select calls from platform.usage_daily where app_id = 'flush-app' and kind = 'db'")).rows[0].calls, '1');
});

t('email and storage overrides reach the auth, notify and storage services', async () => {
    const stores = createPgStores({ pool: db.pool, masterKey: MK });
    await stores.upsertApp({ appId: 'svc-app', enabled: true });
    const a = 'svc-app';
    const tok = await signIn(a, 'svc@example.com');
    assert.equal((await post(a, 'notify/me', { subject: 's', text: 't' }, tok)).status, 200);
    assert.equal((await admin('POST', `/admin/apps/${a}/limits`, { overrides: { emailsPerDay: 0, storageFiles: 0 } })).status, 200);
    assert.equal((await post(a, 'auth/request', { email: 'other@example.com' })).status, 429);
    const n = await post(a, 'notify/me', { subject: 's', text: 't' }, tok); assert.equal(n.status, 429); assert.equal((await n.json()).error, 'rate_limited');
    const up = await post(a, 'storage/upload?name=p.png', PNG, tok, { 'content-type': 'image/png' });
    assert.equal(up.status, 413); assert.equal((await up.json()).error, 'quota_files');
});
