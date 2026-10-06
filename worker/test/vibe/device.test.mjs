import test from 'node:test';
import assert from 'node:assert/strict';
import { VIBE_RULES, vibeProblems, usesVibe, usesBackendSdk, injectSdk } from '../../lib/vibe.js';
import { installDeviceFake, DEVICE_FAKE_SCRIPT } from '../../lib/vibeFake.js';
import { filesForRun } from '../../lib/browsercheck.js';

const page = (js) => ({ 'index.html': `<!DOCTYPE html><html><head><script src="vibe.js"></script></head><body><script>${js}</script></body></html>` });
const problems = (js) => vibeProblems(page(js), { enabled: true });

test('vibe.device counts as vibe use but not as a backend (no sign-in, no fake accounts needed)', () => {
    const f = page('vibe.device.haptics.tap("light")');
    assert.equal(usesVibe(f), true);
    assert.equal(usesBackendSdk(f), false);
    assert.ok(injectSdk(f, { sdk: '/*sdk*/', enabled: true })['vibe.js']);
});
test('the five documented calls pass the static check', () => {
    const js = 'vibe.device.isNative(); vibe.device.camera.capture({facing:"user"}).catch(function(){}); vibe.device.geolocation.get().catch(function(){}); vibe.device.share({text:"hi"}).catch(function(){}); vibe.device.haptics.tap("light");';
    assert.deepEqual(problems(js), []);
});
test('other vibe.device members, including the reserved push, are problems', () => {
    for (const bad of ['vibe.device.push.register()', 'vibe.device.camera.snap()', 'vibe.device.camera.getPhoto()', 'vibe.device.geolocation.watch()', 'vibe.device.vibrate(10)', 'vibe.device.haptics.impact()', 'vibe.device.camera()', 'vibe.device.share.x()']) {
        const p = problems(bad);
        assert.equal(p.length, 1, bad + ' => ' + JSON.stringify(p));
        assert.match(p[0], /vibe\.device/);
    }
});
test('the problem text names a member only when it looks like a name, never arbitrary model text', () => {
    const p = problems('vibe.device.' + 'x'.repeat(80) + '()');
    assert.equal(p.length, 1); assert.ok(p[0].length < 400);
});
test('with the platform SDK off, vibe.device use is reported as unavailable', () => {
    const p = vibeProblems(page('vibe.device.haptics.tap("light")'), { enabled: false });
    assert.ok(p.some((x) => /vibe\.device/.test(x) && /not available/.test(x)), JSON.stringify(p));
});
test('VIBE_RULES teaches when to use vibe.device, feature detection and denial handling', () => {
    assert.match(VIBE_RULES, /## .*vibe\.device/);
    for (const re of [/vibe\.device\.camera\.capture/, /vibe\.device\.geolocation\.get/, /vibe\.device\.share/, /vibe\.device\.haptics\.tap/, /isNative\(\) is true only inside/, /UI hint/i, /denied/, /cancelled/, /feature-detect|never assume/i, /plain web API|standard web/i]) assert.match(VIBE_RULES, re);
    assert.doesNotMatch(VIBE_RULES, /vibe\.device\.push\./);
});

// ---- the headless-check fake
const rejects = async (p, code) => { try { await p; } catch (e) { assert.equal(e.code, code); assert.equal(e.status, 0); return; } assert.fail('expected ' + code); };
const fresh = () => { const w = { vibe: {} }; installDeviceFake(w); return w.vibe.device; };
test('the device fake resolves harmless values for every call and keeps the other SDK parts', async () => {
    const w = { vibe: { api: 1 } }; installDeviceFake(w); const d = w.vibe.device;
    assert.equal(w.vibe.api, 1);
    assert.deepEqual(Object.keys(d).sort(), ['camera', 'geolocation', 'haptics', 'isNative', 'share']);
    assert.equal(d.isNative(), false);
    const c = await d.camera.capture(); assert.equal(typeof c.size, 'number'); assert.match(c.type, /^image\//); assert.equal(typeof c.name, 'string'); assert.ok(c.blob);
    const g = await d.geolocation.get(); assert.ok(isFinite(g.lat) && isFinite(g.lng) && isFinite(g.accuracy) && isFinite(g.timestamp));
    assert.deepEqual(await d.share({ text: 'x' }), { shared: true, copied: false });
    assert.deepEqual(await d.haptics.tap('light'), { ok: true });
});
test('the device fake rejects the same bad requests as the SDK', async () => {
    const d = fresh();
    await rejects(d.haptics.tap('buzz'), 'bad_request');
    await rejects(d.share({}), 'bad_request');
    await rejects(d.share({ url: 'javascript:x' }), 'bad_request');
    await rejects(d.camera.capture({ facing: 'rear' }), 'bad_request');
    await rejects(d.geolocation.get({ timeoutMs: 1 }), 'bad_request');
});
test('the browser check appends the device fake for apps that use vibe.device, even without accounts or tables', () => {
    const f = filesForRun(page('vibe.device.haptics.tap("light")'), { vibe: true, sdk: '/*sdk*/' });
    assert.ok(f['vibe.js'].endsWith(DEVICE_FAKE_SCRIPT));
    assert.ok(!/check-user-1/.test(f['vibe.js']), 'no accounts fake needed');
    const g = filesForRun(page('vibe.ai.ask("x")'), { vibe: true, sdk: '/*sdk*/' });
    assert.ok(!g['vibe.js'].includes('check-camera'));
});
