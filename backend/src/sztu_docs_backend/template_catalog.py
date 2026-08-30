"""Runtime access to the repository's non-executable template-pack validator."""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path
from types import ModuleType
from typing import Any


def template_pack_root() -> Path:
    """Resolve the app-controlled template-pack root without scanning user files."""

    configured = os.environ.get("SZTU_DOCS_TEMPLATE_PACKS_DIR")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[3] / "template-packs"


def _load_validator(root: Path) -> ModuleType:
    validator_path = root / "validate_pack.py"
    spec = importlib.util.spec_from_file_location(
        "sztu_docs_template_pack_validator", validator_path
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Template pack validator is unavailable.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def discover_trusted_template_packs(root: Path | None = None) -> list[dict[str, Any]]:
    """Validate and return trusted descriptors from the controlled pack root."""

    pack_root = root if root is not None else template_pack_root()
    validator = _load_validator(pack_root)
    discovered = validator.discover_packs(pack_root)
    return [
        {
            "trusted": item["trusted"],
            "template_id": item["template_id"],
            "version": item["version"],
            "document_type": item["document_type"],
            "contract_versions": item["contract_versions"],
            "manifest_sha256": item["manifest_sha256"],
            "files_verified": item["files_verified"],
        }
        for item in discovered
    ]
