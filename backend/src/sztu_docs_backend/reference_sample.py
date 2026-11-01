"""Install the bundled fictional reference once into an unused desktop workspace."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .exporter import build_export_document, validate_document
from .storage import Workspace

SAMPLE_DIRECTORY = Path(__file__).with_name("sample_data")
SAMPLE_SETTING = "workbench.reference_sample.v1"
SAMPLE_DOCUMENTS = {"task_book": "任务书", "proposal": "开题报告", "midterm": "中期检查"}


def _install_images(value: Any, directory: Path) -> None:
    if isinstance(value, list):
        for child in value:
            _install_images(child, directory)
    elif isinstance(value, dict):
        image_path = value.get("path")
        if isinstance(image_path, str):
            # These are bundled assets, never a host path supplied by a caller.
            source = SAMPLE_DIRECTORY / Path(image_path).name
            if source.name not in {"workflow.png", "strength.png", "cycles.png"}:
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


def initialize_reference_sample(workspace: Workspace) -> bool:
    """Seed only pristine persistent data, preserving drafts and deleted records.

    Stage through the existing storage services, then copy their validated rows
    in one destination transaction: a failed startup cannot leave half a sample.
    """
    if workspace.is_temporary:
        return False
    database = workspace.database
    assert database.data_directory is not None
    with database.transaction(immediate=True) as destination:
        used = destination.execute(
            """
            SELECT 1 FROM student_profiles
            UNION ALL SELECT 1 FROM documents
            UNION ALL SELECT 1 FROM settings
              WHERE key IN (?, 'workbench.profile_draft', 'workbench.active')
            LIMIT 1
            """,
            (SAMPLE_SETTING,),
        ).fetchone()
        if used is not None:
            return False

        sample = json.loads((SAMPLE_DIRECTORY / "reference.json").read_text(encoding="utf-8"))
        assets = database.data_directory / "document-assets"
        assets.mkdir(mode=0o700, parents=True, exist_ok=True)
        _install_images(sample["documents"], assets)
        staged = Workspace.create_temporary()
        try:
            profile = staged.save_profile(sample["profile"])
            first_document_id = None
            for document_type, label in SAMPLE_DOCUMENTS.items():
                content = sample["documents"][document_type]
                if document_type in {"task_book", "proposal"}:
                    content["editor_state"] = {"bibliography": {
                        "source_format": "bibtex",
                        "source_text": sample["bibtex"],
                        "parse_status": "valid",
                        "entry_count": 3,
                    }}
                document = staged.create_document({
                    "profile_id": profile["id"],
                    "document_type": document_type,
                    "title": f"参考样例·{label}",
                    "template_version": "0.1.0-dev.1",
                    "schema_version": content["schema_version"],
                })
                staged.save_draft(document["id"], content, 0, reason="import")
                validate_document(document_type, build_export_document(staged, staged.get_document(document["id"])))
                if first_document_id is None:
                    first_document_id = document["id"]
            staged.save_active(profile_id=profile["id"], document_id=first_document_id)
            staged.set_setting(SAMPLE_SETTING, {"version": 1})
            staged.database.connection.execute("UPDATE documents SET is_temporary = 0")
            for table in ("student_profiles", "documents", "draft_revisions", "settings"):
                rows = staged.database.connection.execute(f"SELECT * FROM {table}").fetchall()
                columns = ", ".join(rows[0].keys())
                placeholders = ", ".join("?" for _ in rows[0])
                destination.executemany(
                    f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
                    [tuple(row) for row in rows],
                )
        finally:
            staged.close()
    return True
