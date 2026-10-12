#!/usr/bin/env node
// Build a copy of the extension for local development in dev-build/: it talks to the local
// backend (http://127.0.0.1:5000) and takes its sign-in from the local web app
// (http://localhost:5173). Load dev-build/ with "Load unpacked". The release files are untouched.
//
//   npm run build:dev                                   # defaults above
//   FUZE_DEV_API=http://127.0.0.1:8000 FUZE_DEV_WEB=http://localhost:3000 npm run build:dev
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dev-build');
const RUNTIME = ['manifest.json', 'background.js', 'content', 'lib', 'options', 'popup', 'icons'];

function localOrigin(value, name) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`${name} must be an http://localhost or http://127.0.0.1 address, got ${value}`);
  }
  return url.origin;
}

/** The release config with the dev switch on and the local addresses as defaults. */
function devConfig(source, { api, web }) {
  const replace = (text, pattern, value) => {
    if (!pattern.test(text)) throw new Error(`lib/config.js no longer matches ${pattern}`);
    return text.replace(pattern, value);
  };
  let out = replace(source, /const DEV_BUILD = false;/, 'const DEV_BUILD = true;');
  out = replace(out, /const DEFAULT_API_BASE = '[^']*';/, `const DEFAULT_API_BASE = '${api}';`);
  out = replace(out, /const FUZE_WEB_ORIGIN = '[^']*';/, `const FUZE_WEB_ORIGIN = '${web}';`);
  return out;
}

/** The release manifest plus permission for the local API and the bridge on the local web app. */
function devManifest(manifest, { api, web }) {
  const dev = JSON.parse(JSON.stringify(manifest));
  dev.name = `${manifest.name} (dev)`;
  dev.host_permissions = [...new Set([...manifest.host_permissions, `${api}/*`])];
  const webPatterns = [`${web}/*`];
  const alt = web.includes('localhost') ? web.replace('localhost', '127.0.0.1') : web.replace('127.0.0.1', 'localhost');
  webPatterns.push(`${alt}/*`);
  dev.content_scripts = manifest.content_scripts.map((script) => (
    script.js.includes('content/fuze-bridge.js')
      ? { ...script, matches: [...new Set([...script.matches, ...webPatterns])] }
      : script
  ));
  return dev;
}

function copy(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) copy(path.join(src, entry), path.join(dest, entry));
  } else if (!src.endsWith('.md')) {
    fs.copyFileSync(src, dest);
  }
}

function build({ api, web }) {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT);
  for (const entry of RUNTIME) copy(path.join(ROOT, entry), path.join(OUT, entry));
  const config = fs.readFileSync(path.join(ROOT, 'lib', 'config.js'), 'utf8');
  fs.writeFileSync(path.join(OUT, 'lib', 'config.js'), devConfig(config, { api, web }));
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(devManifest(manifest, { api, web }), null, 2) + '\n');
}

if (require.main === module) {
  const api = localOrigin(process.env.FUZE_DEV_API || 'http://127.0.0.1:5000', 'FUZE_DEV_API');
  const web = localOrigin(process.env.FUZE_DEV_WEB || 'http://localhost:5173', 'FUZE_DEV_WEB');
  build({ api, web });
  console.log(`Built ${path.relative(process.cwd(), OUT) || OUT}: API ${api}, web app ${web}.`);
  console.log('Load it in chrome://extensions with "Load unpacked" (remove or disable the release build first).');
}

module.exports = { devConfig, devManifest, localOrigin };
