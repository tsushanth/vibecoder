import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSystemStatus, STATUS_POLL_MS } from './systemStatus.ts';

test('operational: no banner', () => {
  assert.deepEqual(parseSystemStatus({ operational: true, message: null, activeBuildCount: 0 }), { down: false, message: null });
});

test('not operational: banner with the server message, trimmed', () => {
  assert.deepEqual(parseSystemStatus({ operational: false, message: "  We're at capacity right now.  " }), {
    down: true,
    message: "We're at capacity right now.",
  });
});

test('not operational without a usable message: banner with no message (the UI supplies a default)', () => {
  for (const message of [null, undefined, '', '   ', 42, {}]) {
    assert.deepEqual(parseSystemStatus({ operational: false, message }), { down: true, message: null });
  }
});

test('only an explicit operational:false counts as down; anything malformed shows nothing', () => {
  for (const raw of [null, undefined, 'down', 42, [], {}, { operational: 'false' }, { operational: 0 }, { message: 'hi' }]) {
    assert.deepEqual(parseSystemStatus(raw), { down: false, message: null }, JSON.stringify(raw));
  }
});

test('an over-long server message is cut so it cannot take over the screen', () => {
  const out = parseSystemStatus({ operational: false, message: 'x'.repeat(1000) });
  assert.ok(out.message && out.message.length <= 300);
});

test('polls about once a minute', () => {
  assert.equal(STATUS_POLL_MS, 60_000);
});
