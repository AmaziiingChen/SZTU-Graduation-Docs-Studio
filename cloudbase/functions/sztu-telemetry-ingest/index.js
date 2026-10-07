'use strict';

const http = require('node:http');
const { validDiagnosticContext } = require('./diagnostic-context.cjs');

const PORT = 9000;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENTS = 100;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_BATCHES = 30;
const RATE_LIMIT_MAX_KEYS = 5000;
const ENV_ID = process.env.CLOUDBASE_ENV_ID;
const API_KEY = process.env.CLOUDBASE_API_KEY;
const SERVICE_VERSION = '1.3.0';
const DIAGNOSTIC_RETENTION_DAYS = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const ERROR_CODE_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const EVENT_NAMES = new Set(['app_started', 'heartbeat', 'app_stopped', 'usage_event', 'update_event']);
const PLATFORMS = new Set(['darwin', 'win32', 'linux']);
const ARCHES = new Set(['arm64', 'x64']);
const UPTIME_BUCKETS = new Set(['under_5m', '5m_to_30m', '30m_to_1h', '1h_to_3h', 'over_3h']);
const VIEWS = new Set(['profile', 'proposal', 'task_book', 'midterm', 'advisor_review', 'reviewer_review', 'defense_record', 'grade_assessment', 'inspection']);
const ACTIONS = new Set(['check', 'preview', 'template_sync', 'export', 'qa_record']);
const DOCUMENT_TYPES = new Set(['proposal', 'task_book', 'midterm', 'advisor_review', 'reviewer_review', 'defense_record', 'grade_assessment']);
const OUTCOMES = new Set(['success', 'failure', 'cancelled']);
const UPDATE_OUTCOMES = new Set(['up_to_date', 'available', 'downloaded', 'failed']);
const DIAGNOSTIC_PLATFORMS = new Set(['darwin', 'win32', 'linux']);
const DIAGNOSTIC_ARCHES = new Set(['arm64', 'x64']);
const CPU_BUCKETS = new Set(['1_to_2', '3_to_4', '5_to_8', '9_to_16', 'over_16']);
const MEMORY_BUCKETS = new Set(['under_4gb', '4_to_8gb', '8_to_16gb', '16_to_32gb', 'over_32gb']);
const CHECK_STATUSES = new Set(['pass', 'warn', 'fail']);
const OPERATION_OUTCOMES = new Set(['success', 'failure', 'cancelled']);
const DURATION_BUCKETS = new Set(['under_100ms', '100ms_to_1s', '1s_to_5s', '5s_to_30s', 'over_30s']);
const DIAGNOSTIC_OPERATIONS = new Set([
  'app.lifecycle', 'renderer.process', 'system.ping', 'system.version',
  'environment.check', 'workspace.open', 'workspace.listDocuments', 'workspace.renameDocument', 'workspace.deleteDocument', 'workspace.restoreDocument', 'workspace.purgeDocument', 'workspace.saveProfileDraft',
  'workspace.saveProfile', 'workspace.createDocument', 'workspace.selectDocument',
  'workspace.saveDraft', 'workspace.closeTemporary', 'document.check',
  'preview.generate', 'export.preflight', 'export.run', 'export.history',
  'export.deleteHistory', 'export.resolveArtifact', 'template.install', 'qa.record',
  'diagnostic.prepare', 'diagnostic.save', 'diagnostic.send', 'telemetry.service', 'update.service',
]);
const ENVIRONMENT_CHECKS = new Set([
  'python', 'temporary_directory', 'document_dependencies', 'xelatex', 'pdf_tools',
  'office_editor', 'template_pack', 'thesis_template', 'advisor_review_engine', 'reviewer_review_engine', 'defense_record_engine', 'grade_assessment_engine', 'proposal_engine', 'midterm_engine', 'task_book_engine',
]);
const rateWindows = new Map();
let diagnosticRateWindow = { startedAt: 0, count: 0 };

function exactKeys(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && keys.every((key) => allowed.has(key));
}

function isDateTime(value) {
  return typeof value === 'string'
    && value.length <= 64
    && DATE_TIME_RE.test(value)
    && Number.isFinite(Date.parse(value));
}

