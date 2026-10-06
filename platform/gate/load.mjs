// LAUNCH GATE 2: load and connection-budget test. A local proxy (own process) over a local Postgres, with production pool limits
// (DB_POOL_MAX 5, a restricted login created `connection limit 8`), driven by N virtual users across M apps mixing sign-in, data reads
// and writes, storage metadata and notifications. Reports latency percentiles, outcome by status, peak Postgres connections
// (pg_stat_activity), pool wait time, and whether the proxy recovers after the burst. LOCAL ONLY. Not part of `npm test`.
//
//   cd platform && PGHOST=localhost PGPORT=5544 node gate/load.mjs --users 5,10,20,40,80,160,320 --apps 4 --duration 8
//   options: --mode closed|open  --rps 50,100,200 (open mode)  --pool 5  --conn-limit 8  --limits lift|default  --ext-latency 30
//            --max-inflight 50 (default 10 x pool)  --db-latency 0 (simulated ms added to every DB statement)  --think 0 (ms between a user's requests)  --mix me=15,db_read=35,...  --json out.json
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

export const DEFAULT_MIX = { me: 14, db_read: 34, db_write: 20, db_public: 10, storage_list: 6, storage_url: 6, notify: 4, signin: 2, upload: 4 };
const CHILD = fileURLToPath(new URL('./load-server.mjs', import.meta.url));
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120)]);

