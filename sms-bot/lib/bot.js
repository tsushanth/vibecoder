// Conversation logic, independent of Twilio and Express: give it an inbound message, it returns the immediate reply and
// runs the build in the background. Everything it needs (store, backend client, message sender, clock) is passed in.
import crypto from 'node:crypto';
import { BackendUnavailable } from './backend.js';
import { t, detectLanguage, normalizeLangCode, LANG_NAMES, LANG_CODES_HINT } from './lang.js';

const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT']);
const START_WORDS = new Set(['START', 'UNSTOP', 'YES']);
const MAX_PROMPT = 1990;                  // the API rejects prompts over 2000 characters
const PENDING_TTL = 60 * 60 * 1000;       // a prompt sent before linking is kept for an hour
const PROFILE_TTL = 10 * 60 * 1000;
const CHECK = '✅ ';

export const DEFAULTS = {
  webUrl: 'https://vibebuild.cc',
  pollMs: 6000,
  updateAfterMs: 90_000,                  // one automatic "still working" message, only if a build is slow
  buildTimeoutMs: 15 * 60_000,
  maxBuildsPerDay: 5,                     // per phone number per UTC day (the API has its own hourly and fair-use caps)
  maxActiveBuilds: 8,                     // across all numbers
  perPhonePerMin: 8,
  smsAllowedPrefixes: ['+1'],             // US/Canada only by default: international SMS is priced and filtered per country
};

export const mask = (p) => String(p).replace(/^(\+\d{1,3})\d+(\d{2})$/, '$1***$2');

