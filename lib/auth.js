// Session handling: the access/refresh token pair, refresh with rotation, and authenticated calls.
// Runs in the service worker only, so one in-flight refresh is shared by every caller. Two
// refreshes racing with the same refresh token would look like token theft to the server
// (a rotated token used twice) and it would end the session.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FuzeAuth = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const REQUEST_TIMEOUT_MS = 30000;

  /** The user has to sign in (again): there is no session, or the server ended it. */
  class AuthRequiredError extends Error {
    constructor(message = 'Sign in to Fuze') {
      super(message);
      this.name = 'AuthRequiredError';
    }
  }

  /** Read a JWT's claims without verifying it (only used to compare which user a token is for). */
  function decodeJwtPayload(token) {
    try {
      const part = String(token).split('.')[1];
      if (!part) return null;
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
      const json = decodeURIComponent(Array.from(atob(b64), (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
      const payload = JSON.parse(json);
      return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    } catch (e) {
      return null;
    }
  }

  function withTimeout(init = {}) {
    if (init.signal || typeof AbortSignal === 'undefined' || !AbortSignal.timeout) return init;
    return { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
  }

  /**
   * @param {object} deps
   * @param {Function} deps.fetchImpl       fetch(url, init)
   * @param {object}   deps.store           { get(): {accessToken, refreshToken, userId}, set(partial), clear() }
   * @param {Function} deps.getApiBase      async () => 'https://api...'
   * @param {Function} [deps.onSignedOut]   called after the session was cleared
   * @param {Function} [deps.onRefreshStart]   called before a refresh request is sent
   * @param {Function} [deps.onRefreshSettled] called once that refresh succeeded or failed
   */
  function createSession({
    fetchImpl, store, getApiBase, onSignedOut = () => {},
    onRefreshStart = () => {}, onRefreshSettled = () => {},
  }) {
    let refreshing = null;
    let adopting = null;

    async function post(path, { token, body } = {}) {
      const headers = { Accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      return fetchImpl((await getApiBase()) + path, withTimeout({
        method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body),
      }));
    }

    async function clear() {
      await store.clear();
      onSignedOut();
    }

    async function saveTokens(data) {
      if (!data || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') {
        throw new Error('The server returned no tokens');
      }
      const update = { accessToken: data.access_token, refreshToken: data.refresh_token };
      const sub = decodeJwtPayload(data.access_token)?.sub;
      if (data.user && data.user.id != null) update.userId = String(data.user.id);
      else if (sub != null) update.userId = String(sub);
      await store.set(update);
      return update.accessToken;
    }

    /**
     * Exchange the refresh token for a new pair (the old refresh token is spent). Concurrent
     * callers share one request. A rejected refresh token ends the session; a network error or a
     * server error keeps it, since the token may still be good.
     */
    function refresh() {
      if (refreshing) return refreshing;
      refreshing = (async () => {
        try {
          const { refreshToken } = await store.get();
          if (!refreshToken) {
            await clear();
            throw new AuthRequiredError();
          }
          // If the worker is stopped before the new pair is stored, the server still holds that
          // pair for a short grace window; onRefreshStart lets the host schedule a wake-up retry.
          try { await onRefreshStart(); } catch (e) { /* best effort */ }
          const res = await post('/api/auth/refresh', { token: refreshToken });
          if (res.status === 401 || res.status === 403 || res.status === 422) {
            await clear();
            throw new AuthRequiredError('Your Fuze session ended. Sign in again.');
          }
          if (!res.ok) throw new Error(`Could not refresh the session (HTTP ${res.status})`);
          const data = await res.json();
          // Signed out, or signed in as someone else, while this was in flight: don't resurrect it.
          if ((await store.get()).refreshToken !== refreshToken) throw new AuthRequiredError();
          return await saveTokens(data);
        } finally {
          refreshing = null;
          try { await onRefreshSettled(); } catch (e) { /* best effort */ }
        }
      })();
      return refreshing;
    }

    /** fetch() against the API with the access token, refreshing once on a 401. */
    async function apiFetch(path, init = {}) {
      const base = await getApiBase();
      const call = (token) => fetchImpl(base + path, withTimeout({
        ...init,
        headers: { Accept: 'application/json', ...(init.headers || {}), Authorization: `Bearer ${token}` },
      }));

      let { accessToken, refreshToken } = await store.get();
      if (!accessToken && !refreshToken) throw new AuthRequiredError();
      // After a browser restart the access token (session storage) is gone; the refresh token isn't.
      if (!accessToken) accessToken = await refresh();

      let res = await call(accessToken);
      if (res.status !== 401) return res;

      // Someone else may have refreshed while this request was in flight: use their token.
      const current = (await store.get()).accessToken;
      const token = current && current !== accessToken ? current : await refresh();
      res = await call(token);
      if (res.status === 401) {
        await clear();
        throw new AuthRequiredError();
      }
      return res;
    }

    async function apiJson(path, init = {}) {
      const res = await apiFetch(path, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = new Error(data.message || data.error || `Request failed (HTTP ${res.status})`);
        error.status = res.status;
        throw error;
      }
      return data;
    }

    async function isSignedIn() {
      const { refreshToken } = await store.get();
      return Boolean(refreshToken);
    }

    async function signInWithPassword(email, password) {
      const res = await post('/api/auth/login', { body: { email, password } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Sign-in failed (HTTP ${res.status})`);
      await store.clear();
      await saveTokens(data);
      return data.user || null;
    }

    /**
     * The web app is signed in: start a session of our own from its refresh token. The web app's
     * token is not kept; sharing it would make the two clients rotate each other's token away.
     * Nothing happens when the extension already has a session for the same user.
     */
    function adoptWebSession(webRefreshToken) {
      if (adopting) return adopting;
      adopting = (async () => {
        try {
          const sub = decodeJwtPayload(webRefreshToken)?.sub;
          if (sub == null) return 'ignored';
          const current = await store.get();
          if (current.refreshToken && current.userId === String(sub)) return 'unchanged';
          let data;
          try {
            const res = await post('/api/auth/fork-session', { token: webRefreshToken });
            // The web session is no longer valid: only signing in on the website again helps.
            if (res.status === 401 || res.status === 403 || res.status === 422) return 'rejected';
            // Anything else (server down, paused, 5xx, a proxy's HTML page) may pass on its own.
            if (!res.ok) return 'unreachable';
            data = await res.json();
          } catch (e) {
            return 'unreachable';
          }
          await store.clear();
          await saveTokens(data);
          return 'adopted';
        } finally {
          adopting = null;
        }
      })();
      return adopting;
    }

    /** End the session here and, best effort, on the server (which revokes its token family). */
    async function signOut() {
      try {
        if (await isSignedIn()) await apiFetch('/api/auth/logout', { method: 'POST' });
      } catch (e) {
        // Offline or already ended: the tokens are dropped anyway and expire on their own.
      }
      await clear();
    }

    return { refresh, apiFetch, apiJson, isSignedIn, signInWithPassword, adoptWebSession, signOut };
  }

  return { createSession, decodeJwtPayload, AuthRequiredError };
});
