import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseDestructive, schemaStatusInfo, jobsStatusInfo, describeDestructive, confirmPhrases, isConfirmationTyped,
  deployOutcome, deployBody, planDestructive, SCHEMA_STATUS_KEYS, JOBS_STATUS_KEYS, DESTRUCTIVE_KIND_KEYS,
} from './schemaDeploy.ts';

const D = [{ kind: 'drop_table', table: 'todos' }, { kind: 'drop_column', table: 'notes', column: 'body' }];

test('parseDestructive keeps only well-formed names and drops everything else', () => {
  assert.deepEqual(parseDestructive([...D, { kind: 'evil', table: 'x' }, { kind: 'drop_table', table: 'Bad Name' }, { kind: 'drop_column', table: 'notes' }, null, 'x', { kind: 'change_type', table: 't', column: 'c', value: 'ROW' }]),
    [...D, { kind: 'change_type', table: 't', column: 'c' }]);
  for (const bad of [undefined, null, 'x', 5, {}]) assert.deepEqual(parseDestructive(bad), []);
  assert.equal(parseDestructive(Array.from({ length: 500 }, (_, i) => ({ kind: 'drop_table', table: `t${i}` }))).length, 100);
});

test('schema status copy: each known status has its own key and tone, unknown or missing shows nothing', () => {
  assert.deepEqual(schemaStatusInfo('applied'), { key: 'publish.schema.applied', tone: 'success' });
  assert.deepEqual(schemaStatusInfo('unchanged'), { key: 'publish.schema.unchanged', tone: 'neutral' });
  assert.deepEqual(schemaStatusInfo('invalid'), { key: 'publish.schema.invalid', tone: 'error' });
  assert.deepEqual(schemaStatusInfo('needs_confirmation'), { key: 'publish.schema.needsConfirmation', tone: 'warning' });
  assert.deepEqual(schemaStatusInfo('failed'), { key: 'publish.schema.failed', tone: 'error' });
  for (const s of [undefined, null, '', 'weird', 5, {}]) assert.equal(schemaStatusInfo(s), null);
});

test('jobs status copy: applied, invalid, failed', () => {
  assert.deepEqual(jobsStatusInfo('applied'), { key: 'publish.jobs.applied', tone: 'success' });
  assert.deepEqual(jobsStatusInfo('invalid'), { key: 'publish.jobs.invalid', tone: 'error' });
  assert.deepEqual(jobsStatusInfo('failed'), { key: 'publish.jobs.failed', tone: 'error' });
  for (const s of [undefined, null, 'unchanged', 'needs_confirmation', 7]) assert.equal(jobsStatusInfo(s), null);
});

test('describeDestructive names the table, and the column when there is one', () => {
  assert.deepEqual(describeDestructive(D[0] as never), { key: 'publish.schema.kind.drop_table', values: { table: 'todos', column: '' } });
  assert.deepEqual(describeDestructive(D[1] as never), { key: 'publish.schema.kind.drop_column', values: { table: 'notes', column: 'body' } });
  for (const kind of ['drop_table', 'drop_column', 'change_type', 'make_required']) assert.ok(kind in DESTRUCTIVE_KIND_KEYS);
});

test('the typed confirmation is the word DELETE or the name of one of the affected tables, exactly', () => {
  assert.deepEqual(confirmPhrases(D as never), ['DELETE', 'todos', 'notes']);
  assert.deepEqual(confirmPhrases([D[0], D[0]] as never), ['DELETE', 'todos']);
  assert.equal(isConfirmationTyped('DELETE', D as never), true);
  assert.equal(isConfirmationTyped('  DELETE  ', D as never), true);
  assert.equal(isConfirmationTyped('todos', D as never), true);
  assert.equal(isConfirmationTyped('notes', D as never), true);
  for (const bad of ['', 'delete', 'Delete', 'DELET', 'body', 'todo', 'other', 'todos notes']) assert.equal(isConfirmationTyped(bad, D as never), false, bad);
  assert.equal(isConfirmationTyped('DELETE', []), false, 'nothing to confirm means nothing can be confirmed');
});

