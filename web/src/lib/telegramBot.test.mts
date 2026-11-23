import test from 'node:test';
import assert from 'node:assert/strict';
import { telegramBotUrl, trackTelegram, TELEGRAM_CLICK_EVENT, TELEGRAM_VIEW_EVENT } from './telegramBot.ts';

test('the start payload names the surface', () => {
  assert.equal(telegramBotUrl('web_home'), 'https://t.me/Vibebuilder_bot?start=web_home');
  assert.equal(telegramBotUrl('web_connect'), 'https://t.me/Vibebuilder_bot?start=web_connect');
});

test('trackTelegram sends the event name and only the surface prop', () => {
  const calls: unknown[][] = [];
  assert.equal(trackTelegram(TELEGRAM_CLICK_EVENT, 'web_home', (...a) => { calls.push(a); }), true);
  assert.equal(trackTelegram(TELEGRAM_VIEW_EVENT, 'web_connect', (...a) => { calls.push(a); }), true);
  assert.deepEqual(calls, [['Telegram Click', { props: { surface: 'web_home' } }], ['Telegram Section View', { props: { surface: 'web_connect' } }]]);
});

test('trackTelegram never throws: no counter loaded, or a counter that throws', () => {
  assert.equal(trackTelegram(TELEGRAM_CLICK_EVENT, 'web_home', null), false);
  assert.equal(trackTelegram(TELEGRAM_CLICK_EVENT, 'web_home'), false); // no window in node
  assert.equal(trackTelegram(TELEGRAM_CLICK_EVENT, 'web_home', () => { throw new Error('blocked'); }), false);
});
