# Signed release control design

The existing update manifest becomes a signed release document. Schema 2.0 adds a strict `control` object beside update artifacts. The Electron main process verifies and parses it; the renderer receives only the validated typed result.

The signing key remains on the release machine. A public key is pinned into `remote-services.json`. Static HTTPS hosting may serve the signed JSON and public installers. Updating telemetry ingestion is not required for each desktop release.

The renderer uses default shadcn dialogs and buttons. Plain text and HTTPS-only URLs prevent remote content from becoming an executable UI surface. A retired release is blocking; maintenance is advisory so local documents remain recoverable.

Tests cover schema compatibility, exact-key rejection, time-bounded announcements, version policy, URL validation, and signing-tool output.
