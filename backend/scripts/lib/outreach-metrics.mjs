// Sender-side client for the shared outreach metrics layer (Calldesk: docs/OUTREACH-METRICS.md).
// Dependency-free (node:crypto, node:fs, global fetch). Verbatim copies live in the public product repos' scripts/lib
// (same pattern as unsubscribe.mjs); change it here and re-copy. Never edit a copy.
//
// ALWAYS ON (harmless before the layer is live):
//   * resendTags(): every Resend send is tagged campaign_id + product (Resend allows ASCII letters, numbers, _ and -).
//   * Ledger: a local persistent sent-ledger (JSONL of hashed recipients, never addresses) that dedupes by product for
//     N days (default 90) even when the layer is unreachable, and records every accepted send.
// BEHIND THE FLAG (env OUTREACH_METRICS=1, default OFF; nothing below runs, no network call is made, no link changes):
//   * registerCampaign()  PUT  /api/admin/outreach/campaigns
//   * screen()            POST /api/outreach/check  (dedupe + circuit breaker; 'pause_recommended' halts the run)
//   * tracked CTA link    https://<host>/o/<campaign>/<code>, only after the layer proved it can redirect (HEAD probe)
//   * sent events         POST /api/outreach/event (signed), flushed after the sends
// Fail-open: every layer call has a 3 s timeout; any error means "send as before". After the first failure the layer is
// treated as down for the rest of the run, so at most one timeout is ever paid. Nothing here throws to the caller.
// Never logs addresses or keys; secrets come from the environment, falling back to the macOS Keychain (flag on only).

import { createHash, createHmac } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_HOST = 'https://calldesk.tech';
export const TIMEOUT_MS = 3000;
export const DEFAULT_DEDUPE_DAYS = 90;
export const CHECK_CHUNK = 500; // the layer accepts at most 500 addresses per call
const DAY_MS = 86_400_000;

const normEmail = (e) => String(e ?? '').trim().toLowerCase();
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const noop = () => {};

/** The switch. Anything other than 1/true/on/yes is OFF. */
export function metricsEnabled(env = process.env) {
  return /^(1|true|on|yes)$/i.test(String(env.OUTREACH_METRICS ?? '').trim());
}

export function dedupeDaysFrom(env = process.env, fallback = DEFAULT_DEDUPE_DAYS) {
  const raw = env.OUTREACH_DEDUPE_DAYS;
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** `<product>-<type>-<yyyymmdd>`: lowercase a-z 0-9 _ - only (Resend tags forbid '.', which the layer would allow), max 64. */
export function campaignSlug({ product, type, date = new Date() }) {
  const clean = (s) => String(s).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  const d = (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10).replace(/-/g, '');
  const slug = `${clean(product)}-${clean(type)}-${d}`.slice(0, 64).replace(/-+$/, '');
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)) throw new Error('outreach-metrics: cannot build a campaign slug');
  return slug;
}

/** Resend `tags` for one message. campaign_id feeds the layer's webhook mapping; product avoids guessing it from the sender domain. */
export function resendTags(campaign, product) {
  const ok = (v) => /^[A-Za-z0-9_-]{1,256}$/.test(String(v));
  if (!ok(campaign)) throw new Error('outreach-metrics: campaign id is not a valid Resend tag value');
  const tags = [{ name: 'campaign_id', value: String(campaign) }];
  if (product && ok(product)) tags.push({ name: 'product', value: String(product) });
  return tags;
}

// ---------------------------------------------------------------- local ledger

export function ledgerPath(env = process.env, product) {
  const dir = env.OUTREACH_LEDGER_DIR || join(homedir(), '.outreach-ledger');
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(String(product))) throw new Error('outreach-metrics: invalid product for ledger');
  return join(dir, `${product}.jsonl`);
}

/**
 * Persistent sent-ledger: one JSON line per accepted send {p: product, h: hash, c: campaign, t: ISO time}. The hash is
 * sha256("outreach-ledger-v1|" + lowercased address) cut to 32 hex chars: no address is ever written. Corrupt lines are
 * skipped. Reads and writes never throw: a broken ledger degrades to "nothing known", never to a blocked or failed send.
 */
