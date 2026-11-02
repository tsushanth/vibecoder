import test from 'node:test';
import assert from 'node:assert/strict';
import { pickServerProjectId, planSaveAfterBuild } from './buildSave.ts';

test('pickServerProjectId prefers the id on the result event over the queued id', () => {
  assert.equal(pickServerProjectId('res-1', 'q-1'), 'res-1');
});

test('pickServerProjectId falls back to the queued id when the result has none', () => {
  assert.equal(pickServerProjectId(undefined, 'q-1'), 'q-1');
  assert.equal(pickServerProjectId(null, 'q-1'), 'q-1');
  assert.equal(pickServerProjectId('', 'q-1'), 'q-1');
});

test('pickServerProjectId ignores non-string and blank ids', () => {
  assert.equal(pickServerProjectId(42, '  '), null);
  assert.equal(pickServerProjectId({}, undefined), null);
  assert.equal(pickServerProjectId(undefined, undefined), null);
});

test('planSaveAfterBuild: the server already saved the build, so the client must not POST /save', () => {
  assert.deepEqual(planSaveAfterBuild({ resultProjectId: 'res-1', queuedProjectId: 'q-1' }), { kind: 'server', projectId: 'res-1' });
  assert.deepEqual(planSaveAfterBuild({ queuedProjectId: 'q-1' }), { kind: 'server', projectId: 'q-1' });
});

test('planSaveAfterBuild: no id came back, so the client falls back to POST /save', () => {
  assert.deepEqual(planSaveAfterBuild({}), { kind: 'client-save' });
  assert.deepEqual(planSaveAfterBuild({ resultProjectId: null, queuedProjectId: null }), { kind: 'client-save' });
});
