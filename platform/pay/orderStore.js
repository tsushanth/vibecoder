// Postgres store for paid orders. Idempotent on (app_id, session_id).
export function createOrderStore({ pool }) {
    return {
        /** Returns { created: true } for a new order, { created: false } when this session was already recorded. */
        async record({ appId, sessionId, itemId, quantity, amountCents, currency, clientReferenceId, customerEmail }) {
            const r = await pool.query(
                `insert into platform.orders (app_id, session_id, item_id, quantity, amount_cents, currency, status, client_reference_id, customer_email)
                 values ($1, $2, $3, $4, $5, $6, 'paid', $7, $8) on conflict (app_id, session_id) do nothing returning id`,
                [appId, sessionId, itemId, quantity, amountCents, currency, clientReferenceId ?? null, customerEmail ?? null],
            );
            return { created: r.rowCount === 1 };
        },
        /** The orders attributed to one signed-in end user of one app, newest first. */
        async listForUser({ appId, userId, limit = 100 }) {
            const { rows } = await pool.query(
                'select session_id, item_id, quantity, amount_cents, currency, status, created_at from platform.orders where app_id = $1 and client_reference_id = $2 order by created_at desc, id limit $3',
                [appId, userId, limit],
            );
            return rows.map((r) => ({ sessionId: r.session_id, itemId: r.item_id, quantity: r.quantity, amountCents: Number(r.amount_cents), currency: r.currency, status: r.status, createdAt: r.created_at }));
        },
    };
}