export class Ledger {
  constructor(path, { now = () => Date.now(), log = noop } = {}) {
    this.path = path;
    this.now = now;
    this.log = log;
    this.seen = new Map(); // `${product}|${hash}` -> latest ts (ms)
    this.load();
  }
  static hash(email) { return sha256(`outreach-ledger-v1|${normEmail(email)}`).slice(0, 32); }
  load() {
    this.seen.clear();
    if (!existsSync(this.path)) return;
    let raw = '';
    try { raw = readFileSync(this.path, 'utf8'); } catch (e) { this.log(`ledger unreadable (${e.code || 'error'}); treating as empty`); return; }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        const t = Date.parse(r.t);
        if (typeof r.p !== 'string' || typeof r.h !== 'string' || Number.isNaN(t)) continue;
        const k = `${r.p}|${r.h}`;
        if (!(this.seen.get(k) >= t)) this.seen.set(k, t);
      } catch { /* skip a corrupt line */ }
    }
  }
  get size() { return this.seen.size; }
  /** True when this product mailed the address within `days` days. days <= 0 disables dedupe. */
  has(product, email, days = DEFAULT_DEDUPE_DAYS) {
    if (!(days > 0)) return false;
    const t = this.seen.get(`${product}|${Ledger.hash(email)}`);
    return t !== undefined && t >= this.now() - days * DAY_MS;
  }
  add(product, email, campaign, tsMs = this.now()) {
    let h;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(email))) return false;
    try { h = Ledger.hash(email); } catch { return false; }
    const k = `${product}|${h}`;
    if (!(this.seen.get(k) >= tsMs)) this.seen.set(k, tsMs);
    try {
      const dir = join(this.path, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
      const fresh = !existsSync(this.path);
      appendFileSync(this.path, JSON.stringify({ p: product, h, c: String(campaign), t: new Date(tsMs).toISOString() }) + '\n', { mode: 0o600 });
      if (fresh) { try { chmodSync(this.path, 0o600); } catch { /* best effort */ } }
      return true;
    } catch (e) {
      this.log(`ledger write failed (${e.code || 'error'}); the send is not affected`);
      return false;
    }
  }
}

// ---------------------------------------------------------------- secrets

