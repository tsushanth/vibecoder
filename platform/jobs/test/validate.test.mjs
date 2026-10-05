import test from 'node:test';
import assert from 'node:assert/strict';
import { validateJobs, MAX_JOBS } from '../validate.js';

const connector = (o = {}) => ({ id: 'wx', schedule: { every: '1h' }, action: { type: 'connector', connector: 'nws', method: 'GET', path: '/alerts/active', query: { area: 'CA' }, save: { table: 'readings', map: { temp: '/properties/temp', note: '/properties/note' } } }, ...o });
const prune = (o = {}) => ({ id: 'cleanup', schedule: { dailyAt: '03:00', tz: 'UTC' }, action: { type: 'prune', table: 'readings', olderThanDays: 30 }, ...o });
const ok = (jobs, ctx) => validateJobs({ jobs }, ctx);
const codes = (r) => r.errors.map((e) => e.code);
const TABLES = { readings: { access: 'public_read', columns: { temp: { type: 'number' }, note: { type: 'text' } }, indexes: [] }, mine: { access: 'owner', columns: { x: { type: 'text' } }, indexes: [] } };

test('accepts a connector job and a prune job and returns normalized copies', () => {
    const r = ok([connector(), prune()]);
    assert.equal(r.ok, true);
    assert.equal(r.jobs.length, 2);
    assert.deepEqual(r.jobs[0].schedule, { every: '1h' });
    assert.deepEqual(r.jobs[1].schedule, { dailyAt: '03:00', tz: 'UTC' });
});

test('the input is not mutated and unrelated extra data is not carried into the output', () => {
    const j = connector();
    const before = JSON.stringify(j);
    ok([j]);
    assert.equal(JSON.stringify(j), before);
});

test('top level must be an object with only version and jobs', () => {
    for (const bad of [null, [], 'x', 3]) assert.deepEqual(codes(validateJobs(bad)), ['not_an_object']);
    assert.ok(codes(validateJobs({ jobs: [], extra: 1 })).includes('unknown_key'));
    assert.ok(codes(validateJobs({ jobs: [], version: 2 })).includes('bad_version'));
    assert.equal(validateJobs({ version: 1, jobs: [] }).ok, true);
    assert.deepEqual(codes(validateJobs({})), ['no_jobs']);
    assert.deepEqual(codes(validateJobs({ jobs: {} })), ['no_jobs']);
});

test('at most 5 jobs per app, ids unique and well formed', () => {
    assert.equal(MAX_JOBS, 5);
    const six = Array.from({ length: 6 }, (_, i) => prune({ id: `j${i}` }));
    assert.ok(codes(ok(six)).includes('too_many_jobs'));
    assert.equal(ok(six.slice(0, 5)).ok, true);
    assert.ok(codes(ok([prune(), prune()])).includes('duplicate_job_id'));
    for (const id of ['', 'A', '1a', 'a b', 'a'.repeat(33), "x'; drop", undefined, 5]) assert.ok(codes(ok([prune({ id })])).includes('bad_job_id'), String(id));
    assert.equal(ok([prune({ id: 'a'.repeat(32) })]).ok, true);
});

test('job objects reject unknown keys and non-objects', () => {
    assert.ok(codes(ok([prune({ enabled: false })])).includes('unknown_key'));
    assert.ok(codes(ok(['x'])).includes('bad_job'));
    assert.ok(codes(ok([null])).includes('bad_job'));
});

test('schedule: only the four intervals, so the minimum is 15 minutes', () => {
    for (const every of ['15m', '1h', '6h', '1d']) assert.equal(ok([prune({ schedule: { every } })]).ok, true, every);
    for (const every of ['1m', '5m', '14m', '30s', '2h', '', 15, null, '15M']) assert.ok(codes(ok([prune({ schedule: { every } })])).includes('bad_schedule'), String(every));
});

