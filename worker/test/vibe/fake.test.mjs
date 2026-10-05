import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installFake, FAKE_SCRIPT } from '../../lib/vibeFake.js';
import { fullChecks, filesForRun } from '../../lib/browsercheck.js';
import { SCHEMA_FILE } from '../../lib/dataschema.js';

const fresh = () => { const w = { vibe: { api() {}, ai: {} } }; installFake(w); return w.vibe; };
const rejects = async (p, status, code) => {
    try { await p; } catch (e) { assert.ok(/^vibe/.test(e.message), e.message); assert.equal(e.status, status); assert.equal(e.code, code); return; }
    assert.fail('expected a rejection');
};

// ---- the fake itself (pure node, no browser)
test('the fake keeps the SDK pieces it does not replace', () => {
    const w = { vibe: { api: 1, ai: 2 } };
    installFake(w);
    assert.equal(w.vibe.api, 1); assert.equal(w.vibe.ai, 2);
    const w2 = {}; installFake(w2); assert.ok(w2.vibe.auth && w2.vibe.db && w2.vibe.storage);
});
test('auth: signIn resolves {ok:true}, validates the email, user() is a signed-in user, signOut clears and notifies', async () => {
    const a = fresh().auth;
    assert.deepEqual(await a.signIn(' a@b.co '), { ok: true });
    await rejects(a.signIn(''), 0, 'bad_request'); await rejects(a.signIn('   '), 0, 'bad_request'); await rejects(a.signIn(5), 0, 'bad_request');
    const u = await a.user();
    assert.equal(typeof u.id, 'string'); assert.match(u.email, /@/);
    assert.equal(await a.ready, null);
    const seen = [];
    const off = a.onChange((x) => seen.push(x));
    assert.equal(typeof a.onChange('nope'), 'function');
    assert.deepEqual(await a.signOut(), { ok: true });
    assert.deepEqual(seen, [null]); assert.equal(await a.user(), null);
    off(); await a.signOut(); assert.deepEqual(seen, [null]);
});
test('auth: a throwing listener does not break the others', async () => {
    const a = fresh().auth; const seen = [];
    a.onChange(() => { throw new Error('boom'); }); a.onChange((x) => seen.push(x));
    await a.signOut(); assert.deepEqual(seen, [null]);
});
test('db: starts empty, insert returns { rows, count } with the platform columns, select sees them', async () => {
    const db = fresh().db;
    assert.deepEqual(await db.from('todos').select(), { rows: [] });
    const r = await db.from('todos').insert({ title: 'a', done: false });
    assert.equal(r.count, 1); assert.equal(r.rows[0].title, 'a'); assert.equal(typeof r.rows[0].id, 'string'); assert.equal(typeof r.rows[0].user_id, 'string'); assert.match(r.rows[0].created_at, /^20\d\d-/);
    const many = await db.from('todos').insert([{ title: 'b' }, { title: 'c' }]);
    assert.equal(many.count, 2); assert.notEqual(many.rows[0].id, many.rows[1].id);
    assert.equal((await db.from('todos').select()).rows.length, 3);
    assert.deepEqual(await db.from('other').select(), { rows: [] });
});
test('db: where, order, limit and offset behave', async () => {
    const db = fresh().db;
    await db.from('t').insert([{ n: 3, k: 'x' }, { n: 1, k: 'y' }, { n: 2, k: 'x' }]);
    const sel = (o) => db.from('t').select(o).then((r) => r.rows.map((x) => x.n));
    const w = (op, val, col = 'n') => ({ where: [{ col, op, val }] });
    assert.deepEqual(await sel(w('eq', 'x', 'k')), [3, 2]);
    assert.deepEqual(await sel(w('neq', 'x', 'k')), [1]);
    assert.deepEqual(await sel(w('gt', 1)), [3, 2]);
    assert.deepEqual(await sel(w('gte', 2)), [3, 2]);
    assert.deepEqual(await sel(w('lt', 3)), [1, 2]);
    assert.deepEqual(await sel(w('lte', 1)), [1]);
    assert.deepEqual(await sel(w('in', [1, 3])), [3, 1]);
    assert.deepEqual(await sel(w('like', '%x%', 'k')), [3, 2]);
    assert.deepEqual(await sel(w('ilike', 'y%', 'k')), [1]);
    assert.deepEqual(await sel(w('is_null', true, 'zz')), [3, 1, 2]);
    assert.deepEqual(await sel(w('is_null', true)), []);
    assert.deepEqual(await sel({ where: [{ col: 'k', op: 'eq', val: 'x' }, { col: 'n', op: 'gt', val: 2 }] }), [3]);
    assert.deepEqual(await sel({ order: [{ col: 'n', dir: 'asc' }] }), [1, 2, 3]);
    assert.deepEqual(await sel({ order: [{ col: 'n', dir: 'desc' }] }), [3, 2, 1]);
    assert.deepEqual(await sel({ order: [{ col: 'k', dir: 'asc' }, { col: 'n', dir: 'desc' }] }), [3, 2, 1]);
    assert.deepEqual(await sel({ order: [{ col: 'k', dir: 'asc' }, { col: 'n', dir: 'asc' }] }), [2, 3, 1]);
    assert.deepEqual(await sel({ order: [{ col: 'n', dir: 'asc' }], limit: 2 }), [1, 2]);
    assert.deepEqual(await sel({ order: [{ col: 'n', dir: 'asc' }], offset: 1 }), [2, 3]);
    assert.deepEqual(await sel({ limit: 0 }), []);
});
test('db: select defaults to 50 rows and never returns more than 100', async () => {
    const db = fresh().db;
    for (let i = 0; i < 3; i++) await db.from('t').insert(Array.from({ length: 50 }, (_, j) => ({ n: i * 50 + j })));
    assert.equal((await db.from('t').select()).rows.length, 50);
    assert.equal((await db.from('t').select({ limit: 80 })).rows.length, 80);
    assert.equal((await db.from('t').select({ limit: 500 })).rows.length, 100);
});
test('db: results are copies, so changing a result or an input does not change the store', async () => {
    const db = fresh().db;
    await db.from('t').insert({ a: 1 });
    (await db.from('t').select()).rows[0].a = 99;
    assert.equal((await db.from('t').select()).rows[0].a, 1);
    const input = { a: 2 }; const ins = await db.from('t').insert(input); ins.rows[0].a = 7; input.a = 8;
    assert.equal((await db.from('t').select({ where: [{ col: 'a', op: 'eq', val: 2 }] })).rows.length, 1);
    const up = await db.from('t').update({ a: 3 }, [{ col: 'a', op: 'eq', val: 2 }]); up.rows[0].a = 55;
    assert.equal((await db.from('t').select({ where: [{ col: 'a', op: 'eq', val: 3 }] })).rows.length, 1);
});
test('db: update and delete change only matching rows and return rows and count', async () => {
    const db = fresh().db;
    await db.from('t').insert([{ n: 1, d: false }, { n: 2, d: false }, { n: 3, d: false }]);
    const up = await db.from('t').update({ d: true }, [{ col: 'n', op: 'gt', val: 1 }]);
    assert.equal(up.count, 2); assert.deepEqual(up.rows.map((r) => r.n), [2, 3]); assert.equal(up.rows[0].d, true);
    assert.deepEqual((await db.from('t').select({ where: [{ col: 'd', op: 'eq', val: true }] })).rows.map((r) => r.n), [2, 3]);
    const del = await db.from('t').delete([{ col: 'n', op: 'eq', val: 2 }]);
    assert.equal(del.count, 1); assert.deepEqual(Object.keys(del.rows[0]), ['id']);
    assert.equal((await db.from('t').select()).rows.length, 2);
    assert.equal((await db.from('t').delete([{ col: 'n', op: 'eq', val: 42 }])).count, 0);
});
test('db: update and delete require a non-empty where, update a non-empty set, like the real SDK', async () => {
    const db = fresh().db;
    await rejects(db.from('t').delete(), 0, 'bad_request'); await rejects(db.from('t').delete([]), 0, 'bad_request');
    await rejects(db.from('t').update({ a: 1 }), 0, 'bad_request'); await rejects(db.from('t').update({ a: 1 }, []), 0, 'bad_request');
    await rejects(db.from('t').update({}, [{ col: 'a', op: 'eq', val: 1 }]), 0, 'bad_request');
});
test('db: the platform columns can not be sent, bad filters, operators and tables are rejected', async () => {
    const db = fresh().db;
    const W = [{ col: 'a', op: 'eq', val: 1 }];
    for (const k of ['id', 'user_id', 'created_at']) {
        await rejects(db.from('t').insert({ [k]: 1 }), 400, 'bad_request');
        await rejects(db.from('t').insert([{ a: 1 }, { [k]: 1 }]), 400, 'bad_request');
        await rejects(db.from('t').update({ [k]: 1 }, W), 400, 'bad_request');
    }
    await rejects(db.from('t').insert('x'), 0, 'bad_request'); await rejects(db.from('t').insert([[1]]), 0, 'bad_request'); await rejects(db.from('t').insert(null), 0, 'bad_request');
    await rejects(db.from('t').insert([]), 0, 'bad_request');
    await rejects(db.from('t').insert(Array.from({ length: 51 }, () => ({ a: 1 }))), 0, 'bad_request');
    await db.from('t').insert(Array.from({ length: 50 }, () => ({ a: 1 })));
    await rejects(db.from('t').select({ where: 'x' }), 0, 'bad_request');
    await rejects(db.from('t').select({ where: [{ col: 'a' }] }), 0, 'bad_request');
    await rejects(db.from('t').select({ where: [{ op: 'eq' }] }), 0, 'bad_request');
    await rejects(db.from('t').select({ where: [{ col: 'a', op: '=', val: 1 }] }), 400, 'bad_operator');
    await rejects(db.from('t').select({ where: [{ col: 'a', op: 'in', val: 1 }] }), 400, 'bad_request');
    await rejects(db.from('t').delete([null]), 0, 'bad_request');
    await rejects(db.from('t').update({ a: 1 }, 'x'), 0, 'bad_request');
    assert.throws(() => db.from(''), (e) => e.code === 'bad_request'); assert.throws(() => db.from(5), (e) => e.code === 'bad_request');
});
test('storage: upload returns a record with an id, list/url/remove follow the contract', async () => {
    const s = fresh().storage;
    assert.deepEqual(await s.list(), []);
    const rec = await s.upload({ name: 'a.png', type: 'image/png', size: 10 });
    assert.deepEqual(rec, { id: rec.id, name: 'a.png', contentType: 'image/png', bytes: 10 });
    const rec2 = await s.upload({ type: 'text/plain', size: 1 });
    assert.equal(rec2.name, 'file'); assert.notEqual(rec2.id, rec.id);
    assert.equal((await s.list()).length, 2);
    assert.match(await s.url(rec.id), /^data:/);
    assert.deepEqual(await s.remove(rec.id), { ok: true });
    assert.equal((await s.list()).length, 1);
    await rejects(s.url(rec.id), 404, 'not_found'); await rejects(s.remove(rec.id), 404, 'not_found'); await rejects(s.url('nope'), 404, 'not_found');
});
test('storage: type allowlist and 5 MB limit are enforced like the real service', async () => {
    const s = fresh().storage;
    for (const t of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'audio/mpeg', 'text/plain', 'IMAGE/PNG']) await s.upload({ type: t, size: 1 });
    for (const t of ['image/svg+xml', 'text/html', 'video/mp4', '']) await rejects(s.upload({ type: t, size: 1 }), 415, 'type_not_allowed');
    await s.upload({ type: 'image/png', size: 5 * 1024 * 1024 });
    await rejects(s.upload({ type: 'image/png', size: 5 * 1024 * 1024 + 1 }), 413, 'file_too_large');
    await rejects(s.upload(null), 0, 'bad_request'); await rejects(s.upload({ type: 'image/png' }), 0, 'bad_request');
});
test('the injected script installs the fake into a window', () => {
    const w = {}; new Function('window', FAKE_SCRIPT)(w);
    assert.equal(typeof w.vibe.db.from, 'function'); assert.equal(typeof w.vibe.storage.upload, 'function');
});

