"""Install and remove the bundled fictional reference documents."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any

from .bibtex_gate import count_valid_bibtex_entries
from .exporter import build_export_document, validate_document
from .storage import Workspace

SAMPLE_DIRECTORY = Path(__file__).with_name("sample_data")
SAMPLE_SETTING = "workbench.reference_sample.v1"
SAMPLE_PREFIX = "参考样例·"

# The order matches the workbench navigation so demos open in a familiar sequence.
SAMPLE_DOCUMENTS: dict[str, str] = {
    "task_book": "任务书",
    "proposal": "开题报告",
    "midterm": "中期检查",
    "advisor_review": "指导教师评审表",
    "reviewer_review": "评阅人评审表",
    "defense_record": "答辩记录表",
    "grade_assessment": "成绩考核表",
}
BIBLIOGRAPHY_DOCUMENT_TYPES = {"task_book", "proposal"}
BUNDLED_IMAGES = {"workflow.png", "strength.png", "cycles.png"}
_IDENTITY_FIELDS = {
    "student_name": "full_name",
    "student_id": "student_number",
    "college": "college",
    "major": "major",
    "class_name": "class_name",
    "advisor": "advisor_name",
    "advisor_title": "advisor_title",
    "graduation_year": "graduation_cohort",
}


def _install_images(value: Any, directory: Path) -> None:
    if isinstance(value, list):
        for child in value:
            _install_images(child, directory)
    elif isinstance(value, dict):
        image_path = value.get("path")
        if isinstance(image_path, str):
            # These are bundled assets, never a host path supplied by a caller.
            source = SAMPLE_DIRECTORY / Path(image_path).name
            if source.name not in BUNDLED_IMAGES:
                raise ValueError("Unknown bundled reference image")
            image = source.read_bytes()
            target = directory / f"{hashlib.sha256(image).hexdigest()}.png"
            if target.is_symlink():
                raise ValueError("Reference image destination must not be a symlink")
            try:
                with target.open("xb") as stream:
                    stream.write(image)
            except FileExistsError:
                if target.read_bytes() != image:
                    raise ValueError("Reference image destination does not match its hash")
            value["path"] = str(target)
        for child in value.values():
            _install_images(child, directory)


def _load_sample() -> dict[str, Any]:
    return json.loads((SAMPLE_DIRECTORY / "reference.json").read_text(encoding="utf-8"))


def bundled_document_types() -> tuple[str, ...]:
    """Return the document types the bundled sample data can currently install."""

    documents = _load_sample()["documents"]
    return tuple(document_type for document_type in SAMPLE_DOCUMENTS if document_type in documents)


def _apply_identity(content: dict[str, Any], profile: dict[str, Any]) -> None:
    metadata = content.get("metadata")
    if not isinstance(metadata, dict):
        return
    for field, profile_field in _IDENTITY_FIELDS.items():
        if field not in metadata:
            continue
        value = profile.get(profile_field)
        if isinstance(value, str) and value.strip():
            metadata[field] = value


def _sample_content(
    sample: dict[str, Any],
    document_type: str,
    profile: dict[str, Any],
    assets: Path,
) -> dict[str, Any]:
    content = copy.deepcopy(sample["documents"][document_type])
    _install_images(content, assets)
    _apply_identity(content, profile)
    if document_type in BIBLIOGRAPHY_DOCUMENT_TYPES:
        content["editor_state"] = {
            "bibliography": {
                "source_format": "bibtex",
                "source_text": sample["bibtex"],
                "parse_status": "valid",
                "entry_count": count_valid_bibtex_entries(sample["bibtex"]),
            }
        }
    return content


def _sample_titles(connection: Any) -> set[str]:
    rows = connection.execute(
        "SELECT title FROM documents WHERE soft_deleted_at IS NULL AND title LIKE ?",
        (f"{SAMPLE_PREFIX}%",),
    ).fetchall()
    return {str(row["title"]) for row in rows}


def _is_pristine(workspace: Workspace) -> bool:
    with workspace.database.transaction() as connection:
        used = connection.execute(
            """
            SELECT 1 FROM student_profiles
            UNION ALL SELECT 1 FROM documents
            UNION ALL SELECT 1 FROM settings
              WHERE key IN (?, 'workbench.profile_draft', 'workbench.active')
            LIMIT 1
            """,
            (SAMPLE_SETTING,),
        ).fetchone()
    return used is None


def _validate_staged(
    sample: dict[str, Any],
    contents: dict[str, dict[str, Any]],
    identity: dict[str, Any],
) -> None:
    """Render and validate every sample before touching the user workspace."""

    staged = Workspace.create_temporary()
    try:
        profile = staged.save_profile({**sample["profile"], **identity})
        for document_type, content in contents.items():
            document = staged.create_document({
                "profile_id": profile["id"],
                "document_type": document_type,
                "title": f"{SAMPLE_PREFIX}{SAMPLE_DOCUMENTS[document_type]}",
                "template_version": "0.1.0-dev.1",
                "schema_version": content["schema_version"],
            })
            staged.save_draft(document["id"], content, 0, reason="import")
            validate_document(
                document_type,
                build_export_document(staged, staged.get_document(document["id"])),
            )
    finally:
        staged.close()


def install_reference_sample(workspace: Workspace) -> dict[str, Any]:
    """Add any missing reference documents, leaving real drafts untouched."""

    if workspace.is_temporary:
        return {"installed": [], "skipped": [], "profile_id": None}
    database = workspace.database
    if database.data_directory is None:
        return {"installed": [], "skipped": [], "profile_id": None}

    sample = _load_sample()
    available = sample.get("documents", {})
    existing = _sample_titles(database.connection)
    bundled = [document_type for document_type in SAMPLE_DOCUMENTS if document_type in available]
    skipped = [
        document_type
        for document_type in bundled
        if f"{SAMPLE_PREFIX}{SAMPLE_DOCUMENTS[document_type]}" in existing
    ]
    wanted = [
        document_type
        for document_type in bundled
        if f"{SAMPLE_PREFIX}{SAMPLE_DOCUMENTS[document_type]}" not in existing
    ]
    if not wanted:
        return {"installed": [], "skipped": skipped, "profile_id": None}

    active = workspace.load_active()["profile"]
    identity = {
        field: active.get(field)
        for field in ("full_name", "student_number", "college", "major", "class_name",
                      "advisor_name", "advisor_title", "graduation_cohort")
        if isinstance(active.get(field), str) and active.get(field).strip()
    } if active else {}

    assets = database.data_directory / "document-assets"
    assets.mkdir(mode=0o700, parents=True, exist_ok=True)
    contents = {
        document_type: _sample_content(sample, document_type, {**sample["profile"], **identity}, assets)
        for document_type in wanted
    }
    _validate_staged(sample, contents, identity)

    created_profile_id: str | None = None
    created_documents: list[str] = []
    installed: list[str] = []
    try:
        if active is None:
            profile = workspace.save_profile(sample["profile"])
            created_profile_id = str(profile["id"])
        else:
            profile = active
        first_document_id: str | None = None
        for document_type, content in contents.items():
            document = workspace.create_document({
                "profile_id": profile["id"],
                "document_type": document_type,
                "title": f"{SAMPLE_PREFIX}{SAMPLE_DOCUMENTS[document_type]}",
                "template_version": "0.1.0-dev.1",
                "schema_version": content["schema_version"],
            })
            created_documents.append(str(document["id"]))
            workspace.save_draft(document["id"], content, 0, reason="import")
            installed.append(document_type)
            if first_document_id is None:
                first_document_id = document["id"]
        workspace.set_setting(SAMPLE_SETTING, {"version": 1})
        if active is None and first_document_id is not None:
            workspace.save_active(profile_id=profile["id"], document_id=first_document_id)
    except Exception:
        _discard_partial(workspace, created_documents, created_profile_id)
        raise
    return {"installed": installed, "skipped": skipped, "profile_id": profile["id"]}


def _discard_partial(
    workspace: Workspace,
    document_ids: list[str],
    profile_id: str | None,
) -> None:
    """Best-effort cleanup so a failed install never leaves half the sample behind."""

    for document_id in reversed(document_ids):
        try:
            workspace.delete_document(document_id)
            workspace.purge_document(document_id)
        except Exception:
            continue
    if profile_id is None:
        return
    try:
        with workspace.database.transaction(immediate=True) as connection:
            connection.execute("DELETE FROM student_profiles WHERE id = ?", (profile_id,))
    except Exception:
        return


def remove_reference_sample(workspace: Workspace) -> dict[str, Any]:
    """Permanently remove documents created by the sample installer."""

    rows = workspace.database.connection.execute(
        "SELECT id, title, soft_deleted_at FROM documents WHERE title LIKE ?",
        (f"{SAMPLE_PREFIX}%",),
    ).fetchall()
    removed: list[str] = []
    for row in rows:
        document_id = str(row["id"])
        if row["soft_deleted_at"] is None:
            workspace.delete_document(document_id)
        workspace.purge_document(document_id)
        removed.append(str(row["title"]))
    return {"removed": len(removed), "titles": removed}


def initialize_reference_sample(workspace: Workspace) -> bool:
    """Seed a completely unused persistent workspace once at startup."""

    if workspace.is_temporary or not _is_pristine(workspace):
        return False
    result = install_reference_sample(workspace)
    return bool(result["installed"])
