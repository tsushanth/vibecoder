import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrompt, isRealProject, dedupeByPrompt, filterBrowseProjects } from '../../services/browseFilter.js';

const good = (over = {}) => ({
    id: 'p1', title: 'Pomodoro Timer', creator_id: 'user-1', creator_name: 'Sam',
    preview_url: 'https://x/p.png', initial_prompt: 'Build a pomodoro timer with sounds', ...over,
});

test('normalizePrompt trims, lowercases, collapses whitespace, null-safe', () => {
    assert.equal(normalizePrompt('  Hello   WORLD\n\tfoo '), 'hello world foo');
    assert.equal(normalizePrompt(null), '');
    assert.equal(normalizePrompt(undefined), '');
});

test('accepts a normal project', () => assert.equal(isRealProject(good()), true));
test('thumbnail alone counts as a visual', () =>
    assert.equal(isRealProject(good({ preview_url: null, thumbnail_url: 't.png' })), true));

test('rejects missing visual', () =>
    assert.equal(isRealProject(good({ preview_url: null, thumbnail_url: null })), false));

for (const [label, over] of [
    ['anonymous creator', { creator_name: 'Anonymous' }],
    ['test user creator', { creator_name: 'Test User' }],
    ['test- creator id', { creator_id: 'test-123' }],
    ['title "test"', { title: 'test' }],
    ['title starting with test (short)', { title: 'Test build 2' }],
    ['title prefix-test', { title: 'prefix-test' }],
    ['prompt too short', { initial_prompt: 'hey' }],
    ['prompt 14 chars', { initial_prompt: 'a'.repeat(14) }],
    ['missing prompt', { initial_prompt: null }],
    ['whitespace-only prompt', { initial_prompt: '                     ' }],
    ['email prompt', { initial_prompt: 'someone.long@example.com' }],
    ['email prompt uppercase', { initial_prompt: 'SOMEONE.LONG@EXAMPLE.COM' }],
    ['email title', { title: 'a@b.co' }],
]) test(`rejects ${label}`, () => assert.equal(isRealProject(good(over)), false));

test('prompt of exactly 15 chars is accepted', () =>
    assert.equal(isRealProject(good({ initial_prompt: 'a'.repeat(15) })), true));

test('long title starting with "test" is kept', () =>
    assert.equal(isRealProject(good({ title: 'Test your knowledge: world capitals quiz' })), true));

test('a prompt containing an email plus words is kept (only pure email rejected)', () =>
    assert.equal(isRealProject(good({ initial_prompt: 'Build a contact page for me@x.com please' })), true));

test('multilingual prompts (length counts characters, not bytes)', () => {
    assert.equal(isRealProject(good({ initial_prompt: 'ऐसा ऐप बनाओ जो कार्य दिखाए और याद दिलाए' })), true);
    assert.equal(isRealProject(good({ initial_prompt: '日本語のタスク管理アプリを作ってください' })), true);
    assert.equal(isRealProject(good({ initial_prompt: 'Créer une application météo élégante' })), true);
    assert.equal(isRealProject(good({ initial_prompt: 'привет' })), false); // too short in any script
});

test('dedupe keeps first, ignoring case/whitespace differences', () => {
    const a = good({ id: 'a', initial_prompt: 'Build a Quiz game with timer' });
    const b = good({ id: 'b', initial_prompt: '  build a  quiz GAME with timer ' });
    const c = good({ id: 'c', initial_prompt: 'Something totally different here' });
    assert.deepEqual(dedupeByPrompt([a, b, c]).map((p) => p.id), ['a', 'c']);
});

test('filterBrowseProjects: filters then dedupes, preserves order, empty ok', () => {
    const list = [
        good({ id: '1' }),
        good({ id: '2', initial_prompt: 'me@example.com' }),
        good({ id: '3' }), // duplicate of 1
        good({ id: '4', initial_prompt: 'A completely different long prompt' }),
        good({ id: '5', creator_name: 'anonymous', initial_prompt: 'Another unique long prompt here' }),
    ];
    assert.deepEqual(filterBrowseProjects(list).map((p) => p.id), ['1', '4']);
    assert.deepEqual(filterBrowseProjects([]), []);
});

test('a junk project earlier in the list does not shadow a real duplicate prompt', () => {
    const junk = good({ id: 'junk', creator_name: 'Anonymous' });
    const real = good({ id: 'real' });
    assert.deepEqual(filterBrowseProjects([junk, real]).map((p) => p.id), ['real']);
});
