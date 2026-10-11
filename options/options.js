'use strict';

const { DEFAULT_API_BASE, normalizeApiBase, originPermission } = FuzeConfig;

const apiInput = document.getElementById('api-base');
const apiStatus = document.getElementById('api-status');

function showApiStatus(message, isError = false) {
  apiStatus.textContent = message;
  apiStatus.classList.toggle('error', isError);
}

async function loadApiBase() {
  document.getElementById('default-api').textContent = DEFAULT_API_BASE;
  apiInput.placeholder = DEFAULT_API_BASE;
  const { apiBaseOverride } = await chrome.storage.local.get('apiBaseOverride');
  apiInput.value = apiBaseOverride || '';
}

// A session belongs to the server that issued it; the service worker signs out when this changes.
async function switchApiBase(override) {
  const { apiBaseOverride } = await chrome.storage.local.get('apiBaseOverride');
  if ((apiBaseOverride || null) === (override || null)) return false;
  if (override) await chrome.storage.local.set({ apiBaseOverride: override });
  else await chrome.storage.local.remove('apiBaseOverride');
  if (apiBaseOverride) {
    await chrome.permissions.remove({ origins: [originPermission(apiBaseOverride)] }).catch(() => {});
  }
  return true;
}

document.getElementById('save-api').addEventListener('click', async () => {
  const raw = apiInput.value.trim();
  if (!raw) {
    document.getElementById('reset-api').click();
    return;
  }
  let base;
  try {
    base = normalizeApiBase(raw);
  } catch (e) {
    showApiStatus(e.message, true);
    return;
  }
  if (base === DEFAULT_API_BASE) {
    document.getElementById('reset-api').click();
    return;
  }
  // Must run inside the click handler: Chrome only shows the permission prompt for a user gesture.
  const granted = await chrome.permissions.request({ origins: [originPermission(base)] });
  if (!granted) {
    showApiStatus('Permission to reach that server was not granted; nothing changed.', true);
    return;
  }
  apiInput.value = base;
  const changed = await switchApiBase(base);
  showApiStatus(changed ? `Using ${base}. Sign in again.` : `Already using ${base}.`);
});

document.getElementById('reset-api').addEventListener('click', async () => {
  apiInput.value = '';
  const changed = await switchApiBase(null);
  showApiStatus(changed ? 'Using Fuze. Sign in again.' : 'Already using Fuze.');
});

// --- signing in from preview deployments and local dev servers ---

const webStatus = document.getElementById('web-status');

async function loadWebOrigins() {
  document.getElementById('web-origin').textContent = FuzeConfig.FUZE_WEB_ORIGIN;
  document.getElementById('localhost-row').hidden = !FuzeConfig.DEV_BUILD;
  const { allowPreviews, allowLocalhost } = await chrome.storage.local.get(['allowPreviews', 'allowLocalhost']);
  document.getElementById('allow-previews').checked = !!allowPreviews;
  document.getElementById('allow-localhost').checked = !!allowLocalhost;
}

// The service worker registers or removes the bridge when these settings change.
function bindOriginToggle(id, key, origins) {
  const box = document.getElementById(id);
  box.addEventListener('change', async () => {
    webStatus.textContent = '';
    if (box.checked) {
      const granted = await chrome.permissions.request({ origins });
      if (!granted) {
        box.checked = false;
        webStatus.textContent = 'Permission not granted.';
        return;
      }
      await chrome.storage.local.set({ [key]: true });
    } else {
      await chrome.storage.local.set({ [key]: false });
      await chrome.permissions.remove({ origins }).catch(() => {});
    }
  });
}

bindOriginToggle('allow-previews', 'allowPreviews', [FuzeConfig.PREVIEW_PERMISSION]);
bindOriginToggle('allow-localhost', 'allowLocalhost', FuzeConfig.DEV_PERMISSIONS);

// --- account (all API calls go through the service worker) ---

const send = (message) => chrome.runtime.sendMessage(message);
const accountMsg = document.getElementById('account-msg');

async function loadAccount() {
  const status = await send({ action: 'getStatus', verify: true });
  const who = status.user && (status.user.username || status.user.email);
  document.getElementById('account-status').textContent = status.signedIn
    ? `Signed in${who ? ' as ' + who : ''}${status.offline ? ' (server unreachable)' : ''}.`
    : 'Not signed in.';
  document.getElementById('signin-form').hidden = Boolean(status.signedIn);
  document.getElementById('signout-row').hidden = !status.signedIn;
  document.getElementById('auto-sync').checked = status.settings.autoSync;
}

document.getElementById('signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = document.getElementById('signin-btn');
  button.disabled = true;
  accountMsg.textContent = '';
  try {
    const result = await send({
      action: 'signIn',
      email: document.getElementById('email').value,
      password: document.getElementById('password').value,
    });
    accountMsg.textContent = result.error || '';
    accountMsg.classList.toggle('error', Boolean(result.error));
  } finally {
    document.getElementById('password').value = '';
    button.disabled = false;
    loadAccount();
  }
});

document.getElementById('signout-btn').addEventListener('click', async () => {
  await send({ action: 'signOut' });
  loadAccount();
});

chrome.storage.local.get('capturePages').then(({ capturePages }) => {
  document.getElementById('capture-pages').checked = capturePages !== false;
});
document.getElementById('capture-pages').addEventListener('change', (e) => {
  chrome.storage.local.set({ capturePages: e.target.checked });
});

document.getElementById('auto-sync').addEventListener('change', (e) => {
  chrome.storage.local.set({ autoSync: e.target.checked });
});

// --- bulk import ---

const importStatus = document.getElementById('import-status');
let importPoll = null;

function showImport(state) {
  if (!state) return;
  if (state.error && !state.status) {
    importStatus.textContent = state.error;
    return;
  }
  const counts = `${state.added || 0} added, ${state.skipped || 0} skipped`;
  if (state.status === 'running') {
    const server = state.server && state.server.total ? ` (${state.server.processed}/${state.server.total})` : '';
    importStatus.textContent = `Importing ${state.total} bookmarks: batch ${state.batch}/${state.batches}${server}...`;
  } else if (state.status === 'done') {
    importStatus.textContent = `Import finished: ${counts} of ${state.total}.`;
  } else {
    importStatus.textContent = `Import ${state.status}: ${state.error || counts}.`;
  }
  const running = state.status === 'running';
  document.getElementById('import-btn').disabled = running;
  if (running && !importPoll) importPoll = setInterval(async () => showImport(await send({ action: 'importStatus' })), 2000);
  if (!running && importPoll) {
    clearInterval(importPoll);
    importPoll = null;
  }
}

document.getElementById('import-btn').addEventListener('click', async () => {
  const { count } = await send({ action: 'countBookmarks' });
  if (!count) {
    importStatus.textContent = 'No Chrome bookmarks to import.';
    return;
  }
  if (!confirm(`Import ${count} Chrome bookmarks into Fuze?`)) return;
  showImport(await send({ action: 'startImport' }));
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender && sender.id === chrome.runtime.id && !sender.tab && message.action === 'authChanged') loadAccount();
});

loadAccount();
send({ action: 'importStatus' }).then(showImport);
loadApiBase();
loadWebOrigins();
