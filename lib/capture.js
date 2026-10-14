// Page capture: reads the rendered page the user is saving (signed in, after scripts ran) so the
// server doesn't have to fetch it. Injected on demand with chrome.scripting.executeScript into
// the tab being saved (activeTab); the value of the last expression is the result. Node tests
// require() it for the pure helpers.
(function (root) {
  'use strict';

  // The server refuses text over 500,000 and HTML over 1,000,000 UTF-8 bytes; stay below both.
  const MAX_TEXT_BYTES = 490000;
  const MAX_HTML_BYTES = 900000;
  const MAIN_SELECTORS = ['article', 'main', '[role="main"]', '[itemprop="articleBody"]', '.entry-content', '.post-content', '#content'];
  const DROP_ELEMENTS = 'script, style, noscript, template, iframe, object, embed, form, input, textarea, select, button, svg, canvas, video, audio, link, meta';
  const KEEP_ATTRIBUTES = new Set(['href', 'src', 'alt', 'title', 'lang', 'datetime', 'colspan', 'rowspan', 'class', 'id', 'role', 'itemprop']);
  const LANG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;
  // Pages that publish the item itself as structured data (schema.org JSON-LD). A social post is the page's
  // reason to exist; the rest of its text is replies, reactions and interface.
  const SOCIAL_POST_TYPES = ['SocialMediaPosting'];
  const ARTICLE_TYPES = ['Article', 'NewsArticle', 'BlogPosting'];
  const MIN_POST_CHARS = 30;
  // An article's articleBody is sometimes only an excerpt: use it only when it is nearly as long as the page's text.
  const MIN_ARTICLE_SHARE = 0.8;

  function utf8Length(text) {
    return new TextEncoder().encode(text).length;
  }

  /** Cut to at most maxBytes of UTF-8 without splitting a character. */
  function truncateToBytes(text, maxBytes) {
    const bytes = new TextEncoder().encode(text);
    if (bytes.length <= maxBytes) return text;
    return new TextDecoder().decode(bytes.slice(0, maxBytes)).replace(/�+$/, '');
  }

  function cleanText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function wordCount(text) {
    return text ? text.split(/\s+/).filter(Boolean).length : 0;
  }

  function resolveCanonical(href, pageUrl) {
    if (!href) return null;
    try {
      const url = new URL(href, pageUrl);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch (e) {
      return null;
    }
  }

  function normalizeLang(lang) {
    const value = String(lang || '').trim().replace(/_/g, '-');
    return LANG.test(value) ? value : null;
  }

  /**
   * Pick the main content among candidates [{text, linkChars, el}]: the one with the most words
   * that still holds a real share of the page and isn't mostly links (a nav or a list of links).
   * Falls back to the whole body.
   */
  function chooseMain(candidates, bodyText) {
    const bodyWords = wordCount(bodyText);
    let best = null;
    for (const c of candidates) {
      const words = wordCount(c.text);
      if (!words || words < 0.25 * bodyWords) continue;
      if (c.text.length && c.linkChars / c.text.length > 0.5) continue;
      if (!best || words > best.words) best = { ...c, words };
    }
    return best || { text: bodyText, el: null };
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  /** The page's title, descriptive meta tags and JSON-LD, as head markup. */
  function buildHead(doc) {
    const head = [`<title>${escapeHtml(doc.title || '')}</title>`];
    doc.querySelectorAll('meta[name="description"], meta[name="author"], meta[property^="og:"], meta[name^="twitter:"], meta[property^="article:"]')
      .forEach((meta) => head.push(meta.outerHTML));
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      const json = (script.textContent || '').slice(0, 50000).replace(/<\/script/gi, '<\\/script');
      head.push(`<script type="application/ld+json">${json}</script>`);
    });
    return head;
  }

  /**
   * The text of the item a page publishes as structured data, or null. {body, social}: `social` is true for a
   * social post, whose body is the post alone (no replies, no interface).
   */
  function structuredPost(doc) {
    let article = null;
    for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
      let data;
      try {
        data = JSON.parse(script.textContent || '');
      } catch (e) {
        continue;
      }
      const items = Array.isArray(data) ? data : (data && Array.isArray(data['@graph']) ? data['@graph'] : [data]);
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const types = [].concat(item['@type'] || []);
        const body = cleanText(item.articleBody);
        if (body.length < MIN_POST_CHARS) continue;
        if (types.some((t) => SOCIAL_POST_TYPES.includes(t))) return { body, social: true, headline: cleanText(item.headline) };
        if (!article && types.some((t) => ARTICLE_TYPES.includes(t))) article = { body, social: false, headline: '' };
      }
    }
    return article;
  }

  /**
   * The title of a social post: its topic, not the tab's. A LinkedIn tab says "Post | LinkedIn" while og:title reads
   * "Topic | Author posted on the topic | LinkedIn", so the part before the first " | " is the useful one; the post's
   * own headline is the fallback. '' when there is nothing better than the tab's title.
   */
  function postTitle(doc, post) {
    const meta = doc.querySelector && doc.querySelector('meta[property="og:title"]');
    const og = meta && meta.getAttribute ? cleanText(meta.getAttribute('content')) : '';
    const topic = og.split(' | ')[0].trim();
    return (topic || (post && post.headline) || '').slice(0, 500);
  }

  /** Head metadata plus the post's text alone, for a page whose item is published as structured data. */
  function buildPostHtml(doc, body) {
    const paragraphs = body.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
    const lang = normalizeLang(doc.documentElement && doc.documentElement.lang);
    const html = `<!DOCTYPE html><html${lang ? ` lang="${lang}"` : ''}><head>${buildHead(doc).join('')}</head><body><article>${paragraphs}</article></body></html>`;
    return utf8Length(html) <= MAX_HTML_BYTES ? html : undefined;
  }

  /** Head metadata plus a cleaned copy of the main element; omitted when too large. */
  function buildHtml(doc, el) {
    const head = buildHead(doc);

    const clone = el.cloneNode(true);
    clone.querySelectorAll(DROP_ELEMENTS).forEach((node) => node.remove());
    const nodes = [clone, ...clone.querySelectorAll('*')].slice(0, 20000);
    for (const node of nodes) {
      for (const attr of Array.from(node.attributes || [])) {
        const value = attr.value.trim().toLowerCase();
        if (!KEEP_ATTRIBUTES.has(attr.name) || value.startsWith('javascript:') || value.startsWith('data:')) {
          node.removeAttribute(attr.name);
        }
      }
    }
    const lang = normalizeLang(doc.documentElement && doc.documentElement.lang);
    const html = `<!DOCTYPE html><html${lang ? ` lang="${lang}"` : ''}><head>${head.join('')}</head><body>${clone.outerHTML}</body></html>`;
    return utf8Length(html) <= MAX_HTML_BYTES ? html : undefined;
  }

  /** The `captured` payload for POST /api/bookmarks, or null when the page has no body. */
  function capturePage(doc, loc) {
    const body = doc.body;
    if (!body) return null;
    const bodyText = cleanText(body.innerText || body.textContent || '');
    const candidates = [];
    for (const selector of MAIN_SELECTORS) {
      Array.from(doc.querySelectorAll(selector)).slice(0, 5).forEach((el) => {
        const text = cleanText(el.innerText || el.textContent || '');
        const linkChars = Array.from(el.querySelectorAll('a')).slice(0, 500)
          .reduce((sum, a) => sum + (a.innerText || a.textContent || '').length, 0);
        candidates.push({ text, linkChars, el });
      });
    }
    const main = chooseMain(candidates, bodyText);
    let text = main.text;
    let html;
    let pageTitle = doc.title || '';
    // A post the page publishes as structured data (a LinkedIn post, say) is sent as that post alone; the
    // page's own text also holds the replies and the interface. An article's body is used only when it is
    // not just an excerpt.
    let post = null;
    try {
      post = structuredPost(doc);
    } catch (e) {
      post = null;
    }
    if (post && (post.social || wordCount(post.body) >= MIN_ARTICLE_SHARE * wordCount(main.text))) {
      text = post.body;
      if (post.social) pageTitle = postTitle(doc, post) || pageTitle;
      try {
        html = buildPostHtml(doc, post.body);
      } catch (e) {
        html = undefined;
      }
    } else {
      try {
        html = buildHtml(doc, main.el || body);
      } catch (e) {
        html = undefined; // the text alone is enough
      }
    }
    const canonical = doc.querySelector('link[rel~="canonical"]');
    const captured = {
      text: truncateToBytes(text, MAX_TEXT_BYTES),
      canonical_url: resolveCanonical(canonical && canonical.getAttribute('href'), loc.href),
      lang: normalizeLang(doc.documentElement && doc.documentElement.lang),
    };
    if (html) captured.html = html;
    if (!captured.text && !captured.html) return null;
    return { url: loc.href, title: pageTitle, captured };
  }

  const api = { MAX_TEXT_BYTES, MAX_HTML_BYTES, utf8Length, truncateToBytes, cleanText, resolveCanonical, normalizeLang, chooseMain, structuredPost, postTitle, capturePage };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return undefined;
  }
  try {
    return capturePage(root.document, root.location);
  } catch (e) {
    return null;
  }
})(typeof self !== 'undefined' ? self : globalThis);
