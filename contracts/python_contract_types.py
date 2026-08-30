"""TypedDict mirrors of export-control JSON contracts.

These types improve Python editor and static-checker feedback; trust-boundary code must
still validate runtime JSON against the corresponding schemas and path/hash rules.
"""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict


ExportFormat = Literal["docx", "pdf", "tex"]
ExportJobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
ManualQaStatus = Literal["pass", "fail"]


class CheckEvidence(TypedDict):
    kind: Literal["file", "hash", "command", "manual_note"]
    value: str


class CheckResult(TypedDict):
    schema_version: Literal["1.0"]
    check_id: str
    gate: Literal[
        "structure",
        "cjk_glyph",
        "full_page_layout",
        "target_editor",
        "content",
        "template_integrity",
        "environment",
    ]
    status: Literal["not_checked", "running", "pass", "warn", "fail", "blocked"]
    blocking: bool
    message: str
    code: NotRequired[str]
    details: NotRequired[dict[str, object]]
    evidence: NotRequired[list[CheckEvidence]]
    checked_at: NotRequired[str | None]


class TemplateDescriptor(TypedDict):
    template_id: str
    version: str
    pack_sha256: str


class ExportPreflightParams(TypedDict):
    document_id: str
    output_directory: str
    formats: list[ExportFormat]


class ExportTarget(TypedDict):
    format: ExportFormat
    filename: str
    path: str
    exists: bool


class ExportPreflightResult(TypedDict):
    schema_version: Literal["1.0"]
    ready: Literal[True]
    document_id: str
    document_revision: int
    formats: list[ExportFormat]
    input_sha256: str
    template: TemplateDescriptor
    targets: list[ExportTarget]
    overwrite_required: bool
    checks: list[CheckResult]
    blocking_codes: list[str]
    preflight_token: str
    expires_at: str


class ExportRunParams(TypedDict):
    request_id: str
    document_id: str
    output_directory: str
    formats: list[ExportFormat]
    preflight_token: str
    overwrite_confirmed: bool
    cancellation_file: str
    app_version: str


class ExportCancelParams(TypedDict):
    request_id: str


class ExportCancelResult(TypedDict):
    request_id: str
    accepted: bool
    status: Literal["cancel_requested", "not_running"]
    cancel_requested_at: str | None


class ExportHistoryParams(TypedDict):
    document_id: str
    limit: NotRequired[int]


class ExportArtifactRecord(TypedDict):
    artifact_id: str
    format: ExportFormat
    display_name: str
    sha256: str
    size_bytes: int
    file_state: Literal["available", "missing", "modified"]
    replaced_existing: bool
    checks: list[CheckResult]


class ExportJobSummary(TypedDict):
    export_id: str
    request_id: str | None
    status: ExportJobStatus
    progress: int
    error_code: str | None
    requested_formats: list[ExportFormat]
    input_sha256: str | None
    template: TemplateDescriptor | None
    snapshot_available: bool
    overwrite_confirmed: bool
    artifacts: list[ExportArtifactRecord]
    created_at: str
    completed_at: str | None


class ExportHistoryResult(TypedDict):
    schema_version: Literal["1.0"]
    history: list[ExportJobSummary]


class ResolveArtifactParams(TypedDict):
    artifact_id: str


class ResolvedArtifact(TypedDict):
    artifact_id: str
    format: ExportFormat
    absolute_path: str
    sha256: str
    verified: Literal[True]


class OpenArtifactResult(TypedDict):
    artifact_id: str
    opened: bool
    application_error: NotRequired[str]


class TemplateInstallParams(TypedDict):
    source_directory: str


class TemplateInstallResult(TypedDict):
    status: Literal["installed", "already_installed"]
    template_id: str
    version: str
    pack_sha256: str
    installed_at: str


class QaRecordParams(TypedDict):
    export_id: NotRequired[str]
    artifact_id: NotRequired[str | None]
    gate: Literal["full_page_layout", "target_editor"]
    editor: NotRequired[Literal["word", "wps"]]
    status: ManualQaStatus
    message: str


class QaRecordResult(TypedDict):
    record_id: str
    export_id: str
    artifact_id: str | None
    check: CheckResult
    recorded_at: str
