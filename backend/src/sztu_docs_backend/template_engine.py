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
TASK_BOOK_ENGINE_VERSION = "0.1+46b6d97"
TASK_BOOK_ENGINE_TEMPLATE_ID = "sztu.task-book.2026.local"
TASK_BOOK_ENGINE_DIRECTORY_NAME = "task-book-0.1-46b6d97"
SUPPORTED_ENGINE_DOCUMENT_TYPES = frozenset({"proposal", "midterm", "task_book"})
INSTALL_MANIFEST_NAME = "install-manifest.json"
WORKSPACE_LINKS_NAME = "workspace-links.json"
WORKSPACE_SNAPSHOTS_DIRECTORY = "workspace-snapshots"
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
TASK_BOOK_ENGINE_FILE_HASHES = {
    "templates/common/__init__.py": "b5cf6a625cd4c58cac3e8bd2636bafe769bfe6394784d9c7dbb758edec251e5c",
    "templates/common/python/__init__.py": "687b666c14d9378451c2474ddd7c9736eec9f29bf41e13a6d1702061808b13c0",
    "templates/common/python/content.py": "2f2ab4d43e57d5dff9cad2f44fc47f9d0dddbb3c6ab06821364ec9850b94e420",
    "templates/common/python/font_files.py": "4782eefaea6e6898d09213d4b75c0f4d482e0daee0b1f935e4dbca72c03ed285",
    "templates/common/python/typography.py": "864e8743cdde4a88b7bc4e0345c981e8fab3fc0d38933eb8fd90568a91858650",
    "templates/common/schema/content-block.schema.json": "6c766db71640843a8eaa86d9398e6a02b3b9b0d11edfd24b512e27c8caef0562",
    "templates/common/typography/chinese-sizes.json": "46ec813ebc86f8a0b5fa0e2fc19c9e6b1e59519b7a03a53ed676f7126f0c8cc2",
    "templates/common/typography/font-policy-2026.json": "1aa94285f0b15dddf20178998c55c72839cc0878cb60904f0247a2b182619a61",
    "templates/task-book/render.py": "16594594f5cabdb24845a5723ba26eea837ab2c5e91618b3ca4720e15769b40b",
    "templates/task-book/python/__init__.py": "a0f9d99aadb8bae63368ba16ff1c51a917e97011eafb938bbf31182b2c080e20",
    "templates/task-book/python/model.py": "6aaad71b1f9c527defcf65c1e65989da36a2a12a95d55a6568723f2f16d9f204",
    "templates/task-book/latex/main.tex": "0b33e6aef703434e812e634cb7b30ce36b4c663b3895433348fcfb65331acc2a",
    "templates/task-book/latex/render.py": "ad2e737331e023f44c62e3a97018b714b02232bfd58694e4144290c512ba79ba",
    "templates/task-book/schema/task-book.schema.json": "16cfd7b8071c7164e356663fd4c5239cb10c4a738414a72882017129d1582ae4",
    "templates/task-book/spec/fixed-content.json": "555f81cbfe0b654ce609bc3ba20b95ade6676d7159f4e991b991665f6b6e92c2",
    "templates/task-book/spec/layout.json": "374c6800ed8fe14cfcb7f0b93f08bedb17f62529149cf5827ba7b6151f284331",
    "templates/task-book/word/official-template.docx": "dd5cdeb1c96d0a617fe03095483dc5f4cbd96a12772d55e940c120978a6104d2",
    "templates/task-book/word/render.py": "204508f99c04c5708355e4c8dd937ed39c1ee2ddd383ab7f51e916ed429760f9",
}
WORKSPACE_SHARED_SUPPORT_FILE_NAMES = (
    "templates/common/latex/sztu-process-form.tex",
    "templates/common/python/process_form.py",
)
WORKSPACE_COMMON_FILE_NAMES = tuple(
    sorted(
        {
            *(
                name
                for name in MIDTERM_ENGINE_FILE_HASHES
                if name.startswith("templates/common/")
            ),
            *WORKSPACE_SHARED_SUPPORT_FILE_NAMES,
        }
    )
)
PROPOSAL_WORKSPACE_FILE_NAMES = tuple(
    sorted(
        {
            *(f"templates/proposal/{name}" for name in ENGINE_FILE_HASHES),
            "templates/proposal/spec/layout.json",
            *WORKSPACE_COMMON_FILE_NAMES,
        }
    )
)
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
    font_directories: tuple[Path, ...] = ()


