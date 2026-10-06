// Shared fixture for the launch gates (cross-tenant matrix and load test): boots the REAL proxy (startServer) against a scratch
// Postgres through a restricted, non-inheriting login (like production's proxy role), with fake mail, R2, Stripe, upstream and AI fetches.
// Everything is local: nothing here can reach the live proxy, production Supabase or a real third party.
import { randomBytes } from 'node:crypto';
import { scratchDb, masterKey } from '../store/test/helpers.mjs';
import { startServer, makePool } from '../proxy-app/start.js';
import { createPgStores } from '../store/pg.js';
import { loadConfig } from '../proxy-app/config.js';

export const ADMIN_T = 'admin-' + 'z'.repeat(40);
export const BASE_DOMAIN = 'vibebuild.cc';
export const R2ENV = { R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'gate-test-files', R2_ACCESS_KEY_ID: 'k'.repeat(32), R2_SECRET_ACCESS_KEY: 's'.repeat(64) };
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120)]);
export const UPSTREAM_HOST = 'api.upstream-canary.test';

/**
 * Starts a scratch database and a proxy over it.
 * connLimit: when set, the proxy logs in as a fresh role with `connection limit <n>` (production uses 8); otherwise as an unlimited restricted login.
 * poolMax: the proxy's pg pool size (production default 5).
 */
export async function startPlatform({ connLimit = null, poolMax = 5, env = {}, log = () => {}, latencyMs = 0 } = {}) {
    const db = await scratchDb();
    if (db.unavailable) return { unavailable: db.unavailable };
    const MK = masterKey();
    const loginName = `gate_proxy_${randomBytes(4).toString('hex')}`;
    await db.admin.query(`create role ${loginName} login in role vibe_proxy${connLimit ? ` connection limit ${Number(connLimit)}` : ''}`);
    const mails = [], r2calls = [], stripeCalls = [], upstreamCalls = [];
    const fetchImpl = async (url, init = {}) => {
        const u = String(url);
        if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
        if (u.startsWith('https://api.resend.com/')) { mails.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
        if (u.includes('.r2.cloudflarestorage.com')) { r2calls.push({ url: u, method: init.method }); return new Response('', { status: 200 }); }
        if (u.startsWith('https://api.stripe.com/')) { stripeCalls.push({ headers: Object.fromEntries(new Headers(init.headers)), form: Object.fromEntries(new URLSearchParams(init.body)) }); return new Response(JSON.stringify({ id: 'cs_gate', url: 'https://checkout.stripe.com/c/pay/cs_gate' }), { status: 200, headers: { 'content-type': 'application/json' } }); }
        if (u.startsWith(`https://${UPSTREAM_HOST}/`)) { upstreamCalls.push({ url: u, headers: Object.fromEntries(new Headers(init.headers)) }); return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }); }
        if (u.startsWith('https://openrouter.ai/')) return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }], usage: { cost: 0.000001 } }), { status: 200, headers: { 'content-type': 'application/json' } });
        return new Response('{}', { status: 200 });
    };
    const resolve = async () => ['93.184.216.34'];
    const cfg = loadConfig({
        DATABASE_URL: `postgres://${loginName}@${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432}/${db.name}`, DB_POOL_MAX: String(poolMax), VIBE_MASTER_KEY: MK, OPENROUTER_API_KEY: 'sk-or-v1-FAKE', BASE_DOMAIN, PORT: '8080', PROXY_ADMIN_TOKEN: ADMIN_T,
        RESEND_API_KEY: 're_testkey12345', AUTH_MAIL_FROM: 'login@mail.vibebuild.cc', PER_IP_PER_MIN: '100000', PER_APP_PER_MIN: '1000000', DAILY_CALLS: '100000000', ...R2ENV, ...env,
    });
    // the pool is built exactly as in production (makePool: DB_POOL_MAX, 5 s connect/queue timeout, 30 s idle timeout)
    const proxyPool = makePool(cfg); proxyPool.on('error', () => {});
    const srv = await startServer(cfg, { pool: proxyPool, listenPort: 0, fetchImpl, resolve, log });
    const stores = createPgStores({ pool: db.pool, masterKey: MK });
    let ipn = 0;
    const nextIp = () => { ipn++; return `10.${(ipn >> 16) & 255}.${(ipn >> 8) & 255}.${ipn & 255}`; };
    const base = `http://127.0.0.1:${srv.port}`;

    /** One HTTP call. body: object (JSON), string/Buffer (raw). Each call gets its own client IP so per-IP limits never mask a result. */
    async function call(path, { method = 'POST', body = method === 'POST' ? {} : undefined, token, headers = {}, ip = nextIp(), timeoutMs = 15000 } = {}) {
        const isRaw = typeof body === 'string' || Buffer.isBuffer(body);
        const t0 = performance.now();
        const res = await fetch(`${base}${path}`, {
            method, signal: AbortSignal.timeout(timeoutMs),
            headers: { ...(body !== undefined && !isRaw ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), 'fly-client-ip': ip, ...headers },
            body: body === undefined || method === 'GET' || method === 'OPTIONS' ? undefined : (isRaw ? body : JSON.stringify(body)),
        });
        const text = await res.text();
        let json; try { json = JSON.parse(text); } catch { /* not json */ }
        return { status: res.status, headers: Object.fromEntries(res.headers), text, json, ms: performance.now() - t0 };
    }
    async function signIn(appId, email) {
        const before = mails.length;
        const r = await call(`/${appId}/auth/request`, { body: { email } });
        if (r.status !== 200 || mails.length === before) throw new Error(`sign-in request failed: ${r.status}`);
        const link = new URL(/https:\/\/\S+/.exec(mails.at(-1).text)[0]).searchParams.get('vibe_login');
        const c = await call(`/${appId}/auth/consume`, { body: { token: link } });
        if (c.status !== 200) throw new Error(`consume failed: ${c.status}`);
        return { token: c.json.token, user: c.json.user };
    }
    return {
        db, MK, stores, srv, proxyPool, loginName, mails, r2calls, stripeCalls, upstreamCalls, base, call, signIn, nextIp, cfg,
        async stop() {
            await srv.close(); await proxyPool.end().catch(() => {});
            await db.cleanup();
            const admin = new (await import('pg')).default.Pool({ host: process.env.PGHOST || 'localhost', user: process.env.PGUSER || process.env.USER, database: 'postgres', max: 1 });
            await admin.query(`drop role if exists ${loginName}`).catch(() => {}); await admin.end().catch(() => {});
        },
    };
}
