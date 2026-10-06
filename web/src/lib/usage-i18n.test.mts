import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURES, METERS, USAGE_ERROR_KEYS } from './usage.ts';

// The usage copy is English in every locale for now (translation is a follow-up); these tests keep the files in step with the code.
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
const en = flat((load('en').usage ?? {}) as Record<string, unknown>);
const vars = (s: string) => [...s.matchAll(/\{[^}]+\}/g)].map((m) => m[0]).sort();

test('every translation key the code builds exists in English', () => {
  const need = [
    ...FEATURES.map((f) => `feature.${f.key}`),
    ...METERS.flatMap((m) => [`meter.${m.key}.name`, `meter.${m.key}.full`]),
    ...USAGE_ERROR_KEYS.map((k) => k.replace(/^usage\./, '')),
  ];
  for (const k of need) assert.ok(en[k], `usage.${k}`);
});

test('every usage.* key the panel component uses exists in English', () => {
  const src = readFileSync(new URL('../components/project/UsagePanel.tsx', import.meta.url), 'utf8');
  const literal = [...src.matchAll(/t\('usage\.([A-Za-z.]+)'/g)].map((m) => m[1]);
  assert.ok(literal.length >= 10);
  for (const k of literal) assert.ok(en[k], `usage.${k}`);
  // the dynamic ones: usage.meter.${key}.name|full and usage.feature.${key}
  assert.ok(src.includes('usage.meter.${') && src.includes('usage.feature.${'));
});

test('no English usage text is empty and the warning and full-limit copy are present', () => {
  for (const [k, v] of Object.entries(en)) assert.ok(v.trim().length > 0, k);
  assert.match(en.summaryWarn, /\{percent\}/); assert.ok(en.summaryFull); assert.ok(en.contact);
});

for (const l of LOCALES) {
  const loc = flat((load(l).usage ?? {}) as Record<string, unknown>);
  test(`${l}: has every usage key, none extra, and the same placeholders as English`, () => {
    assert.deepEqual(Object.keys(loc).sort(), Object.keys(en).sort());
    for (const k of Object.keys(en)) assert.deepEqual(vars(loc[k]), vars(en[k]), `${l} ${k}`);
  });
}
