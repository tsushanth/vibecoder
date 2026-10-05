import test from 'node:test';
import assert from 'node:assert/strict';
import { MANIFEST_FILE, parseManifestFile, declaredConnectors } from '../../lib/connectors.js';
import { vibeProblems, injectSdk, usesVibe, usesBackendSdk, VIBE_RULES } from '../../lib/vibe.js';
import { staticChecks } from '../../lib/checks.js';

const page = (js, head = '<script src="vibe.js"></script>', body = '') => `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width">${head}</head><body><!--${'x'.repeat(250)}-->${body}<button onclick="go()">Go</button><script>${js}</script></body></html>`;
const tee = { id: 'tee', name: 'T-shirt', amountCents: 2500, currency: 'usd', mode: 'payment' };
const pro = { id: 'pro', name: 'Pro plan', amountCents: 900, currency: 'usd', mode: 'subscription', interval: 'month' };
const mug = { id: 'mug', name: 'Mug', amountCents: 1200, currency: 'usd', mode: 'payment', maxQuantity: 5 };
const man = (catalog, extra = {}) => JSON.stringify({ pay: { catalog }, ...extra });
const CHECK = 'vibe.pay.checkout({ item: "tee" }).catch(function (e) { show(e.code); });';
const store = (js = CHECK, catalog = [tee, pro, mug], more = {}) => ({ 'index.html': page(js), [MANIFEST_FILE]: man(catalog), ...more });
const one = (files, re) => {
    const p = vibeProblems(files, { enabled: true });
    assert.equal(p.length, 1, p.join(' | '));
    assert.match(p[0], re);
    return p[0];
};

// ---- the manifest file: pay is validated with the vendored platform validator
test('a pay-only manifest is accepted and normalised (connectors object present but empty)', () => {
    const r = parseManifestFile(man([tee, pro, mug]));
    assert.equal(r.ok, true, JSON.stringify(r.problems));
    assert.deepEqual(r.manifest, { connectors: {}, pay: { catalog: [tee, pro, mug] } });
    assert.deepEqual(Object.keys(r.manifest.pay.catalog[1]), ['id', 'name', 'amountCents', 'currency', 'mode', 'interval']);
});
test('pay next to connectors keeps both', () => {
    const c = { host: 'api.example.com', paths: ['/v1/*'], methods: ['GET'] };
    const r = parseManifestFile(JSON.stringify({ connectors: { stocks: c }, pay: { catalog: [tee] } }));
    assert.equal(r.ok, true, JSON.stringify(r.problems));
    assert.deepEqual(Object.keys(r.manifest).sort(), ['connectors', 'pay']);
    assert.deepEqual(Object.keys(r.manifest.connectors), ['stocks']);
});
test('connector-only manifests are unchanged: no pay key appears', () => {
    const r = parseManifestFile(JSON.stringify({ connectors: { s: { host: 'api.example.com', paths: ['/v1/*'], methods: ['GET'] } } }));
    assert.equal(r.ok, true); assert.deepEqual(Object.keys(r.manifest), ['connectors']);
});
test('an empty connectors object with a pay catalog is not "no manifest"', () => {
    const r = parseManifestFile(JSON.stringify({ connectors: {}, pay: { catalog: [tee] } }));
    assert.equal(r.ok, true); assert.notEqual(r.manifest, null); assert.equal(r.manifest.pay.catalog.length, 1);
});
test('an invalid catalog is rejected with prefixed problems the fix pass can act on', () => {
    for (const [bad, re] of [
        [[{ ...tee, amountCents: 10 }], /pay: .*amountCents/],
        [[{ ...tee, currency: 'xyz' }], /pay: .*currency/],
        [[{ ...tee, mode: 'sub' }], /pay: .*mode/],
        [[{ ...pro, interval: undefined }], /pay: .*interval/],
        [[tee, tee], /pay: .*duplicate/],
        [[{ ...tee, price: 5 }], /pay: .*unknown field "price"/],
        [[], /pay: .*at least one/],
        [[{ ...tee, id: 'Tee!' }], /pay: .*invalid id/],
    ]) {
        const r = parseManifestFile(man(bad));
        assert.equal(r.ok, false, JSON.stringify(bad)); assert.equal(r.manifest, null);
        assert.ok(r.problems.some((p) => re.test(p)), `${JSON.stringify(bad)} -> ${r.problems.join(' | ')}`);
    }
});
test('pay that is not an object, or has unknown fields, is rejected', () => {
    for (const pay of [null, 'x', [], 5, { catalog: [tee], extra: 1 }, {}]) {
        const r = parseManifestFile(JSON.stringify({ pay }));
        assert.equal(r.ok, false, JSON.stringify(pay));
    }
});
test('a manifest with neither connectors nor pay is still rejected', () => {
    for (const t of ['{}', '{"x":1}', '{"connectors":5}', '{"connectors":[]}']) assert.equal(parseManifestFile(t).ok, false, t);
});
test('declaredConnectors is empty for a pay-only manifest', () => {
    assert.deepEqual(declaredConnectors({ [MANIFEST_FILE]: man([tee]) }), []);
});

