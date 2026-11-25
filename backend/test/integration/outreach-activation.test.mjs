import './../helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');
const { noteProjectCreated } = await import('../../lib/outreachEventsInstance.js');
const { resetOutreachActivationCache } = await import('../../lib/outreachEvents.js');

// First project created = activation, only for users whose stored first touch is an outreach link, only for their first project.
const users = new Map(); const projectCounts = new Map();
stubSupabase(supabase, (q) => {
    const id = eqOf(q, 'user_id') ?? eqOf(q, 'creator_id');
    if (q.table === 'users') return { data: users.get(id) ?? null, error: null };
    if (q.table === 'projects') return { data: null, count: projectCounts.get(id) ?? 0, error: null };
    return { data: null, error: null };
});

const realFetch = globalThis.fetch;
async function run(userId) {
    const sent = [];
    process.env.OUTREACH_EVENTS_URL = 'https://calldesk.example/api/outreach/event'; process.env.OUTREACH_EVENT_SECRET = 's'.repeat(32);
    globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); };
    const log = console.log; console.log = () => {};
    try { noteProjectCreated(userId, 'p-new'); await new Promise((r) => setTimeout(r, 30)); }
    finally { console.log = log; globalThis.fetch = realFetch; delete process.env.OUTREACH_EVENTS_URL; delete process.env.OUTREACH_EVENT_SECRET; }
    return sent;
}
const outreachUser = { email: 'o@x.com', utm_source: 'outreach', utm_campaign: 'vb-2026-12-a', utm_content: 'abc123' };

test('an outreach user creating their first project is reported once as activated', async () => {
    resetOutreachActivationCache(); users.set('u1', outreachUser);
    const sent = await run('u1');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].event, 'activated'); assert.equal(sent[0].campaign, 'vb-2026-12-a'); assert.equal(sent[0].email, 'o@x.com'); assert.equal(sent[0].link_code, 'abc123');
    assert.deepEqual(await run('u1'), [], 'a second project of the same user in this process reports nothing');
});

test('not reported: later project, non-outreach user, unknown user, layer off', async () => {
    resetOutreachActivationCache();
    users.set('u2', outreachUser); projectCounts.set('u2', 3);
    users.set('u3', { email: 'g@x.com', utm_source: 'google', utm_campaign: 'x' });
    assert.deepEqual(await run('u2'), []); assert.deepEqual(await run('u3'), []); assert.deepEqual(await run('nobody'), []);
    users.set('u4', outreachUser);
    noteProjectCreated('u4', 'p'); await new Promise((r) => setTimeout(r, 20)); // env unset: no fetch happens
});
