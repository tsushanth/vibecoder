// Child process for the load gate: boots the real proxy against a scratch Postgres (restricted login with a connection limit, pool
// limits as in production), seeds apps, users, sessions and files, then answers stats requests from the load generator. Running the
// server in its own process keeps the generator's CPU out of the server's latency. LOCAL ONLY: never point this at a live database.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';
import { startPlatform, PNG } from './harness.mjs';
import { createDataExecutor } from '../data/executor.js';
import { validateSpec } from '../data/schema.js';
import { createAuthStore } from '../auth/pgStore.js';
import { signToken } from '../auth/jwt.js';
import { deriveAppKey } from '../auth/keys.js';
import { sha } from './fixture.mjs';

const cfg = JSON.parse(process.argv[2]);
const SPEC = { version: 1, tables: { items: { access: 'owner', columns: { v: { type: 'text' } } }, pub: { access: 'public_read', columns: { v: { type: 'text' } } } } };
const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0);
const send = (m) => process.send(m);

const env = cfg.limits === 'default' ? { PER_IP_PER_MIN: '30', PER_APP_PER_MIN: '120', DAILY_CALLS: '5000' } : { NOTIFY_USER_PER_HOUR: '1000', NOTIFY_USER_PER_DAY: '10000', NOTIFY_APP_PER_DAY: '1000000', NOTIFY_GLOBAL_PER_DAY: '10000000' };
if (cfg.poolMax) env.DB_POOL_MAX = String(cfg.poolMax);
const P = await startPlatform({ connLimit: cfg.connLimit, poolMax: cfg.poolMax ?? 5, env, latencyMs: cfg.extLatencyMs ?? 0, log: () => {} });
if (P.unavailable) { send({ type: 'unavailable', reason: P.unavailable }); process.exit(0); }

// ---- instrumentation: how long callers wait for a pooled connection, and the peak queue ----
const waits = []; let maxWaiting = 0, maxTotal = 0, maxChecked = 0;
const pool = P.proxyPool;
const origConnect = pool.connect.bind(pool);
pool.connect = (cb) => {
    const t0 = performance.now();
    const rec = () => { const w = performance.now() - t0; if (w > 0.05 || waits.length < 1_000_000) waits.push(w); };
    if (typeof cb === 'function') return origConnect((err, client, done) => { rec(); cb(err, client, done); });
    return origConnect().then((c) => { rec(); return c; });
};
const loop = monitorEventLoopDelay({ resolution: 5 }); loop.enable();
const sampler = setInterval(() => { maxWaiting = Math.max(maxWaiting, pool.waitingCount); maxTotal = Math.max(maxTotal, pool.totalCount); maxChecked = Math.max(maxChecked, pool.totalCount - pool.idleCount); }, 10);

// ---- seed ----
const ex = createDataExecutor({ pool });
const authStore = createAuthStore({ pool: P.db.pool });
const apps = [];
for (let a = 0; a < cfg.apps; a++) {
    const appId = `load-${a}`;
    await P.stores.upsertApp({ appId, enabled: true });
    if (!(await ex.applySchema({ appId, spec: validateSpec(SPEC).spec })).ok) throw new Error('schema failed');
    const key = deriveAppKey(P.MK, appId);
    const users = [];
    for (let u = 0; u < cfg.usersPerApp; u++) {
        const email = `u${u}-${randomBytes(3).toString('hex')}@load.test`;
        const id = await authStore.upsertUser({ appId, email });
        const jti = crypto.randomUUID();
        await authStore.createSession({ jti, appId, userId: id, expiresAt: Date.now() + 3600_000 });
        const token = signToken({ key, appId, sub: id, jti, ttlSec: 3600 });
        const up = await P.call(`/${appId}/storage/upload?name=f.png`, { token, body: PNG, headers: { 'content-type': 'image/png' } });
        users.push({ id, token, fileId: up.json?.file?.id });
    }
    const links = [];
    for (let i = 0; i < cfg.linksPerApp; i++) { const t = randomBytes(32).toString('base64url'); await authStore.addLink({ tokenHash: sha(t), appId, email: `sign-${a}-${i}-${randomBytes(2).toString('hex')}@load.test`, expiresAt: Date.now() + 3600_000 }); links.push(t); }
    await P.call(`/${appId}/db`, { token: users[0].token, body: { op: 'insert', table: 'pub', rows: [{ v: 'hello' }] } });
    apps.push({ appId, users, links });
}
waits.length = 0; maxWaiting = 0; maxTotal = 0; maxChecked = 0; loop.reset();
send({ type: 'ready', port: P.srv.port, loginName: P.loginName, dbName: P.db.name, apps, poolMax: cfg.poolMax ?? 5, connLimit: cfg.connLimit });

process.on('message', async (m) => {
    if (m.type === 'stats') {
        const w = [...waits].sort((x, y) => x - y);
        send({ type: 'stats', id: m.id, pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, maxTotal, maxWaiting, maxChecked }, waits: { n: w.length, p50: pct(w, 50), p95: pct(w, 95), p99: pct(w, 99), max: w.at(-1) ?? 0 }, loop: { p99Ms: loop.percentile(99) / 1e6, maxMs: loop.max / 1e6 } });
        if (m.reset) { waits.length = 0; maxWaiting = 0; maxTotal = pool.totalCount; maxChecked = pool.totalCount - pool.idleCount; loop.reset(); }
    } else if (m.type === 'stop') {
        clearInterval(sampler);
        await P.stop().catch(() => {});
        send({ type: 'stopped' }); process.exit(0);
    }
});
