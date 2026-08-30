"""Add the shared rich-text thesis title to student profiles."""

from __future__ import annotations

import sqlite3


COLUMN = "thesis_title_json"


def apply(connection: sqlite3.Connection) -> None:
    """Apply v4 idempotently without rewriting existing profile content."""

    existing = {
        str(row[1])
        for row in connection.execute("PRAGMA table_info(student_profiles)")
    }
    if COLUMN not in existing:
        connection.execute(
            "ALTER TABLE student_profiles "
            "ADD COLUMN thesis_title_json TEXT"
        )
