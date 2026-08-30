"""Add optional shared student-profile fields without rewriting existing rows."""

from __future__ import annotations

import sqlite3


COLUMNS = {
    "advisor_title": "TEXT",
    "graduation_cohort": "TEXT",
}


def _column_names(connection: sqlite3.Connection) -> set[str]:
    return {
        str(row[1])
        for row in connection.execute("PRAGMA table_info(student_profiles)")
    }


def apply(connection: sqlite3.Connection) -> None:
    """Apply v3 idempotently for recovery and migration test tooling."""

    existing = _column_names(connection)
    for name, definition in COLUMNS.items():
        if name not in existing:
            connection.execute(
                f"ALTER TABLE student_profiles ADD COLUMN {name} {definition}"
            )
            existing.add(name)