@dataclass(frozen=True)
class WorkspaceEngineSource:
    selection_root: Path
    engine_root: Path
    validator: Path
    files: tuple[tuple[str, Path], ...]
    document_type: str
    font_directories: tuple[Path, ...]


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


def verify_task_book_engine(
    bundle_root: Path,
    *,
    validator: Path | None = None,
    source: str,
) -> EngineDescriptor:
    """Verify the immutable task-book engine recorded at commit 46b6d97."""

    if not bundle_root.is_absolute() or bundle_root.is_symlink() or not bundle_root.is_dir():
        raise TemplateEngineError(
            "TEMPLATE_ENGINE_INVALID",
            "任务书模板引擎目录无效或使用了符号链接。",
        )
    bundle_root = bundle_root.resolve()
    combined = hashlib.sha256()
    for relative_name, expected_hash in sorted(TASK_BOOK_ENGINE_FILE_HASHES.items()):
        try:
            candidate = _require_plain_descendant(
                bundle_root, bundle_root / relative_name
            )
        except TemplateEngineError as exc:
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_INVALID",
                "任务书模板引擎包含不受信任的链接或路径。",
                {"file": relative_name},
            ) from exc
        if not candidate.is_file():
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_INVALID",
                "任务书模板引擎缺少受信任文件。",
                {"file": relative_name},
            )
        actual_hash = sha256_file(candidate)
        if actual_hash != expected_hash:
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_HASH_MISMATCH",
                "任务书模板引擎与已提交版本不一致，已停止执行。",
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
        root=bundle_root / "templates" / "task-book",
        validator=selected_validator,
        pack_sha256=combined.hexdigest(),
        source=source,
        document_type="task_book",
        template_id=TASK_BOOK_ENGINE_TEMPLATE_ID,
        version=TASK_BOOK_ENGINE_VERSION,
    )


def installed_engine_root(data_directory: Path, document_type: str = "proposal") -> Path:
    directory_name = {
        "proposal": ENGINE_DIRECTORY_NAME,
        "midterm": MIDTERM_ENGINE_DIRECTORY_NAME,
        "task_book": TASK_BOOK_ENGINE_DIRECTORY_NAME,
    }[document_type]
    return data_directory / "template-engines" / directory_name