test('the check loads the fake only for apps that use accounts, tables or uploads, and only when the SDK is on', () => {
    const idx = '<script src="vibe.js"></script>';
    const sdk = '/*sdk*/';
    for (const call of ['vibe.auth.user()', 'vibe.db.from("a")', 'vibe.storage.list()']) {
        const out = filesForRun({ 'index.html': idx + call }, { vibe: true, sdk });
        assert.equal(out['vibe.js'], sdk + FAKE_SCRIPT, call);
    }
    assert.equal(filesForRun({ 'index.html': idx + 'vibe.api("nws","/x"); vibe.ai.ask("a")' }, { vibe: true, sdk })['vibe.js'], sdk);
    assert.equal(filesForRun({ 'index.html': idx + 'vibe.auth.user()' }, { vibe: false, sdk })['vibe.js'], undefined);
    assert.equal(filesForRun({ 'index.html': 'plain' }, { vibe: true, sdk })['vibe.js'], undefined);
    assert.equal(filesForRun({ 'index.html': idx + 'vibe.auth.user()', 'vibe.js': 'window.vibe={steal:1}' }, { vibe: true, sdk })['vibe.js'], sdk + FAKE_SCRIPT, 'a model-written vibe.js never survives');
});

// ---- in a real headless browser: no network is attempted, and the app is judged on its own behaviour
const hasPuppeteer = await import('puppeteer-core').then(() => true, () => false);
const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const real = (n, f) => test(n, { skip: CHROME && hasPuppeteer ? false : 'needs Chrome and puppeteer-core installed (otherwise the check fails open and proves nothing)' }, f);
const page = (js) => `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><script src="vibe.js"></script></head><body><!--${'x'.repeat(250)}--><input id="e"><button id="go" onclick="go()">Go</button><div id="out"></div><script>${js}</script></body></html>`;
const SCHEMA = JSON.stringify({ version: 1, tables: { todos: { columns: { title: { type: 'text', required: true } } } } });
const guard = 'function show(t){ document.getElementById("out").textContent = t; } function bad(e){ show("error " + e.code); }';
const run = (js) => fullChecks({ 'index.html': page(guard + js), [SCHEMA_FILE]: SCHEMA }, { vibe: true, chrome: CHROME });

