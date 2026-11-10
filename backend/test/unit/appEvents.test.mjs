import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppEvents, buildRow, cleanProps, promptLengthBucket, sourceFromRequest, EVENTS, PROP_KEYS } from '../../lib/appEvents.js';
import { createBuildEvents } from '../../lib/buildEvents.js';

const quietLog = { warn() {}, error() {}, log() {} };
function fakeClient({ onInsert = async () => ({ error: null }), onDelete = async () => ({ error: null }) } = {}) {
    const inserts = [];
    return {
        inserts,
        from: (table) => ({
            insert(row) { inserts.push({ table, row }); const p = onInsert(row); const b = { abortSignal: () => b, then: (a, r) => p.then(a, r) }; return b; },
            delete() { return { eq: () => onDelete() }; },
        }),
    };
}
const tick = () => new Promise((r) => setTimeout(r, 15));

test('allow-list: only the named events are accepted', () => {
    assert.ok(EVENTS.includes('build_started'));
    assert.equal(buildRow({ event: 'page_view', userId: 'u1' }), null);
    assert.equal(buildRow({ event: '', userId: 'u1' }), null);
    assert.equal(buildRow({ event: undefined }), null);
    assert.equal(buildRow({ event: 'constructor' }), null);
    assert.equal(buildRow({ event: '__proto__' }), null);
});

test('props: unknown keys are dropped, known keys keep only valid values', () => {
    const out = cleanProps({
        duration_ms: 61234.6, status: 429, error_code: 'DISPATCH_ERROR', source: 'web', plan_step_skipped: true,
        prompt_length_bucket: '100_249', build_kind: 'retry', cap: 'hourly_generation', choice: 'learning',
        prompt: 'build me a todo app', email: 'a@b.co', message: 'boom', initial_prompt: 'x',
    });
    assert.deepEqual(out, { duration_ms: 61235, status: 429, error_code: 'DISPATCH_ERROR', source: 'web', plan_step_skipped: true, prompt_length_bucket: '100_249', build_kind: 'retry', cap: 'hourly_generation', choice: 'learning' });
    assert.deepEqual(Object.keys(cleanProps(Object.fromEntries(PROP_KEYS.map((k) => [k, 'x'])))).length, 0, 'a bare string is valid for no key');
});

test('props: free text in an allowed key is refused, never stored (prompt, email, message, url)', () => {
    const texts = ['Build me a pomodoro timer for jane@example.com', 'jane@example.com', 'Claude exited 1 for dev@example.com', 'https://x.test/a?token=1', 'DISPATCH_ERROR: could not build "secret"', '', 'web '];
    for (const t of texts) {
        for (const key of PROP_KEYS) assert.deepEqual(cleanProps({ [key]: t }), {}, `${key} accepted ${t}`);
    }
    // arrays/objects/null/NaN/out-of-range numbers
    assert.deepEqual(cleanProps({ status: 99, duration_ms: -1 }), {});
    assert.deepEqual(cleanProps({ status: 'jane@example.com', duration_ms: NaN, plan_step_skipped: 'yes', source: ['web'], error_code: { x: 1 } }), {});
    assert.deepEqual(cleanProps(null), {}); assert.deepEqual(cleanProps([1]), {}); assert.deepEqual(cleanProps('x'), {});
    assert.equal(cleanProps({ duration_ms: 10 ** 12 }).duration_ms, 24 * 60 * 60 * 1000, 'clamped to a day');
});

test('user_id and anon_id must look like ids: an email or free text becomes null', () => {
    assert.equal(buildRow({ event: 'login', userId: 'jane@example.com' }).user_id, null);
    assert.equal(buildRow({ event: 'login', userId: 'Jane Doe' }).user_id, null);
    assert.equal(buildRow({ event: 'login', userId: 'a'.repeat(65) }).user_id, null);
    assert.equal(buildRow({ event: 'login', userId: '0a1b2c3d-1111-2222-3333-444455556666' }).user_id, '0a1b2c3d-1111-2222-3333-444455556666');
    assert.equal(buildRow({ event: 'login', userId: 'device_abc:12.3' }).user_id, 'device_abc:12.3');
    assert.equal(buildRow({ event: 'login', anonId: 'x@y.z' }).anon_id, null);
    assert.deepEqual(Object.keys(buildRow({ event: 'login', userId: 'u', props: { source: 'web' } })).sort(), ['anon_id', 'event', 'props', 'user_id']);
});

