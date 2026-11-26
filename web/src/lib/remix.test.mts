import test from 'node:test';
import assert from 'node:assert/strict';
import { canRemix } from './remix.ts';

test('remix is offered on other apps and to visitors, never on your own app', () => {
  assert.equal(canRemix('someone', 'me'), true);
  assert.equal(canRemix('someone', null), true);
  assert.equal(canRemix('someone', undefined), true);
  assert.equal(canRemix(undefined, 'me'), true);
  assert.equal(canRemix('me', 'me'), false);
});
