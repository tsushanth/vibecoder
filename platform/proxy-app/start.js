// Wires config + Postgres stores + limiters + HTTP handler into a running server. Used by index.js and by tests.
import http from 'node:http';
import dns from 'node:dns/promises';
import pg from 'pg';
import { createHandler } from './server.js';
import { createPgStores } from '../store/pg.js';
import { createLimiter } from '../vibe-proxy/limits.js';
import { createMeter } from '../vibe-proxy/meter.js';

async function dnsResolve(host) {
    const [a, b] = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host)]);
    return [...(a.status === 'fulfilled' ? a.value : []), ...(b.status === 'fulfilled' ? b.value : [])];
}

/** The pool is deliberately small: the shared database allows few connections. Connections open lazily. */
export function makePool(config) {
    return new pg.Pool({ connectionString: config.secrets.databaseUrl, max: config.dbPoolMax, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000 });
}

export async function startServer(config, { pool: injected, listenPort, resolve = dnsResolve, fetchImpl = globalThis.fetch, log = (l) => console.log(l) } = {}) {
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
    const handler = createHandler({
        appStore: stores.appStore, secretStore: stores.secretStore, limiter, globalAiLimiter,
        meter: createMeter({ sink: stores.usageSink }), fetchImpl, resolve,
        openRouterKey: config.secrets.openRouterKey, log, baseDomain: config.baseDomain,
        adminToken: config.secrets.adminToken, upsertApp: stores.upsertApp, ensureApp: stores.ensureApp, setEnabled: stores.setEnabled, setDomains: stores.setDomains, setManifest: stores.setManifest, copySecrets: stores.copySecrets, limiterStore: stores.limiterStore,
    });
    const server = http.createServer(handler);
    await new Promise((ok, bad) => { server.once('error', bad); server.listen(listenPort ?? config.port, '0.0.0.0', ok); });
    return {
        server, port: server.address().port, stores, pool,
        async close() { await new Promise((r) => server.close(r)); server.closeAllConnections?.(); if (ownsPool) await pool.end().catch(() => {}); },
    };
}
