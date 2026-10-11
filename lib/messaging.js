// Who sent a runtime message, and what that sender may ask for.
(function (root, factory) {
  const api = factory(root.FuzeConfig || (typeof require === 'function' ? require('./config.js') : undefined));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FuzeMessaging = api;
})(typeof self !== 'undefined' ? self : globalThis, function (config) {
  'use strict';

  // The only messages a web page (through the bridge content script) may send.
  const WEB_ACTIONS = new Set(['webSession', 'webSignedOut']);

  function originOf(url) {
    try {
      return new URL(url).origin;
    } catch (e) {
      return null;
    }
  }

  /**
   * Classify a runtime.onMessage sender:
   *   'extension' - one of our own pages (popup, options); never a content script
   *   'fuze-web'  - our bridge content script, in the top frame of a Fuze web app page
   *   null        - anything else; the message must be ignored
   */
  function classifySender(sender, { runtimeId, extensionOrigin, devBuild = config.DEV_BUILD, allowPreviews = false }) {
    if (!sender || !runtimeId || sender.id !== runtimeId) return null;
    if (!sender.tab) {
      const url = typeof sender.url === 'string' ? sender.url : '';
      return extensionOrigin && url.startsWith(extensionOrigin + '/') ? 'extension' : null;
    }
    if (sender.frameId !== 0) return null;
    const origin = sender.origin || originOf(sender.url);
    return config.isFuzeWebOrigin(origin, { devBuild, allowPreviews }) ? 'fuze-web' : null;
  }

  /** Web pages may only hand over or end a sign-in; everything else is for extension pages. */
  function isActionAllowed(action, kind) {
    if (typeof action !== 'string') return false;
    if (kind === 'fuze-web') return WEB_ACTIONS.has(action);
    return kind === 'extension' && !WEB_ACTIONS.has(action);
  }

  return { classifySender, isActionAllowed, originOf, WEB_ACTIONS };
});
