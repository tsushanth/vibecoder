// Run: node docs/superpowers/prototypes/vibe-device/device.test.js
// Loads device.js into a fresh vm context per test with a fake window, so web fallbacks and
// the Capacitor path run against fakes only (no browser, no network).
'use strict';
var vm = require('vm');
var fs = require('fs');
var path = require('path');
var assert = require('assert');

var SRC = fs.readFileSync(path.join(__dirname, 'device.js'), 'utf8');

function load(win) {
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SRC, win);
  return win.vibe.device;
}

function fakeInput(files, fire) {
  var handlers = {};
  var el = { attrs: {}, files: files, addEventListener: function (n, f) { handlers[n] = f; }, setAttribute: function (k, v) { el.attrs[k] = v; }, click: function () { setTimeout(function () { fire(el, handlers); }, 0); } };
  return el;
}
function fakeFileReader() {
  function FR() {}
  FR.prototype.readAsDataURL = function (f) { var self = this; setTimeout(function () { self.result = 'data:' + f.type + ';base64,AAAA'; self.onload(); }, 0); };
  return FR;
}
async function rejectsWith(p, code) {
  try { await p; } catch (e) { assert.strictEqual(e.code, code, 'expected ' + code + ' got ' + e.code + ': ' + e.message); assert.strictEqual(e.status, 0); return; }
  assert.fail('expected rejection ' + code);
}

var tests = [];
function t(name, fn) { tests.push([name, fn]); }

t('attaches as vibe.device and reports web when no Capacitor', function () {
  var d = load({});
  assert.strictEqual(d.isNative(), false);
});
t('a page defining its own fake Capacitor without isNativePlatform is not native', function () {
  assert.strictEqual(load({ Capacitor: {} }).isNative(), false);
  assert.strictEqual(load({ Capacitor: { isNativePlatform: function () { return 'yes'; } } }).isNative(), false);
  assert.strictEqual(load({ Capacitor: { isNativePlatform: function () { throw new Error('x'); } } }).isNative(), false);
});

// geolocation
t('geolocation web success maps coords', async function () {
  var d = load({ navigator: { geolocation: { getCurrentPosition: function (ok, err, o) { assert.strictEqual(o.timeout, 15000); ok({ coords: { latitude: 1.5, longitude: 2.5, accuracy: 9 }, timestamp: 7 }); } } } });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await d.geolocation.get())), { lat: 1.5, lng: 2.5, accuracy: 9, timestamp: 7 });
});
t('geolocation web errors map to denied/timeout/unavailable', async function () {
  function nav(code) { return { navigator: { geolocation: { getCurrentPosition: function (ok, err) { err({ code: code }); } } } }; }
  await rejectsWith(load(nav(1)).geolocation.get(), 'denied');
  await rejectsWith(load(nav(3)).geolocation.get(), 'timeout');
  await rejectsWith(load(nav(2)).geolocation.get(), 'unavailable');
});
t('geolocation unsupported without navigator.geolocation', async function () {
  await rejectsWith(load({ navigator: {} }).geolocation.get(), 'unsupported');
});
t('geolocation rejects bad arguments without calling the browser', async function () {
  var called = 0;
  var d = load({ navigator: { geolocation: { getCurrentPosition: function () { called++; } } } });
  await rejectsWith(d.geolocation.get('x'), 'bad_request');
  await rejectsWith(d.geolocation.get([]), 'bad_request');
  await rejectsWith(d.geolocation.get(null), 'bad_request');
  await rejectsWith(d.geolocation.get({ highAccuracy: 'yes' }), 'bad_request');
  await rejectsWith(d.geolocation.get({ timeoutMs: 5 }), 'bad_request');
  await rejectsWith(d.geolocation.get({ timeoutMs: 1e9 }), 'bad_request');
  await rejectsWith(d.geolocation.get({ timeoutMs: NaN }), 'bad_request');
  await rejectsWith(d.geolocation.get({ maxAgeMs: -1 }), 'bad_request');
  assert.strictEqual(called, 0);
});
t('geolocation native path uses Capacitor.Plugins.Geolocation', async function () {
  var seen;
  var d = load({ Capacitor: { isNativePlatform: function () { return true; }, Plugins: { Geolocation: { getCurrentPosition: function (o) { seen = o; return Promise.resolve({ coords: { latitude: 3, longitude: 4, accuracy: 1 }, timestamp: 9 }); } } } } });
  var r = await d.geolocation.get({ highAccuracy: true });
  assert.strictEqual(r.lat, 3); assert.strictEqual(seen.enableHighAccuracy, true);
});
t('native permission denial maps to denied', async function () {
  var d = load({ Capacitor: { isNativePlatform: function () { return true; }, Plugins: { Geolocation: { getCurrentPosition: function () { return Promise.reject(new Error('Location permission was denied')); } } } } });
  await rejectsWith(d.geolocation.get(), 'denied');
});

