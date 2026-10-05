// Regression tests added after mutation testing of query.js: each one kills a mutant the first suite let survive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery } from '../query.js';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const S = '"app_abc123"';
const SPEC = {
  version: 1,
  tables: {
    todos: { access: 'owner', columns: { title: { type: 'text', required: true }, priority: { type: 'integer' } } },
    posts: { access: 'public_read', columns: { body: { type: 'text', required: true }, likes: { type: 'integer' } } },
    notes: { access: 'authenticated', columns: { text: { type: 'text', required: true } } },
  },
};
const run = (request, userId, spec = SPEC) => buildQuery({ spec, schemaName: 'app_abc123', request, userId });
const good = (request, userId) => {
  const r = run(request, userId);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
};
const bad = (request, status, code, userId) => assert.deepEqual(run(request, userId), { ok: false, status, code });

test('array-wrapped names are not coerced into identifiers', () => {
  for (const n of [['id'], ['user_id'], ['created_at'], ['title']]) {
    bad({ op: 'select', table: 'todos', columns: [n] }, 400, 'unknown_column', U1);
    bad({ op: 'select', table: 'todos', where: [{ col: n, op: 'is_null' }] }, 400, 'unknown_column', U1);
    bad({ op: 'select', table: 'todos', order: [{ col: n }] }, 400, 'unknown_column', U1);
  }
  bad({ op: 'select', table: ['todos'] }, 400, 'unknown_table', U1);
});

test('select text is exact when optional parts are absent or empty', () => {
  const all = '"id", "user_id", "created_at", "body", "likes"';
  assert.equal(good({ op: 'select', table: 'posts' }).text, `SELECT ${all} FROM ${S}."posts" LIMIT $1 OFFSET $2`);
  assert.equal(good({ op: 'select', table: 'posts', where: [], order: [] }).text, `SELECT ${all} FROM ${S}."posts" LIMIT $1 OFFSET $2`);
  assert.equal(good({ op: 'select', table: 'notes', order: [] }, U1).text, `SELECT "id", "user_id", "created_at", "text" FROM ${S}."notes" LIMIT $1 OFFSET $2`);
});

test('write statements bind a lower-cased user id for upper-case input', () => {
  const up = U1.replace(/1/g, 'A').replace(/8/g, 'B');
  assert.equal(good({ op: 'insert', table: 'todos', rows: [{ title: 'a' }] }, up).values.at(-1), up.toLowerCase());
  assert.equal(good({ op: 'update', table: 'todos', set: { title: 'a' }, where: [{ col: 'priority', op: 'eq', val: 1 }] }, up).values.at(-1), up.toLowerCase());
  assert.equal(good({ op: 'delete', table: 'todos', where: [{ col: 'priority', op: 'eq', val: 1 }] }, up).values.at(-1), up.toLowerCase());
  assert.equal(good({ op: 'select', table: 'todos' }, up).values[0], up.toLowerCase());
});

test('select columns: the 100 column cap applies to wide tables', () => {
  const columns = {};
  for (let i = 0; i < 110; i++) columns['c' + i] = { type: 'text' };
  const spec = { version: 1, tables: { wide: { access: 'owner', columns } } };
  const sel = (n) => run({ op: 'select', table: 'wide', columns: Array.from({ length: n }, (_, i) => 'c' + i) }, U1, spec);
  assert.equal(sel(100).ok, true);
  assert.deepEqual(sel(101), { ok: false, status: 400, code: 'bad_columns' });
});

test('inherited properties on Object.prototype are never trusted for request fields', () => {
  Object.prototype.op = 'select'; Object.prototype.val = 'x'; Object.prototype.col = 'title'; Object.prototype.dir = 'desc';
  try {
    bad({ table: 'todos' }, 400, 'unknown_op', U1);
    bad({ op: 'select', table: 'todos', where: [{ col: 'title', op: 'eq' }] }, 400, 'bad_value', U1);
    bad({ op: 'select', table: 'todos', where: [{ op: 'eq', val: 'a' }] }, 400, 'bad_where', U1);
    bad({ op: 'select', table: 'todos', order: [{}] }, 400, 'bad_order', U1);
    assert.ok(good({ op: 'select', table: 'todos', order: [{ col: 'title' }] }, U1).text.includes(' ORDER BY "title" ASC '));
  } finally {
    delete Object.prototype.op; delete Object.prototype.val; delete Object.prototype.col; delete Object.prototype.dir;
  }
  Object.assign(Object.prototype, { limit: 5, offset: 7, columns: ['id'], order: [{ col: 'id' }], rows: [{ title: 'z' }], set: { title: 'z' } });
  try {
    const r = good({ op: 'select', table: 'todos' }, U1);
    assert.deepEqual(r.values, [U1, 50, 0]);
    assert.equal(r.text.includes('ORDER BY'), false);
    assert.ok(r.text.startsWith('SELECT "id", "user_id", "created_at", "title"'));
    bad({ op: 'insert', table: 'todos' }, 400, 'bad_rows', U1);
    bad({ op: 'update', table: 'todos', where: [{ col: 'id', op: 'eq', val: U2 }] }, 400, 'bad_set', U1);
  } finally {
    for (const k of ['limit', 'offset', 'columns', 'order', 'rows', 'set']) delete Object.prototype[k];
  }
});
