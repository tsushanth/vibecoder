import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(fileURLToPath(new URL('../vibe.js', import.meta.url)), 'utf8');
const MB = 1024 * 1024;

function load(win = {}, { timers } = {}) {
    const ctx = { location: { hostname: 'myapp.vibebuild.cc' }, fetch: async () => { throw new Error('device must not use the network'); }, AbortController, setTimeout: timers?.setTimeout || setTimeout, clearTimeout: timers?.clearTimeout || clearTimeout, JSON, Promise, Error, encodeURIComponent, Object, Array, Number, String, URLSearchParams, Blob, atob, Uint8Array, Math, isFinite, ...win };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx);
    return ctx.vibe.device;
}
const native = (Plugins, extra = {}) => ({ Capacitor: { isNativePlatform: () => true, Plugins, ...extra } });
const plain = (x) => JSON.parse(JSON.stringify(x));
async function rejectsWith(p, code) {
    try { await p; } catch (e) { assert.equal(e.code, code, `expected ${code} got ${e.code}: ${e.message}`); assert.equal(e.status, 0); assert.ok(e instanceof Error); return e; }
    assert.fail('expected rejection ' + code);
}
function fakeInput(files, fire) {
    const handlers = {};
    const el = { attrs: {}, files, addEventListener: (n, f) => { handlers[n] = f; }, setAttribute: (k, v) => { el.attrs[k] = v; }, click: () => { setTimeout(() => fire(el, handlers), 0); } };
    return el;
}
const doc = (files, fire, made) => ({ document: { createElement: () => { if (made) made.n++; return fakeInput(files, fire); } } });

test('vibe.device exposes exactly isNative, camera.capture, geolocation.get, share, haptics.tap', () => {
    const d = load();
    assert.deepEqual(Object.keys(d).sort(), ['camera', 'geolocation', 'haptics', 'isNative', 'share']);
    assert.deepEqual(Object.keys(d.camera), ['capture']);
    assert.deepEqual(Object.keys(d.geolocation), ['get']);
    assert.deepEqual(Object.keys(d.haptics), ['tap']);
    assert.equal(d.push, undefined);
});

test('isNative is true only when Capacitor reports a native platform', () => {
    assert.equal(load().isNative(), false);
    assert.equal(load({ Capacitor: {} }).isNative(), false);
    assert.equal(load({ Capacitor: { isNativePlatform: () => 'yes' } }).isNative(), false);
    assert.equal(load({ Capacitor: { isNativePlatform: () => { throw new Error('x'); } } }).isNative(), false);
    assert.equal(load({ Capacitor: { isNativePlatform: () => false } }).isNative(), false);
    assert.equal(load(native({})).isNative(), true);
});