test('schedule: dailyAt is HH:MM 24h UTC; exactly one of every / dailyAt', () => {
    for (const dailyAt of ['00:00', '23:59', '09:05']) assert.equal(ok([prune({ schedule: { dailyAt, tz: 'UTC' } })]).ok, true, dailyAt);
    for (const dailyAt of ['24:00', '12:60', '9:05', '12:5', '1200', '', 'ab:cd', '12:00:00', 1200, '12:00\n']) assert.ok(codes(ok([prune({ schedule: { dailyAt, tz: 'UTC' } })])).includes('bad_schedule'), String(dailyAt));
    assert.equal(ok([prune({ schedule: { dailyAt: '03:00' } })]).jobs[0].schedule.tz, 'UTC', 'tz defaults to UTC');
    assert.ok(codes(ok([prune({ schedule: { dailyAt: '03:00', tz: 'America/Los_Angeles' } })])).includes('bad_schedule'));
    assert.ok(codes(ok([prune({ schedule: { every: '1h', dailyAt: '03:00' } })])).includes('bad_schedule'));
    assert.ok(codes(ok([prune({ schedule: {} })])).includes('bad_schedule'));
    assert.ok(codes(ok([prune({ schedule: { every: '1h', tz: 'UTC' } })])).includes('bad_schedule'), 'tz only goes with dailyAt');
    assert.ok(codes(ok([prune({ schedule: { every: '1h', cron: '* * * * *' } })])).includes('bad_schedule'));
    assert.ok(codes(ok([prune({ schedule: { dailyAt: '03:00', tz: 'UTC', cron: '* * * * *' } })])).includes('bad_schedule'));
    assert.ok(codes(ok([prune({ schedule: undefined })])).includes('bad_schedule'));
    assert.ok(codes(ok([prune({ schedule: '1h' })])).includes('bad_schedule'));
});

test('notify is reserved and refused with a clear not_yet error', () => {
    const r = ok([{ id: 'n', schedule: { every: '1h' }, action: { type: 'notify', to: 'a@b.c' } }]);
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].code, 'not_yet');
    assert.equal(r.errors[0].job, 'n');
    assert.match(r.errors[0].message, /notify/);
    for (const type of ['sql', 'function', '', undefined, 'Prune']) assert.ok(codes(ok([prune({ action: { type } })])).includes('bad_action'), String(type));
    assert.ok(codes(ok([prune({ action: 'prune' })])).includes('bad_action'));
});

test('prune: olderThanDays is an integer from 1 to 365; table name checked; no extra keys', () => {
    for (const d of [1, 30, 365]) assert.equal(ok([prune({ action: { type: 'prune', table: 'readings', olderThanDays: d } })]).ok, true, String(d));
    for (const d of [0, -1, 366, 1.5, '30', null, undefined, NaN, Infinity]) assert.ok(codes(ok([prune({ action: { type: 'prune', table: 'readings', olderThanDays: d } })])).includes('bad_older_than_days'), String(d));
    for (const table of ['Readings', '1x', 'a-b', '', 'a'.repeat(42), 'pg_x', 'sql', 'x"; drop', undefined]) assert.ok(codes(ok([prune({ action: { type: 'prune', table, olderThanDays: 3 } })])).includes('bad_table'), String(table));
    assert.ok(codes(ok([prune({ action: { type: 'prune', table: 'readings', olderThanDays: 3, where: '1=1' } })])).includes('unknown_key'));
});

test('connector: required pieces and strict shapes', () => {
    const c = (patch) => connector({ action: { ...connector().action, ...patch } });
    assert.ok(codes(ok([c({ connector: 'Bad Name' })])).includes('bad_connector'));
    assert.ok(codes(ok([c({ connector: undefined })])).includes('bad_connector'));
    for (const method of ['POST', 'get', undefined, 'DELETE']) assert.ok(codes(ok([c({ method })])).includes('bad_method'), String(method));
    for (const path of ['alerts', '/a?x=1', '/a#f', '/a\\b', '/../x', '/a/./b', '/a//b', '', undefined, '/' + 'a'.repeat(200), '/a%2fb']) assert.ok(codes(ok([c({ path })])).includes('bad_path'), String(path));
    assert.equal(ok([c({ path: '/points/37,-122' })]).ok, true);
    assert.ok(codes(ok([c({ extra: 1 })])).includes('unknown_key'));
});

test('connector: query is a small flat map of scalars', () => {
    const c = (query) => connector({ action: { ...connector().action, query } });
    assert.equal(ok([c(undefined)]).ok, true);
    assert.equal(ok([c({ a: 'x', b: 2, c: true })]).ok, true);
    for (const q of [[], 'a=b', null, { a: {} }, { a: [1] }, { a: null }, { 'bad key!': 'x' }, { a: 'x'.repeat(201) }, Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'v'])), { a: NaN }]) assert.ok(codes(ok([c(q)])).includes('bad_query'), JSON.stringify(q)?.slice(0, 40));
    assert.equal(ok([c(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, 'v'])))]).ok, true);
});

