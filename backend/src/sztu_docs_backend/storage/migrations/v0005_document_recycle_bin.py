"""Add soft deletion support for independent document files."""

from __future__ import annotations

import sqlite3


COLUMN = "soft_deleted_at"


def apply(connection: sqlite3.Connection) -> None:
    """Apply v5 idempotently and index active/recycled document queries."""

    existing = {
        str(row[1]) for row in connection.execute("PRAGMA table_info(documents)")
    }
    if COLUMN not in existing:
        connection.execute(
            "ALTER TABLE documents ADD COLUMN soft_deleted_at TEXT"
        )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_documents_recycle_bin "
        "ON documents(profile_id, soft_deleted_at, updated_at DESC)"
    )
