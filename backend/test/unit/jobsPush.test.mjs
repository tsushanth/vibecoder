import test from 'node:test';
import assert from 'node:assert/strict';
import { jobsFromBundle, MAX_JOBS_BYTES } from '../../lib/bundleJobs.js';
import { registerDeployedApp } from '../../services/appRegistry.js';
import { createProxyAdmin, ProxyAdminError } from '../../services/proxyAdmin.js';
import { zip, file } from '../helpers/zip.mjs';

const JOBS = { version: 1, jobs: [{ id: 'cleanup', schedule: { dailyAt: '03:00', tz: 'UTC' }, action: { type: 'prune', table: 'readings', olderThanDays: 30 } }] };
const SPEC = { version: 1, tables: { readings: { access: 'owner', columns: { t: { type: 'number' } } } } };
const PID = 'abcdef12-3456-7890-abcd-ef1234567890';
const TOKEN = 'admin-token-' + 'x'.repeat(40);
const withJobs = zip([file('index.html', 'x'), file('vibe.jobs.json', JOBS)]);
const withBoth = zip([file('vibe.schema.json', SPEC), file('vibe.jobs.json', JOBS)]);
const noJobs = zip([file('index.html', 'x')]);

// ---- bundle reader ----
test('finds a deflated or stored vibe.jobs.json at the root; nested or absent is none', () => {
    assert.deepEqual(jobsFromBundle(withJobs), { status: 'found', spec: JOBS });
    assert.deepEqual(jobsFromBundle(zip([file('vibe.jobs.json', JOBS, { deflate: false })])), { status: 'found', spec: JOBS });
    assert.deepEqual(jobsFromBundle(noJobs), { status: 'none' });
    assert.deepEqual(jobsFromBundle(zip([file('app/vibe.jobs.json', JOBS)])), { status: 'none' });
});
test('a file that is not a JSON object is invalid (it exists, so the creator must hear about it); garbage bundles are unreadable and never throw', () => {
    for (const bad of ['{nope', '[]', 'null', '"x"', '']) assert.deepEqual(jobsFromBundle(zip([file('vibe.jobs.json', bad)])), { status: 'invalid' }, bad);
    const good = Buffer.from(withJobs, 'base64');
    for (const b of ['', 'not base64 !!!', good.subarray(0, good.length - 10).toString('base64'), null, undefined, 42]) assert.deepEqual(jobsFromBundle(b), { status: 'unreadable' }, String(b).slice(0, 20));
});
test('the size cap fits the proxy body limit and holds for declared and real size; other big files are not inflated', () => {
    assert.equal(MAX_JOBS_BYTES, 8192);
    const big = JSON.stringify({ jobs: [], pad: 'x'.repeat(MAX_JOBS_BYTES + 10) });
    assert.deepEqual(jobsFromBundle(zip([file('vibe.jobs.json', big)])), { status: 'unreadable' });
    assert.deepEqual(jobsFromBundle(zip([file('vibe.jobs.json', big, { claimSize: 100 })])), { status: 'unreadable' }, 'lying size field');
    assert.deepEqual(jobsFromBundle(zip([file('vibe.jobs.json', big, { deflate: false, claimSize: 100 })])), { status: 'unreadable' });
    const many = Array.from({ length: 5001 }, (_, i) => file(`f${i}.txt`, 'a'));
    assert.deepEqual(jobsFromBundle(zip([...many, file('vibe.jobs.json', JOBS)])), { status: 'unreadable' }, 'too many entries');
    assert.equal(jobsFromBundle(zip([file('big.bin', 'a'.repeat(5 * 1024 * 1024)), file('vibe.jobs.json', JOBS)])).status, 'found');
});

// ---- proxy admin client ----
const rig = (reply) => {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined }); return reply; };
    return { calls, admin: createProxyAdmin({ baseUrl: 'https://proxy.test', token: TOKEN, fetchImpl, timeoutMs: 200 }) };
};
const res = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('setJobs POSTs the jobs file itself (not wrapped) to /jobs; getJobs GETs', async () => {
    const a = rig(res(200, { jobs: 1, warnings: [] }));
    assert.deepEqual(await a.admin.setJobs('my-app', JOBS), { jobs: 1, warnings: [] });
    assert.equal(a.calls[0].url, 'https://proxy.test/admin/apps/my-app/jobs'); assert.equal(a.calls[0].init.method, 'POST');
    assert.deepEqual(a.calls[0].body, JOBS);
    assert.equal(new Headers(a.calls[0].init.headers).get('authorization'), `Bearer ${TOKEN}`);
    const g = rig(res(200, { jobs: [], runs: [] }));
    assert.deepEqual(await g.admin.getJobs('a/../b'), { jobs: [], runs: [] });
    assert.equal(g.calls[0].init.method, 'GET'); assert.ok(g.calls[0].url.endsWith('/a%2F..%2Fb/jobs'));
});
test('jobs error codes survive', async () => {
    for (const [status, code] of [[400, 'invalid_jobs'], [404, 'unknown_app'], [413, 'request_too_large'], [500, 'bad_app_manifest']]) {
        await assert.rejects(() => rig(res(status, { error: code })).admin.setJobs('a-app', JOBS), (e) => e.status === status && e.code === code, code);
    }
});

