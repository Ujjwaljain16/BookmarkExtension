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
      const description = document.getElementById('description').value;
      const category = document.getElementById('category').value;
      const tags = document.getElementById('tags').value.split(',').map(tag => tag.trim()).filter(Boolean);
      
      // Get favicon
      let favicon = null;
      try {
        const faviconUrl = new URL(url);
        favicon = `${faviconUrl.origin}/favicon.ico`;
      } catch (e) {
        console.warn('Could not generate favicon URL:', e);
      }
      
      const bookmarkData = {
        url,
        title,
        description,
        favicon,
        category,
        tags,
        source: 'extension'
      };
      
      sendBookmark(data.apiUrl, bookmarkData, data.apiKey);
    });
  });
  
  function sendBookmark(apiUrl, bookmarkData, apiKey) {
    console.log('Sending bookmark to:', apiUrl);
    console.log('Bookmark data:', bookmarkData);
    
    statusMessage.textContent = 'Sending...';
    statusMessage.className = 'status';
    
    fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
      },
      body: JSON.stringify(bookmarkData)
    })
    .then(response => {
      if (!response.ok) {
        return response.json().then(err => {
          throw new Error(err.message || `HTTP error! status: ${response.status}`);
        });
      }
      return response.json();
    })
    .then(data => {
      showStatus('Bookmark saved successfully!', 'success');
      console.log('Success:', data);
      
      // Clear form fields except URL (which is readonly)
      document.getElementById('description').value = '';
      document.getElementById('tags').value = '';
      document.getElementById('category').value = 'other';
    })
    .catch(error => {
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
    });
  }
  
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
});
