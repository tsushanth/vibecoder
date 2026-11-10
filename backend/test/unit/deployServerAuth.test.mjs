import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deployServerHeaders } from '../../lib/deployServerAuth.js';

test('adds the shared secret and keeps the other headers', () => {
    const h = deployServerHeaders({ 'Content-Type': 'application/json' }, { INTERNAL_SECRET: 'abc' });
    assert.deepEqual(h, { 'Content-Type': 'application/json', 'x-internal-secret': 'abc' });
});

test('every POST to the deploy server in routes and scripts goes through the helper', () => {
    for (const f of ['routes/deploy.routes.js', 'routes/projects.routes.js', 'scripts/backfill-previews.mjs']) {
        const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
        const calls = [...src.matchAll(/\$\{DEPLOY_SERVER_URL\}\/(?:deploy|cleanup)`,\s*\{\s*method: 'POST',\s*headers: ([^\n]*)/g)];
        assert.ok(calls.length > 0, f);
        for (const c of calls) assert.match(c[1], /^deployServerHeaders\(/, `${f}: ${c[0].slice(0, 80)}`);
    }
});
