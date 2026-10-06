// Wires config + Postgres stores + limiters + HTTP handler into a running server. Used by index.js and by tests.
import http from 'node:http';
import dns from 'node:dns/promises';
import pg from 'pg';
import { createHandler } from './server.js';
import { createPgStores } from '../store/pg.js';
import { createLimiter } from '../vibe-proxy/limits.js';
import { createMeter } from '../vibe-proxy/meter.js';
import { createUsage, createLimitsResolver, defaultLimits } from '../vibe-proxy/usage.js';
import { createUsageAdmin } from '../vibe-proxy/usage-admin.js';
import { createAuthStore } from '../auth/pgStore.js';
import { createAuthService } from '../auth/service.js';
import { createResendMailer } from '../auth/mailer.js';
import { createStorageStore } from '../storage/pgStore.js';
import { createStorageService } from '../storage/service.js';
import { createNotifyStore } from '../notify/pgStore.js';
import { createNotifyService } from '../notify/service.js';
import { createNotifyHttp } from '../notify/http.js';
import { createDataExecutor } from '../data/executor.js';
import { createJobsStore } from '../jobs/store.js';
import { createJobsAdmin } from '../jobs/admin.js';
import { createActionRunner } from '../jobs/actions.js';
import { runDueJobs, createGate } from '../jobs/runner.js';
import { startScheduler } from '../jobs/scheduler.js';
import { createPayService } from '../pay/service.js';
import { createPayHttp } from '../pay/http.js';
import { createOrderStore } from '../pay/orderStore.js';

async function dnsResolve(host) {
    const [a, b] = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host)]);
    return [...(a.status === 'fulfilled' ? a.value : []), ...(b.status === 'fulfilled' ? b.value : [])];
}

/** The pool is deliberately small: the shared database allows few connections. Connections open lazily. */
export function makePool(config) {
    return new pg.Pool({ connectionString: config.secrets.databaseUrl, max: config.dbPoolMax, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000 });
}

