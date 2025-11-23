# Fuze Web Clipper - Installation Guide

Complete installation guide for manually installing the Fuze Web Clipper Chrome extension.

## Quick Start

Since the extension is not yet available on Chrome Web Store, follow these steps for manual installation:

1. **Download the Extension**
   - Clone the repository or download the `BookmarkExtension` folder
   - Ensure you have the complete folder with all files

2. **Extract (if zipped)**
   - Extract the zip file to a convenient location
   - You should have a `BookmarkExtension` folder

3. **Load in Chrome**
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (top-right toggle)
   - Click "Load unpacked"
   - Select the `BookmarkExtension` folder
   - Extension is now installed!

4. **Configure**
   - Click the extension icon
   - Go to Settings
   - Enter API URL: `https://Ujjwaljain16-fuze-backend.hf.space`
   - Login with your Fuze credentials
   - Save settings

## Detailed Instructions

### Step 1: Get the Extension Files

**Option A: From GitHub**
```bash
# Clone the repository
git clone https://github.com/yourusername/fuze.git
cd fuze/BookmarkExtension
```

**Option B: Download ZIP**
1. Download the repository as ZIP
2. Extract the archive
3. Navigate to `BookmarkExtension` folder

### Step 2: Verify Files

Make sure the `BookmarkExtension` folder contains:
- ✅ `MANIFEST.JSON` (must be present)
- ✅ `background.js`
- ✅ `content.js`
- ✅ `popup/` folder (with popup.html, popup.js, popup.css)
- ✅ `icons/` folder (with icon files)

### Step 3: Load Extension in Chrome

1. **Open Chrome Extensions Page**
   - Type `chrome://extensions/` in the address bar
   - Or: Menu (⋮) → Extensions → Manage Extensions

2. **Enable Developer Mode**
   - Toggle "Developer mode" switch in the top-right corner
   - You should see new buttons appear

3. **Load Unpacked Extension**
   - Click "Load unpacked" button
   - Navigate to and **select the `BookmarkExtension` folder**
   - ⚠️ **Important**: Select the folder that contains `MANIFEST.JSON` directly

4. **Verify Installation**
   - The extension should appear in your extensions list
   - You should see the Fuze Web Clipper icon in your toolbar

### Step 4: Configure Extension

1. **Open Extension Popup**
   - Click the Fuze Web Clipper icon in your Chrome toolbar

2. **Go to Settings**
   - Click "Settings" link in the popup

3. **Enter Configuration**
   - **API URL**: `https://Ujjwaljain16-fuze-backend.hf.space`
   - **Email**: Your Fuze account email
   - **Password**: Your Fuze account password

4. **Login**
   - Click "Login to Fuze"
   - You should see "Connected to Fuze" status

5. **Optional Settings**
   - Enable "Auto-sync Chrome bookmarks" if desired
   - Click "Save Settings"

### Step 5: Test the Extension

1. **Save Current Page**
   - Navigate to any webpage
   - Click the extension icon
   - Click "Save to Fuze"
   - Should see success message

2. **Use Context Menu**
   - Right-click on any link
   - Select "Save to Fuze"
   - Should see notification

3. **Import Bookmarks** (Optional)
   - Open extension popup
   - Go to Settings
   - Click "Import All Bookmarks"
   - Wait for import to complete

## Troubleshooting

### Extension Not Loading

**Problem**: Extension doesn't appear after "Load unpacked"

**Solutions**:
- Make sure you selected the correct folder (should contain `MANIFEST.JSON`)
- Check Chrome console for errors: `chrome://extensions/` → Extension → "Errors"
- Verify all files are present in the folder
- Try reloading the extension

### "Invalid manifest" Error

**Problem**: Chrome shows "Invalid manifest" error

**Solutions**:
- Check that `MANIFEST.JSON` exists and is valid JSON
- Verify manifest version is 3
- Check file permissions

### Can't Connect to Fuze

**Problem**: Extension shows "Cannot connect to server"

**Solutions**:
- Verify API URL is correct: `https://Ujjwaljain16-fuze-backend.hf.space`
- Check that backend is running
- Verify your internet connection
- Check browser console for CORS errors

### Login Not Working

**Problem**: Can't login with credentials

**Solutions**:
- Verify you're using the same email/password as your Fuze web account
- Check that API URL is correct
- Try logging in on the web first to verify credentials
- Check extension console for errors

### Auto-Sync Not Working

**Problem**: Chrome bookmarks not syncing to Fuze

**Solutions**:
- Verify "Auto-sync Chrome bookmarks" is enabled in settings
- Check that you're logged in
- Check browser console for errors
- Try manually saving a bookmark first

## Production URLs

The extension is pre-configured with these production URLs:

- **Frontend**: `https://itsfuze.vercel.app`
- **Backend API**: `https://Ujjwaljain16-fuze-backend.hf.space`

These are set as defaults, so you only need to log in with your credentials.

## Development URLs

For local development, you can change the API URL in settings to:
- `http://localhost:5000` (backend)
- `http://localhost:5173` (frontend)

## Features

Once installed and configured, the extension provides:

- ✅ **One-click bookmarking** - Save any webpage instantly
- ✅ **Context menu integration** - Right-click to save links
- ✅ **Auto-sync** - Automatically sync Chrome bookmarks
- ✅ **Bulk import** - Import all existing Chrome bookmarks
- ✅ **Smart extraction** - Automatically extracts page content
- ✅ **Real-time notifications** - Get feedback on operations

## Support

If you encounter issues:

1. Check this installation guide
2. Review the troubleshooting section
3. Check browser console for errors
4. Verify backend is accessible
5. Ensure you're using the latest extension version

## Next Steps

After installation:

1. ✅ Test saving a bookmark
2. ✅ Try the context menu
3. ✅ Import your Chrome bookmarks (optional)
4. ✅ Enable auto-sync (optional)
5. ✅ Start using Fuze!

---

**Enjoy using Fuze Web Clipper!** 🚀

