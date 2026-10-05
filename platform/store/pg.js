// Postgres-backed stores for the vibe-proxy app: apps, encrypted secrets, limiter counters and usage events.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { validateManifest } from '../vibe-proxy/manifest.js';

const APP_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
const MAX_SECRET = 4096;
const KEY_VERSION = 1;

export function createPgStores({ pool, masterKey, now = () => Date.now() }) {
    if (typeof masterKey !== 'string' || !/^[0-9a-f]{64}$/i.test(masterKey)) throw new Error('master key must be 64 hex characters (32 bytes)');
    const key = Buffer.from(masterKey, 'hex');
    const aad = (appId, name) => Buffer.from(`${appId}\u0000${name}\u0000v${KEY_VERSION}`);
    const at = (ms) => new Date(ms);

    const appStore = {
        async get(appId) {
            const { rows } = await pool.query('select enabled, domains, manifest from platform.apps where app_id = $1', [appId]);
            return rows[0] ? { enabled: rows[0].enabled, domains: rows[0].domains, manifest: rows[0].manifest } : null;
        },
    };

    async function upsertApp({ appId, manifest = null, domains = [], enabled = true }) {
        if (!APP_ID.test(String(appId))) throw new Error('invalid app id');
        if (manifest && Object.keys(manifest.connectors || {}).length) {
            const v = validateManifest(manifest);
            if (!v.ok) throw new Error(`invalid manifest: ${v.problems.slice(0, 3).join('; ')}`);
        }
        await pool.query(
            `insert into platform.apps (app_id, enabled, domains, manifest) values ($1, $2, $3, $4)
             on conflict (app_id) do update set enabled = $2, domains = $3, manifest = $4, updated_at = now()`,
            [appId, enabled, domains, manifest ? JSON.stringify(manifest) : null],
        );
    }

    async function ensureApp({ appId }) {
        if (!APP_ID.test(String(appId))) throw new Error('invalid app id');
        await pool.query('insert into platform.apps (app_id) values ($1) on conflict (app_id) do nothing', [appId]);
    }

    async function setDomains(appId, domains) {
        const { rowCount } = await pool.query('update platform.apps set domains = $2, updated_at = now() where app_id = $1', [appId, domains]);
        return rowCount > 0;
    }

    async function setEnabled(appId, enabled) {
        const { rowCount } = await pool.query('update platform.apps set enabled = $2, updated_at = now() where app_id = $1', [appId, !!enabled]);
        return rowCount > 0;
    }

    const secretStore = {
        async set(appId, name, value) {
            if (!SECRET_NAME.test(String(name))) throw new Error('invalid secret name');
            if (typeof value !== 'string' || !value.length || value.length > MAX_SECRET) throw new Error('invalid secret value');
            const nonce = randomBytes(12);
            const c = createCipheriv('aes-256-gcm', key, nonce);
            c.setAAD(aad(appId, name));
            const ciphertext = Buffer.concat([c.update(value, 'utf8'), c.final(), c.getAuthTag()]);
            await pool.query(
                `insert into platform.app_secrets (app_id, name, ciphertext, nonce, key_version) values ($1, $2, $3, $4, $5)
                 on conflict (app_id, name) do update set ciphertext = $3, nonce = $4, key_version = $5, updated_at = now()`,
                [appId, name, ciphertext, nonce, KEY_VERSION],
            );
        },
        async get(appId, name) {
            const { rows } = await pool.query('select ciphertext, nonce from platform.app_secrets where app_id = $1 and name = $2', [appId, name]);
            if (!rows[0]) return undefined;
            try {
                const buf = Buffer.from(rows[0].ciphertext);
                const d = createDecipheriv('aes-256-gcm', key, Buffer.from(rows[0].nonce));
                d.setAAD(aad(appId, name));
                d.setAuthTag(buf.subarray(buf.length - 16));
                return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8');
            } catch { throw new Error('secret_decrypt_failed'); }
        },
        async has(appId, name) {
            const { rowCount } = await pool.query('select 1 from platform.app_secrets where app_id = $1 and name = $2', [appId, name]);
            return rowCount > 0;
        },
        async list(appId) {
            const { rows } = await pool.query('select name, updated_at from platform.app_secrets where app_id = $1 order by name', [appId]);
            return rows.map((r) => ({ name: r.name, updatedAt: r.updated_at }));
        },
        async delete(appId, name) { await pool.query('delete from platform.app_secrets where app_id = $1 and name = $2', [appId, name]); },
    };

    const bump = (amount) => `
        insert into platform.limiter_counters (key, n, expires_at) values ($1, ${amount}, $2::timestamptz + make_interval(secs => $3))
        on conflict (key) do update set
            n = case when platform.limiter_counters.expires_at <= $2::timestamptz then ${amount} else platform.limiter_counters.n + ${amount} end,
            expires_at = case when platform.limiter_counters.expires_at <= $2::timestamptz then $2::timestamptz + make_interval(secs => $3) else platform.limiter_counters.expires_at end
        returning n`;
    const limiterStore = {
        async incr(k, ttlSec) { return Number((await pool.query(bump(1), [k, at(now()), ttlSec])).rows[0].n); },
        async add(k, amount, ttlSec) { return Number((await pool.query(bump('$4::bigint'), [k, at(now()), ttlSec, Math.round(amount)])).rows[0].n); },
        async get(k) {
            const { rows } = await pool.query('select n from platform.limiter_counters where key = $1 and expires_at > $2', [k, at(now())]);
            return rows[0] ? Number(rows[0].n) : 0;
        },
        async set(k, n, ttlSec) {
            await pool.query(
                `insert into platform.limiter_counters (key, n, expires_at) values ($1, $2, ${ttlSec ? '$3::timestamptz + make_interval(secs => $4)' : "'infinity'::timestamptz"})
                 on conflict (key) do update set n = excluded.n, expires_at = excluded.expires_at`,
                ttlSec ? [k, n, at(now()), ttlSec] : [k, n],
            );
        },
        async purgeExpired() { await pool.query('delete from platform.limiter_counters where expires_at <= $1', [at(now())]); },
    };

    async function usageSink(e) {
        await pool.query(
            'insert into platform.usage_events (ts, day, app_id, connector, status, outcome, request_bytes, response_bytes, ms) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
            [e.ts, e.day, e.appId, e.connector ?? null, e.status ?? null, e.outcome ?? null, e.requestBytes || 0, e.responseBytes || 0, e.ms || 0],
        );
    }
    async function usageSummary(appId, day) {
        const { rows } = await pool.query(
            `select connector, count(*)::int as calls, (count(*) filter (where status >= 400))::int as errors, coalesce(sum(response_bytes), 0)::int as bytes
             from platform.usage_events where app_id = $1 and day = $2 group by connector`, [appId, day]);
        return Object.fromEntries(rows.map((r) => [r.connector, { calls: r.calls, errors: r.errors, responseBytes: r.bytes }]));
    }

    return { appStore, upsertApp, ensureApp, setEnabled, setDomains, secretStore, limiterStore, usageSink, usageSummary };
}
