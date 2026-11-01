import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_FREE, effectiveTier } from './pricing.ts';
import { afterWelcome } from '../components/welcome/onboarding.ts';

test('all-free is the default when the env switch is unset', () => {
  assert.equal(process.env.NEXT_PUBLIC_VIBEBUILD_ALL_FREE, undefined);
  assert.equal(ALL_FREE, true);
});

test('effectiveTier: everyone counts as pro while all-free, stored tier otherwise', () => {
  assert.equal(effectiveTier('free', true), 'pro');
  assert.equal(effectiveTier(undefined, true), 'pro');
  assert.equal(effectiveTier('free', false), 'free');
  assert.equal(effectiveTier(undefined, false), 'free');
  assert.equal(effectiveTier('team', false), 'team');
});

test('afterWelcome: straight to Create while all-free, paywall only when plans are on', () => {
  assert.equal(afterWelcome('free', true), '/project/new');
  assert.equal(afterWelcome(undefined, true), '/project/new');
  assert.equal(afterWelcome('free', false), '/upgrade');
  assert.equal(afterWelcome('pro', false), '/project/new');
});
