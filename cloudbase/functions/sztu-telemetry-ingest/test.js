'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  consumeRateLimit,
  scanDiagnosticReport,
  validateBatch,
  validateDiagnosticReport,
} = require('./index');

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

function validDiagnosticReport() {
  return {
    schema_version: '1.0',
    report_id: '44444444-4444-4444-8444-444444444444',
    created_at: '2026-09-03T03:00:00Z',
    application: { version: '0.1.0', electron_version: '44.0.0', packaged: true },
    device: {
      platform: 'darwin', architecture: 'arm64', os_release: '25.6.0',
      cpu_count_bucket: '9_to_16', memory_bucket: '16_to_32gb',
    },
    environment: {
      ready: true,
      python_version: '3.14.4',
      checks: [{ id: 'xelatex', required: true, status: 'pass' }],
    },
    services: { telemetry_configured: true, update_configured: true },
    operations: [{
      occurred_at: '2026-09-03T03:00:00Z', operation: 'document.check',
      outcome: 'success', duration_bucket: '1s_to_5s',
    }],
    privacy: { scan_status: 'passed', source_fields_removed: 2, blocked_findings: 0 },
  };
}

test('accepts the published telemetry contract', () => {
  assert.equal(validateBatch(validBatch()), null);
});

test('accepts a content-free document completion event', () => {
  const batch = validBatch();
  batch.events[0].name = 'usage_event';
  batch.events[0].attributes = {
    event_name: 'document_completed',
    document_type: 'proposal',
  };
  assert.equal(validateBatch(batch), null);
});

test('rejects document identifiers in completion event attributes', () => {
  const batch = validBatch();
  batch.events[0].name = 'usage_event';
  batch.events[0].attributes = {
    event_name: 'document_completed',
    document_type: 'proposal',
    document_id: '11111111-1111-4111-8111-111111111111',
  };
  assert.equal(validateBatch(batch), 'INVALID_ATTRIBUTES');
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

test('accepts the exact diagnostic report contract and passes the second privacy scan', () => {
  const report = validDiagnosticReport();
  assert.equal(validateDiagnosticReport(report), null);
  assert.equal(scanDiagnosticReport(report), true);
});

test('accepts a prior diagnostic send result in a later report', () => {
  const report = validDiagnosticReport();
  report.operations[0].operation = 'diagnostic.send';
  assert.equal(validateDiagnosticReport(report), null);
});

test('rejects diagnostic reports containing a forbidden source field', () => {
  const report = validDiagnosticReport();
  report.device.hostname = 'private-device';
  assert.equal(validateDiagnosticReport(report), 'INVALID_DIAGNOSTIC_DEVICE');
  delete report.device.hostname;
  report.operations[0].message = '/Users/student/private';
  assert.equal(scanDiagnosticReport(report), false);
});
