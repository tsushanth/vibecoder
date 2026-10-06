import test from 'node:test';
import assert from 'node:assert/strict';
import {
  USAGE_ERROR_KEYS,
  usageErrorKey,
  parseUsageResponse,
  featureSeries,
  barPercent,
  meterState,
  capMeters,
  overall,
  formatBytes,
  formatMoney,
  formatCount,
  formatMeterValue,
  createUsageClient,
  FEATURES,
  METERS,
  WARN_AT,
  type UsageData,
} from './usage.ts';

const BASE = 'https://api.test';
const PID = '11111111-2222-3333-4444-555555555555';
const st = (calls: number, extra: Record<string, number> = {}) => ({ calls, errors: 0, bytes: 0, rows: 0, ms: 0, spendMicros: 0, ...extra });
const data = (over: Partial<UsageData> = {}): UsageData => ({ days: [], totals: {}, limits: {}, usage: {}, apps: 1, ...over });

test('parseUsageResponse keeps numbers, and drops anything else (strings, bad days, odd names, negatives)', () => {
  const p = parseUsageResponse({
    days: [{ day: '2026-10-06', byKind: { db: { calls: 3, errors: '2', bytes: -1, rows: 4, ms: 5, spendMicros: 6, email: 'a@b.c' }, 'bad name': st(1) } }, { day: 'today', byKind: {} }, 'x'],
    totals: { db: st(3) }, limits: { rowCap: 100, bad: 'x', neg: -1 }, usage: { rows: 7, files: 'n', storageBytes: null, callsToday: -2 }, apps: 2,
  });
  assert.deepEqual(p, {
    days: [{ day: '2026-10-06', byKind: { db: { calls: 3, errors: 0, bytes: 0, rows: 4, ms: 5, spendMicros: 6 } } }],
    totals: { db: st(3) }, limits: { rowCap: 100 }, usage: { rows: 7, files: null, storageBytes: null, callsToday: null }, apps: 2,
  });
  assert.ok(!JSON.stringify(p).includes('a@b.c'));
  for (const bad of [null, undefined, 'x', 5, [], true]) assert.equal(parseUsageResponse(bad), null);
  assert.deepEqual(parseUsageResponse({}), { days: [], totals: {}, limits: {}, usage: {}, apps: 0 });
});

test('featureSeries groups kinds into features, sums per day, skips quiet features and counts errors', () => {
  const d = data({ days: [
    { day: '2026-10-05', byKind: { db: st(2), storage_upload: st(1), storage_download: st(3, { errors: 1 }) } },
    { day: '2026-10-06', byKind: { db: st(5, { errors: 2 }), auth_email: st(1), notify: st(1) } },
  ] });
  const s = featureSeries(d);
  assert.deepEqual(s.map((x) => x.key), ['data', 'files', 'accounts']);
  assert.deepEqual(s[0].perDay, [2, 5]); assert.equal(s[0].total, 7); assert.equal(s[0].errors, 2); assert.equal(s[0].max, 5);
  assert.deepEqual(s[1].perDay, [4, 0]); assert.equal(s[1].errors, 1);
  assert.deepEqual(s[2].perDay, [0, 2]);
  assert.deepEqual(s[0].days, ['2026-10-05', '2026-10-06']);
  assert.deepEqual(featureSeries(data({ days: [{ day: '2026-10-06', byKind: {} }] })), []);
});

test('every metered kind belongs to exactly one feature', () => {
  const kinds = FEATURES.flatMap((f) => [...f.kinds]);
  assert.equal(new Set(kinds).size, kinds.length);
  for (const k of ['api', 'ai', 'db', 'storage_upload', 'storage_download', 'storage_other', 'auth_email', 'auth_signin', 'auth_session', 'notify', 'job', 'pay_checkout', 'pay_orders', 'pay_webhook']) assert.ok(kinds.includes(k), k);
});

test('barPercent scales to the busiest day and never draws activity as nothing', () => {
  assert.equal(barPercent(0, 10), 0); assert.equal(barPercent(10, 10), 100); assert.equal(barPercent(5, 10), 50);
  assert.equal(barPercent(1, 1000), 6); assert.equal(barPercent(20, 10), 100);
  assert.equal(barPercent(5, 0), 0); assert.equal(barPercent(-1, 10), 0); assert.equal(barPercent(NaN, 10), 0);
});

test('meterState: ok below 80%, warn from 80%, full at 100% and over, unknown when unread, a zero cap is full', () => {
  assert.equal(WARN_AT, 0.8);
  assert.equal(meterState(0, 100), 'ok'); assert.equal(meterState(79, 100), 'ok');
  assert.equal(meterState(80, 100), 'warn'); assert.equal(meterState(99, 100), 'warn');
  assert.equal(meterState(100, 100), 'full'); assert.equal(meterState(150, 100), 'full');
  assert.equal(meterState(null, 100), 'unknown'); assert.equal(meterState(NaN, 100), 'unknown');
  assert.equal(meterState(0, 0), 'full'); assert.equal(meterState(5, 0), 'full');
});