// ---- detection
test('vibe.pay counts as vibe use and as a backend (faked in the browser check) use', () => {
    const f = { 'index.html': page('vibe.pay.orders()') };
    assert.equal(usesVibe(f), true); assert.equal(usesBackendSdk(f), true);
    const g = { 'index.html': page('vibe.notify.me({subject:"a",text:"b"})') };
    assert.equal(usesVibe(g), true); assert.equal(usesBackendSdk(g), true);
    assert.equal(usesVibe({ 'index.html': page('const x = "myvibe.pay.checkout"; // devibe.notify') }), false);
});

// ---- static checks: the happy path and its mismatches
test('a store whose checkout item is in the catalog has no problems', () => {
    assert.deepEqual(vibeProblems(store(), { enabled: true }), []);
    assert.deepEqual(vibeProblems(store('vibe.pay.checkout({ item: "pro", quantity: 1 })'), { enabled: true }), []);
    assert.deepEqual(vibeProblems(store("vibe.pay.checkout({item:'tee'}); vibe.pay.checkout({ item: `pro` })"), { enabled: true }), []);
    assert.deepEqual(vibeProblems(store('vibe.pay.checkout({ "item": "mug", quantity: 5 })'), { enabled: true }), []);
});
test('staticChecks passes a good store end to end', () => {
    assert.equal(staticChecks(store(), { vibe: true }).ok, true);
});
test('a checkout item that is not in the catalog is a problem naming it and the catalog ids', () => {
    const m = one(store('vibe.pay.checkout({ item: "hoodie" })'), /"hoodie"/);
    assert.match(m, /tee/); assert.match(m, /pro/); assert.match(m, /mug/);
    const both = vibeProblems(store('vibe.pay.checkout({ item: "a1" }); vibe.pay.checkout({ item: "b2" }); vibe.pay.checkout({ item: "tee" })'), { enabled: true });
    assert.equal(both.length, 2);
});
test('the same unknown item used twice is reported once', () => {
    assert.equal(vibeProblems(store('vibe.pay.checkout({item:"zz"}); vibe.pay.checkout({item:"zz"});'), { enabled: true }).length, 1);
});
test('a catalog with no vibe.pay use anywhere is a problem (declare only what the app sells)', () => {
    const f = { 'index.html': page('var x = 1;'), [MANIFEST_FILE]: man([tee]) };
    one(f, /never calls vibe\.pay\.checkout/);
});
test('vibe.pay use with no catalog is a problem, with no manifest or a connectors-only one', () => {
    one({ 'index.html': page(CHECK) }, /no pay catalog/);
    const c = JSON.stringify({ connectors: { s: { host: 'api.example.com', paths: ['/v1/*'], methods: ['GET'] } } });
    const p = vibeProblems({ 'index.html': page(`${CHECK} vibe.api("s","/v1/x").catch(function(){});`), [MANIFEST_FILE]: c }, { enabled: true });
    assert.equal(p.length, 1); assert.match(p[0], /no pay catalog/);
});
test('an invalid pay catalog is reported once as an invalid manifest, without extra noise about the catalog', () => {
    const f = store(CHECK, [{ ...tee, amountCents: 1 }]);
    const p = vibeProblems(f, { enabled: true });
    assert.equal(p.length, 1, p.join(' | ')); assert.match(p[0], /vibe\.manifest\.json is invalid: pay: /);
});
test('the browser may never send a price: amount, price, currency, name and friends in checkout are problems', () => {
    for (const k of ['amount', 'price', 'amountCents', 'currency', 'name', 'unit_amount', 'total', 'priceId']) {
        const m = one(store(`vibe.pay.checkout({ item: "tee", ${k}: 1 })`), /only (?:an )?item and (?:a )?quantity/);
        assert.match(m, new RegExp(`"${k}"`));
    }
});
test('checkout options that are allowed do not trip the price check', () => {
    assert.deepEqual(vibeProblems(store('vibe.pay.checkout({ item: "tee", quantity: 1, successPath: "/thanks", cancelPath: "/", redirect: false })'), { enabled: true }), []);
});
test('a quantity above the item maxQuantity (default 1) is a problem; within it is fine', () => {
    one(store('vibe.pay.checkout({ item: "tee", quantity: 2 })'), /quantity 2.*"tee".*at most 1/);
    one(store('vibe.pay.checkout({ item: "mug", quantity: 6 })'), /quantity 6.*"mug".*at most 5/);
    assert.deepEqual(vibeProblems(store('vibe.pay.checkout({ item: "mug", quantity: 5 })'), { enabled: true }), []);
});
test('dynamic items are allowed when every catalog id appears as a string in the code; a never-mentioned id is a problem', () => {
    const ok = `var P = [{id:"tee"},{id:"pro"},{id:"mug"}]; function buy(id){ return vibe.pay.checkout({ item: id, quantity: 1 }); }`;
    assert.deepEqual(vibeProblems(store(ok), { enabled: true }), []);
    const missing = `var P = [{id:"tee"},{id:"pro"}]; function buy(id){ return vibe.pay.checkout({ item: id }); }`;
    one(store(missing), /catalog item "mug"/);
    const viaObj = `var o = { item: "tee" }; vibe.pay.checkout(o); var q = ["pro", 'mug'];`;
    assert.deepEqual(vibeProblems(store(viaObj), { enabled: true }), []);
});
test('dynamic items: ids that are not quoted strings (bare words, longer strings) do not count', () => {
    const p = vibeProblems(store(`/* tee pro mug */ var a = "teeshirt", b = "xpro", c = "mug2"; function buy(id){ return vibe.pay.checkout({ item: id }); }`), { enabled: true });
    assert.equal(p.length, 3, p.join(' | '));
    for (const id of ['tee', 'pro', 'mug']) assert.ok(p.some((x) => x.includes(`"${id}"`)));
});
test('an item-less checkout call is a problem; a spread might supply it', () => {
    one(store('vibe.pay.checkout({ quantity: 1 })'), /needs an item/);
    assert.deepEqual(vibeProblems(store('var o = { item: "tee" }; vibe.pay.checkout({ ...o }); var l = ["pro","mug"];'), { enabled: true }), []);
});
test('catalog ids with regex characters are matched literally', () => {
    const cat = [{ ...tee, id: 'a-b_c' }, { ...mug, id: 'x1' }];
    const js = 'var l = ["a-b_c","x1"]; function buy(i){ vibe.pay.checkout({ item: i }); }';
    assert.deepEqual(vibeProblems(store(js, cat), { enabled: true }), []);
    assert.equal(vibeProblems(store('var l = ["a_b_c","x1"]; function buy(i){ vibe.pay.checkout({ item: i }); }', cat), { enabled: true }).length, 1);
});
test('card number inputs are a problem: the page never asks for card details', () => {
    for (const input of ['<input autocomplete="cc-number">', '<input name="cardNumber">', '<input id="card-number">', '<input placeholder="Card number">', '<input name="cvv">', '<input name="cvc" type="text">', '<input autocomplete="cc-exp">']) {
        const f = store(CHECK); f['index.html'] = page(CHECK, '<script src="vibe.js"></script>', input);
        one(f, /never ask for (?:a )?card/i);
    }
    const f = store(CHECK); f['index.html'] = page(CHECK, '<script src="vibe.js"></script>', '<input name="email" type="email"><p>Pay securely by card at Stripe checkout.</p>');
    assert.deepEqual(vibeProblems(f, { enabled: true }), []);
});
test('vibe.pay.orders needs vibe.auth (orders are per signed-in user)', () => {
    const js = `${CHECK} vibe.pay.orders().then(function(o){ show(o); }).catch(function(e){});`;
    one(store(js), /vibe\.pay\.orders.*vibe\.auth/);
    const withAuth = `${js} vibe.auth.user();`;
    assert.deepEqual(vibeProblems(store(withAuth), { enabled: true }), []);
});
test('checkout works without vibe.auth (guest checkout)', () => {
    assert.ok(!/vibe\.auth/.test(CHECK));
    assert.deepEqual(vibeProblems(store(), { enabled: true }), []);
});
test('when the proxy is off, vibe.pay and a pay manifest are both problems that say to remove them', () => {
    const p = vibeProblems(store(), { enabled: false });
    assert.ok(p.some((x) => /vibe\.pay/.test(x) && /not available/.test(x)), p.join(' | '));
    assert.ok(p.some((x) => /vibe\.manifest\.json is not available/.test(x)));
    const n = vibeProblems({ 'index.html': page('vibe.notify.me({subject:"a",text:"b"})') }, { enabled: false });
    assert.ok(n.some((x) => /vibe\.notify/.test(x)), n.join(' | '));
});
test('vibe.pay without the script tag is reported with the same hint as other SDK use', () => {
    const f = store(); f['index.html'] = page(CHECK, '');
    const p = vibeProblems(f, { enabled: true });
    assert.equal(p.length, 1); assert.match(p[0], /vibe\.pay/); assert.match(p[0], /vibe\.js/);
});
test('a vibe.js the model wrote is ignored when scanning for pay calls', () => {
    const f = { 'index.html': page('var x=1;'), 'vibe.js': 'vibe.pay.checkout({item:"nope"})', [MANIFEST_FILE]: man([tee]) };
    one(f, /never calls vibe\.pay\.checkout/);
});

