"""Student-profile persistence without profile-field logging."""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping
from typing import Any

from ..database import Database, utc_now
from ..errors import NotFoundError, ValidationError
from .common import new_id, require_text

PROFILE_FIELDS = (
    "full_name",
    "student_number",
    "college",
    "major",
    "class_name",
    "advisor_name",
)


class ProfileService:
    def __init__(self, database: Database) -> None:
        self.database = database

    def save(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        supplied_id = payload.get("id")
        if supplied_id is not None and not isinstance(supplied_id, str):
            raise ValidationError("id", "must_be_text")

        values = {
            "full_name": require_text(payload, "full_name", maximum=100),
            "student_number": require_text(payload, "student_number", maximum=64),
            "college": require_text(payload, "college", maximum=200),
            "major": require_text(payload, "major", maximum=200),
            "class_name": require_text(
                payload, "class_name", maximum=100, required=False
            ),
            "advisor_name": require_text(
                payload, "advisor_name", maximum=100, required=False
            ),
        }
        now = utc_now()
        profile_id = supplied_id or new_id()

        try:
            with self.database.transaction(immediate=True) as connection:
                if supplied_id is None:
                    connection.execute(
                        """
                        INSERT INTO student_profiles(
                            id, full_name, student_number, college, major,
                            class_name, advisor_name, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            profile_id,
                            values["full_name"],
                            values["student_number"],
                            values["college"],
                            values["major"],
                            values["class_name"],
                            values["advisor_name"],
                            now,
                            now,
                        ),
                    )
                else:
                    cursor = connection.execute(
                        """
                        UPDATE student_profiles
                        SET full_name = ?, student_number = ?, college = ?, major = ?,
                            class_name = ?, advisor_name = ?, updated_at = ?
                        WHERE id = ? AND soft_deleted_at IS NULL
                        """,
                        (
                            values["full_name"],
                            values["student_number"],
                            values["college"],
                            values["major"],
                            values["class_name"],
                            values["advisor_name"],
                            now,
                            profile_id,
                        ),
                    )
                    if cursor.rowcount != 1:
                        raise NotFoundError("student_profile", profile_id)
        except sqlite3.IntegrityError as exc:
            raise ValidationError("student_number", "must_be_unique") from exc
        return self.get(profile_id)

    def get(self, profile_id: str) -> dict[str, Any]:
        row = self.database.connection.execute(
            """
            SELECT id, full_name, student_number, college, major, class_name,
                   advisor_name, created_at, updated_at
            FROM student_profiles
            WHERE id = ? AND soft_deleted_at IS NULL
            """,
            (profile_id,),
        ).fetchone()
        if row is None:
            raise NotFoundError("student_profile", profile_id)
        return dict(row)

    def list(self, *, limit: int = 100) -> list[dict[str, Any]]:
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 500:
            raise ValidationError("limit", "must_be_between_1_and_500")
        rows = self.database.connection.execute(
            """
            SELECT id, full_name, student_number, college, major, class_name,
                   advisor_name, created_at, updated_at
            FROM student_profiles
            WHERE soft_deleted_at IS NULL
            ORDER BY updated_at DESC, id ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]

    def soft_delete(self, profile_id: str) -> dict[str, Any]:
        now = utc_now()
        with self.database.transaction(immediate=True) as connection:
            cursor = connection.execute(
                """
                UPDATE student_profiles
                SET soft_deleted_at = ?, updated_at = ?
                WHERE id = ? AND soft_deleted_at IS NULL
                """,
                (now, now, profile_id),
            )
            if cursor.rowcount != 1:
                raise NotFoundError("student_profile", profile_id)
        return {"id": profile_id, "deleted": True}
