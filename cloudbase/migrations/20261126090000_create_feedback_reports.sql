BEGIN;

CREATE TABLE public.feedback_reports (
  receipt_id uuid PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '180 days'),
  schema_version text NOT NULL CHECK (schema_version = '1.0'),
  category text NOT NULL CHECK (category IN ('bug', 'suggestion', 'other')),
  message text NOT NULL CHECK (char_length(message) BETWEEN 10 AND 2000),
  contact text NOT NULL CHECK (char_length(contact) BETWEEN 3 AND 200 AND contact !~ '[\r\n\0]'),
  app_version text NOT NULL CHECK (app_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$'),
  platform text NOT NULL CHECK (platform IN ('darwin', 'win32', 'linux')),
  arch text NOT NULL CHECK (arch IN ('arm64', 'x64')),
  diagnostic_report_id uuid,
  CHECK (expires_at <= received_at + interval '180 days')
);

ALTER TABLE public.feedback_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.feedback_reports FROM PUBLIC, anon, authenticated;
GRANT INSERT, SELECT, DELETE ON public.feedback_reports TO service_role;
CREATE INDEX feedback_reports_expires_at_idx ON public.feedback_reports (expires_at);

SELECT cron.schedule(
  'sztu-feedback-retention-daily', '40 3 * * *',
  $job$DELETE FROM public.feedback_reports WHERE expires_at < now();$job$
);

COMMIT;
