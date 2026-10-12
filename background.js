'use strict';
// Service worker: the only part of the extension that talks to the Fuze API. Popup and options
// pages ask it through runtime messages, so a single in-flight token refresh covers every caller.
// Nothing important lives in worker memory (Chrome stops idle workers); state is in storage.

importScripts('lib/config.js', 'lib/messaging.js', 'lib/auth.js');

const { DEFAULT_API_BASE, isSaveableUrl, bookmarkLookupPath } = FuzeConfig;
const { classifySender, isActionAllowed } = FuzeMessaging;
const { createSession, AuthRequiredError } = FuzeAuth;

const EXTENSION_ORIGIN = chrome.runtime.getURL('').replace(/\/$/, '');
const ICON = 'icons/icon48.png';
const IMPORT_BATCH = 1000;
const IMPORT_STALE_MS = 3 * 60 * 1000;

// --- settings ---------------------------------------------------------------------------------

async function getSettings() {
  const s = await chrome.storage.local.get(['apiBaseOverride', 'autoSync', 'allowPreviews', 'allowLocalhost']);
  return {
    apiBase: s.apiBaseOverride || DEFAULT_API_BASE,
    customApi: Boolean(s.apiBaseOverride),
    autoSync: s.autoSync !== false,
    allowPreviews: Boolean(s.allowPreviews),
    allowLocalhost: Boolean(s.allowLocalhost),
  };
}

async function getApiBase() {
  return (await getSettings()).apiBase;
}

// --- session ----------------------------------------------------------------------------------

// The access token lives in session storage: memory only, gone when the browser closes, and not
// readable by content scripts. The refresh token must survive restarts, so it is in local storage.
const tokenStore = {
  async get() {
    const [{ accessToken }, { refreshToken, userId }] = await Promise.all([
      chrome.storage.session.get('accessToken'),
      chrome.storage.local.get(['refreshToken', 'userId']),
    ]);
    return { accessToken, refreshToken, userId };
  },
  async set({ accessToken, refreshToken, userId }) {
    // The rotated refresh token first: losing it would end the session, losing the access token
    // only costs a refresh.
    const local = {};
    if (refreshToken !== undefined) local.refreshToken = refreshToken;
    if (userId !== undefined) local.userId = userId;
    if (Object.keys(local).length) await chrome.storage.local.set(local);
    if (accessToken !== undefined) await chrome.storage.session.set({ accessToken });
  },
  async clear() {
    await chrome.storage.session.remove('accessToken');
    await chrome.storage.local.remove(['refreshToken', 'userId']);
  },
};

// Chrome can stop this worker while a refresh is in flight. The server then has already rotated
// the token, and keeps the new pair for 60 s for a client that asks again with the old one. This
// alarm wakes the worker after 30 s (Chrome's minimum) to ask again, so the session survives.
const REFRESH_RETRY_ALARM = 'fuze-refresh-retry';

const session = createSession({
  fetchImpl: (url, init) => fetch(url, init),
  store: tokenStore,
  getApiBase,
  onSignedOut: () => broadcast({ action: 'authChanged', signedIn: false }),
  onRefreshStart: () => chrome.alarms.create(REFRESH_RETRY_ALARM, { delayInMinutes: 0.5 }),
  onRefreshSettled: () => chrome.alarms.clear(REFRESH_RETRY_ALARM),
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== REFRESH_RETRY_ALARM) return;
  session.isSignedIn()
    .then((signedIn) => (signedIn ? session.refresh() : null))
    .catch(() => {}); // signed out or offline: the next API call handles it
});

// --- helpers ----------------------------------------------------------------------------------

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {}); // no extension page open
}

function notify(title, message) {
  chrome.notifications.create({ type: 'basic', iconUrl: ICON, title, message: String(message || '').slice(0, 250) });
}

function describeError(error) {
  if (error instanceof AuthRequiredError) return 'Sign in to Fuze from the extension or on the Fuze website.';
  if (error instanceof TypeError || error.name === 'TimeoutError') return 'Could not reach Fuze. Check your connection.';
  return error.message || 'Something went wrong';
}

function logError(context, error) {
  console.warn(`Fuze: ${context}: ${error && error.message ? error.message : error}`);
}

function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return [...new Set(list.map((t) => String(t).trim()).filter(Boolean))].slice(0, 50);
}

// Pages Chrome never lets extensions script.
const UNSCRIPTABLE_HOSTS = ['chromewebstore.google.com', 'chrome.google.com'];