test('deployOutcome reads the deploy response: statuses, and the destructive list only when confirmation is needed', () => {
  assert.deepEqual(deployOutcome({ success: true, url: 'u', schemaStatus: 'applied', jobsStatus: 'failed' }), { schema: { key: 'publish.schema.applied', tone: 'success' }, jobs: { key: 'publish.jobs.failed', tone: 'error' }, needsConfirmation: false, destructive: [] });
  assert.deepEqual(deployOutcome({ success: true, url: 'u' }), { schema: null, jobs: null, needsConfirmation: false, destructive: [] });
  const o = deployOutcome({ success: true, url: 'u', schemaStatus: 'needs_confirmation', destructive: [...D, { kind: 'x', table: 'y' }] });
  assert.equal(o.needsConfirmation, true); assert.deepEqual(o.destructive, D);
  assert.equal(deployOutcome({ success: true, url: 'u', schemaStatus: 'applied', destructive: D }).destructive.length, 0, 'ignored unless needs_confirmation');
  assert.equal(deployOutcome(null as never).needsConfirmation, false);
});

test('deployBody adds allowDestructiveSchema only for an explicit confirmation', () => {
  assert.deepEqual(deployBody('u1', 'my-app'), { userId: 'u1', subdomain: 'my-app' });
  assert.deepEqual(deployBody('u1', 'my-app', false), { userId: 'u1', subdomain: 'my-app' });
  assert.deepEqual(deployBody('u1', 'my-app', true), { userId: 'u1', subdomain: 'my-app', allowDestructiveSchema: true });
});

test('planDestructive reads the dry-run answer and ignores anything that is not an ok plan', () => {
  assert.deepEqual(planDestructive({ hasSchema: true, existing: true, status: 'ok', statements: 2, destructive: D }), D);
  for (const p of [null, undefined, {}, { hasSchema: false }, { hasSchema: true, existing: false, status: 'ok', destructive: D }, { hasSchema: true, existing: true, status: 'invalid', destructive: D }]) assert.deepEqual(planDestructive(p), []);
});

// ---- copy: every locale carries every key with the same placeholders
const dir = new URL('../i18n/messages/', import.meta.url);
const load = (l: string) => JSON.parse(readFileSync(new URL(`${l}.json`, dir), 'utf8'));
const flat = (o: Record<string, unknown>, p = ''): Record<string, string> => Object.entries(o).reduce((a, [k, v]) => v && typeof v === 'object' ? { ...a, ...flat(v as Record<string, unknown>, `${p}${k}.`) } : { ...a, [`${p}${k}`]: String(v) }, {});
const vars = (s: string) => [...s.matchAll(/\{[^}]+\}/g)].map((m) => m[0]).sort();
const LOCALES = ['de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt', 'zh'];

test('every key the helpers can return exists in all 10 locales with the same placeholders', () => {
  const keys = new Set<string>([
    ...Object.values(SCHEMA_STATUS_KEYS), ...Object.values(JOBS_STATUS_KEYS), ...Object.values(DESTRUCTIVE_KIND_KEYS),
    'publish.schema.confirmTitle', 'publish.schema.confirmIntro', 'publish.schema.confirmTypeHint', 'publish.schema.confirmPlaceholder', 'publish.schema.confirmButton', 'publish.schema.cancel', 'publish.schema.checking',
    'publish.schema.statusHeading', 'publish.jobs.heading',
  ]);
  const en = flat(load('en'));
  for (const k of keys) assert.ok(en[k], `en ${k}`);
  for (const l of LOCALES) {
    const m = flat(load(l));
    for (const k of keys) { assert.ok(m[k], `${l} ${k}`); assert.deepEqual(vars(m[k]), vars(en[k]), `${l} ${k} placeholders`); }
  }
});
