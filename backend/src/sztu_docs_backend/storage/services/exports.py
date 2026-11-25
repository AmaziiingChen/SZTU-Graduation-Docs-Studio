"""Transactional export history and template-installation persistence."""

from __future__ import annotations

import re
import sqlite3
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from ..database import Database, utc_now
from ..errors import NotFoundError, ValidationError
from .common import decode_json, encode_json, new_id

HASH_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")
ACTIVE_STATUSES = frozenset({"queued", "running"})


def _text(value: Any, field: str, *, maximum: int = 240) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(field, "required")
    normalized = value.strip()
    if len(normalized) > maximum:
        raise ValidationError(field, "too_long")
    return normalized


def _hash(value: Any, field: str) -> str:
    normalized = _text(value, field, maximum=64).lower()
    if HASH_PATTERN.fullmatch(normalized) is None:
        raise ValidationError(field, "invalid_sha256")
    return normalized


def _optional_json(value: str | None) -> Any:
    return None if value is None else decode_json(value)


def insert_job_row(
    connection: sqlite3.Connection,
    *,
    job_id: str,
    document_id: str,
    formats_json: str,
    status: str,
    progress: int,
    output_directory: str,
    now: str,
    request_id: str,
    input_sha256: str,
    template_id: str,
    template_version: str,
    template_sha256: str,
    snapshot_json: str,
    overwrite_confirmed: bool,
) -> None:
    """Write one export_jobs row; callers own validation and transactions."""

    if status not in ACTIVE_STATUSES:
        raise ValidationError("status", "must_be_active")
    connection.execute(
        """
        INSERT INTO export_jobs(
            id, document_id, requested_formats_json, status, progress,
            output_directory, created_at, updated_at, request_id,
            input_sha256, template_id, template_version, template_sha256,
            snapshot_json, overwrite_confirmed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            job_id,
            document_id,
            formats_json,
            status,
            progress,
            output_directory,
            now,
            now,
            request_id,
            input_sha256,
            template_id,
            template_version,
            template_sha256,
            snapshot_json,
            int(overwrite_confirmed),
        ),
    )


def insert_artifact_rows(
    connection: sqlite3.Connection,
    job_id: str,
    artifacts: Sequence[Mapping[str, Any]],
    created_at: str,
) -> None:
    """Insert export_artifacts rows for an already validated artifact list."""

    for artifact in artifacts:
        connection.execute(
            """
            INSERT INTO export_artifacts(
                id, export_job_id, format, relative_path, sha256,
                size_bytes, checks_json, created_at, replaced_existing
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                artifact["id"],
                job_id,
                artifact["format"],
                artifact["relative_path"],
                artifact["sha256"],
                artifact["size_bytes"],
                artifact["checks_json"],
                created_at,
                int(artifact["replaced_existing"]),
            ),
        )


def complete_job_row(
    connection: sqlite3.Connection,
    job_id: str,
    *,
    now: str,
    receipt_json: str,
) -> None:
    connection.execute(
        """
        UPDATE export_jobs
        SET status = 'completed', progress = 100, error_code = NULL,
            receipt_json = ?, completed_at = ?, updated_at = ?
        WHERE id = ?
        """,
        (receipt_json, now, now, job_id),
    )


def fail_job_row(
    connection: sqlite3.Connection,
    job_id: str,
    *,
    now: str,
    error_code: str,
    receipt_json: str | None = None,
    cancelled: bool = False,
) -> None:
    connection.execute(
        """
        UPDATE export_jobs
        SET status = ?, progress = 100, error_code = ?, receipt_json = ?,
            completed_at = ?, updated_at = ?, cancel_requested_at = CASE
                WHEN ? THEN COALESCE(cancel_requested_at, ?)
                ELSE cancel_requested_at END
        WHERE id = ?
        """,
        (
            "cancelled" if cancelled else "failed",
            error_code,
            receipt_json,
            now,
            now,
            int(cancelled),
            now,
            job_id,
        ),
    )


