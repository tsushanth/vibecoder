import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUpstreamUrl, thumbSrc, SCREENSHOT_ORIGIN } from './thumbProxy.ts';

const GOOD = `${SCREENSHOT_ORIGIN}/screenshot?url=${encodeURIComponent('https://preview-abc123def456.vibebuild.cc')}&width=390&height=844`;

test('accepts the exact URL shape the backend stores and rebuilds it from parts', () => {
  assert.equal(buildUpstreamUrl(GOOD), GOOD);
});

test('defaults the size when width/height are missing and clamps absurd values', () => {
  const noSize = `${SCREENSHOT_ORIGIN}/screenshot?url=${encodeURIComponent('https://preview-a1.vibebuild.cc')}`;
  assert.match(buildUpstreamUrl(noSize)!, /width=390&height=844$/);
  const big = `${SCREENSHOT_ORIGIN}/screenshot?url=${encodeURIComponent('https://preview-a1.vibebuild.cc')}&width=99999&height=-5`;
  assert.equal(buildUpstreamUrl(big), null);
});

test('drops query params it does not know about instead of forwarding them', () => {
  const extra = GOOD + '&secret=1&callback=http://evil.test';
  const out = buildUpstreamUrl(extra)!;
  assert.ok(out && !out.includes('secret') && !out.includes('evil'));
});

test('rejects anything that is not a string, or is empty or huge', () => {
  for (const bad of [undefined, null, 42, {}, [], '', 'x'.repeat(2000)]) assert.equal(buildUpstreamUrl(bad), null);
});

test('rejects other hosts, ports, schemes and paths on the screenshot origin', () => {
  const inner = encodeURIComponent('https://preview-a1.vibebuild.cc');
  const cases = [
    `http://169.254.169.254/screenshot?url=${inner}`,
    `http://127.0.0.1:3465/screenshot?url=${inner}`,
    `http://localhost:3465/screenshot?url=${inner}`,
    `http://178.156.231.255:8000/screenshot?url=${inner}`,
    `http://178.156.231.255/screenshot?url=${inner}`,
    `https://178.156.231.255:3465/screenshot?url=${inner}`,
    `http://178.156.231.255:3465/admin?url=${inner}`,
    `http://178.156.231.255:3465/screenshot/../admin?url=${inner}`,
    `http://user:pw@178.156.231.255:3465/screenshot?url=${inner}`,
    `http://178.156.231.255.evil.test:3465/screenshot?url=${inner}`,
    `http://evil.test@178.156.231.255:3465/screenshot?url=${inner}`,
    `//178.156.231.255:3465/screenshot?url=${inner}`,
    `file:///etc/passwd`,
    `javascript:alert(1)`,
    `/screenshot?url=${inner}`,
  ];
  for (const c of cases) assert.equal(buildUpstreamUrl(c), null, c);
});

test('rejects a screenshot target that is not an https vibebuild.cc subdomain', () => {
  const mk = (target: string) => `${SCREENSHOT_ORIGIN}/screenshot?url=${encodeURIComponent(target)}`;
  const cases = [
    'http://preview-a1.vibebuild.cc',
    'https://vibebuild.cc',
    'https://evil.test',
    'https://preview-a1.vibebuild.cc.evil.test',
    'https://evilvibebuild.cc',
    'https://x.vibebuild.cc@evil.test',
    'https://user:pw@preview-a1.vibebuild.cc',
    'https://preview-a1.vibebuild.cc:8443',
    'https://169.254.169.254',
    'https://localhost',
    'file:///etc/passwd',
    'not a url',
  ];
  for (const c of cases) assert.equal(buildUpstreamUrl(mk(c)), null, c);
  assert.equal(buildUpstreamUrl(`${SCREENSHOT_ORIGIN}/screenshot`), null);
});

test('rejects a repeated url param (parameter pollution)', () => {
  const a = encodeURIComponent('https://preview-a1.vibebuild.cc');
  const b = encodeURIComponent('https://evil.test');
  assert.equal(buildUpstreamUrl(`${SCREENSHOT_ORIGIN}/screenshot?url=${a}&url=${b}`), null);
});

test('thumbSrc routes only allow-listed screenshot URLs through the proxy', () => {
  assert.equal(thumbSrc(GOOD), `/api/thumb?u=${encodeURIComponent(GOOD)}`);
});

test('thumbSrc leaves https images (e.g. Supabase storage) alone and drops unusable values', () => {
  const store = 'https://abc.supabase.co/storage/v1/object/public/project-assets/thumbnails/x.jpg';
  assert.equal(thumbSrc(store), store);
  assert.equal(thumbSrc(null), null);
  assert.equal(thumbSrc(undefined), null);
  assert.equal(thumbSrc(''), null);
});

test('thumbSrc never passes an insecure or unknown http URL to the page', () => {
  assert.equal(thumbSrc('http://evil.test/x.jpg'), null);
  assert.equal(thumbSrc('http://178.156.231.255:3465/other'), null);
  assert.equal(thumbSrc('javascript:alert(1)'), null);
});
