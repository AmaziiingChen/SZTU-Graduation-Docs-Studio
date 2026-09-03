CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'sztu-diagnostic-retention-daily',
  '15 3 * * *',
  $job$
    DELETE FROM public.diagnostic_reports
    WHERE expires_at < now();

    DELETE FROM public.diagnostic_access_audit
    WHERE occurred_at < now() - interval '180 days';
  $job$
)
WHERE NOT EXISTS (
  SELECT 1
  FROM cron.job
  WHERE jobname = 'sztu-diagnostic-retention-daily'
);