// ---- registerDeployedApp ----
const fake = ({ setJobs, setSchema } = {}) => {
    const calls = [];
    const rec = (name) => async (...a) => { calls.push([name, ...a]); return name === 'copySecrets' ? { copied: 0 } : null; };
    return { configured: true, calls, ensureApp: rec('ensure'), setEnabled: rec('enabled'), setManifest: rec('manifest'), copySecrets: rec('copy'),
        setSchema: async (...a) => { calls.push(['schema', ...a]); if (setSchema instanceof Error) throw setSchema; return { version: 1, applied: 1 }; },
        setJobs: async (...a) => { calls.push(['jobs', ...a]); if (setJobs instanceof Error) throw setJobs; return setJobs || { jobs: 1, warnings: [] }; } };
};
const logs = () => { const l = []; return { l, log: (...a) => l.push(a.join(' ')) }; };
const reg = (p, src, log = logs().log) => registerDeployedApp(p, 'my-app', log, src);

test('jobs are pushed to the subdomain app only, after the schema (they validate against its tables) and before the app is enabled', async () => {
    const p = fake(); const result = {};
    assert.equal(await reg(p, { projectId: PID, bundle: withBoth, result }), true);
    assert.deepEqual(p.calls.map((c) => c[0]), ['ensure', 'manifest', 'manifest', 'schema', 'jobs', 'enabled']);
    assert.deepEqual(p.calls.find((c) => c[0] === 'jobs'), ['jobs', 'my-app', JOBS]);
    assert.equal(result.jobsStatus, 'applied'); assert.equal(result.schemaStatus, 'applied');
});
test('jobs are pushed even without a project id', async () => {
    const p = fake(); await reg(p, { bundle: withJobs });
    assert.deepEqual(p.calls.find((c) => c[0] === 'jobs'), ['jobs', 'my-app', JOBS]);
});
test('statuses: applied, invalid (rejected spec, file not an object), failed (anything else)', async () => {
    const cases = [
        [{ jobs: 0, warnings: [] }, 'applied'], [new ProxyAdminError(400, 'invalid_jobs'), 'invalid'], [new ProxyAdminError(413, 'request_too_large'), 'invalid'], [new ProxyAdminError(400, 'bad_json'), 'invalid'],
        [new ProxyAdminError(404, 'unknown_app'), 'failed'], [new ProxyAdminError(500, 'bad_app_manifest'), 'failed'], [new ProxyAdminError(0, 'unreachable'), 'failed'], [new Error('boom'), 'failed'],
    ];
    for (const [reply, want] of cases) { const result = {}; assert.equal(await reg(fake({ setJobs: reply }), { bundle: withJobs, result }), true); assert.equal(result.jobsStatus, want, String(reply?.code || JSON.stringify(reply))); }
    const result = {}; const p = fake();
    assert.equal(await reg(p, { bundle: zip([file('vibe.jobs.json', '{nope')]), result }), true);
    assert.equal(result.jobsStatus, 'invalid'); assert.equal(p.calls.some((c) => c[0] === 'jobs'), false, 'an unparseable file is never sent');
});
test('a failed jobs push never fails the deploy: the app is still enabled, only the code is logged', async () => {
    const p = fake({ setJobs: new ProxyAdminError(500, 'bad_app_manifest') }); const { l, log } = logs();
    assert.equal(await reg(p, { bundle: withJobs }, log), true);
    assert.equal(p.calls.at(-1)[0], 'enabled');
    assert.ok(l.some((x) => /bad_app_manifest/.test(x) && /my-app/.test(x) && /jobs/.test(x)), JSON.stringify(l));
    assert.equal(l.join('\n').includes('cleanup'), false, 'no job content in logs');
});
test('a schema failure does not stop jobs from being pushed and reported', async () => {
    const result = {};
    await reg(fake({ setSchema: new ProxyAdminError(422, 'migration_failed') }), { bundle: withBoth, result });
    assert.equal(result.schemaStatus, 'failed'); assert.equal(result.jobsStatus, 'applied');
});
test('no jobs file or an unreadable bundle: the proxy is not called and no status is reported', async () => {
    for (const bundle of [noJobs, 'QUJD', '', undefined]) {
        const p = fake(); const result = {};
        assert.equal(await reg(p, { projectId: PID, bundle, result }), true);
        assert.equal(p.calls.some((c) => c[0] === 'jobs'), false, String(bundle).slice(0, 12));
        assert.equal('jobsStatus' in result, false);
    }
});
test('callers that pass no result object still work, and jobs are not pushed when registration fails', async () => {
    assert.equal(await reg(fake(), { bundle: withJobs }), true);
    const p = fake(); p.ensureApp = async () => { throw new ProxyAdminError(0, 'unreachable'); };
    assert.equal(await reg(p, { bundle: withJobs }), false);
    assert.equal(p.calls.length, 0);
});
