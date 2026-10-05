// Postgres metadata for stored files. Quota is enforced atomically per app by taking a transaction advisory lock.
export function createStorageStore({ pool }) {
    return {
        /** Reserves a file row if the app stays within its quotas. Returns the row, or { error: 'quota_bytes' | 'quota_files' }. */
        async reserve({ id, appId, userId, objectKey, name, contentType, bytes, isPublic, maxAppBytes, maxAppFiles }) {
            const c = await pool.connect();
            try {
                await c.query('begin');
                await c.query('select pg_advisory_xact_lock(hashtext($1))', [`files:${appId}`]);
                const u = (await c.query('select coalesce(sum(bytes), 0)::bigint as b, count(*)::int as n from platform.files where app_id = $1', [appId])).rows[0];
                if (Number(u.b) + bytes > maxAppBytes) { await c.query('rollback'); return { error: 'quota_bytes' }; }
                if (u.n + 1 > maxAppFiles) { await c.query('rollback'); return { error: 'quota_files' }; }
                const r = await c.query('insert into platform.files (id, app_id, user_id, object_key, name, content_type, bytes, is_public) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id', [id, appId, userId, objectKey, name, contentType, bytes, !!isPublic]);
                await c.query('commit');
                return { id: r.rows[0].id };
            } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
        },
        async get({ appId, id }) {
            const r = await pool.query('select id, user_id, object_key, name, content_type, bytes, is_public, created_at from platform.files where app_id = $1 and id = $2', [appId, id]);
            return r.rows[0] || null;
        },
        async list({ appId, userId, limit = 100 }) {
            return (await pool.query('select id, name, content_type, bytes, is_public, created_at from platform.files where app_id = $1 and user_id = $2 order by created_at desc limit $3', [appId, userId, limit])).rows;
        },
        async remove({ appId, id, userId }) {
            const r = await pool.query('delete from platform.files where app_id = $1 and id = $2 and user_id = $3 returning object_key', [appId, id, userId]);
            return r.rows[0]?.object_key ?? null;
        },
        async release({ appId, id }) { await pool.query('delete from platform.files where app_id = $1 and id = $2', [appId, id]); },
        async usage({ appId }) {
            const r = (await pool.query('select coalesce(sum(bytes), 0)::bigint as b, count(*)::int as n from platform.files where app_id = $1', [appId])).rows[0];
            return { bytes: Number(r.b), files: r.n };
        },
    };
}
