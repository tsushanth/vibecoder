import '../helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeBuilder } from '../helpers/supabaseStub.mjs';
import {
    createDomainService, normalizeDomain, isValidDomain, normalizeIp, isCertReady, DomainConfigError,
} from '../../services/domainService.js';

// ---- fakes -----------------------------------------------------------------

function makeDb(seed = {}) {
    const t = { custom_domains: [], deployments: [], ...seed };
    const iso = () => new Date().toISOString();
    const handler = (q) => {
        const rows = t[q.table];
        const match = (r) => q.filters.every(([m, c, v]) => m !== 'eq' || r[c] === v);
        if (q.op === 'insert') {
            const row = { id: crypto.randomUUID(), created_at: iso(), updated_at: iso(), ...q.payload };
            if (q.table === 'custom_domains' && rows.some((r) => r.domain === row.domain)) {
                return { data: null, error: { code: '23505' } };
            }
            rows.push(row);
            return { data: row, error: null };
        }
        if (q.op === 'update') { rows.filter(match).forEach((r) => Object.assign(r, q.payload)); return { data: null, error: null }; }
        if (q.op === 'delete') {
            for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) rows.splice(i, 1);
            return { data: null, error: null };
        }
        const out = rows.filter(match).map((r) =>
            q.table === 'custom_domains' ? { ...r, deployments: t.deployments.find((d) => d.id === r.deployment_id) } : r);
        return { data: q.single ? (out[0] ?? null) : out, error: null };
    };
    return { t, from: (table) => makeBuilder(table, handler) };
}

const DEP = { id: 'dep-1', user_id: 'u1', subdomain: 'my-app', status: 'active' };
const ISSUED = { configured: true, status: 'Ready', certificates: [{ issued: [{ expires_at: '2099-01-01T00:00:00Z' }] }] };
const PENDING = { configured: false, status: 'Awaiting configuration', certificates: [] };

