"""Persist frozen export requests, receipts, engines, and cancellation state."""

from __future__ import annotations

import sqlite3


COLUMNS = {
    "export_jobs": {
        "request_id": "TEXT",
        "input_sha256": "TEXT",
        "template_id": "TEXT",
        "template_version": "TEXT",
        "template_sha256": "TEXT",
        "snapshot_json": "TEXT",
        "receipt_json": "TEXT",
        "overwrite_confirmed": (
            "INTEGER NOT NULL DEFAULT 0 CHECK (overwrite_confirmed IN (0, 1))"
        ),
        "cancel_requested_at": "TEXT",
        "completed_at": "TEXT",
    },
    "export_artifacts": {
        "replaced_existing": (
            "INTEGER NOT NULL DEFAULT 0 CHECK (replaced_existing IN (0, 1))"
        ),
    },
    "template_installations": {
        "install_path": "TEXT",
        "metadata_json": "TEXT",
    },
}


def _column_names(connection: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in connection.execute(f"PRAGMA table_info({table})")}


def apply(connection: sqlite3.Connection) -> None:
    """Apply v2 safely even when invoked again during recovery tooling."""

    for table, definitions in COLUMNS.items():
        existing = _column_names(connection, table)
        for name, definition in definitions.items():
            if name not in existing:
                connection.execute(
                    f"ALTER TABLE {table} ADD COLUMN {name} {definition}"
                )
                existing.add(name)

    # A queued/running v1 row necessarily belongs to a process that has already
    # stopped before this migration can run. Mark it terminal before enforcing
    # one active job per document.
    connection.execute(
        """
        UPDATE export_jobs
        SET status = 'failed', progress = 100,
            error_code = 'EXPORT_INTERRUPTED',
            completed_at = COALESCE(completed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE status IN ('queued', 'running')
        """
    )
    connection.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_export_jobs_request_id
        ON export_jobs(request_id) WHERE request_id IS NOT NULL
        """
    )
    connection.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_export_jobs_active_document
        ON export_jobs(document_id) WHERE status IN ('queued', 'running')
        """
    )
