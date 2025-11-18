// Default settings
const DEFAULT_SETTINGS = {
  autoSync: true,
  syncInterval: 5, // minutes
  categories: ['work', 'personal', 'research', 'entertainment'],
  theme: 'light'
};

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background: Received message:', request.action, 'from:', sender.url);
  switch (request.action) {
    case 'syncAuthToken':
      // Sync auth token from Fuze platform to extension
      console.log('Background: Syncing auth token from Fuze platform, token length:', request.token ? request.token.length : 0);
      chrome.storage.local.set({
        authToken: request.token,
        apiUrl: 'https://fuze-backend.onrender.com'
      }, () => {
        console.log('Background: Auth token synced successfully');

        // Notify all extension contexts (popup, etc.) to update status
        chrome.runtime.sendMessage({
          action: 'authStatusChanged',
          authenticated: true
        }).catch(() => {
          // Popup might not be open, that's OK
          console.log('Background: No popup to notify');
        });
      });
      break;

    case 'clearAuthToken':
      // Clear auth token (user logged out)
      console.log('Background: Clearing auth token due to logout');
      chrome.storage.local.remove('authToken', () => {
        console.log('Background: Auth token cleared');

        // Notify popup to update status
        chrome.runtime.sendMessage({
          action: 'authStatusChanged',
          authenticated: false
        });
      });
      break;
  }
});

// Initialize 
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('autoSync', (data) => {
    if (data.autoSync === undefined) {
      chrome.storage.local.set({ autoSync: true });
    }
  });

  chrome.contextMenus.create({
    id: 'save-to-fuze',
    title: 'Save to Fuze',
    contexts: ['page', 'link']
  });
});

// Helper function to get auth token
async function getAuthToken() {
  const { authToken } = await chrome.storage.local.get('authToken');
  return authToken;
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
});