// HTTP mapping for the app data API: POST /<app>/db with a JSON request the query builder understands. The session is
// optional (public_read tables work for anyone); the builder decides what each access mode allows.
import { buildQuery } from './query.js';

export const ROW_CAP_MESSAGE = (cap) => `This app has reached its limit of ${cap} rows. Delete some rows, or ask the app owner to raise the limit.`;

/** limitsFor(appId) -> { rowCap } is optional; without it no per-app cap applies. With it, inserts fail closed over the cap. */
export async function handleDb({ body, bearer, appId, auth, executor, limitsFor }) {
    if (!executor || !auth) return { status: 503, body: { error: 'db_unavailable' } };
    let userId = null;
    if (bearer) {
        const s = await auth.verifySession({ appId, token: bearer });
        if (!s.ok) return { status: 401, body: { error: 'unauthorized' } };
        userId = s.user.id;
    }
    const cur = await executor.currentSpec(appId);
    if (!cur.spec) return { status: 404, body: { error: 'no_schema' } };
    const schemaName = await executor.ensure(appId);
    const built = buildQuery({ spec: cur.spec, schemaName, request: body, userId });
    if (!built.ok) return { status: built.status, body: { error: built.code } };
    if (built.kind === 'insert' && limitsFor) {
        // Cheap total across the app's (at most 20) tables. A little overshoot is possible when inserts race; the cap is a guard rail, not an accounting boundary.
        let total; let rowCap;
        try { ({ rowCap } = await limitsFor(appId)); total = await executor.totalRows(appId, Object.keys(cur.spec.tables)); } catch { return { status: 503, body: { error: 'limits_unavailable' } }; }
        const incoming = body.rows.length; // the builder has already checked it is a non-empty array
        if (total + incoming > rowCap) return { status: 413, body: { error: 'row_cap', message: ROW_CAP_MESSAGE(rowCap) } };
    }
    const run = await executor.run(appId, built);
    if (!run.ok) return { status: run.status, body: { error: run.code } };
    return { status: 200, body: built.kind === 'select' ? { rows: run.rows } : { rows: run.rows, count: run.rows.length } };
}
