importScripts('lib/config.js');

// The API base: the user's override from the options page, else the production API.
async function getApiBase() {
  const { apiBaseOverride } = await chrome.storage.local.get('apiBaseOverride');
  return apiBaseOverride || FuzeConfig.DEFAULT_API_BASE;
}

// Default settings
const DEFAULT_SETTINGS = {
  autoSync: true,
  syncInterval: 5, // minutes
  categories: ['work', 'personal', 'research', 'entertainment'],
  theme: 'light'
};

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    console.log('=== BACKGROUND: MESSAGE RECEIVED ===');
    console.log('Background: Action:', request.action);
    console.log('Background: From:', sender.url || sender.tab?.url || 'unknown');
    console.log('Background: Has apiUrl:', !!request.apiUrl);
    console.log('Background: Has authToken:', !!request.authToken);
    
    switch (request.action) {
      case 'syncAuthToken':
        // Sync auth token from Fuze platform to extension
        console.log('Background: Syncing auth token from Fuze platform, token length:', request.token ? request.token.length : 0);
        
        {
          chrome.storage.local.set({
            authToken: request.token
          }, () => {
            if (chrome.runtime.lastError) {
              console.error('Background: Error syncing auth token:', chrome.runtime.lastError);
              return;
            }
            console.log('Background: Auth token synced successfully');

            // Notify all extension contexts (popup, etc.) to update status
            chrome.runtime.sendMessage({
              action: 'authStatusChanged',
              authenticated: true
            }).catch((error) => {
              // Popup might not be open, that's OK
              console.log('Background: No popup to notify:', error.message);
            });
          });
        }
        break;

      case 'clearAuthToken':
        // Clear auth token (user logged out)
        console.log('Background: Clearing auth token due to logout');
        chrome.storage.local.remove('authToken', () => {
          if (chrome.runtime.lastError) {
            console.error('Background: Error clearing auth token:', chrome.runtime.lastError);
            return;
          }
          console.log('Background: Auth token cleared');

          // Notify popup to update status
          chrome.runtime.sendMessage({
            action: 'authStatusChanged',
            authenticated: false
          }).catch((error) => {
            console.log('Background: No popup to notify on clear:', error.message);
          });
        });
        break;

      case 'startSSEStream':
        // Start SSE stream from background script (has full permissions)
        console.log('=== START SSE STREAM CASE TRIGGERED ===');
        console.log('Background: Starting SSE stream for import progress');
        
        // Destructure carefully to debug
        console.log('Request object:', { ...request, authToken: request.authToken ? `[${request.authToken.length} chars]` : 'MISSING' });
        
        const { authToken } = request;

        console.log('Destructured authToken present:', !!authToken);
        console.log('Destructured authToken length:', authToken ? authToken.length : 0);
        console.log('Destructured authToken type:', typeof authToken);
        
        if (!authToken) {
          console.error('ERROR: Missing authToken!');
          sendResponse({ error: 'Missing authToken' });
          return false;
        }
        
        // Make SSE request from background script
        const streamPath = '/api/bookmarks/import/progress/stream';
        const streamHeaders = {
          'Authorization': `Bearer ${authToken}`,
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache'
        };
        
        console.log('Background: Connecting to SSE:', streamPath);
        console.log('Background: Headers to send:', {
          'Authorization': `Bearer ${authToken.substring(0, 20)}...`,
          'Accept': streamHeaders['Accept'],
          'Cache-Control': streamHeaders['Cache-Control']
        });
        
        // Process async fetch
        (async () => {
          try {
            const streamUrl = `${await getApiBase()}${streamPath}`;
            console.log('Background: Making fetch request...');
            console.log('Background: URL:', streamUrl);
            console.log('Background: Method: GET');
            console.log('Background: Headers:', streamHeaders);
            
            const response = await fetch(streamUrl, {
              method: 'GET',
              headers: streamHeaders
            });
            
            console.log('Background: Fetch completed!');
            console.log('Background: SSE response status:', response.status);
            console.log('Background: SSE response OK:', response.ok);
            console.log('Background: SSE response headers:', Object.fromEntries(response.headers.entries()));
            
            if (!response.ok) {
              const errorText = await response.text().catch(() => '');
              console.error('Background: SSE connection failed:', response.status, errorText);
              chrome.runtime.sendMessage({
                action: 'sseError',
                error: `SSE connection failed: ${response.status} - ${errorText}`
              }).catch(() => {});
              return;
            }
            
            // Notify popup that stream started
            chrome.runtime.sendMessage({
              action: 'sseStreamStarted'
            }).catch(() => {});
            
            // Stream the response back to popup
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            
            console.log('Background: Starting to read SSE stream...');
            let chunkCount = 0;
            
            while (true) {
              const { done, value } = await reader.read();
              chunkCount++;
              
              if (done) {
                console.log(`Background: SSE stream closed after ${chunkCount} chunks`);
                chrome.runtime.sendMessage({
                  action: 'sseStreamClosed'
                }).catch(() => {});
                break;
              }
              
              console.log(`Background: Received chunk #${chunkCount}, size: ${value.length} bytes`);
              buffer += decoder.decode(value, { stream: true });
              console.log(`Background: Buffer size: ${buffer.length} bytes`);
              
              const lines = buffer.split('\n\n');
              buffer = lines.pop() || '';
              
              console.log(`Background: Found ${lines.length} complete SSE messages`);
              
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.substring(6);
                  console.log('Background: Forwarding SSE data to popup:', data.substring(0, 100) + (data.length > 100 ? '...' : ''));
                  
                  // Forward SSE data to popup
                  chrome.runtime.sendMessage({
                    action: 'sseData',
                    data: data
                  }).then(() => {
                    console.log('Background: Message forwarded successfully');
                  }).catch((err) => {
                    console.error('Background: Failed to forward message:', err);
                  });
                } else if (line.trim()) {
                  console.log('Background: Non-data SSE line:', line);
                }
              }
            }
          } catch (error) {
            console.error('Background: SSE stream error:', error);
            chrome.runtime.sendMessage({
              action: 'sseError',
              error: error.message
            }).catch(() => {});
          }
        })();
        
        // Send immediate response
        sendResponse({ success: true });
        return true; // Keep channel open for async operations
        break;
    }
  } catch (error) {
    console.error('Background: Error handling message:', error);
  }
});

