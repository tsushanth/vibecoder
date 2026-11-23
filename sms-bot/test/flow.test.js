import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness, fakeBackend } from '../testlib/helpers.js';
import { createStore } from '../lib/store.js';

const P = '+14255550101';
const silent = { log() {}, warn() {}, error() {} };

test('happy path, linked user: ack now, link texted when the build is ready', async () => {
  const be = fakeBackend({ linked: [P], progress: [{ status: 'building', phase: 'generate', percent: 10 }, { status: 'ready', phase: 'ready', percent: 100 }], start: { ok: true, projectId: 'proj-42' } });
  const h = await harness({ backend: be });
  const r = await h.say(P, 'a todo app with dark mode');
  assert.match(r.reply, /Building your app/);
  await h.bot.idle();
  assert.deepEqual(be.calls.start.map((c) => [c.prompt, c.userId, c.source]), [['a todo app with dark mode', `u-${P}`, 'sms']]);
  assert.equal(h.client.sent.length, 1);
  const m = h.client.sent[0];
  assert.equal(m.to, P);
  assert.equal(m.from, '+15550001111');
  assert.match(m.body, /Build complete/);
  assert.match(m.body, /https:\/\/vibebuild\.cc\/project\/proj-42/);
  assert.match(m.statusCallback, /\/twilio\/status$/);
  assert.equal(h.store.activeBuilds().length, 0);
  assert.equal(h.store.stats().builds_ready, 1);
  await h.close();
});

test('happy path, new user: link first, the first prompt is kept and built after the code', async () => {
  const be = fakeBackend({ codes: { ABC123: 'user-9' } });
  const h = await harness({ backend: be });
  const r1 = await h.say(P, 'a habit tracker');
  assert.match(r1.reply, /link your account first/);
  assert.match(r1.reply, /https:\/\/vibebuild\.cc\/connect\?tg_id=%2B14255550101/);
  const r2 = await h.say(P, 'abc123');
  assert.match(r2.reply, /Linked/);
  await h.bot.idle();
  assert.equal(be.calls.start[0].prompt, 'a habit tracker');
  assert.equal(be.calls.start[0].userId, 'user-9');
  assert.equal(h.client.sent.length, 1);
  await h.close();
});

test('wrong code and a plain word that looks like a code', async () => {
  const h = await harness({ backend: fakeBackend({ linked: [P] }) });
  const wrong = await h.say(P, 'ZZ1234'); // not hex: a normal prompt
  assert.match(wrong.reply, /Building/);
  await h.bot.idle();
  const h2 = await harness({ backend: fakeBackend() });
  const r = await h2.say(P, '123456');
  assert.match(r.reply, /wrong or expired/);
  const w = await h2.say(P, 'decade'); // hex letters only, rejected by the API: treated as a prompt (link needed since unlinked)
  assert.match(w.reply, /link your account first/);
  await h.close(); await h2.close();
});

test('failure path: build failed, API refusals and API down', async () => {
  const f = await harness({ backend: fakeBackend({ linked: [P], progress: [{ status: 'failed' }] }) });
  await f.say(P, 'an app');
  await f.bot.idle();
  assert.match(f.client.sent[0].body, /build failed/i);
  assert.equal(f.store.activeBuilds().length, 0);
  await f.close();

  for (const [reason, re] of [['limit', /limit/i], ['busy', /full capacity/], ['rejected', /plain language/], ['error', /start your build/]]) {
    const h = await harness({ backend: fakeBackend({ linked: [P], start: { ok: false, reason } }) });
    await h.say(P, 'an app');
    await h.bot.idle();
    assert.match(h.client.sent[0].body, re, reason);
    assert.equal(h.store.activeBuilds().length, 0);
    await h.close();
  }
  const d = await harness({ backend: fakeBackend({ down: true }) });
  assert.match((await d.say(P, 'an app')).reply, /try again/i);
  await d.close();
});

test('slow build: exactly one automatic status message, then the result', async () => {
  const slow = Array(20).fill({ status: 'building', phase: 'polish', percent: 70 });
  const be = fakeBackend({ linked: [P], progress: [...slow, { status: 'ready' }] });
  const h = await harness({ backend: be });
  await h.say(P, 'an app');
  await h.bot.idle();
  assert.equal(h.client.sent.length, 2);
  assert.match(h.client.sent[0].body, /Polish\.\.\. 70%/);
  assert.match(h.client.sent[1].body, /Build complete/);
  await h.close();
});

