'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const GEMINI_WEEKLY_WINDOW = '7 j';

function resetDelay(resetTime, now = Date.now()) {
  const resetAt = Date.parse(String(resetTime || ''));
  if (!Number.isFinite(resetAt) || resetAt <= now) return '';

  const totalMinutes = Math.max(1, Math.floor((resetAt - now) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return hours > 0 ? `${days} j ${hours} h` : `${days} j`;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  return `${minutes} min`;
}

function parseGeminiQuotaResponse(stdout, now = Date.now()) {
  let payload;
  try {
    payload = JSON.parse(String(stdout || '').trim());
  } catch {
    return [];
  }

  const groups = payload && payload.command && payload.command.data && payload.command.data.groups;
  if (!Array.isArray(groups)) return [];

  const gemini = groups.find(group => /gemini/i.test(String(group && group.name)));
  if (!gemini || !Array.isArray(gemini.buckets)) return [];

  return gemini.buckets.flatMap(bucket => {
    const remaining = Number(bucket && bucket.remaining_fraction);
    if (!Number.isFinite(remaining)) return [];

    const window = String(bucket.window || '').toLowerCase() === 'weekly'
      ? GEMINI_WEEKLY_WINDOW
      : String(bucket.name || bucket.window || '').trim();
    if (!window) return [];

    return [{
      window,
      percent: Math.round(Math.max(0, Math.min(1, 1 - remaining)) * 100),
      reset: resetDelay(bucket.reset_time, now)
    }];
  });
}

function geminiExecutable() {
  const bundled = path.join(os.homedir(), '.gemini', 'bin', 'agy.exe');
  return fs.existsSync(bundled) ? bundled : 'agy.exe';
}

function readGeminiQuota() {
  return new Promise(resolve => {
    execFile(
      geminiExecutable(),
      ['-p', '/quota', '--output-format', 'json', '--print-timeout', '10s'],
      { windowsHide: true, timeout: 15000, encoding: 'utf8', maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        const values = error ? [] : parseGeminiQuotaResponse(stdout);
        resolve({ values, sourceAt: values.length ? Date.now() : 0 });
      }
    );
  });
}

module.exports = { parseGeminiQuotaResponse, readGeminiQuota, resetDelay };
