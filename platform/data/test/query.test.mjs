import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery } from '../query.js';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const SCHEMA = 'app_abc123';

const SPEC = {
  version: 1,
  tables: {
    todos: {
      access: 'owner',
      columns: {
        title: { type: 'text', required: true },
        done: { type: 'boolean', default: false },
        priority: { type: 'integer' },
        score: { type: 'number' },
        due: { type: 'timestamp' },
        meta: { type: 'json' },
        note: { type: 'text', default: 'none' },
      },
    },
    posts: { access: 'public_read', columns: { body: { type: 'text', required: true }, likes: { type: 'integer' } } },
    notes: { access: 'authenticated', columns: { text: { type: 'text', required: true } } },
    secrets: { access: 'private', columns: { value: { type: 'text' } } },
    empty: { access: 'owner', columns: {} },
  },
};

const run = (request, userId, spec = SPEC) => buildQuery({ spec, schemaName: SCHEMA, request, userId });
const good = (request, userId) => {
  const r = run(request, userId);
  assert.equal(r.ok, true, 'expected ok, got ' + JSON.stringify(r));
  return r;
};
const bad = (request, status, code, userId) => {
  const r = run(request, userId);
  assert.deepEqual(r, { ok: false, status, code });
  return r;
};

const S = '"app_abc123"';

// ---------- exact output ----------

test('select defaults: all columns, limit 50, offset 0, owner scoping', () => {
  const r = good({ op: 'select', table: 'todos' }, U1);
  assert.equal(r.kind, 'select');
  assert.equal(
    r.text,
    `SELECT "id", "user_id", "created_at", "title", "done", "priority", "score", "due", "meta", "note" FROM ${S}."todos" WHERE "user_id" = $1 LIMIT $2 OFFSET $3`,
  );
  assert.deepEqual(r.values, [U1, 50, 0]);
});

test('select with columns, where, order, limit, offset', () => {
  const r = good({
    op: 'select', table: 'todos', columns: ['title', 'id'],
    where: [{ col: 'done', op: 'eq', val: true }, { col: 'priority', op: 'gte', val: 3 }],
    order: [{ col: 'priority', dir: 'desc' }, { col: 'title' }],
    limit: 10, offset: 20,
  }, U1);
  assert.equal(
    r.text,
    `SELECT "title", "id" FROM ${S}."todos" WHERE "done" = $1 AND "priority" >= $2 AND "user_id" = $3 ORDER BY "priority" DESC, "title" ASC LIMIT $4 OFFSET $5`,
  );
  assert.deepEqual(r.values, [true, 3, U1, 10, 20]);
});

test('every where operator renders the right SQL', () => {
  const cases = [
    [{ col: 'priority', op: 'eq', val: 1 }, '"priority" = $1', [1]],
    [{ col: 'priority', op: 'neq', val: 1 }, '"priority" <> $1', [1]],
    [{ col: 'priority', op: 'lt', val: 1 }, '"priority" < $1', [1]],
    [{ col: 'priority', op: 'lte', val: 1 }, '"priority" <= $1', [1]],
    [{ col: 'priority', op: 'gt', val: 1 }, '"priority" > $1', [1]],
    [{ col: 'priority', op: 'gte', val: 1 }, '"priority" >= $1', [1]],
    [{ col: 'title', op: 'like', val: 'a%' }, '"title" LIKE $1', ['a%']],
    [{ col: 'title', op: 'ilike', val: 'a%' }, '"title" ILIKE $1', ['a%']],
    [{ col: 'priority', op: 'in', val: [1, 2, 3] }, '"priority" IN ($1, $2, $3)', [1, 2, 3]],
    [{ col: 'priority', op: 'is_null', val: true }, '"priority" IS NULL', []],
    [{ col: 'priority', op: 'is_null', val: false }, '"priority" IS NOT NULL', []],
    [{ col: 'priority', op: 'is_null' }, '"priority" IS NULL', []],
  ];
  for (const [cond, frag, vals] of cases) {
    const r = good({ op: 'select', table: 'posts', where: [{ ...cond, col: cond.col === 'priority' ? 'likes' : cond.col === 'title' ? 'body' : cond.col }] }, undefined);
    const f = frag.replace('"priority"', '"likes"').replace('"title"', '"body"');
    assert.ok(r.text.includes(` WHERE ${f} LIMIT `), r.text + ' vs ' + f);
    assert.deepEqual(r.values.slice(0, vals.length), vals);
    assert.equal(r.values.length, vals.length + 2);
  }
});

test('insert fills defaults, NULLs, and sets user_id from the session', () => {
  const r = good({ op: 'insert', table: 'todos', rows: [{ title: 'a', priority: 2 }] }, U1);
  assert.equal(r.kind, 'insert');
  assert.equal(
    r.text,
    `INSERT INTO ${S}."todos" ("title", "done", "priority", "score", "due", "meta", "note", "user_id") VALUES ($1, $2, $3, NULL, NULL, NULL, $4, $5) RETURNING "id", "user_id", "created_at", "title", "done", "priority", "score", "due", "meta", "note"`,
  );
  assert.deepEqual(r.values, ['a', false, 2, 'none', U1]);
});

test('insert multiple rows numbers placeholders across rows and uses explicit null', () => {
  const r = good({ op: 'insert', table: 'posts', rows: [{ body: 'x', likes: null }, { body: 'y', likes: 5 }] }, U1);
  assert.equal(
    r.text,
    `INSERT INTO ${S}."posts" ("body", "likes", "user_id") VALUES ($1, NULL, $2), ($3, $4, $5) RETURNING "id", "user_id", "created_at", "body", "likes"`,
  );
  assert.deepEqual(r.values, ['x', U1, 'y', 5, U1]);
});

test('insert into a table with no spec columns only sets user_id', () => {
  const r = good({ op: 'insert', table: 'empty', rows: [{}] }, U1);
  assert.equal(r.text, `INSERT INTO ${S}."empty" ("user_id") VALUES ($1) RETURNING "id", "user_id", "created_at"`);
});

test('update renders SET, WHERE, ownership and RETURNING; null sets NULL', () => {
  const r = good({ op: 'update', table: 'todos', set: { title: 'n', priority: null, done: true }, where: [{ col: 'id', op: 'eq', val: 'AAAAAAAA-1111-4111-8111-111111111111' }] }, U1);
  assert.equal(r.kind, 'update');
  assert.equal(
    r.text,
    `UPDATE ${S}."todos" SET "title" = $1, "priority" = NULL, "done" = $2 WHERE "id" = $3 AND "user_id" = $4 RETURNING "id", "user_id", "created_at", "title", "done", "priority", "score", "due", "meta", "note"`,
  );
  assert.deepEqual(r.values, ['n', true, 'aaaaaaaa-1111-4111-8111-111111111111', U1]);
});

test('delete renders WHERE, ownership and RETURNING id', () => {
  const r = good({ op: 'delete', table: 'todos', where: [{ col: 'priority', op: 'lt', val: 2 }] }, U1);
  assert.equal(r.kind, 'delete');
  assert.equal(r.text, `DELETE FROM ${S}."todos" WHERE "priority" < $1 AND "user_id" = $2 RETURNING "id"`);
  assert.deepEqual(r.values, [2, U1]);
});

test('user id is lower-cased before binding', () => {
  const r = good({ op: 'select', table: 'todos' }, U1.replace(/1/g, 'A').replace(/8/g, 'B'));
  assert.equal(r.values[0], U1.replace(/1/g, 'a').replace(/8/g, 'b'));
});

// ---------- access matrix ----------

const OPS = {
  select: (t) => ({ op: 'select', table: t }),
  insert: (t) => ({ op: 'insert', table: t, rows: [{ [t === 'todos' ? 'title' : t === 'posts' ? 'body' : 'text']: 'x' }] }),
  update: (t) => ({ op: 'update', table: t, set: { [t === 'todos' ? 'title' : t === 'posts' ? 'body' : 'text']: 'y' }, where: [{ col: 'id', op: 'eq', val: U2 }] }),
  delete: (t) => ({ op: 'delete', table: t, where: [{ col: 'id', op: 'eq', val: U2 }] }),
};

