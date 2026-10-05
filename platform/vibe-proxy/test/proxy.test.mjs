import test from 'node:test';
import assert from 'node:assert/strict';
import { handleProxy } from '../proxy.js';

const manifest = {
    connectors: {
        weather: { host: 'api.open-meteo.com', paths: ['/v1/forecast'], methods: ['GET'] },
        sheets: { host: 'sheets.googleapis.com', paths: ['/v4/spreadsheets/*'], methods: ['GET', 'POST'], secret: { name: 'SHEETS_KEY', in: 'query', field: 'key' } },
        hook: { host: 'hooks.example.com', paths: ['/x'], methods: ['POST'], secret: { name: 'HOOK_TOKEN', in: 'header', field: 'Authorization' } },
        bodykey: { host: 'api.example.com', paths: ['/v1/chat'], methods: ['POST'], secret: { name: 'BODY_KEY', in: 'body', field: 'api_key' } },
    },
};
const resolve = async () => ['93.184.216.34'];
const SECRET = 'S3cr3tValueXYZ';

function fakeFetch(reply = {}) {
    const calls = [];
    const fn = async (url, init) => {
        calls.push({ url: String(url), init });
        const body = reply.body ?? '{"ok":true}';
        return new Response(reply.stream ?? body, { status: reply.status ?? 200, headers: reply.headers ?? { 'content-type': 'application/json', 'set-cookie': 'a=b', 'x-internal': '1' } });
    };
    fn.calls = calls;
    return fn;
}
const run = (req, o = {}) => handleProxy({ req, manifest, secrets: { SHEETS_KEY: SECRET, HOOK_TOKEN: 'Bearer ' + SECRET, BODY_KEY: SECRET, ...(o.secrets || {}) }, fetchImpl: o.fetchImpl || fakeFetch(), resolve: o.resolve || resolve, limits: o.limits });

test('forwards an allowed request and returns status, content-type and body only', async () => {
    const f = fakeFetch();
    const r = await run({ connector: 'weather', method: 'GET', path: '/v1/forecast', query: { latitude: '1', longitude: '2' } }, { fetchImpl: f });
    assert.equal(r.status, 200);
    assert.equal(r.body, '{"ok":true}');
    assert.deepEqual(Object.keys(r.headers), ['content-type']);
    assert.equal(f.calls[0].url, 'https://api.open-meteo.com/v1/forecast?latitude=1&longitude=2');
});

test('unknown connector is 404 and makes no request', async () => {
    const f = fakeFetch();
    const r = await run({ connector: 'nope', method: 'GET', path: '/' }, { fetchImpl: f });
    assert.equal(r.status, 404); assert.equal(f.calls.length, 0);
});

test('a method outside the manifest is 405', async () => {
    const f = fakeFetch();
    const r = await run({ connector: 'weather', method: 'POST', path: '/v1/forecast' }, { fetchImpl: f });
    assert.equal(r.status, 405); assert.equal(f.calls.length, 0);
});

for (const [name, p] of [['a path outside the allowlist', '/v1/other'], ['dot segments', '/v4/spreadsheets/../admin'], ['encoded dot segments', '/v4/spreadsheets/%2e%2e/admin'], ['a double slash', '//evil.com/v4/spreadsheets/x'], ['a double slash inside an allowed prefix', '/v4/spreadsheets//x'], ['a query smuggled into the path', '/v4/spreadsheets/x?key=1']]) {
    test(`blocks ${name} with 403 and no request`, async () => {
        const f = fakeFetch();
        const r = await run({ connector: 'sheets', method: 'GET', path: p }, { fetchImpl: f });
        assert.equal(r.status, 403, p); assert.equal(f.calls.length, 0);
    });
}

test('a trailing * allows any sub path', async () => {
    const f = fakeFetch();
    const r = await run({ connector: 'sheets', method: 'GET', path: '/v4/spreadsheets/abc/values/A1' }, { fetchImpl: f });
    assert.equal(r.status, 200);
});

