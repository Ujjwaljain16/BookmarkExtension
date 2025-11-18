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
  const authPrompt = document.getElementById('auth-prompt');
  const loginRedirectBtn = document.getElementById('login-redirect-btn');
  const signupRedirectBtn = document.getElementById('signup-redirect-btn');
  const extensionSettingsLink = document.getElementById('extension-settings-link');
  
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

    // Set auto-sync checkbox state
    autoSyncCheckbox.checked = !!data.autoSync;

    // Validate authentication status
    validateAuthentication(data.authToken, data.apiUrl);
  });

  // Function to validate authentication status
  async function validateAuthentication(authToken, apiUrl) {
    if (!apiUrl) {
      showAuthStatus('API URL not configured', '#dc2626', 'settings');
      return;
    }

    if (!authToken) {
      showAuthStatus('Not connected to Fuze', '#dc2626', 'login');
      return;
    }

    try {
      // Test the auth token by making a simple API call
      const response = await fetch(`${apiUrl}/api/auth/verify`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Accept': 'application/json'
        }
      });

      if (response.ok) {
        showAuthStatus('Connected to Fuze', '#047857', 'connected');
      } else {
        // Token is invalid/expired, clear it
        await chrome.storage.local.remove('authToken');
        showAuthStatus('Session expired - please login', '#dc2626', 'login');
      }
    } catch (error) {
      console.error('Auth validation error:', error);
      // If we can't reach the server, assume token is still valid (offline mode)
      showAuthStatus('Connected to Fuze (offline)', '#f59e0b', 'connected');
    }
  }

  // Function to show authentication status with appropriate actions
  function showAuthStatus(message, color, status) {
    const connectionStatus = document.getElementById('connection-status');
    connectionStatus.textContent = message;
    connectionStatus.style.color = color;

    // Remove any existing click handlers
    connectionStatus.onclick = null;
    connectionStatus.style.cursor = 'default';
    connectionStatus.style.textDecoration = 'none';

    // Show/hide auth prompt overlay
    if (status === 'login') {
      authPrompt.style.display = 'flex';
      connectionStatus.style.cursor = 'pointer';
      connectionStatus.style.textDecoration = 'underline';
      connectionStatus.onclick = () => redirectToFuzeLogin();
    } else {
      authPrompt.style.display = 'none';
      if (status === 'settings') {
        connectionStatus.style.cursor = 'pointer';
        connectionStatus.style.textDecoration = 'underline';
        connectionStatus.onclick = () => {
          mainForm.style.display = 'none';
          settingsForm.style.display = 'block';
        };
      }
    }
  }

  // Function to redirect to Fuze login page
  function redirectToFuzeLogin() {
    // Open Fuze login page in a new tab (localhost for development)
    chrome.tabs.create({
      url: 'http://localhost:5173/login',
      active: true
    });

    // Close the extension popup
    window.close();
  }

  // Listen for auth status changes from background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'authStatusChanged') {
      console.log('Popup: Auth status changed, revalidating...');
      // Re-check authentication status when it changes
      chrome.storage.local.get(['authToken', 'apiUrl'], function(data) {
        validateAuthentication(data.authToken, data.apiUrl);
      });
    }
  });

  // Auth prompt button handlers
  loginRedirectBtn.addEventListener('click', function(e) {
    e.preventDefault();
    redirectToFuzeLogin();
  });

  signupRedirectBtn.addEventListener('click', function(e) {
    e.preventDefault();
    redirectToFuzeSignup();
  });

  extensionSettingsLink.addEventListener('click', function(e) {
    e.preventDefault();
    authPrompt.style.display = 'none';
    mainForm.style.display = 'none';
    settingsForm.style.display = 'block';
  });

  // Function to redirect to Fuze signup page
  function redirectToFuzeSignup() {
    chrome.tabs.create({
      url: 'http://localhost:5173/signup',
      active: true
    });
    window.close();
  }
  
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
      importButton.textContent = 'Starting import...';

      const bookmarks = await getAllBookmarks();

      // Start the import
      const importResponse = await fetch(`${apiUrl}/api/bookmarks/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(bookmarks)
      });

      if (!importResponse.ok) {
        const errorData = await importResponse.json();
        throw new Error(errorData.message || `Failed to start import: ${importResponse.status}`);
      }

      // Poll for progress
      let progressInterval = setInterval(async () => {
        try {
          const progressResponse = await fetch(`${apiUrl}/api/bookmarks/import/progress`, {
            headers: {
              'Authorization': `Bearer ${authToken}`
            }
          });

          if (progressResponse.ok) {
            const progress = await progressResponse.json();

            if (progress.status === 'processing') {
              const percent = Math.round((progress.processed / progress.total) * 100);
              importButton.textContent = `Importing... ${progress.processed}/${progress.total} (${percent}%)`;
            } else if (progress.status === 'completed') {
              clearInterval(progressInterval);
              importButton.textContent = 'Import completed!';
              setTimeout(() => {
                alert(`Import successful!\nTotal: ${progress.total}\nAdded: ${progress.added}\nSkipped: ${progress.skipped}\nErrors: ${progress.errors}`);
              }, 500);
            }
          }
        } catch (progressError) {
          console.error('Error checking progress:', progressError);
        }
      }, 2000); // Check every 2 seconds

      // Also wait for the initial response
      const result = await importResponse.json();
      console.log('Import started:', result);

      // Clear interval after 5 minutes as safety measure
      setTimeout(() => {
        clearInterval(progressInterval);
        if (importButton.disabled) {
          importButton.disabled = false;
          importButton.textContent = originalText;
          alert('Import may have completed. Please refresh to check status.');
        }
      }, 300000); // 5 minutes

    } catch (err) {
      console.error('Import error:', err);
      alert('Error importing bookmarks: ' + err.message);
      importButton.disabled = false;
      importButton.textContent = originalText;
    }
  });
});
