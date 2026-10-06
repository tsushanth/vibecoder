import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dir = new URL('../i18n/messages/', import.meta.url);
const load = (l: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(`${l}.json`, dir), 'utf8'));

function flat(o: Record<string, unknown>, p = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object') Object.assign(out, flat(v as Record<string, unknown>, `${p}${k}.`));
    else out[`${p}${k}`] = String(v);
  }
  return out;
}

const LOCALES = ['de', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt', 'zh'];
// Key-entry copy lives under the `secrets` namespace.
const en = flat((load('en').secrets ?? {}) as Record<string, unknown>);
const keys = Object.keys(en);
// Values that may legitimately equal the English text (brand/token-only strings).
const ALLOW_IDENTICAL = new Set<string>([]);
const vars = (s: string) => [...s.matchAll(/\{[^}]+\}/g)].map((m) => m[0]).sort();
const tokens = (s: string) => [...s.matchAll(/\b(?:sk|rk|pk|whsec)_[A-Za-z0-9_]*/g)].map((m) => m[0]).sort();

test('English key-entry set is non-trivial', () => {
  assert.ok(keys.length >= 40);
});

for (const l of LOCALES) {
  const loc = flat((load(l).secrets ?? {}) as Record<string, unknown>);
  test(`${l}: has every key-entry key, none extra`, () => {
    assert.deepEqual(Object.keys(loc).sort(), [...keys].sort());
  });
  test(`${l}: placeholders and key prefixes match English`, () => {
    for (const k of keys) {
      assert.deepEqual(vars(loc[k] ?? ''), vars(en[k]), `${l} ${k} placeholders`);
      assert.deepEqual(tokens(loc[k] ?? ''), tokens(en[k]), `${l} ${k} tokens`);
    }
  });
  test(`${l}: no untranslated English values`, () => {
    for (const k of keys) {
      if (ALLOW_IDENTICAL.has(k)) continue;
      assert.notEqual(loc[k], en[k], `${l} ${k} is still English`);
    }
  });
}
