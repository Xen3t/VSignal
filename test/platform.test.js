'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

test('activation performs no file or watcher work outside Windows', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalLoad = Module._load;
  const originalFs = {
    mkdirSync: fs.mkdirSync,
    writeFileSync: fs.writeFileSync,
    watch: fs.watch,
    watchFile: fs.watchFile
  };
  const registered = [];

  const vscode = {
    commands: {
      registerCommand(command) {
        registered.push(command);
        return { dispose() {} };
      }
    },
    window: { showErrorMessage() {} },
    workspace: { getConfiguration() { throw new Error('configuration must not be read'); } },
    env: { language: 'en' }
  };

  try {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    Module._load = function load(request, parent, isMain) {
      if (request === 'vscode') return vscode;
      return originalLoad.call(this, request, parent, isMain);
    };
    for (const method of Object.keys(originalFs)) {
      fs[method] = () => { throw new Error(`${method} must not be called`); };
    }

    const extensionPath = path.join(__dirname, '..', 'extension.js');
    delete require.cache[require.resolve(extensionPath)];
    const extension = require(extensionPath);
    const context = { subscriptions: [] };
    extension.activate(context);

    assert.equal(registered.length, 8);
    assert.equal(context.subscriptions.length, 8);
  } finally {
    Module._load = originalLoad;
    Object.defineProperty(process, 'platform', originalPlatform);
    Object.assign(fs, originalFs);
  }
});
