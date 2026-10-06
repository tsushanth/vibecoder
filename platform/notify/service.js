// End-user notifications. One path sends mail, `sendToUser`, used by the HTTP route (the signed-in user's own address)
// and by creator-side callers such as scheduled jobs. It is not exposed over HTTP by itself. The recipient is never an
// argument: it is looked up from the platform's account record for (app, user). Checks run in a fixed order:
// app enabled and kill switch, content, recipient, opt-out, then counters from narrow to wide (user, app, platform) so a
// capped user cannot burn the app's or the platform's allowance. Everything fails closed.
import { signUnsubscribe, verifyUnsubscribe, isUserId } from './token.js';
import { validateContent, buildMessage } from './content.js';

const APP_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const DAY_TTL = 26 * 3600;
export const DEFAULT_LIMITS = { perUserPerHour: 3, perUserPerDay: 10, perAppPerDay: 200, globalPerDay: 2000 };

export function createNotifyService({ store, limiterStore, mailer, appStore, masterKey, baseUrl, now = () => Date.now(), limits = {}, limitsFor }) {
    if (typeof masterKey !== 'string' || !/^[0-9a-f]{64}$/i.test(masterKey)) throw new Error('notify needs a 64 hex character master key');
    if (typeof baseUrl !== 'string' || !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(baseUrl)) throw new Error('notify needs an https base url');
    const base = baseUrl.replace(/\/+$/, '');
    const L = { ...DEFAULT_LIMITS, ...limits };
    const hour = () => Math.floor(now() / 3_600_000);
    const day = () => new Date(now()).toISOString().slice(0, 10);
    const untilNextHour = () => 3600 - (Math.floor(now() / 1000) % 3600);
    const untilNextDay = () => Math.ceil((Date.parse(day() + 'T00:00:00Z') + 86_400_000 - now()) / 1000);
    const limited = (retryAfterSec) => ({ ok: false, reason: 'rate_limited', retryAfterSec });

    return {
        async sendToUser({ appId, userId, subject, text }) {
            if (typeof appId !== 'string' || !APP_ID.test(appId)) return { ok: false, reason: 'unknown_app' };
            try {
                const app = await appStore.get(appId);
                if (!app) return { ok: false, reason: 'unknown_app' };
                if (!app.enabled || (await limiterStore.get(`kill:${appId}`))) return { ok: false, reason: 'app_disabled' };
            } catch { return { ok: false, reason: 'unavailable' }; }
            const content = validateContent({ subject, text });
            if (!content.ok) return content;
            if (!isUserId(userId)) return { ok: false, reason: 'unknown_user' };
            let rcpt;
            try { rcpt = await store.getRecipient({ appId, userId }); } catch { return { ok: false, reason: 'unavailable' }; }
            if (!rcpt) return { ok: false, reason: 'unknown_user' };
            if (rcpt.optedOut) return { ok: false, reason: 'opted_out' };
            try {
                const o = limitsFor ? await limitsFor(appId) : null; // per-app override of the emails-per-day cap
                const appCap = Number.isInteger(o?.emailsPerDay) ? o.emailsPerDay : L.perAppPerDay;
                if ((await limiterStore.incr(`notify:uh:${appId}:${userId}:${hour()}`, 7200)) > L.perUserPerHour) return limited(untilNextHour());
                if ((await limiterStore.incr(`notify:ud:${appId}:${userId}:${day()}`, DAY_TTL)) > L.perUserPerDay) return limited(untilNextDay());
                if ((await limiterStore.incr(`notify:app:${appId}:${day()}`, DAY_TTL)) > appCap) return limited(untilNextDay());
                if ((await limiterStore.incr(`notify:global:${day()}`, DAY_TTL)) > L.globalPerDay) return limited(untilNextDay());
            } catch { return { ok: false, reason: 'unavailable' }; }
            const token = signUnsubscribe({ masterKey, appId, userId });
            const msg = buildMessage({ appId, subject: content.subject, text: content.text, unsubscribeUrl: `${base}/${appId}/notify/unsubscribe?t=${token}` });
            try { await mailer.sendMessage({ to: rcpt.email, ...msg }); } catch { return { ok: false, reason: 'send_failed' }; }
            return { ok: true };
        },

        // Works whatever state the app is in: opting out must never be blocked. Always the same answer for a valid token.
        async unsubscribe({ appId, token }) {
            if (typeof appId !== 'string' || !APP_ID.test(appId)) return { ok: false, reason: 'invalid_link' };
            const v = verifyUnsubscribe({ masterKey, appId, token });
            if (!v.ok) return { ok: false, reason: 'invalid_link' };
            try { await store.optOut({ appId, userId: v.userId }); } catch { return { ok: false, reason: 'unavailable' }; }
            return { ok: true };
        },

        // For the confirmation page: the token is checked without writing anything.
        checkUnsubscribeToken({ appId, token }) {
            return typeof appId === 'string' && APP_ID.test(appId) && verifyUnsubscribe({ masterKey, appId, token }).ok;
        },
    };
}
