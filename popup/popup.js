// Add processBookmarkFromExtension directly here
async function processBookmarkFromExtension({ title, url }) {
  // You can expand this logic as needed, but for now just send to API
  const apiUrl = await new Promise(resolve => {
    chrome.storage.sync.get(['apiUrl'], data => resolve(data.apiUrl));
  });
  const bookmarkData = { title, url };
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bookmarkData)
  });
  if (!response.ok) throw new Error('Failed to save bookmark');
  return await response.json();
}

document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('bookmark-form');
  const statusMessage = document.getElementById('status-message');
  const settingsLink = document.getElementById('settings-link');
  const backButton = document.getElementById('back-button');
  const saveSettingsButton = document.getElementById('save-settings');
  const mainForm = document.getElementById('main-form');
  const settingsForm = document.getElementById('settings-form');
  const connectionStatus = document.getElementById('connection-status');
  const autoSyncCheckbox = document.getElementById('auto-sync');
  
  // Get current tab URL and title
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    const currentTab = tabs[0];
    document.getElementById('url').value = currentTab.url;
    document.getElementById('title').value = currentTab.title;
  });
  
  // Load settings and update connection status
  chrome.storage.sync.get(['apiUrl', 'apiKey', 'autoSync'], function(data) {
    if (data.apiUrl) {
      document.getElementById('api-url').value = data.apiUrl;
      connectionStatus.textContent = 'Connected';
      connectionStatus.style.color = '#047857';
    }
    
    if (data.apiKey) {
      document.getElementById('api-key').value = data.apiKey;
    }
    
    // Set auto-sync checkbox state
    autoSyncCheckbox.checked = !!data.autoSync;
  });
  
  // Toggle between main form and settings
  settingsLink.addEventListener('click', function(e) {
    e.preventDefault();
    mainForm.style.display = 'none';
    settingsForm.style.display = 'block';
  });
  
  backButton.addEventListener('click', function(e) {
    e.preventDefault();
    settingsForm.style.display = 'none';
    mainForm.style.display = 'block';
  });
  
  // Save settings
  saveSettingsButton.addEventListener('click', function(e) {
    e.preventDefault();
    
    const apiUrl = document.getElementById('api-url').value.trim();
    const apiKey = document.getElementById('api-key').value.trim();
    const autoSync = autoSyncCheckbox.checked;
    
    if (!apiUrl) {
      alert('Please enter a valid API URL');
      return;
    }
    
    chrome.storage.sync.set({
      apiUrl: apiUrl,
      apiKey: apiKey,
      autoSync: autoSync
    }, function() {
      settingsForm.style.display = 'none';
      mainForm.style.display = 'block';
      connectionStatus.textContent = 'Connected';
      connectionStatus.style.color = '#047857';
      
      showStatus('Settings saved successfully', 'success');
    });
  });
  
  // Add this function at the top level
  async function testServerConnection(apiUrl) {
    const baseUrl = apiUrl.replace('/api/bookmarks', '');
    console.log('Testing connection to:', baseUrl);
    
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Server responded with status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Server health check response:', data);
      return true;
    } catch (error) {
      console.error('Server connection test failed:', error);
      return false;
    }
  }
  
  // Update the form submission handler
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    chrome.storage.sync.get(['apiUrl', 'apiKey'], async function(data) {
      if (!data.apiUrl) {
        showStatus('Please configure API URL in settings', 'error');
        return;
      }
      
      // Test server connection first
      const isConnected = await testServerConnection(data.apiUrl);
      if (!isConnected) {
        showStatus('Could not connect to server. Please check if the server is running and the API URL is correct.', 'error');
        return;
      }
      
      const url = document.getElementById('url').value;
      const title = document.getElementById('title').value;
      
      try {
        const saved = await processBookmarkFromExtension({ title, url });
        showStatus('Bookmark saved successfully!', 'success');
        
        // Clear form fields except URL (which is readonly)
        document.getElementById('description').value = '';
        document.getElementById('tags').value = '';
        document.getElementById('category').value = 'other';
      } catch (error) {
        console.error('Error details:', error);
        let errorMessage = 'Error saving bookmark. ';
        
        if (error.message.includes('Failed to fetch')) {
          errorMessage += 'Could not connect to the server. Please check if the server is running and the API URL is correct.';
        } else if (error.message.includes('already exists')) {
          errorMessage = 'This URL is already bookmarked.';
        } else {
          errorMessage += error.message;
        }
        
        showStatus(errorMessage, 'error');
      }
    });
  });
  
  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = `status ${type}`;
    
    // Auto-hide success messages after 3 seconds
    if (type === 'success') {
      setTimeout(() => {
        statusMessage.className = 'status';
      }, 3000);
    }
  }

  // Add import bookmarks logic to popup.js
  async function getAllBookmarks() {
    return new Promise((resolve) => {
      chrome.bookmarks.getTree((nodes) => {
        const flat = [];
        function traverse(node, parentCategory) {
          if (node.url && node.title) {
            flat.push({
              url: node.url,
              title: node.title,
              category: parentCategory || 'Other'
            });
          }
          if (node.children) {
            node.children.forEach(child => traverse(child, node.title || parentCategory));
          }
        }
        nodes.forEach(n => traverse(n, 'Other'));
        resolve(flat);
      });
    });
  }

  document.getElementById('import-bookmarks').addEventListener('click', async () => {
    const importButton = document.getElementById('import-bookmarks');
    const originalText = importButton.textContent;
    try {
      importButton.disabled = true;
      importButton.textContent = 'Importing...';
      const apiUrl = 'http://localhost:3000/api/bookmarks/import';
      const bookmarks = await getAllBookmarks();
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookmarks)
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Failed to import bookmarks: ${response.status}`);
      }
      const result = await response.json();
      alert(`Import successful!\nImported: ${result.added} bookmarks\nUpdated: ${result.updated} bookmarks`);
    } catch (err) {
      alert('Error importing bookmarks: ' + err.message);
    } finally {
      importButton.disabled = false;
      importButton.textContent = originalText;
    }
  });
});
