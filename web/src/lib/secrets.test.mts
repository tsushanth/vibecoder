import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SECRET_ERROR_KEYS,
  errorKeyForStatus,
  validateSecretInput,
  parseSecretsResponse,
  buildSecretRows,
  panelVisibility,
  createSecretsClient,
  submitSecret,
  MAX_SECRET_LENGTH,
} from './secrets.ts';

// built from fragments so no scanner mistakes a fixture for a credential
const VALUE = ['fixture', 'value', '0123456789'].join('-');
const BASE = 'https://api.test';
const PID = '11111111-2222-3333-4444-555555555555';

const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function rig(reply: Response | ((url: string, init: RequestInit) => Response | Promise<Response>), token: string | null = 'tok') {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return typeof reply === 'function' ? reply(url, init) : reply; }) as unknown as typeof fetch;
  const client = createSecretsClient({ baseUrl: BASE, fetchImpl, withAuth: async (h) => (token ? { ...h, Authorization: `Bearer ${token}` } : h) });
  return { client, calls };
}

// ---- error copy
test('every status the server can answer with has its own error key, and unknown ones fall back', () => {
  const k = (s: number) => errorKeyForStatus(s);
  assert.equal(k(401), 'secrets.error.signIn');
  assert.equal(k(403), 'secrets.error.forbidden');
  assert.equal(k(404), 'secrets.error.notFound');
  assert.equal(k(502), 'secrets.error.unavailable');
  assert.equal(k(503), 'secrets.error.notSetUp');
  assert.equal(k(429), 'secrets.error.rateLimited');
  assert.equal(k(413), 'secrets.error.tooLong');
  assert.equal(k(400), 'secrets.error.invalid');
  assert.equal(k(0), 'secrets.error.network');
  assert.equal(k(500), 'secrets.error.unknown');
  assert.equal(k(418), 'secrets.error.unknown');
  const used = new Set([401, 403, 404, 502, 503, 429, 413, 400, 0, 500].map(k));
  for (const key of used) assert.ok(SECRET_ERROR_KEYS.includes(key), key);
});

test('every error key used exists in all ten locale files (so nobody sees a raw key)', () => {
  const dir = fileURLToPath(new URL('../i18n/messages/', import.meta.url));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 10);
  const keys = [...SECRET_ERROR_KEYS, ...REQUIRED_UI_KEYS];
  for (const f of files) {
    const messages = JSON.parse(fs.readFileSync(dir + f, 'utf8'));
    for (const key of keys) {
      const value = key.split('.').reduce((o: unknown, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined), messages);
      assert.equal(typeof value, 'string', `${f} is missing ${key}`);
      assert.ok((value as string).trim().length > 0);
    }
  }
});
// the strings the panel component reads; keep in sync with SecretsPanel.tsx
const REQUIRED_UI_KEYS = ['secrets.title', 'secrets.summary', 'secrets.summaryAllSet', 'secrets.manage', 'secrets.hide', 'secrets.set', 'secrets.notSet', 'secrets.save', 'secrets.saving', 'secrets.replace', 'secrets.remove', 'secrets.removing', 'secrets.cancel', 'secrets.inputLabel', 'secrets.inputHint', 'secrets.usedBy', 'secrets.saved', 'secrets.removed', 'secrets.retry', 'secrets.loading', 'secrets.extraTitle'];

test('the copy for 401, 403 and 502 says what to do next and never promises the key was stored', () => {
  const en = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../i18n/messages/en.json', import.meta.url)), 'utf8')).secrets.error;
  assert.match(en.signIn, /sign in/i);
  assert.match(en.forbidden, /creator|owner/i);
  assert.match(en.unavailable, /try again/i);
  assert.equal(/was saved|has been saved|stored successfully/i.test(en.unavailable), false);
});

