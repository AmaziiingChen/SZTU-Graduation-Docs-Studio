-- Apply only to the chosen environment before enabling diagnostic schema 3.
BEGIN;
ALTER TABLE public.diagnostic_reports
  DROP CONSTRAINT diagnostic_reports_schema_version_check;
ALTER TABLE public.diagnostic_reports
  ADD CONSTRAINT diagnostic_reports_schema_version_check
  CHECK (schema_version IN ('1.0', '2.0', '3.0'));
COMMIT;
