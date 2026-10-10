import '../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase } from '../helpers/supabaseStub.mjs';
import { ProxyAdminError } from '../../services/proxyAdmin.js';
const { supabase } = await import('../../config/database.js');

const j = (...p) => p.join('');
const GOOGLE = j('AIza', 'SyA1234567890abcdefghijklmnopqrstuv');
const STRIPE = j('sk_', 'live_abcdefghijklmnopqrstuv1234');
const OWNER = 'user-1';
const TWEAK_PID = 'fedcba98-7654-3210-fedc-ba9876543210';

const writes = []; // every insert/update payload the routes sent to the database
stubSupabase(supabase, (q) => {
    if (q.op === 'insert' || q.op === 'update' || q.op === 'upsert') writes.push({ table: q.table, op: q.op, payload: q.payload });
    if (q.table === 'projects' && q.op === 'insert') return { data: { id: q.payload?.id }, error: null };
    if (q.table === 'projects' && q.single && q.op === 'select') return { data: { id: TWEAK_PID, title: 'T', creator_id: OWNER, bundle: 'QUJD', github_repo: 'app-1', free_tweaks_remaining: 3 }, error: null };
    if (q.single) return { data: null, error: { code: 'PGRST116' } };
    return { data: [], error: null };
});
const { default: router } = await import('../../routes/projects.routes.js');
supabase.auth.getUser = async (t) => (String(t).startsWith('tok-') ? { data: { user: { id: String(t).slice(4) } }, error: null } : { data: { user: null }, error: { message: 'bad token' } }); // each caller authenticates as the user it claims to be

