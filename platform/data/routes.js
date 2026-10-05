// HTTP mapping for the app data API: POST /<app>/db with a JSON request the query builder understands. The session is
// optional (public_read tables work for anyone); the builder decides what each access mode allows.
import { buildQuery } from './query.js';

export async function handleDb({ body, bearer, appId, auth, executor }) {
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
    const run = await executor.run(appId, built);
    if (!run.ok) return { status: run.status, body: { error: run.code } };
    return { status: 200, body: built.kind === 'select' ? { rows: run.rows } : { rows: run.rows, count: run.rows.length } };
}
