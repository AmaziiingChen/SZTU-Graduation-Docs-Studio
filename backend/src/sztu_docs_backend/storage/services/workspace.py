"""JSON-serializable facade for protocol and desktop integration."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path, PureWindowsPath
from typing import Any

from ..database import Database, utc_now
from ..errors import NotFoundError, StorageError, ValidationError
from .common import decode_json
from .documents import DocumentService
from .exports import ExportService
from .profiles import ProfileService
from .settings import SettingsService

SNAPSHOT_TABLES = (
    "student_profiles",
    "documents",
    "draft_revisions",
    "export_jobs",
    "export_artifacts",
    "template_installations",
    "settings",
)

JSON_COLUMNS = {
    "draft_revisions": {"content_json": "content"},
    "export_jobs": {
        "requested_formats_json": "requested_formats",
        "snapshot_json": "snapshot",
        "receipt_json": "receipt",
    },
    "export_artifacts": {"checks_json": "checks"},
    "template_installations": {"metadata_json": "metadata"},
    "settings": {"value_json": "value"},
}

HOST_PATH_KEYS = frozenset({"path", "output_directory", "install_path"})


def _without_absolute_host_paths(value: Any) -> Any:
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, child in value.items():
            if (
                key in HOST_PATH_KEYS
                and isinstance(child, str)
                and (Path(child).is_absolute() or PureWindowsPath(child).is_absolute())
            ):
                continue
            result[key] = _without_absolute_host_paths(child)
        return result
    if isinstance(value, list):
        return [_without_absolute_host_paths(item) for item in value]
    return value


class Workspace:
    """High-level storage API; methods return protocol-ready dictionaries."""

    def __init__(self, database: Database, *, revision_limit: int = 20) -> None:
        self.database = database
        self.profiles = ProfileService(database)
        self.documents = DocumentService(database, revision_limit=revision_limit)
        self.settings = SettingsService(database)
        self.exports = ExportService(database)
        if not database.temporary:
            self.exports.recover_interrupted()

    @classmethod
    def open_persistent(
        cls,
        data_dir: str | Path | None = None,
        *,
        revision_limit: int = 20,
    ) -> Workspace:
        return cls(
            Database.open_persistent(data_dir), revision_limit=revision_limit
        )

    @classmethod
    def create_temporary(cls, *, revision_limit: int = 20) -> Workspace:
        return cls(Database.open_temporary(), revision_limit=revision_limit)

    @property
    def is_temporary(self) -> bool:
        return self.database.temporary

    def save_profile(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        return self.profiles.save(payload)

    def get_profile(self, profile_id: str) -> dict[str, Any]:
        return self.profiles.get(profile_id)

    def list_profiles(self, *, limit: int = 100) -> list[dict[str, Any]]:
        return self.profiles.list(limit=limit)

    def create_document(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        return self.documents.create(payload)

    def get_document(self, document_id: str) -> dict[str, Any]:
        return self.documents.get(document_id)

    def list_documents(
        self, *, profile_id: str | None = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        return self.documents.list(profile_id=profile_id, limit=limit)

    def assign_profile(self, document_id: str, profile_id: str) -> dict[str, Any]:
        return self.documents.assign_profile(document_id, profile_id)

    def save_draft(
        self,
        document_id: str,
        content: Mapping[str, Any],
        expected_revision: int,
        *,
        reason: str = "auto",
    ) -> dict[str, Any]:
        return self.documents.save_draft(
            document_id, content, expected_revision, reason=reason
        )

    def restore_previous(
        self, document_id: str, expected_revision: int
    ) -> dict[str, Any]:
        return self.documents.restore_previous(document_id, expected_revision)

    def close_temporary_document(self, document_id: str) -> dict[str, Any]:
        return self.documents.close_temporary(document_id)

    def set_setting(self, key: str, value: Any) -> dict[str, Any]:
        return self.settings.set(key, value)

    def get_setting(self, key: str) -> dict[str, Any]:
        return self.settings.get(key)

    def create_export_job(
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
        return self.exports.create_job(
            document_id=document_id,
            request_id=request_id,
            formats=formats,
            output_directory=output_directory,
            input_sha256=input_sha256,
            template_id=template_id,
            template_version=template_version,
            template_sha256=template_sha256,
            snapshot=snapshot,
            overwrite_confirmed=overwrite_confirmed,
        )

    def get_export_job(self, job_id: str) -> dict[str, Any]:
        return self.exports.get_job(job_id)

    def list_export_jobs(
        self, *, document_id: str | None = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        return self.exports.list_jobs(document_id=document_id, limit=limit)

    def start_export_job(self, job_id: str) -> dict[str, Any]:
        return self.exports.start_job(job_id)

    def complete_export_job(
        self,
        job_id: str,
        *,
        receipt: Mapping[str, Any],
        artifacts: list[Mapping[str, Any]],
    ) -> dict[str, Any]:
        return self.exports.complete_job(
            job_id, receipt=receipt, artifacts=artifacts
        )

    def fail_export_job(
        self,
        job_id: str,
        *,
        error_code: str,
        receipt: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self.exports.fail_job(
            job_id, error_code=error_code, receipt=receipt
        )

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
        return self.exports.upsert_template_installation(
            template_id=template_id,
            version=version,
            manifest_sha256=manifest_sha256,
            install_path=install_path,
            metadata=metadata,
            enabled=enabled,
        )

    def list_template_installations(
        self, *, enabled_only: bool = False
    ) -> list[dict[str, Any]]:
        return self.exports.list_template_installations(enabled_only=enabled_only)

    def save_active(
        self,
        *,
        profile_id: str | None,
        document_id: str | None,
    ) -> dict[str, Any]:
        if profile_id is not None:
            self.get_profile(profile_id)
        if document_id is not None:
            document = self.get_document(document_id)
            if profile_id is not None and document["profile_id"] != profile_id:
                raise ValidationError("document_id", "does_not_belong_to_profile")
        active = {"profile_id": profile_id, "document_id": document_id}
        self.settings.set("workbench.active", active)
        return active

    def load_active(self) -> dict[str, Any]:
        try:
            value = self.settings.get("workbench.active")["value"]
        except NotFoundError:
            return {"profile": None, "document": None}
        profile = None
        document = None
        profile_id = value.get("profile_id") if isinstance(value, dict) else None
        document_id = value.get("document_id") if isinstance(value, dict) else None
        if profile_id is not None:
            try:
                profile = self.get_profile(profile_id)
            except NotFoundError:
                pass
        if document_id is not None:
            try:
                document = self.get_document(document_id)
            except NotFoundError:
                pass
        return {"profile": profile, "document": document}

    def export_snapshot(self) -> dict[str, Any]:
        """Return owned records as JSON data, never host paths or logs."""

        snapshot: dict[str, Any] = {
            "format_version": "1.0",
            "exported_at": utc_now(),
            "temporary": self.is_temporary,
        }
        for table in SNAPSHOT_TABLES:
            rows = self.database.connection.execute(
                f"SELECT * FROM {table} ORDER BY rowid"
            ).fetchall()
            exported_rows: list[dict[str, Any]] = []
            for row in rows:
                item = dict(row)
                if table == "export_jobs":
                    item.pop("output_directory", None)
                if table == "template_installations":
                    item.pop("install_path", None)
                for encoded_name, decoded_name in JSON_COLUMNS.get(table, {}).items():
                    if encoded_name in item:
                        encoded = item.pop(encoded_name)
                        item[decoded_name] = (
                            None if encoded is None else decode_json(encoded)
                        )
                if "is_temporary" in item:
                    item["is_temporary"] = bool(item["is_temporary"])
                if "enabled" in item:
                    item["enabled"] = bool(item["enabled"])
                if "overwrite_confirmed" in item:
                    item["overwrite_confirmed"] = bool(item["overwrite_confirmed"])
                if "replaced_existing" in item:
                    item["replaced_existing"] = bool(item["replaced_existing"])
                exported_rows.append(_without_absolute_host_paths(item))
            snapshot[table] = exported_rows
        return snapshot

    def delete_all_data(self) -> dict[str, Any]:
        """Delete the explicitly enumerated owned data tables and app backups."""

        deletion_order = (
            "export_artifacts",
            "export_jobs",
            "draft_revisions",
            "documents",
            "student_profiles",
            "template_installations",
            "settings",
        )
        counts: dict[str, int] = {}
        with self.database.transaction(immediate=True) as connection:
            for table in deletion_order:
                counts[table] = int(
                    connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                )
                connection.execute(f"DELETE FROM {table}")

        deleted_backups = 0
        try:
            for backup in self.database.app_backup_files():
                backup.unlink()
                deleted_backups += 1
        except OSError as exc:
            raise StorageError(
                "Local records were cleared, but an application backup could not be removed.",
                {"records_deleted": sum(counts.values())},
                "STORAGE_ERROR",
            ) from exc
        return {
            "deleted": True,
            "record_counts": counts,
            "backup_files_deleted": deleted_backups,
        }

    def close(self) -> None:
        self.database.close()

    def __enter__(self) -> Workspace:
        return self

    def __exit__(self, _type: object, _value: object, _traceback: object) -> None:
        self.close()