test('access matrix: anonymous and signed in, every op, every mode', () => {
  // table -> op -> [anonymous result, signedIn result]; 'own' = ok scoped to user, 'all' = ok unscoped
  const expect = {
    todos: { select: [401, 'own'], insert: [401, 'own'], update: [401, 'own'], delete: [401, 'own'] },
    posts: { select: ['all', 'all'], insert: [401, 'own'], update: [401, 'own'], delete: [401, 'own'] },
    notes: { select: [401, 'all'], insert: [401, 'own'], update: [401, 'own'], delete: [401, 'own'] },
    secrets: { select: [403, 403], insert: [403, 403], update: [403, 403], delete: [403, 403] },
  };
  for (const [table, ops] of Object.entries(expect)) {
    for (const [op, [anon, signed]] of Object.entries(ops)) {
      for (const [who, want, uid] of [['anon', anon, undefined], ['anon-null', anon, null], ['user', signed, U1]]) {
        const r = run(OPS[op](table), uid);
        const label = `${table}/${op}/${who}`;
        if (typeof want === 'number') {
          assert.deepEqual(r, { ok: false, status: want, code: want === 401 ? 'unauthenticated' : 'forbidden' }, label);
        } else {
          assert.equal(r.ok, true, label);
          const scoped = r.text.includes('"user_id" = $') || r.kind === 'insert';
          if (want === 'own') assert.equal(scoped, true, label);
          else assert.equal(scoped, false, label);
          if (want === 'own' && r.kind !== 'insert') assert.ok(r.values.includes(U1), label);
        }
      }
    }
  }
});

test('authenticated select by a signed-in user is not owner-scoped, but update/delete are', () => {
  assert.equal(good(OPS.select('notes'), U1).values.includes(U1), false);
  assert.equal(good(OPS.update('notes'), U1).values.includes(U1), true);
});

test('public_read select works anonymously and filters are still validated', () => {
  bad({ op: 'select', table: 'posts', where: [{ col: 'nope', op: 'eq', val: 1 }] }, 400, 'unknown_column');
});

test('malformed user ids are refused as unauthenticated', () => {
  for (const u of ['', 'x', 123, {}, [], true, U1 + 'x', "' OR 1=1 --", U1.replace(/-/g, '')]) {
    bad(OPS.select('todos'), 401, 'unauthenticated', u);
    bad(OPS.select('posts'), 401, 'unauthenticated', u);
  }
});

test('private is refused before any request validation', () => {
  bad({ op: 'select', table: 'secrets', where: 'garbage', limit: 'x' }, 403, 'forbidden', U1);
  bad({ op: 'select', table: 'secrets' }, 403, 'forbidden', undefined);
});

test('access is checked before request details (anonymous learns nothing about columns)', () => {
  bad({ op: 'select', table: 'todos', columns: ['nope'] }, 401, 'unauthenticated', undefined);
  bad({ op: 'insert', table: 'posts', rows: 'x' }, 401, 'unauthenticated', undefined);
});

// ---------- cross-user ----------

test('client cannot write id, user_id or created_at via rows or set', () => {
  for (const k of ['id', 'user_id', 'created_at']) {
    bad({ op: 'insert', table: 'todos', rows: [{ title: 'a', [k]: U2 }] }, 400, 'reserved_column', U1);
    bad({ op: 'update', table: 'todos', set: { [k]: U2 }, where: [{ col: 'id', op: 'eq', val: U2 }] }, 400, 'reserved_column', U1);
  }
});

test('user_id in where can only narrow, never widen: ownership predicate is always added', () => {
  const r = good({ op: 'select', table: 'todos', where: [{ col: 'user_id', op: 'eq', val: U2 }] }, U1);
  assert.equal(r.text.includes('"user_id" = $1 AND "user_id" = $2'), true);
  assert.deepEqual(r.values.slice(0, 2), [U2, U1]);
  const d = good({ op: 'delete', table: 'notes', where: [{ col: 'user_id', op: 'in', val: [U2] }] }, U1);
  assert.equal(d.text.endsWith('AND "user_id" = $2 RETURNING "id"'), true);
  assert.deepEqual(d.values, [U2, U1]);
});

test('request cannot smuggle a userId or schema through extra keys', () => {
  bad({ op: 'select', table: 'todos', userId: U2 }, 400, 'unknown_key', U1);
  bad({ op: 'select', table: 'todos', user_id: U2 }, 400, 'unknown_key', U1);
  bad({ op: 'select', table: 'todos', schema: 'other' }, 400, 'unknown_key', U1);
  bad({ op: 'select', table: 'todos', schemaName: 'other' }, 400, 'unknown_key', U1);
  bad({ op: 'select', table: 'todos', or: [] }, 400, 'unknown_key', U1);
});

test('where is AND-only: a condition object cannot carry nested or/and', () => {
  bad({ op: 'select', table: 'todos', where: [{ or: [{ col: 'title', op: 'eq', val: 'a' }] }] }, 400, 'unknown_key', U1);
  bad({ op: 'select', table: 'todos', where: [{ col: 'title', op: 'eq', val: 'a', or: 1 }] }, 400, 'unknown_key', U1);
  bad({ op: 'select', table: 'todos', where: [[{ col: 'title', op: 'eq', val: 'a' }]] }, 400, 'bad_where', U1);
});

// ---------- strictness ----------

test('request shape: non-objects, arrays, unknown ops and tables', () => {
  for (const r of [null, undefined, 1, 'select', [], [{ op: 'select' }], true]) bad(r, 400, 'invalid_request', U1);
  bad({ table: 'todos' }, 400, 'unknown_op', U1);
  bad({ op: 'drop', table: 'todos' }, 400, 'unknown_op', U1);
  bad({ op: 5, table: 'todos' }, 400, 'unknown_op', U1);
  bad({ op: 'SELECT', table: 'todos' }, 400, 'unknown_op', U1);
  bad({ op: 'select' }, 400, 'unknown_table', U1);
  bad({ op: 'select', table: 'nope' }, 400, 'unknown_table', U1);
  bad({ op: 'select', table: 5 }, 400, 'unknown_table', U1);
  bad({ op: 'select', table: ['todos'] }, 400, 'unknown_table', U1);
  bad({ op: 'select', table: 'Todos' }, 400, 'unknown_table', U1);
  bad({ op: 'select', table: 'todos ' }, 400, 'unknown_table', U1);
});

test('op-specific keys: keys valid for another op are rejected', () => {
  bad({ op: 'select', table: 'todos', rows: [] }, 400, 'unknown_key', U1);
  bad({ op: 'select', table: 'todos', set: {} }, 400, 'unknown_key', U1);
  bad({ op: 'insert', table: 'todos', rows: [{ title: 'a' }], where: [] }, 400, 'unknown_key', U1);
  bad({ op: 'insert', table: 'todos', rows: [{ title: 'a' }], limit: 1 }, 400, 'unknown_key', U1);
  bad({ op: 'update', table: 'todos', set: { title: 'a' }, where: [{ col: 'id', op: 'eq', val: U2 }], limit: 1 }, 400, 'unknown_key', U1);
  bad({ op: 'delete', table: 'todos', where: [{ col: 'id', op: 'eq', val: U2 }], set: {} }, 400, 'unknown_key', U1);
  bad({ op: 'delete', table: 'todos', where: [{ col: 'id', op: 'eq', val: U2 }], order: [] }, 400, 'unknown_key', U1);
  bad({ op: 'update', table: 'todos', set: { title: 'a' }, where: [{ col: 'id', op: 'eq', val: U2 }], columns: ['id'] }, 400, 'unknown_key', U1);
  bad({ op: 'select', table: 'todos', columns: ['id'], order: [], where: [], limit: 1, offset: 0, extra: 1 }, 400, 'unknown_key', U1);
});

