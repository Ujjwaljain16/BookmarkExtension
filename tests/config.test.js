'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../lib/config.js');

test('the default API base is an https origin', () => {
  assert.equal(config.normalizeApiBase(config.DEFAULT_API_BASE), config.DEFAULT_API_BASE);
});

test('normalizeApiBase reduces a URL to its origin and lowercases only the host', () => {
  assert.equal(config.normalizeApiBase(' https://API.Example.com/ '), 'https://api.example.com');
  assert.equal(config.normalizeApiBase('https://api.example.com:8443'), 'https://api.example.com:8443');
});

test('normalizeApiBase refuses what it cannot safely use', () => {
  for (const bad of [
    '', 'api.example.com', 'ftp://api.example.com', 'javascript:alert(1)',
    'http://api.example.com',            // tokens in clear text
    'https://user:pw@api.example.com',   // credentials in the URL
    'https://api.example.com/api',       // a path would be doubled up with /api/...
    'https://api.example.com/?x=1',
  ]) {
    assert.throws(() => config.normalizeApiBase(bad, { devBuild: false }), Error, bad);
  }
});

test('plain http is allowed only for local servers, and only in dev builds', () => {
  assert.throws(() => config.normalizeApiBase('http://localhost:5000', { devBuild: false }));
  assert.equal(config.normalizeApiBase('http://localhost:5000', { devBuild: true }), 'http://localhost:5000');
  assert.equal(config.normalizeApiBase('http://127.0.0.1:5000', { devBuild: true }), 'http://127.0.0.1:5000');
  assert.throws(() => config.normalizeApiBase('http://evil.example', { devBuild: true }));
});

test('release builds are not dev builds', () => {
  assert.equal(config.DEV_BUILD, false);
});

test('originPermission is the match pattern for the whole origin', () => {
  assert.equal(config.originPermission('https://api.example.com'), 'https://api.example.com/*');
});

test('bookmarkLookupPath sends the URL exactly, case and all', () => {
  const url = 'https://Example.com/Docs/Page%20One?Id=7&b=2#Frag';
  const path = config.bookmarkLookupPath(url);
  assert.ok(path.startsWith('/api/bookmarks/lookup?url='));
  const sent = new URL('https://api.test' + path).searchParams.get('url');
  assert.equal(sent, url);
});

test('isSaveableUrl accepts web pages only', () => {
  assert.ok(config.isSaveableUrl('https://example.com/a'));
  assert.ok(config.isSaveableUrl('http://example.com'));
  for (const url of ['chrome://settings', 'chrome-extension://abc/popup.html', 'about:blank', 'file:///C:/a.txt',
    'javascript:alert(1)', 'data:text/html,hi', 'not a url']) {
    assert.equal(config.isSaveableUrl(url), false, url);
  }
});
