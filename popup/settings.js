document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('settingsForm');
  const status = document.getElementById('status');
  
  // Load saved settings
  const settings = await chrome.storage.sync.get(['apiUrl', 'apiKey', 'autoSync']);
  
  // Populate form with saved settings
  document.getElementById('apiUrl').value = settings.apiUrl || '';
  document.getElementById('apiKey').value = settings.apiKey || '';
  document.getElementById('autoSync').checked = settings.autoSync !== false;
  
  // Handle form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const apiUrl = document.getElementById('apiUrl').value;
    const apiKey = document.getElementById('apiKey').value;
    const autoSync = document.getElementById('autoSync').checked;
    
    try {
      // Save settings
      await chrome.storage.sync.set({
        apiUrl,
        apiKey,
        autoSync
      });
      
      // Show success message
      status.textContent = 'Settings saved successfully!';
      status.className = 'status success';
      status.style.display = 'block';
      
      // Hide message after 3 seconds
      setTimeout(() => {
        status.style.display = 'none';
      }, 3000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      
      // Show error message
      status.textContent = 'Failed to save settings. Please try again.';
      status.className = 'status error';
      status.style.display = 'block';
    }
  });

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

  // Add event listener to your import button
  document.getElementById('importBookmarksBtn').addEventListener('click', async () => {
    console.log('Import button clicked!');
    const importButton = document.getElementById('importBookmarksBtn');
    const originalText = importButton.textContent;
    
    try {
      // Always use the import endpoint for bulk import
      const apiUrl = 'http://localhost:3000/api/bookmarks/import';
      const bookmarks = await getAllBookmarks();
      console.log('Bookmarks to import:', bookmarks);

      // Show loading state
      importButton.disabled = true;
      importButton.textContent = 'Importing...';

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
      alert(`Import successful!\nImported: ${result.imported} bookmarks\nUpdated: ${result.updated} bookmarks\nNew: ${result.new} bookmarks`);
    } catch (err) {
      console.error('Error importing bookmarks:', err);
      alert('Error importing bookmarks: ' + err.message);
    } finally {
      // Reset button state
      importButton.disabled = false;
      importButton.textContent = originalText;
    }
  });
}); 