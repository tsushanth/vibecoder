// Postgres side of end-user auth. Every query is scoped by app_id and uses bound parameters.
export function createAuthStore({ pool }) {
    return {
        async addLink({ tokenHash, appId, email, expiresAt }) {
            await pool.query('insert into platform.login_links (token_hash, app_id, email, expires_at) values ($1, $2, $3, $4)', [tokenHash, appId, email, new Date(expiresAt)]);
        },
        // Atomic: a link works once, only for its own app, only before it expires.
        async consumeLink({ tokenHash, appId, now }) {
            const r = await pool.query('update platform.login_links set used_at = $3 where token_hash = $1 and app_id = $2 and used_at is null and expires_at > $3 returning email', [tokenHash, appId, new Date(now)]);
            return r.rows[0]?.email ?? null;
        },
        async upsertUser({ appId, email }) {
            const r = await pool.query('insert into platform.end_users (app_id, email) values ($1, $2) on conflict (app_id, email) do update set email = excluded.email returning id', [appId, email]);
            return r.rows[0].id;
        },
        async createSession({ jti, appId, userId, expiresAt }) {
            await pool.query('insert into platform.sessions (jti, app_id, user_id, expires_at) values ($1, $2, $3, $4)', [jti, appId, userId, new Date(expiresAt)]);
        },
        async activeSession({ jti, appId, now }) {
            const r = await pool.query('select s.user_id, u.email from platform.sessions s join platform.end_users u on u.app_id = s.app_id and u.id = s.user_id where s.jti = $1 and s.app_id = $2 and s.revoked_at is null and s.expires_at > $3', [jti, appId, new Date(now)]);
            return r.rows[0] ? { userId: r.rows[0].user_id, email: r.rows[0].email } : null;
        },
        async revokeSession({ jti, appId, now }) {
            const r = await pool.query('update platform.sessions set revoked_at = $3 where jti = $1 and app_id = $2 and revoked_at is null', [jti, appId, new Date(now)]);
            return r.rowCount > 0;
        },
        async purgeExpired({ now }) {
            await pool.query('delete from platform.login_links where expires_at < $1', [new Date(now - 86_400_000)]);
            await pool.query('delete from platform.sessions where expires_at < $1', [new Date(now - 86_400_000)]);
        },
    };
}
