// Pure SQL query builder for the app data API. No database access: it turns a validated app spec plus a
// browser request into parameterized SQL text and a values array. Every identifier comes from the spec
// (never from the client) and is emitted double-quoted and schema-qualified; every client value is a bound
// parameter. Refusals carry a static snake_case code and never echo client input.

const NAME_RE = /^[a-z][a-z0-9_]{0,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

const ACCESS = ['owner', 'public_read', 'authenticated', 'private'];
const TYPES = ['text', 'integer', 'number', 'boolean', 'timestamp', 'json'];
const IMPLICIT = { id: 'uuid', user_id: 'uuid', created_at: 'timestamp' };
const RESERVED = ['id', 'user_id', 'created_at'];
const WHERE_OPS = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'like', 'ilike', 'in', 'is_null'];
const SQL_OP = { eq: '=', neq: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=', like: 'LIKE', ilike: 'ILIKE' };
const ORDERABLE = ['text', 'integer', 'number', 'boolean', 'timestamp', 'uuid'];
const RANGE_TYPES = ['text', 'integer', 'number', 'timestamp'];

const MAX_BODY = 100 * 1024;
const MAX_TEXT = 10000;
const MAX_JSON = 20000;
const MAX_LIKE = 200;
const MAX_IN = 50;
const MAX_WHERE = 10;
const MAX_ROWS = 50;
const MAX_ORDER = 5;
const MAX_COLUMNS = 100;
const MAX_JSON_DEPTH = 20;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_OFFSET = 100000;

class Refuse extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const refuse = (status, code) => { throw new Refuse(status, code); };

const has = (o, k) => Object.hasOwn(o, k);
const isPlain = (v) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};

const quote = (name) => '"' + String(name).replace(/"/g, '""') + '"';

function quoteSchema(schemaName) {
  if (typeof schemaName !== 'string' || schemaName.length === 0 || schemaName.length > 63 || schemaName.includes('\0')) {
    refuse(400, 'bad_schema');
  }
  return quote(schemaName);
}

function onlyKeys(obj, allowed) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) refuse(400, 'unknown_key');
}

// Validate one table of the spec and return a normalized description. The spec was validated upstream; this is defensive.
function describeTable(spec, table) {
  if (!isPlain(spec) || spec.version !== 1 || !isPlain(spec.tables)) refuse(400, 'bad_spec');
  if (typeof table !== 'string' || !NAME_RE.test(table) || !has(spec.tables, table)) refuse(400, 'unknown_table');
  const t = spec.tables[table];
  if (!isPlain(t) || !ACCESS.includes(t.access) || !isPlain(t.columns)) refuse(400, 'bad_spec');
  const cols = new Map();
  for (const name of Object.keys(t.columns)) {
    const c = t.columns[name];
    if (!NAME_RE.test(name) || RESERVED.includes(name) || !isPlain(c) || !TYPES.includes(c.type)) refuse(400, 'bad_spec');
    cols.set(name, { type: c.type, required: has(c, 'required') && c.required === true, default: has(c, 'default') ? c.default : undefined });
  }
  return { name: table, access: t.access, cols };
}

// Type of any readable column (spec columns plus the implicit ones), or refuse.
function colType(tbl, name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) refuse(400, 'unknown_column');
  if (has(IMPLICIT, name)) return IMPLICIT[name];
  if (!tbl.cols.has(name)) refuse(400, 'unknown_column');
  return tbl.cols.get(name).type;
}

function checkString(v, max) {
  if (typeof v !== 'string') refuse(400, 'bad_value');
  if (v.length > max) refuse(400, 'value_too_long');
  if (v.includes('\0')) refuse(400, 'bad_value');
  if (typeof v.isWellFormed === 'function' && !v.isWellFormed()) refuse(400, 'bad_value');
  return v;
}

