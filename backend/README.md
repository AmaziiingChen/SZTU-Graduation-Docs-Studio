# Python sidecar

The backend is a dependency-free Python 3.11+ JSONL process. It is intentionally
small so it can run on Python 3.14 without waiting for third-party packages.

Runtime and tests use only the Python standard library. Building or installing a
wheel from `pyproject.toml` additionally requires `setuptools>=75`; it is not
installed in the current Python 3.14 environment, and is not needed for local
development or the Electron sidecar invocation shown below.

Run it from this directory:

```sh
PYTHONPATH=src python3 -m sztu_docs_backend
```

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
workspace.restore_previous(document_id, expected_revision)
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
| `workspace.restorePrevious` | `document_id`, `expected_revision` | full restored document |
| `workspace.closeTemporary` | `document_id` | discards in-memory data and reopens persistent selection |
| `workspace.close` | `{}` | closed mode receipt |

Opening temporary mode while persistent mode is active is an explicit switch
and closes the persistent connection first. Returning from temporary mode uses
`workspace.closeTemporary`; calling `workspace.open` cannot silently discard an
already-open temporary workspace.

In addition to the base protocol errors, the stateful layer can return
`MESSAGE_TOO_LARGE`, `DUPLICATE_REQUEST_ID`, `WORKSPACE_NOT_OPEN`,
`WORKSPACE_ALREADY_OPEN`, `NOT_FOUND`, `REVISION_CONFLICT`, `VALIDATION`,
`MIGRATION_FAILED`, or `STORAGE_ERROR`. Storage error messages and details are
allowlisted so a rejected request cannot reflect a name, student number, draft
body, or full filesystem path.
