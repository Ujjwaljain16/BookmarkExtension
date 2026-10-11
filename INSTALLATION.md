# Installing Fuze Web Clipper

The extension is not on the Chrome Web Store yet; install it unpacked.

1. Download `fuze-web-clipper.zip` from the Fuze website (Extension page) and extract it, or
   clone https://github.com/Ujjwaljain16/BookmarkExtension.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the folder that contains `manifest.json`.
4. Sign in on https://itsfuze.vercel.app; the extension picks up the sign-in. Or open the
   extension's **Settings** and sign in with email and password.

Nothing else needs configuring: the extension uses the Fuze API by default.

## Updating

Replace the folder with the new version and click the reload icon on the extension's card in
`chrome://extensions`. After updating from 1.0, sign in again once (1.0 sessions could not be
refreshed and are dropped).

## Troubleshooting

- **"Manifest file is missing or unreadable"**: select the folder that directly contains
  `manifest.json`.
- **"Not connected"**: sign in on the Fuze website or in Settings. If you changed the API server
  in Settings, check it or click **Use Fuze**.
- **Saved without page content**: some pages (Chrome Web Store, the PDF viewer, browser pages)
  can't be read by extensions; the bookmark is saved and the server fetches the page itself.
- Errors from the extension appear on its card in `chrome://extensions` (service worker link).