// Initialize
chrome.runtime.onInstalled.addListener(() => {
  migrateApiUrlSetting().catch((e) => console.error('Background: settings migration failed:', e.message));
  try {
    chrome.storage.local.get('autoSync', (data) => {
      if (chrome.runtime.lastError) {
        console.error('Background: Error getting autoSync setting:', chrome.runtime.lastError);
        return;
      }
      if (data.autoSync === undefined) {
        chrome.storage.local.set({ autoSync: true }, () => {
          if (chrome.runtime.lastError) {
            console.error('Background: Error setting default autoSync:', chrome.runtime.lastError);
          }
        });
      }
    });

    chrome.contextMenus.create({
      id: 'save-to-fuze',
      title: 'Save to Fuze',
      contexts: ['page', 'link']
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('Background: Error creating context menu:', chrome.runtime.lastError);
      }
    });
  } catch (error) {
    console.error('Background: Error during initialization:', error);
  }
});

// Older versions stored `apiUrl` and wrote the default into it on first run. Keep it only when
// the user had actually pointed the extension somewhere else, as the new override setting.
async function migrateApiUrlSetting() {
  const { apiUrl } = await chrome.storage.local.get('apiUrl');
  if (apiUrl === undefined) return;
  await chrome.storage.local.remove('apiUrl');
  let base;
  try {
    base = FuzeConfig.normalizeApiBase(apiUrl);
  } catch (e) {
    return;
  }
  if (base !== FuzeConfig.DEFAULT_API_BASE) {
    const granted = await chrome.permissions.contains({ origins: [FuzeConfig.originPermission(base)] });
    if (granted) await chrome.storage.local.set({ apiBaseOverride: base });
  }
}

// Helper function to get auth token
async function getAuthToken() {
  const { authToken } = await chrome.storage.local.get('authToken');
  return authToken;
}

// Function to process bookmark from extension
async function processBookmarkFromExtension({ title, url, description = '', category = 'other', tags = '' }) {
  const apiUrl = await getApiBase();
  const authToken = await getAuthToken();

  if (!authToken) {
    throw new Error('Not authenticated. Please log in to Fuze.');
  }

  const bookmarkData = {
    title,
    url,
    description,
    category,
    tags: tags.split(',').map(tag => tag.trim()).filter(tag => tag)
  };

  const response = await fetch(`${apiUrl}/api/bookmarks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify(bookmarkData)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to save bookmark');
  }

  return await response.json();
}

// Helper function to check if URL is a Chrome internal URL
const isChromeInternalUrl = (url) => {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'chrome:' || 
           urlObj.protocol === 'chrome-extension:' || 
           urlObj.protocol === 'about:' ||
           urlObj.protocol === 'edge:' ||
           urlObj.protocol === 'moz-extension:';
  } catch (e) {
    return false;
  }
};

// The Fuze id of the bookmark saved under exactly this URL, or null when there is none.
async function getBookmarkId(url) {
  const apiUrl = await getApiBase();
  const authToken = await getAuthToken();
  if (!authToken) return null;

  const response = await fetch(`${apiUrl}${FuzeConfig.bookmarkLookupPath(url)}`, {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Accept': 'application/json'
    }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Lookup failed: HTTP ${response.status}`);
  const data = await response.json();
  return data.bookmark ? data.bookmark.id : null;
}

