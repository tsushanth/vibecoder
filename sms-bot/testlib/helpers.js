import twilio from 'twilio';
import { createApp } from '../server.js';
import { createStore } from '../lib/store.js';

export const TOKEN = 'test_auth_token_000000000000000000';
export const SID = 'ACtest00000000000000000000000000';
export const BASE = 'https://bot.test';
const silent = { log() {}, warn() {}, error() {} };

/** Fake Twilio REST client: records every message the bot sends. */
export function fakeTwilio() {
  const sent = [];
  return { sent, messages: { create: async (p) => { sent.push(p); return { sid: `SM${sent.length}` }; } } };
}

/**
 * Fake VibeBuild API. `progress` is a list of results returned in order (the last one repeats).
 * linked: Set of phones that are linked. codes: { CODE: userId }.
 */
export function fakeBackend({ linked = [], codes = {}, progress = [{ status: 'ready', phase: 'ready', percent: 100 }], start = { ok: true, projectId: 'proj-1' }, down = false } = {}) {
  const calls = { lookup: 0, verify: 0, start: [], progress: 0 };
  const linkedSet = new Set(linked);
  return {
    calls, linkedSet,
    async lookupUser(phone) { calls.lookup++; if (down) { const { BackendUnavailable } = await import('../lib/backend.js'); throw new BackendUnavailable('down'); } return linkedSet.has(phone) ? { linked: true, userId: `u-${phone}`, displayName: 'Sam' } : { linked: false }; },
    async verifyCode(code, phone) { calls.verify++; if (codes[code]) { linkedSet.add(phone); return { ok: true, userId: codes[code], displayName: 'Sam' }; } return { ok: false, reason: 'invalid' }; },
    async startBuild(a) { calls.start.push(a); return typeof start === 'function' ? start(a) : start; },
    async progress() { const i = Math.min(calls.progress++, progress.length - 1); return progress[i]; },
  };
}

export async function harness({ env = {}, backend = fakeBackend(), dir = null, botConfig = {}, nowFn } = {}) {
  let clock = 1_800_000_000_000;
  const now = nowFn || (() => clock);
  const client = fakeTwilio();
  const reports = [];
  const store = createStore({ dir, now, saveDelayMs: 1, log: silent });
  const fullEnv = { TWILIO_AUTH_TOKEN: TOKEN, TWILIO_ACCOUNT_SID: SID, TWILIO_PHONE_NUMBER: '+15550001111', TWILIO_WHATSAPP_NUMBER: 'whatsapp:+15550002222', PUBLIC_BASE_URL: BASE, ...env };
  const sleep = () => new Promise((r) => setImmediate(() => { clock += 6000; r(); })); // fake time, but yield to the event loop
  const { app, bot } = createApp({ env: fullEnv, store, backend, twilioClient: client, now, sleep, log: silent, report: (f, e, c) => reports.push({ f, c }), botConfig: { pollMs: 6000, ...botConfig } });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const port = server.address().port;
  let n = 0;
  const post = async (path, params, { sign = true, token = TOKEN, headers = {} } = {}) => {
    const body = new URLSearchParams(params).toString();
    const h = { 'Content-Type': 'application/x-www-form-urlencoded', ...headers };
    if (sign) h['X-Twilio-Signature'] = twilio.getExpectedTwilioSignature(token, `${BASE}${path}`, params);
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: h, body });
    return { status: res.status, text: await res.text() };
  };
  /** Sends an inbound SMS/WhatsApp message through the signed webhook and returns the TwiML reply text (or null). */
  const say = async (from, text, { channel = 'sms', sid, extra = {} } = {}) => {
    const path = channel === 'sms' ? '/sms/inbound' : '/whatsapp/inbound';
    const r = await post(path, { MessageSid: sid || `SMin${++n}`, AccountSid: SID, From: channel === 'sms' ? from : `whatsapp:${from}`, To: '+15550001111', Body: text, NumMedia: '0', ...extra });
    const m = /<Message>([\s\S]*?)<\/Message>/.exec(r.text);
    return { status: r.status, xml: r.text, reply: m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'") : null };
  };
  return { app, bot, store, client, reports, post, say, backend, tick: (ms) => { clock += ms; }, close: () => new Promise((r) => server.close(r)), get clock() { return clock; } };
}
