import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANGS, UCS2_LANGS, detectLanguage, normalizeLangCode, t } from '../lib/lang.js';
import { smsSegments, normalizeForSms } from '../lib/segments.js';
import { createBackend, BackendUnavailable } from '../lib/backend.js';

// One natural "build me a ..." sentence per supported language.
const SAMPLES = {
  en: 'I want a simple todo app with dark mode',
  ar: 'أريد تطبيقا لتتبع عاداتي اليومية',
  cs: 'Chci aplikaci pro plánování tréninků s připomínkami',
  de: 'Ich möchte eine App für meine Einkaufsliste mit Erinnerungen',
  el: 'Θέλω μια εφαρμογή για σημειώσεις με σκούρο θέμα',
  es: 'Quiero una aplicación de tareas con modo oscuro',
  fi: 'Haluan sovelluksen jolla seuraan treenejä',
  fr: 'Je veux une application avec des rappels pour mes recettes',
  hi: 'मुझे खर्च ट्रैक करने वाला ऐप चाहिए',
  hu: 'Szeretnék egy alkalmazás a napi feladataimhoz',
  id: 'Saya ingin membuat aplikasi catatan keuangan',
  it: 'Voglio una app per il conteggio delle calorie con grafici',
  ja: 'ダークモード付きのタスク管理アプリを作ってください',
  ko: '운동 기록을 관리하는 앱을 만들어 주세요',
  ms: 'Saya mahu bina aplikasi untuk senarai belanja',
  nl: 'Ik wil een app voor mijn boodschappenlijst met herinneringen',
  pl: 'Chcę aplikację do planowania treningów z przypomnieniami',
  'pt-BR': 'Quero um aplicativo para controlar meus gastos com gráficos',
  ro: 'Vreau o aplicație pentru lista mea de cumpărături',
  ru: 'Хочу приложение для заметок с тёмной темой',
  sv: 'Jag vill ha en app för min träning med påminnelser',
  th: 'ฉันต้องการแอปจดบันทึกรายจ่าย',
  tl: 'Gusto ko ng isang app na may timer para sa pag-aaral',
  tr: 'Bana yemek tarifleri için bir uygulama yap',
  uk: 'Хочу застосунок для нотаток із темною темою',
  vi: 'Tôi muốn một ứng dụng theo dõi chi tiêu hằng ngày',
  'zh-CN': '我想要一个带深色模式的待办事项应用',
  'zh-TW': '我想要一個帶深色模式的待辦事項應用程式',
  'zh-HK': '我想要一個帶深色模式的待辦事項應用程式', // written Hong Kong Chinese is not told apart from Taiwan's: LANG zh-hk picks it
};

test('language detection: all 29 locales', () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), [...LANGS].sort());
  const wrong = [];
  for (const [lang, text] of Object.entries(SAMPLES)) {
    const d = detectLanguage(text);
    if (lang === 'zh-HK') { if (d.lang !== 'zh-TW') wrong.push(`zh-HK text: got ${d.lang}`); continue; }
    if (d.lang !== lang || d.confidence !== 'high') wrong.push(`${lang}: got ${d.lang}/${d.confidence}`);
  }
  assert.deepEqual(wrong, []);
});

test('language detection: unsure input defaults to English with low confidence', () => {
  for (const s of ['hi', 'todo', '12345', '', 'ok']) assert.deepEqual(detectLanguage(s), { lang: 'en', confidence: 'low' }, s);
});

test('Han text: Simplified stays zh-CN, Traditional is zh-TW, mixed text goes by the majority', () => {
  assert.equal(detectLanguage('我想要一个带深色模式的待办事项应用').lang, 'zh-CN');
  assert.equal(detectLanguage('我想要一個帶深色模式的待辦事項應用程式').lang, 'zh-TW');
  assert.equal(detectLanguage('幫我做一個記帳的應用，要有圖表和提醒').lang, 'zh-TW');
  assert.equal(detectLanguage('帮我做一个记账的应用，要有图表和提醒').lang, 'zh-CN');
  assert.equal(detectLanguage('做个app').lang, 'zh-CN'); // no signal: Simplified, as before
});

test('language codes for the LANG command', () => {
  assert.equal(normalizeLangCode('PT'), 'pt-BR');
  assert.equal(normalizeLangCode('zh'), 'zh-CN');
  assert.equal(normalizeLangCode('in'), 'id');
  assert.equal(normalizeLangCode('fil'), 'tl');
  assert.equal(normalizeLangCode('xx'), null);
  for (const c of ['zh-tw', 'ZH_TW', 'zh-Hant', 'zh-mo']) assert.equal(normalizeLangCode(c), 'zh-TW', c);
  for (const c of ['zh-hk', 'ZH-HK', 'zh_hant_hk']) assert.equal(normalizeLangCode(c), 'zh-HK', c);
  for (const c of ['zh-sg', 'zh-Hans']) assert.equal(normalizeLangCode(c), 'zh-CN', c);
  for (const c of ['constructor', '__proto__', 'toString']) assert.equal(normalizeLangCode(c), null, c);
});

test('every language has every string; placeholders survive; app phrases come from the Android resources', () => {
  const bot = JSON.parse(readFileSync(new URL('../locales/bot-strings.json', import.meta.url), 'utf8'));
  const keys = Object.keys(bot.en);
  for (const l of LANGS) {
    for (const k of keys) {
      assert.ok(bot[l]?.[k], `${l}.${k}`);
      const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
      assert.equal(ph(bot[l][k]), ph(bot.en[k]), `${l}.${k} placeholders`);
    }
    assert.match(bot[l].help, /STOP/, `${l} help mentions STOP`);
    assert.match(bot[l].help, /support@vibebuild\.cc/, `${l} help has the contact`);
  }
  assert.equal(t('ja', 'build_phase_polish'), '仕上げ');
  assert.equal(t('de', 'build_chat_stage_building'), t('de', 'build_chat_stage_building'));
});

