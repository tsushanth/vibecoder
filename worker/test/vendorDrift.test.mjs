import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// worker/ runs on box 231 as a standalone directory, so it cannot import from platform/. These are byte-identical copies.
// If this fails, re-copy:  cp platform/vibe-proxy/<file> worker/lib/vendor/<file>
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
for (const file of ['scanner.js', 'ssrf.js']) {
    test(`worker/lib/vendor/${file} is byte-identical to platform/vibe-proxy/${file}`, () => {
        const vendored = fs.readFileSync(path.join(ROOT, 'worker', 'lib', 'vendor', file));
        const source = fs.readFileSync(path.join(ROOT, 'platform', 'vibe-proxy', file));
        assert.ok(vendored.equals(source), `vendored ${file} drifted from platform/vibe-proxy/${file}; re-copy it`);
    });
}
