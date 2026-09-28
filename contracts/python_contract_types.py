"""TypedDict mirrors of export-control JSON contracts.

These types improve Python editor and static-checker feedback; trust-boundary code must
still validate runtime JSON against the corresponding schemas and path/hash rules.
"""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict


ExportFormat = Literal["docx", "pdf", "tex"]
DocumentType = Literal["proposal", "midterm", "task_book"]
ExportJobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
ManualQaStatus = Literal["pass", "fail"]


class StudentProfileInput(TypedDict):
    id: NotRequired[str]
    full_name: str
    student_number: str
    college: str
    major: str
    class_name: NotRequired[str | None]
    advisor_name: NotRequired[str | None]
    advisor_title: NotRequired[str | None]
    graduation_cohort: NotRequired[str | None]
    thesis_title: NotRequired[list[str | dict[str, object]] | None]
    thesis_title_en: NotRequired[str | None]


class StudentProfile(TypedDict):
    id: str
    full_name: str
    student_number: str
    college: str
    major: str
    class_name: str | None
    advisor_name: str | None
    advisor_title: str | None
    graduation_cohort: str | None
    thesis_title: list[str | dict[str, object]] | None
    thesis_title_en: str | None
    created_at: str
    updated_at: str


class ProfileDraft(TypedDict):
    full_name: str
    student_number: str
    college: str
    major: str
    class_name: str
    advisor_name: str
    advisor_title: str
    graduation_cohort: str
    thesis_title: list[str | dict[str, object]] | None
    thesis_title_en: str | None


class RichRun(TypedDict):
    text: str
    script: NotRequired[Literal["normal", "sub", "super"]]
    italic: NotRequired[bool]
    bold: NotRequired[bool]


class RichParagraph(TypedDict):
    type: NotRequired[Literal["paragraph"]]
    runs: list[RichRun]


ParagraphInput = str | RichParagraph


class OrderedListItem(TypedDict):
    marker: NotRequired[str]
    content: ParagraphInput
    children: NotRequired[ListBlock]


class OrderedListBlock(TypedDict):
    type: Literal["ordered_list"]
    items: list[OrderedListItem]


class UnorderedListItem(TypedDict):
    content: ParagraphInput
    children: NotRequired[ListBlock]


class UnorderedListBlock(TypedDict):
    type: Literal["unordered_list"]
    items: list[UnorderedListItem]


ListBlock = OrderedListBlock | UnorderedListBlock


class ImageBlock(TypedDict):
    type: Literal["image"]
    path: str
    alt: str
    width_mm: NotRequired[float]
    caption: NotRequired[ParagraphInput]


TextContentBlock = ParagraphInput | ListBlock
ContentBlock = TextContentBlock | ImageBlock
TaskBookContentBlock = ContentBlock


class TaskBookScheduleEntry(TypedDict):
    period: str
    content: ParagraphInput


class TaskBookResearchProject(TypedDict):
    level: Literal["national", "provincial_ministerial", "other"]
    project_number: str
    other_level: NotRequired[str]


class TaskBookResearchSource(TypedDict):
    type: Literal["research_project"]
    research_project: TaskBookResearchProject


class TaskBookPracticeSource(TypedDict):
    type: Literal["practice_project"]


class TaskBookSelfProposedSource(TypedDict):
    type: Literal["self_proposed"]
    self_proposed_by: Literal["teacher", "student", "teacher_student_joint"]


class TaskBookTopicInformation(TypedDict):
    nature: Literal["graduation_design", "graduation_thesis"]
    source: TaskBookResearchSource | TaskBookPracticeSource | TaskBookSelfProposedSource


class TaskBookMetadata(TypedDict):
    graduation_year: int
    title: ParagraphInput
    student_name: str
    student_id: str
    college: str
    major: str
    class_name: str
    advisor: str


class TaskBookSections(TypedDict):
    basic_content_and_requirements: list[TaskBookContentBlock]
    schedule: list[TaskBookScheduleEntry]
    required_materials: list[TaskBookContentBlock]
    references: list[ParagraphInput]
    topic_information: TaskBookTopicInformation


class TaskBookDocument(TypedDict):
    schema_version: Literal["0.1"]
    metadata: TaskBookMetadata
    sections: TaskBookSections


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


class PreviewGenerateParams(TypedDict):
    request_id: str
    document_id: str


class PreviewPage(TypedDict):
    page_number: int
    sha256: str
    size_bytes: int
    data_url: str


class PreviewResult(TypedDict):
    schema_version: Literal["1.0"]
    preview_id: str
    document_id: str
    document_revision: int
    input_sha256: str
    template: TemplateDescriptor
    pages: list[PreviewPage]
    checks: list[CheckResult]
    generated_at: str


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
    document_type: DocumentType


class TemplateInstallResult(TypedDict):
    status: Literal["linked", "updated", "already_current"]
    template_id: str
    version: str
    pack_sha256: str
    installed_at: str
    source: Literal["linked-workspace"]


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
