CREATE TABLE public.telemetry_events (
  event_id uuid PRIMARY KEY,
  schema_version varchar(16) NOT NULL,
  installation_id uuid NOT NULL,
  session_id uuid NOT NULL,
  event_name varchar(32) NOT NULL,
  occurred_at timestamptz NOT NULL,
  app_version varchar(64) NOT NULL,
  platform varchar(16) NOT NULL,
  arch varchar(16) NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telemetry_events_name_check CHECK (event_name IN ('app_started','heartbeat','app_stopped','usage_event','update_event')),
  CONSTRAINT telemetry_events_platform_check CHECK (platform IN ('darwin','win32','linux')),
  CONSTRAINT telemetry_events_arch_check CHECK (arch IN ('arm64','x64')),
  CONSTRAINT telemetry_events_attributes_object_check CHECK (jsonb_typeof(attributes) = 'object')
);

CREATE INDEX telemetry_events_received_at_idx ON public.telemetry_events (received_at);
CREATE INDEX telemetry_events_event_name_received_at_idx ON public.telemetry_events (event_name, received_at DESC);
CREATE INDEX telemetry_events_app_version_received_at_idx ON public.telemetry_events (app_version, received_at DESC);
CREATE INDEX telemetry_events_installation_id_idx ON public.telemetry_events (installation_id);

ALTER TABLE public.telemetry_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telemetry_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.telemetry_events TO service_role;

CREATE OR REPLACE FUNCTION public.prune_expired_telemetry_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.telemetry_events
  WHERE received_at < now() - interval '90 days';
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_expired_telemetry_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_expired_telemetry_events() TO service_role;

CREATE TRIGGER telemetry_events_prune_after_insert
AFTER INSERT ON public.telemetry_events
FOR EACH STATEMENT
EXECUTE FUNCTION public.prune_expired_telemetry_events();

COMMENT ON TABLE public.telemetry_events IS 'Content-free anonymous desktop telemetry; raw rows retained for at most 90 days while ingestion is active.';
