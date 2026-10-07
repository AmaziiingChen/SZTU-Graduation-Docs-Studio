"""Install and resolve exact process-document rendering engines."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .docx_privacy import (
    DocxPrivacyError,
    LEGACY_LOCAL_PREVIEW_REDISTRIBUTION,
    PUBLIC_RELEASE_REDISTRIBUTION,
    RELEASE_DOCX_METADATA_POLICY,
    inspect_release_docx_metadata,
)
from .storage.database import utc_now
from .storage.paths import prepare_private_directory, protect_private_file
from .template_catalog import template_pack_root

ENGINE_VERSION = "0.3+5342c1e"
ENGINE_TEMPLATE_ID = "sztu.proposal.2026.local"
ENGINE_DIRECTORY_NAME = "proposal-0.3-5342c1e"
MIDTERM_ENGINE_VERSION = "0.3+66c968c"
MIDTERM_ENGINE_TEMPLATE_ID = "sztu.midterm.2026.local"
MIDTERM_ENGINE_DIRECTORY_NAME = "midterm-0.3-66c968c"
TASK_BOOK_ENGINE_VERSION = "0.2+66c968c"
TASK_BOOK_ENGINE_TEMPLATE_ID = "sztu.task-book.2026.local"
TASK_BOOK_ENGINE_DIRECTORY_NAME = "task-book-0.2-66c968c"
ASSESSMENT_DOCUMENT_TYPES = frozenset({"advisor_review", "reviewer_review", "defense_record", "grade_assessment"})
SUPPORTED_ENGINE_DOCUMENT_TYPES = frozenset({"proposal", "midterm", "task_book", "thesis"}) | ASSESSMENT_DOCUMENT_TYPES
INSTALL_MANIFEST_NAME = "install-manifest.json"
WORKSPACE_LINKS_NAME = "workspace-links.json"
WORKSPACE_SNAPSHOTS_DIRECTORY = "workspace-snapshots"
BUNDLED_ENGINES_ENVIRONMENT = "SZTU_DOCS_BUNDLED_ENGINES_DIR"
BUNDLED_ENGINES_MANIFEST_NAME = "bundle-manifest.json"
ENGINE_FILE_HASHES = {
    "word/render.py": "4e894ca023df69164723a998a6f2769869ac1a8e9d1a5602eb600b25fa27680a",
    "word/official-template.docx": "85b9ccc9d92e923fda81501a9f5abfd237fbc1c5021bafe449e51f044bfa5806",
    "latex/render.py": "e901df9528604b92ad9e224329f145bd921514e3043ebcd5b2ff318a64eb9e06",
    "latex/main.tex": "bb882d8ad60dffd86c3d25e11e52f310c56c72533abd0bdf9112e85f8e370eaa",
    "schema/proposal.schema.json": "5f1e91693aea33b50f30efe5caf50eb393640d4a4697a421676f094d9f4d0315",
}
MIDTERM_ENGINE_FILE_HASHES = {
    "templates/common/__init__.py": "b5cf6a625cd4c58cac3e8bd2636bafe769bfe6394784d9c7dbb758edec251e5c",
    "templates/common/python/__init__.py": "687b666c14d9378451c2474ddd7c9736eec9f29bf41e13a6d1702061808b13c0",
    "templates/common/python/content.py": "a36f6ff73af3a8edc8727f488ddacc19a49735f67581bcbf1a3007e94bddeda4",
    "templates/common/python/font_files.py": "fe11a76d2033d1a1ae670616183c0f870cf6cd58e76ed8fa1a0a064495f86c74",
    "templates/common/python/outline_numbering.py": "d240b198a61cd1ce439c0ecf8686228a391926bd54b552917a202fdb41e9f6ec",
    "templates/common/python/typography.py": "864e8743cdde4a88b7bc4e0345c981e8fab3fc0d38933eb8fd90568a91858650",
    "templates/common/schema/content-block.schema.json": "60eced9ef46618174cd6070a904d6999b1c436dcad19ade785309d346255a9a7",
    "templates/common/typography/chinese-sizes.json": "46ec813ebc86f8a0b5fa0e2fc19c9e6b1e59519b7a03a53ed676f7126f0c8cc2",
    "templates/common/typography/font-policy-2026.json": "dcebfe802d687d94865972d04fa9b0581c121d22f2f46a3a31121be47e2c30f8",
    "templates/midterm/latex/main.tex": "4f5421c0f95e2efc5b183791c8ee617e7ca411ffe1f7d99c2f464ca5a5afc6c0",
    "templates/midterm/latex/render.py": "33de1a7b2a9f2fdac4ca8d7f462f3a058136b45635c01b177683a2efeb54a83a",
    "templates/midterm/schema/midterm.schema.json": "46fb159387e7312e7b955f75b109d4cb661e60f376521d9f0b736a1aade274a6",
    "templates/midterm/spec/layout.json": "f04e2a50c572747293451f469ad73ef7b329c6c6f4cf42bea6c4b5171b140bd3",
    "templates/midterm/word/official-template.docx": "5411d1471ba1a30def0b8c945a11674cce4616a6b3c0d3a8953e3f45b88af1a2",
    "templates/midterm/word/render.py": "19a445df4daa622178c86474a58f62079e39b4e29c29dc695045e71c2f369aab",
}
TASK_BOOK_ENGINE_FILE_HASHES = {
    "templates/common/__init__.py": "b5cf6a625cd4c58cac3e8bd2636bafe769bfe6394784d9c7dbb758edec251e5c",
    "templates/common/python/__init__.py": "687b666c14d9378451c2474ddd7c9736eec9f29bf41e13a6d1702061808b13c0",
    "templates/common/python/content.py": "a36f6ff73af3a8edc8727f488ddacc19a49735f67581bcbf1a3007e94bddeda4",
    "templates/common/python/font_files.py": "fe11a76d2033d1a1ae670616183c0f870cf6cd58e76ed8fa1a0a064495f86c74",
    "templates/common/python/typography.py": "864e8743cdde4a88b7bc4e0345c981e8fab3fc0d38933eb8fd90568a91858650",
    "templates/common/schema/content-block.schema.json": "60eced9ef46618174cd6070a904d6999b1c436dcad19ade785309d346255a9a7",
    "templates/common/typography/chinese-sizes.json": "46ec813ebc86f8a0b5fa0e2fc19c9e6b1e59519b7a03a53ed676f7126f0c8cc2",
    "templates/common/typography/font-policy-2026.json": "dcebfe802d687d94865972d04fa9b0581c121d22f2f46a3a31121be47e2c30f8",
    "templates/task-book/render.py": "16594594f5cabdb24845a5723ba26eea837ab2c5e91618b3ca4720e15769b40b",
    "templates/task-book/python/__init__.py": "a0f9d99aadb8bae63368ba16ff1c51a917e97011eafb938bbf31182b2c080e20",
    "templates/task-book/python/model.py": "95895e3ce62fa18f17aa93a26ad2f9780b14597ded7b31c79256d65268bd654d",
    "templates/task-book/latex/main.tex": "f6fffdc1ec647a47f872bd67511cf4f401372768313ad8cdc4307739c7e5464d",
    "templates/task-book/latex/render.py": "776d4178ad8cd3d69c6a67f38e286040a941a0ea4c1167fe483483cc30748b69",
    "templates/task-book/schema/task-book.schema.json": "16cfd7b8071c7164e356663fd4c5239cb10c4a738414a72882017129d1582ae4",
    "templates/task-book/spec/fixed-content.json": "555f81cbfe0b654ce609bc3ba20b95ade6676d7159f4e991b991665f6b6e92c2",
    "templates/task-book/spec/layout.json": "44779a67bf024ec0ab4bcaac8987376412bedb2f1fb4ce1103ff3b06a373cfed",
    "templates/task-book/word/official-template.docx": "dd5cdeb1c96d0a617fe03095483dc5f4cbd96a12772d55e940c120978a6104d2",
    "templates/task-book/word/render.py": "5f3dcec4a6331926830c78061c37765b23b3fade14995ec7204bbf65b03b6320",
}
WORKSPACE_SHARED_SUPPORT_FILE_NAMES = (
    "templates/common/python/list_layout.py",
    "templates/common/latex/sztu-process-form.tex",
    "templates/common/python/equation.py",
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
THESIS_WORKSPACE_FILE_NAMES = (
    "SZTUthesis.cls",
    "sztuthesis_main.tex",
    "gbt7714.sty",
    "gbt7714-numerical.bst",
    "STXingkai.ttf",
    "STXinwei.ttf",
    "STZhongsong.ttf",
    "images/school_title.pdf",
    "scripts/check_fonts.py",
    "templates/common/__init__.py",
    "templates/common/python/__init__.py",
    "templates/common/python/font_files.py",
    "templates/common/python/typography.py",
    "templates/common/typography/font-policy-2026.json",
    "templates/thesis/latex/render.py",
    "templates/thesis/spec/layout.json",
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
            "开题报告模板位置无效，请重新选择模板文件夹。",
        )
    root = root.resolve()
    combined = hashlib.sha256()
    for relative_name, expected_hash in sorted(ENGINE_FILE_HASHES.items()):
        try:
            path = _require_plain_descendant(root, root / relative_name)
        except TemplateEngineError as exc:
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_INVALID",
                "开题报告模板包含无法使用的文件链接，请重新选择模板。",
                {"file": relative_name},
            ) from exc
        if not path.is_file():
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_INVALID",
                "开题报告模板文件不完整，请重新选择模板。",
                {"file": relative_name},
            )
        actual_hash = sha256_file(path)
        if actual_hash != expected_hash:
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_HASH_MISMATCH",
                "开题报告模板完整性校验失败，请重新选择模板。",
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
            "中文字形检查组件缺失，请重新安装应用。",
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
            "中期检查模板位置无效，请重新选择模板文件夹。",
        )
    bundle_root = bundle_root.resolve()
    combined = hashlib.sha256()
    for relative_name, expected_hash in sorted(MIDTERM_ENGINE_FILE_HASHES.items()):
        try:
            path = _require_plain_descendant(bundle_root, bundle_root / relative_name)
        except TemplateEngineError as exc:
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_INVALID",
                "中期检查模板包含无法使用的文件链接，请重新选择模板。",
                {"file": relative_name},
            ) from exc
        if not path.is_file():
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_INVALID",
                "中期检查模板文件不完整，请重新选择模板。",
                {"file": relative_name},
            )
        actual_hash = sha256_file(path)
        if actual_hash != expected_hash:
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_HASH_MISMATCH",
                "中期检查模板完整性校验失败，请重新选择模板。",
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
            "中文字形检查组件缺失，请重新安装应用。",
        ) from exc
    if not selected_validator.is_file() or sha256_file(selected_validator) != VALIDATOR_SHA256:
        raise TemplateEngineError(
            "TEMPLATE_ENGINE_HASH_MISMATCH",
            "中文字形检查组件校验失败，请重新安装应用。",
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
            "任务书模板位置无效，请重新选择模板文件夹。",
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
                "任务书模板包含无法使用的文件链接，请重新选择模板。",
                {"file": relative_name},
            ) from exc
        if not candidate.is_file():
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_INVALID",
                "任务书模板文件不完整，请重新选择模板。",
                {"file": relative_name},
            )
        actual_hash = sha256_file(candidate)
        if actual_hash != expected_hash:
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_HASH_MISMATCH",
                "任务书模板完整性校验失败，请重新选择模板。",
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
            "中文字形检查组件缺失，请重新安装应用。",
        ) from exc
    if not selected_validator.is_file() or sha256_file(selected_validator) != VALIDATOR_SHA256:
        raise TemplateEngineError(
            "TEMPLATE_ENGINE_HASH_MISMATCH",
            "中文字形检查组件校验失败，请重新安装应用。",
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
        "thesis": "thesis-workspace",
        **{kind: f"{kind}-workspace" for kind in ASSESSMENT_DOCUMENT_TYPES},
    }[document_type]
    return data_directory / "template-engines" / directory_name


def resolve_engine(document_type: str = "proposal") -> EngineDescriptor:
    if document_type not in SUPPORTED_ENGINE_DOCUMENT_TYPES:
        raise TemplateEngineError("TEMPLATE_ENGINE_UNSUPPORTED", "当前文档类型暂无可用模板。")

    data_dir_value = os.environ.get("SZTU_DOCS_DATA_DIR")
    data_directory = (
        Path(data_dir_value).expanduser().resolve() if data_dir_value else None
    )
    configured_name = {
        "proposal": "SZTU_DOCS_PROPOSAL_ENGINE_DIR",
        "midterm": "SZTU_DOCS_MIDTERM_ENGINE_DIR",
        "task_book": "SZTU_DOCS_TASK_BOOK_ENGINE_DIR",
        "thesis": "SZTU_DOCS_THESIS_ENGINE_DIR",
        **{kind: f"SZTU_DOCS_{kind.upper()}_ENGINE_DIR" for kind in ASSESSMENT_DOCUMENT_TYPES},
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

        bundled_root = os.environ.get(BUNDLED_ENGINES_ENVIRONMENT)
        if bundled_root:
            return _resolve_bundled_engine(Path(bundled_root), document_type)

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
            if document_type == "thesis" or document_type in ASSESSMENT_DOCUMENT_TYPES:
                return _snapshot_workspace_engine(
                    data_directory, installed, document_type,
                    source_label="installed-workspace",
                )[0]
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
        if document_type == "thesis" or document_type in ASSESSMENT_DOCUMENT_TYPES:
            raise TemplateEngineError(
                "TEMPLATE_ENGINE_UNAVAILABLE",
                "毕业论文模板需要持久工作区，请先关联本地 Thesis 工程。",
            )
        return verify_task_book_engine(
            selected,
            validator=selected / "scripts" / "validate_cjk_render.py",
            source="environment",
        )

    raise TemplateEngineError(
        "TEMPLATE_ENGINE_UNAVAILABLE",
        "未找到可用模板，请安装或重新选择模板后再导出。",
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
    elif document_type in ASSESSMENT_DOCUMENT_TYPES:
        if not selected.is_absolute() or selected.is_symlink() or not selected.is_dir():
            raise TemplateEngineError("TEMPLATE_SOURCE_INVALID", "请选择有效的本地模板工程目录。")
        selection_root = selected.resolve()
        slug = document_type.replace("_", "-")
        prefix = f"templates/{slug}"
        engine_root = _require_plain_descendant(selection_root, selection_root / prefix)
        validator = _require_plain_descendant(selection_root, selection_root / "scripts/validate_cjk_render.py")
        names = {
            *WORKSPACE_COMMON_FILE_NAMES,
            "templates/common/python/list_layout.py",
            "templates/common/python/assessment_forms.py",
            "templates/common/python/assessment_word.py",
            "templates/common/python/assessment_latex.py",
            "templates/common/schema/writing-guidance.schema.json",
            f"{prefix}/python/__init__.py",
            f"{prefix}/python/model.py",
            f"{prefix}/word/render.py",
            f"{prefix}/word/official-template.docx",
            f"{prefix}/latex/render.py",
            f"{prefix}/schema/{slug}.schema.json",
            f"{prefix}/spec/artifact.md",
            f"{prefix}/spec/layout.json",
        }
        files = tuple((name, selection_root / name) for name in sorted(names))
    elif document_type == "thesis":
        if not selected.is_absolute() or selected.is_symlink() or not selected.is_dir():
            raise TemplateEngineError("TEMPLATE_SOURCE_INVALID", "请选择有效的毕业论文模板工程目录。")
        selection_root = selected.resolve()
        engine_root = _require_plain_descendant(
            selection_root, selection_root / "templates" / "thesis"
        )
        validator = _require_plain_descendant(
            selection_root, selection_root / "scripts" / "validate_cjk_render.py"
        )
        files = tuple((name, selection_root / name) for name in THESIS_WORKSPACE_FILE_NAMES)
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
        if source.document_type in ASSESSMENT_DOCUMENT_TYPES and candidate.name == "official-template.docx" and not candidate.exists():
            raise TemplateEngineError(
                "TEMPLATE_OFFICIAL_MASTER_MISSING",
                "评审模板缺少官方 Word 底稿，请补齐 word/official-template.docx 后重新关联模板工程。",
            )
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
    elif document_type in ASSESSMENT_DOCUMENT_TYPES:
        template_id = f"sztu.{document_type.replace('_', '-')}.2026.local"
        base_version = "0.1"
    elif document_type == "thesis":
        template_id = "sztu.thesis.2026.local"
        base_version = "0.1"
    else:
        template_id = TASK_BOOK_ENGINE_TEMPLATE_ID
        base_version = TASK_BOOK_ENGINE_VERSION.split("+", 1)[0]
    return template_id, f"{base_version}+workspace.{pack_sha256[:12]}"


def _resolve_bundled_engine(
    bundled_root: Path, document_type: str
) -> EngineDescriptor:
    """Verify and use one immutable engine staged inside a desktop bundle."""

    if (
        not bundled_root.is_absolute()
        or bundled_root.is_symlink()
        or not bundled_root.is_dir()
    ):
        raise TemplateEngineError(
            "TEMPLATE_BUNDLE_INVALID", "随附模板位置无效，请重新安装应用。"
        )
    bundled_root = bundled_root.resolve()
    engine_bundle = _require_plain_descendant(
        bundled_root, bundled_root / document_type
    )
    manifest_path = _require_plain_descendant(
        bundled_root, bundled_root / BUNDLED_ENGINES_MANIFEST_NAME
    )
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        entry = manifest["engines"][document_type]
        redistribution = manifest.get("redistribution")
        if (
            manifest.get("schema_version") != "1.0"
            or redistribution
            not in {
                LEGACY_LOCAL_PREVIEW_REDISTRIBUTION,
                PUBLIC_RELEASE_REDISTRIBUTION,
            }
            or not isinstance(entry, dict)
        ):
            raise ValueError
    except (
        OSError,
        UnicodeDecodeError,
        json.JSONDecodeError,
        KeyError,
        TypeError,
        ValueError,
    ) as exc:
        raise TemplateEngineError(
            "TEMPLATE_BUNDLE_INVALID", "随附模板信息损坏，请重新安装应用。"
        ) from exc

    source = _workspace_source(engine_bundle, document_type)
    if redistribution == PUBLIC_RELEASE_REDISTRIBUTION:
        scrubbed_templates = sorted(
            relative_name
            for relative_name, _candidate in source.files
            if relative_name.endswith("/word/official-template.docx")
            or relative_name == "word/official-template.docx"
        )
        if (
            manifest.get("docx_metadata_policy") != RELEASE_DOCX_METADATA_POLICY
            or entry.get("metadata_scrubbed_files") != scrubbed_templates
            or len(scrubbed_templates) != 1
        ):
            raise TemplateEngineError(
                "TEMPLATE_BUNDLE_METADATA_INVALID",
                "安装包内的模板隐私清单无效，已停止执行。",
            )
        try:
            findings = inspect_release_docx_metadata(
                engine_bundle / scrubbed_templates[0]
            )
        except DocxPrivacyError as exc:
            raise TemplateEngineError(
                "TEMPLATE_BUNDLE_METADATA_INVALID",
                "安装包内的模板元数据无法验证，已停止执行。",
            ) from exc
        if findings:
            raise TemplateEngineError(
                "TEMPLATE_BUNDLE_METADATA_INVALID",
                "安装包内的模板仍含发布前必须清理的元数据，已停止执行。",
                {"findings": list(findings)},
            )
    pack_sha256 = _workspace_pack_sha256(source)
    template_id, version = _workspace_identity(document_type, pack_sha256)
    if (
        entry.get("template_id") != template_id
        or entry.get("version") != version
        or entry.get("pack_sha256") != pack_sha256
    ):
        raise TemplateEngineError(
            "TEMPLATE_BUNDLE_HASH_MISMATCH",
            "随附模板损坏或不完整，请重新安装应用。",
        )
    return EngineDescriptor(
        root=source.engine_root,
        validator=source.validator,
        pack_sha256=pack_sha256,
        source="bundled",
        document_type=document_type,
        template_id=template_id,
        version=version,
        font_directories=(),
    )


def _workspace_snapshot_directory_name(
    document_type: str,
    version: str,
    pack_sha256: str,
) -> str:
    """Keep immutable snapshots distinct when the engine base version changes."""
    base_version = version.split("+", 1)[0]
    safe_version = re.sub(r"[^0-9A-Za-z._-]+", "-", base_version).strip("._-")
    if not safe_version:
        raise TemplateEngineError(
            "TEMPLATE_ENGINE_INVALID",
            "模板版本无法识别，请重新选择模板。",
        )
    return f"{document_type}-{safe_version}-{pack_sha256}"


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
    destination = snapshots_root / _workspace_snapshot_directory_name(
        document_type,
        version,
        pack_sha256,
    )
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
                    "模板校验失败，请重新选择模板后导出。",
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
            "模板校验失败，请重新选择模板后导出。",
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
            "TEMPLATE_SNAPSHOT_INVALID", "模板信息损坏，请重新选择模板后导出。"
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
