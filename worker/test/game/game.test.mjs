import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GAME_RULES, createPrompt, harderPrompt, nextLevelPrompt, gameProblems, extractTitle, makeGameCheck, qualityOf, validateHarder, validateNextLevel } from '../../lib/gameRules.js';
import { registerGameRoutes } from '../../lib/gameRoutes.js';

const BRIDGE = `function reportScore(score, isGameOver){try{if(window.webkit?.messageHandlers?.gameScore){window.webkit.messageHandlers.gameScore.postMessage({score:score,gameOver:isGameOver});}if(window.AndroidBridge){if(isGameOver)window.AndroidBridge.gameOver(score);else window.AndroidBridge.postScore(score);}}catch(e){}}`;
const game = ({ title = 'Neon Memory Match', bridge = true, touch = true, over = true, extra = '' } = {}) => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><div id="score">0</div><button id="b">Play Again</button><script>${bridge ? BRIDGE : ''}
let score=0;function endGame(){${bridge && over ? 'reportScore(score,true);' : ''}document.getElementById('score').textContent='game over '+score;}
function startGame(){score=0;${bridge ? 'reportScore(0,false);' : ''}}
${touch ? "document.getElementById('b').addEventListener('pointerdown',startGame);" : ''}${extra}
// padding to pass the minimum length ${'x'.repeat(120)}
</script></body></html>`;

test('GAME_RULES carries the contract: reportScore bridge, touch, title rule, no overflow hidden', () => {
    for (const s of ['reportScore(score, isGameOver)', 'AndroidBridge.gameOver', 'gameScore', '<title>', 'Play Again', 'viewport']) assert.ok(GAME_RULES.includes(s), s);
});

test('gameProblems: a good game has no critical problems', () => {
    const g = gameProblems({ 'index.html': game() });
    assert.deepEqual(g.critical, []);
    assert.deepEqual(g.warnings, []);
});
test('gameProblems: missing score bridge is critical', () => {
    const g = gameProblems({ 'index.html': game({ bridge: false }) });
    assert.equal(g.critical.length, 1);
    assert.match(g.critical[0], /reportScore/);
});
test('gameProblems: no touch/pointer/click handler is critical', () => {
    assert.match(gameProblems({ 'index.html': game({ touch: false }) }).critical.join(), /touch/);
});
test('gameProblems: bridge defined but never called with gameOver=true is a warning, not critical', () => {
    const g = gameProblems({ 'index.html': game({ over: false }) });
    assert.deepEqual(g.critical, []);
    assert.ok(g.warnings.some((w) => /isGameOver=true/.test(w)));
});
test('gameProblems: broken local file reference is critical, external urls are left to the base check', () => {
    const html = game().replace('</head>', '<script src="js/missing.js"></script><link href="https://x.test/a.css"></head>');
    const g = gameProblems({ 'index.html': html });
    assert.equal(g.critical.length, 1);
    assert.match(g.critical[0], /js\/missing\.js/);
    assert.deepEqual(gameProblems({ 'index.html': html, 'js/missing.js': 'var a=1' }).critical, []);
});
test('gameProblems: TODO markers are warnings', () => {
    assert.ok(gameProblems({ 'index.html': game({ extra: '// TODO later' }) }).warnings.some((w) => /incomplete code/.test(w)));
});

test('extractTitle: cleans entities, rejects placeholders and out-of-range lengths', () => {
    assert.equal(extractTitle({ 'index.html': game({ title: 'Tom &amp; Jerry   Dash' }) }), 'Tom & Jerry Dash');
    for (const t of ['Game', 'Untitled', 'Document', 'x']) assert.equal(extractTitle({ 'index.html': game({ title: t }) }), null, t);
    assert.equal(extractTitle({ 'index.html': game({ title: 'a'.repeat(101) }) }), null);
    assert.equal(extractTitle({}), null);
});

test('makeGameCheck merges base problems, game problems and extra problems', async () => {
    const base = async () => ({ ok: false, hasApp: true, problems: ['base problem'] });
    const r = await makeGameCheck(base, () => ['extra problem'])({ 'index.html': game({ bridge: false }) });
    assert.equal(r.ok, false);
    assert.equal(r.problems.length, 3);
    const ok = await makeGameCheck(async () => ({ ok: true, hasApp: true, problems: [] }))({ 'index.html': game() });
    assert.equal(ok.ok, true);
});

test('qualityOf counts critical issues and warnings', () => {
    assert.deepEqual(qualityOf({ 'index.html': game({ bridge: false }) }, { phasesCompleted: 3 }), { criticalIssues: 1, warnings: gameProblems({ 'index.html': game({ bridge: false }) }).warnings.length, phasesCompleted: 3 });
});

test('prompts: harder names the level and badge, next-level embeds the previous files', () => {
    const h = harderPrompt({ gameTitle: 'Snake "Pro"', difficultyLevel: 3 });
    assert.match(h, /level 2/); assert.match(h, /level 3 \(out of 5\)/); assert.match(h, /"HARD"/); assert.ok(!h.includes('"Pro"'));
    const n = nextLevelPrompt({ seriesTitle: 'S', seriesDescription: '', parentLevelIndex: 1, nextLevelIndex: 2, previousFiles: { 'index.html': '<p>prev</p>' } });
    assert.match(n, /Level 2/); assert.match(n, /<previous-level-file path="index.html">\n<p>prev<\/p>/); assert.match(n, /\(none provided\)/);
    assert.match(createPrompt('a memory card game'), /memory card game/);
});

test('request validation mirrors the original worker', () => {
    assert.match(validateHarder({}), /parentBundle/);
    assert.match(validateHarder({ parentBundle: 'x', difficultyLevel: 1 }), /2-5/);
    assert.match(validateHarder({ parentBundle: 'x', difficultyLevel: 6 }), /2-5/);
    assert.equal(validateHarder({ parentBundle: 'x', difficultyLevel: 2 }), null);
    assert.match(validateNextLevel({ parentBundle: 'x', nextLevelIndex: 1 }), />= 2/);
    assert.equal(validateNextLevel({ parentBundle: 'x', nextLevelIndex: 2 }), null);
});

// ---------------------------------------------------------------- routes with fakes (no network, no express)
function harness({ replies, busy = false, llm = true } = {}) {
    const routes = {};
    const app = { post: (p, ...h) => { routes['POST ' + p] = h[h.length - 1]; }, get: (p, ...h) => { routes['GET ' + p] = h[h.length - 1]; } };
    const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gametest-'));
    let released = 0, acquired = 0;
    const logged = [];
    const calls = [];
    const fakeLlm = { isOpen: () => false, chat: async ({ messages }) => { calls.push(messages); const t = replies.shift(); if (t instanceof Error) throw t; return { text: t, costUsd: 0.01 }; } };
    registerGameRoutes(app, {
        authMiddleware: (q, s, n) => n(), llm: llm ? fakeLlm : null, models: ['m1'], projectsDir,
        slot: { acquire: () => { if (busy) return false; acquired++; return true; }, release: () => { released++; } },
        makeOutcome: (id, kind) => { const c = { run: null, delivered: false, finish: () => logged.push({ kind, delivered: c.delivered, cause: c.run?.cause }) }; return c; },
        zipProjectFolder: async (dir) => { const f = fs.readdirSync(dir); return { base64: Buffer.from(JSON.stringify(f)).toString('base64'), sizeBytes: 10 }; },
        listProjectFiles: (dir) => fs.readdirSync(dir).map((n) => ({ path: n, size: 1 })),
        unzipBundle: (b, dir) => { if (b === 'BAD') throw new Error('Invalid ZIP'); fs.writeFileSync(path.join(dir, 'index.html'), Buffer.from(b, 'base64').toString()); },
        git: { pat: '' },
    });
    const call = async (key, body) => {
        const out = { events: [], code: 200, json: null, headers: {} };
        const res = { setHeader: (k, v) => { out.headers[k] = v; }, flushHeaders() {}, on() {}, write: (s) => { for (const l of s.split('\n')) if (l.startsWith('data: ')) out.events.push(JSON.parse(l.slice(6))); }, end() { out.ended = true; }, status(c) { out.code = c; return res; }, json(j) { out.json = j; } };
        await routes[key]({ body, params: {}, query: {} }, res);
        return out;
    };
    return { call, released: () => released, acquired: () => acquired, logged, calls, fakeLlm };
}
const reply = (html) => `<file path="index.html">\n${html}\n</file>`;
const b64 = (s) => Buffer.from(s).toString('base64');

test('POST /game/generate streams status then a contract-shaped result and releases the slot', async () => {
    const h = harness({ replies: [reply(game())] });
    const out = await h.call('POST /game/generate', { prompt: 'a simple crossword about 1970s music', userId: 'u', stream: true });
    const types = out.events.map((e) => e.type);
    assert.equal(types[0], 'status'); assert.equal(types.at(-1), 'result'); assert.ok(out.ended);
    const r = out.events.at(-1);
    for (const k of ['success', 'bundle', 'bundleSize', 'files', 'generationTime', 'quality', 'suggestedTitle', 'suggestedDescription']) assert.ok(k in r, k);
    assert.equal(r.quality.criticalIssues, 0);
    assert.equal(r.suggestedTitle, 'Neon Memory Match');
    assert.equal(h.released(), 1);
    assert.deepEqual(h.logged, [{ kind: 'game_generate', delivered: true, cause: undefined }]);
    assert.match(h.calls[0][0].content, /reportScore/); // game rules are in the system message
});

test('POST /game/generate: a reply with no score bridge triggers a fix pass, then succeeds', async () => {
    const h = harness({ replies: [reply(game({ bridge: false })), reply(game())] });
    const out = await h.call('POST /game/generate', { prompt: 'memory card game', stream: true });
    assert.equal(out.events.at(-1).type, 'result');
    assert.equal(h.calls.length, 2);
    assert.match(h.calls[1].at(-1).content, /score reporting bridge/);
});

test('POST /game/generate: persistent failure returns a stream error, logs the cause, releases the slot', async () => {
    const h = harness({ replies: [reply(game({ bridge: false })), reply(game({ bridge: false }))] });
    const out = await h.call('POST /game/generate', { prompt: 'memory card game', stream: true });
    assert.equal(out.events.at(-1).type, 'error');
    assert.equal(h.released(), 1);
    assert.equal(h.logged[0].delivered, false);
    assert.equal(h.logged[0].cause, 'check_failed');
});

test('non-stream mode returns plain JSON; validation and busy return 400/429 without taking a slot', async () => {
    const h = harness({ replies: [reply(game())] });
    const ok = await h.call('POST /game/generate', { prompt: 'x game' });
    assert.ok(ok.json.bundle);
    assert.equal((await h.call('POST /game/generate', { prompt: '  ' })).code, 400);
    const busy = harness({ replies: [], busy: true });
    assert.equal((await busy.call('POST /game/generate', { prompt: 'x game' })).code, 429);
    assert.equal(busy.released(), 0);
    assert.equal((await harness({ replies: [], llm: false }).call('POST /game/generate', { prompt: 'x' })).code, 503);
});

test('POST /game/generate-harder edits the parent (existing files in the prompt) and reports difficultyLevel', async () => {
    const h = harness({ replies: [reply(game({ extra: '/* harder */' }))] });
    const out = await h.call('POST /game/generate-harder', { parentBundle: b64(game()), difficultyLevel: 2, gameTitle: 'Memory', stream: true });
    const r = out.events.at(-1);
    assert.equal(r.type, 'result'); assert.equal(r.difficultyLevel, 2); assert.equal(r.commitSha, null);
    assert.match(h.calls[0].at(-1).content, /CURRENT FILES/);
    const bad = await h.call('POST /game/generate-harder', { parentBundle: 'BAD', difficultyLevel: 2, stream: true });
    assert.equal(bad.events.at(-1).type, 'error'); assert.match(bad.events.at(-1).error, /valid ZIP/);
    assert.equal(h.released(), h.acquired());
});

test('POST /game/generate-next-level: early suggestedTitle status, result has nextLevelIndex + suggestedTitle/Description, identical level rejected', async () => {
    const parent = game();
    const h = harness({ replies: [reply(parent), reply(game({ title: 'Lava Level Two', extra: 'let lava=1;' }))] });
    const out = await h.call('POST /game/generate-next-level', { parentBundle: b64(parent), seriesTitle: 'Memory', seriesDescription: 'd', parentLevelIndex: 1, nextLevelIndex: 2, userId: 'u', stream: true });
    assert.ok(out.events[0].suggestedTitle.includes('Level 2'));
    const r = out.events.at(-1);
    assert.equal(r.type, 'result'); assert.equal(r.nextLevelIndex, 2); assert.equal(r.suggestedTitle, 'Lava Level Two'); assert.equal(r.suggestedDescription, 'Level 2 of Memory');
    assert.equal(h.calls.length, 2); // first reply was identical to the parent -> fix pass
    assert.match(h.calls[1].at(-1).content, /identical to the previous level/);
});

test('git routes: 503 without a PAT; validation errors for missing fields', async () => {
    const h = harness({ replies: [] });
    assert.equal((await h.call('POST /game/tweak', { repoName: 'r', tweakDescription: 't' })).code, 503);
    assert.equal((await h.call('POST /game/tweak', { repoName: 'r' })).code, 400);
    assert.equal((await h.call('POST /game/init-repo', {})).code, 400);
    assert.equal((await h.call('GET /game/versions/:repoName', {})).code, 503);
    assert.equal((await h.call('GET /game/ping', {})).json.direct, true);
});
