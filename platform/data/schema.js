// Validates a generated app's data schema (vibe.schema.json) and plans the Postgres migration from the current schema to a new one.
// Nothing here talks to a database. Every identifier is validated to a strict pattern and emitted double-quoted; the only
// literals that reach DDL are defaults, which are restricted to simple escaped scalars.
import { createHash } from 'node:crypto';

export const NAME = /^[a-z][a-z0-9_]{0,40}$/;
export const TYPES = { text: 'text', integer: 'bigint', number: 'double precision', boolean: 'boolean', timestamp: 'timestamptz', json: 'jsonb' };
export const ACCESS = ['owner', 'public_read', 'authenticated', 'private'];
const IMPLICIT = new Set(['id', 'user_id', 'created_at']);
export const LIMITS = { tables: 20, columns: 30, indexesPerTable: 3, indexColumns: 3, defaultText: 200 };

const TOP_KEYS = new Set(['version', 'tables']);
const TABLE_KEYS = new Set(['access', 'columns', 'indexes']);
const COL_KEYS = new Set(['type', 'required', 'default']);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const q = (id) => `"${id}"`;

function checkDefault(type, v) {
    if (type === 'text') return typeof v === 'string' && v.length <= LIMITS.defaultText && !/[\u0000]/.test(v);
    if (type === 'integer') return Number.isSafeInteger(v);
    if (type === 'number') return typeof v === 'number' && Number.isFinite(v);
    if (type === 'boolean') return typeof v === 'boolean';
    if (type === 'timestamp') return v === 'now';
    return false; // json defaults are not supported
}

/** Returns { ok: true, spec } with a normalized copy, or { ok: false, errors: [{ code, table?, column? }] }. */
export function validateSpec(input) {
    const errors = [];
    const err = (code, table, column) => errors.push({ code, ...(table ? { table } : {}), ...(column ? { column } : {}) });
    if (!isObj(input)) return { ok: false, errors: [{ code: 'not_an_object' }] };
    for (const k of Object.keys(input)) if (!TOP_KEYS.has(k)) err('unknown_key');
    if (input.version !== 1) err('bad_version');
    if (!isObj(input.tables)) { err('no_tables'); return { ok: false, errors }; }
    const names = Object.keys(input.tables);
    if (names.length > LIMITS.tables) err('too_many_tables');
    const spec = { version: 1, tables: {} };
    for (const t of names) {
        if (!NAME.test(t) || t.startsWith('pg_') || t === 'sql') { err('bad_table_name', t); continue; }
        const def = input.tables[t];
        if (!isObj(def)) { err('bad_table', t); continue; }
        for (const k of Object.keys(def)) if (!TABLE_KEYS.has(k)) err('unknown_key', t);
        const access = def.access === undefined ? 'owner' : def.access;
        if (!ACCESS.includes(access)) err('bad_access', t);
        if (!isObj(def.columns)) { err('no_columns', t); continue; }
        const cols = Object.keys(def.columns);
        if (cols.length === 0) err('no_columns', t);
        if (cols.length > LIMITS.columns) err('too_many_columns', t);
        const outCols = {};
        for (const c of cols) {
            if (!NAME.test(c)) { err('bad_column_name', t, c); continue; }
            if (IMPLICIT.has(c)) { err('reserved_column', t, c); continue; }
            const cd = def.columns[c];
            if (!isObj(cd)) { err('bad_column', t, c); continue; }
            for (const k of Object.keys(cd)) if (!COL_KEYS.has(k)) err('unknown_key', t, c);
            if (!own(TYPES, cd.type)) { err('bad_type', t, c); continue; }
            if (cd.required !== undefined && typeof cd.required !== 'boolean') err('bad_required', t, c);
            if (cd.default !== undefined && !checkDefault(cd.type, cd.default)) err('bad_default', t, c);
            const o = { type: cd.type };
            if (cd.required === true) o.required = true;
            if (cd.default !== undefined) o.default = cd.default;
            outCols[c] = o;
        }
        const indexes = [];
        if (def.indexes !== undefined) {
            if (!Array.isArray(def.indexes) || def.indexes.length > LIMITS.indexesPerTable) err('bad_indexes', t);
            else for (const ix of def.indexes) {
                if (!Array.isArray(ix) || ix.length < 1 || ix.length > LIMITS.indexColumns || !ix.every((c) => typeof c === 'string' && (own(outCols, c) || c === 'created_at'))) { err('bad_index', t); continue; }
                if (new Set(ix).size !== ix.length) { err('bad_index', t); continue; }
                indexes.push([...ix]);
            }
        }
        spec.tables[t] = { access, columns: outCols, indexes };
    }
    return errors.length ? { ok: false, errors } : { ok: true, spec };
}

