// Which title a saved page gets. Pure, so the service worker and the Node tests share it.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FuzeTitles = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /**
   * `chosen` is what the save was asked to use (the popup's title field, prefilled with the tab's title),
   * `tabTitle` the browser's title for the tab, `captureTitle` what the page capture found, or null.
   *
   * The user's own edit always wins. A title that is just the tab's (the prefilled default, or none at all) is
   * replaced by the capture's when the page publishes a better one: a LinkedIn post's tab says "Post | LinkedIn",
   * while the page itself knows its topic.
   */
  function pickTitle(chosen, tabTitle, captureTitle) {
    const picked = String(chosen || '').trim();
    const tab = String(tabTitle || '').trim();
    const found = String(captureTitle || '').trim();
    if (!found) return picked || tab;
    if (!picked || picked === tab) return found;
    return picked;
  }

  return { pickTitle };
});