function consumeRateLimit(key) {
  const now = Date.now();
  let current = rateWindows.get(key);
  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    current = { startedAt: now, count: 0 };
    rateWindows.set(key, current);
  }
  if (current.count >= RATE_LIMIT_MAX_BATCHES) {
    return Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - current.startedAt)) / 1000));
  }
  current.count += 1;

  if (rateWindows.size > RATE_LIMIT_MAX_KEYS) {
    for (const [candidate, window] of rateWindows) {
      if (now - window.startedAt >= RATE_LIMIT_WINDOW_MS || rateWindows.size > RATE_LIMIT_MAX_KEYS) {
        rateWindows.delete(candidate);
      }
      if (rateWindows.size <= RATE_LIMIT_MAX_KEYS) break;
    }
  }
  return 0;
}

function validAttributes(name, attributes) {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return false;
  if ('college' in attributes || 'major' in attributes) {
    const { college, major, ...rest } = attributes;
    if (![college, major].every(value => typeof value === 'string' && value.length >= 1 && value.length <= 200 && value === value.trim())) return false;
    attributes = rest;
  }
  if (name === 'app_started') {
    return exactKeys(attributes, ['launch_mode'])
      && ['packaged', 'development'].includes(attributes.launch_mode);
  }
  if (name === 'heartbeat' || name === 'app_stopped') {
    return exactKeys(attributes, ['uptime_bucket'])
      && UPTIME_BUCKETS.has(attributes.uptime_bucket);
  }
  if (name === 'usage_event') {
    if (attributes?.event_name === 'view_opened') {
      return exactKeys(attributes, ['event_name', 'view']) && VIEWS.has(attributes.view);
    }
    if (attributes?.event_name === 'document_action') {
      if (!exactKeys(attributes, ['event_name', 'action', 'document_type', 'outcome'], ['error_code', 'format_count'])) return false;
      if (!ACTIONS.has(attributes.action) || !DOCUMENT_TYPES.has(attributes.document_type) || !OUTCOMES.has(attributes.outcome)) return false;
      if (attributes.error_code !== undefined && (typeof attributes.error_code !== 'string' || !ERROR_CODE_RE.test(attributes.error_code))) return false;
      if (attributes.format_count !== undefined && (!Number.isInteger(attributes.format_count) || attributes.format_count < 1 || attributes.format_count > 3)) return false;
      return true;
    }
    if (attributes?.event_name === 'document_completed') {
      return exactKeys(attributes, ['event_name', 'document_type'])
        && DOCUMENT_TYPES.has(attributes.document_type);
    }
    return false;
  }
  if (name === 'update_event') {
    if (!exactKeys(attributes, ['outcome'], ['target_version'])) return false;
    if (!UPDATE_OUTCOMES.has(attributes.outcome)) return false;
    return attributes.target_version === undefined
      || (typeof attributes.target_version === 'string' && SEMVER_RE.test(attributes.target_version));
  }
  return false;
}

function validateBatch(batch) {
  if (!exactKeys(batch, ['schema_version', 'sent_at', 'events'])) return 'INVALID_BATCH_SHAPE';
  if (batch.schema_version !== '1.0' || !isDateTime(batch.sent_at)) return 'INVALID_BATCH_METADATA';
  if (!Array.isArray(batch.events) || batch.events.length < 1 || batch.events.length > MAX_EVENTS) return 'INVALID_EVENT_COUNT';

  for (const event of batch.events) {
    const required = ['schema_version', 'event_id', 'installation_id', 'session_id', 'name', 'occurred_at', 'app_version', 'platform', 'arch', 'attributes'];
    if (!exactKeys(event, required)) return 'INVALID_EVENT_SHAPE';
    if (event.schema_version !== '1.0') return 'INVALID_SCHEMA_VERSION';
    if (!UUID_RE.test(event.event_id) || !UUID_RE.test(event.installation_id) || !UUID_RE.test(event.session_id)) return 'INVALID_IDENTIFIER';
    if (!EVENT_NAMES.has(event.name) || !isDateTime(event.occurred_at)) return 'INVALID_EVENT_METADATA';
    if (typeof event.app_version !== 'string' || event.app_version.length > 64 || !SEMVER_RE.test(event.app_version)) return 'INVALID_APP_VERSION';
    if (!PLATFORMS.has(event.platform) || !ARCHES.has(event.arch)) return 'INVALID_PLATFORM';
    if (!validAttributes(event.name, event.attributes)) return 'INVALID_ATTRIBUTES';
  }
  return null;
}

