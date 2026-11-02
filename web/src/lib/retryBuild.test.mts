import test from 'node:test';
import assert from 'node:assert/strict';
import { canRetry, withStatus, retryErrorKey } from './retryBuild.ts';

test('canRetry: only failed apps that kept their prompt', () => {
  assert.equal(canRetry({ id: 'a', status: 'failed', initial_prompt: 'a todo app' }), true);
  assert.equal(canRetry({ id: 'a', status: 'failed', initial_prompt: '   ' }), false);
  assert.equal(canRetry({ id: 'a', status: 'failed', initial_prompt: null }), false);
  assert.equal(canRetry({ id: 'a', status: 'failed' }), false);
  for (const status of ['building', 'pending', 'ready', null, undefined]) {
    assert.equal(canRetry({ id: 'a', status, initial_prompt: 'x' }), false, String(status));
  }
});

test('withStatus changes only the matching app and does not mutate the list', () => {
  const list = [
    { id: 'a', status: 'failed' },
    { id: 'b', status: 'failed' },
  ];
  const next = withStatus(list, 'a', 'building');
  assert.deepEqual(next, [
    { id: 'a', status: 'building' },
    { id: 'b', status: 'failed' },
  ]);
  assert.equal(list[0].status, 'failed');
  assert.equal(next[1], list[1]);
  assert.deepEqual(withStatus(list, 'zzz', 'building'), list);
});

test('retryErrorKey maps the backend refusals to a message', () => {
  assert.equal(retryErrorKey(400, 'Project is not in failed state'), 'notFailed');
  assert.equal(retryErrorKey(400, 'No prompt to retry'), 'noPrompt');
  assert.equal(retryErrorKey(403, 'Forbidden'), 'failed');
  assert.equal(retryErrorKey(500, 'Failed to retry project'), 'failed');
  assert.equal(retryErrorKey(undefined, undefined), 'failed');
});
