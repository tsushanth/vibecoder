import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// backend/ deploys as a standalone directory, so it cannot import from platform/. These are byte-identical copies.
// If this fails, re-copy:  cp platform/vibe-proxy/<file> backend/lib/vendor/<file>
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..', '..');
for (const file of ['capture.js', 'vault-capture.js']) {
    test(`backend/lib/vendor/${file} is byte-identical to platform/vibe-proxy/${file}`, () => {
        const vendored = fs.readFileSync(path.join(ROOT, 'backend', 'lib', 'vendor', file));
        const source = fs.readFileSync(path.join(ROOT, 'platform', 'vibe-proxy', file));
        assert.ok(vendored.equals(source), `vendored ${file} drifted from platform/vibe-proxy/${file}; re-copy it`);
    });
}
