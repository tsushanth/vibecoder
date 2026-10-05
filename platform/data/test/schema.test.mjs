import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec, planMigration, indexName, LIMITS } from '../schema.js';

const todo = { version: 1, tables: { todos: { access: 'owner', columns: { title: { type: 'text', required: true }, done: { type: 'boolean', default: false }, due: { type: 'timestamp' } }, indexes: [['done']] } } };
const good = () => JSON.parse(JSON.stringify(todo));
const v = (o) => validateSpec(o);
const codes = (r) => r.errors.map((e) => e.code);

test('a valid schema is accepted and normalized (access defaults to owner, indexes to [])', () => {
    const r = v({ version: 1, tables: { notes: { columns: { body: { type: 'text' } } } } });
    assert.equal(r.ok, true); assert.deepEqual(r.spec, { version: 1, tables: { notes: { access: 'owner', columns: { body: { type: 'text' } }, indexes: [] } } });
    assert.deepEqual(v(good()).spec, good());
});

test('structure errors: non-objects, bad version, missing tables, unknown keys everywhere', () => {
    for (const x of [null, undefined, 5, 'x', [], { version: 1 }, { version: 2, tables: {} }]) assert.equal(v(x).ok, false, JSON.stringify(x));
    for (const mut of [(s) => { s.extra = 1; }, (s) => { s.tables.todos.extra = 1; }, (s) => { s.tables.todos.columns.title.extra = 1; }]) { const s = good(); mut(s); assert.ok(codes(v(s)).includes('unknown_key')); }
});

test('table and column names: strict pattern, no pg_ prefix, no implicit column names', () => {
    for (const bad of ['Todos', '1x', 'a-b', 'a b', 'x"; drop table y;--', '', 'a'.repeat(42), 'pg_thing', 'sql', '__proto__']) {
        const s = good(); s.tables = { [bad]: good().tables.todos }; assert.equal(v(s).ok, false, bad);
    }
    for (const bad of ['Title', 'a-b', 'id', 'user_id', 'created_at', 'x"y', 'a'.repeat(42)]) {
        const s = good(); s.tables.todos.indexes = []; s.tables.todos.columns = { [bad]: { type: 'text' } }; assert.deepEqual(codes(v(s)).filter((c) => c !== 'unknown_key'), [bad === 'id' || bad === 'user_id' || bad === 'created_at' ? 'reserved_column' : 'bad_column_name'], bad);
    }
});

test('types, access, required and defaults are checked', () => {
    const t = (mut) => { const s = good(); mut(s.tables.todos); return v(s); };
    assert.ok(codes(t((d) => { d.columns.title.type = 'varchar'; })).includes('bad_type'));
    assert.ok(codes(t((d) => { d.columns.title.type = 'constructor'; })).includes('bad_type'));
    assert.ok(codes(t((d) => { d.access = 'everyone'; })).includes('bad_access'));
    assert.ok(codes(t((d) => { d.columns.title.required = 'yes'; })).includes('bad_required'));
    for (const [type, def] of [['text', 5], ['text', 'x'.repeat(201)], ['text', 'a\u0000b'], ['integer', 1.5], ['integer', 2 ** 60], ['number', Infinity], ['number', NaN], ['boolean', 'true'], ['timestamp', '2026-01-01'], ['json', {}]])
        assert.ok(codes(t((d) => { d.columns.title = { type, default: def }; })).includes('bad_default'), `${type} ${String(def)}`);
    for (const [type, def] of [['text', "it's"], ['integer', -3], ['number', 1.5], ['boolean', true], ['timestamp', 'now']]) assert.equal(t((d) => { d.columns.title = { type, default: def }; }).ok, true, type);
    for (const a of ['owner', 'public_read', 'authenticated', 'private']) assert.equal(t((d) => { d.access = a; }).ok, true);
});

test('limits: tables, columns, indexes', () => {
    const s = { version: 1, tables: {} }; for (let i = 0; i <= LIMITS.tables; i++) s.tables[`t${i}`] = { columns: { a: { type: 'text' } } };
    assert.ok(codes(v(s)).includes('too_many_tables'));
    const c = good(); c.tables.todos.columns = {}; for (let i = 0; i <= LIMITS.columns; i++) c.tables.todos.columns[`c${i}`] = { type: 'text' };
    assert.ok(codes(v(c)).includes('too_many_columns'));
    const e = good(); e.tables.todos.columns = {}; assert.ok(codes(v(e)).includes('no_columns'));
    const ix = good(); ix.tables.todos.indexes = [['done'], ['title'], ['due'], ['done', 'title']]; assert.ok(codes(v(ix)).includes('bad_indexes'));
});

test('indexes must name existing columns (or created_at), be 1..3 long, and not repeat a column', () => {
    for (const bad of [[['nope']], [[]], [['done', 'done']], [['id']], [['done', 'title', 'due', 'created_at']], ['done'], [[5]], 'x']) {
        const s = good(); s.tables.todos.indexes = bad; assert.equal(v(s).ok, false, JSON.stringify(bad));
    }
    const s = good(); s.tables.todos.indexes = [['created_at'], ['done', 'title']]; assert.equal(v(s).ok, true);
});

// ---- planner ----
const plan = (a, b, o) => planMigration(a ? v(a).spec : null, v(b).spec, o);