test('where is required and non-empty for update and delete', () => {
  bad({ op: 'update', table: 'todos', set: { title: 'a' } }, 400, 'where_required', U1);
  bad({ op: 'update', table: 'todos', set: { title: 'a' }, where: [] }, 400, 'where_required', U1);
  bad({ op: 'delete', table: 'todos' }, 400, 'where_required', U1);
  bad({ op: 'delete', table: 'todos', where: [] }, 400, 'where_required', U1);
  bad({ op: 'delete', table: 'todos', where: {} }, 400, 'bad_where', U1);
  bad({ op: 'delete', table: 'todos', where: null }, 400, 'bad_where', U1);
});

test('select where may be omitted or empty, but must be an array otherwise', () => {
  good({ op: 'select', table: 'todos', where: [] }, U1);
  bad({ op: 'select', table: 'todos', where: 'x' }, 400, 'bad_where', U1);
  bad({ op: 'select', table: 'todos', where: null }, 400, 'bad_where', U1);
  bad({ op: 'select', table: 'todos', where: {} }, 400, 'bad_where', U1);
});

test('where condition shape and operators', () => {
  const w = (c) => ({ op: 'select', table: 'todos', where: [c] });
  bad(w(null), 400, 'bad_where', U1);
  bad(w('x'), 400, 'bad_where', U1);
  bad(w({ op: 'eq', val: 1 }), 400, 'bad_where', U1);
  bad(w({ col: 'title', val: 1 }), 400, 'bad_where', U1);
  bad(w({ col: 'title', op: 'eq' }), 400, 'bad_value', U1);
  bad(w({ col: 'title', op: 'contains', val: 'a' }), 400, 'bad_operator', U1);
  bad(w({ col: 'title', op: 'EQ', val: 'a' }), 400, 'bad_operator', U1);
  bad(w({ col: 'title', op: 5, val: 'a' }), 400, 'bad_operator', U1);
  bad(w({ col: 'title', op: '= 1 OR 1=1 --', val: 'a' }), 400, 'bad_operator', U1);
  bad(w({ col: 'title', op: 'eq', val: null }), 400, 'bad_value', U1);
  bad(w({ col: 'title', op: 'is_null', val: 'yes' }), 400, 'bad_value', U1);
  bad(w({ col: 'title', op: 'is_null', val: 1 }), 400, 'bad_value', U1);
});

test('operator and column type compatibility', () => {
  const w = (col, op, val) => ({ op: 'select', table: 'todos', where: [{ col, op, val }] });
  bad(w('done', 'lt', true), 400, 'bad_operator', U1);
  bad(w('done', 'like', 'x'), 400, 'bad_operator', U1);
  bad(w('priority', 'like', '1'), 400, 'bad_operator', U1);
  bad(w('priority', 'ilike', '1'), 400, 'bad_operator', U1);
  bad(w('due', 'like', '2024'), 400, 'bad_operator', U1);
  bad(w('id', 'like', 'a'), 400, 'bad_operator', U1);
  bad(w('id', 'gt', U2), 400, 'bad_operator', U1);
  bad(w('meta', 'eq', {}), 400, 'bad_operator', U1);
  bad(w('meta', 'in', [{}]), 400, 'bad_operator', U1);
  good(w('meta', 'is_null', true), U1);
  good(w('done', 'eq', true), U1);
  good(w('done', 'neq', false), U1);
  good(w('done', 'in', [true, false]), U1);
  good(w('title', 'lt', 'm'), U1);
  good(w('title', 'gte', 'm'), U1);
  good(w('score', 'gt', 1.5), U1);
  good(w('due', 'lte', '2024-05-01T00:00:00Z'), U1);
  good(w('created_at', 'gt', '2024-05-01'), U1);
  good(w('id', 'neq', U2), U1);
  good(w('id', 'in', [U2]), U1);
});

test('where limits: at most 10 conditions, in lists 1..50', () => {
  const c = { col: 'priority', op: 'eq', val: 1 };
  good({ op: 'select', table: 'todos', where: Array(10).fill(c) }, U1);
  bad({ op: 'select', table: 'todos', where: Array(11).fill(c) }, 400, 'too_many_conditions', U1);
  bad({ op: 'select', table: 'todos', where: Array(10000).fill(c) }, 413, 'request_too_large', U1);
  good({ op: 'select', table: 'todos', where: [{ col: 'priority', op: 'in', val: Array.from({ length: 50 }, (_, i) => i) }] }, U1);
  bad({ op: 'select', table: 'todos', where: [{ col: 'priority', op: 'in', val: Array.from({ length: 51 }, (_, i) => i) }] }, 400, 'too_many_values', U1);
  bad({ op: 'select', table: 'todos', where: [{ col: 'priority', op: 'in', val: [] }] }, 400, 'too_many_values', U1);
  bad({ op: 'select', table: 'todos', where: [{ col: 'priority', op: 'in', val: 5 }] }, 400, 'bad_value', U1);
  bad({ op: 'select', table: 'todos', where: [{ col: 'priority', op: 'in', val: [1, null] }] }, 400, 'bad_value', U1);
  bad({ op: 'select', table: 'todos', where: [{ col: 'priority', op: 'in', val: [1, '2'] }] }, 400, 'bad_value', U1);
});

test('select columns: validated, unique, non-empty, implicit columns allowed', () => {
  good({ op: 'select', table: 'todos', columns: ['id', 'user_id', 'created_at', 'title'] }, U1);
  bad({ op: 'select', table: 'todos', columns: [] }, 400, 'bad_columns', U1);
  bad({ op: 'select', table: 'todos', columns: 'title' }, 400, 'bad_columns', U1);
  bad({ op: 'select', table: 'todos', columns: null }, 400, 'bad_columns', U1);
  bad({ op: 'select', table: 'todos', columns: ['title', 'title'] }, 400, 'bad_columns', U1);
  bad({ op: 'select', table: 'todos', columns: ['*'] }, 400, 'unknown_column', U1);
  bad({ op: 'select', table: 'todos', columns: ['nope'] }, 400, 'unknown_column', U1);
  bad({ op: 'select', table: 'todos', columns: [1] }, 400, 'unknown_column', U1);
  bad({ op: 'select', table: 'todos', columns: [['title']] }, 400, 'unknown_column', U1);
  bad({ op: 'select', table: 'todos', columns: Array(101).fill('title') }, 400, 'bad_columns', U1);
});

test('order: validated, direction, count, sortable types, shape', () => {
  const o = (order) => ({ op: 'select', table: 'todos', order });
  good(o([]), U1);
  good(o([{ col: 'created_at', dir: 'desc' }]), U1);
  good(o([{ col: 'id' }]), U1);
  good(o(Array(5).fill({ col: 'title' })), U1);
  bad(o(Array(6).fill({ col: 'title' })), 400, 'bad_order', U1);
  bad(o('title'), 400, 'bad_order', U1);
  bad(o({}), 400, 'bad_order', U1);
  bad(o(['title']), 400, 'bad_order', U1);
  bad(o([null]), 400, 'bad_order', U1);
  bad(o([{ dir: 'asc' }]), 400, 'bad_order', U1);
  bad(o([{ col: 'title', dir: 'ASC' }]), 400, 'bad_order', U1);
  bad(o([{ col: 'title', dir: 'asc; DROP TABLE x' }]), 400, 'bad_order', U1);
  bad(o([{ col: 'title', dir: null }]), 400, 'bad_order', U1);
  bad(o([{ col: 'meta' }]), 400, 'bad_order', U1);
  bad(o([{ col: 'nope' }]), 400, 'unknown_column', U1);
  bad(o([{ col: 'title', nulls: 'first' }]), 400, 'unknown_key', U1);
});