const literal = (type, v) => {
    if (type === 'text') return `'${v.replace(/'/g, "''")}'`;
    if (type === 'timestamp') return 'now()';
    return String(v);
};
const colSql = (name, c, { forAdd = false } = {}) => `${q(name)} ${TYPES[c.type]}${c.required ? ' not null' : ''}${c.default !== undefined ? ` default ${literal(c.type, c.default)}` : ''}`;
export const indexName = (table, cols) => `ix_${table}_${createHash('sha256').update(cols.join(',')).digest('hex').slice(0, 8)}`;
const sameIdx = (a, b) => a.join(',') === b.join(',');

/**
 * Plans the DDL from `current` (a validated spec or null) to `next` (a validated spec). Returns
 * { ok: true, statements: [sql...], destructive: [{ kind, table, column? }] } or { ok: false, errors }.
 * Destructive changes (drop table/column, type change, tightening to required) are only planned when allowDestructive is true.
 */
export function planMigration(current, next, { allowDestructive = false } = {}) {
    const cur = current?.tables || {};
    const statements = [];
    const destructive = [];
    const errors = [];
    const dangerous = (kind, table, column) => destructive.push({ kind, table, ...(column ? { column } : {}) });
    for (const [t, def] of Object.entries(next.tables)) {
        const old = cur[t];
        if (!old) {
            const body = [`"id" uuid primary key default gen_random_uuid()`, `"user_id" uuid`, `"created_at" timestamptz not null default now()`, ...Object.entries(def.columns).map(([c, cd]) => colSql(c, cd))];
            statements.push(`create table ${q(t)} (${body.join(', ')})`);
            statements.push(`create index ${q(`ix_${t}_user`)} on ${q(t)} ("user_id")`);
            for (const ix of def.indexes) statements.push(`create index ${q(indexName(t, ix))} on ${q(t)} (${ix.map(q).join(', ')})`);
            continue;
        }
        for (const [c, cd] of Object.entries(def.columns)) {
            const oc = old.columns[c];
            if (!oc) {
                if (cd.required && cd.default === undefined) { errors.push({ code: 'required_needs_default', table: t, column: c }); continue; }
                statements.push(`alter table ${q(t)} add column ${colSql(c, cd)}`);
                continue;
            }
            if (oc.type !== cd.type) { dangerous('change_type', t, c); if (allowDestructive) statements.push(`alter table ${q(t)} alter column ${q(c)} type ${TYPES[cd.type]} using ${q(c)}::${TYPES[cd.type]}`); }
            if (!oc.required && cd.required) {
                dangerous('make_required', t, c);
                if (allowDestructive) {
                    if (cd.default !== undefined) statements.push(`update ${q(t)} set ${q(c)} = ${literal(cd.type, cd.default)} where ${q(c)} is null`);
                    statements.push(`alter table ${q(t)} alter column ${q(c)} set not null`);
                }
            }
            if (oc.required && !cd.required) statements.push(`alter table ${q(t)} alter column ${q(c)} drop not null`);
            if (oc.default !== cd.default) statements.push(cd.default === undefined ? `alter table ${q(t)} alter column ${q(c)} drop default` : `alter table ${q(t)} alter column ${q(c)} set default ${literal(cd.type, cd.default)}`);
        }
        for (const c of Object.keys(old.columns)) if (!def.columns[c]) { dangerous('drop_column', t, c); if (allowDestructive) statements.push(`alter table ${q(t)} drop column ${q(c)}`); }
        for (const ix of def.indexes) if (!old.indexes.some((o) => sameIdx(o, ix))) statements.push(`create index ${q(indexName(t, ix))} on ${q(t)} (${ix.map(q).join(', ')})`);
        for (const ix of old.indexes) if (!def.indexes.some((n) => sameIdx(n, ix))) statements.push(`drop index if exists ${q(indexName(t, ix))}`);
    }
    for (const t of Object.keys(cur)) if (!next.tables[t]) { dangerous('drop_table', t); if (allowDestructive) statements.push(`drop table ${q(t)}`); }
    if (errors.length) return { ok: false, errors };
    if (destructive.length && !allowDestructive) return { ok: false, errors: [{ code: 'destructive_change_needs_confirmation' }], destructive };
    return { ok: true, statements, destructive };
}
