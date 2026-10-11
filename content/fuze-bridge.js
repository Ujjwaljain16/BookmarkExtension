// Runs on the Fuze web app only. Tells the extension when the user signs in or out there, so
// signing in once is enough. It listens to nothing and only ever messages the extension itself.
(function () {
  'use strict';

  const config = self.FuzeConfig;
  if (!config || window.top !== window) return;
  // The bridge may be registered for broader patterns (*.vercel.app for previews); act only on
  // the app itself. The service worker checks the sender's origin again.
  if (!config.isFuzeWebOrigin(location.origin, { devBuild: config.DEV_BUILD, allowPreviews: true })) return;

  const POLL_MS = 3000;
  let lastKey = null; // what was last reported: '' = signed out, else the token it was reported with
  let timer = null;

  // The web app keeps its session in localStorage['user'] ({access_token|token, refresh_token, ...}).
  function readSession() {
    try {
      const user = JSON.parse(localStorage.getItem('user') || 'null');
      if (!user || typeof user !== 'object') return null;
      const access = user.access_token || user.token;
      const session = {
        accessToken: typeof access === 'string' ? access : null,
        refreshToken: typeof user.refresh_token === 'string' ? user.refresh_token : null,
      };
      return session.accessToken || session.refreshToken ? session : null;
    } catch (e) {
      return null;
    }
  }

  function stop() {
    clearInterval(timer);
    window.removeEventListener('storage', onStorage);
    document.removeEventListener('visibilitychange', onVisible);
  }

  function send(message) {
    try {
      // runtime.id disappears when the extension is reloaded or removed under a live page.
      if (!chrome.runtime || !chrome.runtime.id) return stop();
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch (e) {
      stop();
    }
  }

  function check() {
    const session = readSession();
    const key = session ? session.refreshToken || session.accessToken : '';
    if (key === lastKey) return;
    const previous = lastKey;
    lastKey = key;
    if (session) send({ action: 'webSession', ...session });
    // Only a sign-out seen on this page counts; a page that was never signed in says nothing.
    else if (previous) send({ action: 'webSignedOut' });
  }

  // A content script runs in an isolated world: wrapping localStorage.setItem here would never
  // see the page's own calls. Same-tab changes are caught by polling, other tabs by 'storage'.
  function onStorage(event) {
    if (event.key === null || event.key === 'user') check();
  }
  function onVisible() {
    if (!document.hidden) check();
  }

  window.addEventListener('storage', onStorage);
  document.addEventListener('visibilitychange', onVisible);
  timer = setInterval(() => {
    if (!document.hidden) check();
  }, POLL_MS);
  check();
})();
