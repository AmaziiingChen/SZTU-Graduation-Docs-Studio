BEGIN;

CREATE TABLE public.full_diagnostic_reports (
  report_id uuid PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  archive_base64 text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (octet_length(archive_base64) BETWEEN 28 AND 11184812),
  CHECK (expires_at <= received_at + interval '30 days')
);

ALTER TABLE public.full_diagnostic_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.full_diagnostic_reports FROM PUBLIC, anon, authenticated;
GRANT INSERT, SELECT, DELETE ON public.full_diagnostic_reports TO service_role;
CREATE INDEX full_diagnostic_reports_expires_at_idx ON public.full_diagnostic_reports (expires_at);

SELECT cron.schedule(
  'sztu-full-diagnostic-retention-daily', '20 3 * * *',
  $job$DELETE FROM public.full_diagnostic_reports WHERE expires_at < now();$job$
);

COMMIT;
