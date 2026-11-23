// Regenerates locales/app-strings.json from the Android string resources, so the bot says the same words as the app.
// Run from sms-bot/: node scripts/extract-app-strings.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RES = join(here, '../../android/app/src/main/res');
const KEYS = [
  'build_phase_generate', 'build_phase_validate', 'build_phase_fix', 'build_phase_polish', 'build_phase_verify',
  'generation_phase_complete', 'build_chat_stage_building', 'build_chat_stage_complete', 'build_chat_stage_failed',
  'build_chat_working', 'err_build_failed', 'err_build_maybe_running', 'err_prompt_no_urls', 'err_prompt_no_code',
  'generation_limit_reached', 'create_busy_body_free', 'err_build_start',
];
const DIRS = { en: 'values', ar: 'values-ar', cs: 'values-cs', de: 'values-de', el: 'values-el', es: 'values-es', fi: 'values-fi', fr: 'values-fr', hi: 'values-hi', hu: 'values-hu', id: 'values-in', it: 'values-it', ja: 'values-ja', ko: 'values-ko', ms: 'values-ms', nl: 'values-nl', pl: 'values-pl', 'pt-BR': 'values-pt-rBR', ro: 'values-ro', ru: 'values-ru', sv: 'values-sv', th: 'values-th', tl: 'values-tl', tr: 'values-tr', uk: 'values-uk', vi: 'values-vi', 'zh-CN': 'values-zh-rCN' };

const unescapeXml = (s) => s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const parse = (file) => {
  const out = {};
  if (!existsSync(file)) return out;
  for (const m of readFileSync(file, 'utf8').matchAll(/<string name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g)) out[m[1]] = unescapeXml(m[2].trim());
  return out;
};

const en = parse(join(RES, DIRS.en, 'strings.xml'));
const result = {};
const missing = {};
for (const [lang, dir] of Object.entries(DIRS)) {
  const own = parse(join(RES, dir, 'strings.xml'));
  result[lang] = {};
  for (const k of KEYS) {
    if (own[k] && !/%\d?\$?[sd]/.test(own[k])) result[lang][k] = own[k];
    else { result[lang][k] = en[k]; (missing[lang] ||= []).push(k); } // not translated in the app: fall back to English
  }
}
writeFileSync(join(here, '../locales/app-strings.json'), JSON.stringify(result, null, 1) + '\n');
console.log('wrote locales/app-strings.json; keys falling back to English:', JSON.stringify(missing));