function makeFly(certResponse = ISSUED) {
    const calls = [];
    const fetchFn = async (url, opts = {}) => {
        const path = url.replace('https://api.machines.dev/v1', '');
        calls.push({ method: opts.method || 'GET', path, headers: opts.headers, body: opts.body });
        const body = (opts.method === 'GET' || !opts.method) ? certResponse : {};
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    return { calls, fetchFn };
}

function makeDns({ cname = [], a = [], aaaa = [], txt = [] } = {}) {
    const fail = (code) => Object.assign(new Error(code), { code });
    return {
        resolveCname: async () => { if (!cname.length) throw fail('ENODATA'); return cname; },
        resolve4: async () => { if (!a.length) throw fail('ENODATA'); return a; },
        resolve6: async () => { if (!aaaa.length) throw fail('ENODATA'); return aaaa; },
        resolveTxt: async () => { if (!txt.length) throw fail('ENOTFOUND'); return txt; },
    };
}

const svc = ({ db = makeDb({ deployments: [{ ...DEP }] }), dns = makeDns(), fly = makeFly(), env = {}, now } = {}) =>
    ({ db, fly, ...createDomainService({ supabase: db, dns, fetchFn: fly.fetchFn, now, env: { FLY_API_TOKEN: 'FlyV1 fm2_test', ...env } }) });

// ---- pure helpers ----------------------------------------------------------

test('normalizeDomain strips scheme, path, port, case and trailing dot', () => {
    assert.equal(normalizeDomain('  HTTPS://WWW.Example.com/path?q=1#x '), 'www.example.com');
    assert.equal(normalizeDomain('example.com:8080'), 'example.com');
    assert.equal(normalizeDomain('example.com.'), 'example.com');
    assert.equal(normalizeDomain(null), '');
    assert.equal(normalizeDomain(42), '');
});

test('isValidDomain accepts real hostnames and rejects ours, IPs and junk', () => {
    for (const ok of ['example.com', 'www.example.com', 'my-app.example.co.uk', 'xn--bcher-kva.example']) {
        assert.equal(isValidDomain(ok), true, ok);
    }
    for (const bad of ['', null, 'localhost', '1.2.3.4', 'vibebuild.cc', 'x.vibebuild.cc', 'x.fly.dev', 'a.internal',
        '-bad.com', 'bad-.com', 'exa mple.com', 'example', 'a'.repeat(64) + '.com', 'under_score.com', '*.example.com']) {
        assert.equal(isValidDomain(bad), false, String(bad));
    }
});

test('normalizeIp makes equivalent IPv6 spellings equal', () => {
    assert.equal(normalizeIp('2A09:8280:1::117:24DA:0'), normalizeIp('2a09:8280:1:0:0:117:24da:0'));
    assert.equal(normalizeIp('66.241.125.51'), '66.241.125.51');
});

test('isCertReady needs configured AND an unexpired issued cert', () => {
    assert.equal(isCertReady(ISSUED), true);
    assert.equal(isCertReady(PENDING), false);
    assert.equal(isCertReady({ configured: true, certificates: [] }), false);
    assert.equal(isCertReady({ configured: false, certificates: ISSUED.certificates }), false);
    assert.equal(isCertReady({ configured: true, certificates: [{ issued: [{ expires_at: '2001-01-01T00:00:00Z' }] }] }), false);
    assert.equal(isCertReady(null), false);
});

// ---- DNS -------------------------------------------------------------------

test('verifyCNAME matches the expected target, ignoring case and trailing dot', async () => {
    const s = svc({ dns: makeDns({ cname: ['My-App.VibeBuild.cc.'] }) });
    assert.equal(await s.verifyCNAME('www.example.com', 'my-app'), true);
    assert.equal(await s.verifyCNAME('www.example.com', 'other-app'), false);
});

test('verifyCNAME is false when there is no record', async () => {
    assert.equal(await svc().verifyCNAME('www.example.com', 'my-app'), false);
});

test('verifyAddressRecords accepts our A or AAAA (any IPv6 spelling) and rejects others', async () => {
    assert.equal(await svc({ dns: makeDns({ a: ['66.241.125.51'] }) }).verifyAddressRecords('example.com'), true);
    assert.equal(await svc({ dns: makeDns({ aaaa: ['2a09:8280:1:0:0:117:24da:0'] }) }).verifyAddressRecords('example.com'), true);
    assert.equal(await svc({ dns: makeDns({ a: ['1.2.3.4'], aaaa: ['2001:db8::1'] }) }).verifyAddressRecords('example.com'), false);
    assert.equal(await svc().verifyAddressRecords('example.com'), false);
});

test('verifyTXTToken joins TXT chunks', async () => {
    const s = svc({ dns: makeDns({ txt: [['vibe-verify-', 'abc']] }) });
    assert.equal(await s.verifyTXTToken('example.com', 'vibe-verify-abc'), true);
    assert.equal(await s.verifyTXTToken('example.com', 'other'), false);
});

// ---- Fly -------------------------------------------------------------------

test('without FLY_API_TOKEN nothing is simulated: it throws DomainConfigError', async () => {
    const s = svc({ env: { FLY_API_TOKEN: '' } });
    await assert.rejects(() => s.provisionSSLCert('example.com'), DomainConfigError);
});

test('certificate requests use the ACME endpoint and correct auth header format', async () => {
    const fly = makeFly();
    const s = svc({ fly });
    await s.provisionSSLCert('www.example.com');
    assert.deepEqual(
        { method: fly.calls[0].method, path: fly.calls[0].path, body: JSON.parse(fly.calls[0].body) },
        { method: 'POST', path: '/apps/vibecoder-deploy/certificates/acme', body: { hostname: 'www.example.com' } });
    assert.equal(fly.calls[0].headers.Authorization, 'FlyV1 fm2_test'); // macaroon tokens are sent as-is

    const bearer = makeFly();
    await svc({ fly: bearer, env: { FLY_API_TOKEN: 'plain-token' } }).getSSLCertStatus('www.example.com');
    assert.equal(bearer.calls[0].headers.Authorization, 'Bearer plain-token');
    assert.equal(bearer.calls[0].path, '/apps/vibecoder-deploy/certificates/www.example.com');
});

test('re-provisioning an existing certificate is not an error', async () => {
    const calls = [];
    const fetchFn = async (url, opts = {}) => {
        calls.push(`${opts.method || 'GET'} ${url.replace('https://api.machines.dev/v1', '')}`);
        if (opts.method === 'POST') return { ok: false, status: 422, text: async () => 'certificate already exists' };
        return { ok: true, status: 200, text: async () => JSON.stringify(PENDING) };
    };
    const s = createDomainService({ supabase: makeDb(), dns: makeDns(), fetchFn, env: { FLY_API_TOKEN: 't' } });
    assert.deepEqual(await s.provisionSSLCert('example.com'), PENDING);
    assert.equal(calls.length, 2);
});

// ---- addDomain -------------------------------------------------------------

test('addDomain creates a pending record with CNAME, TXT and apex instructions', async () => {
    const s = svc();
    const r = await s.addDomain('dep-1', 'u1', 'HTTPS://www.Example.com/');
    assert.equal(r.domain, 'www.example.com');
    assert.equal(r.verification_status, 'pending');
    assert.equal(r.cnameTarget, 'my-app.vibebuild.cc');
    assert.equal(r.txtRecord, '_vibebuilder.www.example.com');
    assert.match(r.txtValue, /^vibe-verify-[0-9a-f]{16}$/);
    assert.deepEqual(r.apexRecords.a, ['66.241.125.51']);
    assert.ok(r.apexRecords.aaaa.length >= 1);
});

test('addDomain rejects a deployment the user does not own', async () => {
    await assert.rejects(() => svc().addDomain('dep-1', 'someone-else', 'example.com'), /not found or not owned/);
    const inactive = makeDb({ deployments: [{ ...DEP, status: 'deleted' }] });
    await assert.rejects(() => svc({ db: inactive }).addDomain('dep-1', 'u1', 'example.com'), /not found or not owned/);
});

test('addDomain is idempotent for the same domain and blocks a second one', async () => {
    const s = svc();
    const first = await s.addDomain('dep-1', 'u1', 'example.com');
    const again = await s.addDomain('dep-1', 'u1', 'example.com');
    assert.equal(again.verification_token, first.verification_token);
    assert.equal(s.db.t.custom_domains.length, 1);
    await assert.rejects(() => s.addDomain('dep-1', 'u1', 'other.com'), /already has a custom domain/);
});

test('a domain claimed by another app is rejected while the claim is fresh or active', async () => {
    const db = makeDb({
        deployments: [{ ...DEP }, { ...DEP, id: 'dep-2', user_id: 'u2', subdomain: 'their-app' }],
        custom_domains: [{ id: 'c1', deployment_id: 'dep-2', user_id: 'u2', domain: 'example.com', verification_status: 'pending', updated_at: new Date().toISOString() }],
    });
    await assert.rejects(() => svc({ db }).addDomain('dep-1', 'u1', 'example.com'), /already registered/);
    db.t.custom_domains[0].verification_status = 'active';
    db.t.custom_domains[0].updated_at = '2000-01-01T00:00:00Z';
    await assert.rejects(() => svc({ db }).addDomain('dep-1', 'u1', 'example.com'), /already registered/);
});

test('a stale unverified claim can be taken over by the real owner', async () => {
    const db = makeDb({
        deployments: [{ ...DEP }, { ...DEP, id: 'dep-2', user_id: 'u2', subdomain: 'their-app' }],
        custom_domains: [{ id: 'c1', deployment_id: 'dep-2', user_id: 'u2', domain: 'example.com', verification_status: 'pending', updated_at: new Date(Date.now() - 2 * 3600e3).toISOString() }],
    });
    const r = await svc({ db }).addDomain('dep-1', 'u1', 'example.com');
    assert.equal(r.deployment_id, 'dep-1');
    assert.equal(db.t.custom_domains.length, 1);
    assert.equal(db.t.custom_domains[0].user_id, 'u1');
});

// ---- verifyDomain ----------------------------------------------------------

async function withDomain(opts = {}) {
    const s = svc(opts);
    const added = await s.addDomain('dep-1', 'u1', opts.domain || 'www.example.com');
    return { s, added, row: () => s.db.t.custom_domains[0] };
}

test('verify: no DNS records -> pending, and Fly is never called', async () => {
    const { s } = await withDomain();
    const r = await s.verifyDomain('dep-1', 'u1');
    assert.equal(r.status, 'pending');
    assert.equal(r.cnameExpected, 'my-app.vibebuild.cc');
    assert.equal(r.cnameFound, false);
    assert.equal(s.fly.calls.length, 0);
});

test('verify: CNAME present but certificate not issued yet -> ssl_provisioning', async () => {
    const { s, row } = await withDomain({ dns: makeDns({ cname: ['my-app.vibebuild.cc'] }), fly: makeFly(PENDING) });
    const r = await s.verifyDomain('dep-1', 'u1');
    assert.equal(r.status, 'ssl_provisioning');
    assert.match(r.message, /Issuing the certificate/);
    assert.equal(row().verification_status, 'ssl_provisioning');
    assert.deepEqual(s.fly.calls.map((c) => `${c.method} ${c.path}`), [
        'POST /apps/vibecoder-deploy/certificates/acme',
        'POST /apps/vibecoder-deploy/certificates/www.example.com/check',
        'GET /apps/vibecoder-deploy/certificates/www.example.com',
    ]);
});

test('verify: certificate issued -> active, and the domain enters the deploy-server map', async () => {
    const { s, row } = await withDomain({ dns: makeDns({ cname: ['my-app.vibebuild.cc.'] }), fly: makeFly(ISSUED) });
    const r = await s.verifyDomain('dep-1', 'u1');
    assert.equal(r.status, 'active');
    assert.equal(row().verification_status, 'active');
    assert.deepEqual(await s.getActiveDomainMap(), [{ domain: 'www.example.com', subdomain: 'my-app' }]);
});

test('verify: apex domain via A record works', async () => {
    const { s } = await withDomain({ domain: 'example.com', dns: makeDns({ a: ['66.241.125.51'] }), fly: makeFly(ISSUED) });
    assert.equal((await s.verifyDomain('dep-1', 'u1')).status, 'active');
});

test('verify: TXT-only proves ownership but does not claim the domain is pointed here', async () => {
    const db = makeDb({ deployments: [{ ...DEP }] });
    const s = svc({ db, fly: makeFly(PENDING) });
    const added = await s.addDomain('dep-1', 'u1', 'example.com');
    const s2 = svc({ db, fly: makeFly(PENDING), dns: makeDns({ txt: [[added.txtValue]] }) });
    const r = await s2.verifyDomain('dep-1', 'u1');
    assert.equal(r.status, 'ssl_provisioning');
    assert.match(r.message, /does not point at VibeBuild yet/);
});

test('verify: an active domain returns immediately without touching DNS or Fly', async () => {
    const { s, row } = await withDomain();
    row().verification_status = 'active';
    const r = await s.verifyDomain('dep-1', 'u1');
    assert.equal(r.status, 'active');
    assert.equal(s.fly.calls.length, 0);
});

test('verify: never reports active when Fly is not configured (regression: fake success)', async () => {
    const { s, row } = await withDomain({ dns: makeDns({ cname: ['my-app.vibebuild.cc'] }), env: { FLY_API_TOKEN: '' } });
    await assert.rejects(() => s.verifyDomain('dep-1', 'u1'), DomainConfigError);
    assert.notEqual(row().verification_status, 'active');
});

test('verify: only the owner can verify', async () => {
    const { s } = await withDomain();
    await assert.rejects(() => s.verifyDomain('dep-1', 'someone-else'), /not found/);
});

// ---- status / remove -------------------------------------------------------

test('getDomainStatus returns instructions; null when none', async () => {
    const s = svc();
    assert.equal(await s.getDomainStatus('dep-1', 'u1'), null);
    await s.addDomain('dep-1', 'u1', 'www.example.com');
    const st = await s.getDomainStatus('dep-1', 'u1');
    assert.equal(st.domain, 'www.example.com');
    assert.equal(st.status, 'pending');
    assert.equal(st.cnameTarget, 'my-app.vibebuild.cc');
    assert.ok(st.apexRecords.a.length);
});

test('removeDomain deletes the certificate (when one exists) and the row', async () => {
    const { s, row } = await withDomain({ dns: makeDns({ cname: ['my-app.vibebuild.cc'] }), fly: makeFly(ISSUED) });
    await s.verifyDomain('dep-1', 'u1');
    assert.ok(row().ssl_certificate_id);
    s.fly.calls.length = 0;
    const r = await s.removeDomain('dep-1', 'u1');
    assert.deepEqual(r, { removed: true, domain: 'www.example.com' });
    assert.deepEqual(s.fly.calls.map((c) => `${c.method} ${c.path}`), ['DELETE /apps/vibecoder-deploy/certificates/www.example.com']);
    assert.equal(s.db.t.custom_domains.length, 0);
    assert.deepEqual(await s.getActiveDomainMap(), []);
});

test('removeDomain still removes the row when the certificate delete fails', async () => {
    const { s, row } = await withDomain();
    row().ssl_certificate_id = 'www.example.com';
    const failing = createDomainService({
        supabase: s.db, dns: makeDns(), env: { FLY_API_TOKEN: 't' },
        fetchFn: async () => ({ ok: false, status: 500, text: async () => 'boom' }),
    });
    await failing.removeDomain('dep-1', 'u1');
    assert.equal(s.db.t.custom_domains.length, 0);
});

// ---- id resolution (the website sends the project id) ---------------------

test('resolveDeploymentId accepts a deployment id or a project id, only for the owner', async () => {
    const db = makeDb({ deployments: [{ ...DEP, project_id: 'proj-1' }] });
    const s = svc({ db });
    assert.equal(await s.resolveDeploymentId('dep-1', 'u1'), 'dep-1');
    assert.equal(await s.resolveDeploymentId('proj-1', 'u1'), 'dep-1');
    assert.equal(await s.resolveDeploymentId('proj-1', 'someone-else'), 'proj-1'); // unresolved -> downstream "not found"
    const r = await s.addDomain(await s.resolveDeploymentId('proj-1', 'u1'), 'u1', 'example.com');
    assert.equal(r.deployment_id, 'dep-1');
});

// ---- proxy registration callback ---------------------------------------------
const withCallback = async (opts = {}) => {
    const events = []; const onDomainChange = opts.onDomainChange || (async (e) => { events.push(e); });
    const db = makeDb({ deployments: [{ ...DEP }] });
    const fly = opts.fly || makeFly(ISSUED);
    const s = createDomainService({ supabase: db, dns: opts.dns || makeDns({ cname: ['my-app.vibebuild.cc.'] }), fetchFn: fly.fetchFn, now: opts.now, onDomainChange, env: { FLY_API_TOKEN: 'FlyV1 fm2_test' } });
    await s.addDomain('dep-1', 'u1', 'www.example.com');
    return { s, events, db };
};

test('onDomainChange: an active domain is announced once with its deployment subdomain', async () => {
    const { s, events } = await withCallback();
    assert.equal((await s.verifyDomain('dep-1', 'u1')).status, 'active');
    assert.deepEqual(events, [{ subdomain: 'my-app', domain: 'www.example.com' }]);
});

test('onDomainChange: re-verifying an already active domain announces it again, so a missed registration repairs itself', async () => {
    const { s, events } = await withCallback();
    await s.verifyDomain('dep-1', 'u1'); await s.verifyDomain('dep-1', 'u1');
    assert.equal(events.length, 2);
});

test('onDomainChange: nothing is announced while the domain is pending or still issuing its certificate', async () => {
    const a = await withCallback({ dns: makeDns() }); await a.s.verifyDomain('dep-1', 'u1');
    const b = await withCallback({ fly: makeFly(PENDING) }); await b.s.verifyDomain('dep-1', 'u1');
    assert.deepEqual([...a.events, ...b.events], []);
});

test('onDomainChange: removing the domain announces it as cleared, with the subdomain it belonged to', async () => {
    const { s, events } = await withCallback();
    await s.verifyDomain('dep-1', 'u1'); events.length = 0;
    const r = await s.removeDomain('dep-1', 'u1');
    assert.equal(r.removed, true);
    assert.deepEqual(events, [{ subdomain: 'my-app', domain: null }]);
});

test('onDomainChange: a failing callback never breaks verify or remove', async () => {
    const { s } = await withCallback({ onDomainChange: async () => { throw new Error('proxy down'); } });
    assert.equal((await s.verifyDomain('dep-1', 'u1')).status, 'active');
    assert.equal((await s.removeDomain('dep-1', 'u1')).removed, true);
});

test('onDomainChange is optional', async () => {
    const db = makeDb({ deployments: [{ ...DEP }] }); const fly = makeFly(ISSUED);
    const s = createDomainService({ supabase: db, dns: makeDns({ cname: ['my-app.vibebuild.cc.'] }), fetchFn: fly.fetchFn, env: { FLY_API_TOKEN: 'FlyV1 fm2_test' } });
    await s.addDomain('dep-1', 'u1', 'www.example.com');
    assert.equal((await s.verifyDomain('dep-1', 'u1')).status, 'active');
});