test('connector: save needs a table and a map of column to JSON pointer', () => {
    const c = (save) => connector({ action: { ...connector().action, save } });
    assert.ok(codes(ok([c(undefined)])).includes('bad_save'));
    assert.ok(codes(ok([c({ table: 'readings' })])).includes('bad_save'));
    assert.ok(codes(ok([c({ table: 'readings', map: {} })])).includes('bad_save'));
    assert.ok(codes(ok([c({ table: 'readings', map: [] })])).includes('bad_save'));
    assert.ok(codes(ok([c({ table: 'readings', map: { a: '/x' }, extra: 1 })])).includes('unknown_key'));
    assert.ok(codes(ok([c({ table: 'Bad', map: { a: '/x' } })])).includes('bad_table'));
    for (const col of ['A', '1a', 'a-b', 'id', 'user_id', 'created_at']) assert.ok(codes(ok([c({ table: 'readings', map: { [col]: '/x' } })])).some((x) => x === 'bad_column' || x === 'reserved_column'), col);
    assert.ok(codes(ok([c({ table: 'readings', map: { id: '/x' } })])).includes('reserved_column'));
    const big = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`c${i}`, '/x']));
    assert.ok(codes(ok([c({ table: 'readings', map: big })])).includes('bad_save'));
    assert.equal(ok([c({ table: 'readings', map: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`c${i}`, '/x'])) })]).ok, true);
});

test('JSON pointers: RFC 6901 syntax, bounded depth and length', () => {
    const c = (p) => connector({ action: { ...connector().action, save: { table: 'readings', map: { temp: p } } } });
    for (const p of ['/a', '/a/b/0', '/a~0b', '/a~1b', '/0', '/a/', '/'.repeat(1) + 'x'.repeat(100)]) assert.equal(ok([c(p)]).ok, true, p);
    for (const p of ['', 'a', 'a/b', '/a~', '/a~2', '/a~b', 5, null, {}, '/' + 'x'.repeat(200), '/1/2/3/4/5/6/7/8/9']) assert.ok(codes(ok([c(p)])).includes('bad_pointer'), String(p));
    assert.equal(ok([c('/1/2/3/4/5/6/7/8')]).ok, true);
});

test('with context: unknown connectors, tables and columns are rejected', () => {
    const ctx = { tables: TABLES, connectors: { nws: {} } };
    assert.equal(ok([connector(), prune()], ctx).ok, true);
    assert.ok(codes(ok([connector({ action: { ...connector().action, connector: 'ghost' } })], ctx)).includes('unknown_connector'));
    assert.ok(codes(ok([connector({ action: { ...connector().action, save: { table: 'nope', map: { temp: '/x' } } } })], ctx)).includes('unknown_table'));
    assert.ok(codes(ok([connector({ action: { ...connector().action, save: { table: 'readings', map: { missing: '/x' } } } })], ctx)).includes('unknown_column'));
    assert.ok(codes(ok([prune({ action: { type: 'prune', table: 'nope', olderThanDays: 3 } })], ctx)).includes('unknown_table'));
    assert.equal(validateJobs({ jobs: [connector()] }, { tables: undefined, connectors: { nws: {} } }).ok, true, 'no table context means no table checks');
    assert.ok(codes(ok([connector()], { tables: {}, connectors: { nws: {} } })).includes('unknown_table'), 'an empty table set is a context');
    assert.ok(codes(ok([connector()], { tables: null, connectors: {} })).includes('unknown_connector'));
});

test('connector save into a table where required columns are not mapped is refused', () => {
    const tables = { readings: { access: 'public_read', columns: { temp: { type: 'number', required: true }, note: { type: 'text', required: true, default: 'n' } }, indexes: [] } };
    const j = connector({ action: { ...connector().action, save: { table: 'readings', map: { note: '/n' } } } });
    const r = ok([j], { tables, connectors: { nws: {} } });
    assert.ok(codes(r).includes('missing_required_column'));
    assert.equal(r.errors.find((e) => e.code === 'missing_required_column').column, 'temp', 'required with a default is not demanded');
});

test('owner-access tables produce a warning, not an error: job rows have no user_id', () => {
    const j = connector({ action: { ...connector().action, save: { table: 'mine', map: { x: '/x' } } } });
    const r = ok([j], { tables: TABLES, connectors: { nws: {} } });
    assert.equal(r.ok, true);
    assert.deepEqual(r.warnings, [{ code: 'owner_table_rows_have_no_owner', job: 'wx', table: 'mine' }]);
    assert.deepEqual(ok([connector()], { tables: TABLES, connectors: { nws: {} } }).warnings, []);
});

test('errors never echo attacker-supplied strings beyond a clipped job id', () => {
    const r = ok([prune({ id: 'x'.repeat(500) + 'SECRET' })]);
    assert.ok(JSON.stringify(r).length < 600);
    assert.ok(!JSON.stringify(r).includes('SECRET'));
});
