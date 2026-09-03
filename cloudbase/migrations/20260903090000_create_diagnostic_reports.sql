CREATE TABLE public.diagnostic_reports (
  report_id uuid PRIMARY KEY,
  schema_version text NOT NULL CHECK (schema_version = '1.0'),
  created_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  report jsonb NOT NULL,
  CHECK (expires_at <= received_at + interval '30 days'),
  CHECK (jsonb_typeof(report) = 'object')
);

CREATE INDEX diagnostic_reports_expires_at_idx
  ON public.diagnostic_reports (expires_at);

CREATE TABLE public.diagnostic_access_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('received', 'auto_deleted')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL DEFAULT 'diagnostic_service'
    CHECK (actor = 'diagnostic_service')
);

CREATE INDEX diagnostic_access_audit_report_id_idx
  ON public.diagnostic_access_audit (report_id, occurred_at DESC);

CREATE INDEX diagnostic_access_audit_occurred_at_idx
  ON public.diagnostic_access_audit (occurred_at);

CREATE FUNCTION public.audit_diagnostic_report_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.diagnostic_access_audit (report_id, action)
  VALUES (
    CASE WHEN TG_OP = 'DELETE' THEN OLD.report_id ELSE NEW.report_id END,
    CASE WHEN TG_OP = 'DELETE' THEN 'auto_deleted' ELSE 'received' END
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER diagnostic_reports_received_audit
AFTER INSERT ON public.diagnostic_reports
FOR EACH ROW EXECUTE FUNCTION public.audit_diagnostic_report_lifecycle();

CREATE TRIGGER diagnostic_reports_deleted_audit
AFTER DELETE ON public.diagnostic_reports
FOR EACH ROW EXECUTE FUNCTION public.audit_diagnostic_report_lifecycle();

REVOKE ALL ON public.diagnostic_reports FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.diagnostic_access_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_diagnostic_report_lifecycle() FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.diagnostic_reports TO service_role;
GRANT ALL ON public.diagnostic_access_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.diagnostic_access_audit_audit_id_seq TO service_role;

