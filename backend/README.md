# Python sidecar

The protocol, storage, and orchestration layer is a small Python 3.11+ JSONL
process. Document rendering additionally requires the dependencies declared in
`pyproject.toml`: `python-docx` and `Pillow`.

From the repository root, `pnpm setup:backend` creates an ignored, repository-local
`.venv` and installs those dependencies. Electron automatically prefers that
runtime over a global `python3`; `pnpm dev` and `pnpm verify` prepare and use the
same runtime so environment checks and real rendering tests cannot silently run
under different Python installations.

Run it from this directory:

```sh
PYTHONPATH=src python3 -m sztu_docs_backend
```

When invoking the sidecar manually for document rendering, use the repository
runtime instead: `.venv/bin/python -m sztu_docs_backend` on macOS/Linux or
`.venv\\Scripts\\python.exe -m sztu_docs_backend` on Windows.

Example request:

```json
{"protocol":"1.0","id":"550e8400-e29b-41d4-a716-446655440000","method":"environment.check","params":{}}
```

Run the standard-library test suite:

```sh
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

Protocol JSON is written only to standard output. Logs are written only to
standard error. `environment.check` treats Python and temporary-directory
writability as required; XeLaTeX and Word/WPS discovery are advisory until an
export method explicitly requires them.

## Local SQLite workspace API

Electron should pass its private user-data directory through
`SZTU_DOCS_DATA_DIR=app.getPath('userData')`. Direct callers may inject an
absolute temporary directory in tests. The persistent database is never placed
in the source checkout by default.

```python
from sztu_docs_backend.storage import Workspace

workspace = Workspace.open_persistent()  # reads SZTU_DOCS_DATA_DIR
temporary = Workspace.create_temporary()  # in-memory; close clears all records
```

The protocol layer can map these service calls without importing SQLite:

```python
workspace.save_profile(profile_payload)
workspace.list_profiles(limit=100)
workspace.create_document(document_payload)
workspace.list_documents(profile_id=profile_id, limit=100)
workspace.save_draft(document_id, content, expected_revision, reason="auto")
workspace.save_active(profile_id=profile_id, document_id=document_id)
workspace.load_active()
workspace.export_snapshot()
workspace.delete_all_data()
workspace.close()
```

All public results are JSON-serializable dictionaries or lists. Expected domain
errors expose stable codes: `NOT_FOUND`, `REVISION_CONFLICT`, `VALIDATION`,
`MIGRATION_FAILED`, and `STORAGE_ERROR`. Error details contain only record IDs
and machine-readable state; storage code does not log names, student numbers,
draft bodies, or full paths.

`export_snapshot()` returns the owned database records and deliberately omits
host output directories and logs. `delete_all_data()` is explicit-only and
removes records from an enumerated set of owned tables plus migration backups
whose names match the application's private backup convention. It does not
delete unrelated files or exported documents outside the database.

## Stateful JSONL methods

Every request id is an RFC UUID string and may appear only once during one
sidecar process. One input line, including its newline, is limited to 1 MiB.
Workspace calls are stateful within that process:

| Method | Params | Result |
| --- | --- | --- |
| `workspace.open` | `{"mode":"persistent"}` or `{"mode":"temporary"}` | current `mode`, `profile`, and full `document` |
| `workspace.load` | `{}` | current selection, with recent-record fallback |
| `workspace.saveProfile` | `{"profile":{...}}` | saved profile |
| `workspace.createDocument` | `{"document":{...}}` | created document |
| `workspace.saveDraft` | `document_id`, `content`, `expected_revision`, optional `reason` | full saved document |
| `workspace.closeTemporary` | `document_id` | discards in-memory data and reopens persistent selection |
| `workspace.close` | `{}` | closed mode receipt |

Opening temporary mode while persistent mode is active is an explicit switch
and closes the persistent connection first. Returning from temporary mode uses
`workspace.closeTemporary`; calling `workspace.open` cannot silently discard an
already-open temporary workspace.

Draft input is automatically saved, but the workbench is not a writing-version
manager. Each document retains only its current draft content; the monotonically
increasing revision number is used solely for stale-write and concurrency
protection. Export input snapshots and export history remain separate records.

`preview.generate` is available only in a persistent workspace. It clones the
current profile and draft into an in-memory workspace, resolves the current
trusted template snapshot, runs the same PDF renderer used by `export.run`, and
creates 150 DPI PNG pages in the private application data directory. The preview
does not create a persistent export job. The sidecar returns internal paths only
to Electron main; preload exposes only pages that main has confined, type-checked,
size-checked, and SHA-256 verified.

In addition to the base protocol errors, the stateful layer can return
`MESSAGE_TOO_LARGE`, `DUPLICATE_REQUEST_ID`, `WORKSPACE_NOT_OPEN`,
`WORKSPACE_ALREADY_OPEN`, `NOT_FOUND`, `REVISION_CONFLICT`, `VALIDATION`,
`MIGRATION_FAILED`, or `STORAGE_ERROR`. Storage error messages and details are
allowlisted so a rejected request cannot reflect a name, student number, draft
body, or full filesystem path.

## Live template workspace

`template.install` links a local template project rather than copying it into a
mutable installed directory. For proposal, task-book, and midterm documents,
select the project root that contains `templates/`, `scripts/`, and their shared
template dependencies. The task-book protocol type is `task_book`; its strict
document Schema remains `0.1`.

Each `environment.check`, export preflight, and export request re-reads the
allowlisted template files. The backend validates path and symlink boundaries,
computes a combined SHA-256, and renders from a private content-addressed
snapshot. This lets local template work continue without weakening the
immutable template identity recorded in export receipts. Fixed published
template packs still use their declared file hashes and reject drift.
