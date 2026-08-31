-- Recent anonymous events. Identifiers are intentionally omitted from this view.
SELECT
  received_at,
  event_name,
  app_version,
  platform,
  arch,
  attributes
FROM public.telemetry_events
ORDER BY received_at DESC
LIMIT 100;

-- Daily active anonymous installations and event volume.
SELECT
  date_trunc('day', received_at) AS day,
  count(DISTINCT installation_id) AS active_installations,
  count(*) AS event_count
FROM public.telemetry_events
GROUP BY 1
ORDER BY 1 DESC;

-- Document action outcomes.
SELECT
  attributes ->> 'document_type' AS document_type,
  attributes ->> 'action' AS action,
  attributes ->> 'outcome' AS outcome,
  count(*) AS event_count
FROM public.telemetry_events
WHERE event_name = 'usage_event'
  AND attributes ->> 'event_name' = 'document_action'
GROUP BY 1, 2, 3
ORDER BY event_count DESC;

-- Stable error-code summary without free-text errors.
SELECT
  attributes ->> 'error_code' AS error_code,
  count(*) AS event_count
FROM public.telemetry_events
WHERE event_name = 'usage_event'
  AND attributes ->> 'error_code' IS NOT NULL
GROUP BY 1
ORDER BY event_count DESC;

-- Version and platform distribution.
SELECT
  app_version,
  platform,
  arch,
  count(DISTINCT installation_id) AS installations,
  count(*) AS event_count
FROM public.telemetry_events
GROUP BY 1, 2, 3
ORDER BY event_count DESC;
