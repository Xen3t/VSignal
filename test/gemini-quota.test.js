'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGeminiQuotaResponse, resetDelay } = require('../lib/gemini-quota');

test('converts the Gemini weekly remaining quota to VSignal consumed usage', () => {
  const now = Date.parse('2026-09-04T12:00:00Z');
  const output = JSON.stringify({
    command: {
      data: {
        groups: [
          {
            name: 'Gemini Models',
            buckets: [{
              name: 'Weekly Limit Remaining',
              window: 'weekly',
              remaining_fraction: 0.73,
              reset_time: '2026-09-11T12:00:00Z'
            }]
          },
          {
            name: 'Claude and GPT models',
            buckets: [{ window: 'weekly', remaining_fraction: 0.12 }]
          }
        ]
      }
    }
  });

  assert.deepEqual(parseGeminiQuotaResponse(output, now), [
    { window: '7 j', percent: 27, reset: '7 j' }
  ]);
});

test('ignores malformed or missing Gemini quota responses', () => {
  assert.deepEqual(parseGeminiQuotaResponse('not json'), []);
  assert.deepEqual(parseGeminiQuotaResponse('{"command":{"data":{"groups":[]}}}'), []);
});

test('formats Gemini reset delays with the quota transport units', () => {
  const now = Date.parse('2026-09-04T12:00:00Z');
  assert.equal(resetDelay('2026-09-06T15:30:00Z', now), '2 j 3 h');
  assert.equal(resetDelay('2026-09-04T12:42:00Z', now), '42 min');
});
