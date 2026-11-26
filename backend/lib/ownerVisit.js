// The link a creator uses to open their own published app. It carries a short-lived signature the deploy server checks
// (deploy-server/visits.js, same format, same INTERNAL_SECRET): that browser is then left out of the app's visit count.
// The deploy server redirects to the clean address at once, and an expired signature simply does nothing.
import { createHmac } from 'node:crypto';

export const OWNER_PARAM = 'vb_own';
export const OWNER_TTL_SECONDS = 24 * 60 * 60;

export function ownerToken(secret, subdomain, expiresAt) {
    const mac = createHmac('sha256', secret).update(`vb-own:v1:${subdomain}:${expiresAt}`).digest('base64url').slice(0, 32);
    return `${expiresAt}.${mac}`;
}

export function ownerUrl(secret, url, subdomain, nowMs = Date.now()) {
    const u = new URL(url);
    u.searchParams.set(OWNER_PARAM, ownerToken(secret, subdomain, Math.floor(nowMs / 1000) + OWNER_TTL_SECONDS));
    return u.toString();
}
