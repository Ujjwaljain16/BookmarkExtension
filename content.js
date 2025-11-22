// Content script for Fuze platform - handles extension authentication sync

// Global error handler for extension context invalidation
window.addEventListener('error', function(event) {
  if (event.error && event.error.message && event.error.message.includes('Extension context invalidated')) {
    console.warn('Fuze Content Script: Caught extension context invalidation error, stopping operations');
    // Stop all extension-related operations
    event.preventDefault(); // Prevent default error handling
    return true;
  }
});

// Handle unhandled promise rejections (often caused by extension context invalidation)
window.addEventListener('unhandledrejection', function(event) {
  if (event.reason && event.reason.message && event.reason.message.includes('Extension context invalidated')) {
    console.warn('Fuze Content Script: Caught unhandled extension context invalidation promise rejection');
    event.preventDefault(); // Prevent default error handling
  }
});

// Function to check if extension is available (defensive approach)
function isExtensionAvailable() {
  // First check if chrome exists at all
  if (typeof chrome === 'undefined') {
    return false;
  }

  // Check if runtime exists
  if (!chrome.runtime) {
    return false;
  }

  // Try to access a safe property - if this fails, context is invalidated
  try {
    // Use a property that should exist but won't trigger API calls
    return typeof chrome.runtime.sendMessage === 'function';
  } catch (e) {
    console.warn('Fuze Content Script: Extension context invalidated during availability check');
    return false;
  }
}

// Function to safely send message to extension
function sendMessageToExtension(message) {
  return new Promise((resolve, reject) => {
    try {
      if (!isExtensionAvailable()) {
        reject(new Error('Extension not available'));
        return;
      }

      // Double-check extension is still available right before sending
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        reject(new Error('Extension not available'));
        return;
      }

      chrome.runtime.sendMessage(message)
        .then(resolve)
        .catch((error) => {
          // Check if it's a connection error or context invalidation
          if (error && error.message) {
            if (error.message.includes('Could not establish connection') ||
                error.message.includes('Extension context invalidated')) {
              console.warn('Fuze Content Script: Extension connection failed or context invalidated');
              reject(new Error('Extension not available'));
            } else {
              reject(error);
            }
          } else {
            reject(new Error('Unknown extension error'));
          }
        });
    } catch (e) {
      const errorMessage = e && e.message ? e.message : String(e);
      console.warn('Fuze Content Script: Error in sendMessageToExtension:', errorMessage);
      reject(new Error('Extension not available'));
    }
  });
}

// Function to check if user is logged in on Fuze platform
function checkFuzeAuthentication() {
  // Check for auth token in localStorage (Fuze platform stores it as 'token')
  const authToken = localStorage.getItem('token');

  // Reduced logging - only log errors
  if (authToken) {
    // Send auth token to extension background script
    sendMessageToExtension({
      action: 'syncAuthToken',
      token: authToken,
      source: 'fuze_platform'
    }).catch((error) => {
      console.error('Fuze Content Script: Failed to send token sync message:', error.message);
      // Don't throw - just log the error
    });

    return true;
  } else {
    // User not logged in - no need to log
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
        sendMessageToExtension({
          action: 'clearAuthToken',
          source: 'fuze_platform_logout'
        }).catch((error) => {
          console.error('Fuze Content Script: Failed to send logout message:', error.message);
        });
      } else {
        // Token was set - user logged in
        sendMessageToExtension({
          action: 'syncAuthToken',
          token: value,
          source: 'fuze_platform_login'
        }).catch((error) => {
          console.error('Fuze Content Script: Failed to send login message:', error.message);
        });
      }
    }
    return originalSetItem.apply(this, arguments);
  };

  localStorage.removeItem = function(key) {
    if (key === 'token') {
      // Token was removed - user logged out
      sendMessageToExtension({
        action: 'clearAuthToken',
        source: 'fuze_platform_logout'
      }).catch((error) => {
        console.error('Fuze Content Script: Failed to send remove token message:', error.message);
      });
    }
    return originalRemoveItem.apply(this, arguments);
  };

  localStorage.clear = function() {
    // All localStorage cleared - likely logout
    sendMessageToExtension({
      action: 'clearAuthToken',
      source: 'fuze_platform_logout'
    }).catch((error) => {
      console.error('Fuze Content Script: Failed to send clear message:', error.message);
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
  try {
    console.log('Fuze Content Script: Initialized on Fuze platform at:', window.location.href);

    // Check if extension is available before proceeding
    if (!isExtensionAvailable()) {
      console.warn('Fuze Content Script: Extension not available, content script will not function');
      return;
    }

    // Check authentication status immediately
    checkFuzeAuthentication();

    // Set up logout watching
    watchForLogout();

    // Check for login success indicators
    checkForLoginSuccess();

    // Use more efficient polling with exponential backoff
    let checkInterval = 30000; // Start with 30 seconds (much less frequent)
    let maxInterval = 300000; // Max 5 minutes
    let checkCount = 0;
    let intervalId = null;
    
    const performAuthCheck = () => {
      try {
        if (isExtensionAvailable()) {
          const hasToken = checkFuzeAuthentication();
          checkCount++;
          
          // If we found a token, check more frequently for a bit (user might be logging in)
          // Otherwise, use exponential backoff
          if (hasToken) {
            // Reset to moderate interval when token is found
            checkInterval = 30000; // 30 seconds
          } else {
            // Exponential backoff: 30s, 60s, 120s, 240s, 300s max
            checkInterval = Math.min(checkInterval * 1.5, maxInterval);
          }
        } else {
          console.warn('Fuze Content Script: Extension no longer available, stopping periodic checks');
          if (intervalId) {
            clearTimeout(intervalId);
          }
          return; // Stop checking
        }
      } catch (error) {
        console.error('Fuze Content Script: Error in periodic auth check:', error);
        // Exponential backoff on error
        checkInterval = Math.min(checkInterval * 1.5, maxInterval);
      }
      
      // Schedule next check with current interval
      intervalId = setTimeout(performAuthCheck, checkInterval);
    };
    
    // Start periodic checks with initial interval (30 seconds instead of 5)
    intervalId = setTimeout(performAuthCheck, checkInterval);

  } catch (error) {
    console.error('Fuze Content Script: Initialization error:', error);
    // Don't throw - just log and continue
  }
});

// Also check when page becomes visible (user returns to tab)
document.addEventListener('visibilitychange', function() {
  if (!document.hidden) {
    try {
      if (isExtensionAvailable()) {
        checkFuzeAuthentication();
      } else {
        console.warn('Fuze Content Script: Extension not available on visibility change');
      }
    } catch (error) {
      console.error('Fuze Content Script: Error on visibility change:', error);
    }
  }
});

// Listen for messages from popup or other extension parts
if (isExtensionAvailable()) {
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'checkAuthStatus') {
      const isLoggedIn = checkFuzeAuthentication();
      sendResponse({ authenticated: isLoggedIn });
    }
  });
}
