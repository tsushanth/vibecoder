import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { localeFromTag, localeFromAcceptLanguage } from './match.ts';
import { SUPPORTED_LOCALES } from './locales.ts';

test('Chinese tags map to Simplified, Traditional (Taiwan) or Traditional (Hong Kong)', () => {
  for (const t of ['zh', 'zh-CN', 'zh-SG', 'zh-Hans', 'zh-Hans-CN', 'zh_cn', 'zh-Hans-HK']) assert.equal(localeFromTag(t), 'zh', t);
  for (const t of ['zh-TW', 'zh-tw', 'zh-Hant', 'zh-Hant-TW', 'zh-MO', 'zh-Hant-MO']) assert.equal(localeFromTag(t), 'zh-TW', t);
  for (const t of ['zh-HK', 'zh-hk', 'zh-Hant-HK']) assert.equal(localeFromTag(t), 'zh-HK', t);
});

test('other tags keep working; unknown tags and inherited object keys are not locales', () => {
  assert.equal(localeFromTag('pt-BR'), 'pt');
  assert.equal(localeFromTag('en-GB'), 'en');
  for (const t of ['xx', '', 'constructor', '__proto__', 'toString', 'klingon']) assert.equal(localeFromTag(t), null, t);
});

test('Accept-Language picks the highest q supported locale, Traditional included', () => {
  assert.equal(localeFromAcceptLanguage('zh-TW,zh;q=0.9,en;q=0.8'), 'zh-TW');
  assert.equal(localeFromAcceptLanguage('zh-HK,zh;q=0.9'), 'zh-HK');
  assert.equal(localeFromAcceptLanguage('zh-Hant;q=0.7,de;q=0.9'), 'de');
  assert.equal(localeFromAcceptLanguage('zh-CN,zh;q=0.9'), 'zh');
  assert.equal(localeFromAcceptLanguage('sw,xx;q=0.5'), null);
});

test('every supported locale has its message files (base and every part)', () => {
  const dir = new URL('./messages/', import.meta.url);
  const parts = ['landing', 'auth', 'create', 'apps', 'account'];
  const have = new Set([...readdirSync(dir), ...readdirSync(new URL('parts/', dir)).map((f) => `parts/${f}`)]);
  for (const l of SUPPORTED_LOCALES) {
    assert.ok(have.has(`${l}.json`), `${l}.json`);
    for (const p of parts) assert.ok(have.has(`parts/${p}.${l}.json`), `parts/${p}.${l}.json`);
    JSON.parse(readFileSync(new URL(`${l}.json`, dir), 'utf8'));
  }
});
