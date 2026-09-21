import './../helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const gh = await import('../../routes/github.routes.js');
const { isValidOwner, isValidRepo, isValidRef, parseRepoUrl, isPlausibleToken, safePath, isAllowedFile, buildZip, readZip, LIMITS } = gh;

test('isValidOwner', () => {
    for (const ok of ['a', 'octocat', 'Foo-Bar', 'a1', 'x'.repeat(39)]) assert.equal(isValidOwner(ok), true, ok);
    for (const bad of ['', '-a', 'a-', 'a--b', 'a b', 'a/b', 'a.b', 'x'.repeat(40), null, undefined, 5, 'a@b', '../x'])
        assert.equal(isValidOwner(bad), false, String(bad));
});

test('isValidRepo', () => {
    for (const ok of ['repo', 'my.repo_1-x', '.github-io', 'a'.repeat(100)]) assert.equal(isValidRepo(ok), true, ok);
    for (const bad of ['', '.', '..', 'x.git', 'a/b', 'a b', 'a'.repeat(101), null, 'a?b', 'a#b', 'a%2fb'])
        assert.equal(isValidRepo(bad), false, String(bad));
});

test('isValidRef', () => {
    for (const ok of ['main', 'feature/x-1', 'v1.2.3', 'a'.repeat(100)]) assert.equal(isValidRef(ok), true, ok);
    for (const bad of ['', '/main', 'main/', 'a..b', '../x', 'a b', 'a?b', 'a'.repeat(101), null, 'a\\b', 'a%2e%2e'])
        assert.equal(isValidRef(bad), false, String(bad));
});

test('parseRepoUrl accepts canonical forms', () => {
    assert.deepEqual(parseRepoUrl('https://github.com/octocat/hello'), { owner: 'octocat', repo: 'hello', ref: null });
    assert.deepEqual(parseRepoUrl('https://github.com/octocat/hello.git'), { owner: 'octocat', repo: 'hello', ref: null });
    assert.deepEqual(parseRepoUrl('  https://github.com/octocat/hello/tree/dev/sub  '), { owner: 'octocat', repo: 'hello', ref: 'dev' });
    assert.deepEqual(parseRepoUrl('https://github.com/octocat/hello/'), { owner: 'octocat', repo: 'hello', ref: null });
});

test('parseRepoUrl rejects SSRF look-alikes and malformed input', () => {
    for (const bad of [
        'http://github.com/o/r',
        'https://github.com.evil.com/o/r',
        'https://evil.com/github.com/o/r',
        'https://github.com@evil.com/o/r',
        'https://user:pw@github.com/o/r',
        'https://github.com:8443/o/r',
        'https://www.github.com/o/r',
        'https://api.github.com/repos/o/r',
        'https://raw.githubusercontent.com/o/r/main/index.html',
        'https://GITHUB.com.evil/o/r',
        'https://github.com/o',
        'https://github.com/',
        'https://github.com/o/../r',
        'https://github.com/-bad/r',
        'https://github.com/o/r%2f..',
        'ftp://github.com/o/r',
        'javascript:alert(1)',
        'file:///etc/passwd',
        'github.com/o/r',
        '',
        null, undefined, 42, {},
        'https://github.com/o/' + 'r'.repeat(300),
        'https://127.0.0.1/o/r',
        'https://[::1]/o/r',
        'https://github.com\\@evil.com/o/r',
    ]) assert.equal(parseRepoUrl(bad), null, String(bad));
});

test('parseRepoUrl: dot segments are resolved by URL before validation (result is still a valid github.com owner/repo)', () => {
    assert.deepEqual(parseRepoUrl('https://github.com/o/r/tree/../../x'), { owner: 'o', repo: 'x', ref: null });
});

test('parseRepoUrl: uppercase host is normalised by URL and accepted (documented behaviour)', () => {
    assert.deepEqual(parseRepoUrl('https://GitHub.com/o/r'), { owner: 'o', repo: 'r', ref: null });
});

test('isPlausibleToken', () => {
    assert.equal(isPlausibleToken('github_pat_' + 'A1b2'.repeat(10)), true);
    assert.equal(isPlausibleToken('ghp_' + 'x'.repeat(36)), true);
    for (const bad of ['', 'short', 'a'.repeat(19), 'a'.repeat(256), 'has space ' + 'x'.repeat(20), 'x'.repeat(20) + '\n', 'x'.repeat(20) + '!', null, 123])
        assert.equal(isPlausibleToken(bad), false, String(bad));
});

test('safePath', () => {
    assert.equal(safePath('index.html'), 'index.html');
    assert.equal(safePath('js/app.js'), 'js/app.js');
    assert.equal(safePath('img/my pic@2x.png'), 'img/my pic@2x.png');
    for (const bad of ['', '/etc/passwd', '../x', 'a/../b', './a', 'a//b', 'a\\b', 'a\0b', '.git/config', 'x/.github/w.yml',
        'node_modules/x/i.js', '.env', 'a/.ENV/x', 'a/b/', 'x'.repeat(251), 'a/b;c', 'a/$b', null, 3])
        assert.equal(safePath(bad), null, String(bad));
});

test('isAllowedFile', () => {
    for (const ok of ['index.html', 'a/b.JS', 'x.webmanifest', 'p.PNG', 'f.woff2']) assert.equal(isAllowedFile(ok), true, ok);
    for (const bad of ['run.sh', 'a.php', 'a.exe', 'noext', '.html', '.env', '.env.local', 'a.py', 'x.map'])
        assert.equal(isAllowedFile(bad), false, bad);
});

test('zip round trip and caps', () => {
    const files = [{ path: 'index.html', data: Buffer.from('<h1>hi</h1>') }, { path: 'js/a.js', data: Buffer.from('x'.repeat(5000)) }];
    const back = readZip(buildZip(files).toString('base64'));
    assert.deepEqual(back.map((f) => [f.path, f.data.toString()]), files.map((f) => [f.path, f.data.toString()]));
    assert.throws(() => readZip(Buffer.from('not a zip').toString('base64')), /invalid zip/);
    // zip-bomb style: one file above the per-file cap
    const big = buildZip([{ path: 'big.txt', data: Buffer.alloc(LIMITS.maxFileBytes + 1, 97) }]).toString('base64');
    assert.throws(() => readZip(big), /too large/);
});
