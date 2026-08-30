"""Stable storage-domain errors safe to map onto the JSONL protocol."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class StorageError(Exception):
    """Base class for expected local-storage failures.

    ``details`` must contain identifiers and machine-readable state only.  It must
    never contain profile fields, draft contents, or filesystem paths.
    """

    message: str
    details: dict[str, Any] = field(default_factory=dict)
    code: str = "STORAGE_ERROR"

    def __str__(self) -> str:
        return self.message


class NotFoundError(StorageError):
    code = "NOT_FOUND"

    def __init__(self, resource: str, resource_id: str) -> None:
        super().__init__(
            "Requested local record was not found.",
            {"resource": resource, "resource_id": resource_id},
        )
        self.code = "NOT_FOUND"


class RevisionConflictError(StorageError):
    code = "REVISION_CONFLICT"

    def __init__(self, document_id: str, expected: int, actual: int) -> None:
        super().__init__(
            "Draft changed after the supplied revision.",
            {
                "resource": "document",
                "resource_id": document_id,
                "expected_revision": expected,
                "actual_revision": actual,
            },
        )
        self.code = "REVISION_CONFLICT"


class ValidationError(StorageError):
    code = "VALIDATION"

    def __init__(self, field_name: str, reason: str) -> None:
        super().__init__(
            "Stored data did not pass validation.",
            {"field": field_name, "reason": reason},
        )
        self.code = "VALIDATION"


class MigrationError(StorageError):
    code = "MIGRATION_FAILED"

    def __init__(self, version: int) -> None:
        super().__init__(
            "The local database migration failed and was rolled back.",
            {"migration_version": version},
        )
        self.code = "MIGRATION_FAILED"
