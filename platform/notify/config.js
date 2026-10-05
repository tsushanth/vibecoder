// Notification settings, read from the same environment as the proxy. Kept out of proxy-app/config.js on purpose.
// Fails fast with the NAME of the bad setting, never its value.
function int(env, name, def, max) {
    const raw = env[name];
    if (raw === undefined || raw === '') return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`invalid setting ${name}: expected an integer from 1 to ${max}`);
    return n;
}

export function loadNotifyConfig(env, baseDomain) {
    let baseUrl = env.NOTIFY_PUBLIC_URL?.trim() || `https://vibe-proxy.${baseDomain}`;
    let ok = false;
    try { const u = new URL(baseUrl); ok = u.protocol === 'https:' && !u.search && !u.hash; } catch { /* reported below */ }
    if (!ok) throw new Error('invalid setting NOTIFY_PUBLIC_URL: expected an https URL');
    baseUrl = baseUrl.replace(/\/+$/, '');
    return {
        baseUrl,
        limits: {
            perUserPerHour: int(env, 'NOTIFY_USER_PER_HOUR', 3, 1000),
            perUserPerDay: int(env, 'NOTIFY_USER_PER_DAY', 10, 10000),
            perAppPerDay: int(env, 'NOTIFY_APP_PER_DAY', 200, 1_000_000),
            globalPerDay: int(env, 'NOTIFY_GLOBAL_PER_DAY', 2000, 10_000_000),
        },
    };
}
