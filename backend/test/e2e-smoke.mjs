#!/usr/bin/env node
// End-to-end smoke test against a live backend. Read-only, except the appdata round trip
// in throwaway collection '_vb_e2e' on E2E_APP_ID (skipped when unset); everything written is deleted.
//
//   BASE_URL       default https://vibecoder-api.fly.dev
//   E2E_APP_ID     deployment subdomain to use for the appdata round trip (optional)
//   E2E_BASE_DOMAIN  apps' base domain, default vibebuild.cc (origin = https://<appId>.<domain>)
//   E2E_SKIP_PLAN=1  skip /plan (costs ~$0.002 per call)
//
// Exit code: 0 all passed (skips allowed), 1 any failure.
const BASE = (process.env.BASE_URL || 'https://vibecoder-api.fly.dev').replace(/\/+$/, '');
const APP_ID = process.env.E2E_APP_ID || '';
const DOMAIN = process.env.E2E_BASE_DOMAIN || 'vibebuild.cc';
const SKIP_PLAN = process.env.E2E_SKIP_PLAN === '1';
const COLLECTION = '_vb_e2e';

const results = [];
const cleanups = [];
const req = (path, opts = {}) => fetch(BASE + path, { ...opts, signal: AbortSignal.timeout(opts.timeout || 20000) });
const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const check = (cond, msg) => { if (!cond) throw new Error(msg); };
const j = async (r) => { try { return await r.json(); } catch { return null; } };

async function step(name, fn) {
    const t = Date.now();
    try { await fn(); results.push({ name, status: 'PASS', ms: Date.now() - t }); }
    catch (e) { results.push({ name, status: 'FAIL', ms: Date.now() - t, err: e?.name === 'TimeoutError' ? 'timeout' : (e?.message || String(e)) }); }
    const r = results.at(-1);
    console.log(`${r.status === 'PASS' ? 'PASS' : 'FAIL'}  ${name} (${r.ms}ms)${r.err ? `\n      -> ${r.err}` : ''}`);
}
function skip(name, why) { results.push({ name, status: 'SKIP', why }); console.log(`SKIP  ${name} (${why})`); }

console.log(`E2E smoke against ${BASE}\n`);

await step('GET /api/health', async () => {
    const r = await req('/api/health'); check(r.status === 200, `status ${r.status}`);
    check((await j(r))?.healthy === true, 'healthy != true');
});

await step('GET /api/status returns operational flag', async () => {
    const r = await req('/api/status'); check(r.status === 200, `status ${r.status}`);
    const b = await j(r);
    check(typeof b?.operational === 'boolean', `missing boolean "operational": ${JSON.stringify(b)}`);
    check('message' in b, 'missing "message"');
});

await step('browse feed: no email/short/duplicate prompts, every project has a prompt', async () => {
    const r = await req('/api/projects/browse?limit=50&sort=newest'); check(r.status === 200, `status ${r.status}`);
    const b = await j(r); check(b?.success === true && Array.isArray(b.projects), 'bad shape');
    const seen = new Map(); const problems = [];
    for (const p of b.projects) {
        const np = norm(p.initial_prompt);
        if (!np) { problems.push(`${p.id}: empty prompt`); continue; }
        if (np.length < 15) problems.push(`${p.id}: short prompt "${np}"`);
        if (/^\S+@\S+\.\S+$/.test(np) || /^\S+@\S+\.\S+$/.test(norm(p.title))) problems.push(`${p.id}: email in prompt/title`);
        if (seen.has(np)) problems.push(`${p.id}: duplicate prompt of ${seen.get(np)}`); else seen.set(np, p.id);
    }
    check(problems.length === 0, problems.slice(0, 5).join('; ') + (problems.length > 5 ? ` (+${problems.length - 5} more)` : ''));
    check(typeof b.totalCount === 'number', 'missing totalCount');
});