function safeText(value, maximum, pattern) {
  return typeof value === 'string' && value.length <= maximum && pattern.test(value);
}

function validateDiagnosticReport(report) {
  if (!exactKeys(report, [
    'schema_version', 'report_id', 'created_at', 'application', 'device',
    'environment', 'services', 'operations', 'privacy',
  ])) return 'INVALID_DIAGNOSTIC_SHAPE';
  if (!['1.0', '2.0'].includes(report.schema_version) || !UUID_RE.test(report.report_id) || !isDateTime(report.created_at)) {
    return 'INVALID_DIAGNOSTIC_METADATA';
  }
  if (!exactKeys(report.application, ['version', 'electron_version', 'packaged'])
      || !safeText(report.application.version, 64, /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/)
      || !safeText(report.application.electron_version, 64, /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/)
      || typeof report.application.packaged !== 'boolean') return 'INVALID_DIAGNOSTIC_APPLICATION';
  if (!exactKeys(report.device, ['platform', 'architecture', 'os_release', 'cpu_count_bucket', 'memory_bucket'])
      || !DIAGNOSTIC_PLATFORMS.has(report.device.platform)
      || !DIAGNOSTIC_ARCHES.has(report.device.architecture)
      || !safeText(report.device.os_release, 96, /^[0-9A-Za-z][0-9A-Za-z._()+ -]*$/)
      || !CPU_BUCKETS.has(report.device.cpu_count_bucket)
      || !MEMORY_BUCKETS.has(report.device.memory_bucket)) return 'INVALID_DIAGNOSTIC_DEVICE';
  if (!exactKeys(report.environment, ['ready', 'python_version', 'checks'])
      || typeof report.environment.ready !== 'boolean'
      || !safeText(report.environment.python_version, 64, /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/)
      || !Array.isArray(report.environment.checks)
      || report.environment.checks.length > 20) return 'INVALID_DIAGNOSTIC_ENVIRONMENT';
  for (const check of report.environment.checks) {
    if (!exactKeys(check, ['id', 'required', 'status'])
        || !ENVIRONMENT_CHECKS.has(check.id)
        || typeof check.required !== 'boolean'
        || !CHECK_STATUSES.has(check.status)) return 'INVALID_DIAGNOSTIC_CHECK';
  }
  if (!exactKeys(report.services, ['telemetry_configured', 'update_configured'])
      || typeof report.services.telemetry_configured !== 'boolean'
      || typeof report.services.update_configured !== 'boolean') return 'INVALID_DIAGNOSTIC_SERVICES';
  if (!Array.isArray(report.operations) || report.operations.length > 200) return 'INVALID_DIAGNOSTIC_OPERATIONS';
  for (const operation of report.operations) {
    if (!exactKeys(operation, ['occurred_at', 'operation', 'outcome', 'duration_bucket'], report.schema_version === '2.0' ? ['error_code', 'duration_ms', 'context'] : ['error_code'])
        || (operation.duration_ms !== undefined && (!Number.isInteger(operation.duration_ms) || operation.duration_ms < 0 || operation.duration_ms > 86400000))
        || (operation.context !== undefined && !validDiagnosticContext(operation.context))
        || !isDateTime(operation.occurred_at)
        || !DIAGNOSTIC_OPERATIONS.has(operation.operation)
        || !OPERATION_OUTCOMES.has(operation.outcome)
        || !DURATION_BUCKETS.has(operation.duration_bucket)
        || (operation.error_code !== undefined
          && (typeof operation.error_code !== 'string' || !ERROR_CODE_RE.test(operation.error_code)))) {
      return 'INVALID_DIAGNOSTIC_OPERATION';
    }
  }
  if (!exactKeys(report.privacy, ['scan_status', 'source_fields_removed', 'blocked_findings'])
      || report.privacy.scan_status !== 'passed'
      || !Number.isInteger(report.privacy.source_fields_removed)
      || report.privacy.source_fields_removed < 0
      || report.privacy.blocked_findings !== 0) return 'INVALID_DIAGNOSTIC_PRIVACY';
  return null;
}