// share
t('share uses navigator.share when present', async function () {
  var got;
  var d = load({ navigator: { share: function (o) { got = o; return Promise.resolve(); } } });
  var r = await d.share({ title: 'T', url: 'https://x.y/z' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), { shared: true, copied: false }); assert.strictEqual(got.url, 'https://x.y/z');
});
t('share user abort resolves shared:false, not an error', async function () {
  var d = load({ navigator: { share: function () { var e = new Error('x'); e.name = 'AbortError'; return Promise.reject(e); } } });
  assert.strictEqual((await d.share({ text: 'hi' })).shared, false);
});
t('share falls back to clipboard, then unsupported', async function () {
  var wrote;
  var d = load({ navigator: { clipboard: { writeText: function (s) { wrote = s; return Promise.resolve(); } } } });
  var r = await d.share({ title: 'A', text: 'B', url: 'http://c.d' });
  assert.strictEqual(r.copied, true); assert.strictEqual(wrote, 'A\nB\nhttp://c.d');
  await rejectsWith(load({ navigator: {} }).share({ text: 'x' }), 'unsupported');
});
t('share rejects bad arguments and dangerous URLs', async function () {
  var called = 0;
  var d = load({ navigator: { share: function () { called++; return Promise.resolve(); } } });
  await rejectsWith(d.share(), 'bad_request');
  await rejectsWith(d.share(null), 'bad_request');
  await rejectsWith(d.share('hi'), 'bad_request');
  await rejectsWith(d.share({}), 'bad_request');
  await rejectsWith(d.share({ text: '' }), 'bad_request');
  await rejectsWith(d.share({ text: 5 }), 'bad_request');
  await rejectsWith(d.share({ url: 'javascript:alert(1)' }), 'bad_request');
  await rejectsWith(d.share({ url: 'data:text/html,hi' }), 'bad_request');
  await rejectsWith(d.share({ url: 'file:///etc/passwd' }), 'bad_request');
  await rejectsWith(d.share({ url: 'https://a.b/ c' }), 'bad_request');
  await rejectsWith(d.share({ text: 'x', files: [] }), 'bad_request');
  await rejectsWith(d.share({ text: new Array(2002).join('a') }), 'bad_request');
  assert.strictEqual(called, 0);
});

// haptics
t('haptics web uses navigator.vibrate patterns, best effort', async function () {
  var pat;
  var d = load({ navigator: { vibrate: function (p) { pat = p; return true; } } });
  assert.strictEqual((await d.haptics.tap('light')).ok, true); assert.strictEqual(pat, 10);
  await d.haptics.tap('success'); assert.deepStrictEqual(Array.from(pat), [10, 30, 10]);
  assert.strictEqual((await load({ navigator: {} }).haptics.tap('heavy')).ok, false);
  assert.strictEqual((await load({ navigator: { vibrate: function () { throw new Error('no'); } } }).haptics.tap('heavy')).ok, false);
});
t('haptics rejects unknown kinds', async function () {
  var d = load({ navigator: { vibrate: function () { throw new Error('must not be called'); } } });
  await rejectsWith(d.haptics.tap(), 'bad_request');
  await rejectsWith(d.haptics.tap('LIGHT'), 'bad_request');
  await rejectsWith(d.haptics.tap('__proto__'), 'bad_request');
  await rejectsWith(d.haptics.tap(['light']), 'bad_request');
});
t('haptics native maps kinds to impact/notification', async function () {
  var calls = [];
  var d = load({ Capacitor: { isNativePlatform: function () { return true; }, Plugins: { Haptics: { impact: function (o) { calls.push(['i', o.style]); return Promise.resolve(); }, notification: function (o) { calls.push(['n', o.type]); return Promise.resolve(); } } } } });
  await d.haptics.tap('medium'); await d.haptics.tap('error');
  assert.deepStrictEqual(calls, [['i', 'MEDIUM'], ['n', 'ERROR']]);
});

