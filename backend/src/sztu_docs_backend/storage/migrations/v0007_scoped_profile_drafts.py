"""Bind the legacy shared draft to its student before profiles can switch."""

import sqlite3


def apply(connection: sqlite3.Connection) -> None:
    draft = connection.execute("""
        SELECT value_json, updated_at FROM settings WHERE key = 'workbench.profile_draft'
    """).fetchone()
    if draft is None:
        return
    active = connection.execute("""
        SELECT json_extract(value_json, '$.profile_id') FROM settings
        WHERE key = 'workbench.active'
    """).fetchone()
    if active is None:
        profiles = connection.execute("""
            SELECT id FROM student_profiles WHERE soft_deleted_at IS NULL LIMIT 2
        """).fetchall()
        active = profiles[0] if len(profiles) == 1 else None
    if active is None or active[0] is None:
        return
    profile = connection.execute("""
        SELECT id FROM student_profiles WHERE id = ? AND soft_deleted_at IS NULL
    """, (active[0],)).fetchone()
    if profile is not None:
        connection.execute("""
            INSERT OR IGNORE INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)
        """, (f"workbench.profile_draft.{profile[0]}", draft[0], draft[1]))
        connection.execute("DELETE FROM settings WHERE key = 'workbench.profile_draft'")