test('emit(): what reaches the database has only allow-listed columns and values (nothing from a hostile caller)', async () => {
    const c = fakeClient(); const ev = createAppEvents({ getClient: () => c, log: quietLog });
    ev.emit('build_started', { userId: 'u1', props: { source: 'web', prompt: 'SECRET PROMPT', error_code: 'SECRET PROMPT x@y.co', prompt_length_bucket: 'lt40' }, extra: 'SECRET' });
    await tick();
    assert.equal(c.inserts.length, 1);
    assert.equal(c.inserts[0].table, 'app_events');
    assert.deepEqual(c.inserts[0].row, { user_id: 'u1', anon_id: null, event: 'build_started', props: { source: 'web', prompt_length_bucket: 'lt40' } });
    assert.ok(!JSON.stringify(c.inserts).includes('SECRET'));
});

test('emit(): returns at once and never throws, even when the database hangs, throws or is missing', async () => {
    const hang = createAppEvents({ getClient: () => fakeClient({ onInsert: () => new Promise(() => {}) }), timeoutMs: 30, log: quietLog });
    const t0 = Date.now(); assert.equal(hang.emit('login', { userId: 'u' }), undefined); assert.ok(Date.now() - t0 < 20, 'emit must not wait');
    const rec = await hang.record('login', { userId: 'u' }); assert.deepEqual(rec, { ok: false, reason: 'timeout' });

    const boom = createAppEvents({ getClient: () => { throw new Error('x'); }, log: quietLog });
    assert.doesNotThrow(() => boom.emit('login', { userId: 'u' })); assert.deepEqual(await boom.record('login'), { ok: false, reason: 'error' });
    const thrower = createAppEvents({ getClient: () => ({ from() { throw new Error('y'); } }), log: quietLog });
    assert.doesNotThrow(() => thrower.emit('login')); assert.equal((await thrower.record('login')).ok, false);
    const none = createAppEvents({ getClient: () => null, log: quietLog });
    assert.doesNotThrow(() => none.emit('login')); assert.doesNotThrow(() => none.emit(undefined)); assert.doesNotThrow(() => none.emit('login', null));
    await tick();
});

test('emit(): a missing table backs off and warns once; the kill switch and invalid events skip the database', async () => {
    const warns = []; let calls = 0;
    const ev = createAppEvents({ getClient: () => fakeClient({ onInsert: async () => { calls++; return { error: { code: '42P01', message: 'relation "app_events" does not exist' } }; } }), backoffMs: 60_000, log: { warn: (m) => warns.push(m) } });
    await ev.record('login', { userId: 'u' }); await ev.record('login', { userId: 'u' }); await ev.record('login', { userId: 'u' });
    assert.equal(calls, 1, 'backed off after the first failure'); assert.equal(warns.length, 1);
    let off = 0; const killed = createAppEvents({ getClient: () => fakeClient({ onInsert: async () => { off++; return {}; } }), enabled: () => false, log: quietLog });
    killed.emit('login', { userId: 'u' }); await killed.record('login'); await killed.record('not_an_event'); assert.equal(off, 0);
});

test('emit(): sheds load instead of piling up when inserts are slow', async () => {
    let started = 0; const release = [];
    const ev = createAppEvents({ getClient: () => fakeClient({ onInsert: () => { started++; return new Promise((r) => release.push(r)); } }), maxInFlight: 3, timeoutMs: 5000, log: quietLog });
    for (let i = 0; i < 20; i++) ev.emit('login', { userId: 'u' });
    await tick(); assert.equal(started, 3);
    release.forEach((r) => r({ error: null })); await tick();
    ev.emit('login', { userId: 'u' }); await tick(); assert.equal(started, 4, 'accepts events again once capacity frees up');
});

test('record(): a duplicate (unique index) is reported as duplicate, not as a failure to warn about', async () => {
    const warns = []; const ev = createAppEvents({ getClient: () => fakeClient({ onInsert: async () => ({ error: { code: '23505' } }) }), log: { warn: (m) => warns.push(m) } });
    assert.deepEqual(await ev.record('first_build_survey', { userId: 'u', props: { choice: 'learning' } }), { ok: false, reason: 'duplicate' }); assert.equal(warns.length, 0);
});

test('deleteForUser(): deletes by user id, refuses bad ids, tolerates a missing table, never throws', async () => {
    let n = 0; const ev = createAppEvents({ getClient: () => fakeClient({ onDelete: async () => { n++; return { error: null }; } }), log: quietLog });
    assert.equal(await ev.deleteForUser('u1'), true); assert.equal(n, 1);
    assert.equal(await ev.deleteForUser('a@b.co'), false); assert.equal(n, 1);
    const missing = createAppEvents({ getClient: () => fakeClient({ onDelete: async () => ({ error: { code: '42P01', message: 'relation "app_events" does not exist' } }) }), log: quietLog });
    assert.equal(await missing.deleteForUser('u1'), true);
    const bad = createAppEvents({ getClient: () => { throw new Error('x'); }, log: quietLog }); assert.equal(await bad.deleteForUser('u1'), false);
});