export async function startServer(config, { pool: injected, listenPort, jobsTickMs = config.jobsTickMs, resolve = dnsResolve, fetchImpl = globalThis.fetch, log = (l) => console.log(l) } = {}) {
    const pool = injected || makePool(config);
    const ownsPool = !injected;
    const fail = async (msg) => { if (ownsPool) await pool.end().catch(() => {}); throw new Error(msg); };
    let present;
    try { present = (await pool.query("select to_regclass('platform.apps') as t")).rows[0].t; } catch { return fail('cannot reach the database (check DATABASE_URL)'); }
    if (!present) return fail('the platform schema is missing: run the migration first (node store/migrate.js)');

    const stores = createPgStores({ pool, masterKey: config.secrets.masterKey });
    const l = config.limits;
    // Per-app usage rollup and limits. Defaults come from the config; platform.app_limits overrides them per app (admin API only).
    const usage = createUsage({ sink: stores.usageDailySink, flushMs: config.usageFlushMs });
    const limitDefaults = { ...defaultLimits(), dailyCalls: l.dailyCalls, dailySpendMicros: l.dailySpendMicros, emailsPerDay: config.notify.limits.perAppPerDay };
    const limitsResolver = createLimitsResolver({ defaults: limitDefaults, load: (appId) => stores.limitsStore.get(appId) });
    const limitsFor = (appId) => limitsResolver.limitsFor(appId);
    const limiter = createLimiter({ store: stores.limiterStore, limitsFor, perIpPerMin: l.perIpPerMin, perAppPerMin: l.perAppPerMin, dailyCalls: l.dailyCalls, dailySpendMicros: l.dailySpendMicros });
    const globalAiLimiter = createLimiter({ store: stores.limiterStore, perIpPerMin: 1e9, perAppPerMin: 1e9, dailyCalls: 1e9, dailySpendMicros: config.platformAiDailyMicros });
    // Sign-in is only offered when a mail sender is configured; without one the auth routes answer 503.
    const mailer = config.secrets.resendKey ? createResendMailer({ apiKey: config.secrets.resendKey, from: config.authMailFrom, fetchImpl }) : undefined;
    const authService = mailer ? createAuthService({
        store: createAuthStore({ pool }), limiterStore: stores.limiterStore, masterKey: config.secrets.masterKey,
        mailer, limitsFor,
        linkFor: async (appId, token) => { const app = await stores.appStore.get(appId); return `https://${app?.domains?.[0] || `${appId}.${config.baseDomain}`}/?vibe_login=${token}`; },
    }) : undefined;
    // End-user notifications share the sender and are on only when it is configured. sendToUser is the in-process entry for scheduled jobs.
    const notifyService = mailer ? createNotifyService({ store: createNotifyStore({ pool }), limiterStore: stores.limiterStore, mailer, appStore: stores.appStore, masterKey: config.secrets.masterKey, baseUrl: config.notify.baseUrl, limits: config.notify.limits, limitsFor }) : undefined;
    const r2 = config.secrets.r2;
    const storageService = r2 ? createStorageService({
        store: createStorageStore({ pool }), fetchImpl, limitsFor,
        r2: { host: `${r2.accountId}.r2.cloudflarestorage.com`, bucket: r2.bucket, accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
    }) : undefined;
    // The proxy meter keeps its per-call event log and also feeds the daily rollup (connector calls and AI as 'api' and 'ai').
    const meter = createMeter({ sink: async (e) => {
        await Promise.allSettled([stores.usageSink(e), usage.record({ appId: e.appId, kind: e.connector === 'ai' ? 'ai' : 'api', status: e.status, bytes: e.responseBytes, ms: e.ms })]);
    } });
    const dataExecutor = createDataExecutor({ pool }); // same pool: each statement runs inside a transaction that switches into the app's own role
    const jobsStore = createJobsStore({ pool });
    let scheduler = null;
    if (config.jobsEnabled) {
        // Jobs reuse the proxy's limiter, meter, secrets and SSRF-guarded fetch, and write rows through the data executor (app role).
        const executor = dataExecutor;
        const runAction = createActionRunner({ appStore: stores.appStore, secretStore: stores.secretStore, limiter, meter, fetchImpl, resolve, runQuery: (appId, q) => executor.run(appId, q), getSpec: (appId) => jobsStore.getSpec(appId) });
        const gate = createGate(3);
        scheduler = startScheduler({
            tickMs: jobsTickMs, tick: () => runDueJobs({ pool, runAction, gate, limitsFor, onRun: (r) => usage.record({ appId: r.appId, kind: 'job', ok: r.skipped ? true : r.ok, ms: r.ms }) }),
            onError: (e) => log(JSON.stringify({ ts: new Date().toISOString(), event: 'jobs_tick_error', code: String(e?.code || e?.name || 'error').slice(0, 40) })),
        });
    }
    const payService = createPayService({ secretStore: stores.secretStore, limiter, limiterStore: stores.limiterStore, orderStore: createOrderStore({ pool }), auth: authService, fetchImpl, baseDomain: config.baseDomain });
    const handler = createHandler({
        jobsAdmin: createJobsAdmin({ store: jobsStore, appStore: stores.appStore }),
        dataExecutor, usage, limitsFor,
        usageAdmin: createUsageAdmin({ appStore: stores.appStore, usageStore: stores, limitsStore: stores.limitsStore, limitsResolver, defaults: limitDefaults, executor: dataExecutor, storageStore: createStorageStore({ pool }), limiterStore: stores.limiterStore }),
        storageService, authService, notifyHttp: createNotifyHttp({ svc: notifyService, auth: authService, appStore: stores.appStore, limiter, baseDomain: config.baseDomain }), payHttp: createPayHttp({ service: payService, appStore: stores.appStore, baseDomain: config.baseDomain }),
        appStore: stores.appStore, secretStore: stores.secretStore, limiter, globalAiLimiter,
        meter, fetchImpl, resolve, maxInflight: config.maxInflight,
        openRouterKey: config.secrets.openRouterKey, log, baseDomain: config.baseDomain,
        adminToken: config.secrets.adminToken, upsertApp: stores.upsertApp, ensureApp: stores.ensureApp, setEnabled: stores.setEnabled, setDomains: stores.setDomains, setManifest: stores.setManifest, copySecrets: stores.copySecrets, limiterStore: stores.limiterStore,
    });
    // usage_daily keeps 90 days; older rows are purged at start and then daily
    const purge = () => stores.purgeUsageDaily(new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)).catch(() => {});
    purge();
    const purgeTimer = setInterval(purge, 86_400_000); purgeTimer.unref();
    const server = http.createServer(handler);
    try { await new Promise((ok, bad) => { server.once('error', bad); server.listen(listenPort ?? config.port, '0.0.0.0', ok); }); } catch (e) { clearInterval(purgeTimer); await usage.close(); await scheduler?.stop(); throw e; }
    return {
        server, port: server.address().port, stores, pool, usage, notify: notifyService, scheduler,
        async close() { clearInterval(purgeTimer); await scheduler?.stop(); await new Promise((r) => server.close(r)); server.closeAllConnections?.(); await usage.close(); if (ownsPool) await pool.end().catch(() => {}); },
    };
}
