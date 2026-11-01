// Stateful in-memory stand-in for the two tables the entitlement code touches, for use with stubSupabase().
// Keys: user_subscriptions -> user_id, vibebuild_billing_events -> (source, event_id).
export function createMemDb({ eventsTable = true } = {}) {
    const db = {
        subs: new Map(),   // user_id -> row
        events: new Map(), // `${source}|${event_id}` -> row
        writes: [],        // every upsert on user_subscriptions, in order
        failWrites: false, // simulate a database outage on user_subscriptions writes
        failReads: false,
        eventsTable,
    };
    const match = (row, filters) => filters.every(([op, col, val]) => op !== 'eq' || row[col] === val);
    db.handler = (q) => {
        if (q.table === 'user_subscriptions') {
            if (q.op === 'upsert') {
                if (db.failWrites) return { data: null, error: { code: '57P01', message: 'terminating connection' } };
                const prev = db.subs.get(q.payload.user_id) || {};
                const row = { id: prev.id || `id-${db.subs.size + 1}`, ...prev, ...q.payload };
                db.subs.set(row.user_id, row); db.writes.push({ ...row });
                return { data: null, error: null };
            }
            if (q.op === 'select') {
                if (db.failReads) return { data: null, error: { code: '57P01', message: 'terminating connection' } };
                const rows = [...db.subs.values()].filter((r) => match(r, q.filters));
                if (q.single) return rows[0] ? { data: rows[0], error: null } : (q.maybe ? { data: null, error: null } : { data: null, error: { code: 'PGRST116' } });
                return { data: rows, error: null };
            }
        }
        if (q.table === 'vibebuild_billing_events') {
            if (!db.eventsTable) return { data: null, error: { code: '42P01', message: 'relation "vibebuild_billing_events" does not exist' } };
            if (q.op === 'upsert') { db.events.set(`${q.payload.source}|${q.payload.event_id}`, { ...q.payload }); return { data: null, error: null }; }
            if (q.op === 'select') {
                let rows = [...db.events.values()].filter((r) => match(r, q.filters));
                if (q.single) return { data: rows[0] ?? null, error: null };
                rows = rows.filter((r) => r.event_created).sort((a, b) => new Date(b.event_created) - new Date(a.event_created));
                return { data: rows.slice(0, 1), error: null };
            }
        }
        return { data: null, error: null };
    };
    return db;
}
