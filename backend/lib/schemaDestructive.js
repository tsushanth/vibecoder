// The destructive-change list the platform proxy returns (what a schema push would drop or change). Only names ever pass through:
// a kind from the fixed set, a table and an optional column that look like identifiers, nothing else. Anything malformed is dropped.
export const DESTRUCTIVE_KINDS = ['drop_table', 'drop_column', 'change_type', 'make_required'];
const IDENT = /^[a-z][a-z0-9_]{0,62}$/;
const MAX_ITEMS = 100;

/** @returns {{kind:string, table:string, column?:string}[]} */
export function sanitizeDestructive(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const d of list) {
        if (out.length >= MAX_ITEMS) break;
        if (!d || typeof d !== 'object' || !DESTRUCTIVE_KINDS.includes(d.kind) || typeof d.table !== 'string' || !IDENT.test(d.table)) continue;
        if (d.kind === 'drop_table') { out.push({ kind: d.kind, table: d.table }); continue; }
        if (typeof d.column !== 'string' || !IDENT.test(d.column)) continue;
        out.push({ kind: d.kind, table: d.table, column: d.column });
    }
    return out;
}
