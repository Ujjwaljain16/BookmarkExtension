'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('manifest is MV3 with the required fields', () => {
  assert.equal(manifest.manifest_version, 3);
  for (const field of ['name', 'version', 'description', 'action', 'background', 'icons']) {
    assert.ok(manifest[field], `missing ${field}`);
  }
  assert.match(manifest.version, /^\d+(\.\d+){0,3}$/);
  assert.ok(manifest.background.service_worker, 'MV3 uses a service worker, not background pages');
  assert.equal(manifest.background.scripts, undefined);
  assert.equal(manifest.background.persistent, undefined);
});

test('every file the manifest names exists', () => {
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_ui && manifest.options_ui.page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon || {}),
    ...(manifest.content_scripts || []).flatMap((cs) => cs.js || []),
  ].filter(Boolean);
  for (const file of files) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`);
  }
});

test('the file is named manifest.json exactly (Chrome on Linux and macOS is case-sensitive)', () => {
  assert.ok(fs.readdirSync(root).includes('manifest.json'));
});
