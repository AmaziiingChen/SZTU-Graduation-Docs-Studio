"""Independent document files with one current autosaved draft each."""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping
from typing import Any

from ..database import Database, utc_now
from ..errors import NotFoundError, RevisionConflictError, ValidationError
from .common import decode_json, encode_json, new_id, require_text

SAVE_REASONS = frozenset({"auto", "manual", "import"})


class DocumentService:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        profile_id = payload.get("profile_id")
        if profile_id is not None and not isinstance(profile_id, str):
            raise ValidationError("profile_id", "must_be_text")
        document_type = require_text(payload, "document_type", maximum=64)
        template_version = require_text(payload, "template_version", maximum=64)
        schema_version = require_text(payload, "schema_version", maximum=64)
        title = require_text(payload, "title", maximum=240)
        source_document_id = payload.get("source_document_id")
        if source_document_id is not None and (
            not isinstance(source_document_id, str) or not source_document_id
        ):
            raise ValidationError("source_document_id", "must_be_text")
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
                source_content_json: str | None = None
                if source_document_id is not None:
                    source = connection.execute(
                        """
                        SELECT profile_id, document_type, current_revision
                        FROM documents
                        WHERE id = ? AND soft_deleted_at IS NULL
                        """,
                        (source_document_id,),
                    ).fetchone()
                    if source is None:
                        raise NotFoundError("document", source_document_id)
                    if source["profile_id"] != profile_id:
                        raise ValidationError("source_document_id", "does_not_belong_to_profile")
                    if source["document_type"] != document_type:
                        raise ValidationError("source_document_id", "document_type_mismatch")
                    if int(source["current_revision"]) > 0:
                        revision = connection.execute(
                            """
                            SELECT content_json FROM draft_revisions
                            WHERE document_id = ? AND revision_number = ?
                            """,
                            (source_document_id, source["current_revision"]),
                        ).fetchone()
                        source_content_json = (
                            str(revision["content_json"]) if revision is not None else None
                        )
                connection.execute(
                    """
                    INSERT INTO documents(
                        id, profile_id, document_type, template_version,
                        schema_version, title, is_temporary, current_revision,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        document_id,
                        profile_id,
                        document_type,
                        template_version,
                        schema_version,
                        title,
                        int(self.database.temporary),
                        1 if source_content_json is not None else 0,
                        now,
                        now,
                    ),
                )
                if source_content_json is not None:
                    connection.execute(
                        """
                        INSERT INTO draft_revisions(
                            id, document_id, revision_number, content_json,
                            save_reason, based_on_revision, created_at
                        ) VALUES (?, ?, 1, ?, 'import', 0, ?)
                        """,
                        (new_id(), document_id, source_content_json, now),
                    )
        except sqlite3.IntegrityError as exc:
            raise ValidationError("document", "constraint_failed") from exc
        return self.get(document_id)

    def get(self, document_id: str, *, include_deleted: bool = False) -> dict[str, Any]:
        deleted_clause = "" if include_deleted else " AND soft_deleted_at IS NULL"
        row = self.database.connection.execute(
            f"""
            SELECT id, profile_id, document_type, template_version, schema_version,
                   title, status, is_temporary, current_revision, created_at, updated_at,
                   soft_deleted_at
            FROM documents WHERE id = ?{deleted_clause}
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
        where = "WHERE soft_deleted_at IS NULL"
        if profile_id is not None:
            where += " AND profile_id = ?"
        parameters: tuple[Any, ...] = (profile_id, limit) if profile_id is not None else (limit,)
        rows = self.database.connection.execute(
            f"""
            SELECT id, profile_id, document_type, template_version, schema_version,
                   title, status, is_temporary, current_revision, created_at, updated_at,
                   soft_deleted_at
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

    def list_deleted(
        self, *, profile_id: str | None = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        if profile_id is not None and not isinstance(profile_id, str):
            raise ValidationError("profile_id", "must_be_text")
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 500:
            raise ValidationError("limit", "must_be_between_1_and_500")
        where = "WHERE soft_deleted_at IS NOT NULL"
        parameters: tuple[Any, ...] = (limit,)
        if profile_id is not None:
            where += " AND profile_id = ?"
            parameters = (profile_id, limit)
        rows = self.database.connection.execute(
            f"""
            SELECT id, profile_id, document_type, template_version, schema_version,
                   title, status, is_temporary, current_revision, created_at, updated_at,
                   soft_deleted_at
            FROM documents
            {where}
            ORDER BY soft_deleted_at DESC, id ASC
            LIMIT ?
            """,
            parameters,
        ).fetchall()
        result = [dict(row) for row in rows]
        for item in result:
            item["is_temporary"] = bool(item["is_temporary"])
        return result

    def rename(self, document_id: str, title: str) -> dict[str, Any]:
        if not isinstance(document_id, str) or not document_id:
            raise ValidationError("document_id", "must_be_text")
        if not isinstance(title, str) or not title.strip():
            raise ValidationError("title", "required")
        normalized = title.strip()
        if len(normalized) > 240:
            raise ValidationError("title", "too_long")
        with self.database.transaction(immediate=True) as connection:
            cursor = connection.execute(
                """
                UPDATE documents SET title = ?, updated_at = ?
                WHERE id = ? AND soft_deleted_at IS NULL
                """,
                (normalized, utc_now(), document_id),
            )
            if cursor.rowcount != 1:
                raise NotFoundError("document", document_id)
        return self.get(document_id)

    def soft_delete(self, document_id: str) -> dict[str, Any]:
        now = utc_now()
        with self.database.transaction(immediate=True) as connection:
            row = connection.execute(
                "SELECT is_temporary FROM documents WHERE id = ? AND soft_deleted_at IS NULL",
                (document_id,),
            ).fetchone()
            if row is None:
                raise NotFoundError("document", document_id)
            if bool(row["is_temporary"]):
                raise ValidationError("document_id", "temporary_document")
            connection.execute(
                "UPDATE documents SET soft_deleted_at = ?, updated_at = ? WHERE id = ?",
                (now, now, document_id),
            )
        return self.get(document_id, include_deleted=True)

    def restore(self, document_id: str) -> dict[str, Any]:
        now = utc_now()
        with self.database.transaction(immediate=True) as connection:
            cursor = connection.execute(
                """
                UPDATE documents SET soft_deleted_at = NULL, updated_at = ?
                WHERE id = ? AND soft_deleted_at IS NOT NULL
                """,
                (now, document_id),
            )
            if cursor.rowcount != 1:
                raise NotFoundError("document", document_id)
        return self.get(document_id)

    def purge(self, document_id: str) -> dict[str, Any]:
        with self.database.transaction(immediate=True) as connection:
            row = connection.execute(
                "SELECT 1 FROM documents WHERE id = ? AND soft_deleted_at IS NOT NULL",
                (document_id,),
            ).fetchone()
            if row is None:
                raise NotFoundError("document", document_id)
            connection.execute("DELETE FROM documents WHERE id = ?", (document_id,))
        return {"document_id": document_id, "deleted": True}

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
                "SELECT profile_id FROM documents WHERE id = ? AND soft_deleted_at IS NULL", (document_id,)
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
                "SELECT current_revision FROM documents WHERE id = ? AND soft_deleted_at IS NULL",
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
                WHERE id = ? AND current_revision = ? AND soft_deleted_at IS NULL
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
                WHERE document_id = ? AND revision_number <> ?
                """,
                (document_id, new_revision),
            )
        return {
            "document_id": document_id,
            "revision": new_revision,
            "save_reason": reason,
            "saved_at": now,
        }

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
