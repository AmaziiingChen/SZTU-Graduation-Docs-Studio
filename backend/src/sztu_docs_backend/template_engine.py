"""Install and resolve exact local-only process-document rendering engines."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .storage.database import utc_now
from .storage.paths import prepare_private_directory, protect_private_file
from .template_catalog import template_pack_root

ENGINE_VERSION = "0.2+a0799ee"
ENGINE_TEMPLATE_ID = "sztu.proposal.2026.local"
ENGINE_DIRECTORY_NAME = "proposal-0.2-a0799ee"
MIDTERM_ENGINE_VERSION = "0.1+local.20260830"
MIDTERM_ENGINE_TEMPLATE_ID = "sztu.midterm.2026.local"
MIDTERM_ENGINE_DIRECTORY_NAME = "midterm-0.1-local-20260830"
INSTALL_MANIFEST_NAME = "install-manifest.json"
ENGINE_FILE_HASHES = {
    "word/render.py": "c255ccac31ea73a5c1629eb0d30c91f6931c9083329f5e6218070e13a8d869aa",
    "word/official-template.docx": "85b9ccc9d92e923fda81501a9f5abfd237fbc1c5021bafe449e51f044bfa5806",
    "latex/render.py": "16fb153f629dd417a9d165849a555cd01f829aba96353ea67b633a182d3e3259",
    "latex/main.tex": "1794535971360397c3947c8b6f00542584602667596edd61b0320c9e7bbe57d6",
    "schema/proposal.schema.json": "4a916b1127dc3db6a8dc6c8f5278b4d994feb77e9e09b507639a92a30d4efa63",
}
MIDTERM_ENGINE_FILE_HASHES = {
    "templates/common/__init__.py": "b5cf6a625cd4c58cac3e8bd2636bafe769bfe6394784d9c7dbb758edec251e5c",
    "templates/common/python/__init__.py": "687b666c14d9378451c2474ddd7c9736eec9f29bf41e13a6d1702061808b13c0",
    "templates/common/python/content.py": "36c61c9f09254ddf515a955f0fe3230eec98a0dc6d63d7ce2939f60b04d80e45",
    "templates/common/python/font_files.py": "4782eefaea6e6898d09213d4b75c0f4d482e0daee0b1f935e4dbca72c03ed285",
    "templates/common/python/typography.py": "864e8743cdde4a88b7bc4e0345c981e8fab3fc0d38933eb8fd90568a91858650",
    "templates/common/schema/content-block.schema.json": "6c766db71640843a8eaa86d9398e6a02b3b9b0d11edfd24b512e27c8caef0562",
    "templates/common/typography/chinese-sizes.json": "0edffced2a950d98da56a62874e4a5ed1ef41fe6ac7780afee345ca7f433ce6b",
    "templates/common/typography/font-policy-2026.json": "b363a52094f61062ac673d1eca212e940f0c56cc576444741c00904a827d1e9c",
    "templates/midterm/latex/main.tex": "de5a63a007d1232ed41d16c76bbd0a1c5d0ccd97cb19d7b55b8233875c52bad6",
    "templates/midterm/latex/render.py": "12adc734cd8f8b4e3eb522ea321f0f3399760dd1cd33b8cd6c1ee6accd1399eb",
    "templates/midterm/schema/midterm.schema.json": "17924cfa9daf2e1a56e29ab883bbe5fd93482c2a3afa88591f0ad3a355707d58",
    "templates/midterm/spec/layout.json": "4c0dc0b2e7543361b3fde49362230ddd80c3edfda6310eae668bdb39e56093a4",
    "templates/midterm/word/official-template.docx": "5411d1471ba1a30def0b8c945a11674cce4616a6b3c0d3a8953e3f45b88af1a2",
    "templates/midterm/word/render.py": "31758477b634547161fbe40da263ec3d4f0e0f201d923faed8441da0e3f0a725",
}
VALIDATOR_SHA256 = "c59f65c8a45305df2a14baab4be6c7b200755c07751f40fcafd82c44259f1572"


class TemplateEngineError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


@dataclass(frozen=True)
class EngineDescriptor:
    root: Path
    validator: Path
    pack_sha256: str
    source: str
    document_type: str = "proposal"
    template_id: str = ENGINE_TEMPLATE_ID
    version: str = ENGINE_VERSION


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _require_plain_descendant(root: Path, candidate: Path) -> Path:
    """Return a resolved descendant while rejecting every symlink component."""
    try:
        relative = candidate.relative_to(root)
    except ValueError as exc:
        raise TemplateEngineError(
            "TEMPLATE_SOURCE_INVALID",
            "模板源码文件必须位于所选目录内。",
        ) from exc
    cursor = root
    for part in relative.parts:
        cursor /= part
        if cursor.is_symlink():
            raise TemplateEngineError(
                "TEMPLATE_SOURCE_INVALID",
                "模板源码目录不能包含符号链接。",
            )
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, ValueError) as exc:
        raise TemplateEngineError(
            "TEMPLATE_SOURCE_INVALID",
            "模板源码文件不属于所选目录。",
        ) from exc
    return resolved


def _validator_candidates(root: Path, selected: Path | None = None) -> tuple[Path, ...]:
    candidates: list[Path] = []
    if selected is not None:
        candidates.append(selected)
    candidates.extend(
        [
            root / "scripts" / "validate_cjk_render.py",
            root.parents[1] / "scripts" / "validate_cjk_render.py",
        ]
    )
    return tuple(dict.fromkeys(candidates))


def verify_engine(
    root: Path,
    *,
    validator: Path | None = None,
    source: str,
) -> EngineDescriptor:
    if not root.is_absolute() or root.is_symlink() or not root.is_dir():
        raise TemplateEngineError(
            "TEMPLATE_ENGINE_INVALID",
            "开题报告模板引擎目录无效或使用了符号链接。",
        )
    root = root.resolve()
    combined = hashlib.sha256()
    for relative_name, expected_hash in sorted(ENGINE_FILE_HASHES.items()):
        try:
            path = _require_plain_descendant(root, root / relative_name)
        except TemplateEngineError as exc:
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_INVALID",
                "开题报告模板引擎包含不受信任的链接或路径。",
                {"file": relative_name},
            ) from exc
        if not path.is_file():
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_INVALID",
                "开题报告模板引擎缺少受信任文件。",
                {"file": relative_name},
            )
        actual_hash = sha256_file(path)
        if actual_hash != expected_hash:
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_HASH_MISMATCH",
                "开题报告模板引擎与已提交版本不一致，已停止执行。",
                {"file": relative_name},
            )
        combined.update(relative_name.encode("utf-8"))
        combined.update(b"\0")
        combined.update(actual_hash.encode("ascii"))
        combined.update(b"\n")

    selected_validator = next(
        (path for path in _validator_candidates(root, validator) if path.is_file()),
        None,
    )
    if (
        selected_validator is None
        or not selected_validator.is_absolute()
        or selected_validator.is_symlink()
    ):
        raise TemplateEngineError(
            "TEMPLATE_ENGINE_INVALID",
            "缺少受信任的中文字形检查脚本。",
        )
    selected_validator = selected_validator.resolve()
    if sha256_file(selected_validator) != VALIDATOR_SHA256:
        raise TemplateEngineError(
            "TEMPLATE_ENGINE_HASH_MISMATCH",
            "中文字形检查脚本与已提交版本不一致，已停止执行。",
        )
    combined.update(b"validator\0")
    combined.update(VALIDATOR_SHA256.encode("ascii"))
    return EngineDescriptor(
        root=root,
        validator=selected_validator,
        pack_sha256=combined.hexdigest(),
        source=source,
        document_type="proposal",
        template_id=ENGINE_TEMPLATE_ID,
        version=ENGINE_VERSION,
    )


def verify_midterm_engine(
    bundle_root: Path,
    *,
    validator: Path | None = None,
    source: str,
) -> EngineDescriptor:
    if not bundle_root.is_absolute() or bundle_root.is_symlink() or not bundle_root.is_dir():
        raise TemplateEngineError(
            "TEMPLATE_ENGINE_INVALID",
            "中期检查模板引擎目录无效或使用了符号链接。",
        )
    bundle_root = bundle_root.resolve()
    combined = hashlib.sha256()
    for relative_name, expected_hash in sorted(MIDTERM_ENGINE_FILE_HASHES.items()):
        try:
            path = _require_plain_descendant(bundle_root, bundle_root / relative_name)
        except TemplateEngineError as exc:
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_INVALID",
                "中期检查模板引擎包含不受信任的链接或路径。",
                {"file": relative_name},
            ) from exc
        if not path.is_file():
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_INVALID",
                "中期检查模板引擎缺少受信任文件。",
                {"file": relative_name},
            )
        actual_hash = sha256_file(path)
        if actual_hash != expected_hash:
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_HASH_MISMATCH",
                "中期检查模板引擎与已验收工作区快照不一致，已停止执行。",
                {"file": relative_name},
            )
        combined.update(relative_name.encode("utf-8"))
        combined.update(b"\0")
        combined.update(actual_hash.encode("ascii"))
        combined.update(b"\n")

    selected_validator = validator or bundle_root / "scripts" / "validate_cjk_render.py"
    try:
        selected_validator = _require_plain_descendant(bundle_root, selected_validator)
    except TemplateEngineError as exc:
        raise TemplateEngineError(
            "TEMPLATE_ENGINE_INVALID",
            "缺少受信任的中文字形检查脚本。",
        ) from exc
    if not selected_validator.is_file() or sha256_file(selected_validator) != VALIDATOR_SHA256:
        raise TemplateEngineError(
            "TEMPLATE_ENGINE_HASH_MISMATCH",
            "中文字形检查脚本与受信任版本不一致，已停止执行。",
        )
    combined.update(b"validator\0")
    combined.update(VALIDATOR_SHA256.encode("ascii"))
    return EngineDescriptor(
        root=bundle_root / "templates" / "midterm",
        validator=selected_validator,
        pack_sha256=combined.hexdigest(),
        source=source,
        document_type="midterm",
        template_id=MIDTERM_ENGINE_TEMPLATE_ID,
        version=MIDTERM_ENGINE_VERSION,
    )


def installed_engine_root(data_directory: Path, document_type: str = "proposal") -> Path:
    directory_name = (
        ENGINE_DIRECTORY_NAME
        if document_type == "proposal"
        else MIDTERM_ENGINE_DIRECTORY_NAME
    )
    return data_directory / "template-engines" / directory_name


def _candidate_engine_roots() -> list[tuple[Path, Path | None, str]]:
    configured = os.environ.get("SZTU_DOCS_PROPOSAL_ENGINE_DIR")
    if configured:
        candidate = Path(configured).expanduser()
        if not candidate.is_absolute():
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_INVALID",
                "开题报告模板引擎目录必须使用绝对路径。",
            )
        configured_validator = os.environ.get("SZTU_DOCS_CJK_VALIDATOR")
        validator = Path(configured_validator).expanduser() if configured_validator else None
        return [(candidate, validator, "environment")]

    candidates: list[tuple[Path, Path | None, str]] = []
    data_dir = os.environ.get("SZTU_DOCS_DATA_DIR")
    if data_dir:
        root = installed_engine_root(Path(data_dir).expanduser().resolve())
        candidates.append((root, root / "scripts" / "validate_cjk_render.py", "installed"))
    try:
        workbench_root = template_pack_root().expanduser().resolve().parent
        candidates.append(
            (
                workbench_root.parent / "Thesis" / "templates" / "proposal",
                workbench_root.parent / "Thesis" / "scripts" / "validate_cjk_render.py",
                "development",
            )
        )
    except OSError:
        pass
    return candidates


def resolve_engine(document_type: str = "proposal") -> EngineDescriptor:
    if document_type == "midterm":
        candidates: list[tuple[Path, Path | None, str]] = []
        configured = os.environ.get("SZTU_DOCS_MIDTERM_ENGINE_DIR")
        if configured:
            candidate = Path(configured).expanduser()
            if not candidate.is_absolute():
                raise TemplateEngineError(
                    "TEMPLATE_ENGINE_INVALID",
                    "中期检查模板引擎目录必须使用绝对路径。",
                )
            candidates.append((candidate, candidate / "scripts" / "validate_cjk_render.py", "environment"))
        data_dir = os.environ.get("SZTU_DOCS_DATA_DIR")
        if data_dir:
            installed = installed_engine_root(
                Path(data_dir).expanduser().resolve(), "midterm"
            )
            candidates.append((installed, installed / "scripts" / "validate_cjk_render.py", "installed"))
        try:
            workbench_root = template_pack_root().expanduser().resolve().parent
            development = workbench_root.parent / "Thesis"
            candidates.append(
                (development, development / "scripts" / "validate_cjk_render.py", "development")
            )
        except OSError:
            pass
        first_error: TemplateEngineError | None = None
        for root, validator, source in candidates:
            if not root.is_dir():
                continue
            try:
                return verify_midterm_engine(root, validator=validator, source=source)
            except TemplateEngineError as exc:
                if first_error is None:
                    first_error = exc
        if first_error is not None:
            raise first_error
        raise TemplateEngineError(
            "TEMPLATE_ENGINE_UNAVAILABLE",
            "未找到已安装的中期检查模板引擎，当前不能导出 Word、LaTeX 或 PDF。",
        )
    if document_type != "proposal":
        raise TemplateEngineError("TEMPLATE_ENGINE_UNSUPPORTED", "当前文档类型没有可用模板引擎。")
    first_error: TemplateEngineError | None = None
    for root, validator, source in _candidate_engine_roots():
        if not root.is_dir():
            continue
        try:
            return verify_engine(root, validator=validator, source=source)
        except TemplateEngineError as exc:
            if first_error is None:
                first_error = exc
    if first_error is not None:
        raise first_error
    raise TemplateEngineError(
        "TEMPLATE_ENGINE_UNAVAILABLE",
        "未找到已安装的开题报告模板引擎，当前不能导出 Word、LaTeX 或 PDF。",
    )


def _locate_source(selected: Path) -> tuple[Path, Path]:
    if not selected.is_absolute() or selected.is_symlink() or not selected.is_dir():
        raise TemplateEngineError(
            "TEMPLATE_SOURCE_INVALID",
            "请选择有效的本地模板源码文件夹。",
        )
    selected = selected.resolve()
    nested_root = selected / "templates" / "proposal"
    if nested_root.is_dir():
        root = _require_plain_descendant(selected, nested_root)
    else:
        root = selected
    validator = None
    for path in _validator_candidates(
        root, selected / "scripts" / "validate_cjk_render.py"
    ):
        if not path.is_file():
            continue
        try:
            validator = _require_plain_descendant(selected, path)
        except TemplateEngineError:
            continue
        break
    if validator is None:
        raise TemplateEngineError(
            "TEMPLATE_SOURCE_INVALID",
            "所选文件夹缺少中文字形检查脚本。",
        )
    return root, validator


def install_engine(
    workspace: Any,
    source_directory: str,
    document_type: str = "proposal",
) -> dict[str, Any]:
    if document_type == "midterm":
        return _install_midterm_engine(workspace, source_directory)
    if document_type != "proposal":
        raise TemplateEngineError("TEMPLATE_ENGINE_UNSUPPORTED", "当前文档类型没有可安装模板。")
    data_directory = workspace.database.data_directory
    if workspace.is_temporary or data_directory is None:
        raise TemplateEngineError(
            "TEMPLATE_INSTALL_PERSISTENT_ONLY",
            "模板引擎只能安装到持久工作区。",
        )
    selected = Path(source_directory).expanduser()
    source_root, source_validator = _locate_source(selected)
    verified_source = verify_engine(
        source_root,
        validator=source_validator,
        source="selected-local-source",
    )

    engines_root = data_directory / "template-engines"
    prepare_private_directory(engines_root)
    destination = installed_engine_root(data_directory)
    if destination.exists():
        installed = verify_engine(
            destination,
            validator=destination / "scripts" / "validate_cjk_render.py",
            source="installed",
        )
        if installed.pack_sha256 != verified_source.pack_sha256:
            raise TemplateEngineError(
                "TEMPLATE_INSTALL_CONFLICT",
                "已有安装与所选模板版本冲突；原安装未被覆盖。",
            )
        status = "already_installed"
    else:
        staging = engines_root / f".install-{uuid.uuid4().hex}"
        staging.mkdir(mode=0o700)
        try:
            for relative_name in sorted(ENGINE_FILE_HASHES):
                source_file = source_root / relative_name
                target_file = staging / relative_name
                target_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                shutil.copyfile(source_file, target_file)
                protect_private_file(target_file)
            validator_target = staging / "scripts" / "validate_cjk_render.py"
            validator_target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            shutil.copyfile(source_validator, validator_target)
            protect_private_file(validator_target)
            install_manifest = {
                "schema_version": "1.0",
                "template_id": ENGINE_TEMPLATE_ID,
                "version": ENGINE_VERSION,
                "pack_sha256": verified_source.pack_sha256,
                "installed_at": utc_now(),
                "redistribution": "local-only",
            }
            manifest_path = staging / INSTALL_MANIFEST_NAME
            manifest_path.write_bytes(canonical_json(install_manifest))
            protect_private_file(manifest_path)
            verify_engine(
                staging,
                validator=validator_target,
                source="install-staging",
            )
            staging.rename(destination)
        except Exception:
            if staging.exists():
                shutil.rmtree(staging)
            raise
        status = "installed"

    manifest_path = destination / INSTALL_MANIFEST_NAME
    try:
        install_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        installed_at = install_manifest["installed_at"]
        if not isinstance(installed_at, str) or not installed_at:
            raise ValueError
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, KeyError, ValueError) as exc:
        raise TemplateEngineError(
            "TEMPLATE_INSTALL_INVALID",
            "已安装模板的本地清单无效。",
        ) from exc
    manifest_sha256 = sha256_file(manifest_path)
    metadata = {
        "schema_version": "1.0",
        "engine_version": ENGINE_VERSION,
        "pack_sha256": verified_source.pack_sha256,
        "redistribution": "local-only",
    }
    with workspace.database.transaction(immediate=True) as connection:
        connection.execute(
            """
            INSERT INTO template_installations(
                template_id, version, manifest_sha256, installed_at,
                enabled, install_path, metadata_json
            ) VALUES (?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(template_id, version) DO UPDATE SET
                manifest_sha256 = excluded.manifest_sha256,
                enabled = 1,
                install_path = excluded.install_path,
                metadata_json = excluded.metadata_json
            """,
            (
                ENGINE_TEMPLATE_ID,
                ENGINE_VERSION,
                manifest_sha256,
                installed_at,
                str(destination),
                canonical_json(metadata).decode("utf-8"),
            ),
        )
    return {
        "status": status,
        "template_id": ENGINE_TEMPLATE_ID,
        "version": ENGINE_VERSION,
        "pack_sha256": verified_source.pack_sha256,
        "installed_at": installed_at,
    }


def _install_midterm_engine(workspace: Any, source_directory: str) -> dict[str, Any]:
    data_directory = workspace.database.data_directory
    if workspace.is_temporary or data_directory is None:
        raise TemplateEngineError(
            "TEMPLATE_INSTALL_PERSISTENT_ONLY",
            "模板引擎只能安装到持久工作区。",
        )
    selected = Path(source_directory).expanduser()
    if not selected.is_absolute() or selected.is_symlink() or not selected.is_dir():
        raise TemplateEngineError("TEMPLATE_SOURCE_INVALID", "请选择有效的本地模板源码文件夹。")
    selected = selected.resolve()
    try:
        _require_plain_descendant(selected, selected / "templates" / "midterm")
        _require_plain_descendant(selected, selected / "templates" / "common")
        source_validator = _require_plain_descendant(
            selected, selected / "scripts" / "validate_cjk_render.py"
        )
    except TemplateEngineError as exc:
        raise TemplateEngineError(
            "TEMPLATE_SOURCE_INVALID",
            "请选择同时包含 templates/midterm、templates/common 和 scripts 的项目根目录。",
        ) from exc
    verified_source = verify_midterm_engine(
        selected,
        validator=source_validator,
        source="selected-local-source",
    )

    engines_root = data_directory / "template-engines"
    prepare_private_directory(engines_root)
    destination = installed_engine_root(data_directory, "midterm")
    if destination.exists():
        installed = verify_midterm_engine(
            destination,
            validator=destination / "scripts" / "validate_cjk_render.py",
            source="installed",
        )
        if installed.pack_sha256 != verified_source.pack_sha256:
            raise TemplateEngineError(
                "TEMPLATE_INSTALL_CONFLICT",
                "已有中期检查模板安装与所选版本冲突；原安装未被覆盖。",
            )
        status = "already_installed"
    else:
        staging = engines_root / f".install-{uuid.uuid4().hex}"
        staging.mkdir(mode=0o700)
        try:
            for relative_name in sorted(MIDTERM_ENGINE_FILE_HASHES):
                source_file = selected / relative_name
                target_file = staging / relative_name
                target_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                shutil.copyfile(source_file, target_file)
                protect_private_file(target_file)
            validator_target = staging / "scripts" / "validate_cjk_render.py"
            validator_target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            shutil.copyfile(source_validator, validator_target)
            protect_private_file(validator_target)
            manifest = {
                "schema_version": "1.0",
                "template_id": MIDTERM_ENGINE_TEMPLATE_ID,
                "version": MIDTERM_ENGINE_VERSION,
                "pack_sha256": verified_source.pack_sha256,
                "installed_at": utc_now(),
                "redistribution": "local-only",
                "source_state": "uncommitted-working-tree-snapshot",
            }
            manifest_path = staging / INSTALL_MANIFEST_NAME
            manifest_path.write_bytes(canonical_json(manifest))
            protect_private_file(manifest_path)
            verify_midterm_engine(
                staging,
                validator=validator_target,
                source="install-staging",
            )
            staging.rename(destination)
        except Exception:
            if staging.exists():
                shutil.rmtree(staging)
            raise
        status = "installed"

    manifest_path = destination / INSTALL_MANIFEST_NAME
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        installed_at = manifest["installed_at"]
        if not isinstance(installed_at, str) or not installed_at:
            raise ValueError
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, KeyError, ValueError) as exc:
        raise TemplateEngineError("TEMPLATE_INSTALL_INVALID", "已安装模板的本地清单无效。") from exc
    manifest_sha256 = sha256_file(manifest_path)
    metadata = {
        "schema_version": "1.0",
        "engine_version": MIDTERM_ENGINE_VERSION,
        "pack_sha256": verified_source.pack_sha256,
        "redistribution": "local-only",
        "source_state": "uncommitted-working-tree-snapshot",
    }
    with workspace.database.transaction(immediate=True) as connection:
        connection.execute(
            """
            INSERT INTO template_installations(
                template_id, version, manifest_sha256, installed_at,
                enabled, install_path, metadata_json
            ) VALUES (?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(template_id, version) DO UPDATE SET
                manifest_sha256 = excluded.manifest_sha256,
                enabled = 1,
                install_path = excluded.install_path,
                metadata_json = excluded.metadata_json
            """,
            (
                MIDTERM_ENGINE_TEMPLATE_ID,
                MIDTERM_ENGINE_VERSION,
                manifest_sha256,
                installed_at,
                str(destination),
                canonical_json(metadata).decode("utf-8"),
            ),
        )
    return {
        "status": status,
        "template_id": MIDTERM_ENGINE_TEMPLATE_ID,
        "version": MIDTERM_ENGINE_VERSION,
        "pack_sha256": verified_source.pack_sha256,
        "installed_at": installed_at,
    }
