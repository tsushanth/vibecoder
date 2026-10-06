import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rd = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const LEGACY = rd('apk-template/app/src/main/java/com/vibebuild/export/MainActivity.kt');
const CAP = rd('apk-template-capacitor/app/src/main/java/com/vibebuild/export/MainActivity.java');

test('legacy shell: the WebView lives in a container that takes system bar, cutout and IME insets as padding', () => {
    assert.match(LEGACY, /ViewCompat\.setOnApplyWindowInsetsListener\(root\)/);
    assert.match(LEGACY, /WindowInsetsCompat\.Type\.systemBars\(\)/);
    assert.match(LEGACY, /WindowInsetsCompat\.Type\.ime\(\)/);
    assert.match(LEGACY, /v\.setPadding\(bars\.left, bars\.top, bars\.right, maxOf\(bars\.bottom, ime\.bottom\)\)/);
    assert.match(LEGACY, /root\.addView\(webView,/);
    assert.match(LEGACY, /setContentView\(root\)/);
    assert.doesNotMatch(LEGACY, /setContentView\(webView\)/);
});

test('legacy shell: served and file modes are untouched', () => {
    assert.match(LEGACY, /loadUrl\(if \(served\) "https:\/\/\$host\/index\.html" else "file:\/\/\/android_asset\/index\.html"\)/);
    assert.match(LEGACY, /allowFileAccess = !served/);
});

test('legacy shell: status and navigation bar icon appearance follows night mode', () => {
    assert.match(LEGACY, /UI_MODE_NIGHT_MASK/);
    assert.match(LEGACY, /isAppearanceLightStatusBars = !night/);
    assert.match(LEGACY, /isAppearanceLightNavigationBars = !night/);
});

test('capacitor shell: status and navigation bar icons are set light or dark from the system mode, on create and on change', () => {
    assert.match(CAP, /extends BridgeActivity/);
    assert.match(CAP, /UI_MODE_NIGHT_MASK/);
    assert.match(CAP, /setAppearanceLightStatusBars\(!night\)/);
    assert.match(CAP, /setAppearanceLightNavigationBars\(!night\)/);
    assert.match(CAP, /onCreate\([\s\S]*?super\.onCreate\(savedInstanceState\);\s*applySystemBarAppearance\(\);/);
    assert.match(CAP, /onConfigurationChanged\([\s\S]*?applySystemBarAppearance\(\);/);
});
