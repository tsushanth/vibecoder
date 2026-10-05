// Table schemas for generated apps: the model declares tables in vibe.schema.json and reads and writes them with vibe.db.
// The schema is untrusted model output: it is validated with a vendored copy of the platform's own validator
// (lib/vendor/schema.js, kept byte-identical by a test), and only the normalised form is ever written.
// The proxy validates again when the schema is applied, so this is the early, fixable check, not the only one.
// Problem texts contain only table and column names (and only when they look like names), never other model-written content.
import { validateSpec } from './vendor/schema.js';

export const SCHEMA_FILE = 'vibe.schema.json';
const MAX_BYTES = 16384;
const IMPLICIT = ['id', 'user_id', 'created_at'];
const NAME_SHAPE = /^[A-Za-z0-9_]{1,41}$/;
const safe = (n) => (NAME_SHAPE.test(String(n)) ? String(n) : '(invalid name)');

const MESSAGES = {
    not_an_object: 'the file must be a JSON object',
    unknown_key: 'has a key that is not allowed (allowed: version and tables at the top; access, columns and indexes per table; type, required and default per column)',
    bad_version: 'version must be the number 1',
    no_tables: 'must have a "tables" object',
    too_many_tables: 'has too many tables (max 20)',
    bad_table_name: 'has a table name that is not lowercase letters, digits and _ starting with a letter (max 41 characters, not starting with pg_, not "sql")',
    bad_table: 'a table definition must be an object',
    bad_access: 'access must be one of owner, public_read, authenticated, private',
    no_columns: 'needs a non-empty "columns" object',
    too_many_columns: 'has too many columns (max 30)',
    bad_column_name: 'has a column name that is not lowercase letters, digits and _ starting with a letter',
    reserved_column: 'id, user_id and created_at are added by the platform: never declare them',
    bad_column: 'a column definition must be an object',
    bad_type: 'type must be one of text, integer, number, boolean, timestamp, json',
    bad_required: 'required must be true or false',
    bad_default: 'default must be a simple value of the column type (a string, integer, number or boolean; "now" for a timestamp; json has no default)',
    bad_indexes: 'indexes must be a list of at most 3 lists of column names',
    bad_index: 'an index must list 1 to 3 distinct declared columns',
};

/** Returns { ok, spec, problems }. Never throws. */
export function parseSchemaFile(text) {
    const fail = (...problems) => ({ ok: false, spec: null, problems });
    if (typeof text !== 'string' || !text.trim()) return fail(`${SCHEMA_FILE} is empty`);
    if (Buffer.byteLength(text) > MAX_BYTES) return fail(`${SCHEMA_FILE} is too large (max ${MAX_BYTES} bytes)`);
    let raw;
    try { raw = JSON.parse(text); } catch { return fail(`${SCHEMA_FILE} is not valid JSON`); }
    const v = validateSpec(raw);
    if (v.ok) return { ok: true, spec: v.spec, problems: [] };
    const out = new Set();
    for (const e of v.errors) {
        const where = e.table ? `${SCHEMA_FILE} table "${safe(e.table)}"${e.column ? ` column "${safe(e.column)}"` : ''}` : SCHEMA_FILE;
        out.add(`${where}: ${MESSAGES[e.code] || 'is invalid'}`);
    }
    return fail(...[...out].slice(0, 10));
}

// ---- reading vibe.db calls out of the app's code (a small scanner, not a JS parser: it understands strings and brackets)
const TEXT_FILE = /\.(html?|js|mjs)$/i;
const isSdk = (p) => p.split('/').pop() === 'vibe.js';

function skipString(s, i) {
    const q = s[i];
    for (let j = i + 1; j < s.length; j++) {
        if (s[j] === '\\') { j++; continue; }
        if (s[j] === q) return j + 1;
    }
    return s.length;
}

