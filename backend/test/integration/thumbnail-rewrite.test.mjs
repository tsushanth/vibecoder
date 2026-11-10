import '../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');

const SHOT = (sub) => `http://178.156.231.255:3465/screenshot?url=${encodeURIComponent(`https://${sub}.vibebuild.cc`)}&width=390&height=844`;
const STORE = 'https://abc.supabase.co/storage/v1/object/public/project-assets/thumbnails/s.jpg';
const row = (o) => ({ id: 'x', title: 'Nice App', creator_id: 'u1', creator_name: 'Sam Taylor', preview_url: 'https://prev-a.vibebuild.cc',
    initial_prompt: 'Build a nice app with many features', created_at: new Date().toISOString(), status: 'ready', ...o });
const rows = [
    row({ id: 'a', initial_prompt: 'first long unique prompt about gardens', thumbnail_url: SHOT('prev-a') }),
    row({ id: 'b', creator_id: 'u2', initial_prompt: 'a completely different long prompt', thumbnail_url: STORE }),
    row({ id: 'c', creator_id: 'u3', initial_prompt: 'yet another unrelated long prompt', thumbnail_url: null }),
];
stubSupabase(supabase, (q) => ({ data: q.single ? null : rows, error: null, count: rows.length }));
const { default: projects } = await import('../../routes/projects.routes.js');

let srv; const realFetch = globalThis.fetch;
before(async () => {
    const app = express(); app.set('trust proxy', 1); app.use(express.json());
    app.use('/api/projects', projects);
    srv = await listen(app);
    await new Promise((r) => setTimeout(r, 100));
});
after(async () => { await srv.close(); });
const quiet = async (fn) => { const o = [console.log, console.warn, console.error]; console.log = console.warn = console.error = () => {}; try { return await fn(); } finally { [console.log, console.warn, console.error] = o; } };
// fetch() will not let a caller set Host, so use a raw request.
const getJson = (path, host) => quiet(() => new Promise((resolve, reject) => {
    const u = new URL(srv.base);
    http.get({ host: u.hostname, port: u.port, path, headers: { host, 'x-forwarded-proto': 'https' } }, (res) => {
        let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
}));
const byId = (j) => Object.fromEntries(j.projects.map((p) => [p.id, p.thumbnail_url]));

test('browse: plain-http screenshot thumbnails come back as this API\'s https route; others are untouched', async () => {
    const j = await getJson('/api/projects/browse', 'api.example.test');
    const t = byId(j);
    assert.equal(t.a, 'https://api.example.test/api/projects/a/thumbnail?miss=404');
    assert.equal(t.b, STORE);
    assert.equal(t.c, null);
    assert.ok(!JSON.stringify(j).includes('178.156.231.255'), 'no raw-IP http URL in the response');
    assert.equal(j.projects.find((p) => p.id === 'a').preview_url, 'https://prev-a.vibebuild.cc'); // other fields unchanged
});

test('my apps: same rewrite', async () => {
    const j = await getJson('/api/projects/my?userId=u1', 'api.example.test');
    const t = byId(j);
    assert.equal(t.a, 'https://api.example.test/api/projects/a/thumbnail?miss=404');
    assert.equal(t.b, STORE);
});

test('a hostile Host header cannot inject into the rewritten link: the fixed fallback origin is used', async () => {
    const j = await getJson('/api/projects/browse', 'evil.test/x?y=<z>');
    assert.equal(byId(j).a, 'https://vibecoder-api.fly.dev/api/projects/a/thumbnail?miss=404');
});
