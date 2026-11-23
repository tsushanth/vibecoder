// VibeBuild by text: SMS and WhatsApp through Twilio. Inbound only: we answer people who message us first.
// POST /sms/inbound and /whatsapp/inbound are Twilio webhooks (X-Twilio-Signature checked, fail closed).
import express from 'express';
import twilio from 'twilio';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { reportFailure, installCrashHandlers } from './failureReporter.js';
import { createStore } from './lib/store.js';
import { createBackend } from './lib/backend.js';
import { createBot, mask } from './lib/bot.js';

const E164 = /^\+\d{8,15}$/;
const EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response/>';

function makeSender(client, env, base, log) {
  const waFrom = env.TWILIO_WHATSAPP_NUMBER ? `whatsapp:${String(env.TWILIO_WHATSAPP_NUMBER).replace(/^whatsapp:/, '')}` : null;
  return async function send({ channel, to, body, contentSid, contentVariables }) {
    const params = { to: channel === 'whatsapp' ? `whatsapp:${to}` : to, statusCallback: `${base}/twilio/status` };
    if (channel === 'whatsapp') {
      if (!waFrom) return { ok: false };
      params.from = waFrom;
    } else if (env.TWILIO_MESSAGING_SERVICE_SID) params.messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;
    else if (env.TWILIO_PHONE_NUMBER) params.from = env.TWILIO_PHONE_NUMBER;
    else return { ok: false };
    if (contentSid) { params.contentSid = contentSid; if (contentVariables) params.contentVariables = JSON.stringify(contentVariables); } else params.body = body;
    try {
      const m = await client.messages.create(params);
      return { ok: true, sid: m?.sid };
    } catch (e) {
      log.error(`[${channel}] send to ${mask(to)} failed: code ${e?.code ?? 'n/a'}`);
      reportFailure('sms-bot:twilio_send_failed', new Error('Twilio message send failed'), { channel, code: String(e?.code ?? '').slice(0, 12) });
      return { ok: false, code: e?.code };
    }
  };
}

