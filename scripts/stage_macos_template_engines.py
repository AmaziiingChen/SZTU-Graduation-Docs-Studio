#!/usr/bin/env python3
"""Stage the three authorized process-document engines for a macOS release."""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND_SOURCE = ROOT / "backend" / "src"
if str(BACKEND_SOURCE) not in sys.path:
    sys.path.insert(0, str(BACKEND_SOURCE))

from sztu_docs_backend.template_engine import (  # noqa: E402
    _workspace_identity,
    _workspace_pack_sha256,
    _workspace_source,
    sha256_file,
)
from sztu_docs_backend.docx_privacy import (  # noqa: E402
    DocxPrivacyError,
    PUBLIC_RELEASE_REDISTRIBUTION,
    RELEASE_DOCX_METADATA_POLICY,
    scrub_release_docx_metadata,
)


OUTPUT_ROOT = ROOT / "build" / "bundled-template-engines"
FORBIDDEN_SUFFIXES = {".otf", ".ttc", ".ttf"}
DOCUMENT_TYPES = ("proposal", "task_book", "midterm")


def template_source_root() -> Path:
    configured = os.environ.get("SZTU_DOCS_PACKAGING_TEMPLATE_ROOT")
    candidate = Path(configured).expanduser() if configured else ROOT.parent / "Thesis"
    if not candidate.is_absolute() or candidate.is_symlink() or not candidate.is_dir():
        raise SystemExit(
            "A trusted local template checkout is required. Set "
            "SZTU_DOCS_PACKAGING_TEMPLATE_ROOT to its absolute path."
        )
    return candidate.resolve()


def stage_engine(source_root: Path, document_type: str) -> dict[str, object]:
    source = _workspace_source(source_root, document_type)
    _workspace_pack_sha256(source)
    destination = OUTPUT_ROOT / document_type
    destination.mkdir(parents=True, exist_ok=True)
    files: list[dict[str, object]] = []
    scrubbed_templates: list[str] = []
    for relative_name, source_file in source.files:
        if source_file.suffix.casefold() in FORBIDDEN_SUFFIXES:
            raise SystemExit(f"Document font cannot enter the app bundle: {relative_name}")
        target = destination / relative_name
        target.parent.mkdir(parents=True, exist_ok=True)
        if (
            relative_name.endswith("/word/official-template.docx")
            or relative_name == "word/official-template.docx"
        ):
            try:
                scrub_release_docx_metadata(source_file, target)
            except DocxPrivacyError as exc:
                raise SystemExit(
                    f"Cannot scrub the staged {document_type} official template: {exc}"
                ) from exc
            scrubbed_templates.append(relative_name)
        else:
            shutil.copyfile(source_file, target)
        file_entry: dict[str, object] = {
            "path": relative_name,
            "sha256": sha256_file(target),
            "size_bytes": target.stat().st_size,
        }
        if relative_name in scrubbed_templates:
            file_entry["metadata_policy"] = RELEASE_DOCX_METADATA_POLICY
        files.append(file_entry)
    validator_relative = "scripts/validate_cjk_render.py"
    validator_target = destination / validator_relative
    validator_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source.validator, validator_target)
    files.append(
        {
            "path": validator_relative,
            "sha256": sha256_file(validator_target),
            "size_bytes": validator_target.stat().st_size,
        }
    )
    staged = _workspace_source(destination, document_type)
    pack_sha256 = _workspace_pack_sha256(staged)
    template_id, version = _workspace_identity(document_type, pack_sha256)
    if len(scrubbed_templates) != 1:
        raise SystemExit(
            f"Staged {document_type} engine must contain one scrubbed official template."
        )
    return {
        "template_id": template_id,
        "version": version,
        "pack_sha256": pack_sha256,
        "metadata_scrubbed_files": sorted(scrubbed_templates),
        "files": sorted(files, key=lambda item: str(item["path"])),
    }


def main() -> int:
    source_root = template_source_root()
    if OUTPUT_ROOT.exists():
        shutil.rmtree(OUTPUT_ROOT)
    OUTPUT_ROOT.mkdir(parents=True)
    engines = {
        document_type: stage_engine(source_root, document_type)
        for document_type in DOCUMENT_TYPES
    }
    manifest = {
        "schema_version": "1.0",
        "redistribution": PUBLIC_RELEASE_REDISTRIBUTION,
        "docx_metadata_policy": RELEASE_DOCX_METADATA_POLICY,
        "engines": engines,
        "excluded": [
            "commercial-and-system-fonts",
            "fixtures-and-student-data",
            "private-references",
            "tex-live-and-poppler-binaries",
        ],
    }
    (OUTPUT_ROOT / "bundle-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"Public-release template engines are ready: {OUTPUT_ROOT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
