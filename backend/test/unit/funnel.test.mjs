import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFirstBuildEvent, logFirstBuildStarted } from '../../lib/funnel.js';

test('first build: event with seconds since signup and the auto-start flag', () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    const ev = buildFirstBuildEvent({ priorProjects: 0, signupAt: '2026-11-10T11:56:30Z', now, autoStart: true, entry: 'landing_prompt', platform: 'web' });
    assert.deepEqual(ev, { event: 'signup_to_first_build_started', seconds_since_signup: 210, auto_start: true, entry: 'landing_prompt', platform: 'web' });
});

test('a later build is not the funnel event', () => {
    assert.equal(buildFirstBuildEvent({ priorProjects: 1, signupAt: null }), null);
    assert.equal(buildFirstBuildEvent({ priorProjects: NaN, signupAt: null }), null);
});

test('unknown entry and missing signup time are normalised, nothing else leaks in', () => {
    const ev = buildFirstBuildEvent({ priorProjects: 0, signupAt: undefined, autoStart: 'yes', entry: '<script>', platform: 'x' });
    assert.deepEqual(ev, { event: 'signup_to_first_build_started', seconds_since_signup: null, auto_start: false, entry: 'composer', platform: 'web' });
});

function fakeSupabase({ count, createdAt, error }) {
    const calls = [];
    const q = (table) => ({
        select(_c, opts) { this.head = opts?.head; return this; },
        eq() { return this; },
        neq() { calls.push('neq'); return this; },
        maybeSingle: async () => ({ data: createdAt ? { created_at: createdAt } : null }),
        then(res) { return Promise.resolve(table === 'projects' ? { count, error } : {}).then(res); },
    });
    return { from: (t) => q(t), calls };
}

test('logs once for a first build and excludes the new row from the count', async () => {
    const lines = [];
    const sb = fakeSupabase({ count: 0, createdAt: new Date(Date.now() - 60_000).toISOString() });
    const ev = await logFirstBuildStarted(sb, { userId: 'u', projectId: 'p', autoStart: true, entry: 'landing_prompt', platform: 'web', log: (l) => lines.push(l) });
    assert.equal(ev.auto_start, true);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^\[funnel\] \{"event":"signup_to_first_build_started"/);
    assert.ok(!lines[0].includes('"u"'));
    assert.deepEqual(sb.calls, ['neq']);
});

test('stays silent for an account that has built before, on a lookup error, and never throws', async () => {
    const lines = [];
    const log = (l) => lines.push(l);
    assert.equal(await logFirstBuildStarted(fakeSupabase({ count: 3 }), { userId: 'u', log }), null);
    assert.equal(await logFirstBuildStarted(fakeSupabase({ count: 0, error: { message: 'x' } }), { userId: 'u', log }), null);
    assert.equal(await logFirstBuildStarted({ from() { throw new Error('boom'); } }, { userId: 'u', log }), null);
    assert.equal(await logFirstBuildStarted(fakeSupabase({ count: 0 }), { userId: '', log }), null);
    assert.equal(lines.length, 0);
});
