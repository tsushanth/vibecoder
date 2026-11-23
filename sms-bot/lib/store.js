// Small durable state for a stateless Fly app: one JSON file on a mounted volume (DATA_DIR, /data in production),
// written atomically (temp file + rename) and serialised. No extra services, no new dependencies.
// If the directory is not writable the store keeps working in memory and says persistent:false (shown by /health).
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';

const MAX_SEEN = 5000;           // MessageSid dedupe ring
const MAX_USERS = 50_000;
const DAY = 24 * 60 * 60 * 1000;

export function createStore({ dir, now = () => Date.now(), saveDelayMs = 200, log = console } = {}) {
  let state = { version: 1, users: {}, seen: [], builds: {}, stats: {} };
  let persistent = false;
  let file = null;
  let timer = null;
  let writing = Promise.resolve();
  const seenSet = new Set();

  if (dir) {
    try {
      mkdirSync(dir, { recursive: true });
      accessSync(dir, constants.W_OK);
      file = join(dir, 'state.json');
      persistent = true;
      if (existsSync(file)) {
        try {
          const raw = JSON.parse(readFileSync(file, 'utf8'));
          state = { version: 1, users: raw.users || {}, seen: raw.seen || [], builds: raw.builds || {}, stats: raw.stats || {} };
        } catch {
          try { renameSync(file, `${file}.corrupt-${now()}`); } catch { /* ignore */ }
          log.error('[store] state file unreadable, starting empty (old file kept as .corrupt-*)');
        }
      }
    } catch (e) {
      persistent = false;
      file = null;
      log.error(`[store] ${dir} not writable (${e.code || e.message}); state is in memory only and is lost on restart`);
    }
  }
  for (const sid of state.seen) seenSet.add(sid);

  function persistNow() {
    if (!file) return writing;
    const snapshot = JSON.stringify(state);
    const tmp = `${file}.tmp`;
    writing = writing.then(() => { writeFileSync(tmp, snapshot); renameSync(tmp, file); }).catch((e) => log.error(`[store] write failed: ${e.code || e.message}`));
    return writing;
  }
  function touch() {
    if (!file || timer) return;
    timer = setTimeout(() => { timer = null; void persistNow(); }, saveDelayMs);
    timer.unref?.();
  }

  const api = {
    get persistent() { return persistent; },
    /** True if this MessageSid was already handled (and records it if not). Twilio retries webhooks on timeouts. */
    seenBefore(sid) {
      if (!sid) return false;
      if (seenSet.has(sid)) return true;
      seenSet.add(sid);
      state.seen.push(sid);
      while (state.seen.length > MAX_SEEN) seenSet.delete(state.seen.shift());
      touch();
      return false;
    },
    user(phone) {
      let u = state.users[phone];
      if (!u) {
        if (Object.keys(state.users).length >= MAX_USERS) throw new Error('user table full');
        u = state.users[phone] = { createdAt: now(), lang: 'en', langSource: 'none', hintShown: false, optOut: {}, lastInbound: {}, daily: {} };
      }
      return u;
    },
    peekUser(phone) { return state.users[phone] || null; },
    save() { touch(); },
    // ---- builds in flight (resumed after a restart) ----
    putBuild(b) { state.builds[b.id] = b; touch(); },
    removeBuild(id) { delete state.builds[id]; touch(); },
    activeBuildFor(phone, channel) { return Object.values(state.builds).find((b) => b.phone === phone && b.channel === channel) || null; },
    activeBuilds() { return Object.values(state.builds); },
    // ---- counters ----
    bump(name, n = 1) { state.stats[name] = (state.stats[name] || 0) + n; touch(); },
    stats() { return { ...state.stats }; },
    userCount() { return Object.keys(state.users).length; },
    /** Builds started today (UTC) by this phone. */
    buildsToday(phone) {
      const u = state.users[phone];
      return u?.daily?.[new Date(now()).toISOString().slice(0, 10)] || 0;
    },
    countBuild(phone) {
      const u = api.user(phone);
      const day = new Date(now()).toISOString().slice(0, 10);
      u.daily = { [day]: (u.daily?.[day] || 0) + 1 }; // only today is kept
      touch();
    },
    /** Free-form messages on WhatsApp are only allowed within 24 hours of the user's last message. */
    inSession(phone, channel) {
      const last = state.users[phone]?.lastInbound?.[channel];
      return typeof last === 'number' && now() - last < DAY;
    },
    async flush() { if (timer) { clearTimeout(timer); timer = null; } await persistNow(); },
  };
  return api;
}