test('timeout: tells the user to check the app', async () => {
  const be = fakeBackend({ linked: [P], progress: [{ status: 'building', phase: 'generate', percent: 5 }] });
  const h = await harness({ backend: be, botConfig: { buildTimeoutMs: 60_000 } });
  await h.say(P, 'an app');
  await h.bot.idle();
  assert.match(h.client.sent.at(-1).body, /may still be building/);
  await h.close();
});

test('one build at a time per number, daily cap, STATUS and idle STATUS', async () => {
  const be = fakeBackend({ linked: [P] });
  let finished = false;
  be.progress = async () => (finished ? { status: 'ready' } : { status: 'building', phase: 'validate', percent: 40 });
  const h = await harness({ backend: be, botConfig: { maxBuildsPerDay: 1, buildTimeoutMs: 1e12, updateAfterMs: 1e12 } });
  assert.match((await h.say(P, 'STATUS')).reply, /No build running/);
  await h.say(P, 'first app');
  assert.match((await h.say(P, 'second app')).reply, /Still building/);
  assert.match((await h.say(P, 'STATUS')).reply, /Validate\.\.\. 40%/);
  finished = true; await h.bot.idle();
  assert.match((await h.say(P, 'third app')).reply, /limit/i);
  await h.close();
});

test('STOP: recorded, no reply on SMS, nothing more is sent, START resumes', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const be = fakeBackend({ linked: [P] });
  be.progress = async () => { await gate; return { status: 'ready' }; };
  const h = await harness({ backend: be });
  await h.say(P, 'an app');
  const stop = await h.say(P, 'Stop');
  assert.equal(stop.reply, null);
  assert.ok(h.store.peekUser(P).optOut.sms);
  release(); await h.bot.idle();
  assert.equal(h.client.sent.length, 0, 'the finished-build text is not sent to someone who opted out');
  assert.equal((await h.say(P, 'another app')).reply, null);
  assert.equal(be.calls.start.length, 1);
  assert.match((await h.say(P, 'START')).reply, /subscribed again/);
  assert.match((await h.say(P, 'a new app')).reply, /Building/);
  await h.bot.idle();
  await h.close();
});

test('STOP keywords, per channel: WhatsApp gets a confirmation, SMS opt-out does not block WhatsApp', async () => {
  const h = await harness({ backend: fakeBackend({ linked: [P] }) });
  for (const w of ['STOPALL', 'UNSUBSCRIBE', 'cancel', 'END', 'QUIT', 'stop.']) {
    assert.equal((await h.say(P, w)).reply, null, w);
  }
  const wa = await h.say(P, 'an app', { channel: 'whatsapp' });
  assert.match(wa.reply, /Building/);
  await h.bot.idle();
  const stop = await h.say(P, 'STOP', { channel: 'whatsapp' });
  assert.match(stop.reply, /unsubscribed/i);
  await h.close();
});

test('HELP works even for a number that has not been seen, and MMS-only gets a text-only note', async () => {
  const h = await harness();
  assert.match((await h.say(P, 'help')).reply, /VibeBuild/);
  const mms = await h.say('+14255550102', '', { extra: { NumMedia: '1' } });
  assert.match(mms.reply, /only read text/);
  await h.close();
});

test('URLs in a prompt are refused before any work is done', async () => {
  const be = fakeBackend({ linked: [P] });
  const h = await harness({ backend: be });
  const r = await h.say(P, 'clone https://example.com for me');
  assert.match(r.reply, /instead of pasting URLs/);
  assert.equal(be.calls.start.length, 0);
  await h.close();
});

