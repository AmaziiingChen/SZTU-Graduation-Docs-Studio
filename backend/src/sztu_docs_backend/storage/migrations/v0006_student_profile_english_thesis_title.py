"""Add the shared English thesis title to student profiles."""

from __future__ import annotations

import sqlite3


def apply(connection: sqlite3.Connection) -> None:
    columns = {str(row[1]) for row in connection.execute("PRAGMA table_info(student_profiles)")}
    if "thesis_title_en" not in columns:
        connection.execute("ALTER TABLE student_profiles ADD COLUMN thesis_title_en TEXT")