/** env var first, then (darwin only) the Keychain item of the same name. Returns null if neither has it. Never logged. */
export function resolveSecret(name, env = process.env, { keychain = defaultKeychain } = {}) {
  const v = env[name];
  if (v) return v;
  try { return keychain(name) || null; } catch { return null; }
}
function defaultKeychain(name) {
  if (process.platform !== 'darwin') return null;
  try { return execFileSync('security', ['find-generic-password', '-s', name, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim(); } catch { return null; }
}

/** Short opaque per-recipient link code: base64url(HMAC-SHA256(secret, campaign + local recipient hash))[0:12]. No address in it. */
export function recipientCode(email, campaign, secret) {
  if (!secret) throw new Error('outreach-metrics: no secret for link codes');
  return createHmac('sha256', secret).update(`code1|${campaign}|${sha256(normEmail(email))}`).digest('base64url').slice(0, 12);
}

/** Destination key for a campaign: destinations are keyed (product, key), so each campaign gets its own and never overwrites another's. */
export function destinationKeyFor(product, campaign) {
  const rest = campaign.startsWith(`${product}-`) ? campaign.slice(product.length + 1) : campaign;
  const k = rest.replace(/[^a-z0-9_-]/g, '-').slice(0, 32).replace(/-+$/, '');
  return /^[a-z0-9_-]{1,32}$/.test(k) ? k : sha256(campaign).slice(0, 12);
}

/** Replace every occurrence of the CTA url in a text body with the tracked link. No-op when the url is not present. */
export function rewriteCta(text, ctaUrl, trackedUrl) {
  if (!ctaUrl || !trackedUrl || !text.includes(ctaUrl)) return text;
  return text.split(ctaUrl).join(trackedUrl);
}

// ---------------------------------------------------------------- layer client

export class OutreachMetrics {
  /**
   * @param env       environment to read (OUTREACH_METRICS, OUTREACH_METRICS_HOST, OUTREACH_LEDGER_DIR, OUTREACH_DEDUPE_DAYS, CRON_SECRET, OUTREACH_EVENT_SECRET)
   * @param fetchImpl injectable for tests
   * @param keychain  injectable for tests
   */
  constructor({ env = process.env, fetchImpl = fetch, log = noop, now = () => Date.now(), keychain = defaultKeychain, timeoutMs = TIMEOUT_MS } = {}) {
    this.env = env;
    this.fetch = fetchImpl;
    this.log = log;
    this.now = now;
    this.keychain = keychain;
    this.timeoutMs = timeoutMs;
    this.enabled = metricsEnabled(env);
    this.host = String(env.OUTREACH_METRICS_HOST || DEFAULT_HOST).replace(/\/+$/, '');
    this.layerDown = false;
    this.linkOk = new Map(); // campaign -> true once registered and probed
    this.events = [];
    this.ledgers = new Map();
    this.cronSecret = null;
    this.eventSecrets = new Map();
  }

  ledger(product) {
    if (!this.ledgers.has(product)) {
      let l;
      try { l = new Ledger(ledgerPath(this.env, product), { now: this.now, log: this.log }); } catch (e) { this.log(`ledger disabled: ${e.message}`); l = new Ledger(join(homedir(), '.outreach-ledger', '__disabled__.jsonl'), { now: this.now, log: this.log }); l.add = () => false; l.seen.clear(); }
      this.ledgers.set(product, l);
    }
    return this.ledgers.get(product);
  }

  _cron() { if (this.cronSecret === null) this.cronSecret = resolveSecret('CRON_SECRET', this.env, { keychain: this.keychain }) || ''; return this.cronSecret; }
  _eventSecret(product) {
    if (!this.eventSecrets.has(product)) {
      const own = resolveSecret(`OUTREACH_EVENT_SECRET_${String(product).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`, this.env, { keychain: () => null });
      this.eventSecrets.set(product, own || resolveSecret('OUTREACH_EVENT_SECRET', this.env, { keychain: this.keychain }) || '');
    }
    return this.eventSecrets.get(product);
  }

  _down(why) {
    if (!this.layerDown) this.log(`outreach layer unavailable (${why}); sending as before, local ledger still applies`);
    this.layerDown = true;
  }

  async _call(method, path, { body, headers = {}, redirect } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this.fetch(this.host + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body, signal: ctl.signal, ...(redirect ? { redirect } : {}) });
      return res;
    } finally { clearTimeout(timer); }
  }

  /** Register the campaign and its one destination. Returns true on success. Flag off or any error: false, nothing thrown. */
  async registerCampaign({ id, product, senderDomain, audienceSource, offer, subjectLabel, plannedSize, ctaUrl, notes }) {
    if (!this.enabled || this.layerDown) return false;
    const auth = this._cron();
    if (!auth) { this._down('no CRON_SECRET'); return false; }
    try {
      const destKey = destinationKeyFor(product, id);
      const body = {
        id, product, channel: 'email', sender_domain: senderDomain || null, audience_source: audienceSource || null, offer: offer || null,
        subject_label: subjectLabel || null, planned_size: Number.isInteger(plannedSize) ? plannedSize : null, destination_key: ctaUrl ? destKey : 'default', notes: notes || null,
        ...(ctaUrl ? { destinations: [{ key: destKey, url: ctaUrl }] } : {}),
      };
      const res = await this._call('PUT', '/api/admin/outreach/campaigns', { body: JSON.stringify(body), headers: { authorization: `Bearer ${auth}` } });
      if (!res.ok) { this._down(`register status ${res.status}`); return false; }
      return true;
    } catch (e) { this._down(e.name === 'AbortError' ? 'timeout' : 'network'); return false; }
  }

  /**
   * Dedupe + breaker for a list of addresses. Ledger always; the layer only when the flag is on and reachable.
   * Returns { allowed, skippedLedger, skippedLayer, halt: null | { reason, bounce_pct, window_size }, layer: 'off' | 'ok' | 'unavailable' }.
   * Never throws. Pass emails: [] to read only the breaker.
   */
  async screen({ product, campaign, emails, days = DEFAULT_DEDUPE_DAYS }) {
    const led = this.ledger(product);
    const out = { allowed: [], skippedLedger: 0, skippedLayer: 0, halt: null, layer: 'off' };
    const fresh = [];
    for (const e of emails) { if (led.has(product, e, days)) out.skippedLedger++; else fresh.push(e); }
    let drop = new Set();
    if (this.enabled) {
      const auth = this._cron();
      if (!auth) this._down('no CRON_SECRET');
      const chunks = [];
      for (let i = 0; i < fresh.length || (i === 0 && fresh.length === 0); i += CHECK_CHUNK) chunks.push(fresh.slice(i, i + CHECK_CHUNK));
      for (const chunk of chunks) {
        if (this.layerDown) break;
        try {
          const res = await this._call('POST', '/api/outreach/check', { body: JSON.stringify({ product, emails: chunk, days, campaign }), headers: { authorization: `Bearer ${auth}` } });
          if (!res.ok) { this._down(`check status ${res.status}`); break; }
          const j = await res.json();
          out.layer = 'ok';
          for (const c of Array.isArray(j.contacted) ? j.contacted : []) drop.add(normEmail(c));
          const st = j.campaign;
          if (st && st.status === 'pause_recommended') {
            out.halt = { reason: 'breaker: bounce rate over 2% (pause_recommended)', bounce_pct: st.bounce_pct ?? null, window_size: st.window_size ?? null };
            break;
          }
        } catch (e) { this._down(e.name === 'AbortError' ? 'timeout' : 'network'); }
      }
      if (this.layerDown && out.layer !== 'ok') out.layer = 'unavailable';
    }
    for (const e of fresh) { if (drop.has(normEmail(e))) out.skippedLayer++; else out.allowed.push(e); }
    return out;
  }

  /**
   * Tracked link for one recipient, or null when it must not be used (flag off, layer down, campaign not registered, no secret,
   * or the end-to-end probe failed). Callers send the original link whenever this returns null.
   */
  trackedLink(campaign, product, email) {
    if (!this.enabled || this.layerDown || !this.linkOk.get(campaign)) return null;
    const secret = this._eventSecret(product);
    if (!secret) return null;
    try {
      const code = recipientCode(email, campaign, secret);
      return { code, url: `${this.host}/o/${campaign}/${code}` };
    } catch { return null; }
  }

  /** Register + prove the redirect works (HEAD is redirected but never counted). Only then are links rewritten. */
  async enableLinks({ id, product, ctaUrl, ...meta }) {
    this.linkOk.delete(id);
    if (!this.enabled || !ctaUrl) return false;
    if (!this._eventSecret(product)) { this.log('no OUTREACH_EVENT_SECRET: links are not rewritten'); return false; }
    if (!(await this.registerCampaign({ id, product, ctaUrl, ...meta }))) return false;
    try {
      const res = await this._call('HEAD', `/o/${id}/probe`, { redirect: 'manual' });
      const loc = res.headers.get('location') || '';
      const want = new URL(ctaUrl).hostname;
      let host = '';
      try { host = new URL(loc).hostname; } catch { /* not a URL */ }
      if (res.status !== 302 || host !== want) { this.log(`tracked link probe failed (status ${res.status}); links are not rewritten`); return false; }
    } catch (e) { this._down(e.name === 'AbortError' ? 'timeout' : 'network'); return false; }
    this.linkOk.set(id, true);
    return true;
  }

  /** After the provider accepted a send: ledger always; a `sent` event queued when the flag is on. */
  recordSent({ product, campaign, email, code }) {
    this.ledger(product).add(product, email, campaign);
    if (this.enabled) this.events.push({ product, campaign, email, code });
  }

  /** Post the queued `sent` events (signed, concurrency 8, 3 s each, ignored on failure). Call after the sends, never between them. */
  async flushEvents() {
    const q = this.events.splice(0);
    if (!this.enabled || !q.length || this.layerDown) return { posted: 0, failed: q.length };
    let posted = 0, failed = 0, i = 0;
    const worker = async () => {
      while (i < q.length && !this.layerDown) {
        const ev = q[i++];
        const secret = this._eventSecret(ev.product);
        if (!secret) { failed++; continue; }
        try {
          const raw = JSON.stringify({ product: ev.product, campaign: ev.campaign, event: 'sent', email: ev.email, ...(ev.code ? { link_code: ev.code } : {}), event_id: `sent:${ev.campaign}:${sha256(normEmail(ev.email)).slice(0, 16)}` });
          const ts = String(Math.floor(this.now() / 1000));
          const sig = 'v1=' + createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
          const res = await this._call('POST', '/api/outreach/event', { body: raw, headers: { 'x-outreach-product': ev.product, 'x-outreach-timestamp': ts, 'x-outreach-signature': sig } });
          if (res.ok) posted++; else failed++;
        } catch { failed++; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, q.length) }, worker));
    if (failed) this.log(`sent events: ${posted} posted, ${failed} not posted (ignored)`);
    return { posted, failed };
  }
}

