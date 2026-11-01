import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFirstTouch, captureFirstTouch, readFirstTouch, externalReferrerHost, SOURCE_KEY, SOURCE_TTL_MS } from './signupSource.ts';

const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
const page = (over: Partial<Parameters<typeof buildFirstTouch>[0]> = {}) => ({ search: '', referrer: '', pathname: '/', ownHost: 'vibebuild.cc', ...over });

test('utm tags, external referrer host and landing path are captured', () => {
  const s = buildFirstTouch(page({ search: '?utm_source=play&utm_medium=landing&utm_campaign=nov&utm_content=hero&gclid=zzz', referrer: 'https://www.google.com/search?q=x', pathname: '/blog' }));
  assert.deepEqual(s, { utm_source: 'play', utm_medium: 'landing', utm_campaign: 'nov', utm_content: 'hero', referrer_host: 'google.com', landing_path: '/blog' });
});

test('a direct visit still records the landing path; unrelated query params are ignored', () => {
  assert.deepEqual(buildFirstTouch(page({ search: '?ref=abc&email=a@b.com', pathname: '/pricing' })), { landing_path: '/pricing' });
});

test('values are cut to 64 characters and email-looking values are dropped', () => {
  const s = buildFirstTouch(page({ search: `?utm_source=${'a'.repeat(200)}&utm_campaign=bob@example.com` }));
  assert.equal(s.utm_source?.length, 64); assert.equal(s.utm_campaign, undefined);
});

test('a visit from our own site is not a referrer; bad referrers are ignored', () => {
  assert.equal(externalReferrerHost('https://vibebuild.cc/login', 'vibebuild.cc'), undefined);
  assert.equal(externalReferrerHost('https://www.vibebuild.cc/x', 'vibebuild.cc'), undefined);
  assert.equal(externalReferrerHost('not a url', 'vibebuild.cc'), undefined);
  assert.equal(externalReferrerHost('', 'vibebuild.cc'), undefined);
  assert.equal(externalReferrerHost('https://t.co/abc', 'vibebuild.cc'), 't.co');
});

test('first touch wins: a later visit with different tags does not overwrite it', () => {
  const st = mem();
  captureFirstTouch(st, page({ search: '?utm_source=first' }), 1000);
  const again = captureFirstTouch(st, page({ search: '?utm_source=second' }), 2000);
  assert.equal(again?.utm_source, 'first'); assert.equal(readFirstTouch(st, 3000)?.utm_source, 'first');
});

test('an entry older than 90 days, or a corrupt one, is replaced by the next visit', () => {
  const st = mem();
  captureFirstTouch(st, page({ search: '?utm_source=old' }), 1000);
  assert.equal(readFirstTouch(st, 1000 + SOURCE_TTL_MS + 1), null);
  assert.equal(captureFirstTouch(st, page({ search: '?utm_source=new' }), 1000 + SOURCE_TTL_MS + 1)?.utm_source, 'new');
  st.m.set(SOURCE_KEY, '{not json'); assert.equal(readFirstTouch(st), null);
  st.m.set(SOURCE_KEY, JSON.stringify({ t: 'x', s: 1 })); assert.equal(readFirstTouch(st), null);
});

test('blocked storage does not throw', () => {
  const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.doesNotThrow(() => captureFirstTouch(blocked, page()));
  assert.equal(readFirstTouch(blocked), null);
});