// ---- geolocation
test('geolocation web: success maps coords and the default timeout is 15000', async () => {
    let opts;
    const d = load({ navigator: { geolocation: { getCurrentPosition: (ok, err, o) => { opts = o; ok({ coords: { latitude: 1.5, longitude: 2.5, accuracy: 9 }, timestamp: 7 }); } } } });
    assert.deepEqual(plain(await d.geolocation.get()), { lat: 1.5, lng: 2.5, accuracy: 9, timestamp: 7 });
    assert.equal(opts.timeout, 15000); assert.equal(opts.enableHighAccuracy, false); assert.equal(opts.maximumAge, 60000);
});
test('geolocation web: errors map to denied, timeout, unavailable', async () => {
    const nav = (code) => ({ navigator: { geolocation: { getCurrentPosition: (ok, err) => err({ code }) } } });
    await rejectsWith(load(nav(1)).geolocation.get(), 'denied');
    await rejectsWith(load(nav(3)).geolocation.get(), 'timeout');
    await rejectsWith(load(nav(2)).geolocation.get(), 'unavailable');
});
test('geolocation web: a browser that never answers still settles (own guard timer)', async () => {
    let fire; const timers = { setTimeout: (fn, ms) => { fire = { fn, ms }; return 1; }, clearTimeout: () => {} };
    const d = load({ navigator: { geolocation: { getCurrentPosition: () => {} } } }, { timers });
    const p = d.geolocation.get({ timeoutMs: 2000 });
    assert.ok(fire.ms > 2000 && fire.ms <= 5000, 'guard fires shortly after the browser timeout, got ' + fire.ms);
    fire.fn();
    await rejectsWith(p, 'timeout');
});
test('geolocation: unsupported without navigator.geolocation', async () => {
    await rejectsWith(load({ navigator: {} }).geolocation.get(), 'unsupported');
    await rejectsWith(load().geolocation.get(), 'unsupported');
});
test('geolocation: bad arguments are rejected without calling the browser', async () => {
    let called = 0;
    const d = load({ navigator: { geolocation: { getCurrentPosition: () => { called++; } } } });
    for (const bad of ['x', [], null, { highAccuracy: 'yes' }, { timeoutMs: 5 }, { timeoutMs: 1e9 }, { timeoutMs: NaN }, { timeoutMs: 1500.5 }, { maxAgeMs: -1 }, { maxAgeMs: 1e9 }]) await rejectsWith(d.geolocation.get(bad), 'bad_request');
    assert.equal(called, 0);
});
test('geolocation native: uses the Geolocation plugin; denial maps to denied', async () => {
    let seen;
    const d = load(native({ Geolocation: { getCurrentPosition: (o) => { seen = o; return Promise.resolve({ coords: { latitude: 3, longitude: 4, accuracy: 1 }, timestamp: 9 }); } } }));
    const r = await d.geolocation.get({ highAccuracy: true });
    assert.equal(r.lat, 3); assert.equal(seen.enableHighAccuracy, true); assert.equal(seen.timeout, 15000);
    const d2 = load(native({ Geolocation: { getCurrentPosition: () => Promise.reject(new Error('Location permission was denied')) } }));
    await rejectsWith(d2.geolocation.get(), 'denied');
});
test('geolocation native: an unimplemented plugin falls back to the web API', async () => {
    const d = load({ ...native({ Geolocation: { getCurrentPosition: () => Promise.reject(new Error('"Geolocation" plugin is not implemented on android')) } }), navigator: { geolocation: { getCurrentPosition: (ok) => ok({ coords: { latitude: 8, longitude: 9, accuracy: 2 }, timestamp: 1 }) } } });
    assert.equal((await d.geolocation.get()).lat, 8);
});

// ---- share
test('share: navigator.share, with user abort resolving shared:false', async () => {
    let got;
    const d = load({ navigator: { share: (o) => { got = o; return Promise.resolve(); } } });
    assert.deepEqual(plain(await d.share({ title: 'T', url: 'https://x.y/z' })), { shared: true, copied: false });
    assert.equal(got.url, 'https://x.y/z');
    const d2 = load({ navigator: { share: () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })) } });
    assert.equal((await d2.share({ text: 'hi' })).shared, false);
});
test('share: falls back to the clipboard, then to unsupported', async () => {
    let wrote;
    const d = load({ navigator: { clipboard: { writeText: (s) => { wrote = s; return Promise.resolve(); } } } });
    assert.deepEqual(plain(await d.share({ title: 'A', text: 'B', url: 'http://c.d' })), { shared: false, copied: true });
    assert.equal(wrote, 'A\nB\nhttp://c.d');
    await rejectsWith(load({ navigator: {} }).share({ text: 'x' }), 'unsupported');
    await rejectsWith(load({ navigator: { clipboard: { writeText: () => Promise.reject(new Error('blocked')) } } }).share({ text: 'x' }), 'unsupported');
});
test('share: a failing navigator.share (not an abort) falls back to the clipboard', async () => {
    let wrote;
    const d = load({ navigator: { share: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })), clipboard: { writeText: (s) => { wrote = s; return Promise.resolve(); } } } });
    assert.equal((await d.share({ text: 'hi' })).copied, true); assert.equal(wrote, 'hi');
    const d2 = load({ navigator: { share: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })) } });
    await rejectsWith(d2.share({ text: 'hi' }), 'denied');
});
test('share: bad arguments and dangerous URLs are rejected without side effects', async () => {
    let called = 0;
    const d = load({ navigator: { share: () => { called++; return Promise.resolve(); }, clipboard: { writeText: () => { called++; return Promise.resolve(); } } } });
    const bads = [undefined, null, 'hi', [], {}, { text: '' }, { text: 5 }, { title: 'x'.repeat(201) }, { url: 'javascript:alert(1)' }, { url: 'data:text/html,hi' }, { url: 'file:///etc/passwd' }, { url: 'https://a.b/ c' }, { text: 'x', files: [] }, { text: 'a'.repeat(2001) }];
    for (const b of bads) await rejectsWith(d.share(b), 'bad_request');
    assert.equal(called, 0);
});
test('share native: uses the Share plugin, cancel is shared:false, other errors surface', async () => {
    let seen;
    const mk = (fn) => load(native({ Share: { share: fn } }));
    assert.deepEqual(plain(await mk((o) => { seen = o; return Promise.resolve(); }).share({ text: 'hi' })), { shared: true, copied: false });
    assert.equal(seen.text, 'hi');
    assert.equal((await mk(() => Promise.reject(new Error('Share canceled'))).share({ text: 'hi' })).shared, false);
    await rejectsWith(mk(() => Promise.reject(new Error('boom'))).share({ text: 'hi' }), 'unavailable');
});

