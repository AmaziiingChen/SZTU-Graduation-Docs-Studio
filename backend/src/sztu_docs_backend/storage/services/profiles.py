"""Student-profile persistence without profile-field logging."""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping
from typing import Any

from ..database import Database, utc_now
from ..errors import NotFoundError, ValidationError
from .common import decode_json, encode_json, new_id, require_text
from .profile_drafts import normalize_english_thesis_title, normalize_thesis_title

PROFILE_FIELDS = (
    "full_name",
    "student_number",
    "college",
    "major",
    "class_name",
    "advisor_name",
    "advisor_title",
    "graduation_cohort",
    "thesis_title",
    "thesis_title_en",
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
            "advisor_title": require_text(
                payload, "advisor_title", maximum=100, required=False
            ),
            "graduation_cohort": require_text(
                payload, "graduation_cohort", maximum=20, required=False
            ),
            "thesis_title": normalize_thesis_title(payload.get("thesis_title")),
            "thesis_title_en": normalize_english_thesis_title(payload.get("thesis_title_en")),
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
                            class_name, advisor_name, advisor_title,
                            graduation_cohort, thesis_title_json, thesis_title_en,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            profile_id,
                            values["full_name"],
                            values["student_number"],
                            values["college"],
                            values["major"],
                            values["class_name"],
                            values["advisor_name"],
                            values["advisor_title"],
                            values["graduation_cohort"],
                            (
                                encode_json(values["thesis_title"], "thesis_title")
                                if values["thesis_title"] is not None
                                else None
                            ),
                            values["thesis_title_en"],
                            now,
                            now,
                        ),
                    )
                else:
                    cursor = connection.execute(
                        """
                        UPDATE student_profiles
                        SET full_name = ?, student_number = ?, college = ?, major = ?,
                            class_name = ?, advisor_name = ?,
                            advisor_title = CASE WHEN ? THEN ? ELSE advisor_title END,
                            graduation_cohort = CASE
                                WHEN ? THEN ? ELSE graduation_cohort END,
                            thesis_title_json = CASE
                                WHEN ? THEN ? ELSE thesis_title_json END,
                            thesis_title_en = CASE
                                WHEN ? THEN ? ELSE thesis_title_en END,
                            updated_at = ?
                        WHERE id = ? AND soft_deleted_at IS NULL
                        """,
                        (
                            values["full_name"],
                            values["student_number"],
                            values["college"],
                            values["major"],
                            values["class_name"],
                            values["advisor_name"],
                            int("advisor_title" in payload),
                            values["advisor_title"],
                            int("graduation_cohort" in payload),
                            values["graduation_cohort"],
                            int("thesis_title" in payload),
                            (
                                encode_json(values["thesis_title"], "thesis_title")
                                if values["thesis_title"] is not None
                                else None
                            ),
                            int("thesis_title_en" in payload),
                            values["thesis_title_en"],
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
                   advisor_name, advisor_title, graduation_cohort,
                   thesis_title_json, thesis_title_en,
                   created_at, updated_at
            FROM student_profiles
            WHERE id = ? AND soft_deleted_at IS NULL
            """,
            (profile_id,),
        ).fetchone()
        if row is None:
            raise NotFoundError("student_profile", profile_id)
        return self._decode_row(row)

    def list(self, *, limit: int = 100) -> list[dict[str, Any]]:
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 500:
            raise ValidationError("limit", "must_be_between_1_and_500")
        rows = self.database.connection.execute(
            """
            SELECT id, full_name, student_number, college, major, class_name,
                   advisor_name, advisor_title, graduation_cohort,
                   thesis_title_json, thesis_title_en,
                   created_at, updated_at
            FROM student_profiles
            WHERE soft_deleted_at IS NULL
            ORDER BY updated_at DESC, id ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [self._decode_row(row) for row in rows]

    @staticmethod
    def _decode_row(row: sqlite3.Row) -> dict[str, Any]:
        profile = dict(row)
        encoded_title = profile.pop("thesis_title_json")
        profile["thesis_title"] = (
            None
            if encoded_title is None
            else normalize_thesis_title(decode_json(encoded_title))
        )
        return profile

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
