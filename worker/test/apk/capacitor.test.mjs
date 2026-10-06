import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyCapacitorHost } from '../../lib/apk.js';
import { checkPermissions, parsePermissions, REQUIRED_PERMISSIONS } from '../../scripts/check-apk-permissions.mjs';

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = path.join(WORKER, 'apk-template-capacitor');
const read = (p) => fs.readFileSync(path.join(T, p), 'utf8');
const CONFIG = read('app/src/main/assets/capacitor.config.json');
const MANIFEST = read('app/src/main/AndroidManifest.xml');
const GRADLE = read('app/build.gradle.kts');
const FIXTURE = fs.readFileSync(path.join(WORKER, 'test/apk/fixtures/capacitor-permissions.txt'), 'utf8');

// ---- applyCapacitorHost -------------------------------------------------------------------------------------------

test('applyCapacitorHost sets server.hostname and nothing else', () => {
    const out = JSON.parse(applyCapacitorHost(CONFIG, 'zz-live-e2e.vibebuild.cc'));
    const orig = JSON.parse(CONFIG);
    assert.equal(out.server.hostname, 'zz-live-e2e.vibebuild.cc');
    out.server.hostname = orig.server.hostname;
    assert.deepEqual(out, orig);
});

test('applyCapacitorHost validates the host with validApkHost and only fills the placeholder once', () => {
    for (const h of ['evil.com', 'a.vibebuild.cc.evil.com', 'localhost', '', undefined, null, 'x.vibebuild.cc/a', 'sub.my-app.vibebuild.cc'])
        assert.throws(() => applyCapacitorHost(CONFIG, h), /invalid apk host/, String(h));
    const once = applyCapacitorHost(CONFIG, 'a1b.vibebuild.cc');
    assert.throws(() => applyCapacitorHost(once, 'b2c.vibebuild.cc'), /placeholder/);
    assert.throws(() => applyCapacitorHost('not json', 'a1b.vibebuild.cc'), /valid JSON/);
    assert.throws(() => applyCapacitorHost('{}', 'a1b.vibebuild.cc'), /placeholder/);
});

test('applyCapacitorHost refuses a template that widens the bridge origin', () => {
    const mutate = (fn) => { const c = JSON.parse(CONFIG); fn(c.server); return JSON.stringify(c); };
    const h = 'a1b.vibebuild.cc';
    assert.throws(() => applyCapacitorHost(mutate((s) => { s.allowNavigation = ['*.evil.com']; }), h), /allowNavigation/);
    assert.throws(() => applyCapacitorHost(mutate((s) => { s.url = 'https://evil.com'; }), h), /server\.url/);
    assert.throws(() => applyCapacitorHost(mutate((s) => { s.cleartext = true; }), h), /cleartext/);
    assert.throws(() => applyCapacitorHost(mutate((s) => { s.androidScheme = 'http'; }), h), /https/);
    assert.doesNotThrow(() => applyCapacitorHost(mutate((s) => { s.allowNavigation = []; }), h));
});

// ---- the shipped template ----------------------------------------------------------------------------------------------

test('the shipped capacitor config is https, has the host placeholder and no navigation, url, cleartext or debugging', () => {
    const c = JSON.parse(CONFIG);
    assert.equal(c.server.androidScheme, 'https');
    assert.equal(c.server.hostname, '__VIBE_HOST__');
    assert.equal(c.server.allowNavigation, undefined);
    assert.equal(c.server.url, undefined);
    assert.notEqual(c.server.cleartext, true);
    assert.equal(c.webDir, 'public');
    assert.equal(c.android.webContentsDebuggingEnabled, false);
    assert.equal(c.android.allowMixedContent, false);
    assert.doesNotMatch(MANIFEST, /usesCleartextTraffic="true"/);
});

