'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findRootAssignments,
  removeManagedCodexNotify,
  updateCodexNotify
} = require('../lib/codex-config');

const managed = value => String(value).includes('.vsignal/agent-done.ps1');
const wanted = 'notify = ["powershell.exe", "C:/Users/Test/.vsignal/agent-done.ps1"]';

test('updates a managed notify with a trailing comment without duplicating it', () => {
  const source = 'notify = ["old/.vsignal/agent-done.ps1"] # keep this note\nmodel = "gpt"\n';
  const result = updateCodexNotify(source, wanted, managed);

  assert.equal(result.conflict, false);
  assert.equal(result.changed, true);
  assert.match(result.content, /^notify = .* # keep this note$/m);
  assert.equal(findRootAssignments(result.content, 'notify').length, 1);
});

test('updates a multiline managed notify', () => {
  const source = [
    'notify = [',
    '  "powershell.exe",',
    '  "C:/Users/Test/.vsignal/agent-done.ps1"',
    ']',
    'model = "gpt"',
    ''
  ].join('\n');
  const result = updateCodexNotify(source, wanted, managed);

  assert.equal(result.conflict, false);
  assert.equal(result.content, `${wanted}\nmodel = "gpt"\n`);
});

test('preserves an unmanaged inline or multiline notifier as a conflict', () => {
  for (const source of [
    'notify = ["other.exe"] # custom\n',
    'notify = [\n  "other.exe"\n]\n'
  ]) {
    const result = updateCodexNotify(source, wanted, managed);
    assert.deepEqual(result, { content: source, changed: false, conflict: true });
  }
});

test('does not mistake a table-local notify key for the Codex root notifier', () => {
  const source = '[feature]\nnotify = ["other.exe"]\n';
  const result = updateCodexNotify(source, wanted, managed);

  assert.equal(result.content, `${wanted}\n${source}`);
  assert.equal(findRootAssignments(result.content, 'notify').length, 1);
});

test('preserves a UTF-8 BOM when inserting a notifier', () => {
  const source = '\uFEFFmodel = "gpt"\r\n';
  const result = updateCodexNotify(source, wanted, managed);

  assert.equal(result.content, `\uFEFF${wanted}\r\nmodel = "gpt"\r\n`);
});

test('removes only managed root notifiers and preserves table-local keys', () => {
  const source = `${wanted} # generated\nmodel = "gpt"\n\n[feature]\nnotify = ["other.exe"]\n`;
  const result = removeManagedCodexNotify(source, managed);

  assert.equal(result.changed, true);
  assert.equal(result.content, 'model = "gpt"\n\n[feature]\nnotify = ["other.exe"]\n');
});

test('collapses duplicate managed root notifiers to one', () => {
  const source = `${wanted}\n${wanted}\nmodel = "gpt"\n`;
  const result = updateCodexNotify(source, wanted, managed);

  assert.equal(result.changed, true);
  assert.equal(findRootAssignments(result.content, 'notify').length, 1);
});
