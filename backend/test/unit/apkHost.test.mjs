import test from 'node:test';
import assert from 'node:assert/strict';
import { apkHostFor } from '../../lib/apkHost.js';

test('the published subdomain wins over the preview one', () => {
    assert.equal(apkHostFor({ published_url: 'https://my-app.vibebuild.cc', preview_url: 'https://preview-abc123def456.vibebuild.cc' }, 'vibebuild.cc'), 'my-app.vibebuild.cc');
});
test('falls back to the preview subdomain, then to null', () => {
    assert.equal(apkHostFor({ published_url: null, preview_url: 'https://preview-abc123def456.vibebuild.cc/' }, 'vibebuild.cc'), 'preview-abc123def456.vibebuild.cc');
    assert.equal(apkHostFor({}, 'vibebuild.cc'), null); assert.equal(apkHostFor(undefined, 'vibebuild.cc'), null);
});
test('foreign, nested, malformed or reserved-shape hosts are ignored, and the next url is tried', () => {
    for (const bad of ['https://evil.com', 'https://my-app.vibebuild.cc.evil.com', 'https://a.b.vibebuild.cc', 'https://vibebuild.cc', 'not a url', 'https://x.vibebuild.cc', 'https://-ab.vibebuild.cc', 'https://abcdefghijkl.evil.org', 'https://ab-cd-ef-gh-ij.example.com', '']) assert.equal(apkHostFor({ published_url: bad }, 'vibebuild.cc'), null, bad);
    assert.equal(apkHostFor({ published_url: 'https://evil.com', preview_url: 'https://good-app.vibebuild.cc' }, 'vibebuild.cc'), 'good-app.vibebuild.cc');
});
test('the host is lower-cased and the base domain is configurable', () => {
    assert.equal(apkHostFor({ preview_url: 'https://My-App.VibeBuild.CC' }, 'vibebuild.cc'), 'my-app.vibebuild.cc'); // URL parsing lower-cases the host
    assert.equal(apkHostFor({ preview_url: 'https://my-app.example.org' }, 'example.org'), 'my-app.example.org');
});
