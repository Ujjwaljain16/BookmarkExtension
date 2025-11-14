# Fuze Web Clipper - Chrome Extension

A powerful Chrome extension that integrates with your Fuze backend to save, organize, and manage web bookmarks with intelligent content extraction and semantic search capabilities.

## Features

- **One-click bookmarking**: Save any webpage to Fuze with a single click
- **Automatic sync**: Sync Chrome bookmarks with Fuze automatically
- **Bulk import**: Import all existing Chrome bookmarks to Fuze
- **Content extraction**: Automatically extracts and analyzes webpage content
- **Smart categorization**: Organize bookmarks by categories and tags
- **Context menu integration**: Right-click to save links directly to Fuze
- **Real-time notifications**: Get feedback on save/delete operations
- **JWT Authentication**: Secure authentication with your Fuze account

## Installation

### 1. Load the Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked" and select the `BookmarkExtension` folder
4. The Fuze Web Clipper extension should now appear in your extensions list

### 2. Configure the Extension

1. Click on the Fuze Web Clipper extension icon in your Chrome toolbar
2. Click "Settings" in the popup
3. Enter your Fuze API URL (default: `http://localhost:5000`)
4. Enter your Fuze email and password
5. Click "Login to Fuze"
6. Enable "Auto-sync Chrome bookmarks" if desired
7. Click "Save Settings"

## Usage

### Saving Individual Bookmarks

1. Navigate to any webpage you want to save
2. Click the Fuze Web Clipper extension icon
3. The popup will show the current page's URL and title
4. Add an optional description, category, and tags
5. Click "Save to Fuze"

### Using Context Menu

1. Right-click on any link or webpage
2. Select "Save to Fuze" from the context menu
3. The bookmark will be saved automatically

### Bulk Import

1. Open the extension popup
2. Go to Settings
3. Click "Import All Bookmarks"
4. Wait for the import to complete
5. You'll see a summary of imported and updated bookmarks

### Auto-Sync

When enabled, the extension will automatically:
- Save new Chrome bookmarks to Fuze
- Remove bookmarks from Fuze when deleted from Chrome
- Sync bookmark updates

## API Integration

The extension communicates with your Fuze backend through the following endpoints:

- `POST /api/auth/login` - User authentication
- `POST /api/bookmarks` - Save individual bookmark
- `POST /api/bookmarks/import` - Bulk import bookmarks
- `GET /api/bookmarks` - List user's bookmarks
- `DELETE /api/bookmarks/{id}` - Delete bookmark by ID
- `DELETE /api/bookmarks/url/{url}` - Delete bookmark by URL
- `GET /api/health` - Health check endpoint

## Configuration

### Extension Settings

- **API URL**: Your Fuze backend URL (e.g., `http://localhost:5000`)
- **Email**: Your Fuze account email
- **Password**: Your Fuze account password
- **Auto-sync**: Enable/disable automatic Chrome bookmark sync

### Permissions

The extension requires the following permissions:
- `bookmarks` - Access to Chrome bookmarks
- `storage` - Store settings and auth tokens
- `tabs` - Access to current tab information
- `activeTab` - Access to active tab content
- `notifications` - Show operation feedback
- `contextMenus` - Add right-click menu options

## Troubleshooting

### Common Issues

1. **"Not authenticated" error**
   - Make sure you've logged in with correct credentials
   - Check that your Fuze backend is running
   - Verify the API URL is correct

2. **"Could not connect to Fuze" error**
   - Ensure your Fuze backend is running on the specified port
   - Check that the API URL is correct
   - Verify network connectivity

3. **Import fails**
   - Make sure you're logged in
   - Check that the bulk import endpoint is working
   - Verify your Fuze backend has the latest code

4. **Auto-sync not working**
   - Check that auto-sync is enabled in settings
   - Verify you're authenticated
   - Check browser console for errors

### Debug Mode

To enable debug logging:
1. Open Chrome DevTools
2. Go to the Console tab
3. Look for messages from the Fuze Web Clipper extension

## Development

### File Structure

```
BookmarkExtension/
├── MANIFEST.JSON          # Extension manifest
├── background.js          # Background service worker
├── popup/
│   ├── popup.html        # Popup interface
│   ├── popup.js          # Popup logic
│   └── popup.css         # Popup styling
└── icons/
    ├── icon16.png        # 16x16 icon
    ├── icon48.png        # 48x48 icon
    └── icon128.png       # 128x128 icon
```

### Key Components

- **background.js**: Handles bookmark events, context menus, and API communication
- **popup.js**: Manages the popup interface and user interactions
- **popup.html**: Extension popup UI
- **popup.css**: Extension styling

### Testing

Run the integration test script to verify everything works:

```bash
python test_extension_integration.py
```

## Security

- JWT tokens are stored securely in Chrome's sync storage
- All API communication uses HTTPS (in production)
- Passwords are not stored locally
- Authentication tokens are automatically managed

## Support

If you encounter issues:

1. Check the troubleshooting section above
2. Verify your Fuze backend is running and accessible
3. Check the browser console for error messages
4. Ensure you're using the latest version of the extension

## License

This extension is part of the Fuze project and follows the same licensing terms. 