"""Document and bounded draft-revision services."""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping
from typing import Any

from ..database import Database, utc_now
from ..errors import NotFoundError, RevisionConflictError, ValidationError
from .common import decode_json, encode_json, new_id, require_text

SAVE_REASONS = frozenset({"auto", "manual", "restore", "import"})


class DocumentService:
    def __init__(self, database: Database, *, revision_limit: int = 20) -> None:
        if revision_limit < 2:
            raise ValueError("revision_limit must keep at least two revisions")
        self.database = database
        self.revision_limit = revision_limit

    def create(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        profile_id = payload.get("profile_id")
        if profile_id is not None and not isinstance(profile_id, str):
            raise ValidationError("profile_id", "must_be_text")
        document_type = require_text(payload, "document_type", maximum=64)
        template_version = require_text(payload, "template_version", maximum=64)
        schema_version = require_text(payload, "schema_version", maximum=64)
        title = require_text(payload, "title", maximum=240)
        document_id = new_id()
        now = utc_now()

        try:
            with self.database.transaction(immediate=True) as connection:
                if profile_id is not None:
                    profile = connection.execute(
                        "SELECT 1 FROM student_profiles WHERE id = ? AND soft_deleted_at IS NULL",
                        (profile_id,),
                    ).fetchone()
                    if profile is None:
                        raise NotFoundError("student_profile", profile_id)
                connection.execute(
                    """
                    INSERT INTO documents(
                        id, profile_id, document_type, template_version,
                        schema_version, title, is_temporary, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        document_id,
                        profile_id,
                        document_type,
                        template_version,
                        schema_version,
                        title,
                        int(self.database.temporary),
                        now,
                        now,
                    ),
                )
        except sqlite3.IntegrityError as exc:
            raise ValidationError("document", "constraint_failed") from exc
        return self.get(document_id)

    def get(self, document_id: str) -> dict[str, Any]:
        row = self.database.connection.execute(
            """
            SELECT id, profile_id, document_type, template_version, schema_version,
                   title, status, is_temporary, current_revision, created_at, updated_at
            FROM documents WHERE id = ?
            """,
            (document_id,),
        ).fetchone()
        if row is None:
            raise NotFoundError("document", document_id)
        result = dict(row)
        result["is_temporary"] = bool(result["is_temporary"])
        revision = self.database.connection.execute(
            """
            SELECT content_json, save_reason, created_at
            FROM draft_revisions
            WHERE document_id = ? AND revision_number = ?
            """,
            (document_id, result["current_revision"]),
        ).fetchone()
        result["content"] = decode_json(revision["content_json"]) if revision else None
        result["save_reason"] = revision["save_reason"] if revision else None
        result["saved_at"] = revision["created_at"] if revision else None
        return result

    def list(
        self, *, profile_id: str | None = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        if profile_id is not None and not isinstance(profile_id, str):
            raise ValidationError("profile_id", "must_be_text")
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 500:
            raise ValidationError("limit", "must_be_between_1_and_500")
        where = "WHERE profile_id = ?" if profile_id is not None else ""
        parameters: tuple[Any, ...] = (profile_id, limit) if profile_id is not None else (limit,)
        rows = self.database.connection.execute(
            f"""
            SELECT id, profile_id, document_type, template_version, schema_version,
                   title, status, is_temporary, current_revision, created_at, updated_at
            FROM documents
            {where}
            ORDER BY updated_at DESC, id ASC
            LIMIT ?
            """,
            parameters,
        ).fetchall()
        result = [dict(row) for row in rows]
        for item in result:
            item["is_temporary"] = bool(item["is_temporary"])
        return result

    def assign_profile(self, document_id: str, profile_id: str) -> dict[str, Any]:
        if not isinstance(document_id, str) or not document_id:
            raise ValidationError("document_id", "must_be_text")
        if not isinstance(profile_id, str) or not profile_id:
            raise ValidationError("profile_id", "must_be_text")
        now = utc_now()
        with self.database.transaction(immediate=True) as connection:
            profile = connection.execute(
                "SELECT 1 FROM student_profiles WHERE id = ? AND soft_deleted_at IS NULL",
                (profile_id,),
            ).fetchone()
            if profile is None:
                raise NotFoundError("student_profile", profile_id)
            document = connection.execute(
                "SELECT profile_id FROM documents WHERE id = ?", (document_id,)
            ).fetchone()
            if document is None:
                raise NotFoundError("document", document_id)
            current_profile_id = document["profile_id"]
            if current_profile_id not in {None, profile_id}:
                raise ValidationError("profile_id", "already_assigned")
            if current_profile_id is None:
                connection.execute(
                    "UPDATE documents SET profile_id = ?, updated_at = ? WHERE id = ?",
                    (profile_id, now, document_id),
                )
        return self.get(document_id)

    def save_draft(
        self,
        document_id: str,
        content: Mapping[str, Any],
        expected_revision: int,
        *,
        reason: str = "auto",
    ) -> dict[str, Any]:
        if not isinstance(expected_revision, int) or isinstance(expected_revision, bool):
            raise ValidationError("expected_revision", "must_be_integer")
        if expected_revision < 0:
            raise ValidationError("expected_revision", "must_be_non_negative")
        if reason not in SAVE_REASONS:
            raise ValidationError("reason", "unsupported")
        if not isinstance(content, Mapping):
            raise ValidationError("content", "must_be_object")
        content_json = encode_json(dict(content), "content")
        return self._append_revision(
            document_id,
            content_json,
            expected_revision,
            reason=reason,
        )

    def _append_revision(
        self,
        document_id: str,
        content_json: str,
        expected_revision: int,
        *,
        reason: str,
    ) -> dict[str, Any]:
        now = utc_now()
        with self.database.transaction(immediate=True) as connection:
            current = connection.execute(
                "SELECT current_revision FROM documents WHERE id = ?",
                (document_id,),
            ).fetchone()
            if current is None:
                raise NotFoundError("document", document_id)
            actual_revision = int(current["current_revision"])
            if actual_revision != expected_revision:
                raise RevisionConflictError(
                    document_id, expected_revision, actual_revision
                )
            new_revision = actual_revision + 1
            cursor = connection.execute(
                """
                UPDATE documents
                SET current_revision = ?, updated_at = ?
                WHERE id = ? AND current_revision = ?
                """,
                (new_revision, now, document_id, expected_revision),
            )
            if cursor.rowcount != 1:
                refreshed = connection.execute(
                    "SELECT current_revision FROM documents WHERE id = ?",
                    (document_id,),
                ).fetchone()
                if refreshed is None:
                    raise NotFoundError("document", document_id)
                raise RevisionConflictError(
                    document_id, expected_revision, int(refreshed["current_revision"])
                )
            connection.execute(
                """
                INSERT INTO draft_revisions(
                    id, document_id, revision_number, content_json,
                    save_reason, based_on_revision, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id(),
                    document_id,
                    new_revision,
                    content_json,
                    reason,
                    expected_revision,
                    now,
                ),
            )
            connection.execute(
                """
                DELETE FROM draft_revisions
                WHERE document_id = ? AND revision_number NOT IN (
                    SELECT revision_number FROM draft_revisions
                    WHERE document_id = ?
                    ORDER BY revision_number DESC LIMIT ?
                )
                """,
                (document_id, document_id, self.revision_limit),
            )
        return {
            "document_id": document_id,
            "revision": new_revision,
            "save_reason": reason,
            "saved_at": now,
        }

    def restore_previous(
        self, document_id: str, expected_revision: int
    ) -> dict[str, Any]:
        if not isinstance(expected_revision, int) or isinstance(expected_revision, bool):
            raise ValidationError("expected_revision", "must_be_integer")
        current = self.database.connection.execute(
            "SELECT current_revision FROM documents WHERE id = ?", (document_id,)
        ).fetchone()
        if current is None:
            raise NotFoundError("document", document_id)
        actual = int(current["current_revision"])
        if actual != expected_revision:
            raise RevisionConflictError(document_id, expected_revision, actual)
        previous = self.database.connection.execute(
            """
            SELECT content_json, revision_number FROM draft_revisions
            WHERE document_id = ? AND revision_number < ?
            ORDER BY revision_number DESC LIMIT 1
            """,
            (document_id, actual),
        ).fetchone()
        if previous is None:
            raise NotFoundError("previous_revision", document_id)
        result = self._append_revision(
            document_id,
            previous["content_json"],
            expected_revision,
            reason="restore",
        )
        result["restored_from_revision"] = int(previous["revision_number"])
        return result

    def close_temporary(self, document_id: str) -> dict[str, Any]:
        with self.database.transaction(immediate=True) as connection:
            row = connection.execute(
                "SELECT is_temporary FROM documents WHERE id = ?", (document_id,)
            ).fetchone()
            if row is None:
                raise NotFoundError("document", document_id)
            if not bool(row["is_temporary"]):
                raise ValidationError("document_id", "not_temporary")
            connection.execute("DELETE FROM documents WHERE id = ?", (document_id,))
        return {"document_id": document_id, "deleted": True}
