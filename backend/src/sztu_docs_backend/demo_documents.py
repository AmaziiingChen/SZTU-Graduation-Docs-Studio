"""Install and remove the bundled demo documents used by the help center."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any

from .exporter import build_export_document, validate_document
from .storage import Workspace

SAMPLE_DIRECTORY = Path(__file__).with_name("sample_data")
DEMO_PREFIX = "参考样例·"
ASSET_DIRECTORY = "document-assets"


def _load_bundle() -> dict[str, Any]:
    return json.loads((SAMPLE_DIRECTORY / "demo.json").read_text(encoding="utf-8"))


def demo_document_types() -> tuple[str, ...]:
    """Return the document types the bundled demo can install."""

    return tuple(str(item["document_type"]) for item in _load_bundle()["documents"])


def _image_bytes(bundle: dict[str, Any]) -> bytes:
    return (SAMPLE_DIRECTORY / str(bundle["image"])).read_bytes()


def _rewrite_images(value: Any, *, bundled_name: str, relative_path: str, assets: Path, image_bytes: bytes) -> None:
    if isinstance(value, list):
        for child in value:
            _rewrite_images(child, bundled_name=bundled_name, relative_path=relative_path, assets=assets, image_bytes=image_bytes)
    elif isinstance(value, dict):
        image_path = value.get("path")
        if isinstance(image_path, str) and Path(image_path).name == bundled_name:
            target = assets / Path(relative_path).name
            if target.is_symlink():
                raise ValueError("Demo image destination must not be a symlink")
            if not target.exists():
                target.write_bytes(image_bytes)
            elif target.read_bytes() != image_bytes:
                raise ValueError("Demo image destination does not match its content")
            value["path"] = relative_path
        for child in value.values():
            _rewrite_images(child, bundled_name=bundled_name, relative_path=relative_path, assets=assets, image_bytes=image_bytes)


def _demo_contents(bundle: dict[str, Any], assets: Path, wanted: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    image_bytes = _image_bytes(bundle)
    digest = hashlib.sha256(image_bytes).hexdigest()
    relative_path = f"{ASSET_DIRECTORY}/{digest}.png"
    contents: dict[str, dict[str, Any]] = {}
    for item in wanted:
        document_type = str(item["document_type"])
        content = copy.deepcopy(item["content"])
        _rewrite_images(
            content,
            bundled_name=str(bundle["image"]),
            relative_path=relative_path,
            assets=assets,
            image_bytes=image_bytes,
        )
        contents[document_type] = content
    return contents


def _existing_titles(connection: Any) -> set[str]:
    rows = connection.execute(
        "SELECT title FROM documents WHERE soft_deleted_at IS NULL AND title LIKE ?",
        (f"{DEMO_PREFIX}%",),
    ).fetchall()
    return {str(row["title"]) for row in rows}


def _validate_staged(bundle: dict[str, Any], wanted: list[dict[str, Any]], contents: dict[str, dict[str, Any]]) -> None:
    """Render every bundled demo before touching the user workspace."""

    staged = Workspace.create_temporary()
    try:
        profile = staged.save_profile(bundle["profile"])
        for item in wanted:
            document_type = str(item["document_type"])
            document = staged.create_document({
                "profile_id": profile["id"],
                "document_type": document_type,
                "title": f"{DEMO_PREFIX}{item['title']}",
                "template_version": str(item["template_version"]),
                "schema_version": str(item["schema_version"]),
            })
            staged.save_draft(document["id"], contents[document_type], 0, reason="import")
            validate_document(document_type, build_export_document(staged, staged.get_document(document["id"])))
    finally:
        staged.close()


def install_demo_documents(workspace: Workspace) -> dict[str, Any]:
    """Add any missing demo documents, leaving real drafts untouched."""

    empty = {"installed": [], "skipped": [], "profile_id": None, "titles": []}
    if workspace.is_temporary or workspace.database.data_directory is None:
        return empty
    bundle = _load_bundle()
    assets = workspace.database.data_directory / ASSET_DIRECTORY
    assets.mkdir(mode=0o700, parents=True, exist_ok=True)
    existing = _existing_titles(workspace.database.connection)
    wanted: list[dict[str, Any]] = []
    skipped: list[str] = []
    for item in bundle["documents"]:
        title = f"{DEMO_PREFIX}{item['title']}"
        if title in existing:
            skipped.append(str(item["document_type"]))
        else:
            wanted.append(item)
    if not wanted:
        return {**empty, "skipped": skipped}

    contents = _demo_contents(bundle, assets, wanted)
    _validate_staged(bundle, wanted, contents)

    active = workspace.load_active()["profile"]
    if active is None:
        profiles = workspace.list_profiles()
        if len(profiles) == 1:
            active = profiles[0]
    created_profile_id: str | None = None
    created_documents: list[str] = []
    installed: list[str] = []
    titles: list[str] = []
    try:
        if active is None:
            profile = workspace.save_profile(bundle["profile"])
            created_profile_id = str(profile["id"])
        else:
            profile = active
        first_document_id: str | None = None
        for item in wanted:
            document_type = str(item["document_type"])
            title = f"{DEMO_PREFIX}{item['title']}"
            document = workspace.create_document({
                "profile_id": profile["id"],
                "document_type": document_type,
                "title": title,
                "template_version": str(item["template_version"]),
                "schema_version": str(item["schema_version"]),
            })
            created_documents.append(str(document["id"]))
            workspace.save_draft(document["id"], contents[document_type], 0, reason="import")
            installed.append(document_type)
            titles.append(title)
            if first_document_id is None:
                first_document_id = document["id"]
        if active is None and first_document_id is not None:
            workspace.save_active(profile_id=str(profile["id"]), document_id=first_document_id)
    except Exception:
        _discard_partial(workspace, created_documents, created_profile_id)
        raise
    return {"installed": installed, "skipped": skipped, "profile_id": profile["id"], "titles": titles}


def _discard_partial(workspace: Workspace, document_ids: list[str], profile_id: str | None) -> None:
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


def remove_demo_documents(workspace: Workspace) -> dict[str, Any]:
    """Permanently remove documents created by the demo installer."""

    rows = workspace.database.connection.execute(
        "SELECT id, title, soft_deleted_at FROM documents WHERE title LIKE ?",
        (f"{DEMO_PREFIX}%",),
    ).fetchall()
    removed: list[str] = []
    for row in rows:
        document_id = str(row["id"])
        if row["soft_deleted_at"] is None:
            workspace.delete_document(document_id)
        workspace.purge_document(document_id)
        removed.append(str(row["title"]))
    return {"removed": len(removed), "titles": removed}
