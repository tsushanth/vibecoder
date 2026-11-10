import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTitle } from '../../lib/projectTitle.js';

test('"an" is removed as a whole word (it used to leave a stray "N")', () => {
    assert.equal(deriveTitle('Build an expense tracker'), 'Expense Tracker');
    assert.equal(deriveTitle('Make an inventory app for my shop'), 'Inventory App');
    assert.equal(deriveTitle('build me an app for dogs'), 'App');
    assert.equal(deriveTitle('Create an app in which we add people'), 'App');
});

test('a, the and me a keep working', () => {
    assert.equal(deriveTitle('Build a todo app'), 'Todo App');
    assert.equal(deriveTitle('Design the checkout page'), 'Checkout Page');
    assert.equal(deriveTitle('make me a budget planner'), 'Budget Planner');
});

test('a word that only starts with an article is not eaten', () => {
    assert.equal(deriveTitle('Build anagram solver'), 'Anagram Solver');
    assert.equal(deriveTitle('Create theatre booking'), 'Theatre Booking');
});

test('a title never ends on a dangling word', () => {
    assert.equal(deriveTitle('I need to link a site i built with loveable'), 'I Need To Link');
    assert.equal(deriveTitle('recipe app in'), 'Recipe App');
});

test('cuts at the usual connectors and at five words', () => {
    assert.equal(deriveTitle('Build a habit tracker with streaks and charts'), 'Habit Tracker');
    assert.equal(deriveTitle('weekly meal planner for busy parents who cook'), 'Weekly Meal Planner');
    assert.equal(deriveTitle('one two three four five six seven'), 'One Two Three Four Five');
});

test('empty, blank and non-string input fall back to My App', () => {
    assert.equal(deriveTitle(''), 'My App');
    assert.equal(deriveTitle('   '), 'My App');
    assert.equal(deriveTitle(undefined), 'My App');
    assert.equal(deriveTitle(null), 'My App');
});

test('title is at most 50 characters', () => {
    assert.ok(deriveTitle('Supercalifragilisticexpialidocious '.repeat(3)).length <= 50);
});
