import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { STARTER_TEMPLATES, templatePrompt, PROMPT_MAX_CHARS } from './starterTemplates.ts';

test('there are 19 curated starter templates with unique slugs and the fields the UI needs', () => {
  assert.equal(STARTER_TEMPLATES.length, 19);
  assert.equal(new Set(STARTER_TEMPLATES.map((t) => t.slug)).size, 19);
  for (const t of STARTER_TEMPLATES) {
    assert.ok(t.title.trim() && t.category.trim() && t.description.trim(), t.slug);
    assert.ok(['Beginner', 'Intermediate', 'Advanced'].includes(t.difficulty), t.slug);
  }
});

test('no template carries a creator, id or repo field (the catalog names a real person)', () => {
  for (const t of STARTER_TEMPLATES) {
    assert.deepEqual(Object.keys(t).sort(), ['category', 'description', 'difficulty', 'slug', 'title']);
  }
  const text = JSON.stringify(STARTER_TEMPLATES);
  assert.ok(!/Tiruvaipati|Campbell|Masoom|Tabarak|Constancio|Hurera|Malinak|Bazi|Lujan|Rangel|Ergasheva|bc1q/i.test(text));
});

test('templatePrompt seeds the prompt with the description, exactly as Android selectTemplate does', () => {
  const t = STARTER_TEMPLATES[0];
  assert.equal(templatePrompt(t), t.description);
});

test('every template description fits the composer limit', () => {
  for (const t of STARTER_TEMPLATES) assert.ok(t.description.length <= PROMPT_MAX_CHARS, t.slug);
  assert.equal(templatePrompt({ ...STARTER_TEMPLATES[0], description: 'x'.repeat(PROMPT_MAX_CHARS + 50) }).length, PROMPT_MAX_CHARS);
});

// Catalog entries deliberately not shown on web, with the reason. A new catalog entry fails the test below until someone triages it.
const EXCLUDED: Record<string, string> = {
  'bitcoin-wallet': "a user's prompt containing a wallet address",
  'uzblox': 'a one-word prompt',
  'ai-app-assient': 'a three-word prompt with typos',
  'a-3d-model-app': 'a vague user prompt',
  'game-booster-overlay': 'device-specific user prompt',
  'game-booster-launcher-overlay-panel': 'device-specific user prompt',
  'social-media-video-app': "a user's prompt naming their own app, truncated mid-sentence",
  'crie-um-app-sobre-alimenta-o': 'Portuguese, truncated mid-sentence',
  'crea-una-app-donde-tenga-fork': 'a fork credited to a named user, Spanish',
  'build-a-resume-builder-with-form-section': 'duplicate of resume-builder',
  'minecraft-block-builder': 'a one-line prompt naming a trademark',
};
const TITLE_FIXES: Record<string, string> = {
  'n-invoice-generator': 'Invoice Generator',
  'n-interactive-quiz-game': 'Interactive Quiz Game',
};

test('matches the Android catalog and accounts for every entry in it (checked when android/ is present)', (ctx) => {
  const path = new URL('../../../android/app/src/main/assets/templates/catalog.json', import.meta.url);
  if (!existsSync(path)) return ctx.skip('android/ not in this checkout');
  const catalog = JSON.parse(readFileSync(path, 'utf8')).projects as Array<Record<string, string>>;
  const shown = new Set(STARTER_TEMPLATES.map((t) => t.slug));
  for (const c of catalog) {
    assert.ok(shown.has(c.slug) !== (c.slug in EXCLUDED), `${c.slug} must be either shown or listed in EXCLUDED`);
  }
  for (const t of STARTER_TEMPLATES) {
    const c = catalog.find((x) => x.slug === t.slug);
    assert.ok(c, `${t.slug} is not in the catalog`);
    assert.equal(t.title, TITLE_FIXES[t.slug] ?? c.title);
    assert.equal(t.difficulty, c.difficulty);
    assert.equal(t.category, c.category);
    assert.equal(t.description, c.description);
  }
});
