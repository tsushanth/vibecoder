import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { payHelpKey, paySection, PAY_UI_KEYS } from './payKeys.ts';
import { stripeKeyProblem, safeWebhookUrl, parseSecretsResponse, buildSecretRows, submitSecret, SECRET_ERROR_KEYS, type SecretsClient } from './secrets.ts';

// Fixtures are assembled at runtime from fragments so no source line looks like a credential to a scanner.
const body = 'x'.repeat(24);
const key = (prefix: string, mode: string) => [prefix, mode, body].join('_');
const WHSEC = ['whsec', body].join('_');
const URL_OK = 'https://vibe-proxy.vibebuild.cc/my-app/pay/webhook';

// ---- key format checks (a wrong paste is caught before it is sent)
test('the secret key must be a secret (sk_) or restricted (rk_) key, test or live', () => {
  for (const ok of [key('sk', 'test'), key('sk', 'live'), key('rk', 'test'), key('rk', 'live')]) assert.equal(stripeKeyProblem('STRIPE_SECRET_KEY', ok), null, ok.slice(0, 8));
});
test('a publishable key gets its own message, other wrong pastes the generic format one', () => {
  assert.equal(stripeKeyProblem('STRIPE_SECRET_KEY', key('pk', 'test')), 'secrets.error.stripePublishable');
  assert.equal(stripeKeyProblem('STRIPE_SECRET_KEY', key('pk', 'live')), 'secrets.error.stripePublishable');
  for (const bad of [WHSEC, 'sk_test_', 'sk_test', key('sk', 'prod'), 'sk-test-' + body, body, 'Bearer ' + key('sk', 'test'), key('sk', 'test') + ' ' + body]) {
    assert.equal(stripeKeyProblem('STRIPE_SECRET_KEY', bad), 'secrets.error.stripeKeyFormat', bad.slice(0, 12));
  }
});
test('the webhook secret must start with whsec_; a secret key pasted there is refused', () => {
  assert.equal(stripeKeyProblem('STRIPE_WEBHOOK_SECRET', WHSEC), null);
  for (const bad of [key('sk', 'test'), 'whsec_', 'whsec', body, key('pk', 'test')]) assert.equal(stripeKeyProblem('STRIPE_WEBHOOK_SECRET', bad), 'secrets.error.stripeWebhookFormat', bad.slice(0, 8));
});
test('other secret names are never checked', () => {
  for (const name of ['WEATHER_KEY', 'STRIPE_KEY', 'STRIPE_SECRET_KEY_2']) assert.equal(stripeKeyProblem(name, 'anything'), null, name);
});

test('submitSecret refuses a wrong Stripe paste without sending and keeps the input (sent=false)', async () => {
  let sent = 0;
  const client = { set: async () => { sent += 1; return { ok: true as const }; } } as unknown as SecretsClient;
  assert.deepEqual(await submitSecret(client, 'p', 'STRIPE_SECRET_KEY', key('pk', 'test')), { ok: false, sent: false, errorKey: 'secrets.error.stripePublishable' });
  assert.deepEqual(await submitSecret(client, 'p', 'STRIPE_WEBHOOK_SECRET', key('sk', 'test')), { ok: false, sent: false, errorKey: 'secrets.error.stripeWebhookFormat' });
  assert.equal(sent, 0);
  assert.deepEqual(await submitSecret(client, 'p', 'STRIPE_SECRET_KEY', `  ${key('sk', 'test')}\n`), { ok: true, sent: true }, 'trimmed before the format check');
  assert.equal(sent, 1);
});

// ---- help copy
test('only the two Stripe names have row help', () => {
  assert.equal(payHelpKey('STRIPE_SECRET_KEY'), 'secrets.pay.secretKeyHelp');
  assert.equal(payHelpKey('STRIPE_WEBHOOK_SECRET'), 'secrets.pay.webhookSecretHelp');
  assert.equal(payHelpKey('WEATHER_KEY'), null);
});

// ---- webhook URL safety
test('the webhook URL is shown only when it is an https /<app>/pay/webhook URL without credentials, query or fragment', () => {
  assert.equal(safeWebhookUrl(URL_OK), URL_OK);
  for (const bad of [null, undefined, 5, '', 'http://vibe-proxy.vibebuild.cc/a-app/pay/webhook', 'javascript:alert(1)', 'https://u:p@vibe-proxy.vibebuild.cc/a-app/pay/webhook',
    URL_OK + '?x=1', URL_OK + '#f', 'https://vibe-proxy.vibebuild.cc/a-app/pay/checkout', 'https://vibe-proxy.vibebuild.cc/pay/webhook', 'https://vibe-proxy.vibebuild.cc/A_app/pay/webhook', 'https://vibe-proxy.vibebuild.cc/a/b/pay/webhook']) {
    assert.equal(safeWebhookUrl(bad), null, String(bad));
  }
});