def resolve_engine(document_type: str = "proposal") -> EngineDescriptor:
    if document_type not in SUPPORTED_ENGINE_DOCUMENT_TYPES:
        raise TemplateEngineError("TEMPLATE_ENGINE_UNSUPPORTED", "当前文档类型没有可用模板引擎。")

    data_dir_value = os.environ.get("SZTU_DOCS_DATA_DIR")
    data_directory = (
        Path(data_dir_value).expanduser().resolve() if data_dir_value else None
    )
    configured_name = {
        "proposal": "SZTU_DOCS_PROPOSAL_ENGINE_DIR",
        "midterm": "SZTU_DOCS_MIDTERM_ENGINE_DIR",
        "task_book": "SZTU_DOCS_TASK_BOOK_ENGINE_DIR",
    }[document_type]
    configured = os.environ.get(configured_name)
    if configured:
        selected = Path(configured).expanduser()
        if not selected.is_absolute():
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_INVALID", "模板工程目录必须使用绝对路径。"
            )
        if data_directory is not None:
            return _snapshot_workspace_engine(
                data_directory,
                selected,
                document_type,
                source_label="environment-workspace",
            )[0]

    if data_directory is not None:
        linked = _read_workspace_links(data_directory).get(document_type)
        if linked is not None:
            return _snapshot_workspace_engine(
                data_directory,
                Path(linked["source_directory"]),
                document_type,
                source_label="linked-workspace",
            )[0]

        try:
            workbench_root = template_pack_root().expanduser().resolve().parent
            development = workbench_root.parent / "Thesis"
        except OSError:
            development = Path()
        if development.is_absolute() and development.is_dir():
            return _snapshot_workspace_engine(
                data_directory,
                development,
                document_type,
                source_label="development-workspace",
            )[0]

        installed = installed_engine_root(data_directory, document_type)
        if installed.is_dir():
            if document_type == "proposal":
                return verify_engine(
                    installed,
                    validator=installed / "scripts" / "validate_cjk_render.py",
                    source="installed",
                )
            if document_type == "midterm":
                return verify_midterm_engine(
                    installed,
                    validator=installed / "scripts" / "validate_cjk_render.py",
                    source="installed",
                )
            return verify_task_book_engine(
                installed,
                validator=installed / "scripts" / "validate_cjk_render.py",
                source="installed",
            )

    if configured:
        selected = Path(configured).expanduser()
        if document_type == "proposal":
            return verify_engine(
                selected,
                validator=Path(
                    os.environ.get(
                        "SZTU_DOCS_CJK_VALIDATOR",
                        str(selected / "scripts" / "validate_cjk_render.py"),
                    )
                ),
                source="environment",
            )
        if document_type == "midterm":
            return verify_midterm_engine(
                selected,
                validator=selected / "scripts" / "validate_cjk_render.py",
                source="environment",
            )
        return verify_task_book_engine(
            selected,
            validator=selected / "scripts" / "validate_cjk_render.py",
            source="environment",
        )

    raise TemplateEngineError(
        "TEMPLATE_ENGINE_UNAVAILABLE",
        "未找到已关联或已安装的模板引擎，当前不能导出 Word、LaTeX 或 PDF。",
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


def _locate_midterm_source(selected: Path) -> tuple[Path, Path]:
    if not selected.is_absolute() or selected.is_symlink() or not selected.is_dir():
        raise TemplateEngineError("TEMPLATE_SOURCE_INVALID", "请选择有效的本地模板源码文件夹。")
    selected = selected.resolve()
    try:
        engine_root = _require_plain_descendant(
            selected, selected / "templates" / "midterm"
        )
        _require_plain_descendant(selected, selected / "templates" / "common")
        validator = _require_plain_descendant(
            selected, selected / "scripts" / "validate_cjk_render.py"
        )
    except TemplateEngineError as exc:
        raise TemplateEngineError(
            "TEMPLATE_SOURCE_INVALID",
            "请选择同时包含 templates/midterm、templates/common 和 scripts 的项目根目录。",
        ) from exc
    return engine_root, validator


def _locate_task_book_source(selected: Path) -> tuple[Path, Path]:
    if not selected.is_absolute() or selected.is_symlink() or not selected.is_dir():
        raise TemplateEngineError("TEMPLATE_SOURCE_INVALID", "请选择有效的本地模板源码文件夹。")
    selected = selected.resolve()
    try:
        engine_root = _require_plain_descendant(
            selected, selected / "templates" / "task-book"
        )
        _require_plain_descendant(selected, selected / "templates" / "common")
        validator = _require_plain_descendant(
            selected, selected / "scripts" / "validate_cjk_render.py"
        )
    except TemplateEngineError as exc:
        raise TemplateEngineError(
            "TEMPLATE_SOURCE_INVALID",
            "请选择同时包含 templates/task-book、templates/common 和 scripts 的项目根目录。",
        ) from exc
    return engine_root, validator


def _workspace_source(selected: Path, document_type: str) -> WorkspaceEngineSource:
    selected = selected.expanduser()
    if document_type == "proposal":
        engine_root, validator = _locate_source(selected)
        selection_root = selected.resolve()
        if (selection_root / "templates" / "proposal").is_dir():
            files = tuple(
                (name, selection_root / name)
                for name in PROPOSAL_WORKSPACE_FILE_NAMES
            )
        else:
            files = tuple(
                (name, engine_root / name) for name in sorted(ENGINE_FILE_HASHES)
            )
    elif document_type == "midterm":
        engine_root, validator = _locate_midterm_source(selected)
        selection_root = selected.resolve()
        names = {
            *MIDTERM_ENGINE_FILE_HASHES,
            *(
                name
                for name in WORKSPACE_SHARED_SUPPORT_FILE_NAMES
                if (selection_root / name).is_file()
            ),
        }
        files = tuple((name, selection_root / name) for name in sorted(names))
    elif document_type == "task_book":
        engine_root, validator = _locate_task_book_source(selected)
        selection_root = selected.resolve()
        names = {
            *TASK_BOOK_ENGINE_FILE_HASHES,
            *(
                name
                for name in WORKSPACE_SHARED_SUPPORT_FILE_NAMES
                if (selection_root / name).is_file()
            ),
        }
        files = tuple((name, selection_root / name) for name in sorted(names))
    else:
        raise TemplateEngineError(
            "TEMPLATE_ENGINE_UNSUPPORTED", "当前文档类型没有可关联模板。"
        )
    font_directories: tuple[Path, ...] = ()
    local_fonts = engine_root / "fonts.local"
    if local_fonts.is_dir():
        if local_fonts.is_symlink():
            raise TemplateEngineError(
                "TEMPLATE_SOURCE_INVALID", "本地字体目录不能是符号链接。"
            )
        font_directories = (
            _require_plain_descendant(selection_root, local_fonts),
        )
    return WorkspaceEngineSource(
        selection_root=selection_root,
        engine_root=engine_root,
        validator=validator,
        files=files,
        document_type=document_type,
        font_directories=font_directories,
    )


def _workspace_pack_sha256(source: WorkspaceEngineSource) -> str:
    combined = hashlib.sha256()
    for relative_name, candidate in source.files:
        path = _require_plain_descendant(source.selection_root, candidate)
        if not path.is_file():
            raise TemplateEngineError(
                "TEMPLATE_SOURCE_INVALID",
                "本地模板工程缺少导出所需文件。",
                {"file": relative_name},
            )
        actual_hash = sha256_file(path)
        combined.update(relative_name.encode("utf-8"))
        combined.update(b"\0")
        combined.update(actual_hash.encode("ascii"))
        combined.update(b"\n")
    validator = _require_plain_descendant(source.selection_root, source.validator)
    if not validator.is_file():
        raise TemplateEngineError(
            "TEMPLATE_SOURCE_INVALID", "本地模板工程缺少中文字形检查脚本。"
        )
    combined.update(b"validator\0")
    combined.update(sha256_file(validator).encode("ascii"))
    return combined.hexdigest()


def _workspace_identity(document_type: str, pack_sha256: str) -> tuple[str, str]:
    if document_type == "proposal":
        template_id = ENGINE_TEMPLATE_ID
        base_version = ENGINE_VERSION.split("+", 1)[0]
    elif document_type == "midterm":
        template_id = MIDTERM_ENGINE_TEMPLATE_ID
        base_version = MIDTERM_ENGINE_VERSION.split("+", 1)[0]
    else:
        template_id = TASK_BOOK_ENGINE_TEMPLATE_ID
        base_version = TASK_BOOK_ENGINE_VERSION.split("+", 1)[0]
    return template_id, f"{base_version}+workspace.{pack_sha256[:12]}"


def _snapshot_workspace_engine(
    data_directory: Path,
    selected: Path,
    document_type: str,
    *,
    source_label: str,
) -> tuple[EngineDescriptor, str, bool]:
    source = _workspace_source(selected, document_type)
    pack_sha256 = _workspace_pack_sha256(source)
    template_id, version = _workspace_identity(document_type, pack_sha256)
    snapshots_root = (
        data_directory / "template-engines" / WORKSPACE_SNAPSHOTS_DIRECTORY
    )
    prepare_private_directory(snapshots_root)
    destination = snapshots_root / f"{document_type}-{pack_sha256}"
    created = False
    if not destination.exists():
        staging = snapshots_root / f".sync-{uuid.uuid4().hex}"
        staging.mkdir(mode=0o700)
        try:
            for relative_name, source_file in source.files:
                target_file = staging / relative_name
                target_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                shutil.copyfile(source_file, target_file)
                protect_private_file(target_file)
            validator_target = staging / "scripts" / "validate_cjk_render.py"
            validator_target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            shutil.copyfile(source.validator, validator_target)
            protect_private_file(validator_target)
            installed_at = utc_now()
            manifest_path = staging / INSTALL_MANIFEST_NAME
            manifest_path.write_bytes(
                canonical_json(
                    {
                        "schema_version": "1.0",
                        "template_id": template_id,
                        "version": version,
                        "pack_sha256": pack_sha256,
                        "installed_at": installed_at,
                        "redistribution": "local-only",
                        "source_mode": "linked-workspace-snapshot",
                    }
                )
            )
            protect_private_file(manifest_path)
            staged_source = _workspace_source(staging, document_type)
            if _workspace_pack_sha256(staged_source) != pack_sha256:
                raise TemplateEngineError(
                    "TEMPLATE_SNAPSHOT_INVALID",
                    "模板快照复核失败，未执行导出。",
                )
            staging.rename(destination)
            created = True
        except Exception:
            if staging.exists():
                shutil.rmtree(staging)
            raise
    snapshot_source = _workspace_source(destination, document_type)
    if _workspace_pack_sha256(snapshot_source) != pack_sha256:
        raise TemplateEngineError(
            "TEMPLATE_SNAPSHOT_INVALID",
            "已保存的模板快照校验失败，未执行导出。",
        )
    manifest_path = destination / INSTALL_MANIFEST_NAME
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        installed_at = manifest["installed_at"]
        if (
            manifest.get("pack_sha256") != pack_sha256
            or manifest.get("version") != version
            or not isinstance(installed_at, str)
            or not installed_at
        ):
            raise ValueError
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, KeyError, ValueError) as exc:
        raise TemplateEngineError(
            "TEMPLATE_SNAPSHOT_INVALID", "模板快照清单无效，未执行导出。"
        ) from exc
    return (
        EngineDescriptor(
            root=snapshot_source.engine_root,
            validator=snapshot_source.validator,
            pack_sha256=pack_sha256,
            source=source_label,
            document_type=document_type,
            template_id=template_id,
            version=version,
            font_directories=source.font_directories,
        ),
        installed_at,
        created,
    )