// ---------------------------------------------------------------- maintenance helpers (ledger seeding)

/** Add many addresses to a product's ledger as already contacted at `ts` (backfill from a past send). Returns the count added. */
export function seedLedger(ledger, product, campaign, emails, ts = new Date()) {
  let n = 0;
  const t = ts instanceof Date ? ts.getTime() : Date.parse(ts);
  for (const e of emails) { if (e && ledger.add(product, e, campaign, t)) n++; }
  return n;
}

/**
 * Backfill the ledger from Resend's own send log (read-only GET /emails, newest first, 100 per page): every address the key's
 * account mailed from `fromDomain` since `sinceMs` is recorded as contacted at its send time. Counts only; no address is printed.
 */
export async function seedLedgerFromResend({ ledger, product, fromDomain, sinceMs, apiKey, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxPages = 200 }) {
  let after = null, pages = 0, seen = 0, added = 0;
  const dom = String(fromDomain).toLowerCase();
  while (pages++ < maxPages) {
    const res = await fetchImpl(`https://api.resend.com/emails?limit=100${after ? `&after=${after}` : ''}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`resend list failed (status ${res.status})`);
    const j = await res.json();
    const rows = Array.isArray(j.data) ? j.data : [];
    let oldest = Infinity;
    for (const r of rows) {
      const t = Date.parse(r.created_at);
      if (!Number.isNaN(t)) oldest = Math.min(oldest, t);
      if (Number.isNaN(t) || t < sinceMs) continue;
      if (!String(r.from || '').toLowerCase().includes(`@${dom}`)) continue;
      if (/^(bounced|canceled|failed)$/i.test(String(r.last_event || ''))) { /* still counts as contacted: the layer counts bounced too */ }
      for (const to of Array.isArray(r.to) ? r.to : [r.to]) { seen++; if (to && ledger.add(product, to, 'resend-history', t)) added++; }
    }
    if (!j.has_more || !rows.length || oldest < sinceMs) break;
    after = rows[rows.length - 1].id;
    await sleep(600); // Resend allows 2 requests per second
  }
  return { pages, seen, added };
}

// ---------------------------------------------------------------- tiny CLI: ledger maintenance (addresses only via stdin, never printed)

async function cli(argv) {
  const [cmd, ...rest] = argv;
  const a = {};
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) a[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  const usage = () => { console.error('usage:\n  outreach-metrics.mjs ledger-stats --product <p>\n  outreach-metrics.mjs ledger-add --product <p> --campaign <slug> [--ts <ISO>]   (addresses, one per line, on stdin)\n  outreach-metrics.mjs ledger-seed-resend --product <p> --from-domain <d> --since <ISO>   (needs RESEND_API_KEY)'); process.exit(2); };
  if (!a.product) usage();
  const ledger = new Ledger(ledgerPath(process.env, a.product), { log: console.error });
  if (cmd === 'ledger-stats') { console.log(`ledger ${a.product}: ${ledger.size} recipients known`); return; }
  if (cmd === 'ledger-add') {
    if (!a.campaign) usage();
    const input = readFileSync(0, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
    console.log(`added ${seedLedger(ledger, a.product, a.campaign, input, a.ts || new Date())} of ${input.length}`);
    return;
  }
  if (cmd === 'ledger-seed-resend') {
    if (!a['from-domain'] || !a.since || !process.env.RESEND_API_KEY) usage();
    console.log(JSON.stringify(await seedLedgerFromResend({ ledger, product: a.product, fromDomain: a['from-domain'], sinceMs: Date.parse(a.since), apiKey: process.env.RESEND_API_KEY })));
    return;
  }
  usage();
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) cli(process.argv.slice(2)).catch((e) => { console.error('ERR', e.message); process.exit(1); });
