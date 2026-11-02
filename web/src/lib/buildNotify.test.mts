import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationState, shouldFireNotification, flaggedTitle, unflaggedTitle } from './buildNotify.ts';

test('notificationState: unsupported without the API, otherwise the browser permission', () => {
  assert.equal(notificationState(undefined), 'unsupported');
  assert.equal(notificationState({}), 'unsupported');
  assert.equal(notificationState({ Notification: { permission: 'default' } }), 'default');
  assert.equal(notificationState({ Notification: { permission: 'granted' } }), 'granted');
  assert.equal(notificationState({ Notification: { permission: 'denied' } }), 'denied');
  assert.equal(notificationState({ Notification: { permission: 'weird' } }), 'unsupported');
});

test('shouldFireNotification: only when opted in, permitted, and the tab is out of sight', () => {
  assert.equal(shouldFireNotification({ armed: true, permission: 'granted', hidden: true }), true);
  assert.equal(shouldFireNotification({ armed: false, permission: 'granted', hidden: true }), false);
  assert.equal(shouldFireNotification({ armed: true, permission: 'denied', hidden: true }), false);
  assert.equal(shouldFireNotification({ armed: true, permission: 'default', hidden: true }), false);
  assert.equal(shouldFireNotification({ armed: true, permission: 'unsupported', hidden: true }), false);
  assert.equal(shouldFireNotification({ armed: true, permission: 'granted', hidden: false }), false);
});

test('flaggedTitle prefixes the tab title once and unflaggedTitle restores it', () => {
  assert.equal(flaggedTitle('VibeBuild', 'App ready'), '(App ready) VibeBuild');
  assert.equal(flaggedTitle('(App ready) VibeBuild', 'App ready'), '(App ready) VibeBuild');
  assert.equal(unflaggedTitle('(App ready) VibeBuild', 'App ready'), 'VibeBuild');
  assert.equal(unflaggedTitle('VibeBuild', 'App ready'), 'VibeBuild');
});