if (SKIP_PLAN) skip('POST /api/projects/plan returns a well-formed plan', 'E2E_SKIP_PLAN=1');
else await step('POST /api/projects/plan returns a well-formed plan', async () => {
    const r = await req('/api/projects/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'A simple pomodoro timer with a start/pause button', userId: 'e2e-smoke' }), timeout: 30000 });
    check(r.status === 200, `status ${r.status} ${JSON.stringify(await j(r))}`);
    const p = (await j(r))?.plan;
    check(p && typeof p.summary === 'string' && p.summary.length > 0, 'plan.summary missing');
    check(Array.isArray(p.features) && p.features.length >= 1 && p.features.length <= 8 && p.features.every((f) => typeof f === 'string' && f), 'plan.features malformed');
    check(typeof p.style === 'string' && p.style.length > 0, 'plan.style missing');
});

await step('POST /plan rejects empty prompt (400, no LLM cost)', async () => {
    const r = await req('/api/projects/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: '' }) });
    check(r.status === 400, `status ${r.status}`);
});

await step('GET /api/projects/<unknown>/progress -> 404', async () => {
    const r = await req('/api/projects/00000000-0000-0000-0000-00000000e2e0/progress'); check(r.status === 404, `status ${r.status}`);
});

await step('POST /api/projects/<id>/progress without worker secret -> 401', async () => {
    const r = await req('/api/projects/00000000-0000-0000-0000-00000000e2e0/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"phase":"fix"}' });
    check(r.status === 401, `status ${r.status}`);
});

await step('POST /api/github/import rejects bad URLs (400)', async () => {
    for (const url of ['https://evil.example.com/o/r', 'https://github.com.evil.com/o/r', 'http://github.com/o/r']) {
        const r = await req('/api/github/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
        check(r.status === 400, `${url} -> status ${r.status}`);
    }
});

// ---- appdata ----
if (!APP_ID) {
    skip('appdata: wrong-origin 403 / 415 / round trip', 'E2E_APP_ID not set');
} else {
    const origin = `https://${APP_ID}.${DOMAIN}`;
    const base = `/api/appdata/${APP_ID}/${COLLECTION}`;
    const key = `e2e-${Date.now().toString(36)}`;
    const H = { Origin: origin, 'Content-Type': 'application/json' };
    let wrote = false;

    await step('appdata: wrong Origin -> 403 (read and write, nothing written)', async () => {
        for (const o of ['https://evil.example.com', `https://${APP_ID}.${DOMAIN}.evil.com`]) {
            const g = await req(`${base}/${key}`, { headers: { Origin: o } }); check(g.status === 403, `GET origin ${o} -> ${g.status}`);
            const p = await req(`${base}/${key}`, { method: 'PUT', headers: { Origin: o, 'Content-Type': 'application/json' }, body: '{"value":1}' });
            check(p.status === 403, `PUT origin ${o} -> ${p.status}`);
        }
        const none = await req(`${base}/${key}`); check(none.status === 403, `no Origin -> ${none.status}`);
    });

    await step('appdata: non-JSON PUT -> 415 (nothing written)', async () => {
        const r = await req(`${base}/${key}`, { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: '{"value":1}' });
        check(r.status === 415, `status ${r.status}`);
    });

    await step('appdata: round trip PUT -> GET -> list -> DELETE -> 404 (cleans up)', async () => {
        cleanups.push(async () => { // runs even if an assertion below fails
            const d = await req(`${base}/${key}`, { method: 'DELETE', headers: { Origin: origin } });
            if (!d.ok) throw new Error(`cleanup DELETE ${key} -> ${d.status}`);
        });
        const value = { hello: 'world', n: 42, at: new Date().toISOString() };
        const put = await req(`${base}/${key}`, { method: 'PUT', headers: H, body: JSON.stringify({ value }) });
        wrote = true;
        check(put.status === 200, `PUT status ${put.status} ${JSON.stringify(await j(put))}`);
        check(put.headers.get('access-control-allow-origin') === origin, 'CORS header not echoing origin');
        const get = await req(`${base}/${key}`, { headers: { Origin: origin } }); check(get.status === 200, `GET status ${get.status}`);
        check(JSON.stringify((await j(get))?.value) === JSON.stringify(value), 'GET value mismatch');
        const list = await req(`${base}?prefix=${encodeURIComponent(key)}`, { headers: { Origin: origin } });
        check(list.status === 200 && (await j(list))?.items?.some((i) => i.key === key), 'key missing from list');
        const del = await req(`${base}/${key}`, { method: 'DELETE', headers: { Origin: origin } }); check(del.status === 200, `DELETE status ${del.status}`);
        cleanups.length = 0; // already deleted
        const gone = await req(`${base}/${key}`, { headers: { Origin: origin } }); check(gone.status === 404, `after delete GET -> ${gone.status}`);
    });
    void wrote;
}

// Always run pending cleanups (a failed round trip must not leave data behind).
for (const c of cleanups) {
    try { await c(); console.log('cleanup: deleted leftover e2e key'); }
    catch (e) { results.push({ name: 'cleanup', status: 'FAIL', err: e.message }); console.log(`FAIL  cleanup -> ${e.message}`); }
}

const count = (s) => results.filter((r) => r.status === s).length;
console.log(`\n${count('PASS')} passed, ${count('FAIL')} failed, ${count('SKIP')} skipped (of ${results.length})`);
if (count('FAIL')) {
    console.log('\nFailures:');
    for (const r of results.filter((x) => x.status === 'FAIL')) console.log(`  - ${r.name}: ${r.err}`);
    process.exit(1);
}
