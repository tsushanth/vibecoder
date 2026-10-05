// Reads and validates the proxy's environment. Fails fast with the NAME of the bad setting, never its value.
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
    const config = {
        port: int(env, 'PORT', 8080, { min: 1, max: 65535 }),
        dbPoolMax: int(env, 'DB_POOL_MAX', 5, { min: 1, max: 20 }),
        baseDomain,
        limits: {
            perIpPerMin: int(env, 'PER_IP_PER_MIN', 30, { min: 1, max: 100000 }),
            perAppPerMin: int(env, 'PER_APP_PER_MIN', 120, { min: 1, max: 1000000 }),
            dailyCalls: int(env, 'DAILY_CALLS', 5000, { min: 1, max: 100000000 }),
            dailySpendMicros: int(env, 'APP_AI_DAILY_MICROS', 50_000, { min: 0, max: 1_000_000_000 }),
        },
        platformAiDailyMicros: int(env, 'PLATFORM_AI_DAILY_MICROS', 2_000_000, { min: 0, max: 1_000_000_000 }),
    };
    // non-enumerable so JSON.stringify and console.log of the config never print secrets
    Object.defineProperty(config, 'secrets', { value: { databaseUrl, masterKey, openRouterKey, adminToken }, enumerable: false });
    return config;
}
