'use strict';
// Runs content/fuze-bridge.js against a fake page to check what it reports to the extension.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'content', 'fuze-bridge.js'), 'utf8');
const config = require('../lib/config.js');

function loadBridge({ origin = 'https://itsfuze.vercel.app', top = true, user = null } = {}) {
  const store = new Map(user ? [['user', JSON.stringify(user)]] : []);
  const sent = [];
  const listeners = {};
  const intervals = [];
  const window = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: (type) => { delete listeners[type]; },
  };
  window.top = top ? window : {};
  const sandbox = {
    window,
    self: { FuzeConfig: config },
    location: { origin },
    document: { hidden: false, addEventListener: (type, fn) => { listeners[type] = fn; }, removeEventListener: () => {} },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null) },
    chrome: { runtime: { id: 'ext', sendMessage: (m) => { sent.push(JSON.parse(JSON.stringify(m))); return Promise.resolve(); } } },
    setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    clearInterval: () => {},
    JSON,
    atob,
  };
  vm.runInNewContext(source, sandbox);
  return {
    sent,
    setUser(value) { if (value) store.set('user', JSON.stringify(value)); else store.delete('user'); },
    tick() { intervals.forEach((fn) => fn()); },
  };
}

function jwt(claims) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256' })}.${enc(claims)}.sig`;
}
const REFRESH_1 = jwt({ sub: '7', jti: '1' });
const REFRESH_2 = jwt({ sub: '7', jti: '2' });
const USER = { id: 7, access_token: 'access-1', refresh_token: REFRESH_1 };

test('reports a signed-in session on load', () => {
  const page = loadBridge({ user: USER });
  assert.deepEqual(page.sent, [{ action: 'webSession', accessToken: 'access-1', refreshToken: REFRESH_1 }]);
});

test('says nothing on a page that was never signed in', () => {
  const page = loadBridge();
  page.tick();
  assert.deepEqual(page.sent, []);
});

test('reports sign-in, token rotation and sign-out as they happen, once each', () => {
  const page = loadBridge();
  page.setUser(USER);
  page.tick();
  page.tick();
  page.setUser({ ...USER, access_token: 'access-2', refresh_token: REFRESH_2 });
  page.tick();
  page.setUser(null);
  page.tick();
  page.tick();
  assert.deepEqual(page.sent.map((m) => [m.action, m.refreshToken || m.userId]), [
    ['webSession', REFRESH_1], ['webSession', REFRESH_2], ['webSignedOut', '7'],
  ]);
});

test('does nothing on other sites or inside frames', () => {
  assert.deepEqual(loadBridge({ origin: 'https://evil.vercel.app', user: USER }).sent, []);
  assert.deepEqual(loadBridge({ origin: 'https://itsfuze-evil.vercel.app', user: USER }).sent, []);
  assert.deepEqual(loadBridge({ top: false, user: USER }).sent, []);
});

test('ignores a malformed session', () => {
  const page = loadBridge({ user: { access_token: 42, refresh_token: { x: 1 } } });
  assert.deepEqual(page.sent, []);
});
