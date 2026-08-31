'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { consumeRateLimit, validateBatch } = require('./index');

function validBatch() {
  return {
    schema_version: '1.0',
    sent_at: '2026-08-31T02:05:00Z',
    events: [{
      schema_version: '1.0',
      event_id: '11111111-1111-4111-8111-111111111111',
      installation_id: '22222222-2222-4222-8222-222222222222',
      session_id: '33333333-3333-4333-8333-333333333333',
      name: 'app_started',
      occurred_at: '2026-08-31T02:05:00Z',
      app_version: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      attributes: { launch_mode: 'development' },
    }],
  };
}

test('accepts the published telemetry contract', () => {
  assert.equal(validateBatch(validBatch()), null);
});

test('rejects unknown event fields before persistence', () => {
  const batch = validBatch();
  batch.events[0].student_name = 'not allowed';
  assert.equal(validateBatch(batch), 'INVALID_EVENT_SHAPE');
});

test('requires an RFC 3339 timestamp', () => {
  const batch = validBatch();
  batch.sent_at = '2026-08-31 02:05:00';
  assert.equal(validateBatch(batch), 'INVALID_BATCH_METADATA');
});

test('limits one anonymous installation to 30 batches per five minutes', () => {
  const key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  for (let index = 0; index < 30; index += 1) {
    assert.equal(consumeRateLimit(key), 0);
  }
  assert.ok(consumeRateLimit(key) > 0);
});