// ---- haptics
test('haptics web: navigator.vibrate patterns, best effort and never rejecting for lack of hardware', async () => {
    let pat;
    const d = load({ navigator: { vibrate: (p) => { pat = p; return true; } } });
    assert.equal((await d.haptics.tap('light')).ok, true); assert.equal(pat, 10);
    await d.haptics.tap('success'); assert.deepEqual(Array.from(pat), [10, 30, 10]);
    assert.equal((await load({ navigator: {} }).haptics.tap('heavy')).ok, false);
    assert.equal((await load().haptics.tap('heavy')).ok, false);
    assert.equal((await load({ navigator: { vibrate: () => { throw new Error('no'); } } }).haptics.tap('heavy')).ok, false);
});
test('haptics: unknown kinds are rejected without side effects', async () => {
    const d = load({ navigator: { vibrate: () => { throw new Error('must not be called'); } } });
    for (const k of [undefined, 'LIGHT', '__proto__', 'toString', ['light'], 5, null]) await rejectsWith(d.haptics.tap(k), 'bad_request');
});
test('haptics native: impact for light/medium/heavy, notification for the rest; plugin failure is ok:false', async () => {
    const calls = [];
    const d = load(native({ Haptics: { impact: (o) => { calls.push(['i', o.style]); return Promise.resolve(); }, notification: (o) => { calls.push(['n', o.type]); return Promise.resolve(); } } }));
    await d.haptics.tap('medium'); await d.haptics.tap('error');
    assert.deepEqual(calls, [['i', 'MEDIUM'], ['n', 'ERROR']]);
    const d2 = load(native({ Haptics: { impact: () => Promise.reject(new Error('x')) } }));
    assert.equal((await d2.haptics.tap('light')).ok, false);
});
test('native flag set but plugin missing falls back to web; registerPlugin is also tried', async () => {
    assert.equal((await load({ ...native({}), navigator: { vibrate: () => true } }).haptics.tap('light')).ok, true);
    const d = load(native({}, { registerPlugin: (n) => { assert.equal(n, 'Haptics'); return { impact: () => Promise.resolve() }; } }));
    assert.equal((await d.haptics.tap('light')).ok, true);
});
test('a Capacitor proxy plugin that is unimplemented falls back to web', async () => {
    const d = load({ ...native({ Haptics: { impact: () => Promise.reject(new Error('"Haptics" plugin is not implemented on android')) } }), navigator: { vibrate: () => true } });
    assert.equal((await d.haptics.tap('light')).ok, true);
});

