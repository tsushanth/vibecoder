/**
 * Chainable, thenable supabase query-builder stub.
 * handler({table, op, filters, payload, single}) -> {data, error}
 * Replace `client.from` (the real client is never contacted).
 */
export function makeBuilder(table, handler) {
    const q = { table, op: 'select', filters: [], payload: null, single: false };
    const run = () => Promise.resolve(handler(q) ?? { data: null, error: null });
    const b = new Proxy({}, {
        get(_t, prop) {
            if (prop === 'then') return (res, rej) => run().then(res, rej);
            if (prop === 'single' || prop === 'maybeSingle') return () => { q.single = true; return b; };
            if (prop === 'insert' || prop === 'update' || prop === 'delete' || prop === 'upsert') {
                return (payload) => { q.op = prop; q.payload = payload; return b; };
            }
            return (...args) => { q.filters.push([String(prop), ...args]); return b; };
        },
    });
    return b;
}

export function stubSupabase(client, handler) {
    const original = client.from;
    client.from = (table) => makeBuilder(table, handler);
    return () => { client.from = original; };
}

export const eqOf = (q, col) => q.filters.find((f) => f[0] === 'eq' && f[1] === col)?.[2];
