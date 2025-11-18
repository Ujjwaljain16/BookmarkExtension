// Content script for Fuze platform - handles extension authentication sync

// Function to check if user is logged in on Fuze platform
function checkFuzeAuthentication() {
  // Check for auth token in localStorage (Fuze platform stores it as 'token')
  const authToken = localStorage.getItem('token');

  console.log('Fuze Content Script: Checking auth, token exists:', !!authToken, 'length:', authToken ? authToken.length : 0);

  if (authToken) {
    console.log('Fuze Content Script: User is logged in on platform, syncing token');

    // Send auth token to extension background script
    chrome.runtime.sendMessage({
      action: 'syncAuthToken',
      token: authToken,
      source: 'fuze_platform'
    }).then(() => {
      console.log('Fuze Content Script: Token sync message sent successfully');
    }).catch((error) => {
      console.error('Fuze Content Script: Failed to send token sync message:', error);
    });

    return true;
  } else {
    console.log('Fuze Content Script: User is not logged in on platform');
    return false;
  }
}

// Function to check for logout events
function watchForLogout() {
  // Watch for localStorage changes (logout would clear authToken)
  const originalSetItem = localStorage.setItem;
  const originalRemoveItem = localStorage.removeItem;
  const originalClear = localStorage.clear;

  localStorage.setItem = function(key, value) {
    if (key === 'token') {
      if (!value || value === 'null' || value === 'undefined') {
        // Token was cleared - user logged out
        chrome.runtime.sendMessage({
          action: 'clearAuthToken',
          source: 'fuze_platform_logout'
        });
      } else {
        // Token was set - user logged in
        chrome.runtime.sendMessage({
          action: 'syncAuthToken',
          token: value,
          source: 'fuze_platform_login'
        });
      }
    }
    return originalSetItem.apply(this, arguments);
  };

  localStorage.removeItem = function(key) {
    if (key === 'token') {
      // Token was removed - user logged out
      chrome.runtime.sendMessage({
        action: 'clearAuthToken',
        source: 'fuze_platform_logout'
      });
    }
    return originalRemoveItem.apply(this, arguments);
  };

  localStorage.clear = function() {
    // All localStorage cleared - likely logout
    chrome.runtime.sendMessage({
      action: 'clearAuthToken',
      source: 'fuze_platform_logout'
    });
    return originalClear.apply(this, arguments);
  };
}

// Function to check for successful login redirects
function checkForLoginSuccess() {
  // Check URL for login success indicators
  const urlParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.substring(1));

  if (urlParams.get('login') === 'success' || hashParams.get('login') === 'success') {
    console.log('Fuze Content Script: Login success detected in URL');
    // Wait a moment for localStorage to be updated, then check auth
    setTimeout(checkFuzeAuthentication, 1000);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  console.log('Fuze Content Script: Initialized on Fuze platform at:', window.location.href);

  // Check authentication status immediately
  checkFuzeAuthentication();

  // Set up logout watching
  watchForLogout();

  // Check for login success indicators
  checkForLoginSuccess();

  // Also check periodically in case of SPA navigation
  setInterval(checkFuzeAuthentication, 5000); // Check every 5 seconds
});

// Also check when page becomes visible (user returns to tab)
document.addEventListener('visibilitychange', function() {
  if (!document.hidden) {
    console.log('Fuze Content Script: Tab became visible, checking auth');
    checkFuzeAuthentication();
  }
});

// Listen for messages from popup or other extension parts
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'checkAuthStatus') {
    const isLoggedIn = checkFuzeAuthentication();
    sendResponse({ authenticated: isLoggedIn });
  }
});
