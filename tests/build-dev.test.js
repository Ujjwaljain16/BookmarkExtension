'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { devConfig, devManifest, localOrigin } = require('../scripts/build-dev.js');

const ROOT = path.resolve(__dirname, '..');
const LOCAL = { api: 'http://127.0.0.1:5000', web: 'http://localhost:5173' };

function loadConfig(source) {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(source, sandbox);
  return sandbox.module.exports;
}

test('the dev config points at the local servers and accepts their sign-ins', () => {
  const source = fs.readFileSync(path.join(ROOT, 'lib', 'config.js'), 'utf8');
  const config = loadConfig(devConfig(source, LOCAL));
  assert.equal(config.DEV_BUILD, true);
  assert.equal(config.DEFAULT_API_BASE, LOCAL.api);
  assert.equal(config.FUZE_WEB_ORIGIN, LOCAL.web);
  assert.ok(config.isFuzeWebOrigin('http://localhost:5173'));
  assert.ok(config.isFuzeWebOrigin('http://127.0.0.1:5173'));
  // The release config is untouched.
  assert.equal(loadConfig(source).DEV_BUILD, false);
});

test('the dev manifest may reach the local API and runs the bridge on the local web app', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const dev = devManifest(manifest, LOCAL);
  assert.ok(dev.host_permissions.includes('http://127.0.0.1:5000/*'));
  const bridge = dev.content_scripts.find((s) => s.js.includes('content/fuze-bridge.js'));
  assert.ok(bridge.matches.includes('http://localhost:5173/*') && bridge.matches.includes('http://127.0.0.1:5173/*'));
  assert.match(dev.name, /\(dev\)$/);
  assert.ok(!manifest.host_permissions.includes('http://127.0.0.1:5000/*'), 'release manifest unchanged');
});

test('only local http addresses are accepted for a dev build', () => {
  assert.equal(localOrigin('http://127.0.0.1:5000/', 'x'), 'http://127.0.0.1:5000');
  assert.throws(() => localOrigin('https://evil.example', 'x'));
  assert.throws(() => localOrigin('http://192.168.1.5:5000', 'x'));
});
