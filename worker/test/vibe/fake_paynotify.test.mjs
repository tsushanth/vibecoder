import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installFake, FAKE_SCRIPT } from '../../lib/vibeFake.js';
import { fullChecks, filesForRun } from '../../lib/browsercheck.js';
import { MANIFEST_FILE } from '../../lib/connectors.js';

const fresh = () => { const w = { vibe: { api() {}, ai: {} }, location: { assign() { throw new Error('the fake must never navigate'); }, href: 'x' } }; installFake(w); return w; };
const rejects = async (p, status, code) => {
    try { await p; } catch (e) { assert.ok(/^vibe/.test(e.message), e.message); assert.equal(e.status, status); assert.equal(e.code, code); return; }
    assert.fail('expected a rejection');
};

test('pay.checkout resolves a Stripe url in test mode without navigating, defaulting the quantity', async () => {
    const w = fresh();
    const r = await w.vibe.pay.checkout({ item: 'tee' });
    assert.match(r.url, /^https:\/\/checkout\.stripe\.com\//); assert.equal(r.mode, 'test');
    assert.deepEqual(Object.keys(r).sort(), ['mode', 'url']);
    await w.vibe.pay.checkout({ item: 'tee', quantity: 3, redirect: true, successPath: '/ok' });
    assert.equal(w.location.href, 'x');
});
test('pay.checkout rejects what the SDK rejects: no item, a non-string item, a bad quantity, no options', async () => {
    const p = fresh().vibe.pay;
    for (const bad of [undefined, null, {}, { item: '' }, { item: 5 }, { quantity: 1 }]) await rejects(p.checkout(bad), 0, 'bad_request');
    for (const q of [0, -1, 1.5, '2', NaN, null]) await rejects(p.checkout({ item: 'a', quantity: q }), 0, 'bad_request');
    await p.checkout({ item: 'a', quantity: 1 }); await p.checkout({ item: 'a', quantity: 100 });
});
test('pay.checkout works signed out (guest checkout)', async () => {
    const w = fresh(); await w.vibe.auth.signOut();
    assert.equal((await w.vibe.pay.checkout({ item: 'a' })).mode, 'test');
});
test('pay.orders returns [] when signed in and rejects 401 when signed out', async () => {
    const w = fresh();
    assert.deepEqual(await w.vibe.pay.orders(), []);
    await w.vibe.auth.signOut();
    await rejects(w.vibe.pay.orders(), 401, 'unauthorized');
});
test('notify.me resolves {ok:true} for a signed-in user and checks input like the SDK and the server', async () => {
    const w = fresh(); const n = w.vibe.notify;
    assert.deepEqual(await n.me({ subject: 'Hi', text: 'There' }), { ok: true });
    for (const bad of [undefined, null, 'x', {}, { subject: 'a' }, { text: 'a' }, { subject: ' ', text: 'a' }, { subject: 'a', text: ' ' }, { subject: 1, text: 'a' }, { subject: 'a', text: 2 }]) await rejects(n.me(bad), 0, 'bad_request');
    await n.me({ subject: 's'.repeat(120), text: 't'.repeat(2000) });
    await rejects(n.me({ subject: 's'.repeat(121), text: 'a' }), 400, 'invalid_content');
    await rejects(n.me({ subject: 'a', text: 't'.repeat(2001) }), 400, 'invalid_content');
});
test('notify.me rejects 401 when signed out, even before the length checks', async () => {
    const w = fresh(); await w.vibe.auth.signOut();
    await rejects(w.vibe.notify.me({ subject: 'a', text: 'b' }), 401, 'unauthorized');
    await rejects(w.vibe.notify.me({ subject: 's'.repeat(500), text: 'b' }), 401, 'unauthorized');
});
test('the injected script installs pay and notify', () => {
    const w = {}; new Function('window', FAKE_SCRIPT)(w);
    assert.equal(typeof w.vibe.pay.checkout, 'function'); assert.equal(typeof w.vibe.pay.orders, 'function'); assert.equal(typeof w.vibe.notify.me, 'function');
});
test('the check loads the fake for apps that only use vibe.pay or vibe.notify', () => {
    const idx = '<script src="vibe.js"></script>'; const sdk = '/*sdk*/';
    for (const call of ['vibe.pay.checkout({item:"a"})', 'vibe.pay.orders()', 'vibe.notify.me({subject:"a",text:"b"})']) {
        assert.equal(filesForRun({ 'index.html': idx + call }, { vibe: true, sdk })['vibe.js'], sdk + FAKE_SCRIPT, call);
    }
});

// ---- in a real headless browser
const hasPuppeteer = await import('puppeteer-core').then(() => true, () => false);
const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const real = (n, f) => test(n, { skip: CHROME && hasPuppeteer ? false : 'needs Chrome and puppeteer-core installed (otherwise the check fails open and proves nothing)' }, f);
const page = (js) => `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><script src="vibe.js"></script></head><body><!--${'x'.repeat(250)}--><button id="go" onclick="go()">Go</button><div id="out"></div><script>${js}</script></body></html>`;
const CATALOG = JSON.stringify({ pay: { catalog: [{ id: 'tee', name: 'Tee', amountCents: 2500, currency: 'usd', mode: 'payment' }] } });
const guard = 'function show(t){ document.getElementById("out").textContent = t; }';
const run = (js) => fullChecks({ 'index.html': page(guard + js), [MANIFEST_FILE]: CATALOG }, { vibe: true, chrome: CHROME });

real('a store whose buy button calls vibe.pay.checkout passes, and the page stays on the app (no redirect to Stripe)', async () => {
    const js = 'function go(){ vibe.pay.checkout({ item: "tee" }).then(function(r){ show("mode " + r.mode); }).catch(function(e){ show("err " + e.code); }); }';
    const r = await run(js);
    assert.equal(r.ok, true, JSON.stringify(r.problems));
});
real('unguarded pay and notify calls resolve instead of failing the app for network', async () => {
    const js = 'function go(){ vibe.pay.checkout({ item: "tee" }); vibe.pay.orders(); vibe.auth.user(); vibe.notify.me({ subject: "a", text: "b" }); }';
    const r = await run(js);
    assert.equal(r.ok, true, JSON.stringify(r.problems));
});
real('the page sees the fake answers: mode test, an empty orders list, notify ok (a wrong answer would throw)', async () => {
    const js = 'function go(){ Promise.all([vibe.pay.checkout({ item: "tee" }), vibe.pay.orders(), vibe.notify.me({ subject: "a", text: "b" })]).then(function(a){ if (a[0].mode !== "test" || a[1].length !== 0 || !a[2].ok) throw new Error("unexpected fake state"); }).catch(function(e){ setTimeout(function(){ throw e; }, 0); }); vibe.auth.user(); }';
    const r = await run(js);
    assert.equal(r.ok, true, JSON.stringify(r.problems));
});
real('a contract violation (checkout without an item) is reported to the fix pass as a vibe error', async () => {
    const js = 'var none = ""; var ok = "tee"; function go(){ vibe.pay.checkout({ item: none }); vibe.pay.checkout({ item: ok }); }';
    const r = await run(js);
    assert.equal(r.ok, false, JSON.stringify(r.problems));
    assert.ok(r.problems.some((p) => /vibe SDK/.test(p) && /vibe\.pay/.test(p)), JSON.stringify(r.problems));
});