function checkJson(v, depth) {
  if (v === null || typeof v === 'boolean') return;
  if (typeof v === 'number') { if (!Number.isFinite(v)) refuse(400, 'bad_value'); return; }
  if (typeof v === 'string') { checkString(v, MAX_JSON); return; }
  if (depth >= MAX_JSON_DEPTH) refuse(400, 'bad_value');
  if (Array.isArray(v)) { for (const x of v) checkJson(x, depth + 1); return; }
  if (isPlain(v)) {
    for (const k of Object.keys(v)) { checkString(k, MAX_JSON); checkJson(v[k], depth + 1); }
    return;
  }
  refuse(400, 'bad_value');
}

function coerceTimestamp(v) {
  if (typeof v !== 'string' || v.length > 40) refuse(400, 'bad_value');
  const m = ISO_RE.exec(v);
  if (!m) refuse(400, 'bad_value');
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6]].map((x) => (x === undefined ? 0 : Number(x)));
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) refuse(400, 'bad_value');
  // Day 0 of the following month is the last day of this one; the year only matters for leap years.
  if (d > new Date(Date.UTC(2000 + (y % 400), mo, 0)).getUTCDate()) refuse(400, 'bad_value');
  const zone = m[7];
  if (zone && zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) refuse(400, 'bad_value');
  // Date-only and zone-less values are taken as UTC.
  const iso = m[4] === undefined ? v + 'T00:00:00Z' : zone ? v : v + 'Z';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) refuse(400, 'bad_value');
  const out = new Date(t);
  const yr = out.getUTCFullYear();
  if (yr < 1 || yr > 9999) refuse(400, 'bad_value');
  return out.toISOString();
}

// Validate and coerce one non-null client value for a column type. Returns the value to bind.
function coerce(type, v) {
  switch (type) {
    case 'text':
      return checkString(v, MAX_TEXT);
    case 'integer':
      if (typeof v !== 'number' || !Number.isSafeInteger(v)) refuse(400, 'bad_value');
      return v;
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) refuse(400, 'bad_value');
      return v;
    case 'boolean':
      if (typeof v !== 'boolean') refuse(400, 'bad_value');
      return v;
    case 'timestamp':
      return coerceTimestamp(v);
    case 'json': {
      checkJson(v, 0);
      const text = JSON.stringify(v);
      if (text.length > MAX_JSON) refuse(400, 'bad_value');
      return text;
    }
    case 'uuid':
      if (typeof v !== 'string' || !UUID_RE.test(v)) refuse(400, 'bad_value');
      return v.toLowerCase();
    default:
      return refuse(400, 'bad_spec');
  }
}

// Parameter collector: placeholders are numbered in emission order, so $1..$n are exactly values[0..n-1].
function params() {
  const values = [];
  return { values, add(v) { values.push(v); return '$' + values.length; } };
}

function buildWhere(tbl, where, p, required) {
  if (where === undefined) { if (required) refuse(400, 'where_required'); return []; }
  if (!Array.isArray(where)) refuse(400, 'bad_where');
  if (required && where.length === 0) refuse(400, 'where_required');
  if (where.length > MAX_WHERE) refuse(400, 'too_many_conditions');
  return where.map((c) => {
    if (!isPlain(c)) refuse(400, 'bad_where');
    onlyKeys(c, ['col', 'op', 'val']);
    if (!has(c, 'col') || !has(c, 'op')) refuse(400, 'bad_where');
    const type = colType(tbl, c.col);
    if (typeof c.op !== 'string' || !WHERE_OPS.includes(c.op)) refuse(400, 'bad_operator');
    const col = quote(c.col);
    if (c.op === 'is_null') {
      const want = has(c, 'val') ? c.val : true;
      if (typeof want !== 'boolean') refuse(400, 'bad_value');
      return col + (want ? ' IS NULL' : ' IS NOT NULL');
    }
    if (type === 'json') refuse(400, 'bad_operator');
    if (!has(c, 'val')) refuse(400, 'bad_value');
    if (c.op === 'in') {
      if (!Array.isArray(c.val)) refuse(400, 'bad_value');
      if (c.val.length < 1 || c.val.length > MAX_IN) refuse(400, 'too_many_values');
      return col + ' IN (' + c.val.map((x) => p.add(coerce(type, x))).join(', ') + ')';
    }
    if (c.op === 'like' || c.op === 'ilike') {
      if (type !== 'text') refuse(400, 'bad_operator');
      return col + ' ' + SQL_OP[c.op] + ' ' + p.add(checkString(c.val, MAX_LIKE));
    }
    if (c.op !== 'eq' && c.op !== 'neq' && !RANGE_TYPES.includes(type)) refuse(400, 'bad_operator');
    return col + ' ' + SQL_OP[c.op] + ' ' + p.add(coerce(type, c.val));
  });
}