test('the manifest declares exactly the allowed permissions and removes storage and media ones', () => {
    const declared = [...MANIFEST.matchAll(/<uses-permission\s+android:name="([^"]+)"\s*(tools:node="remove")?\s*\/>/g)];
    const kept = declared.filter((m) => !m[2]).map((m) => m[1]).sort();
    assert.deepEqual(kept, [...REQUIRED_PERMISSIONS].sort());
    const removed = declared.filter((m) => m[2]).map((m) => m[1]);
    for (const p of ['READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_MEDIA_AUDIO', 'READ_MEDIA_VISUAL_USER_SELECTED', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE'])
        assert.ok(removed.includes(`android.permission.${p}`), p);
    assert.match(MANIFEST, /<uses-feature android:name="android\.hardware\.camera" android:required="false" \/>/);
    assert.equal(/READ_MEDIA/.test(MANIFEST.replace(/<uses-permission[^>]*READ_MEDIA[^>]*tools:node="remove"[^>]*>/g, '')), false);
});

test('the template never minifies, never enables debugging in release, and takes the key only from the environment', () => {
    assert.match(GRADLE, /isMinifyEnabled = false/);
    assert.doesNotMatch(GRADLE, /isMinifyEnabled = true|minifyEnabled true|isShrinkResources = true/);
    assert.match(GRADLE, /isDebuggable = false/);
    for (const k of ['APK_KEYSTORE_PATH', 'APK_KEYSTORE_PASSWORD', 'APK_KEY_ALIAS']) assert.match(GRADLE, new RegExp(`System\\.getenv\\("${k}"\\)`));
    assert.doesNotMatch(GRADLE, /debug\.keystore|storePassword = "/);
    assert.match(GRADLE, /applicationId = "com\.vibebuild\.export"/); // the worker rewrites exactly this string
    assert.match(read('app/src/main/res/values/strings.xml'), /VibeBuild App/); // and this one
    for (const f of fs.readdirSync(path.join(T, 'modules'))) assert.doesNotMatch(read(`modules/${f}/build.gradle.kts`), /minify/i, f);
});

test('the template folder carries no key material and no build output', () => {
    const bad = [];
    (function walk(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { if (['build', '.gradle', 'node_modules'].includes(e.name)) bad.push(p); else walk(p); }
            else if (/\.(jks|keystore|p12|pem|apk|aab)$/i.test(e.name) || /password/i.test(e.name)) bad.push(p);
        }
    })(T);
    assert.deepEqual(bad, []);
});

test('exactly the five planned plugins are registered with the bridge', () => {
    const pk = JSON.parse(read('app/src/main/assets/capacitor.plugins.json')).map((p) => p.pkg).sort();
    assert.deepEqual(pk, ['@capacitor/camera', '@capacitor/geolocation', '@capacitor/haptics', '@capacitor/share'].sort());
    assert.match(read('settings.gradle.kts'), /include\(":capacitor-android", ":capacitor-camera", ":capacitor-geolocation", ":capacitor-haptics", ":capacitor-share"\)/);
});

// ---- permission checker (fixture is the real `aapt2 dump permissions` of the built APK) -------------------------

test('the real built APK permissions pass', () => {
    const r = checkPermissions(FIXTURE);
    assert.deepEqual(r.violations, []);
    assert.equal(r.ok, true);
    assert.equal(parsePermissions(FIXTURE).pkg, 'com.vibebuild.export');
});

test('the permission check fails on any extra or missing permission', () => {
    const add = (name, kind = 'uses-permission') => FIXTURE + `${kind}: name='${name}'\n`;
    for (const p of ['android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_MEDIA_VIDEO', 'android.permission.READ_MEDIA_VISUAL_USER_SELECTED', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.RECORD_AUDIO', 'android.permission.ACCESS_BACKGROUND_LOCATION', 'android.permission.POST_NOTIFICATIONS']) {
        const r = checkPermissions(add(p));
        assert.equal(r.ok, false, p);
        assert.match(r.violations.join(), new RegExp(`unexpected permission: ${p.replace(/\./g, '\\.')}`));
    }
    assert.equal(checkPermissions(add('android.permission.READ_MEDIA_IMAGES', 'uses-permission-sdk-23')).ok, false);
    assert.equal(checkPermissions(add('android.permission.READ_EXTERNAL_STORAGE', 'uses-permission-sdk-m')).ok, false);
    assert.equal(checkPermissions(FIXTURE.replace("name='android.permission.CAMERA'", "name='android.permission.CAMERA2'")).ok, false);
    assert.match(checkPermissions(FIXTURE.replace(/.*name='android\.permission\.INTERNET'.*\n/, '')).violations.join(), /missing permission: android\.permission\.INTERNET/);
    // another app's dynamic receiver permission, or an unrelated defined permission, is not ours
    assert.equal(checkPermissions(add('com.other.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION')).ok, false);
    assert.equal(checkPermissions(FIXTURE + "permission: com.vibebuild.export.EVIL\n").ok, false);
    assert.equal(checkPermissions('').ok, false);
});

test('the permission check follows a rewritten applicationId', () => {
    const renamed = FIXTURE.replaceAll('com.vibebuild.export', 'com.vibebuild.app.a1b2c3');
    assert.equal(checkPermissions(renamed).ok, true);
});

const REAL_APK = process.env.CAPACITOR_APK;
test('CLI on a real APK (set CAPACITOR_APK to run)', { skip: !REAL_APK }, () => {
    const r = spawnSync(process.execPath, [path.join(WORKER, 'scripts/check-apk-permissions.mjs'), REAL_APK], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
});

// ---- POST /build-apk with the opt-in shell (stub gradlew and stub aapt2: no Android toolchain needed) ------------------

function storedZip(files) {
    const locals = [], centrals = []; let offset = 0;
    for (const [name, content] of Object.entries(files)) {
        const nameB = Buffer.from(name), data = Buffer.from(content), crc = zlib.crc32 ? zlib.crc32(data) : 0;
        const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameB.length, 26);
        const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
        locals.push(lh, nameB, data); centrals.push(ch, nameB); offset += 30 + nameB.length + data.length;
    }
    const cd = Buffer.concat(centrals), eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, eocd]).toString('base64');
}

// A fake template: the "gradlew" records what the worker prepared and writes that as the "apk".
function fakeTemplate(dir, marker) {
    fs.mkdirSync(path.join(dir, 'app/src/main/assets/public'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'app/src/main/res/values'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'app/src/main/assets/capacitor.config.json'), CONFIG);
    fs.writeFileSync(path.join(dir, 'app/src/main/res/values/strings.xml'), read('app/src/main/res/values/strings.xml').replace(/<\/resources>/, '    <string name="vibe_host" translatable="false"></string>\n</resources>'));
    fs.writeFileSync(path.join(dir, 'app/build.gradle.kts'), 'applicationId = "com.vibebuild.export"\n');
    fs.writeFileSync(path.join(dir, 'marker.txt'), marker);
    fs.writeFileSync(path.join(dir, 'gradlew'), `#!/bin/sh
mkdir -p app/build/outputs/apk/release
node -e '
const fs=require("fs");const r=(p)=>fs.existsSync(p)?fs.readFileSync(p,"utf8"):null;
fs.writeFileSync("app/build/outputs/apk/release/app-release.apk",JSON.stringify({
 marker:r("marker.txt"),config:r("app/src/main/assets/capacitor.config.json"),pub:r("app/src/main/assets/public/index.html"),
 rootIndex:r("app/src/main/assets/index.html"),strings:r("app/src/main/res/values/strings.xml"),gradle:r("app/build.gradle.kts")}))'
`, { mode: 0o755 });
}

async function withServer(fn) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-cap-'));
    const legacy = path.join(home, 'legacy'), cap = path.join(home, 'cap');
    fakeTemplate(legacy, 'LEGACY'); fakeTemplate(cap, 'CAPACITOR');
    // the legacy fake keeps the legacy shape: assets directly in app/src/main/assets
    const aapt2 = path.join(home, 'aapt2');
    fs.writeFileSync(aapt2, `#!/bin/sh\ncat "${process.env.FAKE_PERMS_FILE || path.join(home, 'perms.txt')}"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(home, 'perms.txt'), FIXTURE);
    const port = 38000 + Math.floor(Math.random() * 900);
    const child = spawn(process.execPath, ['server.js'], { cwd: WORKER, stdio: 'ignore', env: { PATH: process.env.PATH + ':' + path.dirname(process.execPath), HOME: home, OUTCOME_LOG: path.join(home, 'o.jsonl'), WORKER_PORT: String(port), WORKER_SECRET: 'unit-test-worker-secret-0123456789', APK_TEMPLATE_DIR: legacy, APK_TEMPLATE_DIR_CAPACITOR: cap, AAPT2: aapt2 } });
    try {
        let ok = false;
        for (let i = 0; i < 80 && !ok; i++) { try { ok = (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 200)); } }
        assert.ok(ok, 'server up');
        const post = async (body) => { const r = await fetch(`http://127.0.0.1:${port}/build-apk`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-worker-secret': 'unit-test-worker-secret-0123456789' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
        await fn({ post, home });
    } finally { child.kill(); }
}
const seen = (r) => JSON.parse(Buffer.from(r.body.apk, 'base64').toString());