real('an app using accounts, a table and uploads passes the browser check', async () => {
    const js = `function go(){ vibe.auth.ready.then(function(){ return vibe.auth.user(); }).then(function(u){ if(!u) return show("sign in"); return vibe.auth.signIn("a@b.co").then(function(){ return vibe.db.from("todos").insert({ title: "x" }); }).then(function(){ return vibe.db.from("todos").select(); }).then(function(rows){ show(rows.rows.length + " rows"); return vibe.storage.upload(new Blob(["hi"], { type: "text/plain" })); }); }).catch(bad); }`;
    const r = await run(js);
    assert.equal(r.ok, true, JSON.stringify(r.problems));
});
real('the page sees the fake state: a signed-in user and the rows it wrote (a wrong answer would throw)', async () => {
    const js = 'function go(){ vibe.auth.user().then(function(u){ return vibe.db.from("todos").insert({ title: "x" }).then(function(){ return vibe.db.from("todos").select(); }).then(function(rows){ if (!u || rows.rows.length !== 1) throw new Error("unexpected fake state"); }); }).catch(function(e){ setTimeout(function(){ throw e; }, 0); }); }';
    const r = await run(js);
    assert.equal(r.ok, true, JSON.stringify(r.problems));
});
real('the checks do not need a network: unguarded account, table and upload calls resolve instead of failing', async () => {
    const js = 'function go(){ vibe.auth.signIn("a@b.co"); vibe.db.from("todos").select(); vibe.storage.list(); vibe.auth.user(); }';
    const r = await run(js);
    assert.equal(r.ok, true, JSON.stringify(r.problems));
});
real('a real contract violation (sending user_id) is reported to the fix pass as a vibe error', async () => {
    const js = 'vibe.auth.ready.then(function(){}); function go(){ var o = { title: "x" }; o["user_" + "id"] = "me"; vibe.db.from("todos").insert(o); }';
    const r = await run(js);
    assert.equal(r.ok, false, JSON.stringify(r.problems));
    assert.ok(r.problems.some((p) => /user_id/.test(p) && /vibe SDK/.test(p)), JSON.stringify(r.problems));
});