// ---- input validation
test('a pasted key is trimmed (a trailing newline from copy and paste is common) and returned', () => {
  assert.deepEqual(validateSecretInput(`  ${VALUE}\n`), { ok: true, value: VALUE });
  assert.deepEqual(validateSecretInput(VALUE), { ok: true, value: VALUE });
});
test('empty, whitespace-only, overlong and control-character input is refused with a specific key', () => {
  assert.deepEqual(validateSecretInput(''), { ok: false, errorKey: 'secrets.error.empty' });
  assert.deepEqual(validateSecretInput(' \n\t '), { ok: false, errorKey: 'secrets.error.empty' });
  assert.deepEqual(validateSecretInput('a'.repeat(MAX_SECRET_LENGTH + 1)), { ok: false, errorKey: 'secrets.error.tooLong' });
  assert.equal(validateSecretInput('a'.repeat(MAX_SECRET_LENGTH)).ok, true);
  for (const bad of ['abc\ndef', 'abc\u0000def', 'abc\r\ndef', 'abc\u007fdef']) assert.deepEqual(validateSecretInput(bad), { ok: false, errorKey: 'secrets.error.invalid' }, JSON.stringify(bad));
});
test('non-string input is refused', () => {
  for (const bad of [undefined, null, 5, {}]) assert.equal(validateSecretInput(bad as unknown as string).ok, false);
});
test('the error result never contains the pasted value', () => {
  assert.equal(JSON.stringify(validateSecretInput(VALUE + '\n' + VALUE)).includes(VALUE), false);
});

// ---- response parsing
test('parseSecretsResponse keeps valid names, drops malformed entries, and returns null for non-objects', () => {
  const r = parseSecretsResponse({
    secrets: [{ name: 'WEATHER_KEY', updatedAt: '2026-10-05T00:00:00Z' }, { name: 'lower' }, { name: 'X' }, null, 'str', { updatedAt: 'x' }, { name: 'OTHER_KEY' }],
    required: [{ name: 'WEATHER_KEY', connectors: ['weather', 'forecast'] }, { name: 'bad name', connectors: ['x'] }, { name: 'NEWS_KEY', connectors: 'oops' }, { name: 'MAPS_KEY' }, 7],
  });
  assert.deepEqual(r, {
    secrets: [{ name: 'WEATHER_KEY', updatedAt: '2026-10-05T00:00:00Z' }, { name: 'OTHER_KEY', updatedAt: null }],
    required: [{ name: 'WEATHER_KEY', connectors: ['weather', 'forecast'] }, { name: 'NEWS_KEY', connectors: [] }, { name: 'MAPS_KEY', connectors: [] }],
  });
  for (const bad of [null, undefined, 'x', 5, []]) assert.equal(parseSecretsResponse(bad), null);
  assert.deepEqual(parseSecretsResponse({}), { secrets: [], required: [] });
});
test('parseSecretsResponse never passes through a value field, even if a server sent one', () => {
  const r = parseSecretsResponse({ secrets: [{ name: 'WEATHER_KEY', updatedAt: 't', value: VALUE, secret: VALUE }], required: [] });
  assert.equal(JSON.stringify(r).includes(VALUE), false);
});
test('duplicate required names are merged', () => {
  const r = parseSecretsResponse({ secrets: [], required: [{ name: 'A_KEY', connectors: ['x'] }, { name: 'A_KEY', connectors: ['y', 'x'] }] });
  assert.deepEqual(r?.required, [{ name: 'A_KEY', connectors: ['x', 'y'] }]);
});

// ---- rows
test('rows list required secrets first with set status, then any other stored secret, which can still be removed', () => {
  const rows = buildSecretRows(
    [{ name: 'WEATHER_KEY', connectors: ['weather'] }, { name: 'NEWS_KEY', connectors: ['news'] }],
    [{ name: 'ZED_KEY', updatedAt: 't3' }, { name: 'NEWS_KEY', updatedAt: 't2' }, { name: 'ALPHA_KEY', updatedAt: 't1' }],
  );
  assert.deepEqual(rows, [
    { name: 'WEATHER_KEY', connectors: ['weather'], isSet: false, updatedAt: null, required: true },
    { name: 'NEWS_KEY', connectors: ['news'], isSet: true, updatedAt: 't2', required: true },
    { name: 'ALPHA_KEY', connectors: [], isSet: true, updatedAt: 't1', required: false },
    { name: 'ZED_KEY', connectors: [], isSet: true, updatedAt: 't3', required: false },
  ]);
});
test('no required and no stored secrets means no rows', () => assert.deepEqual(buildSecretRows([], []), []));

