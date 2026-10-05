import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MANIFEST_FILE, MAX_APP_CONNECTORS, parseManifestFile, declaredConnectors } from '../../lib/connectors.js';
import { vibeProblems, injectSdk, withVibeRules, VIBE_RULES, KNOWN_CONNECTORS } from '../../lib/vibe.js';
import { staticChecks } from '../../lib/checks.js';
import { generateApp } from '../../lib/generate.js';
import { parseFiles } from '../../lib/files.js';
import { readVibeSdk } from '../../validators.js';

const sdk = readVibeSdk();
const page = (js, head = '<script src="vibe.js"></script>') => `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width">${head}</head><body><!--${'x'.repeat(250)}--><button onclick="go()">Go</button><script>${js}</script></body></html>`;
const conn = (over = {}) => ({ host: 'api.example.com', paths: ['/v1/quote*'], methods: ['GET'], secret: { name: 'QUOTE_KEY', in: 'query', field: 'apikey' }, ...over });
const man = (connectors) => JSON.stringify({ connectors });
const valid = man({ stocks: conn() });
const call = 'vibe.api("stocks", "/v1/quote", { query: { symbol: "AAA" } }).catch(function(e){ show(e.code); });';

// ---- drift: the vendored validator must stay identical to the platform's
test('the vendored manifest validator is byte-identical to platform/vibe-proxy/manifest.js', (t) => {
    const platform = fileURLToPath(new URL('../../../platform/vibe-proxy/manifest.js', import.meta.url));
    if (!fs.existsSync(platform)) return t.skip('platform/ is not present on this machine (worker runs standalone); checked in the repo');
    const vendored = fileURLToPath(new URL('../../lib/vendor/manifest.js', import.meta.url));
    assert.equal(fs.readFileSync(vendored, 'utf8'), fs.readFileSync(platform, 'utf8'));
});