const realFetch = globalThis.fetch;
const outbound = []; // everything sent to the worker / anthropic
let proxyCalls = []; let proxyMode = 'ok';
const makeProxy = () => ({
    get configured() { return proxyMode !== 'unconfigured'; },
    ensureApp: async (a) => { proxyCalls.push(['ensure', a]); if (proxyMode === 'down') throw new ProxyAdminError(0, 'unreachable'); },
    listSecrets: async (a) => { proxyCalls.push(['list', a]); return proxyCalls.filter((c) => c[0] === 'set' && c[1] === a).map((c) => ({ name: c[2] })); },
    setSecret: async (a, n, v) => { proxyCalls.push(['set', a, n, v]); if (proxyMode === 'setfails') throw new Error(`vault rejected ${v}`); },
    setEnabled: async () => {},
});
let srv; let logged = [];
const origLog = { log: console.log, warn: console.warn, error: console.error };
before(async () => {
    globalThis.fetch = (url, opts = {}) => {
        const u = new URL(String(url));
        if (u.hostname === '127.0.0.1') return realFetch(url, opts);
        outbound.push({ host: u.hostname, path: u.pathname, body: opts.body ? String(opts.body) : '' });
        if (u.hostname === 'api.anthropic.com') return Promise.resolve(new Response(JSON.stringify({ content: [{ text: '{"summary":"s","features":["a","b","c"],"style":"x"}' }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
        if (u.pathname === '/generate') return Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
        return Promise.resolve(new Response('{"error":"stop"}', { status: 500, headers: { 'content-type': 'application/json' } }));
    };
    process.env['ANTHROPIC_API' + '_KEY'] = 'placeholder';
    const app = express(); app.set('trust proxy', true); app.use(express.json({ limit: '5mb' })); app.locals.proxyAdmin = makeProxy(); app.use('/api/projects', router);
    srv = await listen(app);
    await new Promise((r) => setTimeout(r, 150));
});
after(async () => { globalThis.fetch = realFetch; Object.assign(console, origLog); await srv.close(); });
const reset = () => { writes.length = 0; outbound.length = 0; proxyCalls = []; proxyMode = 'ok'; logged = []; };
const capture = async (fn) => {
    const fmt = (...a) => logged.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    console.log = console.warn = console.error = fmt;
    try { return await fn(); } finally { Object.assign(console, origLog); }
};
const post = (path, body) => realFetch(`${srv.base}/api/projects${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(body.userId ? { authorization: `Bearer tok-${body.userId}` } : {}) }, body: JSON.stringify(body) });
const everythingObserved = () => JSON.stringify({ writes, outbound, logged });
let userSeq = 0; const freshUser = () => `chat-user-${Date.now()}-${userSeq++}`;

// ---------- /generate
test('generate: the stored row, the worker request and the logs hold only the redacted prompt; the value goes to the vault', async () => {
    reset();
    const r = await capture(() => post('/generate', { prompt: `build a map app using my key ${GOOGLE} please`, userId: freshUser() }));
    const body = await r.text();
    assert.equal(r.status, 200);
    const ins = writes.find((w) => w.table === 'projects' && w.op === 'insert').payload;
    assert.equal(ins.description, 'build a map app using my key [SECRET:GOOGLE_API_KEY] please');
    assert.equal(ins.initial_prompt, ins.description);
    const worker = outbound.find((o) => o.path === '/generate');
    assert.equal(JSON.parse(worker.body).prompt, 'build a map app using my key [SECRET:GOOGLE_API_KEY] please');
    assert.equal(everythingObserved().includes(GOOGLE), false, 'the raw key leaked into a write, a worker request or a log line');
    assert.equal(body.includes(GOOGLE), false);
    assert.equal(proxyCalls.filter((c) => c[0] === 'set').length, 1);
    const set = proxyCalls.find((c) => c[0] === 'set');
    assert.deepEqual(set.slice(2), ['GOOGLE_API_KEY', GOOGLE]);
    assert.equal(set[1], ins.id, 'secrets are filed under the new project id');
    assert.ok(proxyCalls.findIndex((c) => c[0] === 'ensure') < proxyCalls.findIndex((c) => c[0] === 'set'), 'ensureApp before setSecret');
});

test('generate: the queued event names what was stored (names only, never values)', async () => {
    reset();
    const r = await capture(() => post('/generate', { prompt: `a weather app, key ${GOOGLE}`, userId: freshUser() }));
    const body = await r.text();
    const queued = JSON.parse(body.split('\n').find((l) => l.startsWith('data:') && l.includes('"queued"')).slice(5));
    assert.deepEqual(queued.secretsStored, ['GOOGLE_API_KEY']);
    assert.equal(queued.secretsFailed, undefined);
});

for (const mode of ['down', 'unconfigured', 'setfails']) {
    test(`generate: proxy ${mode}: the build still starts and everything stored or forwarded is redacted`, async () => {
        reset(); proxyMode = mode;
        const r = await capture(() => post('/generate', { prompt: `a payments dashboard with ${STRIPE} as the key`, userId: freshUser() }));
        const body = await r.text();
        assert.equal(r.status, 200);
        assert.equal(everythingObserved().includes(STRIPE), false);
        assert.equal(body.includes(STRIPE), false);
        const worker = outbound.find((o) => o.path === '/generate');
        assert.equal(JSON.parse(worker.body).prompt, 'a payments dashboard with [SECRET:STRIPE_SECRET_KEY] as the key');
        assert.ok(body.includes('secretsFailed'), 'the creator is told the key was not stored');
    });
}

test('generate: a prompt without credentials is unchanged and touches the proxy not at all', async () => {
    reset();
    await capture(() => post('/generate', { prompt: 'a simple tip calculator with dark mode', userId: freshUser() }));
    assert.deepEqual(proxyCalls, []);
    assert.equal(JSON.parse(outbound.find((o) => o.path === '/generate').body).prompt, 'a simple tip calculator with dark mode');
});

test('generate: a rejected prompt (contains a URL) never stores a secret and its log line carries no value', async () => {
    reset();
    const r = await capture(() => post('/generate', { prompt: `see https://example.com and use ${GOOGLE}`, userId: freshUser() }));
    assert.equal(r.status, 400);
    assert.deepEqual(proxyCalls, []);
    assert.equal(everythingObserved().includes(GOOGLE), false);
});

test('generate: a prompt blocked as code injection is not logged with the credential in it', async () => {
    reset();
    const r = await capture(() => post('/generate', { prompt: `rm -rf / and use ${GOOGLE}`, userId: freshUser() }));
    assert.equal(r.status, 400);
    assert.ok(logged.some((l) => l.includes('BLOCKED malicious')), 'the block must still be logged');
    assert.equal(everythingObserved().includes(GOOGLE), false);
    assert.deepEqual(proxyCalls, []);
});

test('generate: a rate-limited request never stores a secret', async () => {
    reset();
    const u = freshUser(); let last;
    for (let i = 0; i < 40; i += 1) { last = await capture(() => post('/generate', { prompt: 'a simple tip calculator', userId: u })); if (last.status === 429) break; await last.text(); }
    assert.equal(last.status, 429);
    proxyCalls = [];
    const r = await capture(() => post('/generate', { prompt: `a simple app with ${GOOGLE}`, userId: u }));
    assert.equal(r.status, 429);
    assert.deepEqual(proxyCalls, []);
});

// ---------- /tweak
test('tweak: the worker request and the logs hold only the redacted text; the value is filed under the project', async () => {
    reset();
    const r = await capture(() => post(`/${TWEAK_PID}/tweak`, { userId: OWNER, tweakDescription: `use this key ${GOOGLE} for the map` }));
    await r.text();
    const worker = outbound.find((o) => o.path === '/tweak');
    assert.ok(worker, 'tweak must reach the worker');
    assert.equal(JSON.parse(worker.body).tweakDescription, 'use this key [SECRET:GOOGLE_API_KEY] for the map');
    assert.equal(everythingObserved().includes(GOOGLE), false);
    assert.deepEqual(proxyCalls.find((c) => c[0] === 'set'), ['set', TWEAK_PID, 'GOOGLE_API_KEY', GOOGLE]);
    assert.ok(proxyCalls.findIndex((c) => c[0] === 'ensure') < proxyCalls.findIndex((c) => c[0] === 'set'));
});

test('tweak: proxy down still forwards only the redacted text', async () => {
    reset(); proxyMode = 'down';
    const r = await capture(() => post(`/${TWEAK_PID}/tweak`, { userId: OWNER, tweakDescription: `key ${STRIPE}` }));
    await r.text();
    assert.equal(JSON.parse(outbound.find((o) => o.path === '/tweak').body).tweakDescription, 'key [SECRET:STRIPE_SECRET_KEY]');
    assert.equal(everythingObserved().includes(STRIPE), false);
});

test('tweak: a non-owner cannot file secrets under the project and nothing is logged raw', async () => {
    reset();
    const r = await capture(() => post(`/${TWEAK_PID}/tweak`, { userId: 'someone-else', tweakDescription: `key ${GOOGLE}` }));
    assert.equal(r.status, 403);
    assert.deepEqual(proxyCalls, []);
    assert.equal(everythingObserved().includes(GOOGLE), false);
});

// ---------- /plan
test('plan: the prompt sent to the model provider is redacted', async () => {
    reset();
    const r = await capture(() => post('/plan', { prompt: `a map app, my key is ${GOOGLE}`, userId: freshUser() }));
    assert.equal(r.status, 200);
    const sent = outbound.find((o) => o.host === 'api.anthropic.com');
    assert.ok(sent);
    assert.equal(sent.body.includes(GOOGLE), false);
    assert.ok(sent.body.includes('[SECRET:GOOGLE_API_KEY]'));
    assert.equal(everythingObserved().includes(GOOGLE), false);
});

// ---------- /save
test('save: description, initial prompt and title are stored redacted', async () => {
    reset();
    const r = await capture(() => post('/save', { title: `Map ${GOOGLE}`, description: `uses ${GOOGLE}`, initialPrompt: `build it with ${GOOGLE}`, bundle: 'QUJD', creatorId: OWNER }));
    assert.equal(r.status, 200);
    const ins = writes.find((w) => w.table === 'projects' && w.op === 'insert').payload;
    assert.equal(ins.description, 'uses [SECRET:GOOGLE_API_KEY]');
    assert.equal(ins.initial_prompt, 'build it with [SECRET:GOOGLE_API_KEY]');
    assert.equal(ins.title, 'Map [SECRET:GOOGLE_API_KEY]');
    assert.equal(proxyCalls.filter((c) => c[0] === 'set').length, 1, 'one key repeated across fields is stored once');
    assert.equal(everythingObserved().includes(GOOGLE), false);
});