test('injects a query secret from the vault and ignores a caller-supplied value for the same field', async () => {
    const f = fakeFetch();
    await run({ connector: 'sheets', method: 'GET', path: '/v4/spreadsheets/a', query: { key: 'attacker' } }, { fetchImpl: f });
    const u = new URL(f.calls[0].url);
    assert.deepEqual(u.searchParams.getAll('key'), [SECRET]);
});

test('injects a header secret and never forwards caller authorization, cookie or host headers', async () => {
    const f = fakeFetch();
    await run({ connector: 'hook', method: 'POST', path: '/x', headers: { authorization: 'Bearer attacker', cookie: 'sid=1', host: 'evil.com', accept: 'application/json' }, body: { a: 1 } }, { fetchImpl: f });
    const h = new Headers(f.calls[0].init.headers);
    assert.equal(h.get('authorization'), 'Bearer ' + SECRET);
    assert.equal(h.get('cookie'), null); assert.equal(h.get('host'), null);
    assert.equal(h.get('accept'), 'application/json');
});

test('injects a body secret and overrides a caller-supplied field', async () => {
    const f = fakeFetch();
    await run({ connector: 'bodykey', method: 'POST', path: '/v1/chat', body: { prompt: 'hi', api_key: 'attacker' } }, { fetchImpl: f });
    assert.deepEqual(JSON.parse(f.calls[0].init.body), { prompt: 'hi', api_key: SECRET });
});

test('a connector whose secret is not in the vault is 424 and makes no request', async () => {
    const f = fakeFetch();
    const r = await run({ connector: 'sheets', method: 'GET', path: '/v4/spreadsheets/a' }, { fetchImpl: f, secrets: { SHEETS_KEY: undefined } });
    assert.equal(r.status, 424); assert.equal(f.calls.length, 0);
});

test('a host that resolves to a private address is 403 and makes no request', async () => {
    const f = fakeFetch();
    const r = await run({ connector: 'weather', method: 'GET', path: '/v1/forecast' }, { fetchImpl: f, resolve: async () => ['10.0.0.1'] });
    assert.equal(r.status, 403); assert.equal(f.calls.length, 0);
});

test('redirects are not followed: the request uses redirect manual and a 3xx becomes 502', async () => {
    const f = fakeFetch({ status: 302, headers: { location: 'http://169.254.169.254/' } });
    const r = await run({ connector: 'weather', method: 'GET', path: '/v1/forecast' }, { fetchImpl: f });
    assert.equal(f.calls[0].init.redirect, 'manual');
    assert.equal(r.status, 502);
});

test('an oversized request body is 413 and makes no request', async () => {
    const f = fakeFetch();
    const r = await run({ connector: 'bodykey', method: 'POST', path: '/v1/chat', body: { x: 'a'.repeat(5000) } }, { fetchImpl: f, limits: { maxRequestBytes: 1000 } });
    assert.equal(r.status, 413); assert.equal(f.calls.length, 0);
});

test('an oversized response is cut off and returned as 502', async () => {
    const f = fakeFetch({ body: 'x'.repeat(5000) });
    const r = await run({ connector: 'weather', method: 'GET', path: '/v1/forecast' }, { fetchImpl: f, limits: { maxResponseBytes: 1000 } });
    assert.equal(r.status, 502);
});

test('a slow upstream is 504', async () => {
    const slow = async (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const r = await run({ connector: 'weather', method: 'GET', path: '/v1/forecast' }, { fetchImpl: slow, limits: { timeoutMs: 50 } });
    assert.equal(r.status, 504);
});

test('an upstream that echoes the secret has it redacted from the response', async () => {
    const f = fakeFetch({ body: `{"echo":"${SECRET}"}` });
    const r = await run({ connector: 'sheets', method: 'GET', path: '/v4/spreadsheets/a' }, { fetchImpl: f });
    assert.equal(r.body.includes(SECRET), false);
    assert.match(r.body, /REDACTED/);
});

test('a fetch error never leaks the secret in the returned error', async () => {
    const boom = async (url) => { throw new Error(`connect failed for ${url}`); };
    const r = await run({ connector: 'sheets', method: 'GET', path: '/v4/spreadsheets/a' }, { fetchImpl: boom });
    assert.equal(r.status, 502);
    assert.equal(JSON.stringify(r).includes(SECRET), false);
});