// ---- parsing and validation
test('a valid keyed manifest is accepted and normalised', () => {
    const r = parseManifestFile(man({ stocks: conn({ host: 'API.Example.COM' }) }));
    assert.equal(r.ok, true, JSON.stringify(r.problems));
    assert.deepEqual(r.manifest, { connectors: { stocks: { host: 'api.example.com', paths: ['/v1/quote*'], methods: ['GET'], secret: { name: 'QUOTE_KEY', in: 'query', field: 'apikey' } } } });
});
test('a keyless connector is accepted too', () => {
    const r = parseManifestFile(man({ facts: { host: 'facts.example.org', paths: ['/api/*'], methods: ['GET'] } }));
    assert.equal(r.ok, true); assert.equal(r.manifest.connectors.facts.secret, undefined);
});
test('unknown fields are dropped from the normalised manifest', () => {
    const r = parseManifestFile(JSON.stringify({ extra: 1, connectors: { stocks: { ...conn(), note: 'x', cors: '*', secret: { name: 'QUOTE_KEY', in: 'query', field: 'apikey', value: 'inline' } } } }));
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r.manifest), ['connectors']);
    assert.deepEqual(Object.keys(r.manifest.connectors.stocks).sort(), ['host', 'methods', 'paths', 'secret']);
    assert.deepEqual(Object.keys(r.manifest.connectors.stocks.secret).sort(), ['field', 'in', 'name']);
});
test('an empty connectors object means no manifest', () => {
    const r = parseManifestFile(man({}));
    assert.equal(r.ok, true); assert.equal(r.manifest, null);
});
test('not JSON, not an object, and oversized files are rejected', () => {
    for (const bad of ['{nope', '[]', '"x"', 'null', '', JSON.stringify({ connectors: { a: { host: 'a.example.com', paths: ['/' + 'p'.repeat(9000)], methods: ['GET'] } } })]) {
        const r = parseManifestFile(bad); assert.equal(r.ok, false, bad.slice(0, 30)); assert.ok(r.problems.length >= 1);
    }
});
test('SSRF: hosts that are not plain public hostnames are rejected', () => {
    for (const host of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '[::1]', 'localhost', 'db.internal', 'printer.local', 'https://api.example.com', 'api.example.com:8443', 'user@evil.example.com', 'api.example.com/path', '*.example.com', 'exa mple.com', '', 'xn--', '2130706433', 'api.example.com.']) {
        const r = parseManifestFile(man({ stocks: conn({ host }) }));
        assert.equal(r.ok, false, `host ${JSON.stringify(host)} must be rejected`);
    }
});
test('paths: must start with /, no query, fragment, backslash or dot segments, * only at the end', () => {
    for (const p of ['v1', '/v1?x=1', '/v1#a', '/v1\\x', '/a/../b', '/a/./b', '/a/*/b', '/*/x']) {
        assert.equal(parseManifestFile(man({ stocks: conn({ paths: [p] }) })).ok, false, p);
    }
    assert.equal(parseManifestFile(man({ stocks: conn({ paths: [] }) })).ok, false);
});
test('methods must be a non-empty list of real HTTP methods', () => {
    for (const m of [[], ['TRACE'], ['get'], 'GET', ['GET', 'CONNECT']]) assert.equal(parseManifestFile(man({ stocks: conn({ methods: m }) })).ok, false, JSON.stringify(m));
});
test('fixed headers are rejected (an app may not set request headers)', () => {
    assert.equal(parseManifestFile(man({ stocks: conn({ headers: { Authorization: 'Bearer x' } }) })).ok, false);
});
test('secrets: UPPER_SNAKE name, header/query/body only, no forbidden header, field required', () => {
    for (const secret of [{ name: 'lower', in: 'query', field: 'k' }, { name: 'KEY_A', in: 'cookie', field: 'k' }, { name: 'KEY_A', in: 'header', field: 'Host' }, { name: 'KEY_A', in: 'header', field: 'Cookie' }, { name: 'KEY_A', in: 'query' }, { name: 'KEY_A', in: 'query', field: 'a b' }, 'KEY_A']) {
        assert.equal(parseManifestFile(man({ stocks: conn({ secret }) })).ok, false, JSON.stringify(secret));
    }
    assert.equal(parseManifestFile(man({ stocks: conn({ secret: { name: 'KEY_A', in: 'header', field: 'X-Api-Key' } }) })).ok, true);
});
test('a connector may not reuse a built-in name', () => {
    for (const name of KNOWN_CONNECTORS) {
        const r = parseManifestFile(man({ [name]: conn() })); assert.equal(r.ok, false); assert.match(r.problems.join(' '), /built-in|reserved/i);
    }
});
test('connector names are validated and capped in number', () => {
    assert.equal(parseManifestFile(man({ 'Bad Name': conn() })).ok, false);
    const many = {}; for (let i = 0; i <= MAX_APP_CONNECTORS; i++) many['c' + i] = conn({ host: `h${i}.example.com`, secret: undefined });
    assert.equal(parseManifestFile(man(many)).ok, false);
    const some = {}; for (let i = 0; i < MAX_APP_CONNECTORS; i++) some['c' + i] = conn({ host: `h${i}.example.com`, secret: undefined });
    assert.equal(parseManifestFile(man(some)).ok, true);
});
test('two connectors may not share a secret name with different hosts (one key must not reach two services)', () => {
    const r = parseManifestFile(man({ a: conn(), b: conn({ host: 'other.example.com' }) }));
    assert.equal(r.ok, false); assert.match(r.problems.join(' '), /QUOTE_KEY/);
    assert.equal(parseManifestFile(man({ a: conn(), b: conn({ paths: ['/v2/*'] }) })).ok, true);
});
test('problems never echo more than a short snippet of the input', () => {
    const r = parseManifestFile(man({ stocks: conn({ host: 'x'.repeat(3000) + '!' }) }));
    assert.ok(r.problems.join('\n').length < 1500);
});

// ---- declaredConnectors
test('declaredConnectors reads the root manifest only and tolerates a bad file', () => {
    assert.deepEqual(declaredConnectors({ [MANIFEST_FILE]: valid }), ['stocks']);
    assert.deepEqual(declaredConnectors({ ['sub/' + MANIFEST_FILE]: valid }), []);
    assert.deepEqual(declaredConnectors({ [MANIFEST_FILE]: '{bad' }), []);
    assert.deepEqual(declaredConnectors({}), []);
});

