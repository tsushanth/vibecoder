import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const TOML = fs.readFileSync(new URL('../../fly.toml', import.meta.url), 'utf8');

test('one proxy machine always runs, so the in-process job scheduler is never asleep', () => {
    assert.match(TOML, /^\s*min_machines_running\s*=\s*1\s*$/m);
});

test('the machine count stays within the database login budget: no setting asks for more than one machine', () => {
    assert.doesNotMatch(TOML, /min_machines_running\s*=\s*([2-9]|\d{2,})/);
    assert.doesNotMatch(TOML, /^\s*\[processes\]/m); // no process groups that would multiply machines
});