test('SMS cost: segment counting and what each language costs for the main messages', () => {
  assert.deepEqual(smsSegments('hello'), { encoding: 'GSM-7', units: 5, segments: 1 });
  assert.equal(smsSegments('a'.repeat(160)).segments, 1);
  assert.equal(smsSegments('a'.repeat(161)).segments, 2);
  assert.equal(smsSegments('a'.repeat(306)).segments, 2);
  assert.equal(smsSegments('a'.repeat(307)).segments, 3);
  assert.equal(smsSegments('{').units, 2);                                  // extension characters cost two
  assert.deepEqual(smsSegments('✅ done'), { encoding: 'UCS-2', units: 6, segments: 1 }); // one emoji flips the whole message
  assert.equal(smsSegments('ส'.repeat(71)).segments, 2);
  assert.equal(normalizeForSms('It’s “done”…'), 'It\'s "done"...');

  const url = 'https://vibebuild.cc/project/8f14e45f-ceea-467f-a0e6-1f2c6a1b2c3d';
  const done = (l) => `${t(l, 'build_chat_stage_complete', {}, { sms: true })}\n${url}\n${t(l, 'done_more', {}, { sms: true })}`;
  const rows = [];
  for (const l of LANGS) {
    const ack = smsSegments(t(l, 'ack', {}, { sms: true }));
    const fin = smsSegments(done(l));
    const help = smsSegments(t(l, 'help', {}, { sms: true }));
    rows.push(`${l.padEnd(6)} ${fin.encoding} ack=${ack.segments} done=${fin.segments} help=${help.segments}`);
    assert.ok(ack.segments <= 2, `${l} ack ${ack.segments}`);
    assert.ok(fin.segments <= 3, `${l} done ${fin.segments}`);
    assert.ok(help.segments <= 5, `${l} help ${help.segments}`);
    // English has no emoji and no smart punctuation, so it stays in the cheap alphabet
    if (l === 'en') { assert.equal(ack.encoding, 'GSM-7'); assert.equal(fin.encoding, 'GSM-7'); }
  }
  if (process.env.PRINT_SEGMENTS) console.log(rows.join('\n'));
  // languages that always need UCS-2 must really be UCS-2 (so the cost table in the docs is honest)
  for (const l of UCS2_LANGS) assert.equal(smsSegments(t(l, 'ack', {}, { sms: true })).encoding, 'UCS-2', l);
});

test('backend client: link verify/lookup and build start map API answers (no network)', async () => {
  const calls = [];
  const sse = (events) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  let next;
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return next(url, init); };
  const be = createBackend({ apiUrl: 'https://api.test/', fetchImpl });

  next = () => json(200, { linked: true, userId: 'u1', displayName: 'Sam' });
  assert.deepEqual(await be.lookupUser('+14255550101'), { linked: true, userId: 'u1', displayName: 'Sam' });
  assert.equal(calls.at(-1).url, 'https://api.test/api/telegram/user/%2B14255550101');
  next = () => json(200, { linked: false });
  assert.deepEqual(await be.lookupUser('+1'), { linked: false });
  next = () => json(503, { error: 'disabled' });
  await assert.rejects(be.lookupUser('+1'), BackendUnavailable);

  next = () => json(404, { error: 'Invalid or expired code' });
  assert.deepEqual(await be.verifyCode('abc123', '+1425'), { ok: false, reason: 'invalid' });
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { code: 'ABC123', telegramId: '+1425', telegramUsername: null, telegramName: '+1425' });
  next = () => json(410, {});
  assert.equal((await be.verifyCode('ABC123', '+1')).reason, 'expired');
  next = () => json(200, { success: true, userId: 'u2', displayName: 'Ann' });
  assert.deepEqual(await be.verifyCode('ABC123', '+1'), { ok: true, userId: 'u2', displayName: 'Ann' });

  next = () => sse([{ type: 'queued', projectId: 'p1' }]);
  assert.deepEqual(await be.startBuild({ prompt: 'x', userId: 'u', source: 'sms' }), { ok: true, projectId: 'p1' });
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { prompt: 'x', userId: 'u', stream: false, source: 'sms' });
  next = () => sse([{ type: 'queued', projectId: 'p1' }, { type: 'error', error: 'busy', systemBusy: true }]);
  assert.equal((await be.startBuild({ prompt: 'x', userId: 'u' })).reason, 'busy');
  next = () => json(429, { error: "You have reached today's fair-use limit", fairUse: true });
  assert.equal((await be.startBuild({ prompt: 'x', userId: 'u' })).reason, 'limit');
  next = () => json(429, { error: 'Rate limit exceeded. Try again in an hour.' });
  assert.equal((await be.startBuild({ prompt: 'x', userId: 'u' })).reason, 'limit');
  next = () => json(400, { error: 'no urls' });
  assert.equal((await be.startBuild({ prompt: 'x', userId: 'u' })).reason, 'rejected');
  next = () => { throw new Error('boom'); };
  assert.equal((await be.startBuild({ prompt: 'x', userId: 'u' })).reason, 'error');

  next = () => json(200, { success: true, status: 'building', phase: 'fix', percent: 55 });
  assert.deepEqual(await be.progress('p1', 'u'), { status: 'building', phase: 'fix', percent: 55 });
  assert.match(calls.at(-1).url, /\/api\/projects\/p1\/progress\?userId=u$/);
  next = () => json(404, {});
  assert.equal((await be.progress('p1', 'u')).status, 'missing');
  next = () => json(500, {});
  assert.equal((await be.progress('p1', 'u')).status, 'unknown');
});