export async function startServerChild(cfg) {
    const child = fork(CHILD, [JSON.stringify(cfg)], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const waiters = new Map(); let ready, readyFail, resolveStopped;
    const readyP = new Promise((ok, bad) => { ready = ok; readyFail = bad; });
    const stopped = new Promise((ok) => { resolveStopped = ok; });
    child.on('message', (m) => { if (m.type === 'ready' || m.type === 'unavailable') ready(m); else if (m.type === 'stats') { waiters.get(m.id)?.(m); waiters.delete(m.id); } else if (m.type === 'stopped') resolveStopped(); });
    child.on('exit', (code) => { readyFail(new Error(`load server exited (${code})`)); resolveStopped(); });
    const info = await readyP;
    if (info.type === 'unavailable') return { unavailable: info.reason, child };
    let n = 0;
    return {
        info, child, port: info.port, apps: info.apps, loginName: info.loginName,
        stats: (reset = false) => new Promise((ok) => { const id = ++n; waiters.set(id, ok); child.send({ type: 'stats', id, reset }); }),
        async stop() { child.send({ type: 'stop' }); await Promise.race([stopped, sleep(15000)]); child.kill(); },
    };
}

/** Samples pg_stat_activity for the proxy's login every few ms. */
function monitorConnections({ loginName }) {
    const client = new pg.Client({ host: process.env.PGHOST || 'localhost', user: process.env.PGUSER || process.env.USER, database: 'postgres' });
    const s = { max: 0, maxActive: 0, maxIdleInTx: 0, samples: 0, over: 0 };
    let stop = false;
    const run = (async () => {
        await client.connect();
        while (!stop) {
            const r = await client.query("select count(*)::int n, (count(*) filter (where state = 'active'))::int a, (count(*) filter (where state like 'idle in transaction%'))::int t from pg_stat_activity where usename = $1", [loginName]);
            const { n, a, t } = r.rows[0]; s.samples++; s.max = Math.max(s.max, n); s.maxActive = Math.max(s.maxActive, a); s.maxIdleInTx = Math.max(s.maxIdleInTx, t);
            await sleep(15);
        }
        await client.end().catch(() => {});
    })();
    return { s, async stop() { stop = true; await run.catch(() => {}); } };
}

// ---- virtual users ----
function makeOps(server) {
    const base = `http://127.0.0.1:${server.port}`;
    let ipn = 0; const nextIp = () => { ipn++; return `10.${(ipn >> 16) & 255}.${(ipn >> 8) & 255}.${ipn & 255}`; };
    const call = async (path, { token, body, raw, headers = {}, timeoutMs = 15000 } = {}) => {
        const t0 = performance.now(); let status;
        try {
            const res = await fetch(base + path, { method: 'POST', signal: AbortSignal.timeout(timeoutMs), headers: { ...(raw ? { 'content-type': 'image/png' } : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), 'fly-client-ip': nextIp(), ...headers }, body: raw ?? JSON.stringify(body ?? {}) });
            await res.arrayBuffer(); status = res.status;
        } catch (e) { status = e?.name === 'TimeoutError' ? 'timeout' : 'neterr'; }
        return { status, ms: performance.now() - t0 };
    };
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const T = (c) => ({ token: c.user.token });
    return {
        me: (c) => [['me', call(`/${c.app.appId}/auth/me`, T(c))]],
        db_read: (c) => [['db_read', call(`/${c.app.appId}/db`, { ...T(c), body: { op: 'select', table: 'items', limit: 20, order: [{ col: 'created_at', dir: 'desc' }] } })]],
        db_write: (c) => [['db_write', call(`/${c.app.appId}/db`, { ...T(c), body: { op: 'insert', table: 'items', rows: [{ v: randomBytes(8).toString('hex') }] } })]],
        db_public: (c) => [['db_public', call(`/${c.app.appId}/db`, { body: { op: 'select', table: 'pub', limit: 20 } })]],
        storage_list: (c) => [['storage_list', call(`/${c.app.appId}/storage/list`, T(c))]],
        storage_url: (c) => [['storage_url', call(`/${c.app.appId}/storage/url`, { ...T(c), body: { id: c.user.fileId } })]],
        upload: (c) => [['upload', call(`/${c.app.appId}/storage/upload?name=l.png`, { ...T(c), raw: PNG })]],
        notify: (c) => [['notify', call(`/${c.app.appId}/notify/me`, { ...T(c), body: { subject: 'load', text: 'load test message' } })]],
        signin: async (c) => {
            const r = await call(`/${c.app.appId}/auth/request`, { body: { email: `n-${randomBytes(4).toString('hex')}@load.test` } });
            const link = c.app.links.pop();
            const out = [['signin_request', Promise.resolve(r)]];
            if (link) out.push(['signin_consume', call(`/${c.app.appId}/auth/consume`, { body: { token: link } })]);
            return out;
        },
    };
}
async function doOp(ops, name) {
    const c = ops.ctx();
    const parts = await ops[name](c);
    const out = [];
    for (const [label, p] of parts) { const r = await p; out.push({ op: label, ...r }); }
    return out;
}
const chooser = (mix) => { const e = Object.entries(mix).filter(([, w]) => w > 0); const tot = e.reduce((s, [, w]) => s + w, 0); return () => { let r = Math.random() * tot; for (const [k, w] of e) { r -= w; if (r <= 0) return k; } return e[0][0]; }; };

/** One load step. closed: `users` virtual users in a loop (think ms between requests); open: `rps` arrivals per second regardless of completions. */
export async function runStep({ server, mode = 'closed', users = 10, rps = 50, durationMs = 8000, thinkMs = 0, mix = DEFAULT_MIX, label }) {
    const ops = { ...makeOps(server) }; ops.ctx = () => { const app = server.apps[Math.floor(Math.random() * server.apps.length)]; return { app, user: app.users[Math.floor(Math.random() * app.users.length)] }; };
    const choose = chooser(mix);
    await server.stats(true);
    const mon = monitorConnections({ loginName: server.loginName });
    const results = []; const t0 = performance.now(); const deadline = t0 + durationMs; let inflight = 0, maxInflight = 0, dropped = 0;
    const one = async () => { inflight++; maxInflight = Math.max(maxInflight, inflight); try { for (const r of await doOp(ops, choose())) results.push({ ...r, at: performance.now() - t0 }); } finally { inflight--; } };
    if (mode === 'closed') {
        await Promise.all(Array.from({ length: users }, async () => { while (performance.now() < deadline) { await one(); if (thinkMs) await sleep(thinkMs); } }));
    } else {
        const pending = new Set(); let k = 0;
        while (performance.now() < deadline) {
            const due = t0 + (k / rps) * 1000; const now = performance.now();
            if (due > now) { await sleep(Math.min(due - now, 5)); continue; }
            k++;
            if (inflight >= 5000) { dropped++; continue; }
            const p = one().finally(() => pending.delete(p)); pending.add(p);
        }
        await Promise.allSettled(pending);
    }
    const elapsed = (performance.now() - t0) / 1000;
    await mon.stop();
    const st = await server.stats(false);
    const lat = results.map((r) => r.ms).sort((a, b) => a - b);
    const byStatus = {}, byOp = {};
    for (const r of results) {
        byStatus[r.status] = (byStatus[r.status] || 0) + 1;
        const o = (byOp[r.op] ||= { n: 0, ok: 0, ms: [], status: {} }); o.n++; o.ms.push(r.ms); o.status[r.status] = (o.status[r.status] || 0) + 1; if (r.status >= 200 && r.status < 300) o.ok++;
    }
    for (const o of Object.values(byOp)) { o.ms.sort((a, b) => a - b); o.p50 = pct(o.ms, 50); o.p95 = pct(o.ms, 95); o.p99 = pct(o.ms, 99); delete o.ms; }
    const ok = results.filter((r) => r.status >= 200 && r.status < 300).length;
    const fiveXX = results.filter((r) => typeof r.status === 'number' && r.status >= 500 && r.status !== 503).length; // server errors; 503 is the deliberate, clean refusal
    const clean = results.filter((r) => r.status === 429 || r.status === 503).length;
    const hung = results.filter((r) => r.status === 'timeout' || r.status === 'neterr').length;
    return {
        label: label || (mode === 'closed' ? `${users} users` : `${rps} rps`), mode, users, rps, apps: server.apps.length, durationS: +elapsed.toFixed(2), requests: results.length, throughputRps: +(results.length / elapsed).toFixed(1), okRps: +(ok / elapsed).toFixed(1),
        latencyMs: { p50: +pct(lat, 50).toFixed(1), p95: +pct(lat, 95).toFixed(1), p99: +pct(lat, 99).toFixed(1), max: +(lat.at(-1) || 0).toFixed(1) },
        byStatus, byOp, ok, fiveXX, clean429or503: clean, timeoutsOrNetErrors: hung, errorRatePct: +(((results.length - ok) / Math.max(1, results.length)) * 100).toFixed(2), failureRatePct: +(((fiveXX + hung) / Math.max(1, results.length)) * 100).toFixed(2),
        maxInflightClient: maxInflight, droppedArrivals: dropped, statementsPerRequest: +(st.queries / Math.max(1, results.length)).toFixed(1),
        pg: { maxConnections: mon.s.max, maxActive: mon.s.maxActive, maxIdleInTransaction: mon.s.maxIdleInTx, samples: mon.s.samples },
        pool: { ...st.pool, waitMs: { p50: +st.waits.p50.toFixed(2), p95: +st.waits.p95.toFixed(2), p99: +st.waits.p99.toFixed(2), max: +st.waits.max.toFixed(2), acquisitions: st.waits.n } }, eventLoopLagMs: { p99: +st.loop.p99Ms.toFixed(1), max: +st.loop.maxMs.toFixed(1) },
    };
}

/** Database statements one request of each kind costs (counted on the proxy's connections; each pooled statement waits for a connection). */
export async function statementsPerOp({ server }) {
    const ops = { ...makeOps(server) }; ops.ctx = () => ({ app: server.apps[0], user: server.apps[0].users[0] });
    const out = {};
    for (const name of Object.keys(ops).filter((k) => k !== 'ctx')) {
        const counts = [];
        for (let i = 0; i < 7; i++) { await server.stats(true); await doOp(ops, name); await sleep(40); counts.push((await server.stats(false)).queries); }
        counts.sort((a, b) => a - b); out[name] = counts[3]; // median of 7: caches and the usage buffer's periodic flush make single calls vary
    }
    return out;
}

/** After a burst: wait, then check that latency is back to baseline, nothing fails, nothing is queued, and no pooled client leaked. */
export async function recovery({ server, settleMs = 3000, probes = 30 }) {
    await sleep(settleMs);
    const ops = { ...makeOps(server) }; ops.ctx = () => ({ app: server.apps[0], user: server.apps[0].users[0] });
    const lat = [], bad = [];
    for (let i = 0; i < probes; i++) for (const r of await doOp(ops, ['me', 'db_read', 'db_write', 'storage_list'][i % 4])) { lat.push(r.ms); if (!(r.status >= 200 && r.status < 300)) bad.push(r.status); }
    lat.sort((a, b) => a - b);
    const st = await server.stats(false);
    return { probes: lat.length, failures: bad, p50: +pct(lat, 50).toFixed(1), p95: +pct(lat, 95).toFixed(1), pool: st.pool, leakedClients: st.pool.total - st.pool.idle, queued: st.pool.waiting };
}

export async function runLoad({ steps, apps = 4, usersPerApp = 25, poolMax = 5, connLimit = 8, limits = 'lift', extLatencyMs = 30, dbLatencyMs = 0, maxInflight = null, durationMs = 8000, mode = 'closed', thinkMs = 0, mix = DEFAULT_MIX, settleMs = 3000, onStep = () => {} }) {
    const server = await startServerChild({ apps, usersPerApp, linksPerApp: 400, poolMax, connLimit, limits, extLatencyMs, dbLatencyMs, maxInflight });
    if (server.unavailable) { server.child.kill(); return { unavailable: server.unavailable }; }
    try {
        const adm = new pg.Client({ host: process.env.PGHOST || 'localhost', user: process.env.PGUSER || process.env.USER, database: 'postgres' });
        await adm.connect(); const roleConnLimit = (await adm.query('select rolconnlimit from pg_roles where rolname = $1', [server.loginName])).rows[0]?.rolconnlimit; await adm.end();
        const out = { roleConnLimit, config: { maxInflight, apps, usersPerApp, poolMax, connLimit, limits, extLatencyMs, dbLatencyMs, durationMs, mode, thinkMs, mix }, steps: [] };
        await runStep({ server, users: 2, durationMs: 1000, mix, label: 'warmup' });
        out.statementsPerOp = await statementsPerOp({ server });
        for (const s of steps) { const r = await runStep({ server, mode, durationMs, thinkMs, mix, ...(mode === 'closed' ? { users: s } : { rps: s }) }); out.steps.push(r); onStep(r); }
        out.recovery = await recovery({ server, settleMs });
        return out;
    } finally { await server.stop(); }
}

export function formatReport(res) {
    const L = [];
    const c = res.config;
    L.push(`pool max ${c.poolMax}, MAX_INFLIGHT ${c.maxInflight ?? 'default (10 x pool)'}, role connection limit ${c.connLimit ?? 'none'}, ${c.apps} apps x ${c.usersPerApp} users, ${c.mode} loop, ${c.durationMs / 1000}s per step, external call latency ${c.extLatencyMs} ms, simulated DB round trip ${c.dbLatencyMs} ms, limits: ${c.limits}`);
    L.push('step        | req/s | ok/s  | p50 ms | p95 ms | p99 ms | max ms | 2xx%  | 429/503 | 5xx | timeout | pg conns (max/active) | pool wait p50/p99/max ms | queue max | loop lag p99');
    for (const s of res.steps) {
        const okPct = ((s.ok / Math.max(1, s.requests)) * 100).toFixed(1);
        L.push(`${s.label.padEnd(11)} | ${String(s.throughputRps).padStart(5)} | ${String(s.okRps).padStart(5)} | ${String(s.latencyMs.p50).padStart(6)} | ${String(s.latencyMs.p95).padStart(6)} | ${String(s.latencyMs.p99).padStart(6)} | ${String(s.latencyMs.max).padStart(6)} | ${okPct.padStart(5)} | ${String(s.clean429or503).padStart(7)} | ${String(s.fiveXX).padStart(3)} | ${String(s.timeoutsOrNetErrors).padStart(7)} | ${s.pg.maxConnections}/${s.pg.maxActive} | ${s.pool.waitMs.p50}/${s.pool.waitMs.p99}/${s.pool.waitMs.max} | ${s.pool.maxWaiting} | ${s.eventLoopLagMs.p99}`);
    }
    for (const s of res.steps) L.push(`  ${s.label}: status ${JSON.stringify(s.byStatus)}`);
    if (res.statementsPerOp) L.push(`database statements per request: ${JSON.stringify(res.statementsPerOp)}`);
    if (res.recovery) { const r = res.recovery; L.push(`recovery after ${c.durationMs / 1000}s bursts + ${3}s settle: ${r.probes} probes, failures ${JSON.stringify(r.failures)}, p50 ${r.p50} ms, p95 ${r.p95} ms, pool total ${r.pool.total} idle ${r.pool.idle} waiting ${r.pool.waiting} (leaked ${r.leakedClients}, queued ${r.queued})`); }
    return L.join('\n');
}

function parseArgs(argv) {
    const a = {}; for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
    return a;
}
if (import.meta.url === `file://${process.argv[1]}`) {
    const a = parseArgs(process.argv.slice(2));
    const mode = a.mode || 'closed';
    const steps = (a[mode === 'open' ? 'rps' : 'users'] || (mode === 'open' ? '25,50,100,200' : '5,10,20,40,80,160')).split(',').map(Number);
    const mix = a.mix ? Object.fromEntries(a.mix.split(',').map((kv) => kv.split('=')).map(([k, v]) => [k, Number(v)])) : DEFAULT_MIX;
    const res = await runLoad({ steps, mode, apps: Number(a.apps || 4), usersPerApp: Number(a['users-per-app'] || 25), poolMax: Number(a.pool || 5), connLimit: a['conn-limit'] === 'none' ? null : Number(a['conn-limit'] || 8), limits: a.limits || 'lift', extLatencyMs: Number(a['ext-latency'] ?? 30), dbLatencyMs: Number(a['db-latency'] ?? 0), maxInflight: a['max-inflight'] ? Number(a['max-inflight']) : null, durationMs: Number(a.duration || 8) * 1000, thinkMs: Number(a.think || 0), mix, onStep: (s) => console.log(`... ${s.label}: ${s.throughputRps} req/s, p95 ${s.latencyMs.p95} ms, 5xx ${s.fiveXX}, timeouts ${s.timeoutsOrNetErrors}, pg max ${s.pg.maxConnections}`) });
    if (res.unavailable) { console.error(`no local Postgres: ${res.unavailable}`); process.exit(2); }
    console.log('\n' + formatReport(res));
    if (a.json) fs.writeFileSync(a.json, JSON.stringify(res, null, 2));
}