// Handle bookmark creation
chrome.bookmarks.onCreated.addListener(async (id) => {
  try {
    // Check if extension context is still valid
    if (!chrome || !chrome.bookmarks || !chrome.storage) {
      console.warn('Background: Extension context invalidated during bookmark creation');
      return;
    }
    // Get autoSync setting from local storage
    const { autoSync } = await chrome.storage.local.get('autoSync');
    if (!autoSync) return;

    // Get full bookmark details
    const [bookmark] = await chrome.bookmarks.get(id);
    if (!bookmark.url) return;

    // Skip Chrome internal URLs
    if (isChromeInternalUrl(bookmark.url)) {
      console.log('Skipping Chrome internal URL:', bookmark.url);
      return;
    }

    // Get parent folder name for category
    let category = 'other';
    if (bookmark.parentId) {
      const [parent] = await chrome.bookmarks.get(bookmark.parentId);
      if (parent && parent.title) {
        category = parent.title.toLowerCase();
      }
    }

    // Prepare bookmark data
    const bookmarkData = {
      url: bookmark.url,
      title: bookmark.title || bookmark.url,
      description: '',
      category,
      tags: []
    };

    // Get API URL and auth token from settings
    const apiUrl = await getApiBase();
    const authToken = await getAuthToken();
        
    if (!authToken) {
      throw new Error('Not authenticated. Please log in to Fuze.');
    }

    // Send to API
    const response = await fetch(`${apiUrl}/api/bookmarks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(bookmarkData)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    
    // Show appropriate notification based on whether it was a duplicate
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '/icons/icon48.png',
      title: result.wasDuplicate ? 'Bookmark Updated' : 'Bookmark Saved',
      message: result.wasDuplicate 
        ? `Updated "${bookmarkData.title}" in Fuze`
        : `Successfully saved "${bookmarkData.title}" to Fuze`
    });
  } catch (error) {
    console.error('Error syncing bookmark:', error);
    let errorMessage = 'Failed to save bookmark';
    
    if (error.message.includes('API URL not configured')) {
      errorMessage = 'Please configure the API URL in extension settings';
    } else if (error.message.includes('Not authenticated')) {
      errorMessage = 'Please log in to Fuze in the extension settings';
    } else if (error.message.includes('Failed to fetch')) {
      errorMessage = 'Could not connect to Fuze. Please check your API URL and server status.';
    } else {
      errorMessage += `: ${error.message}`;
    }

    chrome.notifications.create({
      type: 'basic',
      iconUrl: '/icons/icon48.png',
      title: 'Save Failed',
      message: errorMessage
    });
  }
});

// Handle bookmark removal
chrome.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
  try {
    // Check if extension context is still valid
    if (!chrome || !chrome.bookmarks || !chrome.storage) {
      console.warn('Background: Extension context invalidated during bookmark removal');
      return;
    }
    // Get autoSync setting from local storage
    const { autoSync } = await chrome.storage.local.get('autoSync');
    if (!autoSync) return;

    // Use the removeInfo to get the bookmark details
    if (!removeInfo || !removeInfo.node || !removeInfo.node.url) {
      console.log('No bookmark details available for removal');
      return;
    }

    const bookmarkUrl = removeInfo.node.url;
    console.log('Removing bookmark:', bookmarkUrl);

    // Skip Chrome internal URLs
    if (isChromeInternalUrl(bookmarkUrl)) {
      console.log('Skipping Chrome internal URL:', bookmarkUrl);
      return;
    }

    // Get API URL and auth token from settings
    const apiUrl = await getApiBase();
    const authToken = await getAuthToken();
        
    if (!authToken) {
      throw new Error('Not authenticated. Please log in to Fuze.');
    }

    // Resolve the exact URL to its Fuze id, then delete by id.
    const bookmarkId = await getBookmarkId(bookmarkUrl);
    if (!bookmarkId) {
      // Never saved to Fuze (or already removed there): nothing to do.
      return;
    }

    const response = await fetch(`${apiUrl}/api/bookmarks/${bookmarkId}`, {
      method: 'DELETE',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${authToken}`
      }
    });
    if (!response.ok && response.status !== 404) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
    }

    console.log('Bookmark removed from Fuze successfully');

    // Show success notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '/icons/icon48.png',
      title: 'Bookmark Removed',
      message: `Successfully removed bookmark from Fuze`
    });
  } catch (error) {
    console.error('Error removing bookmark from Fuze:', {
      error: error.message,
      bookmarkUrl: removeInfo?.node?.url,
      apiUrl: await getApiBase()
    });

    // Show error notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '/icons/icon48.png',
      title: 'Remove Failed',
      message: 'Failed to remove bookmark from Fuze'
    });
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    // Check if extension context is still valid
    if (!chrome || !chrome.tabs || !chrome.storage) {
      console.warn('Background: Extension context invalidated during context menu click');
      return;
    }

    if (info.menuItemId === 'save-to-fuze') {
    const url = info.linkUrl || info.pageUrl;
    const title = tab.title || '';
    
    // Skip Chrome internal URLs
    if (isChromeInternalUrl(url)) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon48.png',
        title: 'Fuze',
        message: 'Cannot save Chrome internal pages'
      });
      return;
    }
    
    try {
      const saved = await processBookmarkFromExtension({ title, url });
      
      chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon48.png',
        title: 'Fuze',
        message: 'Bookmark saved successfully!'
      });
      
    } catch (error) {
      console.error('Error saving bookmark:', error);
      chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon48.png',
        title: 'Fuze Error',
        message: error.message || 'Failed to save bookmark'
      });
    }
  }
  } catch (error) {
    console.error('Background: Error in context menu handler:', error);
  }
});