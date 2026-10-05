// What a job does when it runs. Two actions: call a connector and save mapped fields as one row, or prune old rows.
// Everything that touches the database goes through an injected runQuery(appId, { text, values }) that returns the data
// executor's result shape ({ ok: true, rows } | { ok: false, code }), so the same role switching, statement checks and
// timeouts apply as for any app query. Identifiers are re-checked against the app's current schema on every run and are
// always double-quoted; values are always bound parameters. Results carry an error CODE only, never a response body.
import { guardedProxy } from '../vibe-proxy/guarded.js';
import { resolveManifest } from '../vibe-proxy/builtins.js';
import { NAME } from '../data/schema.js';

export const PRUNE_BATCH = 500;
export const PRUNE_MAX_BATCHES = 10;
const MAX_TEXT = 10_000;
const RESERVED = new Set(['id', 'user_id', 'created_at']);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const q = (id) => `"${id}"`;
// Denials from the shared limiter are not the job's fault: they skip the run without counting as a failure.
const SKIP_CODES = new Set(['app_disabled', 'rate_limited_ip', 'rate_limited_app', 'daily_call_cap', 'spend_cap', 'limiter_unavailable']);
// Codes the platform proxy itself can answer with. An upstream API's own error text is never trusted as a code.
const PLATFORM_CODES = new Set(['unknown_connector', 'method_not_allowed', 'path_not_allowed', 'request_too_large', 'secret_missing', 'bad_body', 'blocked_host', 'redirect_blocked', 'response_too_large', 'upstream_timeout', 'upstream_error']);

/** RFC 6901 lookup. Own properties only. Returns { found, value }. */
export function resolvePointer(doc, pointer) {
    if (typeof pointer !== 'string' || !pointer.startsWith('/')) return { found: false };
    let cur = doc;
    for (const raw of pointer.slice(1).split('/')) {
        const seg = raw.replace(/~1/g, '/').replace(/~0/g, '~');
        if (Array.isArray(cur)) {
            if (!/^(0|[1-9]\d{0,8})$/.test(seg) || Number(seg) >= cur.length) return { found: false };
            cur = cur[Number(seg)];
        } else if (cur !== null && typeof cur === 'object' && own(cur, seg)) cur = cur[seg];
        else return { found: false };
    }
    return { found: true, value: cur };
}

/** Converts one JSON value to what the column type stores. Returns { ok: true, value } or { ok: false, code }. */
export function coerce(type, v) {
    const bad = { ok: false, code: 'bad_type' };
    if (type === 'text') {
        if (typeof v === 'number' || typeof v === 'boolean') v = String(v);
        if (typeof v !== 'string') return bad;
        return v.length > MAX_TEXT ? { ok: false, code: 'value_too_large' } : { ok: true, value: v };
    }
    if (type === 'integer') {
        if (typeof v === 'string' && /^-?\d{1,15}$/.test(v)) v = Number(v);
        return Number.isSafeInteger(v) ? { ok: true, value: v } : bad;
    }
    if (type === 'number') {
        if (typeof v === 'string' && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)) v = Number(v);
        return typeof v === 'number' && Number.isFinite(v) ? { ok: true, value: v } : bad;
    }
    if (type === 'boolean') {
        if (v === 'true') v = true; else if (v === 'false') v = false;
        return typeof v === 'boolean' ? { ok: true, value: v } : bad;
    }
    if (type === 'timestamp') {
        if (typeof v !== 'string' || v.length > 40) return bad;
        const ms = Date.parse(v);
        return Number.isFinite(ms) ? { ok: true, value: new Date(ms).toISOString() } : bad;
    }
    if (type === 'json') {
        const s = JSON.stringify(v);
        if (s === undefined) return bad;
        return s.length > MAX_TEXT ? { ok: false, code: 'value_too_large' } : { ok: true, value: s };
    }
    return bad;
}

/** Builds the single-row insert for a mapped save. Returns { ok: true, text, values } or { ok: false, code }. */
export function buildInsert({ save, json, tables }) {
    const t = save?.table;
    if (typeof t !== 'string' || !NAME.test(t) || !tables || !own(tables, t)) return { ok: false, code: 'schema_mismatch' };
    const cols = tables[t].columns;
    const names = []; const values = [];
    for (const [col, ptr] of Object.entries(save.map || {})) {
        if (!NAME.test(col) || RESERVED.has(col) || !own(cols, col)) return { ok: false, code: 'schema_mismatch' };
        const hit = resolvePointer(json, ptr);
        if (!hit.found || hit.value === null) {
            if (cols[col].required && cols[col].default === undefined) return { ok: false, code: 'missing_field' };
            if (cols[col].default !== undefined) continue; // let the column default apply
            names.push(col); values.push(null);
            continue;
        }
        const c = coerce(cols[col].type, hit.value);
        if (!c.ok) return { ok: false, code: c.code };
        names.push(col); values.push(c.value);
    }
    for (const [col, def] of Object.entries(cols)) if (def.required && def.default === undefined && !names.includes(col)) return { ok: false, code: 'missing_field' };
    if (!names.length) return { ok: false, code: 'missing_field' };
    return { ok: true, text: `insert into ${q(t)} (${names.map(q).join(', ')}) values (${names.map((_, i) => `$${i + 1}`).join(', ')})`, values };
}