test('limit and offset bounds', () => {
  const lo = (limit, offset) => ({ op: 'select', table: 'todos', limit, offset });
  assert.deepEqual(good(lo(1, 0), U1).values.slice(-2), [1, 0]);
  assert.deepEqual(good(lo(100, 100000), U1).values.slice(-2), [100, 100000]);
  assert.deepEqual(good(lo(undefined, 5), U1).values.slice(-2), [50, 5]);
  assert.deepEqual(good(lo(7, undefined), U1).values.slice(-2), [7, 0]);
  for (const l of [0, -1, 101, 1.5, '10', NaN, Infinity, null, [], 2 ** 53]) bad(lo(l), 400, 'bad_limit', U1);
  for (const o of [-1, 100001, 1.5, '0', NaN, Infinity, null, 2 ** 53]) bad(lo(1, o), 400, 'bad_offset', U1);
});

// ---------- insert ----------

test('insert rows: 1..50, plain objects, known columns, required enforced', () => {
  const ins = (rows) => ({ op: 'insert', table: 'todos', rows });
  good(ins(Array.from({ length: 50 }, () => ({ title: 'a' }))), U1);
  bad(ins(Array.from({ length: 51 }, () => ({ title: 'a' }))), 400, 'too_many_rows', U1);
  bad(ins([]), 400, 'bad_rows', U1);
  bad(ins({ title: 'a' }), 400, 'bad_rows', U1);
  bad(ins(null), 400, 'bad_rows', U1);
  bad({ op: 'insert', table: 'todos' }, 400, 'bad_rows', U1);
  bad(ins(['a']), 400, 'bad_rows', U1);
  bad(ins([null]), 400, 'bad_rows', U1);
  bad(ins([[]]), 400, 'bad_rows', U1);
  bad(ins([{}]), 400, 'missing_required', U1);
  bad(ins([{ title: 'a' }, {}]), 400, 'missing_required', U1);
  bad(ins([{ title: null }]), 400, 'null_not_allowed', U1);
  bad(ins([{ title: 'a', nope: 1 }]), 400, 'unknown_column', U1);
  bad(ins([{ title: 'a', done: 'yes' }]), 400, 'bad_value', U1);
});

test('defaults apply when a column is absent but not when it is explicitly set', () => {
  const r = good({ op: 'insert', table: 'todos', rows: [{ title: 'a', done: true, note: 'mine' }] }, U1);
  assert.deepEqual(r.values, ['a', true, 'mine', U1]);
});

test('a required column with a default does not need to be supplied, and may not be nulled', () => {
  const spec = { version: 1, tables: { t: { access: 'owner', columns: { a: { type: 'integer', required: true, default: 7 } } } } };
  const r = run({ op: 'insert', table: 't', rows: [{}] }, U1, spec);
  assert.equal(r.ok, true);
  assert.deepEqual(r.values, [7, U1]);
  assert.deepEqual(run({ op: 'insert', table: 't', rows: [{ a: null }] }, U1, spec), { ok: false, status: 400, code: 'null_not_allowed' });
  assert.deepEqual(run({ op: 'update', table: 't', set: { a: null }, where: [{ col: 'id', op: 'eq', val: U2 }] }, U1, spec), { ok: false, status: 400, code: 'null_not_allowed' });
});

test('update set validation', () => {
  const up = (set) => ({ op: 'update', table: 'todos', set, where: [{ col: 'id', op: 'eq', val: U2 }] });
  bad(up({}), 400, 'empty_set', U1);
  bad(up(null), 400, 'bad_set', U1);
  bad(up([]), 400, 'bad_set', U1);
  bad(up('title'), 400, 'bad_set', U1);
  bad({ op: 'update', table: 'todos', where: [{ col: 'id', op: 'eq', val: U2 }] }, 400, 'bad_set', U1);
  bad(up({ nope: 1 }), 400, 'unknown_column', U1);
  bad(up({ title: null }), 400, 'null_not_allowed', U1);
  bad(up({ title: 5 }), 400, 'bad_value', U1);
});

// ---------- value coercion ----------

const BAD = { ok: false, status: 400, code: 'bad_value' };
const cell = (type, v) => {
  const spec = { version: 1, tables: { t: { access: 'owner', columns: { c: { type } } } } };
  return run({ op: 'insert', table: 't', rows: [{ c: v }] }, U1, spec);
};

test('text values', () => {
  assert.equal(cell('text', 'a'.repeat(10000)).ok, true);
  assert.equal(cell('text', '').ok, true);
  assert.deepEqual(cell('text', 'a'.repeat(10001)), { ok: false, status: 400, code: 'value_too_long' });
  for (const v of [1, true, {}, [], 'a\0b', '\0', '\ud800', 'x\udc00y']) assert.deepEqual(cell('text', v), { ok: false, status: 400, code: 'bad_value' }, JSON.stringify(v));
  assert.equal(cell('text', 'emoji \u{1F600} and \u202e and \u0430bc').ok, true);
});