def _workspace_links_path(data_directory: Path) -> Path:
    return data_directory / "template-engines" / WORKSPACE_LINKS_NAME


def _read_workspace_links(data_directory: Path) -> dict[str, dict[str, str]]:
    path = _workspace_links_path(data_directory)
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("schema_version") != "1.0" or not isinstance(
            payload.get("links"), dict
        ):
            raise ValueError
        links: dict[str, dict[str, str]] = {}
        for document_type, value in payload["links"].items():
            if document_type not in SUPPORTED_ENGINE_DOCUMENT_TYPES or not isinstance(
                value, dict
            ):
                raise ValueError
            source_directory = value.get("source_directory")
            if not isinstance(source_directory, str) or not Path(
                source_directory
            ).is_absolute():
                raise ValueError
            links[document_type] = {"source_directory": source_directory}
        return links
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise TemplateEngineError(
            "TEMPLATE_LINK_INVALID", "本地模板工程关联记录无效，请重新关联。"
        ) from exc


def _write_workspace_link(
    data_directory: Path, document_type: str, source_directory: Path
) -> None:
    engines_root = data_directory / "template-engines"
    prepare_private_directory(engines_root)
    links = _read_workspace_links(data_directory)
    links[document_type] = {"source_directory": str(source_directory.resolve())}
    path = _workspace_links_path(data_directory)
    staging = engines_root / f".{WORKSPACE_LINKS_NAME}.{uuid.uuid4().hex}.tmp"
    staging.write_bytes(canonical_json({"schema_version": "1.0", "links": links}))
    protect_private_file(staging)
    os.replace(staging, path)
    protect_private_file(path)


