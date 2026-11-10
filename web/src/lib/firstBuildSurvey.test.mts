import test from 'node:test';
import assert from 'node:assert/strict';
import { SURVEY_CHOICES, SURVEY_STORAGE_KEY, surveyHandled, markSurveyHandled } from './firstBuildSurvey.ts';
import { readFileSync } from 'node:fs';

function store(opts: { throws?: boolean } = {}) {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => { if (opts.throws) throw new Error('blocked'); return m.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (opts.throws) throw new Error('blocked'); m.set(k, v); },
  };
}

test('five fixed choices plus "something else", and nothing that takes typed text', () => {
  assert.equal(SURVEY_CHOICES.length, 6);
  assert.equal(SURVEY_CHOICES[SURVEY_CHOICES.length - 1], 'something_else');
  assert.equal(new Set(SURVEY_CHOICES).size, SURVEY_CHOICES.length);
});

test('handled flag: false at first, true after marking, and a blocked store never throws', () => {
  const s = store();
  assert.equal(surveyHandled(s), false);
  markSurveyHandled(s);
  assert.equal(s.m.get(SURVEY_STORAGE_KEY), '1');
  assert.equal(surveyHandled(s), true);
  const blocked = store({ throws: true });
  assert.doesNotThrow(() => markSurveyHandled(blocked));
  assert.equal(surveyHandled(blocked), false);
  assert.equal(surveyHandled(null), false);
});

test('every language has the question, every choice, skip and thanks', () => {
  const dir = new URL('../i18n/messages/parts/', import.meta.url);
  for (const l of ['en', 'de', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt', 'zh']) {
    const survey = JSON.parse(readFileSync(new URL(`create.${l}.json`, dir), 'utf8')).create.survey;
    for (const k of ['question', 'hint', 'skip', 'thanks', ...SURVEY_CHOICES]) assert.ok(typeof survey[k] === 'string' && survey[k].length > 0, `${l} ${k}`);
  }
});