test('integer values', () => {
  for (const v of [0, -0, 1, -1, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) assert.equal(cell('integer', v).ok, true, String(v));
  for (const v of [1.5, NaN, Infinity, -Infinity, 2 ** 53, -(2 ** 53), '1', true, {}, [], 1e300]) assert.deepEqual(cell('integer', v), BAD, String(v));
  assert.deepEqual(cell('integer', '1'), { ok: false, status: 400, code: 'bad_value' });
});

test('number values', () => {
  for (const v of [0, 1.5, -1e300, 1e-300, Number.MAX_VALUE]) assert.equal(cell('number', v).ok, true, String(v));
  for (const v of [NaN, Infinity, -Infinity, '1.5', true, {}, []]) assert.deepEqual(cell('number', v), BAD, String(v));
});

test('boolean values are strict', () => {
  assert.deepEqual(cell('boolean', true).values, [true, U1]);
  assert.deepEqual(cell('boolean', false).values, [false, U1]);
  for (const v of [0, 1, 'true', 'false', 'yes', {}, []]) assert.deepEqual(cell('boolean', v), BAD, String(v));
});

test('timestamp values are ISO-8601, normalised to UTC', () => {
  const t = (v) => cell('timestamp', v);
  assert.equal(t('2024-05-01T10:20:30Z').values[0], '2024-05-01T10:20:30.000Z');
  assert.equal(t('2024-05-01T10:20:30.123Z').values[0], '2024-05-01T10:20:30.123Z');
  assert.equal(t('2024-05-01T10:20:30+02:00').values[0], '2024-05-01T08:20:30.000Z');
  assert.equal(t('2024-05-01T10:20:30-05:30').values[0], '2024-05-01T15:50:30.000Z');
  assert.equal(t('2024-05-01T10:20').values[0], '2024-05-01T10:20:00.000Z');
  assert.equal(t('2024-05-01T10:20:30').values[0], '2024-05-01T10:20:30.000Z');
  assert.equal(t('2024-05-01').values[0], '2024-05-01T00:00:00.000Z');
  assert.equal(t('2024-02-29').ok, true);
  assert.equal(t('2024-12-31T23:59:59Z').ok, true);
  assert.equal(t('2024-01-31').ok, true);
  assert.equal(t('2024-04-30').ok, true);
  assert.equal(t('2000-02-29').ok, true);
  assert.equal(t('2400-02-29').ok, true);
  assert.equal(t('0001-01-01T00:00:00Z').ok, true);
  assert.equal(t('9999-12-31T23:59:59Z').ok, true);
  assert.equal(t('2024-05-01T10:20:30.123456789Z').ok, true);
  for (const v of [
    '', 'now', 'tomorrow', '2024-5-1', '24-05-01', '2024-05-01 10:20:30', '2024-13-01', '2024-00-10', '2024-02-30', '2023-02-29', '1900-02-29', '2100-02-29',
    '2024-04-31', '2024-01-32', '2024-01-00', '2024-05-01T24:00:00Z', '2024-05-01T10:60:00Z', '2024-05-01T10:20:60Z', '2024-05-01T10:20:30+24:00',
    '2024-05-01T10:20:30+05:60', '2024-05-01T10:20:30+0530', '2024-05-01T10:20:30z', '0000-01-01T00:00:00Z', '10000-01-01', '+002024-05-01',
    '2024-05-01T10:20:30Z; DROP TABLE x', '2024-05-01\0', 1714558830000, true, {}, [], '2024-05-01T10:20:30.Z', '9999-12-31T23:59:59-23:59',
  ]) assert.deepEqual(t(v), BAD, JSON.stringify(v));
  assert.deepEqual(t('2024-05-01T' + '0'.repeat(50)), BAD);
});

test('json values: any JSON, size capped, depth capped, no exotic types', () => {
  const j = (v) => cell('json', v);
  assert.deepEqual(j({ a: [1, 'x', null, true] }).values[0], '{"a":[1,"x",null,true]}');
  assert.equal(j([]).values[0], '[]');
  assert.equal(j('str').values[0], '"str"');
  assert.equal(j(5).values[0], '5');
  assert.equal(j(true).values[0], 'true');
  assert.equal(j({ k: null }).values[0], '{"k":null}');
  assert.equal(j('a'.repeat(19998)).ok, true);
  assert.deepEqual(j('a'.repeat(19999)), BAD);
  assert.deepEqual(j('a'.repeat(20000)), BAD);
  assert.equal(j({ a: 'a'.repeat(19990) }).ok, true);
  assert.equal(j({ a: 'a'.repeat(19995) }).ok, false);
  const nest = (n) => { let v = 1; for (let i = 0; i < n; i++) v = [v]; return v; };
  assert.equal(j(nest(20)).ok, true);
  assert.deepEqual(j(nest(21)), BAD);
  const nestO = (n) => { let v = 1; for (let i = 0; i < n; i++) v = { a: v }; return v; };
  assert.equal(j(nestO(20)).ok, true);
  assert.deepEqual(j(nestO(21)), BAD);
  assert.deepEqual(j(nest(100000)), { ok: false, status: 413, code: 'request_too_large' });
  assert.equal(j(nest(40000)).ok, false);
  for (const v of [NaN, Infinity, { a: NaN }, [Infinity], { a: 'x\0' }, { 'k\0': 1 }, ['\ud800'], new Date(0), new Map(), () => 1, 10n, Symbol('s'), Object.create({ x: 1 })]) {
    let r;
    try { r = j(v); } catch (e) { r = { ok: false, threw: true }; }
    assert.deepEqual(r, typeof v === 'bigint' ? { ok: false, status: 400, code: 'invalid_request' } : BAD, String(typeof v));
    assert.equal(r.threw, undefined, 'must refuse, not throw: ' + String(typeof v));
  }
  assert.deepEqual(j({ k: undefined }), BAD);
  assert.equal(j(Object.create(null)).ok, true);
  // proto-named keys inside json data are plain data
  assert.equal(j(JSON.parse('{"__proto__": {"x": 1}}')).values[0], '{"__proto__":{"x":1}}');
});

test('like and ilike values are capped at 200 chars', () => {
  const w = (op, val) => ({ op: 'select', table: 'posts', where: [{ col: 'body', op, val }] });
  for (const op of ['like', 'ilike']) {
    assert.equal(run(w(op, 'a'.repeat(200))).ok, true);
    assert.deepEqual(run(w(op, 'a'.repeat(201))), { ok: false, status: 400, code: 'value_too_long' });
    assert.deepEqual(run(w(op, 5)), { ok: false, status: 400, code: 'bad_value' });
    assert.deepEqual(run(w(op, 'a\0')), { ok: false, status: 400, code: 'bad_value' });
  }
  assert.equal(run(w('eq', 'a'.repeat(201))).ok, true);
});

test('uuid values (id filter) are validated and normalised', () => {
  const w = (val) => ({ op: 'select', table: 'posts', where: [{ col: 'id', op: 'eq', val }] });
  assert.equal(run(w(U2.toUpperCase())).values[0], U2);
  for (const v of ['', 'abc', U2 + 'x', "x' OR 1=1", U2.replace(/-/g, ''), 1, null, '{' + U2 + '}', U2.slice(0, 35) + 'g']) assert.deepEqual(run(w(v)), BAD, String(v));
});

// ---------- injection and identifiers ----------

const EVIL = [
  "'; DROP TABLE todos; --", '" OR 1=1 --', "\\'; SELECT pg_sleep(10); --", '$1', '$$; DROP', '%', '_', '*', 'title" FROM x; --',
  '\u02baOR 1=1', '\uff02OR 1=1', '\u2019; DROP', '\u0430', 'Title', 'ti\u0307tle', 'title\0', 'title\n', ' title', 'title ', 'todos.title', '"title"', '`title`',
  '__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf', '__defineGetter__', 'title/**/', 'title--', 'title;',
];

test('SQL text and identifier injection strings in values never reach the SQL text', () => {
  assert.equal(run({ op: 'insert', table: 'todos', rows: [{ title: 'title\0' }] }, U1).ok, false);
  for (const evil of EVIL.filter((e) => !e.includes('\0'))) {
    const r = good({ op: 'insert', table: 'todos', rows: [{ title: evil }] }, U1);
    assert.equal(r.text, good({ op: "insert", table: "todos", rows: [{ title: "a" }] }, U1).text, "text must not depend on values");
    assert.equal(r.values[0], evil);
    const s = good({ op: 'select', table: 'todos', where: [{ col: 'title', op: 'eq', val: evil }, { col: 'title', op: 'in', val: [evil] }] }, U1);
    assert.equal(s.text, good({ op: "select", table: "todos", where: [{ col: "title", op: "eq", val: "a" }, { col: "title", op: "in", val: ["a"] }] }, U1).text);
  }
});

test('evil identifiers (table, column, order, set keys, select columns, where cols) are all refused', () => {
  for (const evil of EVIL) {
    const e = (c) => assert.equal(run(c, U1).ok, false, evil + ' ' + JSON.stringify(c).slice(0, 80));
    e({ op: 'select', table: evil });
    e({ op: 'select', table: 'todos', columns: [evil] });
    e({ op: 'select', table: 'todos', where: [{ col: evil, op: 'eq', val: 1 }] });
    e({ op: 'select', table: 'todos', order: [{ col: evil }] });
    e({ op: 'insert', table: 'todos', rows: [{ title: 'a', [evil]: 1 }] });
    e({ op: 'update', table: 'todos', set: { [evil]: 1 }, where: [{ col: 'id', op: 'eq', val: U2 }] });
    e({ op: 'delete', table: evil, where: [{ col: 'id', op: 'eq', val: U2 }] });
  }
});

test('prototype-pollution safety: inherited and dangerous names are never treated as columns or tables', () => {
  for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'prototype']) {
    bad({ op: 'select', table: k }, 400, 'unknown_table', U1);
    bad({ op: 'select', table: 'todos', columns: [k] }, 400, 'unknown_column', U1);
    bad({ op: 'select', table: 'todos', where: [{ col: k, op: 'eq', val: 1 }] }, 400, 'unknown_column', U1);
    bad({ op: 'insert', table: 'todos', rows: [JSON.parse(`{"title":"a","${k}":1}`)] }, 400, 'unknown_column', U1);
    bad({ op: 'update', table: 'todos', set: JSON.parse(`{"${k}":1}`), where: [{ col: 'id', op: 'eq', val: U2 }] }, 400, 'unknown_column', U1);
  }
  // JSON.parse creates an own __proto__ key, which is an unknown key at every level
  bad(JSON.parse('{"op":"select","table":"todos","__proto__":{"x":1}}'), 400, 'unknown_key', U1);
  bad(JSON.parse('{"op":"select","table":"todos","where":[{"col":"title","op":"eq","val":"a","__proto__":{}}]}'), 400, 'unknown_key', U1);
  bad(JSON.parse('{"op":"select","table":"todos","order":[{"col":"title","__proto__":{}}]}'), 400, 'unknown_key', U1);
  // polluted Object.prototype must not satisfy lookups
  Object.prototype.table = 'todos'; Object.prototype.where = []; Object.prototype.title = 'x'; Object.prototype.todos = { access: 'private', columns: {} };
  try {
    bad({ op: 'select' }, 400, 'unknown_table', U1);
    bad({ op: 'delete', table: 'todos' }, 400, 'where_required', U1);
    bad({ op: 'insert', table: 'todos', rows: [{}] }, 400, 'missing_required', U1);
    bad({ op: 'select', table: 'todos', where: [{ col: 'title', op: 'eq' }] }, 400, 'bad_value', U1);
    bad({ op: 'select', table: 'todos', order: [{}] }, 400, 'bad_order', U1);
    bad({ op: 'select', table: 'todos', where: [{ op: 'eq', val: 1 }] }, 400, 'bad_where', U1);
    const spec = { version: 1, tables: { t: { access: 'owner', columns: { a: { type: 'text' } } } } };
    assert.deepEqual(run({ op: 'select', table: 'todos' }, U1, spec), { ok: false, status: 400, code: 'unknown_table' });
    Object.prototype.default = 'polluted'; Object.prototype.required = true;
    const r = run({ op: 'insert', table: 't', rows: [{}] }, U1, spec);
    assert.equal(r.ok, true);
    assert.deepEqual(r.values, [U1]);
  } finally {
    delete Object.prototype.table; delete Object.prototype.where; delete Object.prototype.title; delete Object.prototype.todos;
    delete Object.prototype.default; delete Object.prototype.required;
  }
});

