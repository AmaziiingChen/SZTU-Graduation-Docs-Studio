-- Deploy before the v1.3 ingest service and notice-1.2 clients.
-- Only expands the schema-version constraint; privileges and retention stay intact.
BEGIN;
ALTER TABLE public.diagnostic_reports
  DROP CONSTRAINT diagnostic_reports_schema_version_check;
ALTER TABLE public.diagnostic_reports
  ADD CONSTRAINT diagnostic_reports_schema_version_check
  CHECK (schema_version IN ('1.0', '2.0'));
COMMIT;
