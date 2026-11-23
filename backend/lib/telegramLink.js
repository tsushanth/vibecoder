// Account-link codes shared by the HTTP routes (/api/telegram/link, /connect, /verify) and the Telegram bot itself.
// A signed-in VibeBuild user mints a short single-use code; a chat channel (Telegram, SMS, WhatsApp) presents it to attach its
// own id to that account. Codes live in memory (per process, 10 minutes), exactly as before this module existed.
import crypto from 'crypto';
import { createWindowLimiter } from './rateWindow.js';

const TEN_MIN = 10 * 60 * 1000;
export const DEFAULT_LIMITS = {
    verifyFailPerKey: 10,       // wrong or expired codes per key (an IP address, or a chat) per 10 minutes
    verifyFailGlobal: 600,      // wrong or expired codes across all keys per 10 minutes
    mintPerUser: 5,             // codes minted for one user per 10 minutes
    mintPerIp: 20,              // codes minted from one address per 10 minutes
    maxOutstandingCodes: 10_000,
};

export function createLinkService({ supabase, now = () => Date.now(), limits = {} } = {}) {
    const lim = { ...DEFAULT_LIMITS, ...limits };
    if (limits.verifyFailPerIp !== undefined && limits.verifyFailPerKey === undefined) lim.verifyFailPerKey = limits.verifyFailPerIp; // the old option name
    const magicLinks = new Map(); // code -> { userId, expiresAt }
    const sweepExpired = () => { const t = now(); for (const [code, data] of magicLinks) if (t > data.expiresAt) magicLinks.delete(code); };

    const failKey = createWindowLimiter({ windowMs: TEN_MIN, max: lim.verifyFailPerKey, now });
    const failGlobal = createWindowLimiter({ windowMs: TEN_MIN, max: lim.verifyFailGlobal, maxKeys: 1, now });
    const mintUser = createWindowLimiter({ windowMs: TEN_MIN, max: lim.mintPerUser, now });
    const mintIp = createWindowLimiter({ windowMs: TEN_MIN, max: lim.mintPerIp, now });

    /** @returns {{ok:true, code:string}|{ok:false, status:429|503, retryAfterMs?:number}} */
    function mint(userId, ip) {
        sweepExpired();
        if (magicLinks.size >= lim.maxOutstandingCodes) return { ok: false, status: 503 };
        if (mintUser.count(userId) >= lim.mintPerUser || mintIp.count(ip) >= lim.mintPerIp) {
            return { ok: false, status: 429, retryAfterMs: Math.max(mintUser.retryAfterMs(userId), mintIp.retryAfterMs(ip), 1000) };
        }
        mintUser.hit(userId); mintIp.hit(ip);
        const code = crypto.randomBytes(3).toString('hex').toUpperCase();
        magicLinks.set(code, { userId, expiresAt: now() + TEN_MIN });
        return { ok: true, code };
    }

    /**
     * Single-use redemption. `key` is what failures are counted against (an IP address for HTTP callers, `tg:<id>` for the bot).
     * @returns {Promise<{ok:true,userId:string,displayName:string,subscriptionTier:string}|{ok:false,status:404|410|429,error:string,retryAfterMs?:number}>}
     */
    async function consume({ code, key, telegramId, telegramUsername }) {
        if (failKey.count(key) >= lim.verifyFailPerKey) return { ok: false, status: 429, error: 'Too many attempts, try again later', retryAfterMs: failKey.retryAfterMs(key) };
        if (failGlobal.count('all') >= lim.verifyFailGlobal) return { ok: false, status: 429, error: 'Too many attempts, try again later', retryAfterMs: failGlobal.retryAfterMs('all') };

        const k = String(code).toUpperCase();
        const linkData = magicLinks.get(k);
        if (!linkData) { failKey.hit(key); failGlobal.hit('all'); return { ok: false, status: 404, error: 'Invalid or expired code' }; }
        if (now() > linkData.expiresAt) { magicLinks.delete(k); failKey.hit(key); failGlobal.hit('all'); return { ok: false, status: 410, error: 'Code has expired' }; }

        const userId = linkData.userId;
        magicLinks.delete(k);

        // One chat identity belongs to one account: detach it from any other row first so GET /user/:id stays unambiguous.
        const { error: detachError } = await supabase.from('users').update({ telegram_id: null, telegram_username: null }).eq('telegram_id', String(telegramId)).neq('user_id', userId);
        if (detachError) console.warn('[telegram/verify] detach error:', detachError.message);

        const { error } = await supabase
            .from('users')
            .update({ telegram_id: String(telegramId), telegram_username: telegramUsername || null, updated_at: new Date().toISOString() })
            .eq('user_id', userId);
        if (error) console.warn('[telegram/verify] DB update error:', error.message); // column may not exist yet: still return success with userId

        const { data: user } = await supabase.from('users').select('user_id, display_name, email, subscription_tier').eq('user_id', userId).single();
        return { ok: true, userId, displayName: user?.display_name || 'Builder', subscriptionTier: user?.subscription_tier || 'free' };
    }

    return { mint, consume, size: () => magicLinks.size, _limits: lim };
}