def _record_workspace_snapshot(
    workspace: Any,
    descriptor: EngineDescriptor,
    installed_at: str,
) -> None:
    manifest_path = descriptor.root / INSTALL_MANIFEST_NAME
    if not manifest_path.is_file():
        manifest_path = descriptor.root.parents[1] / INSTALL_MANIFEST_NAME
    metadata = {
        "schema_version": "1.0",
        "engine_version": descriptor.version,
        "pack_sha256": descriptor.pack_sha256,
        "redistribution": "local-only",
        "source_mode": "linked-workspace-snapshot",
    }
    with workspace.database.transaction(immediate=True) as connection:
        connection.execute(
            "UPDATE template_installations SET enabled = 0 WHERE template_id = ?",
            (descriptor.template_id,),
        )
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
                descriptor.template_id,
                descriptor.version,
                sha256_file(manifest_path),
                installed_at,
                str(descriptor.root),
                canonical_json(metadata).decode("utf-8"),
            ),
        )


def install_engine(
    workspace: Any,
    source_directory: str,
    document_type: str = "proposal",
) -> dict[str, Any]:
    if document_type not in SUPPORTED_ENGINE_DOCUMENT_TYPES:
        raise TemplateEngineError(
            "TEMPLATE_ENGINE_UNSUPPORTED", "当前文档类型没有可关联模板。"
        )
    data_directory = workspace.database.data_directory
    if workspace.is_temporary or data_directory is None:
        raise TemplateEngineError(
            "TEMPLATE_INSTALL_PERSISTENT_ONLY",
            "本地模板工程只能关联到持久工作区。",
        )
    selected = Path(source_directory).expanduser()
    previous = _read_workspace_links(data_directory).get(document_type)
    descriptor, installed_at, created = _snapshot_workspace_engine(
        data_directory,
        selected,
        document_type,
        source_label="linked-workspace",
    )
    _write_workspace_link(data_directory, document_type, selected)
    _record_workspace_snapshot(workspace, descriptor, installed_at)
    selected_path = str(selected.resolve())
    if previous is None:
        status = "linked"
    elif previous.get("source_directory") == selected_path and not created:
        status = "already_current"
    else:
        status = "updated"
    return {
        "status": status,
        "template_id": descriptor.template_id,
        "version": descriptor.version,
        "pack_sha256": descriptor.pack_sha256,
        "installed_at": installed_at,
        "source": descriptor.source,
    }
