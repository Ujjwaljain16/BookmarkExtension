// Default settings
const DEFAULT_SETTINGS = {
  autoSync: true,
  syncInterval: 5, // minutes
  categories: ['work', 'personal', 'research', 'entertainment'],
  theme: 'light'
};

// Initialize 
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get('settings', (data) => {
    if (!data.settings) {
      chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
    }
  });

  chrome.contextMenus.create({
    id: 'save-to-bookmark-hub',
    title: 'Save to Bookmark Hub',
    contexts: ['page', 'link']
  });
});

// AI analysis function
async function aiEnrichBookmark(bookmark) {
  try {
    const response = await fetch('http://localhost:3000/api/bookmarks/ai-enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookmark)
    });
    if (!response.ok) throw new Error('AI enrichment failed');
    return await response.json();
  } catch (err) {
    console.warn('AI enrichment failed, using original bookmark:', err);
    return bookmark;
  }
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
    const { apiUrl } = await chrome.storage.sync.get('apiUrl');
    if (!apiUrl) return null;
    
    const response = await fetch(apiUrl);
    if (!response.ok) return null;
    
    const bookmarks = await response.json();
    const bookmark = bookmarks.find(b => normalizeUrl(b.url) === normalizedUrl);
    
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
    // Get settings
    const { settings } = await chrome.storage.sync.get('settings');
    if (!settings.autoSync) return;

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
      favicon: `https://www.google.com/s2/favicons?domain=${new URL(bookmark.url).hostname}`,
      category,
      tags: [],
      source: 'chrome'
    };

    // Get API URL from settings
    const { apiUrl } = await chrome.storage.sync.get('apiUrl');
    if (!apiUrl) {
      throw new Error('API URL not configured. Please set it in the extension settings.');
    }

    // Send to API
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
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
      iconUrl: '/icons/icon48.png', // Make sure the path is correct
      title: result.wasDuplicate ? 'Bookmark Updated' : 'Bookmark Synced',
      message: result.wasDuplicate 
        ? `Updated "${bookmarkData.title}" in Bookmark Hub`
        : `Successfully synced "${bookmarkData.title}"`
    });
  } catch (error) {
    console.error('Error syncing bookmark:', error);
    let errorMessage = 'Failed to sync bookmark';
    
    if (error.message.includes('API URL not configured')) {
      errorMessage = 'Please configure the API URL in extension settings';
    } else if (error.message.includes('Failed to fetch')) {
      errorMessage = 'Could not connect to the server. Please check your API URL and server status.';
    } else {
      errorMessage += `: ${error.message}`;
    }

    chrome.notifications.create({
      type: 'basic',
      iconUrl: '/icons/icon48.png', // Make sure the path is correct
      title: 'Sync Failed',
      message: errorMessage
    });
  }
});

// Handle bookmark removal
chrome.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
  try {
    // Get settings
    const { settings } = await chrome.storage.sync.get('settings');
    if (!settings.autoSync) return;

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

    // Get API URL from settings
    const { apiUrl } = await chrome.storage.sync.get('apiUrl');
    if (!apiUrl) {
      throw new Error('API URL not configured. Please set it in the extension settings.');
    }

    // Get the bookmark ID from the URL
    const bookmarkId = await getBookmarkId(bookmarkUrl);
    
    if (!bookmarkId) {
      console.log('Bookmark ID not found for URL:', bookmarkUrl);
      throw new Error('Bookmark not found in Bookmark Hub');
    }
    
    console.log('Found bookmark ID for deletion:', bookmarkId);
    
    // Delete by ID endpoint
    const deleteEndpoint = `${apiUrl}/${bookmarkId}`;
    
    // Send delete request to API
    const response = await fetch(deleteEndpoint, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      // If ID-based deletion fails, try deleting by URL as fallback
      console.log('ID-based deletion failed, trying URL-based deletion');
      
      const normalizedUrl = normalizeUrl(bookmarkUrl);
      const encodedUrl = encodeURIComponent(normalizedUrl);
      const urlDeleteEndpoint = `${apiUrl}/url/${encodedUrl}`;
      
      const urlResponse = await fetch(urlDeleteEndpoint, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
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

    console.log('Bookmark removed from hub successfully');

    // Show success notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '/icons/icon48.png', // Make sure the path is correct
      title: 'Bookmark Removed',
      message: `Successfully removed bookmark from Bookmark Hub`
    });
  } catch (error) {
    console.error('Error removing bookmark from hub:', {
      error: error.message,
      bookmarkUrl: removeInfo?.node?.url,
      normalizedUrl: removeInfo?.node?.url ? normalizeUrl(removeInfo.node.url) : null,
      apiUrl: await chrome.storage.sync.get('apiUrl').then(data => data.apiUrl)
    });

    // Show error notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '/icons/icon48.png', // Make sure the path is correct
      title: 'Remove Failed',
      message: 'Failed to remove bookmark from Bookmark Hub'
    });
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-to-bookmark-hub') {
    const url = info.linkUrl || info.pageUrl;
    const title = tab.title || '';
    
    // Skip Chrome internal URLs
    if (isChromeInternalUrl(url)) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon48.png',
        title: 'Bookmark Hub',
        message: 'Cannot save Chrome internal pages'
      });
      return;
    }
    
    try {
      const saved = await processBookmarkFromExtension({ title, url });
      
      chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon48.png',
        title: 'Bookmark Hub',
        message: 'Bookmark saved successfully!'
      });
      
      // Update cache with bookmark ID
      if (saved && saved.id) {
        bookmarkCache.set(normalizeUrl(url), saved.id);
      }
    } catch (error) {
      console.error('Error saving bookmark:', error);
      chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon48.png',
        title: 'Bookmark Hub Error',
        message: error.message || 'Failed to save bookmark'
      });
    }
  }
});