// camera
t('camera web: input capture attribute, resolves data URL', async function () {
  var win = { FileReader: fakeFileReader(), document: { createElement: function () { return fakeInput([{ type: 'image/png', size: 100 }], function (el, h) { h.change(); }); } } };
  var d = load(win);
  var r = await d.camera.capture({ facing: 'user' });
  assert.strictEqual(r.mimeType, 'image/png'); assert.ok(/^data:image\/png/.test(r.dataUrl));
});
t('camera web: cancel event and empty selection reject cancelled', async function () {
  var d1 = load({ FileReader: fakeFileReader(), document: { createElement: function () { return fakeInput([], function (el, h) { h.cancel(); }); } } });
  await rejectsWith(d1.camera.capture(), 'cancelled');
  var d2 = load({ FileReader: fakeFileReader(), document: { createElement: function () { return fakeInput([], function (el, h) { h.change(); }); } } });
  await rejectsWith(d2.camera.capture(), 'cancelled');
});
t('camera web: rejects non-images and files over 8 MB', async function () {
  function mk(f) { return load({ FileReader: fakeFileReader(), document: { createElement: function () { return fakeInput([f], function (el, h) { h.change(); }); } } }); }
  await rejectsWith(mk({ type: 'text/html', size: 10 }).camera.capture(), 'bad_request');
  await rejectsWith(mk({ type: 'image/jpeg', size: 9 * 1024 * 1024 }).camera.capture(), 'bad_request');
});
t('camera rejects bad arguments before touching the DOM', async function () {
  var made = 0;
  var d = load({ FileReader: fakeFileReader(), document: { createElement: function () { made++; return fakeInput([], function () {}); } } });
  await rejectsWith(d.camera.capture('x'), 'bad_request');
  await rejectsWith(d.camera.capture({ facing: 'rear' }), 'bad_request');
  await rejectsWith(d.camera.capture({ maxWidth: 10 }), 'bad_request');
  await rejectsWith(d.camera.capture({ maxWidth: 1.5 }), 'bad_request');
  await rejectsWith(d.camera.capture({ quality: 0 }), 'bad_request');
  await rejectsWith(d.camera.capture({ quality: '80' }), 'bad_request');
  assert.strictEqual(made, 0);
});
t('camera native: passes safe options, never saves to gallery, maps cancel', async function () {
  var seen;
  var Camera = { getPhoto: function (o) { seen = o; return Promise.resolve({ dataUrl: 'data:image/jpeg;base64,AAAAAAAA' }); } };
  var d = load({ Capacitor: { isNativePlatform: function () { return true; }, Plugins: { Camera: Camera } } });
  var r = await d.camera.capture({ maxWidth: 800 });
  assert.strictEqual(seen.saveToGallery, false); assert.strictEqual(seen.width, 800); assert.strictEqual(seen.direction, 'REAR'); assert.strictEqual(r.size, 6);
  Camera.getPhoto = function () { return Promise.reject(new Error('User cancelled photos app')); };
  await rejectsWith(d.camera.capture(), 'cancelled');
});
t('native flag true but plugin missing falls back to web path', async function () {
  var d = load({ Capacitor: { isNativePlatform: function () { return true; }, Plugins: {} }, navigator: { vibrate: function () { return true; } } });
  assert.strictEqual((await d.haptics.tap('light')).ok, true);
});

t('native plugin found via registerPlugin when Plugins has no entry', async function () {
  var d = load({ Capacitor: { isNativePlatform: function () { return true; }, Plugins: {}, registerPlugin: function (n) { assert.strictEqual(n, 'Haptics'); return { impact: function () { return Promise.resolve(); } }; } } });
  assert.strictEqual((await d.haptics.tap('light')).ok, true);
});

(async function () {
  var failed = 0;
  for (var i = 0; i < tests.length; i++) {
    try { await tests[i][1](); console.log('ok   - ' + tests[i][0]); } catch (e) { failed++; console.log('FAIL - ' + tests[i][0] + '\n       ' + e.message); }
  }
  console.log((tests.length - failed) + '/' + tests.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
