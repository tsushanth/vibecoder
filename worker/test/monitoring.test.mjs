import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliverCallback } from '../lib/callback.js';
import { createStreakGate, _setSink, reportFailure } from '../lib/failureReporter.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the reporter copies in deploy-server, build-monitor and sms-bot are identical to worker/lib', () => {
    const ref = fs.readFileSync(path.join(ROOT, 'worker/lib/failureReporter.js'), 'utf8');
    for (const d of ['deploy-server', 'build-monitor', 'sms-bot']) assert.equal(fs.readFileSync(path.join(ROOT, d, 'failureReporter.js'), 'utf8'), ref, `${d}/failureReporter.js drifted`);
});

test('callback: 2xx is delivered and silent; non-2xx and network errors report once, content-free', async () => {
    const got = []; const report = (flow, err, ctx) => got.push({ flow, msg: err.message, ctx });
    assert.equal(await deliverCallback('http://api.test/x', { secret: 'S', bundle: 'B' }, 1000, 'ready', { fetchImpl: async () => new Response('{}', { status: 200 }), report }), true);
    assert.equal(got.length, 0);
    assert.equal(await deliverCallback('http://api.test/x', { secret: 'S' }, 1000, 'ready', { fetchImpl: async () => new Response('no', { status: 401 }), report }), false);
    assert.equal(await deliverCallback('http://api.test/x', { secret: 'S' }, 1000, 'failed', { fetchImpl: async () => { throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.1'), { name: 'TypeError' }); }, report }), false);
    assert.deepEqual(got, [
        { flow: 'worker:callback_failed', msg: 'build result callback rejected by the API', ctx: { http_status: '401', outcome: 'ready' } },
        { flow: 'worker:callback_failed', msg: 'build result callback could not reach the API', ctx: { error_name: 'TypeError', outcome: 'failed' } },
    ]);
    assert.equal(JSON.stringify(got).includes('10.0.0.1'), false);
});

test('streak gate: trips once at the threshold, resets on success', () => {
    const trips = []; const g = createStreakGate(3, (w) => trips.push(w));
    g.fail('a'); g.fail('b'); assert.equal(trips.length, 0);
    g.fail('c'); g.fail('d'); assert.deepEqual(trips, ['c']);
    g.ok(); g.fail('e'); g.fail('f'); assert.equal(trips.length, 1); g.fail('g'); assert.deepEqual(trips, ['c', 'g']);
});

test('reporter is silent under NODE_ENV=test unless a sink is set', async () => {
    const got = []; reportFailure('x', new Error('silent')); _setSink((r) => got.push(r)); reportFailure('x', new Error('seen'), { a: '1' }); await new Promise((r) => setTimeout(r, 10)); _setSink(null);
    assert.deepEqual(got, [{ kind: 'failure', flow: 'x', message: 'seen', context: { a: '1' } }]);
});

test('under node --test the reporter never posts to the production endpoint (a stray reportFailure once emailed the owner as vibebuild/x)', async () => {
    const calls = []; const real = globalThis.fetch;
    globalThis.fetch = async (...a) => { calls.push(a); return new Response('{}', { status: 200 }); };
    try {
        assert.ok(process.env.NODE_TEST_CONTEXT, 'sanity: running under the node test runner');
        reportFailure('x', new Error('must not leave the process'));
        await new Promise((r) => setTimeout(r, 20));
    } finally { globalThis.fetch = real; }
    assert.equal(calls.length, 0, 'no network call to the reporter');
});
