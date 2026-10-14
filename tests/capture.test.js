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

// ---- pages that publish their item as structured data (a LinkedIn post, an article with an articleBody) ----

const ld = (data) => ({ textContent: JSON.stringify(data) });
const postData = (body, type = 'SocialMediaPosting') => ({ '@context': 'http://schema.org', '@type': type, headline: 'Sample post', articleBody: body });
const LD = 'script[type="application/ld+json"]';

test('a social post is captured as the post alone, not the replies and interface around it', () => {
  const post = `Sample post about a graph problem.\n\n${words(60, 'p')}`;
  const noisy = `${post}\nLike Comment Share\n${words(300, 'reply')}`;
  const doc = fakeDoc({ body: el(noisy), title: 'Graph problem | Jane Doe posted on the topic | LinkedIn',
    parts: { main: [el(noisy)], [LD]: [ld(postData(post))] } });
  const page = capture.capturePage(doc, { href: 'https://www.linkedin.com/posts/jane-doe_x' });
  assert.equal(page.captured.text, capture.cleanText(post));
  assert.ok(!page.captured.text.includes('reply0'));
  assert.ok(!page.captured.text.includes('Like Comment Share'));
});

test('the post html carries the metadata and only the post text', () => {
  const post = `First paragraph.\n\nSecond <paragraph> & more text here, long enough to count.`;
  const doc = fakeDoc({ body: el(`${post}\nnoise`), parts: { [LD]: [ld(postData(post))] } });
  const { html } = capture.capturePage(doc, { href: 'https://example.com/p' }).captured;
  assert.match(html, /application\/ld\+json/);                       // author, date and so on still reach the server
  assert.match(html, /<article><p>First paragraph\.<\/p><p>Second &lt;paragraph> &amp; more text here/);
  assert.ok(!html.includes('noise'));
});

test('an article body is used when it is nearly as long as the page, not when it is an excerpt', () => {
  const full = words(400, 'a');
  const doc = (articleBody) => fakeDoc({ body: el(full), parts: { article: [el(full)], [LD]: [ld(postData(articleBody, 'Article'))] } });
  const kept = capture.capturePage(doc(words(380, 'a')), { href: 'https://example.com/a' }).captured.text;
  assert.equal(kept, words(380, 'a'));
  const excerpt = capture.capturePage(doc(words(60, 'a')), { href: 'https://example.com/a' }).captured.text;
  assert.equal(excerpt, full);                                       // an excerpt must not replace the real article
});

test('structuredPost reads a list, a @graph and an array of types, and skips bad or short data', () => {
  const body = words(20, 'x');
  const find = (scripts) => capture.structuredPost(fakeDoc({ body: el('x'), parts: { [LD]: scripts } }));
  assert.equal(find([ld([{ '@type': 'Organization' }, postData(body)])]).body, body);
  assert.equal(find([ld({ '@graph': [postData(body)] })]).social, true);
  assert.equal(find([ld({ '@type': ['Thing', 'SocialMediaPosting'], articleBody: body })]).social, true);
  assert.equal(find([{ textContent: '{not json' }, ld(postData(body))]).body, body);   // a bad block is skipped
  assert.equal(find([ld(postData('too short'))]), null);
  assert.equal(find([ld({ '@type': 'Product', articleBody: body })]), null);
  assert.equal(find([]), null);
});

test('a social post wins over an article in the same page', () => {
  const body = words(20, 'x');
  const doc = fakeDoc({ body: el('x'), parts: { [LD]: [ld(postData(words(25, 'article'), 'Article')), ld(postData(body))] } });
  assert.equal(capture.structuredPost(doc).social, true);
});

test('a page without structured data is captured exactly as before', () => {
  const article = words(400, 'a');
  const doc = fakeDoc({ body: el(article), parts: { article: [el(article)] } });
  assert.equal(capture.capturePage(doc, { href: 'https://example.com/x' }).captured.text, article);
});