/** s[open] is an opening bracket; returns the index of its matching close, or -1. */
function matching(s, open) {
    let depth = 0;
    for (let i = open; i < s.length; i++) {
        const c = s[i];
        if (c === '"' || c === "'" || c === '`') { i = skipString(s, i) - 1; continue; }
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
}

/** Splits the inside of a call on its top-level commas. */
function splitArgs(inner) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < inner.length; i++) {
        const c = inner[i];
        if (c === '"' || c === "'" || c === '`') { i = skipString(inner, i) - 1; continue; }
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth--;
        else if (c === ',' && depth === 0) { parts.push(inner.slice(start, i)); start = i + 1; }
    }
    parts.push(inner.slice(start));
    return parts.map((p) => p.trim()).filter(Boolean);
}

/** Keys written directly in an object literal. spread is true when it also has ...x or a computed key, so the key list is incomplete. */
function objectKeys(obj) {
    const keys = [];
    let spread = false;
    for (const part of splitArgs(obj.slice(1, -1))) {
        const m = /^(?:([A-Za-z_$][\w$]*)|(["'])([^"']*)\2)\s*(?::|$)/.exec(part);
        if (m) keys.push(m[1] || m[3]); else spread = true;
    }
    return { keys, spread };
}

/** The object literals in an insert argument: one object, or an array literal of them. null when the argument is something else. */
function rowObjects(arg) {
    if (arg.startsWith('{')) return [arg];
    if (arg.startsWith('[') && matching(arg, 0) === arg.length - 1) return splitArgs(arg.slice(1, -1)).map((p) => (p.startsWith('{') ? p : null));
    return null;
}

const COL_REF = /\bcol\s*:\s*(["'])([^"'\\]*)\1/g;

/**
 * Finds every vibe.db.from('table') call with what can be read statically about it.
 * Returns { calls: [{ table, reads:[col], writes:[col], rows:[{keys,spread}], ops:[name] }], nonLiteral, used }
 */
export function scanDbUse(files) {
    const calls = [];
    let nonLiteral = false;
    let used = false;
    for (const [p, c] of Object.entries(files)) {
        if (!TEXT_FILE.test(p) || isSdk(p)) continue;
        if (/\bvibe\.db\b/.test(c)) used = true;
        for (const m of c.matchAll(/\bvibe\.db\s*\.\s*from\s*\(/g)) {
            const open = m.index + m[0].length - 1;
            const close = matching(c, open);
            const argText = close < 0 ? '' : c.slice(open + 1, close).trim();
            const lit = /^(["'])([^"'\\$`]*)\1$/.exec(argText);
            if (!lit) { nonLiteral = true; continue; }
            const call = { table: lit[2], reads: [], writes: [], rows: [], ops: [] };
            let i = close + 1;
            for (;;) {
                const next = /^\s*\.\s*([A-Za-z_]\w*)\s*\(/.exec(c.slice(i, i + 80));
                if (!next) break;
                const o = i + next[0].length - 1;
                const e = matching(c, o);
                if (e < 0) break;
                const args = splitArgs(c.slice(o + 1, e));
                const op = next[1];
                call.ops.push(op);
                const refs = (text) => { for (const r of (text || '').matchAll(COL_REF)) call.reads.push(r[2]); };
                if (op === 'select' || op === 'delete') refs(args[0]);
                else if (op === 'insert' && args[0]) {
                    for (const row of rowObjects(args[0]) || []) {
                        if (!row) continue; // not an object literal: nothing can be checked
                        const k = objectKeys(row);
                        call.writes.push(...k.keys);
                        call.rows.push(k);
                    }
                } else if (op === 'update') {
                    if (args[0]?.startsWith('{')) call.writes.push(...objectKeys(args[0]).keys);
                    refs(args[1]);
                }
                i = e + 1;
            }
            calls.push(call);
        }
    }
    return { calls, nonLiteral, used };
}

const list = (a) => a.map((x) => `"${x}"`).join(', ');

/**
 * Problems the fix pass can act on, for a project where the platform SDK is enabled.
 * Empty when the app neither uses vibe.db / vibe.storage nor carries a schema file.
 */
export function schemaProblems(files) {
    const paths = Object.keys(files).filter((p) => p.split('/').pop() === SCHEMA_FILE);
    const scan = scanDbUse(files);
    const code = Object.entries(files).filter(([p]) => TEXT_FILE.test(p) && !isSdk(p)).map(([, c]) => c);
    const uses = (re) => code.some((c) => re.test(c));
    const storage = uses(/\bvibe\.storage\b/);
    const problems = [];
    if (!paths.length && !scan.used && !storage) return problems;
    for (const p of paths) if (p !== SCHEMA_FILE) problems.push(`${SCHEMA_FILE} must be at the project root, not at ${p.slice(0, 60)}`);
    if ((scan.used || storage) && !uses(/\bvibe\.auth\b/)) {
        problems.push('the app uses vibe.db or vibe.storage, which only work for a signed-in user, but never uses vibe.auth: add a sign-in form (vibe.auth.signIn(email)) and only load or save data once vibe.auth.user() returns a user');
    }
    const text = files[SCHEMA_FILE];
    let spec = null;
    if (typeof text === 'string') {
        const parsed = parseSchemaFile(text);
        if (parsed.ok) spec = parsed.spec; else problems.push(...parsed.problems);
    }
    if (!scan.used) {
        if (paths.length) problems.push(`${SCHEMA_FILE} is present but the app never calls vibe.db: remove the file (a purely local app should keep its data in localStorage), or use the tables with vibe.db.from("name")`);
        return problems;
    }
    if (scan.nonLiteral) problems.push('the argument of vibe.db.from must be a string literal table name, for example vibe.db.from("todos")');
    if (typeof text !== 'string') {
        problems.push(`the app uses vibe.db but has no ${SCHEMA_FILE} at the project root: add it, declaring every table the app uses`);
        return problems;
    }
    if (!spec) return problems; // the schema is invalid: fix that first, name checks would only add noise
    const declared = Object.keys(spec.tables);
    const usedTables = new Set();
    const reported = new Set();
    const once = (msg) => { if (!reported.has(msg)) { reported.add(msg); problems.push(msg); } };
    for (const call of scan.calls) {
        const t = spec.tables[call.table];
        if (!t) { once(`vibe.db.from("${safe(call.table)}") uses a table that is not declared in ${SCHEMA_FILE} (declared: ${declared.length ? list(declared) : 'none'})`); continue; }
        usedTables.add(call.table);
        const cols = Object.keys(t.columns);
        if (t.access === 'private') once(`table "${call.table}" has access "private", which gives the browser no access, but the app uses it with vibe.db: use access "owner" or remove the use`);
        for (const col of new Set(call.reads)) if (!cols.includes(col) && !IMPLICIT.includes(col)) once(`vibe.db on table "${call.table}" filters or orders by column "${safe(col)}", which is not declared in ${SCHEMA_FILE} (columns: ${list(cols)})`);
        for (const col of new Set(call.writes)) {
            if (IMPLICIT.includes(col)) once(`vibe.db on table "${call.table}" writes "${col}": id, user_id and created_at are set by the platform, never send them`);
            else if (!cols.includes(col)) once(`vibe.db on table "${call.table}" writes column "${safe(col)}", which is not declared in ${SCHEMA_FILE} (columns: ${list(cols)})`);
        }
        for (const row of call.rows) {
            if (row.spread) continue;
            for (const [col, d] of Object.entries(t.columns)) if (d.required && d.default === undefined && !row.keys.includes(col)) once(`vibe.db insert into table "${call.table}" does not set required column "${col}" (give the column a default in ${SCHEMA_FILE} or always send it)`);
        }
    }
    if (!scan.nonLiteral) for (const t of declared) if (!usedTables.has(t)) problems.push(`${SCHEMA_FILE} declares table "${t}" but the app never uses it with vibe.db.from("${t}"): use it, or remove it from the schema (declare only what the app uses)`);
    return problems;
}

/** The validated, normalised schema file text for a project, or null when there is nothing valid at the root. */
export function normalisedSchema(files) {
    const r = parseSchemaFile(files?.[SCHEMA_FILE]);
    return r.ok ? `${JSON.stringify(r.spec, null, 2)}\n` : null;
}
