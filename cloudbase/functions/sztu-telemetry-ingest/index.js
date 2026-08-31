'use strict';

const http = require('node:http');

const PORT = 9000;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENTS = 100;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_BATCHES = 30;
const RATE_LIMIT_MAX_KEYS = 5000;
const ENV_ID = process.env.CLOUDBASE_ENV_ID;
const API_KEY = process.env.CLOUDBASE_API_KEY;
const SERVICE_VERSION = '1.0.0';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const ERROR_CODE_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const EVENT_NAMES = new Set(['app_started', 'heartbeat', 'app_stopped', 'usage_event', 'update_event']);
const PLATFORMS = new Set(['darwin', 'win32', 'linux']);
const ARCHES = new Set(['arm64', 'x64']);
const UPTIME_BUCKETS = new Set(['under_5m', '5m_to_30m', '30m_to_1h', '1h_to_3h', 'over_3h']);
const VIEWS = new Set(['profile', 'proposal', 'task_book', 'midterm', 'inspection']);
const ACTIONS = new Set(['check', 'preview', 'template_sync', 'export', 'qa_record']);
const DOCUMENT_TYPES = new Set(['proposal', 'task_book', 'midterm']);
const OUTCOMES = new Set(['success', 'failure', 'cancelled']);
const UPDATE_OUTCOMES = new Set(['up_to_date', 'available', 'downloaded', 'failed']);
const rateWindows = new Map();

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

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extraHeaders,
  });
  res.end(body);
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
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    sendJson(res, 503, { ok: false, code: 'INGEST_FAILED' });
  }
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(JSON.stringify({ code: 'SERVICE_STARTED', version: SERVICE_VERSION }));
  });
}

module.exports = { validateBatch, consumeRateLimit };
