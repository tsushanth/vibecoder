// Reads and validates the proxy's environment. Fails fast with the NAME of the bad setting, never its value.
import { loadNotifyConfig } from '../notify/config.js';
const need = (env, name) => {
    const v = env[name];
    if (typeof v !== 'string' || !v.trim()) throw new Error(`missing required setting ${name}`);
    return v.trim();
};

function int(env, name, def, { min, max }) {
    const raw = env[name];
    if (raw === undefined || raw === '') return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`invalid setting ${name}: expected an integer from ${min} to ${max}`);
    return n;
}

export function loadConfig(env = process.env) {
    const databaseUrl = need(env, 'DATABASE_URL');
    const masterKey = need(env, 'VIBE_MASTER_KEY');
    const openRouterKey = need(env, 'OPENROUTER_API_KEY');
    const baseDomain = need(env, 'BASE_DOMAIN').toLowerCase();
    const adminToken = need(env, 'PROXY_ADMIN_TOKEN');
    if (adminToken.length < 32) throw new Error('invalid setting PROXY_ADMIN_TOKEN: expected at least 32 characters');
    if (!/^[0-9a-f]{64}$/i.test(masterKey)) throw new Error('invalid setting VIBE_MASTER_KEY: expected 64 hex characters (32 bytes)');
    const resendKey = env.RESEND_API_KEY?.trim() || null;
    const authMailFrom = env.AUTH_MAIL_FROM?.trim() || null;
    if (resendKey && !authMailFrom) throw new Error('missing required setting AUTH_MAIL_FROM (needed when RESEND_API_KEY is set)');
    const r2 = ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].map((k) => env[k]?.trim() || null);
    if (r2.some(Boolean) && !r2.every(Boolean)) throw new Error('invalid storage settings: set all of R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY or none');
    if (r2[0] && !/^[0-9a-f]{32}$/i.test(r2[0])) throw new Error('invalid setting R2_ACCOUNT_ID: expected 32 hex characters');
    if (r2[1] && !/^[a-z0-9][a-z0-9-]{2,62}$/.test(r2[1])) throw new Error('invalid setting R2_BUCKET');
    const dbPoolMax = int(env, 'DB_POOL_MAX', 5, { min: 1, max: 20 });
    const config = {
        port: int(env, 'PORT', 8080, { min: 1, max: 65535 }),
        dbPoolMax,
        // requests served at once before new ones get 503 + Retry-After (admission control); default scales with the pool
        maxInflight: int(env, 'MAX_INFLIGHT', dbPoolMax * 10, { min: 1, max: 100000 }),
        baseDomain,
        limits: {
            perIpPerMin: int(env, 'PER_IP_PER_MIN', 30, { min: 1, max: 100000 }),
            perAppPerMin: int(env, 'PER_APP_PER_MIN', 120, { min: 1, max: 1000000 }),
            dailyCalls: int(env, 'DAILY_CALLS', 5000, { min: 1, max: 100000000 }),
            dailySpendMicros: int(env, 'APP_AI_DAILY_MICROS', 50_000, { min: 0, max: 1_000_000_000 }),
        },
        authMailFrom,
        notify: loadNotifyConfig(env, baseDomain),
        jobsEnabled: env.JOBS_ENABLED === 'true',   // scheduled jobs run only when this is exactly "true"; default off
        jobsTickMs: int(env, 'JOBS_TICK_MS', 30_000, { min: 1000, max: 600_000 }),
        usageFlushMs: int(env, 'USAGE_FLUSH_MS', 5000, { min: 0, max: 60_000 }), // usage events are merged in memory and written this often; 0 writes each one at once
        platformAiDailyMicros: int(env, 'PLATFORM_AI_DAILY_MICROS', 2_000_000, { min: 0, max: 1_000_000_000 }),
    };
    // non-enumerable so JSON.stringify and console.log of the config never print secrets
    Object.defineProperty(config, 'secrets', { value: { databaseUrl, masterKey, openRouterKey, adminToken, resendKey, r2: r2.every(Boolean) ? { accountId: r2[0], bucket: r2[1], accessKeyId: r2[2], secretAccessKey: r2[3] } : null }, enumerable: false });
    return config;
}