test('requests with null prototype are accepted; class instances are not', () => {
  const o = Object.assign(Object.create(null), { op: 'select', table: 'todos' });
  assert.equal(run(o, U1).ok, true);
  class R { constructor() { this.op = 'select'; this.table = 'todos'; } }
  bad(new R(), 400, 'invalid_request', U1);
});

test('null bytes in names and unicode lookalikes are refused', () => {
  bad({ op: 'select', table: 'todos\0' }, 400, 'unknown_table', U1);
  bad({ op: 'select', table: 'todos', columns: ['titl\u0435'] }, 400, 'unknown_column', U1);
  bad({ op: 'select', table: '\u0442odos' }, 400, 'unknown_table', U1);
  bad({ op: 'select', table: 'todos', columns: ['title\u200b'] }, 400, 'unknown_column', U1);
  bad({ op: 'select', table: 'todos', columns: ['\uff54itle'] }, 400, 'unknown_column', U1);
});

test('implicit column names collide with nothing; spec columns named id/user_id/created_at are a bad spec', () => {
  for (const name of ['id', 'user_id', 'created_at']) {
    const spec = { version: 1, tables: { t: { access: 'owner', columns: { [name]: { type: 'text' } } } } };
    assert.deepEqual(run({ op: 'select', table: 't' }, U1, spec), { ok: false, status: 400, code: 'bad_spec' });
  }
});

test('request body over 100KB is 413, checked before anything else, even for anonymous and private', () => {
  const big = 'a'.repeat(100 * 1024);
  bad({ op: 'insert', table: 'todos', rows: [{ title: big }] }, 413, 'request_too_large', U1);
  bad({ op: 'insert', table: 'secrets', rows: [{ title: big }] }, 413, 'request_too_large', undefined);
  bad({ op: 'bogus', pad: big }, 413, 'request_too_large', U1);
  // just under: stringified length is exactly the limit
  const pad = (n) => ({ op: 'select', table: 'todos', where: [{ col: 'title', op: 'eq', val: 'a'.repeat(n) }] });
  const base = JSON.stringify(pad(0)).length;
  const exact = pad(100 * 1024 - base);
  assert.equal(JSON.stringify(exact).length, 100 * 1024);
  const r = run(exact, U1);
  assert.deepEqual(r, { ok: false, status: 400, code: 'value_too_long' }); // past the size gate, refused by the text cap
  assert.equal(JSON.stringify(pad(100 * 1024 - base + 1)).length, 100 * 1024 + 1);
  bad(pad(100 * 1024 - base + 1), 413, 'request_too_large', U1);
});

test('requests that cannot be serialized are refused cleanly', () => {
  bad({ op: 'select', table: 'todos', where: [{ col: 'priority', op: 'eq', val: 10n }] }, 400, 'invalid_request', U1);
  const cyc = { op: 'select', table: 'todos' }; cyc.self = cyc;
  bad(cyc, 400, 'invalid_request', U1);
});

test('huge arrays and huge nesting are refused without blowing up', () => {
  bad({ op: 'select', table: 'todos', columns: new Array(200000).fill('title') }, 413, 'request_too_large', U1);
  bad({ op: 'insert', table: 'todos', rows: new Array(10000).fill({ title: 'a' }) }, 413, 'request_too_large', U1);
  bad({ op: 'insert', table: 'todos', rows: new Array(60).fill({ title: 'a' }) }, 400, 'too_many_rows', U1);
});

test('schema name is quoted, with embedded quotes doubled; junk schema names are refused', () => {
  const r = buildQuery({ spec: SPEC, schemaName: 'we"ird', request: { op: 'select', table: 'todos' }, userId: U1 });
  assert.ok(r.text.includes(' FROM "we""ird"."todos" '));
  for (const s of ['', undefined, null, 5, {}, 'a\0b', 'x'.repeat(64)]) {
    assert.deepEqual(buildQuery({ spec: SPEC, schemaName: s, request: { op: 'select', table: 'todos' }, userId: U1 }), { ok: false, status: 400, code: 'bad_schema' });
  }
  assert.equal(buildQuery({ spec: SPEC, schemaName: 'x'.repeat(63), request: { op: 'select', table: 'todos' }, userId: U1 }).ok, true);
});

test('bad specs are refused, not trusted', () => {
  const rq = { op: 'select', table: 't' };
  const mk = (t) => ({ version: 1, tables: { t } });
  const badSpecs = [
    null, undefined, 'x', [], {}, { version: 2, tables: {} }, { version: 1 }, { version: 1, tables: [] },
    mk(null), mk([]), mk({ access: 'owner' }), mk({ columns: {} }), mk({ access: 'root', columns: {} }), mk({ access: 'owner', columns: [] }),
    mk({ access: 'owner', columns: { a: { type: 'varchar' } } }), mk({ access: 'owner', columns: { a: null } }), mk({ access: 'owner', columns: { a: {} } }),
    mk({ access: 'owner', columns: { 'A': { type: 'text' } } }), mk({ access: 'owner', columns: { 'a"b': { type: 'text' } } }), mk({ access: 'owner', columns: { '1a': { type: 'text' } } }),
    mk({ access: 'owner', columns: { ['a'.repeat(42)]: { type: 'text' } } }),
  ];
  for (const spec of badSpecs) {
    const r = run(rq, U1, spec);
    assert.equal(r.ok, false, JSON.stringify(spec));
    assert.equal(r.status, 400);
  }
  // 41 chars is the max name length
  assert.equal(run(rq, U1, mk({ access: 'owner', columns: { ['a'.repeat(41)]: { type: 'text' } } })).ok, true);
  // a spec table name that fails the name pattern is unreachable
  assert.equal(run({ op: 'select', table: 'Bad' }, U1, { version: 1, tables: { Bad: { access: 'owner', columns: {} } } }).ok, false);
  // a valid default type is not required by the builder, but a wrong-typed default is refused
  const badDefault = { version: 1, tables: { t: { access: 'owner', columns: { a: { type: 'integer', default: 'x' } } } } };
  assert.deepEqual(run({ op: 'insert', table: 't', rows: [{}] }, U1, badDefault), { ok: false, status: 400, code: 'bad_value' });
});

