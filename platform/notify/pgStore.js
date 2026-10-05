// Postgres side of end-user notifications. Every query is scoped by app_id and uses bound parameters.
export function createNotifyStore({ pool }) {
    return {
        // The one place a recipient address comes from: the account the user signed in with, in this app.
        async getRecipient({ appId, userId }) {
            const r = await pool.query(
                'select u.email, (o.user_id is not null) as opted_out from platform.end_users u left join platform.notify_optouts o on o.app_id = u.app_id and o.user_id = u.id where u.app_id = $1 and u.id = $2',
                [appId, userId],
            );
            return r.rows[0] ? { email: r.rows[0].email, optedOut: r.rows[0].opted_out } : null;
        },
        // Idempotent; a user that does not exist in this app writes nothing.
        async optOut({ appId, userId }) {
            await pool.query('insert into platform.notify_optouts (app_id, user_id) select app_id, id from platform.end_users where app_id = $1 and id = $2 on conflict do nothing', [appId, userId]);
        },
    };
}