// ---- cross-checks with the app code
test('an app that calls a declared connector has no vibe problems', () => {
    assert.deepEqual(vibeProblems({ 'index.html': page(call), [MANIFEST_FILE]: valid }, { enabled: true }), []);
});
test('calling a connector that is neither built in nor declared is still a problem and names the declared ones', () => {
    const p = vibeProblems({ 'index.html': page('vibe.api("news","/x")'), [MANIFEST_FILE]: valid }, { enabled: true });
    assert.equal(p.length, 2, JSON.stringify(p)); // unknown + declared-but-unused
    assert.ok(p.some((x) => /"news"/.test(x) && /stocks/.test(x)));
});
test('a declared connector that the app never calls is a problem (least privilege)', () => {
    const p = vibeProblems({ 'index.html': page('vibe.ai.ask("hi")'), [MANIFEST_FILE]: valid }, { enabled: true });
    assert.equal(p.length, 1); assert.match(p[0], /stocks/); assert.match(p[0], /never calls|unused|not used/i);
});
test('a declared connector counts as used when called from a separate js file', () => {
    assert.deepEqual(vibeProblems({ 'index.html': page('', '<script src="vibe.js"></script><script src="app.js"></script>'), 'app.js': call, [MANIFEST_FILE]: valid }, { enabled: true }), []);
});
test('an invalid manifest file is reported to the fix pass with its reasons', () => {
    const bad = man({ stocks: conn({ host: '10.1.2.3' }) });
    const p = vibeProblems({ 'index.html': page(call), [MANIFEST_FILE]: bad }, { enabled: true });
    assert.equal(p.length, 1, 'one bad manifest must not also report every call as an unknown connector: ' + JSON.stringify(p));
    assert.ok(/vibe\.manifest\.json/.test(p[0]) && /host/.test(p[0]), JSON.stringify(p));
});
test('a manifest in a subfolder is a problem (it would be ignored)', () => {
    const p = vibeProblems({ 'index.html': page(call), ['app/' + MANIFEST_FILE]: valid }, { enabled: true });
    assert.ok(p.some((x) => /project root/.test(x)), JSON.stringify(p));
});
test('with the proxy disabled a manifest is a problem even if the app does not use vibe', () => {
    const p = vibeProblems({ 'index.html': page('', ''), [MANIFEST_FILE]: valid }, { enabled: false });
    assert.equal(p.length, 1); assert.match(p[0], /vibe\.manifest\.json/);
});
test('an app without a manifest behaves exactly as before', () => {
    assert.deepEqual(vibeProblems({ 'index.html': page('vibe.api("nws","/x")') }, { enabled: true }), []);
    assert.equal(vibeProblems({ 'index.html': page('vibe.api("stocks","/x")') }, { enabled: true }).length, 1);
});
test('an empty manifest file next to an app that calls nothing is fine, and one that calls a connector is a problem', () => {
    assert.deepEqual(vibeProblems({ 'index.html': page('vibe.ai.ask("hi")'), [MANIFEST_FILE]: man({}) }, { enabled: true }), []);
    assert.equal(vibeProblems({ 'index.html': page(call), [MANIFEST_FILE]: man({}) }, { enabled: true }).length, 1);
});
test('staticChecks surfaces manifest problems and passes a good keyed app', () => {
    assert.equal(staticChecks({ 'index.html': page(call), [MANIFEST_FILE]: man({ stocks: conn({ host: 'localhost' }) }) }, { vibe: true }).ok, false);
    const r = staticChecks({ 'index.html': page(call), [MANIFEST_FILE]: valid }, { vibe: true });
    assert.equal(r.ok, true, JSON.stringify(r.problems));
});