/** One batch of the prune: oldest rows first, bounded so it fits the statement timeout. */
export function buildPrune({ table, olderThanDays, nowMs, tables }) {
    if (typeof table !== 'string' || !NAME.test(table) || !tables || !own(tables, table)) return { ok: false, code: 'schema_mismatch' };
    const cutoff = new Date(nowMs - olderThanDays * 86_400_000).toISOString();
    return { ok: true, text: `delete from ${q(table)} where "id" in (select "id" from ${q(table)} where "created_at" < $1::timestamptz order by "created_at" limit ${PRUNE_BATCH}) returning "id"`, values: [cutoff] };
}

export function createActionRunner({ appStore, secretStore, limiter, meter, fetchImpl, resolve, runQuery, getSpec, timeoutMs = 15_000, now = () => Date.now() }) {
    const fail = (code) => ({ ok: false, code });
    const dbFail = (r) => fail(`db_${String(r.code || 'error').replace(/[^a-z0-9_]/g, '').slice(0, 30) || 'error'}`);

    async function connectorAction({ appId, action, signal }) {
        const app = await appStore.get(appId);
        if (!app || !app.enabled) return { ok: false, skipped: true, code: 'app_disabled' };
        const own_ = app.manifest?.connectors && Object.keys(app.manifest.connectors).length ? app.manifest : null;
        let manifest;
        try { manifest = resolveManifest(own_); } catch { return fail('bad_manifest'); }
        const conn = manifest.connectors[action.connector];
        if (!conn) return fail('unknown_connector');
        const spec = await getSpec(appId);
        if (!spec?.tables || !own(spec.tables, action.save.table)) return fail('schema_mismatch');
        const secrets = conn.secret ? { [conn.secret.name]: await secretStore.get(appId, conn.secret.name) } : {};
        const res = await guardedProxy({ limiter, meter, appId, ip: 'platform-jobs', req: { connector: action.connector, method: 'GET', path: action.path, query: action.query }, manifest, secrets, fetchImpl, resolve, limits: { timeoutMs } });
        if (signal?.aborted) return fail('timeout');
        if (res.status < 200 || res.status >= 300) {
            let code; try { code = JSON.parse(res.body)?.error; } catch { /* not json */ }
            if (SKIP_CODES.has(code) && [403, 429, 503].includes(res.status)) return { ok: false, skipped: true, code };
            return fail(PLATFORM_CODES.has(code) ? code : `upstream_${res.status}`);
        }
        let json;
        try { json = JSON.parse(res.body); } catch { return fail('bad_json'); }
        const built = buildInsert({ save: action.save, json, tables: spec.tables });
        if (!built.ok) return fail(built.code);
        if (signal?.aborted) return fail('timeout');
        const r = await runQuery(appId, { text: built.text, values: built.values });
        return r.ok ? { ok: true, rows: 1 } : dbFail(r);
    }

    async function pruneAction({ appId, action, signal }) {
        const app = await appStore.get(appId);
        if (!app || !app.enabled) return { ok: false, skipped: true, code: 'app_disabled' };
        const spec = await getSpec(appId);
        let deleted = 0;
        for (let i = 0; i < PRUNE_MAX_BATCHES; i++) {
            if (signal?.aborted) return fail('timeout');
            const built = buildPrune({ table: action.table, olderThanDays: action.olderThanDays, nowMs: now(), tables: spec?.tables });
            if (!built.ok) return fail(built.code);
            const r = await runQuery(appId, { text: built.text, values: built.values });
            if (!r.ok) return dbFail(r);
            deleted += r.rows.length;
            if (r.rows.length < PRUNE_BATCH) break;
        }
        return { ok: true, rows: deleted };
    }

    /** Runs one job's action. Returns { ok: true } or { ok: false, code, skipped? }. Never throws. */
    return async function runAction({ appId, action, signal }) {
        try {
            if (action?.type === 'connector') return await connectorAction({ appId, action, signal });
            if (action?.type === 'prune') return await pruneAction({ appId, action, signal });
            return fail('bad_action');
        } catch { return fail('internal_error'); }
    };
}
