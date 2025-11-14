// Add processBookmarkFromExtension directly here
async function processBookmarkFromExtension({ title, url, description = '', category = 'other', tags = '' }) {
  const { apiUrl } = await chrome.storage.local.get('apiUrl');
  const authToken = await chrome.storage.local.get('authToken').then(data => data.authToken);
  
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

document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('bookmark-form');
  const statusMessage = document.getElementById('status-message');
  const settingsLink = document.getElementById('settings-link');
  const backButton = document.getElementById('back-button');
  const saveSettingsButton = document.getElementById('save-settings');
  const loginButton = document.getElementById('login-btn');
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
  chrome.storage.local.get(['apiUrl', 'authToken', 'autoSync'], function(data) {
    if (data.apiUrl) {
      document.getElementById('api-url').value = data.apiUrl;
    }
    
    if (data.authToken) {
      connectionStatus.textContent = 'Connected to Fuze';
      connectionStatus.style.color = '#047857';
    } else {
      connectionStatus.textContent = 'Not authenticated';
      connectionStatus.style.color = '#dc2626';
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
  
  // Login to Fuze
  loginButton.addEventListener('click', async function(e) {
    e.preventDefault();
    
    const apiUrl = document.getElementById('api-url').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    
    if (!apiUrl || !email || !password) {
      alert('Please fill in all fields');
      return;
    }
    
    try {
      loginButton.disabled = true;
      loginButton.textContent = 'Logging in...';
      
      const response = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Login failed');
      }
      
      const data = await response.json();
      
      // Store auth token and settings
      await chrome.storage.local.set({ authToken: data.access_token });
      await chrome.storage.local.set({ apiUrl: apiUrl });
      
      connectionStatus.textContent = 'Connected to Fuze';
      connectionStatus.style.color = '#047857';
      
      showStatus('Successfully logged in to Fuze!', 'success');
      
      // Clear password field
      document.getElementById('password').value = '';
      
    } catch (error) {
      console.error('Login error:', error);
      showStatus('Login failed: ' + error.message, 'error');
    } finally {
      loginButton.disabled = false;
      loginButton.textContent = 'Login to Fuze';
    }
  });
  
  // Save settings
  saveSettingsButton.addEventListener('click', function(e) {
    e.preventDefault();
    
    const apiUrl = document.getElementById('api-url').value.trim();
    const autoSync = autoSyncCheckbox.checked;
    
    if (!apiUrl) {
      alert('Please enter a valid API URL');
      return;
    }
    
    chrome.storage.local.set({
      apiUrl: apiUrl,
      autoSync: autoSync
    }, function() {
      showStatus('Settings saved successfully', 'success');
    });
  });
  
  // Test server connection
  async function testServerConnection(apiUrl) {
    const baseUrl = apiUrl.replace('/api', '');
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
    
    chrome.storage.local.get(['apiUrl', 'authToken'], async function(data) {
      if (!data.apiUrl) {
        showStatus('Please configure API URL in settings', 'error');
        return;
      }
      
      if (!data.authToken) {
        showStatus('Please log in to Fuze in settings', 'error');
        return;
      }
      
      // Test server connection first
      const isConnected = await testServerConnection(data.apiUrl);
      if (!isConnected) {
        showStatus('Could not connect to Fuze. Please check if the server is running and the API URL is correct.', 'error');
        return;
      }
      
      const url = document.getElementById('url').value;
      const title = document.getElementById('title').value;
      const description = document.getElementById('description').value;
      const category = document.getElementById('category').value;
      const tags = document.getElementById('tags').value;
      
      try {
        const saved = await processBookmarkFromExtension({ 
          title, 
          url, 
          description, 
          category, 
          tags 
        });
        
        showStatus('Bookmark saved successfully!', 'success');
        
        // Clear form fields except URL (which is readonly)
        document.getElementById('description').value = '';
        document.getElementById('tags').value = '';
        document.getElementById('category').value = 'other';
      } catch (error) {
        console.error('Error details:', error);
        let errorMessage = 'Error saving bookmark. ';
        
        if (error.message.includes('Failed to fetch')) {
          errorMessage += 'Could not connect to Fuze. Please check if the server is running and the API URL is correct.';
        } else if (error.message.includes('Not authenticated')) {
          errorMessage = 'Please log in to Fuze in the settings.';
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
      const { apiUrl, authToken } = await chrome.storage.local.get(['apiUrl', 'authToken']);
      
      if (!apiUrl) {
        alert('Please configure API URL in settings');
        return;
      }
      
      if (!authToken) {
        alert('Please log in to Fuze first');
        return;
      }
      
      importButton.disabled = true;
      importButton.textContent = 'Importing...';
      
      const bookmarks = await getAllBookmarks();
      const response = await fetch(`${apiUrl}/api/bookmarks/import`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
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