test('promptLengthBucket and sourceFromRequest', () => {
    assert.deepEqual([0, 39, 40, 99, 100, 249, 250, 799, 800, 5000].map(promptLengthBucket), ['lt40', 'lt40', '40_99', '40_99', '100_249', '100_249', '250_799', '250_799', '800plus', '800plus']);
    assert.equal(promptLengthBucket(NaN), undefined); assert.equal(promptLengthBucket(-1), undefined);
    const r = (h) => ({ headers: h });
    assert.equal(sourceFromRequest(r({ 'user-agent': 'okhttp/4.12' })), 'android');
    assert.equal(sourceFromRequest(r({ 'user-agent': 'Mozilla/5.0 (Mac)' })), 'web');
    assert.equal(sourceFromRequest(r({ 'x-client-platform': 'ANDROID' })), 'android');
    assert.equal(sourceFromRequest(r({ 'user-agent': 'curl/8' })), 'api'); assert.equal(sourceFromRequest(r({})), 'api'); assert.equal(sourceFromRequest(undefined), 'api');
});

test('buildEvents: duration from the recorded start, plan_step_skipped from a recent /plan, build_failed owner lookup', async () => {
    let t = 1_000_000; const out = [];
    const rows = [{ id: 'cron-1', creator_id: 'owner-9', created_at: new Date(t - 25 * 60_000).toISOString() }];
    const client = { from: () => ({ select: () => ({ in: async () => ({ data: rows, error: null }) }) }) };
    const be = createBuildEvents({ emit: (e, o) => out.push([e, o]), getClient: () => client, now: () => t });
    be.planRequested('u1');
    be.buildStarted({ projectId: 'p1', userId: 'u1', source: 'web', prompt: 'x'.repeat(120), kind: 'new' });
    be.buildStarted({ projectId: 'p2', userId: 'u2', source: 'android', prompt: 'hello', kind: 'new' });
    assert.equal(out[0][1].props.plan_step_skipped, false); assert.equal(out[1][1].props.plan_step_skipped, true);
    assert.equal(out[0][1].props.prompt_length_bucket, '100_249'); assert.ok(!JSON.stringify(out).includes('xxxx'));
    t += 61_000; await be.buildReady('p1', { source: 'web' });
    assert.deepEqual(out[2], ['build_ready', { userId: 'u1', props: { duration_ms: 61000, build_kind: 'new', source: 'web', error_code: undefined, status: undefined } }]);
    await be.buildReady('p1', { source: 'web' }); // start entry already consumed: falls back to the project row lookup (none here)
    t += 1000; await be.buildFailed('p2', { code: 'NO_RESULT' });
    assert.equal(out.find((o) => o[0] === 'build_failed' && o[1].userId === 'u2').at(1).props.source, 'android');
    await be.buildFailed(['cron-1'], { code: 'TIMEOUT_STUCK' });
    const cron = out.at(-1); assert.equal(cron[1].userId, 'owner-9'); assert.equal(cron[1].props.duration_ms, 25 * 60_000 + 62_000); // created 25 min before the first tick, 62 s have passed since
    t += 31 * 60_000; // plan window expired
    be.buildStarted({ projectId: 'p3', userId: 'u1', source: 'web', prompt: 'a', kind: 'new' });
    assert.equal(out.at(-1)[1].props.plan_step_skipped, true);
});

test('buildEvents: login is throttled to one per person per half hour; retry builds have no plan flag', () => {
    let t = 0; const out = [];
    const be = createBuildEvents({ emit: (e, o) => out.push([e, o]), now: () => t });
    assert.equal(be.loginDue('u1'), true); assert.equal(be.loginDue('u1'), false); assert.equal(be.loginDue('u2'), true);
    t += 29 * 60_000; assert.equal(be.loginDue('u1'), false); t += 2 * 60_000; assert.equal(be.loginDue('u1'), true);
    assert.equal(be.loginDue(''), false); assert.equal(be.loginDue(undefined), false);
    be.buildStarted({ projectId: 'r', userId: 'u1', source: 'web', prompt: 'abc', kind: 'retry' });
    assert.equal(out[0][1].props.plan_step_skipped, undefined); assert.equal(out[0][1].props.build_kind, 'retry');
});

test('buildEvents: bookkeeping stays bounded', () => {
    const be = createBuildEvents({ emit() {}, now: () => 5 });
    for (let i = 0; i < 12_000; i++) { be.buildStarted({ projectId: `p${i}`, userId: 'u', source: 'web', prompt: 'x' }); be.planRequested(`u${i}`); be.loginDue(`u${i}`); }
    const s = be._sizes(); assert.ok(s.starts <= 5000 && s.plans <= 5000 && s.logins <= 5000, JSON.stringify(s));
});