// ---- the shipped bundle
test('injectSdk keeps a valid pay manifest, normalised, at the root only when the proxy is on', () => {
    const f = store();
    const out = injectSdk(f, { sdk: 'SDK', enabled: true });
    assert.deepEqual(JSON.parse(out[MANIFEST_FILE]), { connectors: {}, pay: { catalog: [tee, pro, mug] } });
    assert.ok(out[MANIFEST_FILE].endsWith('\n'));
    assert.equal(out['vibe.js'], 'SDK');
    assert.equal(MANIFEST_FILE in injectSdk(f, { sdk: 'SDK', enabled: false }), false);
    assert.equal(MANIFEST_FILE in injectSdk({ ...f, [MANIFEST_FILE]: man([{ ...tee, amountCents: 1 }]) }, { sdk: 'SDK', enabled: true }), false);
    assert.equal(`app/${MANIFEST_FILE}` in injectSdk({ ...f, [`app/${MANIFEST_FILE}`]: man([tee]) }, { sdk: 'SDK', enabled: true }), false);
});

// ---- what the model is taught
test('the rules teach payments: catalog, item only, owner keys, test mode, no card fields, refusals with a free simulator', () => {
    for (const re of [
        /vibe\.pay\.checkout\(\{ ?item/,
        /"pay":\{"catalog":\[/,
        /amountCents/, /currency/, /"payment"/, /"subscription"/, /interval/, /maxQuantity/,
        /never (?:send|put|compute|take) (?:a |any )?(?:price|amount)/i,
        /owner (?:still )?needs to add (?:their )?Stripe keys/i,
        /stripe_key_missing/,
        /test mode/i,
        /never ask for (?:a )?card number/i,
        /gambling/i, /adult/i, /weapons/i, /binary options/i, /investment advice/i,
        /free (?:demo|simulator)/i,
        /vibe\.pay\.orders/,
        /payments_not_configured|unknown_item/,
        /Stripe checkout page/i,
    ]) assert.match(VIBE_RULES, re);
});
