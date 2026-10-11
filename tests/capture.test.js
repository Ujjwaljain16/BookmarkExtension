'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const capture = require('../lib/capture.js');

const words = (n, prefix = 'w') => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');

function el(text, links = []) {
  return {
    innerText: text,
    querySelectorAll: (sel) => (sel === 'a' ? links.map((t) => ({ innerText: t })) : []),
  };
}

function fakeDoc({ body, parts = {}, title = 'Page', lang = 'en', canonical = null }) {
  return {
    title,
    body,
    documentElement: { lang },
    querySelectorAll: (sel) => parts[sel] || [],
    querySelector: (sel) => (sel === 'link[rel~="canonical"]' && canonical ? { getAttribute: () => canonical } : null),
  };
}

test('the caps stay under what the server accepts', () => {
  assert.ok(capture.MAX_TEXT_BYTES < 500000);
  assert.ok(capture.MAX_HTML_BYTES < 1000000);
});

test('truncateToBytes cuts by UTF-8 bytes without splitting a character', () => {
  assert.equal(capture.truncateToBytes('abc', 10), 'abc');
  const cut = capture.truncateToBytes('€€€', 7); // 3 bytes each
  assert.equal(cut, '€€');
  assert.ok(capture.utf8Length(cut) <= 7);
});

test('cleanText tidies whitespace and blank runs', () => {
  assert.equal(capture.cleanText('  a \t b \r\n\r\n\r\n\r\n c  '), 'a b\n\nc');
});

test('canonical URLs resolve against the page and must be http(s)', () => {
  assert.equal(capture.resolveCanonical('/a?b=C', 'https://Example.com/x'), 'https://example.com/a?b=C');
  assert.equal(capture.resolveCanonical('javascript:alert(1)', 'https://example.com/'), null);
  assert.equal(capture.resolveCanonical('', 'https://example.com/'), null);
});

test('lang must be a language tag', () => {
  assert.equal(capture.normalizeLang('pt_BR'), 'pt-BR');
  assert.equal(capture.normalizeLang('en"><script>'), null);
});

test('the article wins over the whole page; a link list does not', () => {
  const article = words(400, 'a');
  const nav = words(600, 'n');
  const doc = fakeDoc({
    body: el(`${nav}\n${article}\nfooter`),
    parts: { article: [el(article)], '[role="main"]': [el(nav, [nav])] },
    canonical: '/canonical',
  });
  const page = capture.capturePage(doc, { href: 'https://example.com/post' });
  assert.equal(page.url, 'https://example.com/post');
  assert.deepEqual(Object.keys(page.captured).sort(), ['canonical_url', 'lang', 'text']);
  assert.equal(page.captured.text, article);
  assert.equal(page.captured.canonical_url, 'https://example.com/canonical');
  assert.equal(page.captured.lang, 'en');
});

test('a short main element falls back to the body text', () => {
  const body = words(500);
  const doc = fakeDoc({ body: el(body), parts: { main: [el('Loading...')] } });
  assert.equal(capture.capturePage(doc, { href: 'https://example.com/' }).captured.text, body);
});

test('huge pages are capped', () => {
  const doc = fakeDoc({ body: el('x'.repeat(capture.MAX_TEXT_BYTES + 5000)) });
  const { text } = capture.capturePage(doc, { href: 'https://example.com/' }).captured;
  assert.equal(capture.utf8Length(text), capture.MAX_TEXT_BYTES);
});

test('an empty page or no body captures nothing', () => {
  assert.equal(capture.capturePage(fakeDoc({ body: null }), { href: 'https://example.com/' }), null);
  assert.equal(capture.capturePage(fakeDoc({ body: el('   ') }), { href: 'https://example.com/' }), null);
});

test('injected into a page, the script evaluates to the capture', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'capture.js'), 'utf8');
  const sandbox = {
    document: fakeDoc({ body: el('Hello signed-in world') }),
    location: { href: 'https://example.com/members' },
    TextEncoder, TextDecoder, URL,
  };
  sandbox.self = sandbox;
  const result = vm.runInNewContext(source, sandbox);
  assert.equal(result.url, 'https://example.com/members');
  assert.equal(result.captured.text, 'Hello signed-in world');
});