// ---- camera
const png = (extra = {}) => ({ type: 'image/png', size: 100, name: 'a.png', ...extra });
test('camera web: input with capture attribute resolves {blob,type,size,name}', async () => {
    const f = png(); let el;
    const d = load(doc([f], (e, h) => { el = e; h.change(); }));
    const r = await d.camera.capture({ facing: 'user' });
    assert.equal(r.blob, f); assert.equal(r.type, 'image/png'); assert.equal(r.size, 100); assert.equal(r.name, 'a.png');
    assert.deepEqual(Object.keys(r).sort(), ['blob', 'name', 'size', 'type']);
    assert.equal(el.attrs.capture, 'user'); assert.equal(el.type, 'file'); assert.match(el.accept, /image/);
    const d2 = load(doc([png({ name: '' })], (e, h) => h.change()));
    assert.equal((await d2.camera.capture()).name, 'photo');
});
test('camera web: default facing is environment', async () => {
    let el; const d = load(doc([png()], (e, h) => { el = e; h.change(); }));
    await d.camera.capture(); assert.equal(el.attrs.capture, 'environment');
});
test('camera web: cancel event and an empty selection reject cancelled', async () => {
    await rejectsWith(load(doc([], (e, h) => h.cancel())).camera.capture(), 'cancelled');
    await rejectsWith(load(doc([], (e, h) => h.change())).camera.capture(), 'cancelled');
});
test('camera web: non-images and oversized files are rejected; maxBytes is configurable and bounded', async () => {
    const mk = (f) => load(doc([f], (e, h) => h.change()));
    await rejectsWith(mk(png({ type: 'text/html' })).camera.capture(), 'bad_request');
    await rejectsWith(mk(png({ size: 5 * MB + 1 })).camera.capture(), 'bad_request');
    assert.equal((await mk(png({ size: 5 * MB })).camera.capture()).size, 5 * MB);
    assert.equal((await mk(png({ size: 9 * MB })).camera.capture({ maxBytes: 10 * MB })).size, 9 * MB);
    await rejectsWith(mk(png({ size: 200 })).camera.capture({ maxBytes: 100 }), 'bad_request');
    await rejectsWith(mk(png()).camera.capture({ maxBytes: 10 * MB + 1 }), 'bad_request');
    await rejectsWith(mk(png()).camera.capture({ maxBytes: 0 }), 'bad_request');
});
test('camera web: never hangs, a dialog that never answers rejects with timeout', async () => {
    const t = []; const timers = { setTimeout: (fn, ms) => { t.push({ fn, ms }); return t.length; }, clearTimeout: () => {} };
    const d = load(doc([], () => {}), { timers });
    const p = d.camera.capture({ timeoutMs: 2000 });
    assert.equal(t.length, 1); assert.equal(t[0].ms, 2000);
    t[0].fn();
    await rejectsWith(p, 'timeout');
    const p2 = load(doc([], () => {}), { timers }).camera.capture();
    assert.equal(t[1].ms, 300000, 'documented default is 5 minutes');
    t[1].fn(); await rejectsWith(p2, 'timeout');
});
test('camera web: unsupported without document.createElement', async () => {
    await rejectsWith(load().camera.capture(), 'unsupported');
    await rejectsWith(load({ document: {} }).camera.capture(), 'unsupported');
});
test('camera: bad arguments are rejected before touching the DOM', async () => {
    const made = { n: 0 }; const d = load(doc([], () => {}, made));
    for (const b of ['x', [], null, { facing: 'rear' }, { maxWidth: 10 }, { maxWidth: 1.5 }, { quality: 0 }, { quality: '80' }, { timeoutMs: 10 }, { timeoutMs: 1e9 }, { maxBytes: 'big' }]) await rejectsWith(d.camera.capture(b), 'bad_request');
    assert.equal(made.n, 0);
});
test('camera native: safe options, never saves to the gallery, converts to a Blob, maps cancel and denial', async () => {
    let seen;
    const Camera = { getPhoto: (o) => { seen = o; return Promise.resolve({ dataUrl: 'data:image/jpeg;base64,AAAAAAAA' }); } };
    const d = load(native({ Camera }));
    const r = await d.camera.capture({ maxWidth: 800, facing: 'user' });
    assert.equal(seen.saveToGallery, false); assert.equal(seen.width, 800); assert.equal(seen.direction, 'FRONT'); assert.equal(seen.resultType, 'dataUrl');
    assert.equal(r.size, 6); assert.equal(r.blob.size, 6); assert.equal(r.type, 'image/jpeg'); assert.equal(r.name, 'photo.jpg');
    Camera.getPhoto = () => Promise.reject(new Error('User cancelled photos app'));
    await rejectsWith(d.camera.capture(), 'cancelled');
    Camera.getPhoto = () => Promise.reject(new Error('User denied access to camera'));
    await rejectsWith(d.camera.capture(), 'denied');
    Camera.getPhoto = () => Promise.resolve({});
    await rejectsWith(d.camera.capture(), 'unavailable');
});
test('camera native: an oversized photo is rejected before it is decoded', async () => {
    const big = 'data:image/jpeg;base64,' + 'A'.repeat(8 * MB);
    const d = load(native({ Camera: { getPhoto: () => Promise.resolve({ dataUrl: big }) } }));
    await rejectsWith(d.camera.capture(), 'bad_request');
});
test('camera native: unimplemented plugin falls back to the web input', async () => {
    const d = load({ ...native({ Camera: { getPhoto: () => Promise.reject(new Error('"Camera" plugin is not implemented on android')) } }), ...doc([png()], (e, h) => h.change()) });
    assert.equal((await d.camera.capture()).type, 'image/png');
});