/**
 * Read the rendered page in the tab being saved (lib/capture.js), so the server gets what the
 * user sees even behind a login or built by scripts. Needs the activeTab grant that the popup or
 * context menu click gives. Returns the `captured` payload, or undefined when unavailable.
 */
async function captureTab(tab) {
  const { capturePages } = await chrome.storage.local.get('capturePages');
  if (capturePages === false || !tab || !isSaveableUrl(tab.url)) return undefined;
  if (UNSCRIPTABLE_HOSTS.includes(new URL(tab.url).hostname)) return undefined;
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/capture.js'] });
    const page = injection && injection.result;
    // The tab may have navigated meanwhile; never attach another page's content.
    if (!page || page.url !== tab.url || !page.captured) return undefined;
    return page.captured;
  } catch (error) {
    logError('page capture', error); // PDF viewer, error pages, revoked grant: save without it
    return undefined;
  }
}

async function postBookmark(body) {
  return session.apiJson('/api/bookmarks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function saveBookmark({ url, title, description = '', tags = [], category, captured }) {
  const body = { url, title: String(title || '').slice(0, 500), description, tags: normalizeTags(tags) };
  if (category) body.category = category;
  if (captured) body.captured = captured;
  let data;
  try {
    data = await postBookmark(body);
  } catch (error) {
    // A capture the server won't take must not cost the bookmark: retry without it.
    if (!captured || (error.status !== 413 && error.status !== 400)) throw error;
    delete body.captured;
    data = await postBookmark(body);
  }
  return {
    bookmarkId: data.bookmark ? data.bookmark.id : null,
    wasDuplicate: Boolean(data.wasDuplicate),
    contentCaptured: Boolean(data.contentCaptured),
  };
}

// --- bulk import ------------------------------------------------------------------------------

async function getImportState() {
  const { importState } = await chrome.storage.session.get('importState');
  if (importState && importState.status === 'running' && Date.now() - importState.updatedAt > IMPORT_STALE_MS) {
    // The worker was stopped mid-import; the server finishes the batch it had.
    return { ...importState, status: 'interrupted' };
  }
  return importState || null;
}

async function setImportState(state) {
  await chrome.storage.session.set({ importState: { ...state, updatedAt: Date.now() } });
}

async function collectBookmarks() {
  const out = [];
  const walk = (node, folder) => {
    if (node.url && isSaveableUrl(node.url)) {
      out.push({ url: node.url, title: node.title || node.url, category: folder || 'Other' });
    }
    for (const child of node.children || []) walk(child, node.url ? folder : node.title || folder);
  };
  (await chrome.bookmarks.getTree()).forEach((root) => walk(root, 'Other'));
  return out;
}

async function runImport(batches, total) {
  const totals = { total, added: 0, skipped: 0, errors: 0 };
  try {
    for (let i = 0; i < batches.length; i += 1) {
      await setImportState({ status: 'running', batch: i + 1, batches: batches.length, ...totals });
      const data = await session.apiJson('/api/bookmarks/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batches[i]),
      });
      totals.added += data.added || 0;
      totals.skipped += data.skipped || 0;
      totals.errors += data.errors || 0;
    }
    await setImportState({ status: 'done', batch: batches.length, batches: batches.length, ...totals });
  } catch (error) {
    await setImportState({ status: 'failed', error: describeError(error), batches: batches.length, ...totals });
  }
}

// --- message handlers -------------------------------------------------------------------------

