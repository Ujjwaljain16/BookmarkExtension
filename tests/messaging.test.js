'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../lib/config.js');
const { classifySender, isActionAllowed } = require('../lib/messaging.js');

const RUNTIME_ID = 'abcdefghijklmnopabcdefghijklmnop';
const EXT_ORIGIN = `chrome-extension://${RUNTIME_ID}`;
const ctx = { runtimeId: RUNTIME_ID, extensionOrigin: EXT_ORIGIN, devBuild: false, allowPreviews: false };

const PREVIEWS = [
  'https://itsfuze-abc123-ujjwaljain16s-projects.vercel.app',
  'https://itsfuze-git-feature-x-ujjwaljain16s-projects.vercel.app',
];

test('only the Fuze web app is a Fuze web origin', () => {
  assert.ok(config.isFuzeWebOrigin('https://itsfuze.vercel.app', { devBuild: false }));
  for (const origin of [
    'http://itsfuze.vercel.app', 'https://itsfuze.vercel.app.evil.com', 'https://evil.vercel.app',
    'https://itsfuze-evil.vercel.app',              // anyone can create a Vercel project with this name
    'https://notitsfuze-abc-ujjwaljain16s-projects.vercel.app',
    'https://itsfuze-abc-ujjwaljain16s-projects.vercel.app.evil.com',
    'http://localhost:5173', null, undefined, '',
  ]) {
    assert.equal(config.isFuzeWebOrigin(origin, { devBuild: false, allowPreviews: true }), false, String(origin));
  }
});

test('previews count only when the user opted in', () => {
  for (const origin of PREVIEWS) {
    assert.equal(config.isFuzeWebOrigin(origin, { devBuild: false }), false);
    assert.ok(config.isFuzeWebOrigin(origin, { devBuild: false, allowPreviews: true }), origin);
  }
});

test('local dev servers count only in dev builds', () => {
  assert.equal(config.isFuzeWebOrigin('http://localhost:5173', { devBuild: false }), false);
  assert.ok(config.isFuzeWebOrigin('http://localhost:5173', { devBuild: true }));
  assert.equal(config.isFuzeWebOrigin('http://localhost:8080', { devBuild: true }), false);
});

test('our own extension pages are "extension"', () => {
  const sender = { id: RUNTIME_ID, url: `${EXT_ORIGIN}/popup/popup.html`, origin: EXT_ORIGIN };
  assert.equal(classifySender(sender, ctx), 'extension');
});

test('the bridge in the top frame of the Fuze app is "fuze-web"', () => {
  const sender = { id: RUNTIME_ID, tab: { id: 3 }, frameId: 0, url: 'https://itsfuze.vercel.app/dashboard', origin: 'https://itsfuze.vercel.app' };
  assert.equal(classifySender(sender, ctx), 'fuze-web');
  // origin missing on older Chrome: fall back to the URL
  assert.equal(classifySender({ ...sender, origin: undefined }, ctx), 'fuze-web');
});

test('everything else is rejected', () => {
  const cases = {
    'another extension': { id: 'someotherextensionidxxxxxxxxxxxx', url: 'chrome-extension://someotherextensionidxxxxxxxxxxxx/x.html' },
    'no sender id': { url: `${EXT_ORIGIN}/popup/popup.html` },
    'our id but a foreign page URL': { id: RUNTIME_ID, url: 'https://evil.example/' },
    'a lookalike extension origin': { id: RUNTIME_ID, url: `${EXT_ORIGIN}.evil/popup.html` },
    'a content script on another site': { id: RUNTIME_ID, tab: { id: 1 }, frameId: 0, url: 'https://evil.example/', origin: 'https://evil.example' },
    'an iframe inside the Fuze app': { id: RUNTIME_ID, tab: { id: 1 }, frameId: 7, url: 'https://itsfuze.vercel.app/', origin: 'https://itsfuze.vercel.app' },
    'a preview without opt-in': { id: RUNTIME_ID, tab: { id: 1 }, frameId: 0, origin: PREVIEWS[0], url: PREVIEWS[0] + '/' },
    'a page claiming the Fuze URL with a foreign origin': { id: RUNTIME_ID, tab: { id: 1 }, frameId: 0, url: 'https://itsfuze.vercel.app/', origin: 'https://evil.example' },
  };
  for (const [name, sender] of Object.entries(cases)) {
    assert.equal(classifySender(sender, ctx), null, name);
  }
  assert.equal(classifySender(null, ctx), null);
});

test('web pages may only hand over or end a sign-in', () => {
  assert.ok(isActionAllowed('webSession', 'fuze-web'));
  assert.ok(isActionAllowed('webSignedOut', 'fuze-web'));
  for (const action of ['saveTab', 'signOut', 'startImport', 'getStatus', 'setSettings']) {
    assert.equal(isActionAllowed(action, 'fuze-web'), false, action);
    assert.ok(isActionAllowed(action, 'extension'), action);
  }
  assert.equal(isActionAllowed('webSession', 'extension'), false);
  assert.equal(isActionAllowed('getStatus', null), false);
  assert.equal(isActionAllowed(undefined, 'extension'), false);
});