export function createBot({ store, backend, send, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), config = {}, log = console, report = () => {} } = {}) {
  const cfg = { ...DEFAULTS, ...config };
  const profiles = new Map();             // phone -> { userId, displayName, exp }
  const hits = new Map();                 // phone -> recent inbound timestamps
  const running = new Set();              // promises of build loops, for tests and shutdown
  let activeCount = 0;                    // builds with a running loop (resume() starts the stored ones)

  const L = (u) => u.lang || 'en';
  const channelOk = (phone, channel) => channel !== 'sms' || cfg.smsAllowedPrefixes.includes('*') || cfg.smsAllowedPrefixes.some((p) => phone.startsWith(p));

  // ---------- outbound (async messages) ----------
  async function notify(phone, channel, body, { kind = 'update', templateVars } = {}) {
    const u = store.user(phone);
    if (u.optOut?.[channel]) { store.bump('skipped_opted_out'); return false; }
    if (channel === 'whatsapp' && !store.inSession(phone, 'whatsapp')) {
      // Outside the 24-hour customer-service window only an approved template may be sent.
      if (!(kind === 'done' && cfg.waTemplateDoneSid)) { store.bump('wa_outside_window_skipped'); log.warn(`[wa] ${mask(phone)} outside 24h window, no template configured: not sent`); return false; }
      const r = await send({ channel, to: phone, contentSid: cfg.waTemplateDoneSid, contentVariables: templateVars });
      store.bump(r.ok ? 'sent_template' : 'send_failed');
      return r.ok;
    }
    const r = await send({ channel, to: phone, body: channel === 'whatsapp' && kind === 'done' ? CHECK + body : body });
    store.bump(r.ok ? `sent_${channel}` : 'send_failed');
    return r.ok;
  }

  // ---------- build loop ----------
  async function runBuild(b) {
    activeCount++;
    try {
      const u = store.user(b.phone);
      if (!b.projectId) {
        const started = await backend.startBuild({ prompt: b.prompt, userId: b.userId, source: b.channel });
        if (!started.ok) {
          store.removeBuild(b.id); store.bump('builds_not_started');
          const key = { rejected: 'err_prompt_no_code', limit: 'generation_limit_reached', busy: 'create_busy_body_free' }[started.reason] || 'err_build_start';
          if (started.reason === 'error') report('sms-bot:build_start_failed', new Error('build start failed'), { channel: b.channel });
          await notify(b.phone, b.channel, t(L(u), key, {}, { sms: b.channel === 'sms' }));
          return;
        }
        b.projectId = started.projectId; b.prompt = ''; // the prompt text is not kept once the build is accepted
        store.putBuild(b); store.countBuild(b.phone); store.bump('builds_started');
      }
      let missing = 0;
      for (;;) {
        await sleep(cfg.pollMs);
        const elapsed = now() - b.startedAt;
        const p = await backend.progress(b.projectId, b.userId);
        const lang = L(store.user(b.phone));
        const sms = b.channel === 'sms';
        if (p.status === 'ready') {
          store.removeBuild(b.id); store.bump('builds_ready');
          const url = `${cfg.webUrl}/project/${b.projectId}`;
          await notify(b.phone, b.channel, `${t(lang, 'build_chat_stage_complete', {}, { sms })}\n${url}\n${t(lang, 'done_more', {}, { sms })}`, { kind: 'done', templateVars: { 1: url } });
          return;
        }
        if (p.status === 'failed') {
          store.removeBuild(b.id); store.bump('builds_failed');
          await notify(b.phone, b.channel, t(lang, 'err_build_failed', {}, { sms }));
          return;
        }
        missing = p.status === 'missing' ? missing + 1 : 0;
        if (missing >= 3) {
          store.removeBuild(b.id); store.bump('builds_failed');
          await notify(b.phone, b.channel, t(lang, 'err_build_failed', {}, { sms }));
          return;
        }
        if (elapsed > cfg.buildTimeoutMs) {
          store.removeBuild(b.id); store.bump('builds_timed_out');
          await notify(b.phone, b.channel, t(lang, 'err_build_maybe_running', {}, { sms }));
          return;
        }
        if (!b.updateSent && elapsed > cfg.updateAfterMs && p.status === 'building') {
          b.updateSent = true; store.putBuild(b);
          await notify(b.phone, b.channel, statusText(lang, p, sms));
        }
      }
    } catch (e) {
      log.error(`[build] loop crashed: ${e.message}`);
      report('sms-bot:build_loop_crashed', new Error('build loop crashed'), {});
      store.removeBuild(b.id);
    } finally {
      activeCount--;
    }
  }
  const track = (p) => { running.add(p); p.finally(() => running.delete(p)); return p; };

  function statusText(lang, p, sms) {
    const phaseKey = { generate: 'build_phase_generate', validate: 'build_phase_validate', fix: 'build_phase_fix', polish: 'build_phase_polish', verify: 'build_phase_verify' }[p?.phase];
    const stage = t(lang, phaseKey || 'build_chat_stage_building', {}, { sms });
    return t(lang, 'status', { stage, pct: Math.min(99, Math.max(0, Math.round(p?.percent || 0))) }, { sms });
  }

  function beginBuild(phone, channel, prompt, userId) {
    const b = { id: crypto.randomUUID(), phone, channel, userId, prompt, projectId: null, startedAt: now(), updateSent: false };
    store.putBuild(b);
    return track(runBuild(b));
  }

  async function profileFor(phone) {
    const hit = profiles.get(phone);
    if (hit && hit.exp > now()) return hit;
    const r = await backend.lookupUser(phone);
    if (!r.linked) { profiles.delete(phone); return null; }
    const p = { userId: r.userId, displayName: r.displayName, exp: now() + PROFILE_TTL };
    profiles.set(phone, p);
    return p;
  }

  // ---------- inbound ----------
  /** -> { reply: string | null, background?: Promise }. reply is sent as the TwiML response. */
  async function handleInbound({ channel, phone, text, numMedia = 0 }) {
    const t0 = now();
    store.bump(`inbound_${channel}`);
    if (!channelOk(phone, channel)) { store.bump('blocked_prefix'); return { reply: null }; }
    const u = store.user(phone);
    u.lastInbound[channel] = t0; store.save();

    // per-number flood guard: past the limit, one notice per minute, then silence
    const recent = (hits.get(phone) || []).filter((x) => t0 - x < 60_000);
    recent.push(t0); hits.set(phone, recent);
    const isStop = STOP_WORDS.has(String(text || '').trim().toUpperCase().replace(/[.!\s]+$/g, '')); // an opt-out is always honoured
    if (recent.length > cfg.perPhonePerMin && !isStop) {
      if (recent.length === cfg.perPhonePerMin + 1 && !u.optOut?.[channel]) return { reply: t(L(u), 'too_fast', {}, { sms: channel === 'sms' }) };
      store.bump('rate_limited'); return { reply: null };
    }

    const sms = channel === 'sms';
    const say = (key, vars) => t(L(u), key, vars, { sms });
    const clean = String(text || '').trim();
    if (!clean) return { reply: numMedia > 0 ? say('text_only') : null };

    const word = clean.toUpperCase().replace(/[.!\s]+$/g, '');
    if (STOP_WORDS.has(word)) {
      u.optOut[channel] = t0; delete u.pending; store.save(); store.bump('opt_outs');
      return { reply: channel === 'whatsapp' ? say('unsubscribed') : null }; // on SMS the carrier-side stop and its confirmation are handled by Twilio
    }
    if (u.optOut?.[channel]) {
      if (START_WORDS.has(word)) { delete u.optOut[channel]; store.save(); store.bump('opt_ins'); return { reply: say('start_again') }; }
      store.bump('ignored_opted_out'); return { reply: null };
    }
    if (word === 'START' || word === 'UNSTOP') return { reply: say('start_again') };
    if (word === 'HELP' || word === 'INFO') return { reply: say('help') };
    if (word === 'STATUS') {
      const b = store.activeBuildFor(phone, channel);
      if (!b) return { reply: say('idle') };
      if (!b.projectId) return { reply: say('ack') };
      const p = await backend.progress(b.projectId, b.userId);
      return { reply: statusText(L(u), p, sms) };
    }
    const lm = /^(?:LANG|LANGUAGE)\s+([A-Za-z_-]{2,7})$/i.exec(clean);
    if (lm) {
      const code = normalizeLangCode(lm[1]);
      if (!code) return { reply: `${say('lang_hint')}\n${LANG_CODES_HINT}` };
      u.lang = code; u.langSource = 'user'; u.hintShown = true; store.save();
      return { reply: t(code, 'lang_set', { name: LANG_NAMES[code] }, { sms }) };
    }

    // account link code (6 hex characters), also how a pending first prompt gets released
    if (/^[A-Fa-f0-9]{6}$/.test(clean)) {
      try {
        const r = await backend.verifyCode(clean.toUpperCase(), phone);
        if (r.ok) {
          profiles.set(phone, { userId: r.userId, displayName: r.displayName, exp: now() + PROFILE_TTL });
          store.bump('links_ok');
          const pend = u.pending && t0 - u.pending.at < PENDING_TTL ? u.pending.text : null;
          delete u.pending; store.save();
          if (pend) return { reply: say('linked_start'), background: beginBuild(phone, channel, pend, r.userId) };
          return { reply: say('linked_ok') };
        }
        if (r.reason === 'rate_limited') return { reply: say('try_again') };
        if (/^[A-Fa-f]+$/.test(clean)) { /* a plain word such as "decade": treat it as a prompt below */ }
        else return { reply: say('code_invalid', { url: connectUrl(phone) }) };
      } catch (e) {
        if (e instanceof BackendUnavailable) return { reply: say('try_again') };
        throw e;
      }
    }

    // a build request
    if (/https?:\/\/\S+|\bwww\./i.test(clean)) return { reply: say('err_prompt_no_urls') };
    if (store.activeBuildFor(phone, channel)) return { reply: say('still_building') };
    if (store.buildsToday(phone) >= cfg.maxBuildsPerDay) return { reply: say('generation_limit_reached') };
    if (activeCount >= cfg.maxActiveBuilds) return { reply: say('create_busy_body_free') };

    if (u.langSource !== 'user' && u.langSource !== 'auto-high') {
      const d = detectLanguage(clean);
      u.lang = d.lang; u.langSource = d.confidence === 'high' ? 'auto-high' : 'auto-low'; store.save();
    }
    const hint = u.langSource === 'auto-low' && !u.hintShown ? (u.hintShown = true, store.save(), `\n${say('lang_hint')}`) : '';

    let profile;
    try { profile = await profileFor(phone); } catch (e) {
      if (e instanceof BackendUnavailable) return { reply: say('try_again') };
      throw e;
    }
    const prompt = clean.slice(0, MAX_PROMPT);
    if (!profile) {
      u.pending = { text: prompt, at: t0 }; store.save();
      return { reply: say('link_needed', { url: connectUrl(phone) }) + hint };
    }
    return { reply: say('ack') + hint, background: beginBuild(phone, channel, prompt, profile.userId) };
  }

  const connectUrl = (phone) => `${cfg.webUrl}/connect?tg_id=${encodeURIComponent(phone)}`;

  /** After a restart: pick up builds that were running and keep polling them. */
  function resume() {
    for (const b of store.activeBuilds()) track(runBuild(b));
  }
  async function idle() { while (running.size) await Promise.allSettled([...running]); }

  return { handleInbound, resume, idle, notify, connectUrl, get activeBuilds() { return activeCount; } };
}
