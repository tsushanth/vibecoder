import test from 'node:test';
import assert from 'node:assert/strict';
import { manifestFromBundle } from '../../lib/bundleManifest.js';
import { zip, file } from '../helpers/zip.mjs';

const M = { connectors: { stocks: { host: 'api.example.com', paths: ['/v1/*'], methods: ['GET'], secret: { name: 'STOCKS_API_KEY', in: 'query', field: 'apikey' } } } };

test('finds a deflated manifest at the project root', () => {
    assert.deepEqual(manifestFromBundle(zip([file('index.html', '<html></html>'), file('vibe.manifest.json', M)])), { status: 'found', manifest: M });
});
test('finds a stored (uncompressed) manifest', () => {
    assert.deepEqual(manifestFromBundle(zip([file('vibe.manifest.json', M, { deflate: false })])), { status: 'found', manifest: M });
});
test('no manifest file means none, not unknown', () => {
    assert.deepEqual(manifestFromBundle(zip([file('index.html', 'x')])), { status: 'none' });
});
test('a manifest in a subfolder is ignored', () => {
    assert.deepEqual(manifestFromBundle(zip([file('app/vibe.manifest.json', M)])), { status: 'none' });
    assert.deepEqual(manifestFromBundle(zip([file('./vibe.manifest.json', M)])), { status: 'none' });
});
test('an empty connectors object is none', () => {
    assert.deepEqual(manifestFromBundle(zip([file('vibe.manifest.json', { connectors: {} })])), { status: 'none' });
});
test('unparseable or non-object manifest content is unreadable (leave the registered manifest alone), never thrown', () => {
    for (const bad of ['{nope', '[]', 'null', '"x"', '', JSON.stringify({ nothing: 1 })]) assert.deepEqual(manifestFromBundle(zip([file('vibe.manifest.json', bad)])), { status: 'unreadable' }, bad);
});
test('garbage, empty, truncated and non-string bundles are unreadable and never throw', () => {
    const good = Buffer.from(zip([file('vibe.manifest.json', M)]), 'base64');
    for (const b of ['', 'not base64 at all !!!', Buffer.from('PK\u0003\u0004 hello').toString('base64'), good.subarray(0, good.length - 10).toString('base64'), good.subarray(0, 30).toString('base64'), null, undefined, 42]) {
        assert.deepEqual(manifestFromBundle(b), { status: 'unreadable' }, String(b).slice(0, 20));
    }
});
test('an oversized manifest entry is unreadable (declared size and real inflated size are both capped)', () => {
    const big = JSON.stringify({ connectors: { a: { pad: 'x'.repeat(20000) } } });
    assert.deepEqual(manifestFromBundle(zip([file('vibe.manifest.json', big)])), { status: 'unreadable' });
    assert.deepEqual(manifestFromBundle(zip([file('vibe.manifest.json', big, { claimSize: 100 })])), { status: 'unreadable' }, 'a lying size field must not bypass the cap');
});
test('other large files in the bundle are never inflated', () => {
    const huge = 'a'.repeat(5 * 1024 * 1024);
    assert.deepEqual(manifestFromBundle(zip([file('big.bin', huge), file('vibe.manifest.json', M)])), { status: 'found', manifest: M });
});
test('only the first matching root entry is used and a duplicate cannot override it', () => {
    const other = { connectors: { evil: { host: 'evil.example.com', paths: ['/'], methods: ['GET'] } } };
    assert.deepEqual(manifestFromBundle(zip([file('vibe.manifest.json', M), file('vibe.manifest.json', other)])), { status: 'found', manifest: M });
});

test('a size field that overstates the entry is unreadable, and a stored entry bigger than the cap is unreadable even if its size field lies', () => {
    assert.deepEqual(manifestFromBundle(zip([file('vibe.manifest.json', M, { claimSize: 100000 })])), { status: 'unreadable' });
    const big = JSON.stringify({ connectors: { a: { pad: 'x'.repeat(10000) } } });
    assert.deepEqual(manifestFromBundle(zip([file('vibe.manifest.json', big, { deflate: false, claimSize: 100 })])), { status: 'unreadable' });
});