const handlers = {
  async getStatus({ verify }) {
    const settings = await getSettings();
    const status = { signedIn: await session.isSignedIn(), apiBase: settings.apiBase, settings };
    if (!status.signedIn || !verify) return status;
    try {
      const data = await session.apiJson('/api/auth/verify');
      const user = data.user || {};
      return { ...status, user: { username: user.username || '', email: user.email || '' } };
    } catch (error) {
      if (error instanceof AuthRequiredError) return { ...status, signedIn: false };
      return { ...status, offline: true };
    }
  },

  async signIn({ email, password }) {
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      throw new Error('Enter your email and password');
    }
    const user = await session.signInWithPassword(email.trim(), password);
    broadcast({ action: 'authChanged', signedIn: true });
    return { user: user ? { username: user.username || '', email: user.email || '' } : null };
  },

  async signOut() {
    await session.signOut();
    return { signedIn: false };
  },

  async saveTab({ tabId, title, description, tags }) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !isSaveableUrl(tab.url)) throw new Error('Only web pages can be saved');
    const captured = await captureTab(tab);
    return saveBookmark({ url: tab.url, title: title || tab.title, description, tags, captured });
  },

  async startImport({ limit }) {
    const current = await getImportState();
    if (current && current.status === 'running') return current;
    if (!(await session.isSignedIn())) throw new AuthRequiredError();
    let items = await collectBookmarks();
    if (Number.isInteger(limit) && limit > 0) items = items.slice(0, limit);
    const batches = [];
    for (let i = 0; i < items.length; i += IMPORT_BATCH) batches.push(items.slice(i, i + IMPORT_BATCH));
    await setImportState({ status: 'running', batch: 0, batches: batches.length, total: items.length, added: 0, skipped: 0, errors: 0 });
    runImport(batches, items.length); // continues in the background; pages poll importStatus
    return getImportState();
  },

  async importStatus() {
    const state = await getImportState();
    if (!state || state.status !== 'running') return state;
    try {
      const progress = await session.apiJson('/api/bookmarks/import/progress');
      return { ...state, server: { processed: progress.processed || 0, total: progress.total || 0 } };
    } catch (error) {
      return state;
    }
  },

  async countBookmarks() {
    return { count: (await collectBookmarks()).length };
  },

  // From the Fuze web app (bridge content script).
  async webSession({ refreshToken }) {
    if (typeof refreshToken !== 'string' || !refreshToken) return { result: 'ignored' };
    const result = await session.adoptWebSession(refreshToken);
    if (result === 'adopted') broadcast({ action: 'authChanged', signedIn: true });
    return { result };
  },

  async webSignedOut({ userId }) {
    // Only the account that signed out on the web is signed out here.
    const { userId: current } = await tokenStore.get();
    if (current && userId != null && String(userId) === current) await session.signOut();
    return {};
  },
};

// Every message is checked first: our own pages may use the features above, the Fuze web app
// (bridge content script, top frame) may only hand over or end a sign-in, anything else (other
// extensions, other sites, frames) is refused.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    if (!request || typeof request !== 'object') return { error: 'forbidden' };
    const { allowPreviews } = await getSettings();
    const kind = classifySender(sender, { runtimeId: chrome.runtime.id, extensionOrigin: EXTENSION_ORIGIN, allowPreviews });
    if (!isActionAllowed(request.action, kind) || !Object.prototype.hasOwnProperty.call(handlers, request.action)) {
      return { error: 'forbidden' };
    }
    return handlers[request.action](request);
  })().then(
    (result) => sendResponse(result === undefined ? {} : result),
    (error) => sendResponse({ error: describeError(error), authRequired: error instanceof AuthRequiredError }),
  );
  return true;
});

// --- context menu -----------------------------------------------------------------------------

chrome.contextMenus.onClicked.addListener((info, tab) => {
  (async () => {
    let url;
    let title;
    if (info.menuItemId === 'save-link') {
      url = info.linkUrl;
      title = info.selectionText || info.linkUrl;
    } else if (info.menuItemId === 'save-page') {
      url = info.pageUrl;
      title = tab && tab.title;
    } else {
      return;
    }
    if (!isSaveableUrl(url)) {
      notify('Fuze', 'Only web pages can be saved.');
      return;
    }
    // The page itself can be captured (the click granted activeTab); a link points elsewhere.
    const captured = info.menuItemId === 'save-page' && tab && tab.url === url ? await captureTab(tab) : undefined;
    const result = await saveBookmark({ url, title, captured });
    notify(result.wasDuplicate ? 'Already in Fuze (updated)' : 'Saved to Fuze', title || url);
  })().catch((error) => notify('Could not save to Fuze', describeError(error)));
});

// --- Chrome bookmark sync ---------------------------------------------------------------------

// Bookmarks imported from another browser arrive as a flood of onCreated events; skip those.
chrome.bookmarks.onImportBegan.addListener(() => chrome.storage.session.set({ chromeImporting: true }));
chrome.bookmarks.onImportEnded.addListener(() => chrome.storage.session.remove('chromeImporting'));

async function syncEnabled() {
  const [{ autoSync }, { chromeImporting }, signedIn] = await Promise.all([
    getSettings(), chrome.storage.session.get('chromeImporting'), session.isSignedIn(),
  ]);
  return autoSync && !chromeImporting && signedIn;
}

