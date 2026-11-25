# CloudBase deployment

Environment: `amazingapp-d5giro9ac73398410` (`amazingapp`, Shanghai).

## Telemetry

- Function: `sztu-telemetry-ingest` (HTTP, Node.js 18)
- Route: `POST /api/telemetry/v1/events`
- Aggregate: `GET /api/telemetry/v1/events?aggregate=completed_documents`
- Table: `public.telemetry_events`
- Raw retention: 90 days
- Server API Key ID: `t3nPMquXSTennSVlVtO40w`
- Server API Key expiry: `2027-02-27T10:01:17+08:00`

The API Key value is stored only in the CloudBase function environment. Never add it to this repository or an Electron build. Rotate it before expiry and update the existing function environment variable `CLOUDBASE_API_KEY`.

The function rejects unknown event and attribute fields before persistence. PostgreSQL grants no table access to `anon` or `authenticated`; the server API Key uses `service_role`.

Each warm function process allows at most 30 batches per anonymous installation ID in five minutes. This protects against accidental retry storms without collecting IP addresses; it is not a substitute for future gateway-level abuse controls.

## User-initiated diagnostics

- Ingest route: `POST /api/diagnostics/v1/reports`
- Tables: `public.diagnostic_reports`, `public.diagnostic_access_audit`
- Report retention: 30 days
- Audit retention: 180 days
- Cleanup job: PostgreSQL `pg_cron` task `sztu-diagnostic-retention-daily` (daily at 03:15 in the database timezone)

The desktop app submits a report only after an explicit user action. The HTTP function repeats the exact-schema and privacy scans before writing. PostgreSQL triggers record successful receipt and physical deletion; `anon` and `authenticated` have no table access. PostgreSQL performs retention cleanup directly, so no additional cleanup credential is created or copied.

CloudBase PostgreSQL currently stores the anonymous function rule as an environment-level OPA policy for the `functions` resource type. This environment contains only `sztu-telemetry-ingest`. Before adding another cloud function, review and replace that policy with a function-specific rule supported by the then-current CloudBase schema, or place the new function in a separate environment. Do not assume a future function is private by default.

## Source layout

- `functions/sztu-telemetry-ingest/`: deployed HTTP function source
- `migrations/20260831090000_create_telemetry_events.sql`: applied database migration
- `migrations/20260903090000_create_diagnostic_reports.sql`: diagnostic retention and audit migration
- `migrations/20260903093000_schedule_diagnostic_retention.sql`: daily PostgreSQL retention job
- `migrations/20261006090000_accept_diagnostic_reports.sql`: widens the diagnostic report schema-version constraint (deploy before the v1.3 ingest service)
- `migrations/20261113090000_accept_diagnostic_steps.sql`: accepts diagnostic schema 3 steps before enabling the client-side upgrade
- `migrations/20261113091500_create_full_diagnostic_reports.sql`: creates `public.full_diagnostic_reports` for full diagnostic packages
- `migrations/20261126090000_create_feedback_reports.sql`: creates `public.feedback_reports` for user-submitted feedback and its 180-day retention job
- `queries/telemetry-overview.sql`: read-only queries for recent events, daily activity, action outcomes, errors, and version distribution

Update artifacts are not deployed yet. Static hosting or COS must expose only signed manifests and release packages; never use this telemetry credential in a client or storage URL. Schema 2.0 also carries signed announcements, help links, minimum-version rules, maintenance, and retirement status. The Ed25519 signing key is generated and retained outside the repository; it is unrelated to paid platform code-signing certificates.

## Developer dashboard

The repository includes a local-only telemetry dashboard in `apps/telemetry-admin/`. It reads PostgreSQL through a server-side CloudBase API Key and does not expose the key, installation IDs, session IDs, or raw attributes to browser code. See `docs/TELEMETRY_DASHBOARD.md` for metric definitions and security boundaries.