test('builder does not mutate the request or spec, and is deterministic', () => {
  const req = { op: 'select', table: 'todos', where: [{ col: 'title', op: 'in', val: ['a', 'b'] }], order: [{ col: 'title' }], limit: 5 };
  const reqCopy = structuredClone(req);
  const specCopy = structuredClone(SPEC);
  const a = good(req, U1);
  const b = good(req, U1);
  assert.deepEqual(a, b);
  assert.deepEqual(req, reqCopy);
  assert.deepEqual(SPEC, specCopy);
});

test('result objects carry no extra fields and refusals never echo input', () => {
  const ok = good({ op: 'select', table: 'todos' }, U1);
  assert.deepEqual(Object.keys(ok).sort(), ['kind', 'ok', 'text', 'values']);
  const marker = 'SECRET_MARKER_123';
  for (const req of [
    { op: marker, table: 'todos' }, { op: 'select', table: marker }, { op: 'select', table: 'todos', columns: [marker] },
    { op: 'select', table: 'todos', where: [{ col: 'title', op: marker, val: 1 }] }, { op: 'select', table: 'todos', [marker]: 1 },
    { op: 'select', table: 'todos', where: [{ col: 'title', op: 'like', val: marker.repeat(20) }] },
    { op: 'select', table: 'todos', where: [{ col: 'priority', op: 'eq', val: marker }] },
  ]) {
    const r = run(req, U1);
    assert.equal(r.ok, false);
    assert.deepEqual(Object.keys(r).sort(), ['code', 'ok', 'status']);
    assert.match(r.code, /^[a-z]+(_[a-z]+)*$/);
    assert.equal(JSON.stringify(r).includes(marker), false);
  }
});

test('non-Refuse internal errors are not swallowed', () => {
  // a spec whose tables getter throws must surface, not be reported as a client error
  const spec = { version: 1, get tables() { throw new RangeError('boom'); } };
  assert.throws(() => run({ op: 'select', table: 't' }, U1, spec), RangeError);
});

test('buildQuery with no arguments refuses', () => {
  assert.deepEqual(buildQuery(), { ok: false, status: 400, code: 'invalid_request' });
});

// ---------- property tests ----------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const MARK = 'ZZMARKZZ';
const KEYWORDS = new Set(['SELECT', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'FROM', 'WHERE', 'AND', 'ORDER', 'BY', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'RETURNING', 'IN', 'IS', 'NOT', 'NULL', 'LIKE', 'ILIKE']);

function allowedIdents(spec, schemaName) {
  const s = new Set([schemaName, 'id', 'user_id', 'created_at']);
  for (const [t, d] of Object.entries(spec.tables)) { s.add(t); for (const c of Object.keys(d.columns)) s.add(c); }
  return s;
}

function checkTokens(text, idents) {
  const tokenRe = /\s+|"((?:[^"]|"")*)"|\$(\d+)|<>|<=|>=|[=<>,().]|([A-Za-z_]+)|([\s\S])/gy;
  const used = [];
  let m;
  let prevWasDot = false;
  while ((m = tokenRe.exec(text)) !== null) {
    if (m[0].trim() === '') continue;
    if (m[1] !== undefined) assert.ok(idents.has(m[1]), 'unexpected identifier ' + m[1]);
    else if (m[2] !== undefined) used.push(Number(m[2]));
    else if (m[3] !== undefined) assert.ok(KEYWORDS.has(m[3]), 'unexpected word ' + m[3]);
    else if (m[4] !== undefined) assert.fail('unexpected character ' + JSON.stringify(m[4]) + ' in ' + text);
    prevWasDot = m[0] === '.';
  }
  void prevWasDot;
  return used;
}

function randomRequest(rnd, spec) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const hit = (p) => rnd() < p;
  const tables = Object.keys(spec.tables);
  const CLEAN = EVIL.filter((e) => !e.includes('\0'));
  const junk = () => pick([
    () => pick(EVIL), () => MARK, () => MARK + "'; DROP", () => 'x'.repeat(10001), () => 'x'.repeat(250), () => -1, () => 2 ** 53, () => NaN, () => Infinity,
    () => null, () => [], () => ({}), () => [1, 2], () => ({ [MARK]: [MARK] }), () => 1.5, () => true, () => '2024-13-45',
  ])();
  const t = hit(0.95) ? pick(tables) : pick([...EVIL, 'todos ']);
  const def = Object.hasOwn(spec.tables, t) ? spec.tables[t] : { columns: {} };
  const colNames = Object.keys(def.columns);
  const typeOf = (c) => (Object.hasOwn(def.columns, c) ? def.columns[c].type : c === 'created_at' ? 'timestamp' : 'uuid');
  const good = (type) => {
    switch (type) {
      case 'text': return pick([...CLEAN, MARK, 'a', 'x'.repeat(250), '']);
      case 'integer': return Math.floor(rnd() * 2000) - 1000;
      case 'number': return rnd() * 1e6 - 5e5;
      case 'boolean': return hit(0.5);
      case 'timestamp': return pick(['2024-05-01', '2024-05-01T10:00:00Z', '2023-12-31T23:59:59+02:00', '2024-02-29T00:00']);
      case 'json': return pick([{ a: [MARK, 1, null] }, [1, 2], 'x', 5, true, {}]);
      default: return pick([U1, U2]);
    }
  };
  const val = (c) => (hit(0.08) ? junk() : good(typeOf(c)));
  const col = () => (hit(0.04) ? pick(EVIL) : pick(['id', 'user_id', 'created_at', ...colNames, ...colNames]));
  const cond = () => {
    const c = col();
    const type = typeOf(c);
    const ops = type === 'boolean' ? ['eq', 'neq', 'is_null', 'in'] : type === 'text' ? ['eq', 'neq', 'lt', 'gte', 'like', 'ilike', 'in', 'is_null'] : type === 'uuid' ? ['eq', 'neq', 'in', 'is_null'] : ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'is_null'];
    const op = hit(0.04) ? pick(EVIL) : pick(ops);
    const o = { col: c, op };
    if (op === 'in') o.val = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => val(c));
    else if (op === 'is_null') { if (hit(0.5)) o.val = hit(0.5); }
    else if (op === 'like' || op === 'ilike') o.val = hit(0.9) ? '%' + String(pick(CLEAN)).slice(0, 30) + '%' : junk();
    else o.val = val(c);
    if (hit(0.03)) delete o.val;
    if (hit(0.02)) o[pick(EVIL)] = 1;
    return o;
  };
  const arr = (f, max, min = 0) => Array.from({ length: min + Math.floor(rnd() * (max - min + 1)) }, f);
  const op = hit(0.97) ? pick(['select', 'insert', 'update', 'delete']) : pick(EVIL);
  const r = { op, table: t };
  if (op === 'select' || op === 'update' || op === 'delete') {
    const need = op !== 'select' ? 1 : 0;
    if (hit(0.95)) r.where = arr(cond, hit(0.03) ? 12 : 3, need);
  }
  if (op === 'select') {
    if (hit(0.4)) r.columns = [...new Set(arr(col, 4, 1))];
    if (hit(0.4)) r.order = arr(() => ({ col: col(), dir: hit(0.95) ? pick(['asc', 'desc']) : pick(EVIL) }), 3);
    if (hit(0.3)) r.limit = hit(0.9) ? 1 + Math.floor(rnd() * 100) : junk();
    if (hit(0.3)) r.offset = hit(0.9) ? Math.floor(rnd() * 100000) : junk();
  }
  const fill = () => { const o = {}; for (const c of colNames) if (hit(0.8)) o[c] = val(c); return o; };
  if (op === 'insert') r.rows = arr(() => { const o = fill(); if (hit(0.03)) o[pick([...EVIL, 'id', 'user_id'])] = val('id'); return o; }, hit(0.03) ? 55 : 3, 1);
  if (op === 'update') { r.set = {}; for (const c of arr(() => pick(colNames.length ? colNames : ['x']), 3, 1)) r.set[c] = val(c); if (hit(0.03)) r[pick(['user_id', 'id'])] = U2; }
  if (hit(0.02)) r[pick(EVIL)] = junk();
  return r;
}

