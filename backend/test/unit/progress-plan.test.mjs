import './../helpers/env.mjs';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { stubSupabase } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');
stubSupabase(supabase, () => ({ data: [], error: null })); // browse/suggestion cache loads at import
const { _internals: I } = await import('../../routes/projects.routes.js');

beforeEach(() => I.buildProgress.clear());

test('progressRecord: percent is monotonic, clamped, rounded', () => {
    I.progressStart('p');
    I.progressRecord('p', { phase: 'generate', percent: 40 });
    I.progressRecord('p', { phase: 'fix', percent: 20 });       // regress attempt
    assert.equal(I.buildProgress.get('p').percent, 40);
    I.progressRecord('p', { phase: 'fix', percent: 55.6 });
    assert.equal(I.buildProgress.get('p').percent, 56);
    I.progressRecord('p', { phase: 'x', percent: 500 });
    assert.equal(I.buildProgress.get('p').percent, 100);
    I.progressRecord('p', { phase: 'x', percent: -5 });
    assert.equal(I.buildProgress.get('p').percent, 100);
});

test('progressRecord: non-numeric percent keeps previous; phase/detail truncation and defaults', () => {
    I.progressRecord('q', { phase: 'p'.repeat(100), message: 'm'.repeat(500), percent: 'abc' });
    const e = I.buildProgress.get('q');
    assert.equal(e.percent, 0);
    assert.equal(e.phase.length, 32);
    assert.equal(e.detail.length, 200);
    I.progressRecord('q', {});
    assert.equal(I.buildProgress.get('q').phase.length, 32, 'phase retained when omitted');
    I.progressRecord('r', {});
    assert.equal(I.buildProgress.get('r').phase, 'generate');
});

test('progressRecord: implicit entry creation and event cap of 50 (oldest dropped)', () => {
    for (let i = 0; i < 80; i++) I.progressRecord('c', { phase: 'generate', message: `m${i}`, percent: i });
    const ev = I.buildProgress.get('c').events;
    assert.equal(ev.length, I.PROGRESS_MAX_EVENTS);
    assert.equal(ev[0].message, 'm30');
    assert.equal(ev.at(-1).message, 'm79');
});

test('progressStart ignores falsy id and resets an existing entry', () => {
    I.progressStart(''); I.progressStart(null);
    assert.equal(I.buildProgress.size, 0);
    I.progressRecord('z', { phase: 'fix', percent: 70 });
    I.progressStart('z');
    assert.equal(I.buildProgress.get('z').percent, 0);
});

test('TTL sweep drops entries idle > 1h only', () => {
    I.progressRecord('old', { phase: 'a' }); I.progressRecord('new', { phase: 'a' });
    I.buildProgress.get('old').updatedAt = Date.now() - I.PROGRESS_TTL_MS - 1000;
    I.sweepProgress();
    assert.deepEqual([...I.buildProgress.keys()], ['new']);
    I.sweepProgress(Date.now() + I.PROGRESS_TTL_MS + 1000);
    assert.equal(I.buildProgress.size, 0);
});

test('payload: derived phase timeline from elapsed time when no worker events', () => {
    const now = 1_000_000_000_000;
    const at = (s) => I.buildProgressPayload({ status: 'building', createdAt: new Date(now - s * 1000).toISOString(), entry: null, now });
    const expect = [[0, 'generate'], [59, 'generate'], [60, 'validate'], [70, 'fix'], [95, 'polish'], [125, 'verify'], [140, 'package'], [9999, 'package']];
    for (const [s, phase] of expect) assert.equal(at(s).phase, phase, `t=${s}`);
    assert.equal(at(0).percent, 0);
    assert.equal(at(75).percent, Math.round(75 / 150 * 95));
    assert.equal(at(9999).percent, 95, 'derived percent capped at 95');
    assert.equal(at(-50).percent, 0, 'future createdAt clamps to 0');
    assert.deepEqual(at(10).events, []);
});

test('payload: worker entry wins, percent capped at 99 while building', () => {
    I.progressRecord('w', { phase: 'polish', detail: 'Polishing', percent: 100 });
    const p = I.buildProgressPayload({ status: 'building', createdAt: new Date().toISOString(), entry: I.buildProgress.get('w') });
    assert.equal(p.phase, 'polish'); assert.equal(p.percent, 99); assert.equal(p.events.length, 1);
});

test('payload: ready / failed / unknown status', () => {
    const base = { createdAt: new Date().toISOString() };
    assert.deepEqual(
        (({ status, phase, percent }) => ({ status, phase, percent }))(I.buildProgressPayload({ ...base, status: 'ready', entry: null })),
        { status: 'ready', phase: 'ready', percent: 100 });
    const f = I.buildProgressPayload({ ...base, status: 'failed', entry: { phase: 'fix', percent: 42, events: [] } });
    assert.equal(f.status, 'failed'); assert.equal(f.percent, 42); assert.match(f.error, /retry/i);
    assert.equal(I.buildProgressPayload({ ...base, status: 'weird', entry: null }).status, 'ready'); // any non-building/failed = ready
});

test('payload: invalid createdAt does not produce NaN/Invalid Date', () => {
    const p = I.buildProgressPayload({ status: 'building', createdAt: 'garbage', entry: null, now: 5000 });
    assert.ok(Number.isFinite(p.percent)); assert.doesNotThrow(() => new Date(p.startedAt).toISOString());
});

test('normalizePlan', () => {
    const n = I.normalizePlan;
    assert.equal(n(null), null); assert.equal(n('x'), null);
    assert.equal(n({ summary: 'ok', features: [] }), null);
    assert.equal(n({ summary: '  ', features: ['a'] }), null);
    assert.equal(n({ summary: 's', features: 'a' }), null);
    assert.deepEqual(n({ summary: ' s ', features: ['a', 5, '  ', ' b '] }), { summary: 's', features: ['a', 'b'], style: 'Clean, modern, mobile-friendly' });
    const big = n({ summary: 's'.repeat(999), style: 'y'.repeat(999), features: Array.from({ length: 20 }, () => 'f'.repeat(300)) });
    assert.equal(big.summary.length, 400); assert.equal(big.style.length, 200);
    assert.equal(big.features.length, 8); assert.equal(big.features[0].length, 120);
});
