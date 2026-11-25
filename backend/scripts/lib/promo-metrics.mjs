// Outreach-metrics wiring for the drip (send-promo.ts), kept free of Supabase/Resend so test/promo-metrics.test.ts can run it offline.
// ./outreach-metrics.mjs is a verbatim copy of harness/lib/outreach-metrics/outreach-metrics.mjs from the ops repo. Do not edit it here.
//
// Always on: Resend tags (campaign_id, product) and the local sent-ledger (record every accepted send; touch 1 skips anyone this
// product already mailed in the last 90 days). Behind OUTREACH_METRICS=1 only: campaign registration, the layer's dedupe and circuit
// breaker, and `sent` events. The drip never rewrites links (several links per HTML mail). Touches 2 and 3 repeat the same person by
// design, so they run with dedupe off (days = 0) but keep the breaker and the tags.
import { campaignSlug, resendTags, dedupeDaysFrom } from './outreach-metrics.mjs';

/** One campaign per touch per calendar month, e.g. meetingmind-promo1-20261101 (an ongoing drip must not fragment into a campaign per day). */
export function dripCampaign(product, template, now = new Date()) {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return campaignSlug({ product, type: String(template).replace(/[^a-z0-9]/gi, ''), date: first });
}

export function dripTags(product, template, now) {
  return resendTags(dripCampaign(product, template, now), product);
}

/** Touch 1 (a new user's first mail) honours the 90-day product dedupe; later touches are deliberate repeats. */
export function dripDedupeDays(template, env = process.env) {
  return template === 'promo_1' ? dedupeDaysFrom(env) : 0;
}

/**
 * Dedupe + breaker for one batch of users ({ email }). Returns { allowed, skippedLedger, skippedLayer, halt }. Never throws.
 * `om` is an OutreachMetrics instance.
 */
export async function screenDrip({ om, product, template, users, now }) {
  const campaign = dripCampaign(product, template, now);
  const r = await om.screen({ product, campaign, emails: users.map((u) => String(u.email || '').trim()).filter(Boolean), days: dripDedupeDays(template, om.env) });
  const ok = new Set(r.allowed.map((e) => e.trim().toLowerCase()));
  return { allowed: users.filter((u) => ok.has(String(u.email || '').trim().toLowerCase())), skippedLedger: r.skippedLedger, skippedLayer: r.skippedLayer, halt: r.halt, campaign };
}

/** Breaker only (no addresses sent). Returns the halt reason or null. */
export async function breakerHalt({ om, product, template, now }) {
  const r = await om.screen({ product, campaign: dripCampaign(product, template, now), emails: [] });
  return r.halt ? r.halt.reason : null;
}
