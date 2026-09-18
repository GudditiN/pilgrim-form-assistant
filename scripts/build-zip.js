#!/usr/bin/env node
'use strict';

/**
 * Packages the extension runtime files into dist/pilgrim-form-assistant.zip
 * for Chrome Web Store upload. Dev-only tooling - not loaded by the
 * extension itself. No external npm dependencies; shells out to the
 * system `zip` binary.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const outputZip = path.join(distDir, 'pilgrim-form-assistant.zip');

const INCLUDE = [
  'manifest.json',
  'background.js',
  'content.js',
  'site-mappings.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'fullpage.html',
  'fullpage.css',
  'fullpage.js',
  'icons',
  'README.md',
  'LICENSE'
];

function main() {
  const missing = INCLUDE.filter((entry) => !fs.existsSync(path.join(rootDir, entry)));
  if (missing.length > 0) {
    console.error('Missing expected file(s) before packaging: ' + missing.join(', '));
    process.exit(1);
  }

  fs.mkdirSync(distDir, { recursive: true });
  if (fs.existsSync(outputZip)) {
    fs.rmSync(outputZip);
  }

  try {
    execFileSync('zip', ['-r', '-X', outputZip, ...INCLUDE], {
      cwd: rootDir,
      stdio: 'inherit'
    });
  } catch (err) {
    console.error('Could not run the system "zip" command. Install zip (e.g. "apt-get install zip" ' +
      'or "brew install zip") and re-run "npm run zip".');
    process.exit(1);
  }

  console.log('Created ' + path.relative(rootDir, outputZip));
}

main();
