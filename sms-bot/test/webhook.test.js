import { test } from 'node:test';
import assert from 'node:assert/strict';
import twilio from 'twilio';
import { harness, fakeBackend, TOKEN, BASE } from '../testlib/helpers.js';

const P = '+14255550101';

test('signature: missing, wrong and right', async () => {
  const h = await harness();
  const params = { MessageSid: 'SM1', AccountSid: 'ACtest00000000000000000000000000', From: P, To: '+15550001111', Body: 'HELP' };
  assert.equal((await h.post('/sms/inbound', params, { sign: false })).status, 403);
  assert.equal((await h.post('/sms/inbound', params, { token: 'wrong_token' })).status, 403);
  // signature for a different URL (e.g. a replay to another path) is rejected
  const other = twilio.getExpectedTwilioSignature(TOKEN, `${BASE}/whatsapp/inbound`, params);
  assert.equal((await h.post('/sms/inbound', params, { sign: false, headers: { 'X-Twilio-Signature': other } })).status, 403);
  // tampered body
  const sig = twilio.getExpectedTwilioSignature(TOKEN, `${BASE}/sms/inbound`, params);
  assert.equal((await h.post('/sms/inbound', { ...params, Body: 'STATUS' }, { sign: false, headers: { 'X-Twilio-Signature': sig } })).status, 403);
  assert.equal((await h.post('/sms/inbound', params)).status, 200);
  assert.equal(h.client.sent.length, 0, 'rejected requests never send anything');
  assert.equal(h.store.stats().rejected_bad_signature, 4);
  await h.close();
});

test('signature: fails closed without an auth token, and for a foreign account', async () => {
  const h = await harness({ env: { TWILIO_AUTH_TOKEN: '' } });
  const r = await h.post('/sms/inbound', { MessageSid: 'SM1', From: P, Body: 'HELP' }, { sign: false });
  assert.equal(r.status, 503);
  await h.close();
  const h2 = await harness();
  const r2 = await h2.say(P, 'HELP', { extra: { AccountSid: 'ACother0000000000000000000000000' } });
  assert.equal(r2.status, 403);
  await h2.close();
});

test('status callback is signed too and counts delivery errors', async () => {
  const h = await harness();
  const params = { MessageSid: 'SM9', MessageStatus: 'undelivered', ErrorCode: '30034' };
  assert.equal((await h.post('/twilio/status', params, { sign: false })).status, 403);
  assert.equal((await h.post('/twilio/status', params)).status, 204);
  assert.equal(h.store.stats().error_30034, 1);
  assert.equal(h.reports.length, 1);
  await h.close();
});

test('dedupe: a retried MessageSid is not answered or processed twice', async () => {
  const be = fakeBackend();
  const h = await harness({ backend: be });
  const a = await h.say(P, 'a todo app with dark mode', { sid: 'SMdup' });
  const b = await h.say(P, 'a todo app with dark mode', { sid: 'SMdup' });
  assert.ok(a.reply);
  assert.equal(b.reply, null);
  assert.equal(be.calls.lookup, 1);
  assert.equal(h.store.stats().duplicates, 1);
  await h.close();
});

test('reply text is XML-escaped (the help text contains an ampersand)', async () => {
  const h = await harness();
  const r = await h.say(P, 'HELP');
  assert.match(r.xml, /Msg&amp;data/);
  assert.match(r.reply, /Reply STOP to unsubscribe/);
  assert.match(r.reply, /support@vibebuild\.cc/);
  await h.close();
});

test('routes: a WhatsApp message on the SMS route is ignored; WhatsApp is off without a sender number', async () => {
  const h = await harness();
  const r = await h.post('/sms/inbound', { MessageSid: 'SMx', AccountSid: 'ACtest00000000000000000000000000', From: `whatsapp:${P}`, Body: 'HELP' });
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.text, /Message/);
  await h.close();
  const h2 = await harness({ env: { TWILIO_WHATSAPP_NUMBER: '' } });
  assert.equal((await h2.say(P, 'HELP', { channel: 'whatsapp' })).reply, null);
  await h2.close();
});

test('SMS from outside the allowed prefixes gets no reply (international SMS is not priced)', async () => {
  const h = await harness();
  assert.equal((await h.say('+447700900123', 'HELP')).reply, null);
  assert.equal(h.store.stats().blocked_prefix, 1);
  // WhatsApp has no prefix limit
  assert.ok((await h.say('+447700900123', 'HELP', { channel: 'whatsapp' })).reply);
  await h.close();
  const h2 = await harness({ env: { SMS_ALLOWED_PREFIXES: '*' } });
  assert.ok((await h2.say('+447700900123', 'HELP')).reply);
  await h2.close();
});

test('flood guard: one notice then silence past the per-minute limit', async () => {
  const h = await harness({ botConfig: { perPhonePerMin: 3 } });
  const out = [];
  for (let i = 0; i < 6; i++) out.push((await h.say(P, 'HELP')).reply);
  assert.ok(out[0] && out[1] && out[2]);
  assert.match(out[3], /wait a minute/);
  assert.equal(out[4], null);
  assert.equal(out[5], null);
  assert.equal((await h.say(P, 'STOP')).reply, null);
  assert.ok(h.store.peekUser(P).optOut.sms, 'STOP is honoured even while flood-limited');
  await h.close();
});
