'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickTitle } = require('../lib/titles.js');

test('the user\'s own title always wins', () => {
  assert.equal(pickTitle('My notes on graphs', 'Post | LinkedIn', 'Amazon OA topic'), 'My notes on graphs');
});

test('the tab\'s title, left as it was prefilled, is replaced by the page\'s better one', () => {
  assert.equal(pickTitle('Post | LinkedIn', 'Post | LinkedIn', 'Cloud DevOps Learning Resources'), 'Cloud DevOps Learning Resources');
});

test('an empty title gets the page\'s better one, or the tab\'s when there is none', () => {
  assert.equal(pickTitle('', 'Post | LinkedIn', 'Cloud DevOps Learning Resources'), 'Cloud DevOps Learning Resources');
  assert.equal(pickTitle(undefined, 'Some tab', ''), 'Some tab');
  assert.equal(pickTitle(null, '', null), '');
});

test('without a better title from the page nothing changes', () => {
  assert.equal(pickTitle('Edited', 'Tab', ''), 'Edited');
  assert.equal(pickTitle('Tab', 'Tab', null), 'Tab');
  assert.equal(pickTitle('Tab', 'Tab', undefined), 'Tab');
});

test('surrounding spaces do not make a prefilled title look edited', () => {
  assert.equal(pickTitle('  Post | LinkedIn ', 'Post | LinkedIn', 'Topic'), 'Topic');
});
