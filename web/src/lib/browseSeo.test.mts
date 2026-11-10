import test from 'node:test';
import assert from 'node:assert/strict';
import { pickItems, appUrl, itemListJsonLd, jsonLdString } from './browseSeo.ts';

test('pickItems keeps well-formed rows, trims text and stops at 12', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, title: `  App ${i}  `, description: 'x'.repeat(300), published_url: null }));
  const out = pickItems([null, 5, { id: 1, title: 'x' }, { id: 'a', title: '   ' }, ...rows]);
  assert.equal(out.length, 12);
  assert.equal(out[0].title, 'App 0');
  assert.ok((out[0].description ?? '').length <= 160);
  assert.deepEqual(pickItems('nope'), []);
});

test('only an https link on vibebuild.cc is used as an item link', () => {
  const link = (u: string) => appUrl({ id: 'a', title: 't', published_url: u });
  assert.equal(link('https://my-app.vibebuild.cc'), 'https://my-app.vibebuild.cc/');
  assert.equal(link('http://my-app.vibebuild.cc'), null);
  assert.equal(link('https://evil.com/?x=vibebuild.cc'), null);
  assert.equal(link('https://notvibebuild.cc'), null);
  assert.equal(link('javascript:alert(1)'), null);
  assert.equal(link('not a url'), null);
});

test('JSON-LD lists the items in order, and is null for an empty list', () => {
  assert.equal(itemListJsonLd([]), null);
  const ld = itemListJsonLd([{ id: 'a', title: 'One', published_url: 'https://one.vibebuild.cc' }, { id: 'b', title: 'Two' }]) as { itemListElement: Array<Record<string, unknown>> };
  assert.equal(ld.itemListElement[0].position, 1);
  assert.equal(ld.itemListElement[0].url, 'https://one.vibebuild.cc/');
  assert.equal('url' in ld.itemListElement[1], false);
});

test('a title cannot close the script tag', () => {
  const s = jsonLdString({ name: '</script><script>alert(1)</script>' });
  assert.ok(!s.includes('<'));
  assert.equal(JSON.parse(s).name, '</script><script>alert(1)</script>');
});
