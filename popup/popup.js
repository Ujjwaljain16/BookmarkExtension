// Add processBookmarkFromExtension directly here
async function getApiBase() {
  const { apiBaseOverride } = await chrome.storage.local.get('apiBaseOverride');
  return apiBaseOverride || FuzeConfig.DEFAULT_API_BASE;
}

async function processBookmarkFromExtension({ title, url, description = '', tags = '' }) {
  const apiUrl = await getApiBase();
  const authToken = await chrome.storage.local.get('authToken').then(data => data.authToken);
  
  if (!authToken) {
    throw new Error('Not authenticated. Please log in to Fuze.');
  }
  
  const bookmarkData = { 
    title, 
    url, 
    description,
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
  
  // Initialize lastAuthToken on load
  chrome.storage.local.get(['authToken'], function(data) {
    lastAuthToken = data.authToken || null;
  });

  // Load settings and update connection status
  chrome.storage.local.get(['authToken', 'autoSync'], async function(data) {
    // Set auto-sync checkbox state
    autoSyncCheckbox.checked = !!data.autoSync;
    validateAuthentication(data.authToken, await getApiBase());
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
      const verifyUrl = `${apiUrl}/api/auth/verify`;
      
      const response = await fetch(verifyUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Accept': 'application/json'
        }
      });

      console.log('Auth verification response status:', response.status);

      if (response.ok) {
        showAuthStatus('Connected to Fuze', '#047857', 'connected');
      } else {
        const errorText = await response.text().catch(() => '');
        console.error('Auth verification failed:', response.status, errorText);
        // Token is invalid/expired, clear it
        await chrome.storage.local.remove('authToken');
        showAuthStatus('Session expired - please login', '#dc2626', 'login');
      }
    } catch (error) {
      console.error('Auth validation error:', error);
      console.error('Error details - URL:', apiUrl, 'Error:', error.message);
      // If we can't reach the server, show a helpful error message
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        showAuthStatus('Cannot connect to server - check API URL', '#dc2626', 'settings');
      } else {
        // For other errors, assume token is still valid (offline mode)
        showAuthStatus('Connected to Fuze (offline)', '#f59e0b', 'connected');
      }
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
        connectionStatus.onclick = () => chrome.runtime.openOptionsPage();
      }
    }
  }

  // Function to redirect to Fuze login page
  function redirectToFuzeLogin() {
    // Open Fuze login page in a new tab
    chrome.tabs.create({
      url: FuzeConfig.FUZE_WEB_ORIGIN + '/login',
      active: true
    });

    // Close the extension popup
    window.close();
  }

  // Track if import is in progress to avoid interrupting it
  let importInProgress = false;
  let lastAuthToken = null;

  // Listen for auth status changes from background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'authStatusChanged') {
      // Don't interrupt import in progress
      if (importInProgress) {
        console.log('Popup: Auth status changed, but import in progress - skipping revalidation');
        return;
      }
      
      // Check if token actually changed
      chrome.storage.local.get(['authToken'], function(data) {
        const currentToken = data.authToken;
        if (currentToken === lastAuthToken) {
          console.log('Popup: Auth status changed, but token unchanged - skipping revalidation');
          return;
        }
        
        lastAuthToken = currentToken;
        console.log('Popup: Auth status changed, revalidating...');
        // Re-check authentication status when it changes
        chrome.storage.local.get(['authToken'], async function(data) {
          validateAuthentication(data.authToken, await getApiBase());
        });
      });
    }
  });

  // Auth prompt button handlers
  loginRedirectBtn.addEventListener('click', function(e) {
    e.preventDefault();
    redirectToFuzeLogin();
  });

  const googleAuthBtn = document.getElementById('google-auth-btn');
  if (googleAuthBtn) {
    googleAuthBtn.addEventListener('click', function(e) {
      e.preventDefault();
      redirectToFuzeLogin();
    });
  }

  signupRedirectBtn.addEventListener('click', function(e) {
    e.preventDefault();
    redirectToFuzeSignup();
  });

  document.getElementById('open-options').addEventListener('click', function(e) {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
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
      url: FuzeConfig.FUZE_WEB_ORIGIN + '/signup',
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
    
    const apiUrl = await getApiBase();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email || !password) {
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
      
      // Store auth token
      await chrome.storage.local.set({ authToken: data.access_token });
      
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
    
    const autoSync = autoSyncCheckbox.checked;

    chrome.storage.local.set({
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
    
    chrome.storage.local.get(['authToken'], async function(data) {
      data.apiUrl = await getApiBase();
            
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
      const tags = document.getElementById('tags').value;
      
      try {
        const saved = await processBookmarkFromExtension({ 
          title, 
          url, 
          description, 
          tags 
        });
        
        showStatus('Bookmark saved successfully!', 'success');
        
        // Clear form fields except URL (which is readonly)
        document.getElementById('description').value = '';
        document.getElementById('tags').value = '';
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
      const { authToken } = await chrome.storage.local.get(['authToken']);
      const apiUrl = await getApiBase();

      if (!authToken) {
        alert('Please log in to Fuze first');
        return;
      }

      importButton.disabled = true;
      importButton.textContent = 'Starting import...';
      importInProgress = true; // Mark import as in progress

      // First, test server connectivity
      importButton.textContent = 'Testing connection...';
      try {
        const testResponse = await fetch(`${apiUrl}/api/health`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        });

        if (!testResponse.ok) {
          throw new Error(`Server health check failed: ${testResponse.status}`);
        }

        console.log('Server connection test passed');
      } catch (healthError) {
        console.error('Server health check failed:', healthError);
        alert(`Cannot connect to Fuze server. Please check:\n1. The API URL is correct\n2. The server is running\n3. Your internet connection\n\nError: ${healthError.message}`);
        importButton.disabled = false;
        importButton.textContent = originalText;
        importInProgress = false; // Reset import flag
        return;
      }

      importButton.textContent = 'Loading bookmarks...';
      const bookmarks = await getAllBookmarks();

      // Check if there's already an import in progress
      importButton.textContent = 'Checking status...';
      try {
        const progressResponse = await fetch(`${apiUrl}/api/bookmarks/import/progress`, {
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        });

        if (progressResponse.ok) {
          const progress = await progressResponse.json();
          if (progress.status === 'processing') {
            alert(`An import is already in progress (${progress.processed}/${progress.total} processed). Please wait for it to complete or refresh the page.`);
            importButton.disabled = false;
            importButton.textContent = originalText;
            importInProgress = false; // Reset import flag
            return;
          }
        }
      } catch (statusError) {
        console.log('Could not check import status, proceeding anyway:', statusError.message);
      }

      // Allow user to choose how many bookmarks to import
      let bookmarksToImport = bookmarks;
      const MAX_BOOKMARKS = 1000;

      if (bookmarks.length > MAX_BOOKMARKS) {
        const userChoice = confirm(`You have ${bookmarks.length} bookmarks. For best performance, we recommend importing in batches.\n\nChoose "OK" to import the first ${MAX_BOOKMARKS} bookmarks, or "Cancel" to import all ${bookmarks.length} bookmarks (may take longer).`);

        if (userChoice) {
          // Import only first MAX_BOOKMARKS
          bookmarksToImport = bookmarks.slice(0, MAX_BOOKMARKS);
          console.log(`Limiting import to first ${MAX_BOOKMARKS} bookmarks as requested by user`);
        } else {
          console.log(`User chose to import all ${bookmarks.length} bookmarks`);
        }
      }

      // Start the import
      console.log('Starting import with', bookmarksToImport.length, 'bookmarks');

      // Log a sample of the bookmarks to verify format
      if (bookmarksToImport.length > 0) {
        console.log('Sample bookmark:', bookmarksToImport[0]);
      }

      // Start the import asynchronously - don't wait for completion
      // Use a longer timeout for large imports (30 seconds)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout for starting

      // Start the import request but don't wait for it
      // SSE will handle progress updates regardless of this request's completion
      fetch(`${apiUrl}/api/bookmarks/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(bookmarksToImport),
        signal: controller.signal
      }).then(async (response) => {
        clearTimeout(timeoutId);
        if (!response.ok) {
          let errorMessage = `Failed to start import: ${response.status}`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
          } catch (parseError) {
            try {
              const errorText = await response.text();
              if (errorText) {
                errorMessage = errorText;
              }
            } catch (textError) {
              // Ignore parse errors
            }
          }
          // Show error but SSE will still try to get progress
          console.error('Import start failed:', errorMessage);
        }
        // Success - SSE will handle progress updates
      }).catch((error) => {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          // Timeout on start request - but import may have started anyway
          // SSE connection will handle progress updates, so this is not critical
          // Don't show warning - SSE will handle it
        } else {
          console.error('Import start network error:', error);
        }
      });

      // Use Server-Sent Events (SSE) for real-time progress updates via background script
      importButton.textContent = 'Starting import...';
      let safetyTimeout = null;
      let sseListener = null;
      let sseActive = false; // Track if SSE is actively receiving data
      let pollingInterval = null; // Track polling interval to stop it if SSE works
      let sseConnectionAttempted = false; // Track if we've attempted SSE connection

      // Re-fetch token to ensure we have the latest one
      const latestData = await chrome.storage.local.get(['authToken']);
      const latestAuthToken = latestData.authToken || authToken;
      
      if (!latestAuthToken) {
        console.error('No auth token available for SSE connection');
        throw new Error('No authentication token available');
      }

      try {
        // Mark that we're attempting SSE connection (prevents polling from starting)
        sseConnectionAttempted = true;
        
        // Use background script to make SSE request (has full permissions)
        const messageToSend = {
          action: 'startSSEStream',
          authToken: latestAuthToken
        };
        
        const startResponse = await chrome.runtime.sendMessage(messageToSend).catch(err => {
          console.error('Popup: Failed to send message to background script:', err);
          throw new Error('Failed to communicate with background script: ' + err.message);
        });
        
        if (startResponse && startResponse.error) {
          console.error('Background script error:', startResponse.error);
          throw new Error(startResponse.error);
        }
        
        // Mark SSE as active once connection is established
        sseActive = true;
        
        // Stop any existing polling if SSE is working
        if (pollingInterval) {
          console.log('Popup: Stopping fallback polling - SSE is active');
          clearInterval(pollingInterval);
          pollingInterval = null;
        }

        // Safety timeout - stop after 10 minutes
        safetyTimeout = setTimeout(() => {
          console.warn('Popup: Safety timeout reached (10 minutes)');
          if (sseListener) {
            chrome.runtime.onMessage.removeListener(sseListener);
          }
          if (importButton.disabled) {
            importButton.disabled = false;
            importButton.textContent = originalText;
            importInProgress = false; // Reset import flag
            alert('Import monitoring timed out. The import may still be running on the server. Please refresh to check status.');
          }
          // Remove listener
          if (sseListener) {
            chrome.runtime.onMessage.removeListener(sseListener);
          }
        }, 600000); // 10 minutes

        // Listen for SSE data from background script
        sseListener = (message, sender, sendResponse) => {
          console.log('Popup: Received message from background:', message.action);
          
          if (message.action === 'sseStreamStarted') {
            sseActive = true; // Mark SSE as active when stream starts
            // Stop any polling that might have started
            if (pollingInterval) {
              clearInterval(pollingInterval);
              pollingInterval = null;
            }
          } else if (message.action === 'sseData') {
            sseActive = true; // Confirm SSE is working
            
            // Stop polling if it's running
            if (pollingInterval) {
              console.log('Popup: Stopping fallback polling - SSE is receiving data');
              clearInterval(pollingInterval);
              pollingInterval = null;
            }

            try {
              const data = JSON.parse(message.data);
              console.log('Progress update:', data);

              if (data.status === 'waiting') {
                importButton.textContent = 'Waiting for import to start...';
              } else if (data.status === 'processing') {
                const percent = Math.round((data.processed / data.total) * 100);
                importButton.textContent = `Importing... ${data.processed}/${data.total} (${percent}%)`;
              } else if (data.status === 'completed') {
                clearTimeout(safetyTimeout);
                importButton.textContent = 'Import completed!';
                importButton.disabled = false;
                importInProgress = false; // Reset import flag
                
                setTimeout(() => {
                  alert(`Import successful!\nTotal: ${data.total}\nAdded: ${data.added}\nSkipped: ${data.skipped}\nErrors: ${data.errors}`);
                  importButton.textContent = originalText;
                }, 500);
                
                // Remove listener
                if (sseListener) {
                  chrome.runtime.onMessage.removeListener(sseListener);
                }
              } else if (data.status === 'no_import' || data.status === 'error') {
                console.warn('Progress stream error:', data.message);
                if (data.stream_closing) {
                  if (sseListener) {
                    chrome.runtime.onMessage.removeListener(sseListener);
                  }
                }
              }
            } catch (parseError) {
              console.error('Error parsing SSE data:', parseError, 'Data:', message.data);
            }
          } else if (message.action === 'sseStreamClosed') {
            console.log('Progress stream closed');
            if (importButton.disabled && !importButton.textContent.includes('completed')) {
              importButton.disabled = false;
              importButton.textContent = originalText;
              importInProgress = false; // Reset import flag
            }
            if (sseListener) {
              chrome.runtime.onMessage.removeListener(sseListener);
            }
          } else if (message.action === 'sseError') {
            console.error('SSE stream error:', message.error);
            if (importButton.disabled) {
              importButton.textContent = 'Importing... (connection lost)';
              // Fallback to polling if SSE fails
              if (sseListener) {
                chrome.runtime.onMessage.removeListener(sseListener);
              }
              fallbackToPolling();
            }
          }
        };

        chrome.runtime.onMessage.addListener(sseListener);

      } catch (streamError) {
        console.error('Popup: Failed to establish SSE connection:', streamError);
        console.error('Popup: SSE Error details:', {
          message: streamError.message,
          name: streamError.name,
          stack: streamError.stack
        });
        // Fall back to polling
        console.warn('Popup: SSE connection failed, falling back to polling');
        fallbackToPolling();
      }

      // Fallback function to use polling if SSE fails
      function fallbackToPolling() {
        // Don't start polling if SSE is already active or connection was attempted
        if (sseActive || sseConnectionAttempted) {
          // Wait a bit to see if SSE data arrives
          setTimeout(() => {
            // Only start polling if SSE still hasn't received data after 3 seconds
            if (!sseActive && !pollingInterval) {
              console.log('Using fallback polling method (SSE did not receive data)');
              startPolling();
            }
          }, 3000);
          return;
        }
        
        // Don't start if polling is already running
        if (pollingInterval) {
          return;
        }
        
        console.log('Using fallback polling method');
        startPolling();
      }
      
      function startPolling() {
        if (pollingInterval) {
          return; // Already polling
        }
        pollingInterval = setInterval(async () => {
          try {
            const progressResponse = await fetch(`${apiUrl}/api/bookmarks/import/progress`, {
              headers: {
                'Authorization': `Bearer ${authToken}`
              }
            });

            if (progressResponse.ok) {
              const progress = await progressResponse.json();
              console.log('Progress update (polling):', progress);

              if (progress.status === 'processing') {
                const percent = Math.round((progress.processed / progress.total) * 100);
                importButton.textContent = `Importing... ${progress.processed}/${progress.total} (${percent}%)`;
              } else if (progress.status === 'completed') {
                if (pollingInterval) {
                  clearInterval(pollingInterval);
                  pollingInterval = null;
                }
                clearTimeout(safetyTimeout);
                importButton.textContent = 'Import completed!';
                importButton.disabled = false;
                importInProgress = false; // Reset import flag

                setTimeout(() => {
                  alert(`Import successful!\nTotal: ${progress.total}\nAdded: ${progress.added}\nSkipped: ${progress.skipped}\nErrors: ${progress.errors}`);
                  importButton.textContent = originalText;
                }, 500);
              }
            } else if (progressResponse.status === 404) {
              console.log('No import progress found - import may not have started yet');
              importButton.textContent = 'Waiting for import to start...';
            }
          } catch (progressError) {
            console.error('Error checking progress:', progressError);
            importButton.textContent = 'Importing... (checking progress)';
          }
        }, 5000); // Check every 5 seconds (less frequent to reduce load)

        // Safety timeout for polling
        if (!safetyTimeout) {
          safetyTimeout = setTimeout(() => {
            if (pollingInterval) {
              clearInterval(pollingInterval);
              pollingInterval = null;
            }
            if (importButton.disabled) {
              importButton.disabled = false;
              importButton.textContent = originalText;
              importInProgress = false; // Reset import flag
              alert('Import monitoring timed out. The import may still be running on the server. Please refresh to check status.');
            }
          }, 600000); // 10 minutes
        }
      }

    } catch (err) {
      console.error('Import error:', err);
      alert('Error importing bookmarks: ' + err.message);
      importButton.disabled = false;
      importButton.textContent = originalText;
      importInProgress = false; // Reset import flag
    }
  });
});
