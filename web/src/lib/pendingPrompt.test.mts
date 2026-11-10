import test from 'node:test';
import assert from 'node:assert/strict';
import { savePendingPrompt, peekPendingPrompt, takePendingPrompt, clearPendingPrompt, PENDING_PROMPT_KEY, PENDING_PROMPT_TTL_MS, PENDING_PROMPT_MAX } from './pendingPrompt.ts';
import { shouldAskForPlan, SHORT_PROMPT_MAX_CHARS } from './planPolicy.ts';

function store(opts: { throws?: boolean } = {}) {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => { if (opts.throws) throw new Error('blocked'); return m.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (opts.throws) throw new Error('blocked'); m.set(k, v); },
    removeItem: (k: string) => { if (opts.throws) throw new Error('blocked'); m.delete(k); },
  };
}

test('a saved prompt is read back once and then gone from both stores', () => {
  const stores = { session: store(), local: store() };
  savePendingPrompt('  A pomodoro timer  ', stores, 1000);
  assert.equal(peekPendingPrompt(stores, 2000), 'A pomodoro timer');
  assert.equal(takePendingPrompt(stores, 2000), 'A pomodoro timer');
  assert.equal(takePendingPrompt(stores, 2000), null);
  assert.equal(stores.session.m.size + stores.local.m.size, 0);
});

test('it survives a new tab: the localStorage copy is used when sessionStorage is empty', () => {
  const stores = { session: store(), local: store() };
  savePendingPrompt('A budget planner', stores, 1000);
  stores.session.m.clear();
  assert.equal(takePendingPrompt(stores, 1000 + 60_000), 'A budget planner');
});

test('a copy older than 24 hours is ignored', () => {
  const stores = { session: store(), local: store() };
  savePendingPrompt('Old idea', stores, 1000);
  stores.session.m.clear();
  assert.equal(peekPendingPrompt(stores, 1000 + PENDING_PROMPT_TTL_MS + 1), null);
  assert.equal(peekPendingPrompt(stores, 1000 + PENDING_PROMPT_TTL_MS - 1), 'Old idea');
});

test('a blank prompt clears the stored one; a long one is cut to the build limit', () => {
  const stores = { session: store(), local: store() };
  savePendingPrompt('keep me', stores, 1);
  savePendingPrompt('   ', stores, 2);
  assert.equal(peekPendingPrompt(stores, 3), null);
  savePendingPrompt('x'.repeat(PENDING_PROMPT_MAX + 500), stores, 4);
  assert.equal(peekPendingPrompt(stores, 5)?.length, PENDING_PROMPT_MAX);
});

test('blocked, full or corrupt storage never throws', () => {
  const blocked = { session: store({ throws: true }), local: store({ throws: true }) };
  assert.doesNotThrow(() => savePendingPrompt('x', blocked));
  assert.equal(peekPendingPrompt(blocked), null);
  assert.doesNotThrow(() => clearPendingPrompt(blocked));
  assert.equal(takePendingPrompt({ session: null, local: null }), null);
  const bad = { session: store(), local: store() };
  bad.local.m.set(PENDING_PROMPT_KEY, '{not json');
  assert.equal(peekPendingPrompt(bad), null);
  bad.local.m.set(PENDING_PROMPT_KEY, JSON.stringify({ t: 'x', p: 5 }));
  assert.equal(peekPendingPrompt(bad), null);
});

test('plan step: skipped for a short prompt, kept for a long one or a reference image', () => {
  assert.equal(shouldAskForPlan('A pomodoro timer with a task list', false), false);
  assert.equal(shouldAskForPlan('a'.repeat(SHORT_PROMPT_MAX_CHARS), false), false);
  assert.equal(shouldAskForPlan('a'.repeat(SHORT_PROMPT_MAX_CHARS + 1), false), true);
  assert.equal(shouldAskForPlan('  ' + 'a'.repeat(SHORT_PROMPT_MAX_CHARS) + '  ', false), false);
  assert.equal(shouldAskForPlan('short', true), true);
});