class ExportService:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create_job(
        self,
        *,
        document_id: str,
        request_id: str,
        formats: Sequence[str],
        output_directory: str,
        input_sha256: str,
        template_id: str,
        template_version: str,
        template_sha256: str,
        snapshot: Mapping[str, Any],
        overwrite_confirmed: bool = False,
    ) -> dict[str, Any]:
        document_id = _text(document_id, "document_id", maximum=128)
        request_id = _text(request_id, "request_id", maximum=128)
        output_directory = _text(
            output_directory, "output_directory", maximum=4096
        )
        if not Path(output_directory).is_absolute():
            raise ValidationError("output_directory", "must_be_absolute")
        if (
            not isinstance(formats, Sequence)
            or isinstance(formats, (str, bytes))
            or not formats
        ):
            raise ValidationError("formats", "required")
        normalized_formats = [
            _text(item, "formats", maximum=20) for item in formats
        ]
        if len(normalized_formats) != len(set(normalized_formats)):
            raise ValidationError("formats", "must_be_unique")
        if not isinstance(snapshot, Mapping):
            raise ValidationError("snapshot", "must_be_object")
        if not isinstance(overwrite_confirmed, bool):
            raise ValidationError("overwrite_confirmed", "must_be_boolean")

        now = utc_now()
        job_id = new_id()
        formats_json = encode_json(normalized_formats, "formats")
        snapshot_json = encode_json(dict(snapshot), "snapshot")
        input_sha256 = _hash(input_sha256, "input_sha256")
        template_id = _text(template_id, "template_id", maximum=128)
        template_version = _text(template_version, "template_version", maximum=128)
        template_sha256 = _hash(template_sha256, "template_sha256")
        try:
            with self.database.transaction(immediate=True) as connection:
                document = connection.execute(
                    "SELECT 1 FROM documents WHERE id = ?", (document_id,)
                ).fetchone()
                if document is None:
                    raise NotFoundError("document", document_id)
                insert_job_row(
                    connection,
                    job_id=job_id,
                    document_id=document_id,
                    formats_json=formats_json,
                    status="queued",
                    progress=0,
                    output_directory=output_directory,
                    now=now,
                    request_id=request_id,
                    input_sha256=input_sha256,
                    template_id=template_id,
                    template_version=template_version,
                    template_sha256=template_sha256,
                    snapshot_json=snapshot_json,
                    overwrite_confirmed=overwrite_confirmed,
                )
        except sqlite3.IntegrityError as exc:
            existing_request = self.database.connection.execute(
                "SELECT 1 FROM export_jobs WHERE request_id = ?", (request_id,)
            ).fetchone()
            if existing_request is not None:
                raise ValidationError("request_id", "must_be_unique") from exc
            active = self.database.connection.execute(
                """
                SELECT 1 FROM export_jobs
                WHERE document_id = ? AND status IN ('queued', 'running')
                """,
                (document_id,),
            ).fetchone()
            if active is not None:
                raise ValidationError("document_id", "active_export_exists") from exc
            raise ValidationError("export_job", "constraint_failed") from exc
        return self.get_job(job_id)

    def get_job(self, job_id: str) -> dict[str, Any]:
        row = self.database.connection.execute(
            "SELECT * FROM export_jobs WHERE id = ?", (job_id,)
        ).fetchone()
        if row is None:
            raise NotFoundError("export_job", job_id)
        result = self._job_row(row)
        artifacts = self.database.connection.execute(
            """
            SELECT id, format, relative_path, sha256, size_bytes,
                   checks_json, created_at, replaced_existing
            FROM export_artifacts
            WHERE export_job_id = ? ORDER BY created_at, id
            """,
            (job_id,),
        ).fetchall()
        result["artifacts"] = [self._artifact_row(item) for item in artifacts]
        return result

    def list_jobs(
        self, *, document_id: str | None = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        if document_id is not None:
            document_id = _text(document_id, "document_id", maximum=128)
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 500:
            raise ValidationError("limit", "must_be_between_1_and_500")
        where = "WHERE document_id = ?" if document_id is not None else ""
        parameters: tuple[Any, ...] = (
            (document_id, limit) if document_id is not None else (limit,)
        )
        rows = self.database.connection.execute(
            f"""
            SELECT * FROM export_jobs {where}
            ORDER BY created_at DESC, rowid DESC LIMIT ?
            """,
            parameters,
        ).fetchall()
        return [self._job_row(row) for row in rows]

    def start_job(self, job_id: str) -> dict[str, Any]:
        now = utc_now()
        with self.database.transaction(immediate=True) as connection:
            row = connection.execute(
                "SELECT status FROM export_jobs WHERE id = ?", (job_id,)
            ).fetchone()
            if row is None:
                raise NotFoundError("export_job", job_id)
            if row["status"] == "queued":
                connection.execute(
                    """
                    UPDATE export_jobs SET status = 'running', progress = 1,
                        updated_at = ? WHERE id = ?
                    """,
                    (now, job_id),
                )
            elif row["status"] != "running":
                raise ValidationError("status", "not_active")
        return self.get_job(job_id)

    def complete_job(
        self,
        job_id: str,
        *,
        receipt: Mapping[str, Any],
        artifacts: Sequence[Mapping[str, Any]],
    ) -> dict[str, Any]:
        if not isinstance(receipt, Mapping):
            raise ValidationError("receipt", "must_be_object")
        if (
            not isinstance(artifacts, Sequence)
            or isinstance(artifacts, (str, bytes))
            or not artifacts
        ):
            raise ValidationError("artifacts", "required")
        normalized_artifacts = [self._validate_artifact(item) for item in artifacts]
        now = utc_now()
        with self.database.transaction(immediate=True) as connection:
            self._require_active(connection, job_id)
            insert_artifact_rows(
                connection,
                job_id,
                [
                    {
                        "id": new_id(),
                        "format": artifact["format"],
                        "relative_path": artifact["relative_path"],
                        "sha256": artifact["sha256"],
                        "size_bytes": artifact["size_bytes"],
                        "checks_json": encode_json(artifact["checks"], "checks"),
                        "replaced_existing": artifact["replaced_existing"],
                    }
                    for artifact in normalized_artifacts
                ],
                now,
            )
            complete_job_row(
                connection,
                job_id,
                now=now,
                receipt_json=encode_json(dict(receipt), "receipt"),
            )
        return self.get_job(job_id)

    def fail_job(
        self,
        job_id: str,
        *,
        error_code: str,
        receipt: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        error_code = _text(error_code, "error_code", maximum=100)
        if receipt is not None and not isinstance(receipt, Mapping):
            raise ValidationError("receipt", "must_be_object")
        now = utc_now()
        with self.database.transaction(immediate=True) as connection:
            self._require_active(connection, job_id)
            fail_job_row(
                connection,
                job_id,
                now=now,
                error_code=error_code,
                receipt_json=(
                    encode_json(dict(receipt), "receipt")
                    if receipt is not None
                    else None
                ),
            )
        return self.get_job(job_id)

    def recover_interrupted(self) -> int:
        now = utc_now()
        with self.database.transaction(immediate=True) as connection:
            cursor = connection.execute(
                """
                UPDATE export_jobs
                SET status = 'failed', progress = 100,
                    error_code = 'EXPORT_INTERRUPTED',
                    completed_at = COALESCE(completed_at, ?), updated_at = ?
                WHERE status IN ('queued', 'running')
                """,
                (now, now),
            )
        return cursor.rowcount

    def upsert_template_installation(
        self,
        *,
        template_id: str,
        version: str,
        manifest_sha256: str,
        install_path: str | None,
        metadata: Mapping[str, Any] | None,
        enabled: bool = True,
    ) -> dict[str, Any]:
        if install_path is not None:
            install_path = _text(install_path, "install_path", maximum=4096)
            if not Path(install_path).is_absolute():
                raise ValidationError("install_path", "must_be_absolute")
        if metadata is not None and not isinstance(metadata, Mapping):
            raise ValidationError("metadata", "must_be_object")
        if not isinstance(enabled, bool):
            raise ValidationError("enabled", "must_be_boolean")
        now = utc_now()
        values = (
            _text(template_id, "template_id", maximum=128),
            _text(version, "version", maximum=128),
            _hash(manifest_sha256, "manifest_sha256"),
            now,
            int(enabled),
            install_path,
            encode_json(dict(metadata), "metadata") if metadata is not None else None,
        )
        with self.database.transaction(immediate=True) as connection:
            connection.execute(
                """
                INSERT INTO template_installations(
                    template_id, version, manifest_sha256, installed_at,
                    enabled, install_path, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(template_id, version) DO UPDATE SET
                    manifest_sha256 = excluded.manifest_sha256,
                    installed_at = excluded.installed_at,
                    enabled = excluded.enabled,
                    install_path = excluded.install_path,
                    metadata_json = excluded.metadata_json
                """,
                values,
            )
        return self.get_template_installation(values[0], values[1])

    def get_template_installation(
        self, template_id: str, version: str
    ) -> dict[str, Any]:
        row = self.database.connection.execute(
            """
            SELECT template_id, version, manifest_sha256, installed_at,
                   enabled, install_path, metadata_json
            FROM template_installations WHERE template_id = ? AND version = ?
            """,
            (template_id, version),
        ).fetchone()
        if row is None:
            raise NotFoundError("template_installation", f"{template_id}:{version}")
        return self._template_row(row)

    def list_template_installations(
        self, *, enabled_only: bool = False
    ) -> list[dict[str, Any]]:
        if not isinstance(enabled_only, bool):
            raise ValidationError("enabled_only", "must_be_boolean")
        where = "WHERE enabled = 1" if enabled_only else ""
        rows = self.database.connection.execute(
            f"""
            SELECT template_id, version, manifest_sha256, installed_at,
                   enabled, install_path, metadata_json
            FROM template_installations {where}
            ORDER BY template_id, version
            """
        ).fetchall()
        return [self._template_row(row) for row in rows]

    def _require_active(
        self, connection: sqlite3.Connection, job_id: str
    ) -> sqlite3.Row:
        row = connection.execute(
            "SELECT status FROM export_jobs WHERE id = ?", (job_id,)
        ).fetchone()
        if row is None:
            raise NotFoundError("export_job", job_id)
        if row["status"] not in ACTIVE_STATUSES:
            raise ValidationError("status", "not_active")
        return row

    def _validate_artifact(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise ValidationError("artifacts", "must_be_object")
        relative_path = _text(payload.get("relative_path"), "relative_path", maximum=1024)
        path = Path(relative_path)
        if path.is_absolute() or ".." in path.parts:
            raise ValidationError("relative_path", "must_be_relative")
        size_bytes = payload.get("size_bytes")
        if not isinstance(size_bytes, int) or isinstance(size_bytes, bool) or size_bytes < 0:
            raise ValidationError("size_bytes", "must_be_non_negative")
        checks = payload.get("checks")
        if not isinstance(checks, list):
            raise ValidationError("checks", "must_be_array")
        replaced = payload.get("replaced_existing", False)
        if not isinstance(replaced, bool):
            raise ValidationError("replaced_existing", "must_be_boolean")
        return {
            "format": _text(payload.get("format"), "format", maximum=20),
            "relative_path": relative_path,
            "sha256": _hash(payload.get("sha256"), "sha256"),
            "size_bytes": size_bytes,
            "checks": checks,
            "replaced_existing": replaced,
        }

    @staticmethod
    def _job_row(row: sqlite3.Row) -> dict[str, Any]:
        item = dict(row)
        item["requested_formats"] = decode_json(item.pop("requested_formats_json"))
        item["snapshot"] = _optional_json(item.pop("snapshot_json"))
        item["receipt"] = _optional_json(item.pop("receipt_json"))
        item["overwrite_confirmed"] = bool(item["overwrite_confirmed"])
        return item

    @staticmethod
    def _artifact_row(row: sqlite3.Row) -> dict[str, Any]:
        item = dict(row)
        item["checks"] = decode_json(item.pop("checks_json"))
        item["replaced_existing"] = bool(item["replaced_existing"])
        return item

    @staticmethod
    def _template_row(row: sqlite3.Row) -> dict[str, Any]:
        item = dict(row)
        item["metadata"] = _optional_json(item.pop("metadata_json"))
        item["enabled"] = bool(item["enabled"])
        return item