// ---- the response parser keeps purpose and the pay section
test('parseSecretsResponse keeps a short purpose hint and the pay webhook URL, and drops anything unsafe', () => {
  const r = parseSecretsResponse({ secrets: [], required: [{ name: 'STRIPE_SECRET_KEY', connectors: ['pay'], purpose: 'Your key' }, { name: 'B_KEY', connectors: [], purpose: 'x'.repeat(500) }, { name: 'C_KEY', connectors: [], purpose: 'a\u0000b' }, { name: 'D_KEY', connectors: [], purpose: 5 }], pay: { webhookUrl: URL_OK, extra: 1 } });
  assert.deepEqual(r, { secrets: [], required: [{ name: 'STRIPE_SECRET_KEY', connectors: ['pay'], purpose: 'Your key' }, { name: 'B_KEY', connectors: [] }, { name: 'C_KEY', connectors: [] }, { name: 'D_KEY', connectors: [] }], pay: { webhookUrl: URL_OK } });
  assert.deepEqual(parseSecretsResponse({ pay: { webhookUrl: 'http://evil.test/a-app/pay/webhook' } })?.pay, { webhookUrl: null });
  assert.deepEqual(parseSecretsResponse({ pay: { webhookUrl: null } })?.pay, { webhookUrl: null });
  assert.equal('pay' in (parseSecretsResponse({ pay: 'x' }) ?? {}), false);
  assert.equal('pay' in (parseSecretsResponse({}) ?? {}), false);
});

// ---- the pay section of the panel
test('paySection is null unless a required key belongs to the pay connector; it carries the URL and the pay rows', () => {
  const none = parseSecretsResponse({ secrets: [], required: [{ name: 'A_KEY', connectors: ['x'] }] })!;
  assert.equal(paySection(none), null);
  const data = parseSecretsResponse({ secrets: [{ name: 'STRIPE_SECRET_KEY', updatedAt: null }], required: [{ name: 'A_KEY', connectors: ['x'] }, { name: 'STRIPE_SECRET_KEY', connectors: ['pay'] }, { name: 'STRIPE_WEBHOOK_SECRET', connectors: ['pay'] }], pay: { webhookUrl: URL_OK } })!;
  assert.deepEqual(paySection(data), { webhookUrl: URL_OK, names: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] });
  const noUrl = parseSecretsResponse({ secrets: [], required: [{ name: 'STRIPE_SECRET_KEY', connectors: ['pay'] }] })!;
  assert.deepEqual(paySection(noUrl), { webhookUrl: null, names: ['STRIPE_SECRET_KEY'] });
});
test('buildSecretRows carries the purpose through', () => {
  const rows = buildSecretRows([{ name: 'STRIPE_SECRET_KEY', connectors: ['pay'], purpose: 'Hint' }, { name: 'A_KEY', connectors: [] }], []);
  assert.equal(rows[0].purpose, 'Hint'); assert.equal('purpose' in rows[1], false);
});

// ---- copy exists in every locale and says the right things
const dir = fileURLToPath(new URL('../i18n/messages/', import.meta.url));
const get = (m: unknown, key: string) => key.split('.').reduce((o: unknown, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined), m);
test('every pay string and new error key exists in all locale files', () => {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const m = JSON.parse(fs.readFileSync(dir + f, 'utf8'));
    for (const k of [...PAY_UI_KEYS, 'secrets.error.stripePublishable', 'secrets.error.stripeKeyFormat', 'secrets.error.stripeWebhookFormat']) {
      const v = get(m, k); assert.equal(typeof v, 'string', `${f} is missing ${k}`); assert.ok((v as string).trim().length > 0, `${f} ${k}`);
    }
  }
  for (const k of ['secrets.error.stripePublishable', 'secrets.error.stripeKeyFormat', 'secrets.error.stripeWebhookFormat']) assert.ok((SECRET_ERROR_KEYS as readonly string[]).includes(k), k);
});
test('the English copy names the prefixes, the test key advice and the webhook step', () => {
  const en = JSON.parse(fs.readFileSync(dir + 'en.json', 'utf8'));
  const g = (k: string) => get(en, k) as string;
  assert.match(g('secrets.pay.secretKeyHelp'), /sk_/); assert.match(g('secrets.pay.secretKeyHelp'), /rk_/); assert.match(g('secrets.pay.secretKeyHelp'), /sk_test_/);
  assert.match(g('secrets.pay.webhookSecretHelp'), /whsec_/);
  assert.match(g('secrets.pay.testFirst'), /test/i); assert.match(g('secrets.pay.testFirst'), /sk_test_/);
  assert.match(g('secrets.pay.webhookUrlLabel'), /webhook/i);
  assert.match(g('secrets.error.stripePublishable'), /pk_|publishable/i);
});