// ---- what gets written to the project
test('injectSdk writes the NORMALISED manifest, not the model text', () => {
    const raw = JSON.stringify({ connectors: { stocks: { ...conn({ host: 'API.Example.com' }), note: 'x' } } });
    const out = injectSdk({ 'index.html': page(call), [MANIFEST_FILE]: raw }, { sdk, enabled: true });
    assert.deepEqual(JSON.parse(out[MANIFEST_FILE]), { connectors: { stocks: { host: 'api.example.com', paths: ['/v1/quote*'], methods: ['GET'], secret: { name: 'QUOTE_KEY', in: 'query', field: 'apikey' } } } });
});
test('injectSdk drops an invalid manifest and an empty one, and every manifest when disabled', () => {
    const bad = injectSdk({ 'index.html': page(call), [MANIFEST_FILE]: man({ stocks: conn({ host: '10.0.0.1' }) }) }, { sdk, enabled: true });
    assert.equal(MANIFEST_FILE in bad, false);
    assert.equal(MANIFEST_FILE in injectSdk({ 'index.html': page(''), [MANIFEST_FILE]: man({}) }, { sdk, enabled: true }), false);
    assert.equal(MANIFEST_FILE in injectSdk({ 'index.html': page(call), [MANIFEST_FILE]: valid }, { sdk, enabled: false }), false);
});
test('injectSdk removes manifests outside the root and never mutates its input', () => {
    const input = { 'index.html': page(call), [MANIFEST_FILE]: valid, ['x/' + MANIFEST_FILE]: valid }; const copy = JSON.stringify(input);
    const out = injectSdk(input, { sdk, enabled: true });
    assert.equal('x/' + MANIFEST_FILE in out, false); assert.equal(JSON.stringify(input), copy);
});
test('parseFiles keeps a model-written vibe.manifest.json block (the worker validates it)', () => {
    const { files } = parseFiles(`<file path="index.html">\nhi\n</file>\n<file path="${MANIFEST_FILE}">\n${valid}\n</file>`);
    assert.equal(files[MANIFEST_FILE], valid);
});

// ---- prompt
test('the rules teach the manifest: file name, fields, key injection, secret handling and the 424 case', () => {
    for (const must of [MANIFEST_FILE, 'host', 'paths', 'methods', 'secret', '"query"', '"header"', 'secret_missing']) assert.ok(VIBE_RULES.includes(must), must);
    assert.match(VIBE_RULES, /\[SECRET:/);
    assert.match(VIBE_RULES, /never (ask|request).*key/i);
    assert.match(VIBE_RULES, /no other (network|fetch)/i);
    assert.equal(/The only connector that exists is "nws"/.test(VIBE_RULES), false, 'the old absolute claim must be gone');
    assert.ok(withVibeRules('B', true).includes(MANIFEST_FILE) && !withVibeRules('B', false).includes(MANIFEST_FILE));
});

// ---- the fix pass
test('generateApp sends an invalid manifest back through the fix pass and delivers the corrected one', async () => {
    const reply = (m) => `<file path="index.html">\n${page(call)}\n</file>\n<file path="${MANIFEST_FILE}">\n${m}\n</file>`;
    const bad = man({ stocks: conn({ host: '192.168.0.9' }) });
    const seen = [];
    const llm = { chat: async ({ messages }) => { seen.push(messages.at(-1).content); return { text: reply(seen.length === 1 ? bad : valid), costUsd: 0 }; } };
    const r = await generateApp({ prompt: 'stock ticker', llm, models: ['m'], rules: 'R', check: (f) => staticChecks(f, { vibe: true }) });
    assert.equal(r.ok, true, JSON.stringify(r.attempts));
    assert.equal(seen.length, 2); assert.match(seen[1], /vibe\.manifest\.json/); assert.match(seen[1], /host/);
    assert.equal(r.files[MANIFEST_FILE], valid); assert.equal(r.fixes, 1);
});
test('a manifest that stays invalid fails the build instead of shipping', async () => {
    const reply = `<file path="index.html">\n${page(call)}\n</file>\n<file path="${MANIFEST_FILE}">\n${man({ stocks: conn({ host: 'localhost' }) })}\n</file>`;
    const llm = { chat: async () => ({ text: reply, costUsd: 0 }) };
    const r = await generateApp({ prompt: 'x', llm, models: ['m'], rules: 'R', check: (f) => staticChecks(f, { vibe: true }) });
    assert.equal(r.ok, false); assert.equal(r.cause, 'check_failed');
});
