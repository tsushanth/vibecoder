// Language handling for the 27 app locales: detection from the first message, strings, and the LANG command.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeForSms } from './segments.js';

const here = dirname(fileURLToPath(import.meta.url));
const bot = JSON.parse(readFileSync(join(here, '../locales/bot-strings.json'), 'utf8'));
const app = JSON.parse(readFileSync(join(here, '../locales/app-strings.json'), 'utf8'));

export const LANGS = ['en', 'ar', 'cs', 'de', 'el', 'es', 'fi', 'fr', 'hi', 'hu', 'id', 'it', 'ja', 'ko', 'ms', 'nl', 'pl', 'pt-BR', 'ro', 'ru', 'sv', 'th', 'tl', 'tr', 'uk', 'vi', 'zh-CN'];
export const LANG_NAMES = { en: 'English', ar: 'العربية', cs: 'Čeština', de: 'Deutsch', el: 'Ελληνικά', es: 'Español', fi: 'Suomi', fr: 'Français', hi: 'हिन्दी', hu: 'Magyar', id: 'Bahasa Indonesia', it: 'Italiano', ja: '日本語', ko: '한국어', ms: 'Bahasa Melayu', nl: 'Nederlands', pl: 'Polski', 'pt-BR': 'Português (Brasil)', ro: 'Română', ru: 'Русский', sv: 'Svenska', th: 'ไทย', tl: 'Tagalog', tr: 'Türkçe', uk: 'Українська', vi: 'Tiếng Việt', 'zh-CN': '简体中文' };
export const LANG_CODES_HINT = 'en ar cs de el es fi fr hi hu id it ja ko ms nl pl pt ro ru sv th tl tr uk vi zh';
/** Languages whose words are not in the GSM-7 alphabet: every SMS to them is UCS-2 (70 chars per segment). */
export const UCS2_LANGS = ['ar', 'el', 'hi', 'ja', 'ko', 'ru', 'th', 'uk', 'zh-CN'];

/** Accepts "es", "pt", "pt-br", "zh", "cn", "in", "fil" ... Returns a supported code or null. */
export function normalizeLangCode(raw) {
  const c = String(raw || '').trim().toLowerCase().replace('_', '-');
  if (!c) return null;
  const alias = { pt: 'pt-BR', 'pt-br': 'pt-BR', zh: 'zh-CN', 'zh-cn': 'zh-CN', cn: 'zh-CN', in: 'id', fil: 'tl', ua: 'uk', jp: 'ja', kr: 'ko', gr: 'el' };
  if (alias[c]) return alias[c];
  return LANGS.find((l) => l.toLowerCase() === c) || null;
}

/** Looks up a string for a language, falling back to English. Bot strings win over app strings. */
export function t(lang, key, vars = {}, { sms = false } = {}) {
  const l = LANGS.includes(lang) ? lang : 'en';
  let s = bot[l]?.[key] ?? app[l]?.[key] ?? bot.en[key] ?? app.en[key];
  if (s === undefined) throw new Error(`missing string ${key}`);
  s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return sms ? normalizeForSms(s) : s;
}

// ---------- detection ----------
const STOP = {
  en: 'the and with for want need make build create please my that this simple is are of an to me app that',
  es: 'quiero una un con para que el la los las de mi hazme necesito por del una',
  fr: 'je veux une un avec pour que le la les des mon fais besoin de du',
  de: 'ich möchte eine einen mit für das der die und ein bitte mein brauche erstelle',
  it: 'voglio una un con per che il la le dei mio vorrei creare fammi di',
  'pt-BR': 'quero uma um com para que o a os as de meu preciso criar faça aplicativo você',
  nl: 'ik wil een met voor dat de het van mijn maak graag nodig',
  pl: 'chcę chce mam potrzebuję aplikację aplikacja z dla który mojej proszę zrób',
  ro: 'vreau o un cu pentru care să și mea aplicație fă-mi am nevoie',
  cs: 'chci chtl potřebuji aplikaci aplikace s pro který moje udělej prosím',
  hu: 'szeretnék egy és a az vagy alkalmazás kérek készíts nekem',
  fi: 'haluan tarvitsen sovellus sovelluksen ja jolla tee minulle kiitos',
  sv: 'jag vill ha en ett med för och som min skapa behöver',
  tr: 'istiyorum bir ile için ve benim uygulama yap lazım bana',
  id: 'saya ingin buatkan aplikasi dengan untuk yang dan tolong membuat bisa',
  ms: 'saya mahu buatkan aplikasi dengan untuk yang dan tolong bina boleh',
  tl: 'gusto ko ng isang app na may para sa at ang ay gawan mo ako',
  vi: 'tôi muốn một ứng dụng với cho và hãy tạo',
};
const STOPSETS = Object.fromEntries(Object.entries(STOP).map(([l, s]) => [l, new Set(s.split(/\s+/))]));
// Letters that point to one language (weight added per occurrence, capped).
const CHARS = [
  ['pl', /[ąćęłńśźż]/g, 3], ['cs', /[ěřůťďň]/g, 3],
  ['hu', /[őű]/g, 3], ['ro', /[ășțşţ]/g, 3], ['tr', /[ğışİ]/g, 3],
  ['vi', /[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđơư]/g, 4],
  ['pt-BR', /[ãõ]/g, 2], ['es', /[ñ¿¡]/g, 2], ['de', /ß/g, 3], ['sv', /å/g, 2], ['fr', /[œêç]/g, 1],
];

/** Returns { lang, confidence: 'high' | 'low' }. Low means "defaulted or a weak guess". */
export function detectLanguage(text) {
  const s = String(text || '');
  const count = (re) => (s.match(re) || []).length;
  const kana = count(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const hangul = count(/\p{Script=Hangul}/gu);
  const han = count(/\p{Script=Han}/gu);
  const thai = count(/\p{Script=Thai}/gu);
  const deva = count(/\p{Script=Devanagari}/gu);
  const arab = count(/\p{Script=Arabic}/gu);
  const greek = count(/\p{Script=Greek}/gu);
  const cyr = count(/\p{Script=Cyrillic}/gu);
  if (kana) return { lang: 'ja', confidence: 'high' };
  if (hangul) return { lang: 'ko', confidence: 'high' };
  if (han) return { lang: 'zh-CN', confidence: 'high' };
  if (thai) return { lang: 'th', confidence: 'high' };
  if (deva) return { lang: 'hi', confidence: 'high' };
  if (arab) return { lang: 'ar', confidence: 'high' };
  if (greek) return { lang: 'el', confidence: 'high' };
  if (cyr) return { lang: /[іїєґІЇЄҐ]/.test(s) ? 'uk' : 'ru', confidence: 'high' };
  const words = s.toLowerCase().match(/[\p{L}\p{M}'’-]+/gu) || [];
  const score = {};
  for (const [l, set] of Object.entries(STOPSETS)) score[l] = words.filter((w) => set.has(w)).length;
  const lower = s.toLowerCase();
  for (const [l, re, w] of CHARS) { const n = (lower.match(re) || []).length; if (n) score[l] += Math.min(n, 2) * w; }
  const ranked = Object.entries(score).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { lang: 'en', confidence: 'low' };
  const [top, topScore] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;
  if (topScore > second && topScore >= 2) return { lang: top, confidence: 'high' };
  if (topScore > second) return { lang: top, confidence: 'low' };
  return { lang: 'en', confidence: 'low' };
}