function scanDiagnosticReport(report) {
  const serialized = JSON.stringify(report);
  const forbiddenKeys = /"(?:full_name|student_number|thesis_title|content|filename|absolute_path|clipboard|hostname|username|ip_address|mac_address|serial_number|raw_log|message|details)"\s*:/i;
  const pathLike = /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\|file:\/\/)/i;
  const credentialLike = /(?:Bearer\s+[A-Za-z0-9._-]+|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:secret|token|password)\s*[=:])/i;
  return !forbiddenKeys.test(serialized) && !pathLike.test(serialized) && !credentialLike.test(serialized);
}

function consumeDiagnosticRateLimit() {
  const now = Date.now();
  if (now - diagnosticRateWindow.startedAt >= RATE_LIMIT_WINDOW_MS) {
    diagnosticRateWindow = { startedAt: now, count: 0 };
  }
  if (diagnosticRateWindow.count >= 60) {
    return Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - diagnosticRateWindow.startedAt)) / 1000));
  }
  diagnosticRateWindow.count += 1;
  return 0;
}

function databaseEndpoint(table) {
  return `https://${ENV_ID}.api.tcloudbasegateway.com/v1/rdb/rest/${table}`;
}

async function databaseRequest(table, options) {
  const response = await fetch(`${databaseEndpoint(table)}${options.query || ''}`, {
    method: options.method,
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=minimal',
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    console.error(JSON.stringify({ code: options.errorCode, status: response.status }));
    const error = new Error(options.errorCode);
    error.code = options.errorCode;
    error.upstreamStatus = response.status;
    throw error;
  }
}

async function persistDiagnosticReport(report) {
  await databaseRequest('diagnostic_reports', {
    method: 'POST',
    query: '?on_conflict=report_id',
    prefer: 'resolution=ignore-duplicates,return=minimal',
    body: {
      report_id: report.report_id,
      schema_version: report.schema_version,
      created_at: report.created_at,
      report,
    },
    errorCode: 'DIAGNOSTIC_WRITE_FAILED',
  });
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extraHeaders,
  });
  res.end(body);
}

async function fetchCompletionCount() {
  const endpoint = new URL(`https://${ENV_ID}.api.tcloudbasegateway.com/v1/rdb/rest/telemetry_events`);
  endpoint.searchParams.set('select', 'event_id');
  endpoint.searchParams.set('event_name', 'eq.usage_event');
  endpoint.searchParams.set('attributes->>event_name', 'eq.document_completed');
  endpoint.searchParams.set('limit', '1');
  const response = await fetch(endpoint, {
    method: 'GET',
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const error = new Error('database count failed');
    error.code = 'DB_COUNT_FAILED';
    error.upstreamStatus = response.status;
    throw error;
  }
  const contentRange = response.headers.get('content-range') || '';
  const match = contentRange.match(/\/(\d+)$/);
  if (!match) {
    const error = new Error('database count unavailable');
    error.code = 'DB_COUNT_INVALID';
    throw error;
  }
  return Number(match[1]);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        reject(Object.assign(new Error('body too large'), { code: 'BODY_TOO_LARGE' }));
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => {
      if (!settled) reject(error);
    });
  });
}

