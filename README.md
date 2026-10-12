# Fuze Web Clipper

Chrome (MV3) extension for [Fuze](https://itsfuze.vercel.app): save the page you are on, sync
Chrome bookmarks, and import existing ones.

## Features

- **Save the current page** from the popup or the context menu ("Save page to Fuze" /
  "Save link to Fuze").
- **Page capture**: when you save the page you are on, the extension sends its rendered text
  (and a cleaned copy of the main content) with the save, so pages behind a login or built by
  scripts are searchable. Only on an explicit save; can be turned off in the options.
- **Auto-sync**: new Chrome bookmarks are saved to Fuze; removing one deletes it from Fuze (by
  id, resolved from the exact URL) unless another Chrome bookmark still points at the page.
- **Bulk import** of all Chrome bookmarks, in batches, from the options page.

## Signing in

Sign in on the Fuze website and the extension follows: the bridge content script (only on
`https://itsfuze.vercel.app`) hands the web session to the service worker, which exchanges it at
`POST /api/auth/fork-session` for a session of its own. You can also sign in with email and
password on the options page. Signing out on the website signs the extension out for the same
account.

Sessions refresh themselves (`POST /api/auth/refresh` with the refresh token; tokens rotate).
The access token is kept in `chrome.storage.session`, the refresh token in `chrome.storage.local`.

## Settings (options page)

- **API server**: empty means Fuze (`https://ujjwaljain16-fuze-backend.hf.space`). Another
  https server can be set; the extension asks for permission to reach it and you sign in again.
- **Preview deployments**: opt in to accept sign-ins from this project's Vercel previews.
- **Page content**, **auto-sync**, **import**.

## Permissions

`bookmarks`, `storage`, `activeTab` (the tab you save), `scripting` (page capture on save, and the
optional preview bridge), `notifications`, `contextMenus`, `alarms` (retries a token refresh if
Chrome stops the extension mid-request), and host access to the Fuze API only.
Other hosts are optional and requested at runtime.

## Development

- Load unpacked: `chrome://extensions` → Developer mode → Load unpacked → this folder.
- Tests: `npm test` (Node 20+, no dependencies).
- Local servers: set `DEV_BUILD = true` in `lib/config.js` (never in a release); the options page
  then accepts `http://localhost` API servers and sign-ins from local dev servers.
- Releases are built by the Fuze repository from a pinned commit of this repository; see its docs.
