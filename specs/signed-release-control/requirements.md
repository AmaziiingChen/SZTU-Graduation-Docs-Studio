# Signed release control requirements

## Scope

Provide a free, self-hosted, signed release-control channel for desktop builds. The channel covers software updates, notices, help links, minimum supported versions, maintenance, and retirement without placing signing secrets in the application or repository.

## Acceptance criteria

1. When the desktop client receives a release document, it shall reject the entire document unless its Ed25519 signature and strict schema are valid.
2. When a valid announcement is active, the desktop client shall show its plain-text title and body without interpreting HTML or Markdown.
3. When a valid help URL is present, the desktop client shall open it only through the existing trusted external-link boundary.
4. When the current version is below the signed minimum supported version, the desktop client shall require the user to update before entering the workbench.
5. When the signed service status is `maintenance`, the desktop client shall disclose the interruption while retaining a path to local work.
6. When the signed service status is `retired`, the desktop client shall block the workbench and offer only the signed help link, a verified downloaded update, or application exit.
7. When a release manager creates a release document, signing shall use a locally held Ed25519 private key and shall never persist that key in the repository, client build, or browser storage.
8. Existing schema 1.0 update manifests shall remain valid and behave as optional updates with no remote notice or service restriction.

## Non-goals

- Automatic installation, restart, or rollback.
- macOS notarization or Windows Authenticode purchasing.
- Arbitrary remote code, HTML, Markdown, or commands.