function allColumnList(tbl) {
  return ['id', 'user_id', 'created_at', ...tbl.cols.keys()].map(quote).join(', ');
}

// Access gate. Returns whether the statement must be scoped to the caller's own rows.
function authorize(tbl, kind, userId) {
  if (userId !== undefined && userId !== null && (typeof userId !== 'string' || !UUID_RE.test(userId))) refuse(401, 'unauthenticated');
  const signedIn = typeof userId === 'string';
  switch (tbl.access) {
    case 'private':
      return refuse(403, 'forbidden');
    case 'owner':
      if (!signedIn) refuse(401, 'unauthenticated');
      return true;
    case 'public_read':
      if (kind === 'select') return false;
      if (!signedIn) refuse(401, 'unauthenticated');
      return true;
    default: // authenticated (describeTable guarantees one of the four modes)
      if (!signedIn) refuse(401, 'unauthenticated');
      return kind !== 'select' && kind !== 'insert';
  }
}

function whereClause(conds, scoped, p, userId) {
  const all = conds.slice();
  if (scoped) all.push('"user_id" = ' + p.add(userId.toLowerCase()));
  return all.length ? ' WHERE ' + all.join(' AND ') : '';
}

const KEYS = {
  select: ['op', 'table', 'columns', 'where', 'order', 'limit', 'offset'],
  insert: ['op', 'table', 'rows'],
  update: ['op', 'table', 'where', 'set'],
  delete: ['op', 'table', 'where'],
};

function intInRange(v, def, min, max, code) {
  if (v === undefined) return def;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) refuse(400, code);
  return v;
}

function buildSelect(tbl, req, target, scoped, userId) {
  const p = params();
  let cols = allColumnList(tbl);
  if (has(req, 'columns')) {
    if (!Array.isArray(req.columns) || req.columns.length < 1 || req.columns.length > MAX_COLUMNS) refuse(400, 'bad_columns');
    for (const c of req.columns) colType(tbl, c);
    if (new Set(req.columns).size !== req.columns.length) refuse(400, 'bad_columns');
    cols = req.columns.map(quote).join(', ');
  }
  const conds = buildWhere(tbl, has(req, 'where') ? req.where : undefined, p, false);
  let order = '';
  if (has(req, 'order')) {
    if (!Array.isArray(req.order) || req.order.length > MAX_ORDER) refuse(400, 'bad_order');
    const parts = req.order.map((o) => {
      if (!isPlain(o)) refuse(400, 'bad_order');
      onlyKeys(o, ['col', 'dir']);
      if (!has(o, 'col')) refuse(400, 'bad_order');
      if (!ORDERABLE.includes(colType(tbl, o.col))) refuse(400, 'bad_order');
      const dir = has(o, 'dir') ? o.dir : 'asc';
      if (dir !== 'asc' && dir !== 'desc') refuse(400, 'bad_order');
      return quote(o.col) + (dir === 'desc' ? ' DESC' : ' ASC');
    });
    if (parts.length) order = ' ORDER BY ' + parts.join(', ');
  }
  const limit = intInRange(has(req, 'limit') ? req.limit : undefined, DEFAULT_LIMIT, 1, MAX_LIMIT, 'bad_limit');
  const offset = intInRange(has(req, 'offset') ? req.offset : undefined, 0, 0, MAX_OFFSET, 'bad_offset');
  const where = whereClause(conds, scoped, p, userId);
  const text = 'SELECT ' + cols + ' FROM ' + target + where + order + ' LIMIT ' + p.add(limit) + ' OFFSET ' + p.add(offset);
  return { text, values: p.values };
}

