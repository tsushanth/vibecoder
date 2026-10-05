// Runs a generated app's schema migrations and queries inside its own Postgres role. The proxy's login may SET ROLE into
// an app role without inheriting it, so a statement can only touch that app's schema. Role and schema names come from
// platform.app_dbs and are re-validated before they are interpolated (SET ROLE cannot take parameters).
import { planMigration } from './schema.js';

const ROLE = /^appr_[0-9a-f]{20}$/;
const SCHEMA = /^apps_[0-9a-f]{20}$/;
const MAX_ROWS = 1000;
// Postgres checks SET ROLE against the login user, not the current role, so SQL running as one app could switch into another app's
// role if it could call set_config('role', ...) or similar. The builder never emits these; this refuses them anyway. Quoted
// identifiers are removed first, so an app may still name a column anything the spec allows.
const FORBIDDEN = /\b(set_config|current_setting|session_user|session|role|reset|authorization|pg_[a-z_]*|dblink[a-z_]*|copy|lo_[a-z]+|nextval|setval|txid_[a-z_]*|do|call|execute|prepare|listen|notify|vacuum|analyze|truncate|grant|revoke)\b/i;
export const isSafeStatement = (text) => typeof text === 'string' && /^(select|insert|update|delete)\b/i.test(text) && !text.includes(';') && !text.includes('--') && !text.includes('/*') && !text.includes("'") && !FORBIDDEN.test(text.replace(/"[^"]*"/g, '""'));

const mapError = (e) => {
    const c = e?.code;
    if (c === '23502') return { status: 400, code: 'missing_required' };
    if (c === '23505') return { status: 409, code: 'conflict' };
    if (c === '22P02' || c === '22003' || c === '22007' || c === '22001' || c === '22025' || c === '23514') return { status: 400, code: 'invalid_value' };
    if (c === '57014') return { status: 504, code: 'query_timeout' };
    if (c === '55P03') return { status: 503, code: 'busy' };
    return { status: 500, code: 'db_error' };
};

export function createDataExecutor({ pool, timeoutMs = 5000, ddlTimeoutMs = 30000 }) {
    const cache = new Map(); // appId -> { role, schema }

    async function locate(appId) {
        const hit = cache.get(appId);
        if (hit) return hit;
        let r = await pool.query('select role_name, schema_name from platform.app_dbs where app_id = $1', [appId]);
        if (!r.rows[0]) r = await pool.query('select role_name, schema_name from platform.provision_app_db($1)', [appId]);
        const { role_name: role, schema_name: schema } = r.rows[0];
        if (!ROLE.test(role) || !SCHEMA.test(schema)) throw new Error('bad app database names');
        cache.set(appId, { role, schema });
        return { role, schema };
    }

    async function inRole(appId, ms, fn) {
        const { role, schema } = await locate(appId);
        const client = await pool.connect();
        try {
            await client.query('begin');
            await client.query(`set local role "${role}"`);
            await client.query(`set local search_path = "${schema}"`);
            await client.query(`set local statement_timeout = ${Math.floor(ms)}`);
            await client.query("set local lock_timeout = '3s'");
            const out = await fn(client, schema);
            await client.query('commit');
            return out;
        } catch (e) {
            await client.query('rollback').catch(() => {});
            throw e;
        } finally { client.release(); }
    }

    return {
        /** Creates the app's schema and role if needed. Returns the schema name. */
        async ensure(appId) { return (await locate(appId)).schema; },

        /** Like currentSpec but never provisions: an app with no database yet reads as { spec: null, version: 0 }. */
        async peekSpec(appId) {
            return (await pool.query('select spec, version from platform.app_dbs where app_id = $1', [appId])).rows[0] || { spec: null, version: 0 };
        },

        async currentSpec(appId) {
            await locate(appId);
            return (await pool.query('select spec, version from platform.app_dbs where app_id = $1', [appId])).rows[0] || { spec: null, version: 0 };
        },

        /** Plans and applies a validated spec. Returns { ok: true, applied, version } or { ok: false, errors, destructive? }. */
        async applySchema({ appId, spec, allowDestructive = false }) {
            const cur = await this.currentSpec(appId);
            const plan = planMigration(cur.spec, spec, { allowDestructive });
            if (!plan.ok) return plan;
            let version;
            try {
                version = await inRole(appId, ddlTimeoutMs, async (client) => {
                    for (const sql of plan.statements) await client.query(sql);
                    // the spec is stored in the same transaction as the DDL so they can never disagree
                    await client.query('reset role');
                    return (await client.query('update platform.app_dbs set spec = $2, version = version + 1, updated_at = now() where app_id = $1 returning version', [appId, JSON.stringify(spec)])).rows[0].version;
                });
            } catch (e) { return { ok: false, errors: [{ code: 'migration_failed' }] }; }
            return { ok: true, applied: plan.statements.length, version };
        },

        /** Runs one built query ({ text, values }) as the app and returns { ok: true, rows } or { ok: false, status, code }. */
        async run(appId, { text, values }) {
            // Defense in depth: the builder only emits one SELECT/INSERT/UPDATE/DELETE. Anything else (a second statement, RESET ROLE,
            // SET ROLE) is refused here, because with no bound values the driver would use the simple protocol that allows several.
            if (!isSafeStatement(text) || !Array.isArray(values)) return { ok: false, status: 500, code: 'bad_query' };
            try {
                const rows = await inRole(appId, timeoutMs, async (client) => (await client.query(text, values)).rows);
                return rows.length > MAX_ROWS ? { ok: false, status: 413, code: 'result_too_large' } : { ok: true, rows };
            } catch (e) { return { ok: false, ...mapError(e) }; }
        },

        /** Count of rows in one table, used for per-app quotas. */
        async count(appId, table) {
            if (!/^[a-z][a-z0-9_]{0,40}$/.test(table)) throw new Error('bad table');
            return inRole(appId, timeoutMs, async (client) => Number((await client.query(`select count(*)::int n from "${table}"`)).rows[0].n));
        },
    };
}