test('a new schema creates tables with implicit columns, quoted names, user index and declared indexes', () => {
    const r = plan(null, good());
    assert.equal(r.ok, true);
    assert.equal(r.statements[0], 'create table "todos" ("id" uuid primary key default gen_random_uuid(), "user_id" uuid, "created_at" timestamptz not null default now(), "title" text not null, "done" boolean default false, "due" timestamptz)');
    assert.equal(r.statements[1], 'create index "ix_todos_user" on "todos" ("user_id")');
    assert.equal(r.statements[2], `create index "${indexName('todos', ['done'])}" on "todos" ("done")`);
    assert.equal(r.statements.length, 3); assert.deepEqual(r.destructive, []);
});

test('defaults are escaped as literals: quotes doubled, numbers and booleans plain, timestamp now()', () => {
    const s = { version: 1, tables: { a: { columns: { t: { type: 'text', default: "x'; drop table a;--" }, n: { type: 'number', default: 1.5 }, i: { type: 'integer', default: -2 }, b: { type: 'boolean', default: true }, ts: { type: 'timestamp', default: 'now' } } } } };
    const sql = plan(null, s).statements[0];
    assert.match(sql, /"t" text default 'x''; drop table a;--'/); assert.match(sql, /"n" double precision default 1\.5/); assert.match(sql, /"i" bigint default -2/);
    assert.match(sql, /"b" boolean default true/); assert.match(sql, /"ts" timestamptz default now\(\)/);
});

test('additive changes plan without confirmation: new table, new column, new index, dropping an index, relaxing required, default changes', () => {
    const next = good(); next.tables.todos.columns.note = { type: 'text' }; next.tables.todos.columns.title = { type: 'text' }; next.tables.todos.columns.done = { type: 'boolean', default: true }; next.tables.todos.indexes = [['due']];
    next.tables.tags = { columns: { label: { type: 'text', required: true } } };
    const r = plan(good(), next);
    assert.equal(r.ok, true);
    assert.deepEqual(r.statements, [
        'alter table "todos" alter column "title" drop not null',
        'alter table "todos" alter column "done" set default true',
        'alter table "todos" add column "note" text',
        `create index "${indexName('todos', ['due'])}" on "todos" ("due")`,
        `drop index if exists "${indexName('todos', ['done'])}"`,
        'create table "tags" ("id" uuid primary key default gen_random_uuid(), "user_id" uuid, "created_at" timestamptz not null default now(), "label" text not null)',
        'create index "ix_tags_user" on "tags" ("user_id")',
    ]);
});

test('removing a default plans drop default', () => {
    const next = good(); next.tables.todos.columns.done = { type: 'boolean' };
    assert.ok(plan(good(), next).statements.includes('alter table "todos" alter column "done" drop default'));
});

test('adding a required column to an existing table needs a default, and with one it is added not null', () => {
    const a = good(); a.tables.todos.columns.pri = { type: 'integer', required: true };
    assert.deepEqual(plan(good(), a), { ok: false, errors: [{ code: 'required_needs_default', table: 'todos', column: 'pri' }] });
    a.tables.todos.columns.pri.default = 3;
    assert.deepEqual(plan(good(), a).statements, ['alter table "todos" add column "pri" bigint not null default 3']);
});

test('destructive changes are refused with the list, and only planned when confirmed', () => {
    const drop = good(); delete drop.tables.todos.columns.due; drop.tables.todos.indexes = [];
    const r = plan(good(), drop); assert.equal(r.ok, false); assert.deepEqual(r.errors, [{ code: 'destructive_change_needs_confirmation' }]); assert.deepEqual(r.destructive, [{ kind: 'drop_column', table: 'todos', column: 'due' }]);
    const okR = plan(good(), drop, { allowDestructive: true }); assert.equal(okR.ok, true); assert.ok(okR.statements.includes('alter table "todos" drop column "due"'));

    const typeChg = good(); typeChg.tables.todos.columns.title = { type: 'integer', required: true };
    assert.deepEqual(plan(good(), typeChg).destructive, [{ kind: 'change_type', table: 'todos', column: 'title' }]);
    assert.ok(plan(good(), typeChg, { allowDestructive: true }).statements.includes('alter table "todos" alter column "title" type bigint using "title"::bigint'));

    const tighten = good(); tighten.tables.todos.columns.due = { type: 'timestamp', required: true, default: 'now' };
    assert.deepEqual(plan(good(), tighten).destructive, [{ kind: 'make_required', table: 'todos', column: 'due' }]);
    const t2 = plan(good(), tighten, { allowDestructive: true }).statements; assert.ok(t2.indexOf('update "todos" set "due" = now() where "due" is null') < t2.indexOf('alter table "todos" alter column "due" set not null'));

    const dropTable = { version: 1, tables: { other: { columns: { a: { type: 'text' } } } } };
    const dt = plan(good(), dropTable); assert.deepEqual(dt.destructive, [{ kind: 'drop_table', table: 'todos' }]);
    assert.ok(plan(good(), dropTable, { allowDestructive: true }).statements.includes('drop table "todos"'));
});

test('an identical schema plans nothing', () => { assert.deepEqual(plan(good(), good()), { ok: true, statements: [], destructive: [] }); });

test('access changes need no DDL', () => { const n = good(); n.tables.todos.access = 'public_read'; assert.deepEqual(plan(good(), n).statements, []); });

test('index names have a fixed shape', () => { assert.match(indexName('todos', ['a']), /^ix_todos_[0-9a-f]{8}$/); });

test('index names are stable, distinct per column list, and short enough for Postgres', () => {
    assert.equal(indexName('todos', ['a', 'b']), indexName('todos', ['a', 'b'])); assert.notEqual(indexName('todos', ['a', 'b']), indexName('todos', ['b', 'a']));
    assert.ok(indexName('t'.repeat(41), ['a']).length <= 63);
});
