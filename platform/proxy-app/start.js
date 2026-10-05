// Wires config + Postgres stores + limiters + HTTP handler into a running server. Used by index.js and by tests.
import http from 'node:http';
import dns from 'node:dns/promises';
import pg from 'pg';
import { createHandler } from './server.js';
import { createPgStores } from '../store/pg.js';
import { createLimiter } from '../vibe-proxy/limits.js';
import { createMeter } from '../vibe-proxy/meter.js';
import { createAuthStore } from '../auth/pgStore.js';
import { createAuthService } from '../auth/service.js';
import { createResendMailer } from '../auth/mailer.js';
import { createStorageStore } from '../storage/pgStore.js';
import { createStorageService } from '../storage/service.js';
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
    const limiter = createLimiter({ store: stores.limiterStore, perIpPerMin: l.perIpPerMin, perAppPerMin: l.perAppPerMin, dailyCalls: l.dailyCalls, dailySpendMicros: l.dailySpendMicros });
    const globalAiLimiter = createLimiter({ store: stores.limiterStore, perIpPerMin: 1e9, perAppPerMin: 1e9, dailyCalls: 1e9, dailySpendMicros: config.platformAiDailyMicros });
    // Sign-in is only offered when a mail sender is configured; without one the auth routes answer 503.
    const authService = config.secrets.resendKey ? createAuthService({
        store: createAuthStore({ pool }), limiterStore: stores.limiterStore, masterKey: config.secrets.masterKey,
        mailer: createResendMailer({ apiKey: config.secrets.resendKey, from: config.authMailFrom, fetchImpl }),
        linkFor: async (appId, token) => { const app = await stores.appStore.get(appId); return `https://${app?.domains?.[0] || `${appId}.${config.baseDomain}`}/?vibe_login=${token}`; },
    }) : undefined;
    const r2 = config.secrets.r2;
    const storageService = r2 ? createStorageService({
        store: createStorageStore({ pool }), fetchImpl,
        r2: { host: `${r2.accountId}.r2.cloudflarestorage.com`, bucket: r2.bucket, accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
    }) : undefined;
    const meter = createMeter({ sink: stores.usageSink });
    const jobsStore = createJobsStore({ pool });
    let scheduler = null;
    if (config.jobsEnabled) {
        // Jobs reuse the proxy's limiter, meter, secrets and SSRF-guarded fetch, and write rows through the data executor (app role).
        const executor = createDataExecutor({ pool });
        const runAction = createActionRunner({ appStore: stores.appStore, secretStore: stores.secretStore, limiter, meter, fetchImpl, resolve, runQuery: (appId, q) => executor.run(appId, q), getSpec: (appId) => jobsStore.getSpec(appId) });
        const gate = createGate(3);
        scheduler = startScheduler({
            tickMs: jobsTickMs, tick: () => runDueJobs({ pool, runAction, gate }),
            onError: (e) => log(JSON.stringify({ ts: new Date().toISOString(), event: 'jobs_tick_error', code: String(e?.code || e?.name || 'error').slice(0, 40) })),
        });
    }
    const payService = createPayService({ secretStore: stores.secretStore, limiter, limiterStore: stores.limiterStore, orderStore: createOrderStore({ pool }), auth: authService, fetchImpl, baseDomain: config.baseDomain });
    const handler = createHandler({
        jobsAdmin: createJobsAdmin({ store: jobsStore, appStore: stores.appStore }),
        dataExecutor: createDataExecutor({ pool }), // same pool: each statement runs inside a transaction that switches into the app's own role
        storageService, authService, payHttp: createPayHttp({ service: payService, appStore: stores.appStore, baseDomain: config.baseDomain }),
        appStore: stores.appStore, secretStore: stores.secretStore, limiter, globalAiLimiter,
        meter, fetchImpl, resolve,
        openRouterKey: config.secrets.openRouterKey, log, baseDomain: config.baseDomain,
        adminToken: config.secrets.adminToken, upsertApp: stores.upsertApp, ensureApp: stores.ensureApp, setEnabled: stores.setEnabled, setDomains: stores.setDomains, setManifest: stores.setManifest, copySecrets: stores.copySecrets, limiterStore: stores.limiterStore,
    });
    const server = http.createServer(handler);
    try { await new Promise((ok, bad) => { server.once('error', bad); server.listen(listenPort ?? config.port, '0.0.0.0', ok); }); } catch (e) { await scheduler?.stop(); throw e; }
    return {
        server, port: server.address().port, stores, pool, scheduler,
        async close() { await scheduler?.stop(); await new Promise((r) => server.close(r)); server.closeAllConnections?.(); if (ownsPool) await pool.end().catch(() => {}); },
    };
}
