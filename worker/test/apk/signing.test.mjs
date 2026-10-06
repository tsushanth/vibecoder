import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const GRADLE = fs.readFileSync(new URL('../../apk-template/app/build.gradle.kts', import.meta.url), 'utf8');
const SERVER = fs.readFileSync(new URL('../../server.js', import.meta.url), 'utf8');

test('the release key comes from the build host environment, never from a value in the repository', () => {
    assert.match(GRADLE, /System\.getenv\("APK_KEYSTORE_PATH"\)/);
    assert.match(GRADLE, /System\.getenv\("APK_KEYSTORE_PASSWORD"\)/);
    assert.match(GRADLE, /storeFile = file\(ksPath\)/);
    assert.match(GRADLE, /storePassword = ksPassword/);
    assert.match(GRADLE, /keyPassword = ksPassword/);
});

test('the legacy key is only the fallback when the environment gives none (the old file is not in git)', () => {
    const ix = GRADLE.indexOf('} else {');
    assert.ok(ix > GRADLE.indexOf('ksPassword.isNullOrBlank()'), 'the legacy branch follows the environment branch');
    assert.match(GRADLE.slice(ix), /storeFile = file\("debug\.keystore"\)/);
    assert.equal(GRADLE.split('"android"').length - 1, 2); // legacy store and key password only, nowhere else
});

test('the worker passes its environment (where the signing settings live) through to Gradle', () => {
    assert.match(SERVER, /execSync\('\.\/gradlew assembleRelease'[\s\S]{0,400}env: \{ \.\.\.process\.env,/);
});

test('minification stays off for Android builds (standing owner rule)', () => {
    assert.match(GRADLE, /isMinifyEnabled = false/);
});
