import test from 'node:test';
import assert from 'node:assert/strict';
import { scanFrontEnd } from '../scanner.js';

const page = (js) => ({ 'index.html': `<html><body><script>${js}</script></body></html>` });
const join = (...p) => p.join('');
const problems = (files, o) => scanFrontEnd(files, o).problems.map((p) => p.kind);

test('a clean app passes', () => {
    const r = scanFrontEnd(page("const r = await vibe.api('weather','/v1/forecast'); document.title = 'x';"));
    assert.deepEqual(r, { ok: true, problems: [] });
});

for (const [name, key] of [
    ['a Google API key', join('AIza', 'SyA1234567890abcdefghijklmnopqrstuv')],
    ['an OpenAI style key', join('sk-', 'proj-abcdefghijklmnopqrstuvwxyz123456')],
    ['a GitHub token', join('gh', 'p_abcdefghijklmnopqrstuvwxyz0123456789')],
    ['an AWS access key id', join('AK', 'IAABCDEFGHIJKLMNOP')],
    ['a Stripe live secret key', join('sk_', 'live_abcdefghijklmnopqrstuv1234')],
]) {
    test(`flags ${name} hardcoded in a script`, () => {
        assert.deepEqual(problems(page(`const k = "${key}";`)), ['hardcoded_secret']);
    });
}

test('flags a hardcoded key in a separate js file and names the file', () => {
    const r = scanFrontEnd({ 'index.html': '<html></html>', 'js/app.js': `const apiKey = "${join('sk-', 'abcdefghijklmnopqrstuvwxyz123456')}";` });
    assert.equal(r.ok, false);
    assert.equal(r.problems[0].file, 'js/app.js');
});

test('flags a long literal assigned to a key-like variable name', () => {
    assert.deepEqual(problems(page('const api_key = "' + ['q8Zr2LmPv9', 'Xc4Tb7Nw1E', 'd6Hy3Ks0Ja', '5U'].join('') + '";')), ['hardcoded_secret']);
});

test('does not flag an api key input field or an empty variable', () => {
    assert.deepEqual(problems(page("const apiKey = ''; const label = 'Enter your API key';")), []);
});

test('flags fetch to an external domain', () => {
    assert.deepEqual(problems(page("fetch('https://api.stripe.com/v1/charges')")), ['external_request']);
});
test('flags XMLHttpRequest, WebSocket and EventSource to external hosts', () => {
    assert.deepEqual(problems(page("const x = new XMLHttpRequest(); x.open('GET','https://evil.example.com/a'); new WebSocket('wss://evil.example.com/s'); new EventSource('https://evil.example.com/e')")).sort(), ['external_request', 'external_request', 'external_request']);
});
test('flags fetch to a private or loopback address', () => {
    assert.deepEqual(problems(page("fetch('http://127.0.0.1:8080/admin'); fetch('http://169.254.169.254/latest')")), ['private_request', 'private_request']);
});
test('allows relative fetches and fetches to the approved platform host', () => {
    assert.deepEqual(problems(page("fetch('/data.json'); fetch('https://vibe.example.test/api/p')"), { allowedHosts: ['vibe.example.test'] }), []);
});
test('flags a fetch built from a variable URL that cannot be checked', () => {
    assert.deepEqual(problems(page('fetch(userUrl)')), ['unverifiable_request']);
});
test('does not treat a URL inside a string or comment that is not a request as a violation', () => {
    assert.deepEqual(problems(page("const link = 'https://example.com'; // see https://docs.example.com")), []);
});
test('flags script tags that load external code', () => {
    assert.deepEqual(problems({ 'index.html': '<script src="https://cdn.evil.com/x.js"></script>' }), ['external_script']);
});
test('reports each finding with a line number', () => {
    const r = scanFrontEnd({ 'index.html': `<html>\n<script>\nfetch('https://api.stripe.com/x')\n</script>` });
    assert.equal(r.problems[0].line, 3);
});
test('never echoes the secret value in the problem text', () => {
    const key = join('sk-', 'proj-abcdefghijklmnopqrstuvwxyz123456');
    assert.equal(JSON.stringify(scanFrontEnd(page(`const k="${key}"`))).includes(key), false);
});
