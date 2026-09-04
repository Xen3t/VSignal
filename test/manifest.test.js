'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('both localization files cover every manifest placeholder', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const references = [...JSON.stringify(manifest).matchAll(/%([^%]+)%/g)].map(match => match[1]);

  for (const file of ['package.nls.json', 'package.nls.fr.json']) {
    const messages = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    assert.deepEqual(references.filter(key => !(key in messages)), [], `${file} has missing keys`);
  }
});

test('development-only test files are excluded from the VSIX', () => {
  const ignored = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8');
  assert.match(ignored, /^test\/\*\*$/m);
});

test('Gemini and panel provider controls are contributed with safe defaults', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const commands = new Set(manifest.contributes.commands.map(entry => entry.command));
  const properties = manifest.contributes.configuration.properties;

  assert.equal(commands.has('vsignal.testGemini'), true);
  for (const key of [
    'vsignal.popup.gemini.weekly',
    'vsignal.alert.lowQuota.gemini',
    'vsignal.alert.reset.gemini',
    'vsignal.panel.providers.claude',
    'vsignal.panel.providers.codex',
    'vsignal.panel.providers.gemini'
  ]) {
    assert.equal(properties[key].default, true, `${key} should default to enabled`);
  }
});
