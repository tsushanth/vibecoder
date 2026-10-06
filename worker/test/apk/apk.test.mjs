import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validApkHost, applyApkHost } from '../../lib/apk.js';

const STRINGS = fs.readFileSync(new URL('../../apk-template/app/src/main/res/values/strings.xml', import.meta.url), 'utf8');
const KT = fs.readFileSync(new URL('../../apk-template/app/src/main/java/com/vibebuild/export/MainActivity.kt', import.meta.url), 'utf8');

test('only vibebuild.cc subdomains are valid hosts', () => {
    for (const h of ['my-app.vibebuild.cc', 'preview-abc123def456.vibebuild.cc', 'prev-70d01c3b.vibebuild.cc', 'a1b.vibebuild.cc']) assert.equal(validApkHost(h), true, h);
    for (const h of ['vibebuild.cc', 'evil.com', 'my-app.vibebuild.cc.evil.com', 'x.vibebuild.cc/a', 'My-App.vibebuild.cc', 'a.vibebuild.cc:8080', 'sub.my-app.vibebuild.cc', '-ab.vibebuild.cc', 'ab.vibebuild.cc', '', undefined, null, 5, '<script>.vibebuild.cc', 'a.vibebuild.cc\n'])
        assert.equal(validApkHost(h), false, String(h));
});

test('applyApkHost fills the template placeholder and nothing else', () => {
    const out = applyApkHost(STRINGS, 'my-app.vibebuild.cc');
    assert.match(out, /<string name="vibe_host" translatable="false">my-app\.vibebuild\.cc<\/string>/);
    assert.equal(out.replace('my-app.vibebuild.cc', ''), STRINGS);
    assert.throws(() => applyApkHost(STRINGS, 'evil.com'), /invalid/);
    assert.throws(() => applyApkHost('<resources></resources>', 'my-app.vibebuild.cc'), /placeholder/);
    assert.throws(() => applyApkHost(applyApkHost(STRINGS, 'a1b.vibebuild.cc'), 'b2c.vibebuild.cc'), /placeholder/); // not applied twice
});

test('the template ships an empty host (legacy mode) and the shell serves over https when one is set', () => {
    assert.match(STRINGS, /<string name="vibe_host" translatable="false"><\/string>/);
    assert.match(KT, /WebViewAssetLoader\.Builder\(\)\s*\n?\s*\.setDomain\(host\)/);
    assert.match(KT, /loadUrl\(if \(served\) "https:\/\/\$host\/index\.html"/);
    assert.match(KT, /allowUniversalAccessFromFileURLs = !served/);
    assert.match(KT, /allowFileAccess = !served/);
    assert.match(KT, /setWebContentsDebuggingEnabled\(\(applicationInfo\.flags and ApplicationInfo\.FLAG_DEBUGGABLE\) != 0\)/);
    assert.doesNotMatch(KT, /setWebContentsDebuggingEnabled\(true\)/);
});