test('property: 3000 randomized requests are either cleanly refused or yield tokenizable, safe SQL', () => {
  const rnd = mulberry32(0xc0ffee);
  const idents = allowedIdents(SPEC, SCHEMA);
  const stats = { ok: 0, refused: 0, kinds: { select: 0, insert: 0, update: 0, delete: 0 } };
  for (let i = 0; i < 3000; i++) {
    const request = randomRequest(rnd, SPEC);
    const snapshot = JSON.stringify(request);
    const userId = rnd() < 0.3 ? undefined : rnd() < 0.9 ? U1 : 'not-a-uuid';
    const r = run(request, userId);
    assert.equal(JSON.stringify(request), snapshot, 'request mutated');
    if (!r.ok) {
      stats.refused++;
      assert.deepEqual(Object.keys(r).sort(), ['code', 'ok', 'status']);
      assert.ok([400, 401, 403, 404, 413].includes(r.status));
      assert.match(r.code, /^[a-z]+(_[a-z]+)*$/);
      assert.equal(JSON.stringify(r).includes(MARK), false);
      continue;
    }
    stats.ok++; stats.kinds[r.kind]++;
    assert.equal(r.kind, request.op);
    const used = checkTokens(r.text, idents);
    // placeholders are exactly $1..$n, each used once, in order
    assert.deepEqual(used, Array.from({ length: r.values.length }, (_, k) => k + 1), r.text);
    assert.equal(r.text.includes(MARK), false);
    assert.equal(/[;'\\]|--|\/\*/.test(r.text), false, r.text);
    assert.ok(r.text.includes(`"${SCHEMA}"."${request.table}"`));
    assert.ok(r.text.startsWith({ select: 'SELECT ', insert: 'INSERT INTO ', update: 'UPDATE ', delete: 'DELETE FROM ' }[r.kind]));
    // every bound value is a primitive the pg driver will serialise sanely
    for (const v of r.values) assert.ok(['string', 'number', 'boolean'].includes(typeof v) && (typeof v !== 'number' || Number.isFinite(v)), typeof v);
    // access and ownership
    const access = SPEC.tables[request.table].access;
    assert.notEqual(access, 'private');
    if (userId === 'not-a-uuid') assert.fail('malformed user must never succeed');
    if (userId === undefined) assert.ok(access === 'public_read' && r.kind === 'select', 'anonymous only reads public_read: ' + access + r.kind);
    else {
      const scoped = access === 'owner' || (access !== 'authenticated' && r.kind !== 'select') || (access === 'authenticated' && (r.kind === 'update' || r.kind === 'delete'));
      if (r.kind === 'insert') {
        assert.ok(r.text.includes('"user_id")'));
        const rows = request.rows.length;
        assert.equal(r.values.filter((v) => v === U1).length >= rows, true);
        assert.equal(r.values[r.values.length - 1], U1);
      } else if (scoped) {
        const m = [...r.text.split(" LIMIT ")[0].split(" ORDER BY ")[0].split(" RETURNING ")[0].matchAll(/"user_id" = \$(\d+)/g)].pop();
        assert.ok(m, 'ownership predicate missing: ' + r.text);
        assert.equal(r.values[Number(m[1]) - 1], U1);
        const whereTail = r.text.split(' WHERE ')[1];
        assert.ok(/ AND "user_id" = \$\d+(?= (ORDER BY|LIMIT|RETURNING)| ?$)/.test(whereTail) || /^"user_id" = \$\d+(?= (ORDER BY|LIMIT|RETURNING)|$)/.test(whereTail), 'ownership predicate must be a top-level AND: ' + whereTail);
      }
    }
    if (r.kind === 'select') {
      const [lim, off] = r.values.slice(-2);
      assert.ok(Number.isInteger(lim) && lim >= 1 && lim <= 100 && Number.isInteger(off) && off >= 0 && off <= 100000);
    }
    if (r.kind === 'update' || r.kind === 'delete') assert.ok(r.text.includes(' WHERE '));
    if (r.kind === 'insert') assert.ok(request.rows.length >= 1 && request.rows.length <= 50);
  }
  // the generator must actually exercise success paths for the checks above to mean anything
  assert.ok(stats.ok > 300, JSON.stringify(stats));
  assert.ok(stats.refused > 300, JSON.stringify(stats));
  for (const k of Object.keys(stats.kinds)) assert.ok(stats.kinds[k] > 30, JSON.stringify(stats));
});

test('property: well-formed random valid requests always succeed and bind every client value', () => {
  const rnd = mulberry32(42);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const idents = allowedIdents(SPEC, SCHEMA);
  const boundOf = (ws) => ws.flatMap((w) => (w.op === 'in' ? w.val : [w.val]).map((v) => (w.col === 'due' ? new Date(v).toISOString() : v)));
  const CLEAN = EVIL.filter((e) => !e.includes('\0'));
  const valFor = { title: () => pick(CLEAN), done: () => rnd() < 0.5, priority: () => Math.floor(rnd() * 1000) - 500, score: () => rnd() * 100, due: () => '2024-0' + (1 + Math.floor(rnd() * 9)) + '-1' + Math.floor(rnd() * 9) + 'T10:00:00Z', meta: () => ({ a: [pick(CLEAN)] }), note: () => pick(CLEAN) };
  for (let i = 0; i < 1000; i++) {
    const cols = Object.keys(valFor);
    const nWhere = Math.floor(rnd() * 5);
    const where = Array.from({ length: nWhere }, () => {
      const c = pick(['title', 'done', 'priority', 'score', 'due', 'note']);
      const type = { title: 'text', note: 'text', done: 'bool', priority: 'num', score: 'num', due: 'ts' }[c];
      const ops = type === 'bool' ? ['eq', 'neq'] : type === 'text' ? ['eq', 'neq', 'lt', 'gt', 'like', 'ilike'] : ['eq', 'neq', 'lt', 'lte', 'gt', 'gte'];
      const op = pick(ops);
      const v = op === 'like' || op === 'ilike' ? '%' + pick(CLEAN).slice(0, 50) + '%' : valFor[c]();
      return rnd() < 0.2 && op === 'eq' && type !== 'bool' ? { col: c, op: 'in', val: [v, valFor[c]()] } : { col: c, op, val: v };
    });
    const choice = i % 4;
    let request;
    let expectedBound;
    if (choice === 0) { request = { op: 'select', table: 'todos', where, order: [{ col: pick(cols.filter((c) => c !== 'meta')), dir: pick(['asc', 'desc']) }], limit: 1 + Math.floor(rnd() * 100), offset: Math.floor(rnd() * 1000) }; expectedBound = boundOf(where); }
    else if (choice === 1) { const row = { title: pick(CLEAN), meta: valFor.meta() }; request = { op: 'insert', table: 'todos', rows: [row, { ...row, priority: 3 }] }; expectedBound = [row.title]; }
    else if (choice === 2) { request = { op: 'update', table: 'todos', set: { title: pick(CLEAN), score: 2.5 }, where: where.concat([{ col: 'id', op: 'eq', val: U2 }]) }; expectedBound = []; }
    else { request = { op: 'delete', table: 'todos', where: where.concat([{ col: 'id', op: 'eq', val: U2 }]) }; expectedBound = boundOf(where); }
    const r = good(request, U1);
    const used = checkTokens(r.text, idents);
    assert.deepEqual(used, Array.from({ length: r.values.length }, (_, k) => k + 1));
    for (const b of expectedBound) assert.ok(r.values.includes(b), 'bound value missing');
    assert.ok(r.values.includes(U1));
  }
});
