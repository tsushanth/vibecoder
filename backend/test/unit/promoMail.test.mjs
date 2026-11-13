import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPromoMessage, filterRecipients, injectFooter } from '../../scripts/lib/promo-mail.mjs';
import { loadSuppressions, unsubscribeUrl } from '../../scripts/lib/unsubscribe.mjs';

const V = JSON.parse(readFileSync(new URL('./unsubscribe-vectors.json', import.meta.url), 'utf8'));
process.env.UNSUB_SECRET = V.secret;

test('helper copy reproduces the shared golden vectors (including the vb list)', () => {
  assert.ok(V.vectors.some((v) => v.list === 'vb'));
  for (const v of V.vectors) assert.equal(unsubscribeUrl(v.email, v.list), v.url);
});

test('every promo message carries the signed vb footer and both one-click headers', () => {
  const m = buildPromoMessage({ from: 'VibeBuild <vibebuild@send.kreativekoala.llc>', to: 'Carol@Example.com', subject: 's', html: '<html><body><p>Hi</p></body></html>' });
  const url = unsubscribeUrl('carol@example.com', 'vb');
  assert.match(url, /[?&]l=vb&/);
  assert.equal(m.headers['List-Unsubscribe'], `<${url}>, <mailto:t.sushanth@gmail.com?subject=unsubscribe>`);
  assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(m.html.includes(`href="${url.replace(/&/g, '&amp;')}"`));
  assert.ok(m.html.includes('account with VibeBuild'));
  assert.ok(m.html.includes('5900 Balcones Dr'));
  assert.ok(m.html.indexOf('Unsubscribe</a>') < m.html.lastIndexOf('</body>'));
});

test('refuses to build a message when UNSUB_SECRET is missing (no unsigned sends)', () => {
  const s = process.env.UNSUB_SECRET;
  delete process.env.UNSUB_SECRET;
  try { assert.throws(() => buildPromoMessage({ from: 'a', to: 'a@b.co', subject: 's', html: '<body></body>' }), /UNSUB_SECRET/); }
  finally { process.env.UNSUB_SECRET = s; }
});

test('injectFooter appends when there is no </body>', () => {
  assert.equal(injectFooter('<p>x</p>', '<f/>'), '<p>x</p><f/>');
});

test('a suppressed address is dropped, as are Apple relay and empty addresses', () => {
  const users = [
    { user_id: '1', email: 'keep@real.org' },
    { user_id: '2', email: 'Gone@Real.org' },
    { user_id: '3', email: 'x@privaterelay.appleid.com' },
    { user_id: '4', email: null },
  ];
  const { allowed, counts } = filterRecipients(users, new Set(['gone@real.org']));
  assert.deepEqual(allowed.map((u) => u.user_id), ['1']);
  assert.deepEqual(counts, { candidates: 4, suppressed: 1, relay: 1, no_email: 1 });
});

test('suppression read fails closed (nothing would be sent)', async () => {
  const bad = async () => new Response('nope', { status: 500 });
  await assert.rejects(loadSuppressions({ supabaseUrl: 'https://p.supabase.co', serviceKey: 'sb_secret_x', fetchImpl: bad }), /refusing to send/);
});
