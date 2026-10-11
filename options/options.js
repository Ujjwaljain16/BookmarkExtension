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

// A session belongs to the server that issued it; switching servers signs the extension out.
async function switchApiBase(override) {
  const { apiBaseOverride } = await chrome.storage.local.get('apiBaseOverride');
  if ((apiBaseOverride || null) === (override || null)) return false;
  if (override) await chrome.storage.local.set({ apiBaseOverride: override });
  else await chrome.storage.local.remove('apiBaseOverride');
  await chrome.storage.local.remove(['authToken']);
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

loadApiBase();
