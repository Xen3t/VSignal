'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const powershell = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
);
const sourceScript = path.join(__dirname, '..', 'resources', 'agent-done.ps1');

test('forces a fresh Claude usage read when a completion popup is prepared', () => {
  const source = fs.readFileSync(sourceScript, 'utf8');
  assert.match(source, /\$freshQuota = Get-ClaudeQuotaText -ApplyPreference:\$filter -ForceRefresh/);
  assert.match(source, /\$freshQuota = Get-ClaudeQuotaText[\s\S]{0,160}Start-ClaudeQuotaFollowUp/);
  assert.match(source, /Start-Sleep -Seconds 15[\s\S]*Get-ClaudeQuotaText -ForceRefresh/);
});

function runClaudeQuota(snapshot) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vsignal-quota-'));
  const scriptDirectory = path.join(profile, '.vsignal');
  const script = path.join(scriptDirectory, 'agent-done.ps1');
  fs.mkdirSync(scriptDirectory, { recursive: true });
  fs.copyFileSync(sourceScript, script);
  fs.writeFileSync(
    path.join(profile, '.claude.json'),
    JSON.stringify({ cachedUsageUtilization: snapshot }),
    'utf8'
  );

  try {
    return execFileSync(
      powershell,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Agent', 'Claude', '-PrintQuota'],
      { encoding: 'utf8', env: { ...process.env, USERPROFILE: profile } }
    );
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

function runClaudeCachedQuota(cache) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vsignal-quota-cache-'));
  const scriptDirectory = path.join(profile, '.vsignal');
  const script = path.join(scriptDirectory, 'agent-done.ps1');
  fs.mkdirSync(scriptDirectory, { recursive: true });
  fs.copyFileSync(sourceScript, script);
  fs.writeFileSync(path.join(scriptDirectory, 'claude-quota.json'), JSON.stringify(cache), 'utf8');

  try {
    return execFileSync(
      powershell,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Agent', 'Claude', '-PrintQuota'],
      { encoding: 'utf8', env: { ...process.env, USERPROFILE: profile } }
    );
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

test('keeps percentages from a current Claude usage snapshot', { skip: process.platform !== 'win32' }, () => {
  const now = Date.now();
  const output = runClaudeQuota({
    fetchedAtMs: now,
    utilization: {
      five_hour: { utilization: 37, resets_at: new Date(now + 60 * 60 * 1000).toISOString() },
      seven_day: { utilization: 61, resets_at: new Date(now + 24 * 60 * 60 * 1000).toISOString() }
    }
  });

  assert.match(output, /5 h 37 %/);
  assert.match(output, /7 j 61 %/);
});

test('resets expired Claude windows instead of displaying stale percentages forever', { skip: process.platform !== 'win32' }, () => {
  const now = Date.now();
  const output = runClaudeQuota({
    fetchedAtMs: now - 2 * 60 * 60 * 1000,
    utilization: {
      five_hour: { utilization: 44, resets_at: new Date(now - 60 * 60 * 1000).toISOString() },
      seven_day: { utilization: 26, resets_at: new Date(now - 30 * 60 * 1000).toISOString() }
    }
  });

  assert.match(output, /5 h 0 %/);
  assert.match(output, /7 j 0 %/);
  assert.doesNotMatch(output, /44 %|26 %/);
});

test('keeps an inactive five-hour Claude window when its reset time is absent', { skip: process.platform !== 'win32' }, () => {
  const now = Date.now();
  const output = runClaudeCachedQuota({
    fetchedAtMs: now,
    fiveHourUsed: 0,
    fiveHourResetsAt: null,
    sevenDayUsed: 12,
    sevenDayResetsAt: Math.floor((now + 24 * 60 * 60 * 1000) / 1000)
  });

  assert.match(output, /5 h 0 %/);
  assert.match(output, /7 j 12 %/);
});