test('/build-apk: default and shell:legacy use the legacy template exactly as before', { timeout: 60000 }, async () => {
    await withServer(async ({ post }) => {
        const bundle = storedZip({ 'index.html': '<h1>legacy</h1>' });
        for (const extra of [{}, { shell: 'legacy' }]) {
            const r = await post({ projectId: 'proj1', bundle, appName: 'Build a todo app', host: 'my-app.vibebuild.cc', ...extra });
            assert.equal(r.status, 200, JSON.stringify(r.body));
            const s = seen(r);
            assert.equal(s.marker, 'LEGACY');
            assert.equal(s.rootIndex, '<h1>legacy</h1>');
            assert.equal(s.pub, null);
            assert.match(s.strings, /vibe_host" translatable="false">my-app\.vibebuild\.cc</);
            assert.match(s.gradle, /applicationId = "com\.vibebuild\.app\.aproj1"/);
            assert.equal(s.config.includes('my-app.vibebuild.cc'), false); // legacy never touches capacitor config
        }
    });
});

test('/build-apk: shell:capacitor uses the capacitor template, serves the bundle from assets/public and sets the hostname', { timeout: 60000 }, async () => {
    await withServer(async ({ post }) => {
        const r = await post({ projectId: 'proj1', bundle: storedZip({ 'index.html': '<h1>cap</h1>', 'a/b.js': '1' }), appName: 'Build a todo app', host: 'zz-live-e2e.vibebuild.cc', shell: 'capacitor' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const s = seen(r);
        assert.equal(s.marker, 'CAPACITOR');
        assert.equal(s.pub, '<h1>cap</h1>');
        assert.equal(s.rootIndex, null);
        assert.equal(JSON.parse(s.config).server.hostname, 'zz-live-e2e.vibebuild.cc');
        assert.match(s.strings, /Todo/); // app name applied
        assert.doesNotMatch(s.strings, /vibe_host" translatable="false">zz-live/); // not the legacy mechanism
        assert.match(s.gradle, /applicationId = "com\.vibebuild\.app\.aproj1"/);
    });
});

test('/build-apk: bad shell values and a capacitor build without a host are rejected before any build', { timeout: 60000 }, async () => {
    await withServer(async ({ post }) => {
        const base = { projectId: 'p', bundle: storedZip({ 'index.html': 'x' }), appName: 'App', host: 'my-app.vibebuild.cc' };
        for (const shell of ['Capacitor', 'native', '', null, 5, ['capacitor'], '__proto__']) {
            const r = await post({ ...base, shell });
            assert.equal(r.status, 400, String(shell));
            assert.match(r.body.error, /shell must be/);
        }
        const noHost = await post({ ...base, host: undefined, shell: 'capacitor' });
        assert.equal(noHost.status, 400); assert.match(noHost.body.error, /host is required/);
        const badHost = await post({ ...base, host: 'evil.com', shell: 'capacitor' });
        assert.equal(badHost.status, 400); assert.match(badHost.body.error, /vibebuild\.cc subdomain/);
        const noIndex = await post({ ...base, bundle: storedZip({ 'other.html': 'x' }), shell: 'capacitor' });
        assert.equal(noIndex.status, 400); assert.match(noIndex.body.error, /index\.html/);
        const ok = await post({ ...base, shell: 'capacitor' });
        assert.equal(ok.status, 200); // none of the rejections left the build slot taken
    });
});

test('/build-apk: a capacitor APK with an extra permission, or one that cannot be inspected, is not returned', { timeout: 60000 }, async () => {
    await withServer(async ({ post, home }) => {
        const body = { projectId: 'p', bundle: storedZip({ 'index.html': 'x' }), appName: 'App', host: 'my-app.vibebuild.cc', shell: 'capacitor' };
        fs.appendFileSync(path.join(home, 'perms.txt'), "uses-permission: name='android.permission.READ_MEDIA_IMAGES'\n");
        const bad = await post(body);
        assert.equal(bad.status, 500); assert.match(bad.body.error, /permission check failed.*READ_MEDIA_IMAGES/); assert.equal(bad.body.apk, undefined);
        // legacy shell is not subject to the capacitor allow-list
        const legacy = await post({ ...body, shell: undefined });
        assert.equal(legacy.status, 200);
        fs.writeFileSync(path.join(home, 'aapt2'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
        const dead = await post(body);
        assert.equal(dead.status, 500); assert.match(dead.body.error, /aapt2/);
    });
});
