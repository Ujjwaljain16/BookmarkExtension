'use strict';
// The popup never calls the API itself: it asks the service worker, which owns the session.

const $ = (id) => document.getElementById(id);
const send = (message) => chrome.runtime.sendMessage(message);
let currentTab = null;

function showStatus(message, type) {
  $('status-message').textContent = message;
  $('status-message').className = `status ${type}`;
  if (type === 'success') setTimeout(() => { $('status-message').className = 'status'; }, 3000);
}

function showConnection(status) {
  const label = $('connection-status');
  if (status.signedIn) {
    const who = status.user && (status.user.username || status.user.email);
    label.textContent = status.offline ? 'Connected (offline)' : who ? `Connected as ${who}` : 'Connected to Fuze';
    label.style.color = status.offline ? '#f59e0b' : '#10b981';
  } else {
    label.textContent = 'Not connected';
    label.style.color = '#dc2626';
  }
  $('auth-prompt').hidden = Boolean(status.signedIn);
  if (!status.signedIn) {
    $('auth-prompt-text').textContent = HANDOFF_TEXT[status.handoff] || HANDOFF_TEXT.default;
    $('login-redirect-btn').textContent = status.handoff === 'unreachable' ? 'Try again' : 'Sign in to Fuze';
  }
}

// What the popup says while signed out, after the last hand-off from the website (if any).
const HANDOFF_TEXT = {
  default: 'Sign in on the Fuze website with Google or email. The extension connects by itself.',
  unreachable: "You're signed in on the Fuze website, but Fuze's server can't be reached right now. Try again in a few minutes.",
  rejected: 'Your session on the Fuze website has ended. Sign in there again and the extension will follow.',
};

async function refreshStatus() {
  showConnection(await send({ action: 'getStatus', verify: true }));
}

function openWeb(path) {
  chrome.tabs.create({ url: FuzeConfig.FUZE_WEB_ORIGIN + path, active: true });
  window.close();
}

// Only our own service worker may update the popup.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender || sender.id !== chrome.runtime.id || sender.tab) return;
  if (message.action === 'authChanged') refreshStatus();
});

document.addEventListener('DOMContentLoaded', async () => {
  // Opening the popup grants activeTab, which exposes this tab's URL and title.
  [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (currentTab) {
    $('url').value = currentTab.url || '';
    $('title').value = currentTab.title || '';
  }
  if (!currentTab || !FuzeConfig.isSaveableUrl(currentTab.url)) {
    $('save-btn').disabled = true;
    showStatus('Only web pages can be saved.', 'error');
  }

  $('settings-link').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
  $('extension-settings-link').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
  $('login-redirect-btn').addEventListener('click', () => openWeb('/login'));
  $('signup-link').addEventListener('click', (e) => { e.preventDefault(); openWeb('/signup'); });

  $('bookmark-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentTab) return;
    $('save-btn').disabled = true;
    showStatus('Saving...', '');
    try {
      const result = await send({
        action: 'saveTab',
        tabId: currentTab.id,
        title: $('title').value.trim(),
        description: $('description').value.trim(),
        tags: $('tags').value,
      });
      if (result.error) {
        showStatus(result.error, 'error');
        if (result.authRequired) showConnection({ signedIn: false });
        return;
      }
      let message = result.wasDuplicate ? 'Already in Fuze; updated.' : 'Saved to Fuze!';
      if (result.contentCaptured) message += ' Page content included.';
      showStatus(message, 'success');
      $('description').value = '';
      $('tags').value = '';
    } finally {
      $('save-btn').disabled = false;
    }
  });

  refreshStatus();
});
