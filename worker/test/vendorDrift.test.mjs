import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// worker/ runs on box 231 as a standalone directory, so it cannot import from platform/. These are byte-identical copies.
// If this fails, re-copy:  cp platform/<dir>/<file> worker/lib/vendor/<file>
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
// manifest.js imports ../pay/catalog.js, so the worker needs the catalog at worker/lib/pay/catalog.js
test('worker/lib/pay/catalog.js is byte-identical to platform/pay/catalog.js', () => {
    assert.ok(fs.readFileSync(path.join(ROOT, 'worker', 'lib', 'pay', 'catalog.js')).equals(fs.readFileSync(path.join(ROOT, 'platform', 'pay', 'catalog.js'))), 'vendored catalog drifted; re-copy it');
});
for (const [dir, file] of [['vibe-proxy', 'scanner.js'], ['vibe-proxy', 'ssrf.js'], ['data', 'schema.js']]) {
    test(`worker/lib/vendor/${file} is byte-identical to platform/${dir}/${file}`, () => {
        const vendored = fs.readFileSync(path.join(ROOT, 'worker', 'lib', 'vendor', file));
        const source = fs.readFileSync(path.join(ROOT, 'platform', dir, file));
        assert.ok(vendored.equals(source), `vendored ${file} drifted from platform/${dir}/${file}; re-copy it`);
    });
}

// jobs/validate.js imports ../data/schema.js (a re-export shim of vendor/schema.js, not a copy) and ./schedule.js
for (const file of ['validate.js', 'schedule.js']) {
    test(`worker/lib/jobs/${file} is byte-identical to platform/jobs/${file}`, () => {
        const vendored = fs.readFileSync(path.join(ROOT, 'worker', 'lib', 'jobs', file));
        const source = fs.readFileSync(path.join(ROOT, 'platform', 'jobs', file));
        assert.ok(vendored.equals(source), `vendored jobs/${file} drifted from platform/jobs/${file}; re-copy it`);
    });
}
test('worker/lib/data/schema.js re-exports exactly the vendored schema module', async () => {
    const shim = await import('../lib/data/schema.js');
    const real = await import('../lib/vendor/schema.js');
    assert.deepEqual(Object.keys(shim).sort(), Object.keys(real).sort());
    assert.equal(shim.NAME, real.NAME);
    assert.ok(Object.keys(shim).length >= 5);
});

// worker/assets/vibe.js is what the generator ships into apps; platform/sdk/vibe.js is the source the SDK tests run against.
test('worker/assets/vibe.js is byte-identical to platform/sdk/vibe.js', () => {
    const a = fs.readFileSync(path.join(ROOT, 'worker', 'assets', 'vibe.js'));
    const b = fs.readFileSync(path.join(ROOT, 'platform', 'sdk', 'vibe.js'));
    assert.ok(a.equals(b), 'worker/assets/vibe.js drifted from platform/sdk/vibe.js; re-copy it:  cp platform/sdk/vibe.js worker/assets/vibe.js');
});
