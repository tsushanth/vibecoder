import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    sanitizeSignupSource, platformFromRequest, buildSignupSourceColumns, isMissingColumnError, recordSignupSource, resetSignupSourceCache, MAX_FIELD_LENGTH,
} from '../../lib/signupSource.js';

const req = (headers = {}) => ({ headers });
beforeEach(() => resetSignupSourceCache());

test('sanitize: keeps the known keys and drops unknown ones', () => {
    const out = sanitizeSignupSource({ utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'nov', utm_content: 'cta', referrer_host: 'news.ycombinator.com', landing_path: '/blog', role: 'admin', user_id: 'x', __proto__: { x: 1 } });
    assert.deepEqual(out, { utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'nov', utm_content: 'cta', referrer_host: 'news.ycombinator.com', landing_path: '/blog' });
});

test('sanitize: anything that is not a plain object gives {}', () => {
    for (const v of [null, undefined, 'utm_source=x', 42, [], [{ utm_source: 'a' }], true]) assert.deepEqual(sanitizeSignupSource(v), {});
});

test('sanitize: non-string and empty values are dropped, long values cut to 64 characters', () => {
    const out = sanitizeSignupSource({ utm_source: 5, utm_medium: { a: 1 }, utm_campaign: '   ', utm_content: 'x'.repeat(200) });
    assert.deepEqual(out, { utm_content: 'x'.repeat(MAX_FIELD_LENGTH) });
    assert.equal(sanitizeSignupSource({ utm_source: 'y'.repeat(100000) }).utm_source, undefined, 'absurdly long input is rejected, not trimmed');
});

test('sanitize: control characters are removed and whitespace collapsed', () => {
    assert.equal(sanitizeSignupSource({ utm_source: 'a\u0000b\r\nc\t d' }).utm_source, 'a b c d');
});

test('sanitize: a utm value that looks like an email address is dropped (no PII)', () => {
    assert.deepEqual(sanitizeSignupSource({ utm_source: 'someone@example.com', utm_campaign: 'spring' }), { utm_campaign: 'spring' });
});

test('sanitize: referrer_host is reduced to a bare host name', () => {
    assert.equal(sanitizeSignupSource({ referrer_host: 'https://www.Google.com/search?q=secret' }).referrer_host, 'google.com');
    assert.equal(sanitizeSignupSource({ referrer_host: 'Reddit.com' }).referrer_host, 'reddit.com');
    for (const bad of ['not a host', 'javascript:alert(1)', 'localhost', 'a/b.com', '<script>.com']) assert.equal(sanitizeSignupSource({ referrer_host: bad }).referrer_host, undefined, bad);
});

test('sanitize: landing_path keeps the path only, never the query or fragment', () => {
    assert.equal(sanitizeSignupSource({ landing_path: '/blog/post?token=abc#frag' }).landing_path, '/blog/post');
    assert.equal(sanitizeSignupSource({ landing_path: '/' }).landing_path, '/');
    for (const bad of ['blog', '//evil.com/x', 'https://x.com/a', '?a=1']) assert.equal(sanitizeSignupSource({ landing_path: bad }).landing_path, undefined, bad);
});

test('platform: an explicit header wins when it is a known value, an unknown header falls back to the user agent', () => {
    assert.equal(platformFromRequest(req({ 'x-client-platform': 'Android', 'user-agent': 'Mozilla/5.0' })), 'android');
    assert.equal(platformFromRequest(req({ 'x-client-platform': 'ios' })), 'ios');
    assert.equal(platformFromRequest(req({ 'x-client-platform': 'admin', 'user-agent': 'Mozilla/5.0' })), 'web');
});

test('platform: user agent detection', () => {
    assert.equal(platformFromRequest(req({ 'user-agent': 'okhttp/4.12.0' })), 'android');
    assert.equal(platformFromRequest(req({ 'user-agent': 'VibeCoder/1 CFNetwork/1494 Darwin/23.4.0' })), 'ios');
    assert.equal(platformFromRequest(req({ 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile' })), 'web');
    assert.equal(platformFromRequest(req({ 'user-agent': 'curl/8.0' })), 'unknown');
    assert.equal(platformFromRequest(req({})), 'unknown');
    assert.equal(platformFromRequest(undefined), 'unknown');
});

test('columns: platform and timestamp are always present, unknown keys never reach the row', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    const cols = buildSignupSourceColumns(req({ 'user-agent': 'okhttp/4' }), { utm_source: 'x', evil: 'y', email: 'a@b.com' }, now);
    assert.deepEqual(cols, { platform: 'android', utm_source: 'x', signup_source_at: now.toISOString() });
});

test('missing-column errors are recognised', () => {
    assert.ok(isMissingColumnError({ code: '42703', message: 'x' }));
    assert.ok(isMissingColumnError({ code: 'PGRST204', message: "Could not find the 'platform' column of 'users' in the schema cache" }));
    assert.ok(isMissingColumnError({ message: 'column "platform" of relation "users" does not exist' }));
    assert.ok(!isMissingColumnError({ code: '23505', message: 'duplicate key' }));
    assert.ok(!isMissingColumnError(null));
});

function fakeSupabase(result) {
    const calls = [];
    return { calls, from: (table) => { const c = { table }; calls.push(c); const b = { update: (p) => { c.payload = p; return b; }, eq: (k, v) => { c.eq = [k, v]; return b; }, is: (k, v) => { c.is = [k, v]; return Promise.resolve(typeof result === 'function' ? result() : result); } }; return b; } };
}
const quiet = { warn() {} };

test('record: writes a guarded update that only fills a row whose source is still empty', async () => {
    const sb = fakeSupabase({ error: null });
    assert.equal(await recordSignupSource(sb, 'u1', req({ 'user-agent': 'Mozilla/5.0' }), { utm_source: 'g' }, { log: quiet }), true);
    assert.equal(sb.calls[0].table, 'users'); assert.deepEqual(sb.calls[0].eq, ['user_id', 'u1']); assert.deepEqual(sb.calls[0].is, ['signup_source_at', null]);
    assert.equal(sb.calls[0].payload.platform, 'web'); assert.equal(sb.calls[0].payload.utm_source, 'g');
});

test('record: before the migration it does not throw, and stops retrying for a minute', async () => {
    const sb = fakeSupabase({ error: { code: '42703', message: 'column "platform" of relation "users" does not exist' } });
    assert.equal(await recordSignupSource(sb, 'u1', req(), {}, { log: quiet }), false);
    assert.equal(await recordSignupSource(sb, 'u2', req(), {}, { log: quiet }), false);
    assert.equal(sb.calls.length, 1, 'second signup skipped the write');
});

test('record: other errors and thrown errors are swallowed', async () => {
    assert.equal(await recordSignupSource(fakeSupabase({ error: { code: '57014', message: 'timeout' } }), 'u', req(), {}, { log: quiet }), false);
    assert.equal(await recordSignupSource(fakeSupabase(() => { throw new Error('boom'); }), 'u', req(), {}, { log: quiet }), false);
});
