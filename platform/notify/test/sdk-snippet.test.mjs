import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const SNIPPET_FILE = read('../sdk-snippet.js');
const SNIPPET = /\/\/ ---- BEGIN SNIPPET ----\n([\s\S]*?)\/\/ ---- END SNIPPET ----/.exec(SNIPPET_FILE)[1];
const VIBE = read('../../sdk/vibe.js');

const jsonRes = (status, obj, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });

// Splices the snippet into the real vibe.js exactly as its header says, then loads that in a vm context.
function spliced({ token = 'sess.token.value', reply } = {}) {
    const marker = '  window.vibe = {';
    assert.equal(VIBE.split(marker).length, 2, 'vibe.js must have exactly one `window.vibe = {` assignment to splice before');
    const src = VIBE.replace(marker, `${SNIPPET}\n${marker}`).replace(/(window\.vibe = \{[^\n]*?)(auth: \{)/, '$1notify: notifyApi, $2');
    const calls = []; const store = new Map(token ? [['vibe:session:myapp', token]] : []);
    const ctx = {
        location: { hostname: 'myapp.vibebuild.cc', search: '' },
        localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
        fetch: async (url, init) => { calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined }); return reply ? reply(url, init) : jsonRes(200, { ok: true }); },
        AbortController, setTimeout, clearTimeout, JSON, Promise, Error, encodeURIComponent, Object, Array, Number, String, URLSearchParams, VIBE_BASE: 'https://proxy.test',
    };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
    return { vibe: ctx.vibe, calls, store };
}

test('the snippet is plain ES5: no arrow functions, const/let, template strings, async or spread', () => {
    assert.equal(/=>|\bconst\b|\blet\b|`|\basync\b|\bawait\b|\.\.\./.test(SNIPPET), false);
    new vm.Script(SNIPPET); // parses as a script body
});

test('after splicing, vibe.notify exposes only me, and the existing surface is unchanged', () => {
    const { vibe } = spliced();
    assert.deepEqual(Object.keys(vibe.notify), ['me']);
    const plain = {}; plain.window = plain; Object.assign(plain, { location: { hostname: 'myapp.vibebuild.cc', search: '' }, fetch: async () => {}, AbortController, setTimeout, clearTimeout, JSON, Promise, Error, encodeURIComponent, Object, Array, Number, String, URLSearchParams, VIBE_BASE: 'https://proxy.test' });
    vm.createContext(plain); vm.runInContext(VIBE, plain);
    assert.deepEqual(Object.keys(vibe).sort(), [...Object.keys(plain.vibe), 'notify'].sort()); // adds notify, removes nothing
    assert.deepEqual(Object.keys(vibe.auth).sort(), Object.keys(plain.vibe.auth).sort());
});

test('me posts only subject and text to notify/me with the session bearer token and resolves {ok:true}', async () => {
    const { vibe, calls } = spliced();
    const r = await vibe.notify.me({ subject: 'Hi', text: 'There', to: 'victim@example.com', cc: 'x@y.z', headers: { Bcc: 'a@b.c' } });
    assert.deepEqual(JSON.parse(JSON.stringify(r)), { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://proxy.test/myapp/notify/me');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer sess.token.value');
    assert.deepEqual(calls[0].body, { subject: 'Hi', text: 'There' });
});

test('me rejects locally, with no request, when the user is signed out or the arguments are wrong', async () => {
    const out = spliced({ token: null });
    await assert.rejects(() => out.vibe.notify.me({ subject: 's', text: 't' }), (e) => e.status === 401 && e.code === 'unauthorized');
    const { vibe, calls } = spliced();
    for (const bad of [undefined, null, 'x', {}, { subject: 's' }, { text: 't' }, { subject: '', text: 't' }, { subject: 's', text: '  ' }, { subject: 5, text: 't' }, { subject: 's', text: {} }]) {
        await assert.rejects(() => vibe.notify.me(bad), (e) => e.status === 0 && e.code === 'bad_request', JSON.stringify(bad));
    }
    assert.equal(calls.length + out.calls.length, 0);
});

test('server errors reject with status, code and retryAfter, like the rest of the SDK', async () => {
    const mk = (status, body, headers) => spliced({ reply: () => jsonRes(status, body, headers) }).vibe;
    await assert.rejects(() => mk(429, { error: 'rate_limited' }, { 'retry-after': '120' }).notify.me({ subject: 's', text: 't' }), (e) => e.status === 429 && e.code === 'rate_limited' && e.retryAfter === 120);
    await assert.rejects(() => mk(409, { error: 'opted_out' }).notify.me({ subject: 's', text: 't' }), (e) => e.status === 409 && e.code === 'opted_out');
    await assert.rejects(() => mk(400, { error: 'invalid_content', detail: 'subject_too_long' }).notify.me({ subject: 's', text: 't' }), (e) => e.status === 400 && e.code === 'invalid_content');
});

test('a 401 from the server clears the stored session; other errors keep it', async () => {
    const a = spliced({ reply: () => jsonRes(401, { error: 'unauthorized' }) });
    await assert.rejects(() => a.vibe.notify.me({ subject: 's', text: 't' }), (e) => e.status === 401);
    assert.equal(a.store.has('vibe:session:myapp'), false);
    const b = spliced({ reply: () => jsonRes(429, { error: 'rate_limited' }) });
    await assert.rejects(() => b.vibe.notify.me({ subject: 's', text: 't' }));
    assert.equal(b.store.has('vibe:session:myapp'), true);
});

test('a network failure rejects with status 0', async () => {
    const { vibe } = spliced({ reply: () => { throw new TypeError('Failed to fetch'); } });
    await assert.rejects(() => vibe.notify.me({ subject: 's', text: 't' }), (e) => e.status === 0 && e.code === 'network');
});

test('the header documents the splice steps and the primitives it needs', () => {
    for (const w of ['window.vibe = {', 'notify: notifyApi', 'post(', 'fail(', 'getToken()', 'setToken(']) assert.ok(SNIPPET_FILE.includes(w), w);
});
