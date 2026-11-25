import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPromoMessage } from '../../scripts/lib/promo-mail.mjs';
import { dripCampaign, dripTags, dripDedupeDays, screenDrip, breakerHalt } from '../../scripts/lib/promo-metrics.mjs';
import { OutreachMetrics, Ledger, ledgerPath } from '../../scripts/lib/outreach-metrics.mjs';

process.env.UNSUB_SECRET = 'test-secret-not-for-production-0123456789';
const dir = () => mkdtempSync(join(tmpdir(), 'promo-m-'));
const NOW = new Date('2026-12-17T12:00:00Z');
const noKc = () => null;
const ON = { OUTREACH_METRICS: '1', CRON_SECRET: 'cron-test', OUTREACH_EVENT_SECRET: 'event-secret-test-0123456789' };
const P = 'vibebuild';

function layer(status = 'ok', contacted = () => []) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: u.pathname, body });
    if (u.pathname === '/api/outreach/check') return new Response(JSON.stringify({ contacted: contacted(body), campaign: { status, bounce_pct: 3, window_size: 100 } }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  f.calls = calls;
  return f;
}

test('campaign is one per touch per month; message gets Resend tags, headers and sender unchanged', () => {
  assert.equal(dripCampaign(P, 'promo_1', NOW), 'vibebuild-promo1-20261201');
  assert.deepEqual(dripTags(P, 'promo_2', NOW), [{ name: 'campaign_id', value: 'vibebuild-promo2-20261201' }, { name: 'product', value: 'vibebuild' }]);
  const base = { from: 'VibeBuild <vibebuild@send.kreativekoala.llc>', to: 'a@real.org', subject: 's', html: '<body></body>' };
  const plain = buildPromoMessage(base);
  const { tags, ...rest } = buildPromoMessage({ ...base, tags: dripTags(P, 'promo_1', NOW) });
  assert.ok(!('tags' in plain));
  assert.deepEqual(rest, plain);
  assert.equal(tags[0].name, 'campaign_id');
  assert.equal(plain.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

test('touch 1 dedupes against the ledger (90 days); touches 2 and 3 are deliberate repeats', async () => {
  assert.equal(dripDedupeDays('promo_1', {}), 90);
  assert.equal(dripDedupeDays('promo_2', {}), 0);
  const om = new OutreachMetrics({ env: { OUTREACH_LEDGER_DIR: dir() }, keychain: noKc, now: () => NOW.getTime() });
  om.ledger(P).add(P, 'seen@real.org', 'vibebuild-announce-20261113');
  const users = [{ user_id: '1', email: 'Seen@Real.org' }, { user_id: '2', email: 'new@real.org' }];
  assert.deepEqual((await screenDrip({ om, product: P, template: 'promo_1', users, now: NOW })).allowed.map((u) => u.user_id), ['2']);
  assert.deepEqual((await screenDrip({ om, product: P, template: 'promo_3', users, now: NOW })).allowed.map((u) => u.user_id), ['1', '2']);
});

test('flag OFF: no network call; recordSent still writes a hashed ledger', async () => {
  const f = layer();
  const env = { OUTREACH_LEDGER_DIR: dir(), CRON_SECRET: 'x', OUTREACH_EVENT_SECRET: 'y'.repeat(20) };
  const om = new OutreachMetrics({ env, fetchImpl: f, keychain: noKc });
  await screenDrip({ om, product: P, template: 'promo_1', users: [{ email: 'a@real.org' }], now: NOW });
  assert.equal(await om.registerCampaign({ id: 'c', product: P }), false);
  om.recordSent({ product: P, campaign: 'c', email: 'a@real.org' });
  assert.deepEqual(await om.flushEvents(), { posted: 0, failed: 0 });
  assert.equal(f.calls.length, 0);
  assert.doesNotMatch(readFileSync(ledgerPath(env, P), 'utf8'), /real\.org/);
  assert.equal(new Ledger(ledgerPath(env, P)).has(P, 'a@real.org', 90), true);
});

test('flag ON: layer dedupe, breaker halts (batch and mid-batch), layer failure fails open', async () => {
  const f = layer('ok', (b) => b.emails.filter((e) => e.startsWith('dup')));
  const om = new OutreachMetrics({ env: { ...ON, OUTREACH_LEDGER_DIR: dir() }, fetchImpl: f, keychain: noKc });
  const r = await screenDrip({ om, product: P, template: 'promo_1', users: [{ email: 'dup@real.org' }, { email: 'ok@real.org' }], now: NOW });
  assert.deepEqual(r.allowed, [{ email: 'ok@real.org' }]);
  assert.equal(r.skippedLayer, 1);
  assert.equal(f.calls[0].body.campaign, 'vibebuild-promo1-20261201');

  const bad = new OutreachMetrics({ env: { ...ON, OUTREACH_LEDGER_DIR: dir() }, fetchImpl: layer('pause_recommended'), keychain: noKc });
  assert.match((await screenDrip({ om: bad, product: P, template: 'promo_1', users: [{ email: 'a@real.org' }], now: NOW })).halt.reason, /pause_recommended/);
  assert.match(await breakerHalt({ om: new OutreachMetrics({ env: { ...ON, OUTREACH_LEDGER_DIR: dir() }, fetchImpl: layer('pause_recommended'), keychain: noKc }), product: P, template: 'promo_1' }), /pause_recommended/);

  const down = new OutreachMetrics({ env: { ...ON, OUTREACH_LEDGER_DIR: dir() }, fetchImpl: async () => { throw new Error('ECONNREFUSED'); }, keychain: noKc });
  const d = await screenDrip({ om: down, product: P, template: 'promo_1', users: [{ email: 'a@real.org' }], now: NOW });
  assert.equal(d.allowed.length, 1);
  assert.equal(d.halt, null);
});
