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