chrome.bookmarks.onCreated.addListener((id, node) => {
  (async () => {
    if (!node.url || !isSaveableUrl(node.url) || !(await syncEnabled())) return;
    let category;
    if (node.parentId) {
      const [parent] = await chrome.bookmarks.get(node.parentId);
      if (parent && parent.title) category = parent.title.toLowerCase().slice(0, 100);
    }
    const title = node.title || node.url;
    const result = await saveBookmark({ url: node.url, title, category });
    if (!result.wasDuplicate) notify('Saved to Fuze', title);
  })().catch((error) => notify('Could not save to Fuze', describeError(error)));
});

chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
  (async () => {
    const node = removeInfo && removeInfo.node;
    if (!node || !node.url || !isSaveableUrl(node.url) || !(await syncEnabled())) return;
    // Another Chrome bookmark still points at this page: keep it in Fuze.
    if ((await chrome.bookmarks.search({ url: node.url })).length) return;

    const lookup = await session.apiFetch(bookmarkLookupPath(node.url));
    if (lookup.status === 404) return; // never saved to Fuze, or already removed there
    if (!lookup.ok) throw new Error(`Lookup failed (HTTP ${lookup.status})`);
    const { bookmark } = await lookup.json();
    const res = await session.apiFetch(`/api/bookmarks/${encodeURIComponent(bookmark.id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Delete failed (HTTP ${res.status})`);
    notify('Removed from Fuze', node.title || node.url);
  })().catch((error) => notify('Could not remove from Fuze', describeError(error)));
});

// --- sign-in bridge on previews / local dev servers -------------------------------------------

// Opt-in from the options page, which asks for the host permission. Keep the registered scripts
// in step with those settings and with permissions the user may revoke in chrome://extensions.
const BRIDGE_FILES = ['lib/config.js', 'content/fuze-bridge.js'];

async function syncBridgeRegistrations() {
  const { allowPreviews, allowLocalhost } = await getSettings();
  const wanted = [];
  if (allowPreviews && await chrome.permissions.contains({ origins: [FuzeConfig.PREVIEW_PERMISSION] })) {
    wanted.push({ id: 'fuze-bridge-previews', matches: [FuzeConfig.PREVIEW_PERMISSION] });
  }
  if (FuzeConfig.DEV_BUILD && allowLocalhost && await chrome.permissions.contains({ origins: FuzeConfig.DEV_PERMISSIONS })) {
    wanted.push({ id: 'fuze-bridge-dev', matches: FuzeConfig.DEV_PERMISSIONS });
  }
  const existing = (await chrome.scripting.getRegisteredContentScripts())
    .filter((script) => script.id.startsWith('fuze-bridge-'));
  const stale = existing.filter((script) => !wanted.some((w) => w.id === script.id)).map((script) => script.id);
  if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale });
  const missing = wanted.filter((w) => !existing.some((script) => script.id === w.id));
  if (missing.length) {
    await chrome.scripting.registerContentScripts(missing.map((w) => ({
      ...w, js: BRIDGE_FILES, runAt: 'document_idle', allFrames: false, persistAcrossSessions: true,
    })));
  }
}

function resyncBridges() {
  syncBridgeRegistrations().catch((error) => logError('bridge registration', error));
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('allowPreviews' in changes || 'allowLocalhost' in changes) resyncBridges();
  if ('apiBaseOverride' in changes) {
    // A session belongs to the server that issued it.
    tokenStore.clear().then(() => broadcast({ action: 'authChanged', signedIn: false }));
  }
});
chrome.permissions.onAdded.addListener(resyncBridges);
chrome.permissions.onRemoved.addListener(resyncBridges);

// --- install / update -------------------------------------------------------------------------

async function migrateLegacySettings() {
  // 1.0 kept only an access token, which can't be refreshed. The next visit to the Fuze website
  // (or a sign-in from the options page) starts a proper session.
  await chrome.storage.local.remove('authToken');
  // 1.0 stored `apiUrl` and wrote the default into it on first run. Keep it only when the user
  // had pointed the extension at another server, as the new override setting.
  const { apiUrl } = await chrome.storage.local.get('apiUrl');
  if (apiUrl === undefined) return;
  await chrome.storage.local.remove('apiUrl');
  let base;
  try {
    base = FuzeConfig.normalizeApiBase(apiUrl);
  } catch (e) {
    return;
  }
  if (base !== DEFAULT_API_BASE && await chrome.permissions.contains({ origins: [FuzeConfig.originPermission(base)] })) {
    await chrome.storage.local.set({ apiBaseOverride: base });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  migrateLegacySettings().catch((error) => logError('settings migration', error));
  resyncBridges();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'save-page', title: 'Save page to Fuze', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'save-link', title: 'Save link to Fuze', contexts: ['link'] });
  });
});