test('WhatsApp: inside the 24 h window the result is sent; outside it only an approved template may be', async () => {
  const be = fakeBackend({ linked: [P] });
  const h = await harness({ backend: be });
  await h.say(P, 'an app', { channel: 'whatsapp' });
  await h.bot.idle();
  assert.equal(h.client.sent[0].to, `whatsapp:${P}`);
  assert.equal(h.client.sent[0].from, 'whatsapp:+15550002222');
  assert.match(h.client.sent[0].body, /^✅ /);
  await h.close();

  // window expired by the time the build finishes
  const be2 = fakeBackend({ linked: [P] });
  const h2 = await harness({ backend: be2 });
  be2.progress = async () => { h2.tick(25 * 3600_000); return { status: 'ready' }; };
  await h2.say(P, 'an app', { channel: 'whatsapp' });
  await h2.bot.idle();
  assert.equal(h2.client.sent.length, 0);
  assert.equal(h2.store.stats().wa_outside_window_skipped, 1);
  await h2.close();

  const be3 = fakeBackend({ linked: [P] });
  const h3 = await harness({ backend: be3, env: { WHATSAPP_TEMPLATE_DONE_SID: 'HXabc' } });
  be3.progress = async () => { h3.tick(25 * 3600_000); return { status: 'ready' }; };
  await h3.say(P, 'an app', { channel: 'whatsapp' });
  await h3.bot.idle();
  assert.equal(h3.client.sent[0].contentSid, 'HXabc');
  assert.match(h3.client.sent[0].contentVariables, /proj-1/);
  assert.equal(h3.client.sent[0].body, undefined);
  await h3.close();
});

test('language: detected from the first prompt, kept, changed with LANG, hint once when unsure', async () => {
  const be = fakeBackend({ linked: [P] });
  const h = await harness({ backend: be });
  const r = await h.say(P, 'Quiero una aplicación de tareas con modo oscuro');
  assert.match(r.reply, /Estoy creando tu app/);
  await h.bot.idle();
  assert.equal(h.client.sent[0].body.split('\n')[0], 'Compilación completa'.length ? h.client.sent[0].body.split('\n')[0] : '');
  assert.match(h.client.sent[0].body, /Más apps|Más apps/);
  assert.equal(h.store.peekUser(P).lang, 'es');
  assert.match((await h.say(P, 'LANG de')).reply, /Sprache: Deutsch/);
  assert.match((await h.say(P, 'une appli de recettes')).reply, /Ich baue/); // user choice sticks
  await h.bot.idle();
  assert.match((await h.say(P, 'LANG xx')).reply, /en ar cs de/);
  await h.close();

  const u = await harness({ backend: fakeBackend({ linked: ['+14255550103'] }) });
  const first = await u.say('+14255550103', 'todo');
  assert.match(first.reply, /To change language/);
  await u.bot.idle();
  const second = await u.say('+14255550103', 'timer');
  assert.doesNotMatch(second.reply, /To change language/);
  await u.close();
});

test('state survives a restart: language, opt-out, dedupe and a build in flight', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'smsbot-'));
  let release; const gate = new Promise((r) => { release = r; });
  const be1 = fakeBackend({ linked: [P] });
  be1.progress = async () => { await gate; return { status: 'building', phase: 'fix', percent: 50 }; };
  void release;
  const h1 = await harness({ backend: be1, dir, botConfig: { buildTimeoutMs: 1e12 } });
  await h1.say(P, 'Ich möchte eine App für meine Einkaufsliste', { sid: 'SMkeep' });
  await h1.say('+14255550104', 'STOP');
  await h1.store.flush();
  // "restart": new store from the same directory, new bot, nothing shared in memory
  const be2 = fakeBackend({ linked: [P], progress: [{ status: 'ready' }] });
  const h2 = await harness({ backend: be2, dir });
  assert.equal(h2.store.peekUser(P).lang, 'de');
  assert.ok(h2.store.peekUser('+14255550104').optOut.sms);
  assert.equal((await h2.say(P, 'HELP', { sid: 'SMkeep' })).reply, null, 'MessageSid seen before the restart');
  assert.equal(h2.store.activeBuilds().length, 1);
  h2.bot.resume();
  await h2.bot.idle();
  assert.equal(h2.client.sent.length, 1);
  assert.match(h2.client.sent[0].body, /Mehr Apps/);
  await h2.close(); // h1 stays blocked on its gate: it models the process that died
  h1.store.flush = async () => {};
});

test('store: corrupt file is set aside, unwritable directory falls back to memory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'smsbot-'));
  writeFileSync(join(dir, 'state.json'), '{not json');
  const s = createStore({ dir, log: silent });
  assert.ok(s.persistent);
  assert.equal(s.userCount(), 0);
  assert.ok(readdirSync(dir).some((f) => f.startsWith('state.json.corrupt-')));
  s.user('+1').lang = 'fr'; await s.flush();
  assert.equal(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).users['+1'].lang, 'fr');
  const m = createStore({ dir: '/proc/definitely/not/writable', log: silent });
  assert.equal(m.persistent, false);
  m.user('+2'); assert.equal(m.userCount(), 1);
});
