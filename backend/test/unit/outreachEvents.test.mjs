import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { outreachAttribution, outreachConfig, sendOutreachEvent, reportOutreachEvent, reportActivationForUser, resetOutreachActivationCache } from '../../lib/outreachEvents.js';

const ENV = { OUTREACH_EVENTS_URL: 'https://calldesk.example/api/outreach/event', OUTREACH_EVENT_SECRET: 's'.repeat(32) };
const ATTR = { campaign: 'vb-2026-12-a', linkCode: 'abc123' };
const flush = () => new Promise((r) => setTimeout(r, 15));
const res = (status) => new Response('{}', { status });

test('outreachAttribution needs utm_source=outreach and a slug campaign', () => {
    assert.deepEqual(outreachAttribution({ utm_source: 'outreach', utm_campaign: 'VB-2026-12-A', utm_content: 'abc123' }), ATTR);
    assert.deepEqual(outreachAttribution({ utm_source: 'outreach', utm_campaign: 'x', utm_content: 'a@b.com' }), { campaign: 'x', linkCode: null });
    for (const v of [{ utm_source: 'google', utm_campaign: 'x' }, { utm_source: 'outreach' }, { utm_source: 'outreach', utm_campaign: 'bad campaign' }, null, undefined, 'x']) assert.equal(outreachAttribution(v), null);
});

test('outreachConfig is off unless the https URL and a secret are set; per-product secret wins', () => {
    assert.equal(outreachConfig({}), null);
    assert.equal(outreachConfig({ ...ENV, OUTREACH_EVENTS_URL: '' }), null);
    assert.equal(outreachConfig({ ...ENV, OUTREACH_EVENTS_URL: 'http://x.test/e' }), null);
    assert.equal(outreachConfig({ OUTREACH_EVENTS_URL: ENV.OUTREACH_EVENTS_URL }), null);
    assert.equal(outreachConfig({ ...ENV, OUTREACH_EVENT_SECRET_VIBEBUILD: 'p'.repeat(32) }).secret, 'p'.repeat(32));
    assert.equal(outreachConfig(ENV).secret, 's'.repeat(32));
});

test('sendOutreachEvent posts a signed body, with a timeout signal and a PII-free log line', async () => {
    const calls = []; const logs = [];
    const fetchImpl = async (url, init) => { calls.push({ url, init }); return res(200); };
    assert.equal(await sendOutreachEvent({ event: 'signup', attribution: ATTR, email: 'new.user@example.com' }, { env: ENV, fetchImpl, log: (l) => logs.push(l) }), 'sent');
    const { url, init } = calls[0];
    assert.equal(url, ENV.OUTREACH_EVENTS_URL);
    const body = JSON.parse(init.body);
    assert.equal(body.product, 'vibebuild'); assert.equal(body.campaign, 'vb-2026-12-a'); assert.equal(body.event, 'signup');
    assert.equal(body.email, 'new.user@example.com'); assert.equal(body.link_code, 'abc123');
    assert.equal(init.headers['x-outreach-product'], 'vibebuild');
    assert.equal(init.headers['x-outreach-signature'], 'v1=' + createHmac('sha256', 's'.repeat(32)).update(`${init.headers['x-outreach-timestamp']}.${init.body}`).digest('hex'));
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(logs, ['[outreach] signup campaign=vb-2026-12-a status=200']);
});

test('sendOutreachEvent does nothing when off, retries once on 5xx or network error, never retries a 4xx', async () => {
    let n = 0;
    assert.equal(await sendOutreachEvent({ event: 'signup', attribution: ATTR, email: 'a@b.com' }, { env: {}, fetchImpl: async () => { n++; return res(200); } }), 'skipped');
    assert.equal(n, 0);
    const quiet = { env: ENV, retryDelayMs: 1, log: () => {} };
    n = 0; assert.equal(await sendOutreachEvent({ event: 'signup', attribution: ATTR, email: 'a@b.com' }, { ...quiet, fetchImpl: async () => { n++; throw Object.assign(new Error('x'), { name: 'TimeoutError' }); } }), 'failed'); assert.equal(n, 2);
    const seq = [503, 200]; n = 0; assert.equal(await sendOutreachEvent({ event: 'signup', attribution: ATTR, email: 'a@b.com' }, { ...quiet, fetchImpl: async () => { n++; return res(seq.shift()); } }), 'sent'); assert.equal(n, 2);
    n = 0; assert.equal(await sendOutreachEvent({ event: 'signup', attribution: ATTR, email: 'a@b.com' }, { ...quiet, fetchImpl: async () => { n++; return res(401); } }), 'failed'); assert.equal(n, 1);
});

test('reportOutreachEvent returns at once and never throws, even if fetch hangs or throws synchronously', () => {
    assert.equal(reportOutreachEvent({ event: 'signup', attribution: ATTR, email: 'a@b.com' }, { env: ENV, fetchImpl: () => new Promise(() => {}) }), undefined);
    assert.doesNotThrow(() => reportOutreachEvent({ event: 'signup', attribution: ATTR, email: 'a@b.com' }, { env: ENV, retryDelayMs: 1, log: () => {}, fetchImpl: () => { throw new Error('sync'); } }));
});

test('reportActivationForUser: no lookup while off; one report per user; outreach users only; errors swallowed', async () => {
    resetOutreachActivationCache();
    let looked = 0;
    reportActivationForUser('u0', async () => { looked++; return null; }, { env: {} });
    await flush(); assert.equal(looked, 0);

    const bodies = [];
    const deps = { env: ENV, log: () => {}, fetchImpl: async (_u, init) => { bodies.push(JSON.parse(init.body)); return res(200); } };
    const lookup = async () => { looked++; return { attribution: ATTR, email: 'u@example.com' }; };
    reportActivationForUser('u1', lookup, deps); reportActivationForUser('u1', lookup, deps);
    await flush();
    assert.equal(looked, 1); assert.equal(bodies.length, 1);
    assert.equal(bodies[0].event, 'activated'); assert.deepEqual(bodies[0].meta, { milestone: 'first_project_created' });

    reportActivationForUser('u2', async () => null, deps);
    reportActivationForUser('u3', async () => { throw new Error('db down'); }, deps);
    await flush(); assert.equal(bodies.length, 1);
});