test('capMeters pairs each usage figure with its cap, caps the bar at 100%, and skips what the server did not report', () => {
  const d = data({
    limits: { rowCap: 20000, storageBytes: 200 * 1024 * 1024, storageFiles: 2000, dailyCalls: 5000, dailySpendMicros: 50000, emailsPerDay: 200, jobRunsPerDay: 300 },
    usage: { rows: 16000, storageBytes: 300 * 1024 * 1024, files: null, callsToday: 10, spendMicrosToday: 0, emailsToday: 200 },
  });
  const m = capMeters(d);
  assert.deepEqual(m.map((x) => x.key), ['rows', 'storage', 'files', 'calls', 'ai', 'emails']);
  const by = Object.fromEntries(m.map((x) => [x.key, x]));
  assert.deepEqual([by.rows.percent, by.rows.state], [80, 'warn']);
  assert.deepEqual([by.storage.percent, by.storage.state], [100, 'full']);
  assert.deepEqual([by.files.percent, by.files.state, by.files.used], [0, 'unknown', null]);
  assert.deepEqual([by.calls.percent, by.calls.state], [0, 'ok']);
  assert.equal(by.emails.state, 'full');
  assert.deepEqual(capMeters(data()), []);
  assert.equal(capMeters(data({ limits: { rowCap: 100 }, usage: {} })).length, 0, 'no usage figure, no meter');
  assert.equal(capMeters(data({ limits: { rowCap: 0 }, usage: { rows: 0 } }))[0].percent, 100, 'a zero cap shows as full');
  assert.equal(METERS.length, 7);
});

test('overall is the worst state and lists which meters are in it', () => {
  const mk = (key: string, state: string) => ({ key, state }) as never;
  assert.deepEqual(overall([]), { state: 'ok', full: [], warn: [] });
  assert.deepEqual(overall([mk('rows', 'ok'), mk('files', 'unknown')]), { state: 'ok', full: [], warn: [] });
  assert.deepEqual(overall([mk('rows', 'warn'), mk('files', 'ok')]), { state: 'warn', full: [], warn: ['rows'] });
  assert.deepEqual(overall([mk('rows', 'warn'), mk('calls', 'full')]), { state: 'full', full: ['calls'], warn: ['rows'] });
});

test('formatters', () => {
  assert.equal(formatBytes(0), '0 B'); assert.equal(formatBytes(512), '512 B'); assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(200 * 1024 * 1024), '200 MB'); assert.equal(formatBytes(1024 ** 3), '1 GB'); assert.equal(formatBytes(-5), '0 B');
  assert.equal(formatMoney(0), '$0.00'); assert.equal(formatMoney(9999), '<$0.01'); assert.equal(formatMoney(10_000), '$0.01'); assert.equal(formatMoney(50_000), '$0.05'); assert.equal(formatMoney(2_500_000), '$2.50');
  assert.equal(formatCount(1234567), '1,234,567'); assert.equal(formatCount(0), '0');
  assert.equal(formatMeterValue('bytes', 2048), '2 KB'); assert.equal(formatMeterValue('money', 50_000), '$0.05'); assert.equal(formatMeterValue('count', 20000), '20,000');
});

test('error keys map from status codes and are all in the declared set', () => {
  for (const s of [0, 401, 403, 429, 502, 500, 418, 404, 503]) assert.ok((USAGE_ERROR_KEYS as readonly string[]).includes(usageErrorKey(s)), String(s));
  assert.equal(usageErrorKey(0), 'usage.error.network'); assert.equal(usageErrorKey(401), 'usage.error.signIn');
  assert.equal(usageErrorKey(403), 'usage.error.forbidden'); assert.equal(usageErrorKey(429), 'usage.error.rateLimited');
  assert.equal(usageErrorKey(502), 'usage.error.unavailable'); assert.equal(usageErrorKey(500), 'usage.error.unknown');
});

function rig(reply: Response | Error, auth = async (h: Record<string, string>) => ({ ...h, Authorization: 'Bearer tok' })) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); if (reply instanceof Error) throw reply; return reply; }) as unknown as typeof fetch;
  return { calls, client: createUsageClient({ baseUrl: BASE, fetchImpl, withAuth: auth }) };
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

test('client GETs /usage?days=N with the auth headers, no cookies and no caching, and parses the answer', async () => {
  const { client, calls } = rig(ok({ days: [], totals: {}, limits: { rowCap: 5 }, usage: { rows: 1 }, apps: 1 }));
  const r = await client.get(PID, 14);
  assert.deepEqual(r, { ok: true, data: { days: [], totals: {}, limits: { rowCap: 5 }, usage: { rows: 1 }, apps: 1 } });
  assert.equal(calls[0].url, `${BASE}/api/projects/${PID}/usage?days=14`);
  assert.equal(calls[0].init.method, 'GET'); assert.equal(calls[0].init.cache, 'no-store'); assert.equal(calls[0].init.credentials, 'omit');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer tok');
});

test('client defaults to 7 days, ignores an out-of-range value, and encodes the project id', async () => {
  const a = rig(ok({})); await a.client.get(PID); assert.match(a.calls[0].url, /days=7$/);
  const b = rig(ok({})); await b.client.get(PID, 99); assert.match(b.calls[0].url, /days=7$/);
  const c = rig(ok({})); await c.client.get('a/b?x', 7); assert.ok(c.calls[0].url.includes('a%2Fb%3Fx'));
});

test('client turns failures into a status and a translation key only', async () => {
  for (const [status, key] of [[401, 'usage.error.signIn'], [403, 'usage.error.forbidden'], [429, 'usage.error.rateLimited'], [502, 'usage.error.unavailable'], [503, 'usage.error.unknown'], [404, 'usage.error.unknown']] as const) {
    const r = await rig(new Response('{"error":"x"}', { status })).client.get(PID);
    assert.deepEqual(r, { ok: false, status, errorKey: key });
  }
  assert.deepEqual(await rig(new Error('boom tok')).client.get(PID), { ok: false, status: 0, errorKey: 'usage.error.network' });
  assert.deepEqual(await rig(new Response('not json', { status: 200 })).client.get(PID), { ok: false, status: 200, errorKey: 'usage.error.unknown' });
  assert.deepEqual(await rig(new Response('"str"', { status: 200 })).client.get(PID), { ok: false, status: 200, errorKey: 'usage.error.unknown' });
});
