// Shared configuration: the one place that knows the Fuze API and web app addresses.
// Loaded by the service worker (importScripts), extension pages (<script>) and Node tests (require).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FuzeConfig = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // Dev builds also accept the local dev servers (http://localhost, http://127.0.0.1).
  // Release builds never do: any process on the user's machine can listen there.
  const DEV_BUILD = false;

  const DEFAULT_API_BASE = 'https://ujjwaljain16-fuze-backend.hf.space';
  const FUZE_WEB_ORIGIN = 'https://itsfuze.vercel.app';
  const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

  function isLocalHost(hostname) {
    return LOCAL_HOSTS.includes(hostname);
  }

  /**
   * Validate an API base URL typed by the user and reduce it to an origin
   * ("https://host[:port]"). Throws an Error with a user-facing message when it isn't usable.
   */
  function normalizeApiBase(input, { devBuild = DEV_BUILD } = {}) {
    const raw = String(input || '').trim();
    let url;
    try {
      url = new URL(raw);
    } catch (e) {
      throw new Error('Enter a full URL, for example https://api.example.com');
    }
    if (url.username || url.password) throw new Error('The URL must not contain a user name or password');
    const local = isLocalHost(url.hostname);
    if (url.protocol === 'http:') {
      if (!(devBuild && local)) throw new Error('The API URL must use https://');
    } else if (url.protocol !== 'https:') {
      throw new Error('The API URL must use https://');
    }
    if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
      throw new Error("Use the server's address only, without a path (for example https://api.example.com)");
    }
    return url.origin;
  }

  /** The match pattern chrome.permissions needs to call this API origin. */
  function originPermission(apiBase) {
    return new URL(apiBase).origin + '/*';
  }

  /** Whether a page can be saved at all: only web pages, not browser or extension pages. */
  function isSaveableUrl(url) {
    try {
      const { protocol } = new URL(url);
      return protocol === 'http:' || protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  /**
   * Path of the exact-URL lookup. The URL is sent exactly as Chrome stored it: URLs that differ
   * only in case are different resources (paths and queries are case-sensitive).
   */
  function bookmarkLookupPath(url) {
    return '/api/bookmarks/lookup?url=' + encodeURIComponent(url);
  }

  return {
    DEV_BUILD,
    DEFAULT_API_BASE,
    FUZE_WEB_ORIGIN,
    isLocalHost,
    normalizeApiBase,
    originPermission,
    isSaveableUrl,
    bookmarkLookupPath,
  };
});
