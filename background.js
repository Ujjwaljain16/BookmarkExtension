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
        
        // Get existing API URL to preserve it, or use smart default
        chrome.storage.local.get(['apiUrl'], (existingData) => {
          // Smart default: detect environment and use appropriate API URL
          // Supports both development (localhost) and production
          let defaultApiUrl = 'http://localhost:5000'; // Development default
          try {
            // Try to detect if we're in development or production
            // Check if we're on localhost or if manifest indicates production
            if (chrome.runtime.getManifest && chrome.runtime.getManifest().homepage_url) {
              const homepage = chrome.runtime.getManifest().homepage_url;
              const url = new URL(homepage);
              // If homepage is not localhost, use production API
              if (!url.hostname.includes('localhost') && !url.hostname.includes('127.0.0.1')) {
                defaultApiUrl = url.origin.replace('www.', 'api.').replace('itsfuze', 'api.itsfuze');
                // Fallback to known production URL if replacement doesn't work
                if (defaultApiUrl === url.origin) {
                  defaultApiUrl = 'https://api.itsfuze.vercel.app';
                }
              }
            }
          } catch (e) {
            // Fallback: keep localhost for dev, but log
            console.log('Using default development API URL (localhost:5000)');
          }
          const apiUrl = existingData.apiUrl || defaultApiUrl;
          
          chrome.storage.local.set({
            authToken: request.token,
            apiUrl: apiUrl // Preserve existing API URL or use localhost default
          }, () => {
            if (chrome.runtime.lastError) {
              console.error('Background: Error syncing auth token:', chrome.runtime.lastError);
              return;
            }
            console.log('Background: Auth token synced successfully, API URL:', apiUrl);

            // Notify all extension contexts (popup, etc.) to update status
            chrome.runtime.sendMessage({
              action: 'authStatusChanged',
              authenticated: true
            }).catch((error) => {
              // Popup might not be open, that's OK
              console.log('Background: No popup to notify:', error.message);
            });
          });
        });
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
        
        const { apiUrl, authToken } = request;
        
        console.log('Destructured apiUrl:', apiUrl);
        console.log('Destructured authToken present:', !!authToken);
        console.log('Destructured authToken length:', authToken ? authToken.length : 0);
        console.log('Destructured authToken type:', typeof authToken);
        
        if (!apiUrl) {
          console.error('ERROR: Missing apiUrl!');
          sendResponse({ error: 'Missing apiUrl' });
          return false;
        }
        
        if (!authToken) {
          console.error('ERROR: Missing authToken!');
          sendResponse({ error: 'Missing authToken' });
          return false;
        }
        
        // Make SSE request from background script
        const streamUrl = `${apiUrl}/api/bookmarks/import/progress/stream`;
        const streamHeaders = {
          'Authorization': `Bearer ${authToken}`,
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache'
        };
        
        console.log('Background: Connecting to SSE:', streamUrl);
        console.log('Background: Headers to send:', {
          'Authorization': `Bearer ${authToken.substring(0, 20)}...`,
          'Accept': streamHeaders['Accept'],
          'Cache-Control': streamHeaders['Cache-Control']
        });
        
        // Process async fetch
        (async () => {
          try {
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

// Helper function to get auth token
async function getAuthToken() {
  const { authToken } = await chrome.storage.local.get('authToken');
  return authToken;
}

// Function to process bookmark from extension
async function processBookmarkFromExtension({ title, url, description = '', category = 'other', tags = '' }) {
  const { apiUrl } = await chrome.storage.local.get('apiUrl');
  const authToken = await getAuthToken();

  if (!authToken) {
    throw new Error('Not authenticated. Please log in to Fuze.');
  }

  if (!apiUrl) {
    throw new Error('API URL not configured. Please set it in the extension settings.');
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

// Helper function to normalize URL
const normalizeUrl = (url) => {
  try {
    const urlObj = new URL(url);
    // Remove trailing slashes, normalize protocol, and convert to lowercase
    return urlObj.toString().replace(/\/$/, '').toLowerCase();
  } catch (e) {
    console.error('Error normalizing URL:', url, e);
    return url.toLowerCase();
  }
};

// Cache to store URL to bookmark ID mapping
const bookmarkCache = new Map();

// Function to get bookmark ID from URL
async function getBookmarkId(url) {
  try {
    const normalizedUrl = normalizeUrl(url);
    
    // First check cache
    if (bookmarkCache.has(normalizedUrl)) {
      return bookmarkCache.get(normalizedUrl);
    }
    
    // If not in cache, fetch all bookmarks and find the matching one
    const { apiUrl } = await chrome.storage.local.get('apiUrl');
    if (!apiUrl) return null;
    
    const authToken = await getAuthToken();
    if (!authToken) return null;
    
    const response = await fetch(`${apiUrl}/api/bookmarks`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Accept': 'application/json'
      }
    });
    if (!response.ok) return null;
    
    const data = await response.json();
    const bookmark = data.bookmarks.find(b => normalizeUrl(b.url) === normalizedUrl);
    
    if (bookmark) {
      // Update cache
      bookmarkCache.set(normalizedUrl, bookmark.id);
      return bookmark.id;
    }
    
    return null;
  } catch (error) {
    console.error('Error getting bookmark ID:', error);
    return null;
  }
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
    const { apiUrl } = await chrome.storage.local.get('apiUrl');
    const authToken = await getAuthToken();
    
    if (!apiUrl) {
      throw new Error('API URL not configured. Please set it in the extension settings.');
    }
    
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
    
    // Store the bookmark ID in cache for future reference
    if (result.bookmark && result.bookmark.id) {
      bookmarkCache.set(normalizeUrl(bookmark.url), result.bookmark.id);
    }
    
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
    const { apiUrl } = await chrome.storage.local.get('apiUrl');
    const authToken = await getAuthToken();
    
    if (!apiUrl) {
      throw new Error('API URL not configured. Please set it in the extension settings.');
    }
    
    if (!authToken) {
      throw new Error('Not authenticated. Please log in to Fuze.');
    }

    // Get the bookmark ID from the URL
    const bookmarkId = await getBookmarkId(bookmarkUrl);
    
    if (!bookmarkId) {
      console.log('Bookmark ID not found for URL:', bookmarkUrl);
      throw new Error('Bookmark not found in Fuze');
    }
    
    console.log('Found bookmark ID for deletion:', bookmarkId);
    
    // Delete by ID endpoint
    const deleteEndpoint = `${apiUrl}/api/bookmarks/${bookmarkId}`;
    
    // Send delete request to API
    const response = await fetch(deleteEndpoint, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (!response.ok) {
      // If ID-based deletion fails, try deleting by URL as fallback
      console.log('ID-based deletion failed, trying URL-based deletion');
      
      const normalizedUrl = normalizeUrl(bookmarkUrl);
      const encodedUrl = encodeURIComponent(normalizedUrl);
      const urlDeleteEndpoint = `${apiUrl}/api/bookmarks/url/${encodedUrl}`;
      
      const urlResponse = await fetch(urlDeleteEndpoint, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      if (!urlResponse.ok) {
        const errorData = await urlResponse.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP error! status: ${urlResponse.status}`);
      }
      
      // Remove from cache
      bookmarkCache.delete(normalizedUrl);
    } else {
      // Remove from cache if ID-based deletion was successful
      const normalizedUrl = normalizeUrl(bookmarkUrl);
      bookmarkCache.delete(normalizedUrl);
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
      normalizedUrl: removeInfo?.node?.url ? normalizeUrl(removeInfo.node.url) : null,
      apiUrl: await chrome.storage.local.get('apiUrl').then(data => data.apiUrl)
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
      
      // Update cache with bookmark ID
      if (saved && saved.bookmark && saved.bookmark.id) {
        bookmarkCache.set(normalizeUrl(url), saved.bookmark.id);
      }
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