// ---- panel visibility
test('the panel is hidden when nothing is required and nothing is stored, and shown when a required key is missing or set', () => {
  assert.deepEqual(panelVisibility(buildSecretRows([], [])), { show: false, missing: 0, total: 0 });
  assert.deepEqual(panelVisibility(buildSecretRows([{ name: 'A_KEY', connectors: [] }], [])), { show: true, missing: 1, total: 1 });
  assert.deepEqual(panelVisibility(buildSecretRows([{ name: 'A_KEY', connectors: [] }, { name: 'B_KEY', connectors: [] }], [{ name: 'A_KEY', updatedAt: null }])), { show: true, missing: 1, total: 2 });
  assert.deepEqual(panelVisibility(buildSecretRows([{ name: 'A_KEY', connectors: [] }], [{ name: 'A_KEY', updatedAt: null }])), { show: true, missing: 0, total: 1 });
});
test('a stored secret the manifest no longer asks for does not count as missing or total, but keeps the panel visible so it can be removed', () => {
  assert.deepEqual(panelVisibility(buildSecretRows([], [{ name: 'OLD_KEY', updatedAt: null }])), { show: true, missing: 0, total: 0 });
});

// ---- client
test('list sends a GET with the bearer token to the project secrets URL and parses names only', async () => {
  const { client, calls } = rig(json(200, { secrets: [{ name: 'A_KEY', updatedAt: 't' }], required: [{ name: 'A_KEY', connectors: ['x'] }] }));
  const r = await client.list(PID);
  assert.deepEqual(r, { ok: true, data: { secrets: [{ name: 'A_KEY', updatedAt: 't' }], required: [{ name: 'A_KEY', connectors: ['x'] }] } });
  assert.equal(calls[0].url, `${BASE}/api/projects/${PID}/secrets`);
  assert.equal((calls[0].init.method || 'GET'), 'GET');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer tok');
});
test('set sends a PUT with the value as JSON and resolves on 204 with no data', async () => {
  const { client, calls } = rig(new Response(null, { status: 204 }));
  assert.deepEqual(await client.set(PID, 'A_KEY', VALUE), { ok: true });
  assert.equal(calls[0].url, `${BASE}/api/projects/${PID}/secrets/A_KEY`); assert.equal(calls[0].init.method, 'PUT');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { value: VALUE });
  assert.equal((calls[0].init.headers as Record<string, string>)['Content-Type'], 'application/json');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer tok');
});
test('remove sends a DELETE and resolves on 204 even though there is no body to parse', async () => {
  const { client, calls } = rig(new Response(null, { status: 204 }));
  assert.deepEqual(await client.remove(PID, 'A_KEY'), { ok: true });
  assert.equal(calls[0].init.method, 'DELETE'); assert.equal(calls[0].url, `${BASE}/api/projects/${PID}/secrets/A_KEY`);
});
test('ids and names are URL-encoded and invalid names never reach the network', async () => {
  const { client, calls } = rig(new Response(null, { status: 204 }));
  await client.list('a/b?c'); assert.ok(calls[0].url.endsWith('/api/projects/a%2Fb%3Fc/secrets'));
  for (const bad of ['lower', '../X', 'A', 'A B', '']) assert.deepEqual(await client.set(PID, bad, VALUE), { ok: false, status: 400, errorKey: 'secrets.error.invalid' }, bad);
  assert.equal(calls.length, 1);
  for (const bad of ['lower', '../X', 'A', 'A B', '']) assert.deepEqual(await client.remove(PID, bad), { ok: false, status: 400, errorKey: 'secrets.error.invalid' }, bad);
  assert.equal(calls.length, 1);
});
test('401, 403, 502 and other failures map to their error keys and carry no server text or value', async () => {
  for (const [status, key] of [[401, 'secrets.error.signIn'], [403, 'secrets.error.forbidden'], [502, 'secrets.error.unavailable'], [503, 'secrets.error.notSetUp'], [429, 'secrets.error.rateLimited'], [500, 'secrets.error.unknown']] as const) {
    const { client } = rig(json(status, { error: `server said ${VALUE}` }));
    for (const r of [await client.list(PID), await client.set(PID, 'A_KEY', VALUE), await client.remove(PID, 'A_KEY')]) {
      assert.deepEqual(r, { ok: false, status, errorKey: key });
      assert.equal(JSON.stringify(r).includes(VALUE), false);
    }
  }
});
test('a network failure is status 0 with the network key, and the error never contains the value', async () => {
  const { client } = rig(() => { throw new TypeError(`failed to fetch ${VALUE}`); });
  const r = await client.set(PID, 'A_KEY', VALUE);
  assert.deepEqual(r, { ok: false, status: 0, errorKey: 'secrets.error.network' }); assert.equal(JSON.stringify(r).includes(VALUE), false);
});
test('a 200 list answer that is not the expected shape is an error, not an empty panel', async () => {
  const { client } = rig(json(200, 'surprise'));
  assert.deepEqual(await client.list(PID), { ok: false, status: 200, errorKey: 'secrets.error.unknown' });
  const bad = rig(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
  assert.deepEqual(await bad.client.list(PID), { ok: false, status: 200, errorKey: 'secrets.error.unknown' });
});
test('signed out: no Authorization header is sent and the server\'s 401 is reported', async () => {
  const { client, calls } = rig(json(401, { error: 'unauthorized' }), null);
  assert.deepEqual(await client.list(PID), { ok: false, status: 401, errorKey: 'secrets.error.signIn' });
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, undefined);
});
test('the client sends the value only in the PUT body: never in the URL, other headers or other calls', async () => {
  const { client, calls } = rig(new Response(null, { status: 204 }));
  await client.set(PID, 'A_KEY', VALUE); await client.remove(PID, 'A_KEY'); await client.list(PID);
  assert.equal(calls[0].url.includes(VALUE), false);
  assert.equal(JSON.stringify(calls[0].init.headers).includes(VALUE), false);
  assert.equal(calls[1].init.body, undefined); assert.equal(calls[2].init.body, undefined);
});
test('requests carry no cookies and no cache', async () => {
  const { client, calls } = rig(new Response(null, { status: 204 }));
  await client.set(PID, 'A_KEY', VALUE);
  assert.equal(calls[0].init.cache, 'no-store'); assert.equal(calls[0].init.credentials, 'omit');
});

// ---- the submit flow the panel uses
test('submitSecret validates, trims, sends, and reports sent=true so the input is cleared', async () => {
  const { client, calls } = rig(new Response(null, { status: 204 }));
  const r = await submitSecret(client, PID, 'A_KEY', `${VALUE}\n`);
  assert.deepEqual(r, { ok: true, sent: true });
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { value: VALUE });
});
test('submitSecret does not send invalid input and keeps the input (sent=false)', async () => {
  const { client, calls } = rig(new Response(null, { status: 204 }));
  assert.deepEqual(await submitSecret(client, PID, 'A_KEY', '  '), { ok: false, sent: false, errorKey: 'secrets.error.empty' });
  assert.equal(calls.length, 0);
});
test('submitSecret on a server failure still reports sent=true (clear the field) with the mapped error and no value', async () => {
  const { client } = rig(json(502, {}));
  const r = await submitSecret(client, PID, 'A_KEY', VALUE);
  assert.deepEqual(r, { ok: false, sent: true, errorKey: 'secrets.error.unavailable' });
  assert.equal(JSON.stringify(r).includes(VALUE), false);
});