export function createApp({ env = process.env, store, backend, twilioClient, fetchImpl, now = () => Date.now(), sleep, log = console, report = reportFailure, botConfig = {} } = {}) {
  const authToken = env.TWILIO_AUTH_TOKEN;
  const base = String(env.PUBLIC_BASE_URL || 'https://vibebuild-sms-bot.fly.dev').replace(/\/+$/, '');
  const st = store || createStore({ dir: env.DATA_DIR || null, now, log });
  const be = backend || createBackend({ apiUrl: env.VIBEBUILD_API_URL || 'https://vibecoder-api.fly.dev', fetchImpl });
  const client = twilioClient || (env.TWILIO_ACCOUNT_SID && authToken ? twilio(env.TWILIO_ACCOUNT_SID, authToken) : null);
  const send = client ? makeSender(client, env, base, log) : async () => ({ ok: false });
  const prefixes = (env.SMS_ALLOWED_PREFIXES || '+1').split(',').map((s) => s.trim()).filter(Boolean);
  const bot = createBot({
    store: st, backend: be, send, now, sleep, log, report,
    config: { webUrl: env.WEB_URL || 'https://vibebuild.cc', smsAllowedPrefixes: prefixes, waTemplateDoneSid: env.WHATSAPP_TEMPLATE_DONE_SID || '', ...botConfig },
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));

  // Fail closed: without the auth token nothing is accepted; a missing or wrong signature is a 403.
  function twilioOnly(req, res, next) {
    if (!authToken) { st.bump('rejected_no_token'); return res.status(503).type('text/plain').send('not configured'); }
    const sig = req.get('X-Twilio-Signature');
    const ok = typeof sig === 'string' && sig.length > 0 && twilio.validateRequest(authToken, sig, `${base}${req.originalUrl}`, req.body || {});
    if (!ok) { st.bump('rejected_bad_signature'); return res.status(403).type('text/plain').send('forbidden'); }
    if (env.TWILIO_ACCOUNT_SID && req.body?.AccountSid && req.body.AccountSid !== env.TWILIO_ACCOUNT_SID) { st.bump('rejected_wrong_account'); return res.status(403).type('text/plain').send('forbidden'); }
    next();
  }

  const globalHits = [];
  const respond = (res, reply) => {
    res.type('text/xml');
    if (!reply) return res.send(EMPTY);
    const r = new twilio.twiml.MessagingResponse();
    r.message(reply); // escapes the text
    return res.send(r.toString());
  };

  const inbound = (route) => async (req, res) => {
    try {
      const from = String(req.body.From || '');
      const channel = from.startsWith('whatsapp:') ? 'whatsapp' : 'sms';
      if (channel !== route) { st.bump('rejected_wrong_route'); return respond(res, null); }
      const phone = from.replace(/^whatsapp:/, '');
      if (!E164.test(phone)) return respond(res, null);
      if (channel === 'whatsapp' && !env.TWILIO_WHATSAPP_NUMBER) return respond(res, null);

      const t0 = now();
      while (globalHits.length && t0 - globalHits[0] > 60_000) globalHits.shift();
      if (globalHits.length >= Number(env.GLOBAL_INBOUND_PER_MIN || 300)) { st.bump('global_rate_limited'); return respond(res, null); }
      globalHits.push(t0);

      if (st.seenBefore(req.body.MessageSid)) { st.bump('duplicates'); return respond(res, null); }

      log.log(`[${channel}] inbound from ${mask(phone)} (${String(req.body.Body || '').length} chars)`);
      const { reply } = await bot.handleInbound({ channel, phone, text: req.body.Body, numMedia: Number(req.body.NumMedia || 0) });
      return respond(res, reply);
    } catch (e) {
      log.error(`[inbound] ${e.message}`);
      report('sms-bot:inbound_handler_failed', new Error('inbound handler failed'), {});
      return respond(res, null);
    }
  };
  app.post('/sms/inbound', twilioOnly, inbound('sms'));
  app.post('/whatsapp/inbound', twilioOnly, inbound('whatsapp'));

  // Delivery receipts for the messages we send: counts failures by Twilio error code (30034 = number not registered for US A2P, 30032 = toll-free not verified).
  app.post('/twilio/status', twilioOnly, (req, res) => {
    const status = String(req.body.MessageStatus || req.body.SmsStatus || '').slice(0, 20);
    if (status) st.bump(`status_${status}`);
    const code = String(req.body.ErrorCode || '').slice(0, 8);
    if (code) { st.bump(`error_${code}`); if (['30034', '30032', '30007', '63016', '63018'].includes(code)) report('sms-bot:delivery_blocked', new Error(`delivery blocked ${code}`), { code }); }
    res.status(204).end();
  });

  app.get('/health', (_, res) => res.json({ healthy: true, uptime: process.uptime(), persistent: st.persistent, whatsapp: !!env.TWILIO_WHATSAPP_NUMBER, sms: !!(env.TWILIO_PHONE_NUMBER || env.TWILIO_MESSAGING_SERVICE_SID) }));
  app.get('/stats', (req, res) => {
    const want = env.STATS_TOKEN;
    const got = String(req.get('authorization') || '').replace(/^Bearer /, '');
    const h = (v) => crypto.createHash('sha256').update(v).digest();
    if (!want || !crypto.timingSafeEqual(h(got), h(want))) return res.status(404).end();
    res.json({ users: st.userCount(), activeBuilds: bot.activeBuilds, stats: st.stats() });
  });

  return { app, bot, store: st };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  installCrashHandlers();
  const { app, bot, store } = createApp();
  const PORT = process.env.PORT || 8080;
  const server = app.listen(PORT, () => {
    console.log(`VibeBuild messaging bot on port ${PORT} (state: ${store.persistent ? 'persistent volume' : 'MEMORY ONLY'})`);
    bot.resume();
  });
  const stop = () => { server.close(); store.flush().finally(() => process.exit(0)); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