async function persistEvents(events) {
  const endpoint = `https://${ENV_ID}.api.tcloudbasegateway.com/v1/rdb/rest/telemetry_events`;
  const rows = events.map((event) => ({
    event_id: event.event_id,
    schema_version: event.schema_version,
    installation_id: event.installation_id,
    session_id: event.session_id,
    event_name: event.name,
    occurred_at: event.occurred_at,
    app_version: event.app_version,
    platform: event.platform,
    arch: event.arch,
    attributes: event.attributes,
  }));

  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    console.error(JSON.stringify({ code: 'DB_WRITE_FAILED', status: response.status }));
    const error = new Error('database write failed');
    error.code = 'DB_WRITE_FAILED';
    error.upstreamStatus = response.status;
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname.endsWith('/health')) {
      sendJson(res, 200, { ok: true, service: 'telemetry-ingest', version: SERVICE_VERSION });
      return;
    }
    if (req.method === 'POST' && url.pathname.endsWith('/v1/reports')) {
      if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
        sendJson(res, 415, { ok: false, code: 'UNSUPPORTED_MEDIA_TYPE' });
        return;
      }
      if (!ENV_ID || !API_KEY) {
        sendJson(res, 503, { ok: false, code: 'SERVICE_UNAVAILABLE' });
        return;
      }
      const retryAfter = consumeDiagnosticRateLimit();
      if (retryAfter > 0) {
        sendJson(res, 429, { ok: false, code: 'RATE_LIMITED' }, { 'Retry-After': String(retryAfter) });
        return;
      }
      const rawBody = await readBody(req);
      let report;
      try {
        report = JSON.parse(rawBody);
      } catch {
        sendJson(res, 400, { ok: false, code: 'INVALID_JSON' });
        return;
      }
      const validationError = validateDiagnosticReport(report);
      if (validationError) {
        sendJson(res, 422, { ok: false, code: validationError });
        return;
      }
      if (!scanDiagnosticReport(report)) {
        sendJson(res, 422, { ok: false, code: 'DIAGNOSTIC_PRIVACY_SCAN_FAILED' });
        return;
      }
      await persistDiagnosticReport(report);
      sendJson(res, 202, {
        ok: true,
        report_id: report.report_id,
        retention_days: DIAGNOSTIC_RETENTION_DAYS,
      });
      return;
    }
    if (
      req.method === 'GET'
      && url.pathname.endsWith('/v1/events')
      && url.searchParams.get('aggregate') === 'completed_documents'
    ) {
      if (!ENV_ID || !API_KEY) {
        sendJson(res, 503, { ok: false, code: 'SERVICE_UNAVAILABLE' });
        return;
      }
      const completedDocuments = await fetchCompletionCount();
      sendJson(
        res,
        200,
        { ok: true, completed_documents: completedDocuments },
        { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
      );
      return;
    }
    if (req.method !== 'POST' || !url.pathname.endsWith('/v1/events')) {
      sendJson(res, 404, { ok: false, code: 'NOT_FOUND' });
      return;
    }
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      sendJson(res, 415, { ok: false, code: 'UNSUPPORTED_MEDIA_TYPE' });
      return;
    }
    if (!ENV_ID || !API_KEY) {
      console.error(JSON.stringify({ code: 'SERVER_CONFIG_MISSING' }));
      sendJson(res, 503, { ok: false, code: 'SERVICE_UNAVAILABLE' });
      return;
    }

    const rawBody = await readBody(req);
    let batch;
    try {
      batch = JSON.parse(rawBody);
    } catch {
      sendJson(res, 400, { ok: false, code: 'INVALID_JSON' });
      return;
    }
    const validationError = validateBatch(batch);
    if (validationError) {
      sendJson(res, 422, { ok: false, code: validationError });
      return;
    }

    const retryAfter = consumeRateLimit(batch.events[0].installation_id);
    if (retryAfter > 0) {
      sendJson(res, 429, { ok: false, code: 'RATE_LIMITED' }, { 'Retry-After': String(retryAfter) });
      return;
    }

    await persistEvents(batch.events);
    sendJson(res, 202, { ok: true, accepted: batch.events.length });
  } catch (error) {
    if (error?.code === 'BODY_TOO_LARGE') {
      sendJson(res, 413, { ok: false, code: 'BODY_TOO_LARGE' });
      return;
    }
    if (error?.code === 'DB_WRITE_FAILED') {
      sendJson(res, 503, { ok: false, code: `DB_WRITE_FAILED_${error.upstreamStatus}` });
      return;
    }
    if (typeof error?.code === 'string' && error.code.startsWith('DIAGNOSTIC_')) {
      sendJson(res, 503, { ok: false, code: `${error.code}_${error.upstreamStatus || 0}` });
      return;
    }
    if (error?.code === 'DB_COUNT_FAILED') {
      sendJson(res, 503, { ok: false, code: `DB_COUNT_FAILED_${error.upstreamStatus}` });
      return;
    }
    if (error?.code === 'DB_COUNT_INVALID') {
      sendJson(res, 503, { ok: false, code: 'DB_COUNT_INVALID' });
      return;
    }
    sendJson(res, 503, { ok: false, code: 'INGEST_FAILED' });
  }
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(JSON.stringify({ code: 'SERVICE_STARTED', version: SERVICE_VERSION }));
  });
}

module.exports = {
  validateBatch,
  validateDiagnosticReport,
  scanDiagnosticReport,
  consumeRateLimit,
  consumeDiagnosticRateLimit,
  fetchCompletionCount,
};
