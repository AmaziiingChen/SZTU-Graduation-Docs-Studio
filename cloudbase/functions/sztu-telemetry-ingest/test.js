'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  consumeRateLimit,
  scanDiagnosticReport,
  validateBatch,
  validateDiagnosticReport,
  validateFeedback,
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

test('accepts custom academic names and all seven document types', () => {
  const batch = validBatch();
  Object.assign(batch.events[0].attributes, { college: '音乐学院', major: '音乐表演' });
  assert.equal(validateBatch(batch), null);
  batch.events[0].attributes.major = '新增专业';
  assert.equal(validateBatch(batch), null);
  batch.events[0].attributes.college = '新设学院';
  assert.equal(validateBatch(batch), null);
  batch.events[0].attributes.major = 'A'.repeat(200);
  assert.equal(validateBatch(batch), null);
  batch.events[0].attributes.major = 'A'.repeat(201);
  assert.equal(validateBatch(batch), 'INVALID_ATTRIBUTES');
  delete batch.events[0].attributes.major;
  assert.equal(validateBatch(batch), 'INVALID_ATTRIBUTES');
  for (const document_type of ['proposal', 'task_book', 'midterm', 'advisor_review', 'reviewer_review', 'defense_record', 'grade_assessment']) {
    batch.events[0].name = 'usage_event';
    batch.events[0].attributes = { event_name: 'document_completed', document_type, college: 'unknown', major: 'unknown' };
    assert.equal(validateBatch(batch), null);
  }
});

test('accepts v2 bounded diagnostic evidence while retaining v1', () => {
  const report = validDiagnosticReport();
  assert.equal(validateDiagnosticReport(report), null);
  report.schema_version = '2.0';
  Object.assign(report.operations[0], { duration_ms: 1289, context: { field: 'sections.progress[0].columns[1].header', trace: [{ module: 'docx_inspector.py', line: 220 }], structure: { tables: 1 } } });
  assert.equal(validateDiagnosticReport(report), null);
  report.operations[0].context.trace[0].module = '/Users/private/file.py';
  assert.equal(validateDiagnosticReport(report), 'INVALID_DIAGNOSTIC_OPERATION');
});

test('accepts structured v3 failure evidence and rejects raw reasons and paths', () => {
  const report = validDiagnosticReport();
  report.schema_version = '3.0';
  report.environment.checks.push({ id: 'core_document_fonts', required: true, status: 'pass' });
  Object.assign(report.operations[0], { operation: 'diagnostic.step', outcome: 'failure',
    error_code: 'RENDER_FAILED', duration_ms: 225,
    context: { stage: 'preview_rasterize', tool: 'pdftoppm', tool_source: 'bundled',
      tool_version: '26.1.0', exit_code: 23, reason: 'tool_nonzero' } });
  assert.equal(validateDiagnosticReport(report), null);
  assert.equal(scanDiagnosticReport(report), true);
  for (const [key, value] of [['tool', '/Users/private/tool'], ['reason', 'private compilation output'], ['exit_code', '23']]) {
    const previous = report.operations[0].context[key];
    report.operations[0].context[key] = value;
    assert.equal(validateDiagnosticReport(report), 'INVALID_DIAGNOSTIC_OPERATION');
    report.operations[0].context[key] = previous;
  }
});

function validFeedback() {
  return {
    schema_version: '1.0',
    category: 'bug',
    message: '预览一直失败，希望帮忙看一下。',
    contact: 'student@example.com',
    app_version: '0.2.0',
    platform: 'win32',
    arch: 'x64',
  };
}

test('accepts a user feedback submission and rejects unsafe shapes', () => {
  assert.equal(validateFeedback(validFeedback()), null);
  assert.equal(validateFeedback({ ...validFeedback(), category: 'praise' }), 'INVALID_FEEDBACK_CATEGORY');
  assert.equal(validateFeedback({ ...validFeedback(), message: '太短' }), 'INVALID_FEEDBACK_MESSAGE');
  assert.equal(validateFeedback({ ...validFeedback(), contact: 'a\nb' }), 'INVALID_FEEDBACK_CONTACT');
  assert.equal(validateFeedback({ ...validFeedback(), extra: true }), 'INVALID_FEEDBACK_FIELDS');
  assert.equal(validateFeedback({ ...validFeedback(), diagnostic_report_id: 'not-a-uuid' }), 'INVALID_FEEDBACK_DIAGNOSTIC_ID');
});

test('persists an accepted feedback submission with a receipt', async () => {
  const http = require('node:http');
  const { handleRequest } = require('./index');
  const stored = [];
  const server = http.createServer(handleRequest({
    databaseConfigured: true,
    persistUserFeedback: async (feedback, receiptId) => stored.push({ feedback, receiptId }),
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/v1/feedback`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validFeedback()),
    });
    const payload = await response.json();
    assert.equal(response.status, 202);
    assert.equal(payload.ok, true);
    assert.match(payload.receipt_id, /^[0-9a-f-]{36}$/);
    assert.equal(payload.retention_days, 180);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].feedback.contact, 'student@example.com');
    assert.equal(stored[0].receiptId, payload.receipt_id);

    const rejected = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validFeedback(), message: '太短' }),
    });
    assert.equal(rejected.status, 422);
    assert.equal(stored.length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('stores the original bytes of an explicitly uploaded full fault archive', async () => {
  const http = require('node:http');
  const { handleRequest } = require('./index');
  const reports = new Map();
  const server = http.createServer(handleRequest({
    databaseConfigured: true,
    persistFull: async (id, archive) => reports.set(id, archive),
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/v1/full-reports`;
    const archive = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('synthetic /Users/example/学号和正文'), Buffer.from([255, 254])]);
    const id = '435565ec-38c5-4917-94e6-0e7bf1fa7763';
    const response = await fetch(url, {
      method: 'POST', body: archive,
      headers: { 'Content-Type': 'application/zip', 'X-Report-Id': id },
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).report_id, id);
    assert.deepEqual(reports.get(id), archive);
    const rejected = await fetch(url, { method: 'POST', body: archive });
    assert.equal(rejected.status, 400);
    assert.equal(reports.size, 1);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
