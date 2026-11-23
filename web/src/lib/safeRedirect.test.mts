import test from 'node:test';
import assert from 'node:assert/strict';
import { safeRedirect } from './safeRedirect.ts';

test('same-site paths are followed, with their query', () => {
  assert.equal(safeRedirect('/connect?tg_id=123&src=tg'), '/connect?tg_id=123&src=tg');
  assert.equal(safeRedirect('/dashboard'), '/dashboard');
});
test('anything that could leave the site is refused', () => {
  for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', '', null, undefined, '/x\n/y', '/a b', '/' + 'a'.repeat(400), 'connect']) {
    assert.equal(safeRedirect(bad as string), null, String(bad));
  }
});