function buildInsert(tbl, req, target, userId) {
  if (!has(req, 'rows') || !Array.isArray(req.rows) || req.rows.length < 1) refuse(400, 'bad_rows');
  if (req.rows.length > MAX_ROWS) refuse(400, 'too_many_rows');
  const p = params();
  const names = [...tbl.cols.keys()];
  const tuples = req.rows.map((row) => {
    if (!isPlain(row)) refuse(400, 'bad_rows');
    for (const k of Object.keys(row)) {
      if (RESERVED.includes(k)) refuse(400, 'reserved_column');
      if (!tbl.cols.has(k)) refuse(400, 'unknown_column');
    }
    const cells = names.map((n) => {
      const c = tbl.cols.get(n);
      let v;
      if (has(row, n)) v = row[n];
      else if (c.default !== undefined) v = c.default;
      else if (c.required) return refuse(400, 'missing_required');
      else v = null;
      if (v === null) { if (c.required) refuse(400, 'null_not_allowed'); return 'NULL'; }
      return p.add(coerce(c.type, v));
    });
    cells.push(p.add(userId.toLowerCase()));
    return '(' + cells.join(', ') + ')';
  });
  const colList = names.concat('user_id').map(quote).join(', ');
  return { text: 'INSERT INTO ' + target + ' (' + colList + ') VALUES ' + tuples.join(', ') + ' RETURNING ' + allColumnList(tbl), values: p.values };
}

function buildUpdate(tbl, req, target, scoped, userId) {
  if (!has(req, 'set') || !isPlain(req.set)) refuse(400, 'bad_set');
  const keys = Object.keys(req.set);
  if (keys.length < 1) refuse(400, 'empty_set');
  const p = params();
  const sets = keys.map((k) => {
    if (RESERVED.includes(k)) refuse(400, 'reserved_column');
    if (!tbl.cols.has(k)) refuse(400, 'unknown_column');
    const c = tbl.cols.get(k);
    const v = req.set[k];
    if (v === null) { if (c.required) refuse(400, 'null_not_allowed'); return quote(k) + ' = NULL'; }
    return quote(k) + ' = ' + p.add(coerce(c.type, v));
  });
  const conds = buildWhere(tbl, has(req, 'where') ? req.where : undefined, p, true);
  return { text: 'UPDATE ' + target + ' SET ' + sets.join(', ') + whereClause(conds, scoped, p, userId) + ' RETURNING ' + allColumnList(tbl), values: p.values };
}

function buildDelete(tbl, req, target, scoped, userId) {
  const p = params();
  const conds = buildWhere(tbl, has(req, 'where') ? req.where : undefined, p, true);
  return { text: 'DELETE FROM ' + target + whereClause(conds, scoped, p, userId) + ' RETURNING "id"', values: p.values };
}

export function buildQuery({ spec, schemaName, request, userId } = {}) {
  try {
    if (!isPlain(request)) refuse(400, 'invalid_request');
    let size;
    try { size = JSON.stringify(request).length; } catch { return refuse(400, 'invalid_request'); }
    if (size > MAX_BODY) refuse(413, 'request_too_large');
    if (!has(request, 'op') || typeof request.op !== 'string' || !has(KEYS, request.op)) refuse(400, 'unknown_op');
    const kind = request.op;
    onlyKeys(request, KEYS[kind]);
    if (!has(request, 'table')) refuse(400, 'unknown_table');
    const tbl = describeTable(spec, request.table);
    const schema = quoteSchema(schemaName);
    const scoped = authorize(tbl, kind, userId);
    const target = schema + '.' + quote(tbl.name);
    let r;
    if (kind === 'select') r = buildSelect(tbl, request, target, scoped, userId);
    else if (kind === 'insert') r = buildInsert(tbl, request, target, userId);
    else if (kind === 'update') r = buildUpdate(tbl, request, target, scoped, userId);
    else r = buildDelete(tbl, request, target, scoped, userId);
    return { ok: true, kind, text: r.text, values: r.values };
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, status: e.status, code: e.code };
    throw e;
  }
}
