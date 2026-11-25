"""Deterministic process-document export orchestration for the local workbench."""

from __future__ import annotations

import hashlib
import json
import math
import os
import platform
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from .diagnostic_steps import checkpoint, emitter, failure_reason, step, traced
from .full_diagnostics import capture_workspace, current_case, record_exception, record_input
from .bibtex_gate import BibtexValidationError, count_valid_bibtex_entries
from .storage.database import utc_now
from .storage.paths import protect_private_file
from .storage.services.common import encode_json, new_id
from .storage.services.exports import (
    complete_job_row,
    fail_job_row,
    insert_artifact_rows,
    insert_job_row,
)
from .template_engine import (
    ASSESSMENT_DOCUMENT_TYPES,
    EngineDescriptor,
    TemplateEngineError,
    canonical_json,
    resolve_engine as _resolve_engine,
    sha256_file,
)
from .tool_output import decode_tool_output
from .version import BACKEND_VERSION
from .runtime_paths import (
    bundled_tool_root,
    offline_tex_environment,
    portable_tex_root,
    windows_process_environment,
    windows_tool_path,
)

SUPPORTED_FORMATS = ("docx", "pdf", "tex")
DOCUMENT_OUTPUT_LABELS = {
    "proposal": "开题报告",
    "midterm": "中期检查表",
    "task_book": "任务书",
    "thesis": "毕业论文",
    "advisor_review": "指导教师评审表",
    "reviewer_review": "评阅人评审表",
    "defense_record": "答辩记录表",
    "grade_assessment": "成绩考核表",
}
OUTPUT_FORMAT_SUFFIXES = {
    "docx": ".docx",
    "pdf": ".pdf",
    "tex": "-LaTeX.zip",
}
UNSAFE_FILENAME_PATTERN = re.compile(r'[\x00-\x1f<>:"/\\|?*]+')
MAX_EXPORT_TITLE_BYTES = 160
RENDER_TIMEOUT_SECONDS = 180
PREVIEW_CACHE_SCHEMA_VERSION = "1.0"
PREVIEW_RENDER_DPI = 240
ADVISOR_TITLE_PATTERN = re.compile(r"(老师|教授|副教授|讲师|博士|导师)\s*$")
TASK_BOOK_ADVISOR_TITLE_PATTERN = re.compile(
    r"(?:老师|导师|教授|副教授|讲师|研究员|副研究员|工程师|高级工程师|博士|硕士)"
    r"(?:\s*[）)])?\s*$"
)
TASK_BOOK_CHECKBOX_FONT_FILENAMES = (
    "Wingdings 2.ttf",
    "Wingdings2.ttf",
    "Wingdng2.ttf",
)
PROPOSAL_TITLE_DISPLAY_WIDTH_LIMIT = 64.0
MIDTERM_OUTLINE_STYLE_DEPTHS = {
    "chinese_hierarchy": 4,
    "chapter_hierarchy": 5,
    "chapter_section_hierarchy": 6,
    "part_chapter_section_hierarchy": 6,
    "decimal_hierarchy": 6,
}
FIGURE_ID_PATTERN = re.compile(r"fig-[A-Za-z0-9_-]{8,96}")
FIGURE_REFERENCE_PATTERN = re.compile(r"\{\{fig:(fig-[A-Za-z0-9_-]{8,96})\}\}")
FIGURE_SOURCE_KEY_PATTERN = re.compile(r"[A-Za-z0-9_:.+/-]{1,200}")
DRAFT_PARAGRAPH_SECTION_NAMES = {
    **{kind: {"comments", "division_of_work"} for kind in ASSESSMENT_DOCUMENT_TYPES},
    "proposal": {
        "significance_and_status",
        "research_content",
        "methods_and_means",
        "research_steps",
        "references",
    },
    "midterm": {"main_research_content", "progress"},
    "task_book": {
        "basic_content_and_requirements",
        "required_materials",
        "references",
    },
}


class ExportError(Exception):
    """Stable, sanitized export failure."""

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


def _truncate_utf8(value: str, maximum_bytes: int) -> str:
    encoded = value.encode("utf-8")
    if len(encoded) <= maximum_bytes:
        return value
    return encoded[:maximum_bytes].decode("utf-8", errors="ignore").rstrip()


def _safe_export_title(value: Any) -> str:
    title = value if isinstance(value, str) else ""
    title = UNSAFE_FILENAME_PATTERN.sub("-", title)
    title = re.sub(r"\s+", " ", title).strip(" .-")
    title = _truncate_utf8(title, MAX_EXPORT_TITLE_BYTES).strip(" .-")
    # Keep names portable when a macOS-created draft is later exported on Windows.
    if re.fullmatch(r"CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³]", title.split(".", 1)[0].rstrip().upper()):
        title = "_" + title
    return title or "未命名文档"


def _output_filenames(
    record: dict[str, Any],
    formats: list[str],
    *,
    version: int = 1,
) -> dict[str, str]:
    # The saved title already owns the document name, including any type label.
    stem = _safe_export_title(record.get("title"))
    version_suffix = "" if version == 1 else f"-{version}"
    return {
        format_name: f"{stem}{version_suffix}{OUTPUT_FORMAT_SUFFIXES[format_name]}"
        for format_name in formats
    }


def _allocate_output_filenames(
    output: Path,
    record: dict[str, Any],
    formats: list[str],
) -> tuple[dict[str, str], int]:
    version = 1
    while True:
        filenames = _output_filenames(record, formats, version=version)
        targets = [output / filenames[format_name] for format_name in formats]
        if not any(target.exists() or target.is_symlink() for target in targets):
            return filenames, version
        version += 1


@traced("template")
def resolve_engine(document_type: str = "proposal") -> EngineDescriptor:
    try:
        descriptor = _resolve_engine(document_type)
        case = current_case.get()
        if case is not None:
            case.json(f"template-{document_type}.json", vars(descriptor))
            from .template_engine import _workspace_source

            if descriptor.root.parent.name == "templates":
                selected = descriptor.root.parent.parent
            else:
                selected = descriptor.root
            try:
                source = _workspace_source(selected, document_type)
                for name, candidate in source.files:
                    case.file(f"templates/{document_type}/{name}", candidate)
            except (TemplateEngineError, OSError):
                case.missing.append(f"{document_type}: 无法取得已验证的模板文件清单")
            case.file(f"templates/validation/{document_type}/{descriptor.validator.name}", descriptor.validator)
        return descriptor
    except TemplateEngineError as exc:
        raise ExportError(exc.code, exc.message, exc.details) from exc


def _preview_cache_identity(
    document_id: str,
    input_sha256: str,
    template_sha256: str,
) -> tuple[str, str]:
    cache_key = hashlib.sha256(
        canonical_json(
            {
                "schema_version": PREVIEW_CACHE_SCHEMA_VERSION,
                "backend_version": BACKEND_VERSION,
                "document_id": document_id,
                "input_sha256": input_sha256,
                "template_sha256": template_sha256,
                "render_dpi": PREVIEW_RENDER_DPI,
            }
        )
    ).hexdigest()
    preview_id = str(
        uuid.uuid5(uuid.NAMESPACE_URL, f"sztu-docs-preview:{cache_key}")
    )
    return cache_key, preview_id


def _require_text(
    value: Any,
    path: str,
    *,
    maximum: int,
) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "开题报告内容不完整，请补全必填项后重试。",
            {"field": path, "reason": "required"},
        )
    normalized = value.strip()
    if len(normalized) > maximum:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "开题报告内容超出字数限制，请调整后重试。",
            {"field": path, "reason": "too_long", "maximum": maximum},
        )
    return normalized


_MATH_TEXT = re.compile(r"[A-Za-z0-9αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΥΦΨΩ +\-−=×·/(),.\[\]<>≤≥%|:]+")


def _validate_math_expression(value: Any, path: str, *, depth: int = 1, count: list[int] | None = None) -> None:
    count = [0] if count is None else count
    count[0] += 1
    if depth > 8 or count[0] > 100 or not isinstance(value, dict):
        raise ExportError("DOCUMENT_NOT_READY", "公式结构过于复杂或无效。", {"field": path, "reason": "invalid_math"})
    kind = value.get("type")
    if kind == "text" and set(value) == {"type", "value"}:
        text = value["value"]
        if isinstance(text, str) and 0 < len(text) <= 100 and text.strip() and _MATH_TEXT.fullmatch(text):
            return
    elif kind == "row" and set(value) == {"type", "items"}:
        items = value["items"]
        if isinstance(items, list) and 1 <= len(items) <= 50:
            for index, item in enumerate(items):
                _validate_math_expression(item, f"{path}.items[{index}]", depth=depth + 1, count=count)
            return
    else:
        fields = {"fraction": ("numerator", "denominator"), "subscript": ("base", "sub"), "superscript": ("base", "super"), "square_root": ("body",)}.get(kind)
        if fields and set(value) == {"type", *fields}:
            for field in fields:
                _validate_math_expression(value[field], f"{path}.{field}", depth=depth + 1, count=count)
            return
    raise ExportError("DOCUMENT_NOT_READY", "公式包含不支持的字符或结构。", {"field": path, "reason": "invalid_math"})


def _validate_equation(value: Any, path: str, *, inline: bool = False) -> None:
    allowed = {"type", "expression", "alt"} if inline else {"type", "expression", "alt", "id", "chapter"}
    expected = "inline_equation" if inline else "equation"
    if not isinstance(value, dict) or value.get("type") != expected or set(value) - allowed:
        raise ExportError("DOCUMENT_NOT_READY", "公式数据格式无效。", {"field": path, "reason": "invalid_equation"})
    _require_text(value.get("alt"), f"{path}.alt", maximum=500)
    _validate_math_expression(value.get("expression"), f"{path}.expression")
    if not inline:
        if "id" in value and (not isinstance(value["id"], str) or not re.fullmatch(r"eq-[A-Za-z0-9_-]{8,96}", value["id"])):
            raise ExportError("DOCUMENT_NOT_READY", "公式编号标识无效。", {"field": f"{path}.id", "reason": "invalid_id"})
        chapter = value.get("chapter", 1)
        if isinstance(chapter, bool) or not isinstance(chapter, int) or not 1 <= chapter <= 99:
            raise ExportError("DOCUMENT_NOT_READY", "公式章节无效。", {"field": f"{path}.chapter", "reason": "invalid_chapter"})


def _reject_unresolved_math_source(text: str, path: str) -> None:
    for index, character in enumerate(text):
        if character != "$":
            continue
        slashes = 0
        previous = index - 1
        while previous >= 0 and text[previous] == "\\":
            slashes += 1
            previous -= 1
        if slashes % 2 == 0:
            raise ExportError(
                "DOCUMENT_NOT_READY",
                "正文中还有未完成或不支持的公式，请检查 $...$ / $$...$$ 写法。",
                {"field": path, "reason": "unresolved_math_source"},
            )


def _validate_paragraph(value: Any, path: str, maximum: int, *, allow_inline_equations: bool = False) -> None:
    if isinstance(value, str):
        _require_text(value, path, maximum=maximum)
        if allow_inline_equations:
            _reject_unresolved_math_source(value, path)
        return
    if (
        not isinstance(value, dict)
        or set(value) - {"type", "runs"}
        or value.get("type", "paragraph") != "paragraph"
        or "runs" not in value
    ):
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "开题报告段落格式无效。",
            {"field": path, "reason": "invalid_paragraph"},
        )
    runs = value.get("runs")
    if not isinstance(runs, list) or not 1 <= len(runs) <= 100:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "开题报告富文本段落格式无效。",
            {"field": f"{path}.runs", "reason": "invalid_items"},
        )
    total = 0
    for index, run in enumerate(runs):
        run_path = f"{path}.runs[{index}]"
        if allow_inline_equations and isinstance(run, dict) and run.get("type") == "inline_equation":
            _validate_equation(run, run_path, inline=True)
            total += len(run["alt"])
            continue
        if not isinstance(run, dict) or set(run) - {"text", "script", "italic", "bold"}:
            raise ExportError(
                "DOCUMENT_NOT_READY",
                "开题报告的文字格式有误，请检查后重试。",
                {"field": run_path, "reason": "unsupported_field"},
            )
        text = _require_text(run.get("text"), f"{run_path}.text", maximum=maximum)
        if allow_inline_equations:
            _reject_unresolved_math_source(text, f"{run_path}.text")
        total += len(text)
        if run.get("script", "normal") not in {"normal", "sub", "super"}:
            raise ExportError(
                "DOCUMENT_NOT_READY",
                "上下标格式无效。",
                {"field": f"{run_path}.script", "reason": "unsupported"},
            )
        if not isinstance(run.get("italic", False), bool) or not isinstance(
            run.get("bold", False), bool
        ):
            raise ExportError(
                "DOCUMENT_NOT_READY",
                "富文本样式格式无效。",
                {"field": run_path, "reason": "must_be_boolean"},
            )
    if total > maximum:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "开题报告段落超过允许长度。",
            {"field": path, "reason": "too_long", "maximum": maximum},
        )


def _validate_proposal_content_paragraph(
    value: Any,
    path: str,
    maximum: int,
) -> None:
    """Accept the common paragraph shape without changing legacy proposal fields."""

    if isinstance(value, str):
        _validate_paragraph(value, path, maximum, allow_inline_equations=True)
        return
    if (
        not isinstance(value, dict)
        or set(value) - {"type", "runs"}
        or value.get("type", "paragraph") != "paragraph"
        or "runs" not in value
    ):
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "开题报告正文段落格式无效。",
            {"field": path, "reason": "invalid_paragraph"},
        )
    _validate_paragraph({"runs": value.get("runs")}, path, maximum, allow_inline_equations=True)


def _validate_list_block(
    value: Any,
    path: str,
    maximum: int,
    paragraph_validator: Callable[[Any, str, int], None],
    *,
    document_name: str,
    depth: int = 1,
) -> None:
    """Validate an explicit list tree whose structure is the semantic hierarchy."""

    if not isinstance(value, dict) or set(value) != {"type", "items"}:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            f"{document_name}列表格式无效。",
            {"field": path, "reason": "invalid_list"},
        )
    list_type = value.get("type")
    if list_type not in {"ordered_list", "unordered_list"}:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            f"{document_name}列表类型无效。",
            {"field": f"{path}.type", "reason": "unsupported_list_type"},
        )
    items = value.get("items")
    if not isinstance(items, list) or not 1 <= len(items) <= 100:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            f"{document_name}列表至少需要一个条目。",
            {"field": f"{path}.items", "reason": "invalid_items"},
        )
    for item_index, item in enumerate(items):
        item_path = f"{path}.items[{item_index}]"
        allowed_fields = (
            {"marker", "content", "children"}
            if list_type == "ordered_list"
            else {"content", "children"}
        )
        if (
            not isinstance(item, dict)
            or set(item) - allowed_fields
            or "content" not in item
        ):
            reason = (
                "marker_forbidden"
                if isinstance(item, dict)
                and list_type == "unordered_list"
                and "marker" in item
                else "invalid_item"
            )
            field = f"{item_path}.marker" if reason == "marker_forbidden" else item_path
            raise ExportError(
                "DOCUMENT_NOT_READY",
                f"{document_name}列表条目格式无效。",
                {"field": field, "reason": reason},
            )
        marker = item.get("marker")
        if marker is not None and (
            not isinstance(marker, str)
            or not marker.strip()
            or len(marker) > 20
        ):
            raise ExportError(
                "DOCUMENT_NOT_READY",
                f"{document_name}列表编号格式无效。",
                {"field": f"{item_path}.marker", "reason": "invalid_marker"},
            )
        paragraph_validator(item.get("content"), f"{item_path}.content", maximum)
        if "children" not in item:
            continue
        if depth >= 4:
            raise ExportError(
                "DOCUMENT_NOT_READY",
                f"{document_name}列表最多支持四级。",
                {
                    "field": f"{item_path}.children",
                    "reason": "list_depth_exceeded",
                    "maximum": 4,
                },
            )
        _validate_list_block(
            item.get("children"),
            f"{item_path}.children",
            maximum,
            paragraph_validator,
            document_name=document_name,
            depth=depth + 1,
        )


def _validate_image_block(
    value: Any,
    path: str,
    maximum: int,
    paragraph_validator: Callable[[Any, str, int], None],
    *,
    document_name: str,
) -> None:
    if (
        not isinstance(value, dict)
        or set(value)
        - {
            "type",
            "id",
            "path",
            "alt",
            "chapter",
            "width_mm",
            "caption",
            "source_citation_key",
        }
        or not {"type", "path", "alt"} <= set(value)
        or value.get("type") != "image"
    ):
        raise ExportError(
            "DOCUMENT_NOT_READY",
            f"{document_name}图片内容块格式无效。",
            {"field": path, "reason": "invalid_block"},
        )
    figure_id = value.get("id")
    if figure_id is not None and (
        not isinstance(figure_id, str)
        or FIGURE_ID_PATTERN.fullmatch(figure_id) is None
    ):
        raise ExportError(
            "DOCUMENT_NOT_READY",
            f"{document_name}图片标识格式无效。",
            {"field": f"{path}.id", "reason": "invalid_figure_id"},
        )
    _require_text(value.get("path"), f"{path}.path", maximum=1000)
    _require_text(value.get("alt"), f"{path}.alt", maximum=500)
    chapter = value.get("chapter", 1)
    if (
        isinstance(chapter, bool)
        or not isinstance(chapter, int)
        or not 1 <= chapter <= 99
    ):
        raise ExportError(
            "DOCUMENT_NOT_READY",
            f"{document_name}图片章节编号必须在 1 至 99 之间。",
            {"field": f"{path}.chapter", "reason": "invalid_number"},
        )
    width = value.get("width_mm", 120.0)
    if (
        isinstance(width, bool)
        or not isinstance(width, (int, float))
        or not 20 <= float(width) <= 146
    ):
        raise ExportError(
            "DOCUMENT_NOT_READY",
            f"{document_name}图片宽度必须在 20 至 146 毫米之间。",
            {"field": f"{path}.width_mm", "reason": "invalid_number"},
        )
    if figure_id is not None and value.get("caption") is None:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            f"{document_name}可引用图片必须填写题注。",
            {"field": f"{path}.caption", "reason": "missing_caption"},
        )
    if value.get("caption") is not None:
        paragraph_validator(value.get("caption"), f"{path}.caption", maximum)
    source_key = value.get("source_citation_key")
    if source_key is not None and (
        not isinstance(source_key, str)
        or FIGURE_SOURCE_KEY_PATTERN.fullmatch(source_key) is None
    ):
        raise ExportError(
            "DOCUMENT_NOT_READY",
            f"{document_name}图片来源引用键格式无效。",
            {
                "field": f"{path}.source_citation_key",
                "reason": "invalid_source_citation_key",
            },
        )


def _validate_proposal_text_block(value: Any, path: str) -> None:
    if not isinstance(value, dict) or value.get("type", "paragraph") == "paragraph":
        _validate_proposal_content_paragraph(value, path, 5000)
        return
    if value.get("type") in {"ordered_list", "unordered_list"}:
        _validate_list_block(
            value,
            path,
            5000,
            _validate_proposal_content_paragraph,
            document_name="开题报告",
        )
        return
    if value.get("type") == "image":
        _validate_image_block(
            value,
            path,
            5000,
            _validate_proposal_content_paragraph,
            document_name="开题报告",
        )
        return
    if value.get("type") == "equation":
        _validate_equation(value, path)
        return
    raise ExportError(
        "DOCUMENT_NOT_READY",
        "开题报告正文只支持段落、有序列表、无序列表和本地图片。",
        {"field": path, "reason": "unsupported_block"},
    )


def validate_proposal(document: Any) -> dict[str, Any]:
    if not isinstance(document, dict) or set(document) != {
        "schema_version",
        "metadata",
        "sections",
    }:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "开题报告数据结构不完整。",
            {"field": "root", "reason": "invalid_shape"},
        )
    if document.get("schema_version") != "0.2":
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "开题报告数据版本不受支持。",
            {"field": "schema_version", "reason": "unsupported"},
        )

    metadata = document.get("metadata")
    metadata_limits = {
        "title": 80,
        "student_name": 20,
        "student_id": 30,
        "major": 40,
        "college": 50,
        "advisor": 30,
    }
    if not isinstance(metadata, dict) or set(metadata) != set(metadata_limits):
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "开题报告基本信息不完整。",
            {"field": "metadata", "reason": "invalid_shape"},
        )
    _validate_proposal_content_paragraph(metadata.get("title"), "metadata.title", 80)
    title_text = _paragraph_text(metadata.get("title"))
    title_width = sum(0.5 if ord(character) < 128 else 1.0 for character in title_text)
    if title_width > PROPOSAL_TITLE_DISPLAY_WIDTH_LIMIT:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "开题报告题目超过当前官方题目栏可容纳长度。",
            {
                "field": "metadata.title",
                "reason": "display_width_exceeded",
                "maximum": PROPOSAL_TITLE_DISPLAY_WIDTH_LIMIT,
            },
        )
    clean_metadata = {
        key: _require_text(metadata.get(key), f"metadata.{key}", maximum=maximum)
        for key, maximum in metadata_limits.items()
        if key != "title"
    }
    if ADVISOR_TITLE_PATTERN.search(clean_metadata["advisor"]):
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "“指导教师”仅填写姓名，职称请填写至“指导教师职称”。",
            {"field": "metadata.advisor", "reason": "name_only"},
        )

    sections = document.get("sections")
    section_names = {
        "significance_and_status",
        "research_content",
        "methods_and_means",
        "research_steps",
        "references",
    }
    intro_names = {
        "research_content_intro",
        "methods_and_means_intro",
        "research_steps_intro",
    }
    if not isinstance(sections, dict) or not section_names <= set(sections) or set(sections) - section_names - intro_names:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "开题报告正文结构不完整。",
            {"field": "sections", "reason": "invalid_shape"},
        )
    for name in intro_names:
        intro = sections.get(name, "")
        if not isinstance(intro, str) or len(intro) > 200 or "\n" in intro or "\r" in intro:
            raise ExportError(
                "DOCUMENT_NOT_READY",
                "开题报告引导句应为不超过 200 字的单行文字。",
                {"field": f"sections.{name}", "reason": "invalid_intro"},
            )
    structured_section_names = {
        "research_content",
        "methods_and_means",
        "research_steps",
    }
    for name in sorted(section_names):
        items = sections.get(name)
        minimum = 2 if name == "significance_and_status" else 1
        if not isinstance(items, list) or not minimum <= len(items) <= 50:
            raise ExportError(
                "DOCUMENT_NOT_READY",
                "开题报告正文段落数量不符合要求。",
                {
                    "field": f"sections.{name}",
                    "reason": "invalid_items",
                    "minimum": minimum,
                    "maximum": 50,
                },
            )
        for index, block in enumerate(items):
            block_path = f"sections.{name}[{index}]"
            if name in structured_section_names:
                _validate_proposal_text_block(block, block_path)
            else:
                maximum = 1000 if name == "references" else 5000
                _validate_paragraph(block, block_path, maximum, allow_inline_equations=name == "significance_and_status")
    return document


def _validate_midterm_paragraph(value: Any, path: str, maximum: int) -> None:
    if isinstance(value, str):
        if not value.strip() or len(value.strip()) > maximum:
            raise ExportError(
                "DOCUMENT_NOT_READY",
                "中期检查内容不完整或超出字数限制，请检查后重试。",
                {"field": path, "reason": "invalid_text", "maximum": maximum},
            )
        _reject_unresolved_math_source(value, path)
        return
    if not isinstance(value, dict) or set(value) - {"type", "runs"} or value.get("type", "paragraph") != "paragraph":
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "中期检查富文本段落格式无效。",
            {"field": path, "reason": "invalid_paragraph"},
        )
    paragraph = {"runs": value.get("runs")}
    _validate_paragraph(paragraph, path, maximum, allow_inline_equations=True)


def _validate_midterm_tool(block: dict, path: str) -> None:
    def invalid(field: str, message: str) -> None:
        raise ExportError("DOCUMENT_NOT_READY", message, {"field": field, "reason": "invalid_block"})

    if block["type"] == "figure_group":
        if set(block) - {"type", "id", "chapter", "columns", "items", "caption", "source_citation_key"}:
            invalid(path, "组合图信息格式有误，请重新插入图片。")
        proxy = {key: value for key, value in block.items() if key in {"id", "chapter", "caption", "source_citation_key"}}
        _validate_image_block({**proxy, "type": "image", "path": "group", "alt": "group"}, path, 5000, _validate_midterm_paragraph, document_name="中期检查")
        _validate_midterm_paragraph(block.get("caption"), f"{path}.caption", 5000)
        columns = block.get("columns", 2)
        if isinstance(columns, bool) or not isinstance(columns, int) or not 1 <= columns <= 4:
            invalid(f"{path}.columns", "组合图每行需要 1–4 张图片。")
        items = block.get("items")
        if not isinstance(items, list) or not 2 <= len(items) <= 4:
            invalid(f"{path}.items", "组合图需要 2–4 张图片。")
        for index, item in enumerate(items):
            item_path = f"{path}.items[{index}]"
            if not isinstance(item, dict) or set(item) - {"path", "alt", "caption"}:
                invalid(item_path, "子图格式无效。")
            _validate_image_block({**item, "type": "image"}, item_path, 5000, _validate_midterm_paragraph, document_name="中期检查")
            for caption_path, caption in _iter_figure_reference_texts(item.get("caption"), f"{item_path}.caption"):
                if "{{fig:" in caption:
                    invalid(caption_path, "子图说明不能包含图片引用。")
        return
    if set(block) - {"type", "style", "columns", "rows", "caption"} or block.get("style", "grid") not in {"grid", "three_line"}:
        invalid(path, "表格格式或样式无效。")
    columns = block.get("columns")
    if not isinstance(columns, list) or not 2 <= len(columns) <= 8:
        invalid(f"{path}.columns", "表格需要 2–8 列。")
    for index, column in enumerate(columns):
        column_path = f"{path}.columns[{index}]"
        if not isinstance(column, dict) or set(column) - {"header", "width_weight", "alignment"}:
            invalid(column_path, "表格列格式无效。")
        weight = column.get("width_weight", 1)
        if isinstance(weight, bool) or not isinstance(weight, (int, float)) or not 0.25 <= weight <= 10 or column.get("alignment", "left") not in {"left", "center", "right"}:
            invalid(column_path, "表格列宽或对齐方式无效。")
        _validate_midterm_paragraph(column.get("header"), f"{column_path}.header", 5000)
    rows = block.get("rows")
    if not isinstance(rows, list) or not 1 <= len(rows) <= 40:
        invalid(f"{path}.rows", "表格需要 1–40 行数据。")
    for index, row in enumerate(rows):
        row_path = f"{path}.rows[{index}]"
        if not isinstance(row, dict) or set(row) != {"cells"} or not isinstance(row["cells"], list) or len(row["cells"]) != len(columns):
            invalid(row_path, "表格每行单元格数量必须与列数相同。")
        for cell_index, cell in enumerate(row["cells"]):
            _validate_midterm_paragraph(cell, f"{row_path}.cells[{cell_index}]", 5000)
    if block.get("caption") is not None:
        _validate_midterm_paragraph(block["caption"], f"{path}.caption", 5000)


def validate_authoring_media(block: dict, path: str) -> None:
    """Shared media shape contract; does not claim export readiness or resolve assets."""
    if block.get("type") == "image":
        _validate_image_block(block, path, 5000, _validate_midterm_paragraph, document_name="文档")
    else:
        _validate_midterm_tool(block, path)


def _validate_midterm_blocks(value: Any, path: str) -> None:
    if not isinstance(value, list) or not 1 <= len(value) <= 80:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "中期检查正文至少需要一个内容块。",
            {"field": path, "reason": "invalid_items"},
        )
    for index, block in enumerate(value):
        block_path = f"{path}[{index}]"
        if not isinstance(block, dict) or block.get("type", "paragraph") == "paragraph":
            _validate_midterm_paragraph(block, block_path, 5000)
            continue
        if block.get("type") in {"ordered_list", "unordered_list"}:
            _validate_list_block(
                block,
                block_path,
                5000,
                _validate_midterm_paragraph,
                document_name="中期检查",
            )
            continue
        if block.get("type") in {"figure_group", "data_table"}:
            _validate_midterm_tool(block, block_path)
            continue
        if block.get("type") == "image":
            _validate_image_block(
                block,
                block_path,
                5000,
                _validate_midterm_paragraph,
                document_name="中期检查",
            )
            continue
        if block.get("type") == "equation":
            _validate_equation(block, block_path)
            continue
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "中期检查正文只支持段落、列表、图片、组合图和表格。",
            {"field": block_path, "reason": "unsupported_block"},
        )


def _iter_figure_reference_texts(value: Any, path: str):
    if isinstance(value, str):
        yield path, value
        return
    if not isinstance(value, dict):
        return
    if value.get("type", "paragraph") == "paragraph":
        for index, run in enumerate(value.get("runs", [])):
            if isinstance(run, dict) and isinstance(run.get("text"), str):
                yield f"{path}.runs[{index}].text", run["text"]
        return
    if value.get("type") == "data_table":
        for index, column in enumerate(value.get("columns", [])):
            yield from _iter_figure_reference_texts(column.get("header"), f"{path}.columns[{index}].header")
        for row_index, row in enumerate(value.get("rows", [])):
            for cell_index, cell in enumerate(row.get("cells", [])):
                yield from _iter_figure_reference_texts(cell, f"{path}.rows[{row_index}].cells[{cell_index}]")
        yield from _iter_figure_reference_texts(value.get("caption"), f"{path}.caption")
        return
    if value.get("type") in {"ordered_list", "unordered_list"}:
        for index, item in enumerate(value.get("items", [])):
            if not isinstance(item, dict):
                continue
            item_path = f"{path}.items[{index}]"
            yield from _iter_figure_reference_texts(
                item.get("content"), f"{item_path}.content"
            )
            if "children" in item:
                yield from _iter_figure_reference_texts(
                    item.get("children"), f"{item_path}.children"
                )


def _validate_midterm_figure_graph(sections: dict[str, Any]) -> None:
    figures: dict[str, str] = {}
    reference_texts: list[tuple[str, str]] = []
    for section_name in ("main_research_content", "progress"):
        for index, block in enumerate(sections[section_name]):
            block_path = f"sections.{section_name}[{index}]"
            if isinstance(block, dict) and block.get("type") in {"image", "figure_group"}:
                figure_id = block.get("id")
                if figure_id is not None:
                    if figure_id in figures:
                        raise ExportError(
                            "DOCUMENT_NOT_READY",
                            "中期检查图片标识不能重复。",
                            {
                                "field": f"{block_path}.id",
                                "reason": "duplicate_figure_id",
                            },
                        )
                    figures[figure_id] = block_path
                caption = block.get("caption")
                for caption_path, text in _iter_figure_reference_texts(
                    caption, f"{block_path}.caption"
                ):
                    if "{{fig:" in text:
                        raise ExportError(
                            "DOCUMENT_NOT_READY",
                            "中期检查图片题注不能包含图片引用。",
                            {
                                "field": caption_path,
                                "reason": "reference_in_caption",
                            },
                        )
                continue
            reference_texts.extend(
                _iter_figure_reference_texts(block, block_path)
            )

    for path, text in reference_texts:
        for match in FIGURE_REFERENCE_PATTERN.finditer(text):
            if match.group(1) not in figures:
                raise ExportError(
                    "DOCUMENT_NOT_READY",
                    "中期检查正文引用了不存在的图片。",
                    {"field": path, "reason": "unknown_figure_reference"},
                )
        if "{{fig:" in FIGURE_REFERENCE_PATTERN.sub("", text):
            raise ExportError(
                "DOCUMENT_NOT_READY",
                "中期检查正文包含无效的图片引用。",
                {"field": path, "reason": "invalid_figure_reference"},
            )


def validate_midterm(document: Any) -> dict[str, Any]:
    if not isinstance(document, dict) or set(document) != {"schema_version", "metadata", "sections"}:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "中期检查数据结构不完整。",
            {"field": "root", "reason": "invalid_shape"},
        )
    if document.get("schema_version") != "0.1":
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "中期检查数据版本不受支持。",
            {"field": "schema_version", "reason": "unsupported"},
        )
    metadata = document.get("metadata")
    metadata_limits = {
        "student_name": 20,
        "college": 50,
        "major": 50,
        "class_name": 30,
        "advisor": 30,
    }
    expected_metadata = set(metadata_limits) | {"check_date", "title"}
    if not isinstance(metadata, dict) or set(metadata) != expected_metadata:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "中期检查基本信息不完整。",
            {"field": "metadata", "reason": "invalid_shape"},
        )
    clean_metadata = {
        key: _require_text(metadata.get(key), f"metadata.{key}", maximum=maximum)
        for key, maximum in metadata_limits.items()
    }
    if ADVISOR_TITLE_PATTERN.search(clean_metadata["advisor"]):
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "“指导教师”仅填写姓名，职称请填写至“指导教师职称”。",
            {"field": "metadata.advisor", "reason": "name_only"},
        )
    check_date = metadata.get("check_date")
    try:
        parsed_date = datetime.strptime(check_date, "%Y-%m-%d")
    except (TypeError, ValueError) as exc:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "中期检查日期必须使用有效的 YYYY-MM-DD 日期。",
            {"field": "metadata.check_date", "reason": "invalid_date"},
        ) from exc
    if parsed_date.strftime("%Y-%m-%d") != check_date:
        raise ExportError("DOCUMENT_NOT_READY", "中期检查日期格式无效。", {"field": "metadata.check_date"})
    _validate_midterm_paragraph(metadata.get("title"), "metadata.title", 90)

    sections = document.get("sections")
    required_sections = {"directory", "main_research_content", "progress"}
    allowed_sections = required_sections | {"numbering_style", "editable_headings"}
    if (
        not isinstance(sections, dict)
        or not required_sections <= set(sections)
        or set(sections) - allowed_sections
    ):
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "中期检查正文结构不完整。",
            {"field": "sections", "reason": "invalid_shape"},
        )
    if "editable_headings" in sections and not isinstance(sections["editable_headings"], bool):
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "中期检查引导段落标志无效。",
            {"field": "sections.editable_headings", "reason": "invalid_type"},
        )
    numbering_style = sections.get("numbering_style")
    if numbering_style is not None and numbering_style not in MIDTERM_OUTLINE_STYLE_DEPTHS:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "中期检查目录编号格式不受支持。",
            {"field": "sections.numbering_style", "reason": "unsupported"},
        )
    maximum_outline_depth = (
        MIDTERM_OUTLINE_STYLE_DEPTHS[numbering_style]
        if isinstance(numbering_style, str)
        else 6
    )
    directory = sections.get("directory")
    if not isinstance(directory, list) or not 1 <= len(directory) <= 150:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "中期检查目录至少需要一个条目。",
            {"field": "sections.directory", "reason": "invalid_items"},
        )
    previous_level = 1
    for index, item in enumerate(directory):
        path = f"sections.directory[{index}]"
        if not isinstance(item, dict) or set(item) - {"level", "number", "title"} or not {"level", "title"} <= set(item):
            raise ExportError("DOCUMENT_NOT_READY", "中期检查目录条目格式无效。", {"field": path})
        level = item.get("level")
        if (
            isinstance(level, bool)
            or not isinstance(level, int)
            or not 1 <= level <= maximum_outline_depth
        ):
            raise ExportError(
                "DOCUMENT_NOT_READY",
                f"中期检查目录层级必须为 1 至 {maximum_outline_depth}。",
                {"field": f"{path}.level"},
            )
        if (index == 0 and level != 1) or level > previous_level + 1:
            raise ExportError("DOCUMENT_NOT_READY", "中期检查目录层级不能跳级。", {"field": f"{path}.level"})
        previous_level = level
        number = item.get("number")
        if number is not None and (not isinstance(number, str) or not number.strip() or len(number) > 20):
            raise ExportError("DOCUMENT_NOT_READY", "中期检查目录编号格式无效。", {"field": f"{path}.number"})
        _validate_midterm_paragraph(item.get("title"), f"{path}.title", 200)
    _validate_midterm_blocks(sections.get("main_research_content"), "sections.main_research_content")
    _validate_midterm_blocks(sections.get("progress"), "sections.progress")
    _validate_midterm_figure_graph(sections)
    return document


def _validate_task_book_paragraph(value: Any, path: str, maximum: int) -> None:
    if isinstance(value, str):
        _require_text(value, path, maximum=maximum)
        return
    if (
        not isinstance(value, dict)
        or set(value) - {"type", "runs"}
        or value.get("type", "paragraph") != "paragraph"
        or "runs" not in value
    ):
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "任务书富文本段落格式无效。",
            {"field": path, "reason": "invalid_paragraph"},
        )
    _validate_paragraph({"runs": value.get("runs")}, path, maximum)


def _paragraph_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict) and isinstance(value.get("runs"), list):
        return "".join(
            run.get("text", "") for run in value["runs"] if isinstance(run, dict)
        )
    return ""


def _validate_task_book_blocks(
    value: Any,
    path: str,
    *,
    minimum: int,
    maximum: int,
) -> None:
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "任务书正文内容块数量不符合要求。",
            {
                "field": path,
                "reason": "invalid_items",
                "minimum": minimum,
                "maximum": maximum,
            },
        )
    for block_index, block in enumerate(value):
        block_path = f"{path}[{block_index}]"
        if not isinstance(block, dict) or block.get("type", "paragraph") == "paragraph":
            _validate_task_book_paragraph(block, block_path, 5000)
            continue
        if block.get("type") in {"ordered_list", "unordered_list"}:
            _validate_list_block(
                block,
                block_path,
                5000,
                _validate_task_book_paragraph,
                document_name="任务书",
            )
            continue
        if block.get("type") == "image":
            _validate_image_block(
                block,
                block_path,
                5000,
                _validate_task_book_paragraph,
                document_name="任务书",
            )
            continue
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "任务书正文只支持段落、有序列表、无序列表和本地图片。",
            {"field": block_path, "reason": "unsupported_block"},
        )


def _validate_task_book_topic_information(value: Any) -> None:
    path = "sections.topic_information"
    if not isinstance(value, dict) or set(value) != {"nature", "source"}:
        raise ExportError(
            "DOCUMENT_NOT_READY", "任务书选题信息结构无效。", {"field": path}
        )
    if value.get("nature") not in {"graduation_design", "graduation_thesis"}:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "任务书选题性质无效。",
            {"field": f"{path}.nature"},
        )
    source = value.get("source")
    source_path = f"{path}.source"
    if not isinstance(source, dict):
        raise ExportError(
            "DOCUMENT_NOT_READY", "任务书选题来源无效。", {"field": source_path}
        )
    source_type = source.get("type")
    if source_type == "practice_project":
        if set(source) != {"type"}:
            raise ExportError(
                "DOCUMENT_NOT_READY", "任务书实践项目来源格式无效。", {"field": source_path}
            )
        return
    if source_type == "self_proposed":
        if set(source) != {"type", "self_proposed_by"} or source.get(
            "self_proposed_by"
        ) not in {"teacher", "student", "teacher_student_joint"}:
            raise ExportError(
                "DOCUMENT_NOT_READY", "任务书自拟题目信息无效。", {"field": source_path}
            )
        return
    if source_type != "research_project" or set(source) != {
        "type",
        "research_project",
    }:
        raise ExportError(
            "DOCUMENT_NOT_READY", "任务书科研项目来源格式无效。", {"field": source_path}
        )
    project = source.get("research_project")
    project_path = f"{source_path}.research_project"
    if not isinstance(project, dict) or set(project) - {
        "level",
        "other_level",
        "project_number",
    } or not {"level", "project_number"} <= set(project):
        raise ExportError(
            "DOCUMENT_NOT_READY", "任务书科研项目信息无效。", {"field": project_path}
        )
    level = project.get("level")
    if level not in {"national", "provincial_ministerial", "other"}:
        raise ExportError(
            "DOCUMENT_NOT_READY", "任务书科研项目级别无效。", {"field": f"{project_path}.level"}
        )
    _require_text(
        project.get("project_number"),
        f"{project_path}.project_number",
        maximum=50,
    )
    if level == "other":
        if set(project) != {"level", "other_level", "project_number"}:
            raise ExportError(
                "DOCUMENT_NOT_READY", "任务书其他项目级别不能为空。", {"field": project_path}
            )
        _require_text(
            project.get("other_level"), f"{project_path}.other_level", maximum=50
        )
    elif set(project) != {"level", "project_number"}:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "任务书非其他项目级别不能填写自定义级别。",
            {"field": project_path},
        )


def validate_task_book(document: Any) -> dict[str, Any]:
    """Mirror the submitted task-book model's strict pre-render constraints."""

    if not isinstance(document, dict) or set(document) != {
        "schema_version",
        "metadata",
        "sections",
    }:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "任务书数据结构不完整。",
            {"field": "root", "reason": "invalid_shape"},
        )
    if document.get("schema_version") != "0.1":
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "任务书数据版本不受支持。",
            {"field": "schema_version", "reason": "unsupported"},
        )
    metadata = document.get("metadata")
    limits = {
        "student_name": 20,
        "student_id": 30,
        "college": 50,
        "major": 50,
        "class_name": 30,
        "advisor": 30,
    }
    expected_metadata = set(limits) | {"graduation_year", "title"}
    if not isinstance(metadata, dict) or set(metadata) != expected_metadata:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "任务书基本信息不完整。",
            {"field": "metadata", "reason": "invalid_shape"},
        )
    graduation_year = metadata.get("graduation_year")
    if (
        isinstance(graduation_year, bool)
        or not isinstance(graduation_year, int)
        or not 2000 <= graduation_year <= 2100
    ):
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "毕业届别必须是 2000 至 2100 之间的四位年份。",
            {"field": "metadata.graduation_year", "reason": "invalid_year"},
        )
    _validate_task_book_paragraph(metadata.get("title"), "metadata.title", 100)
    title_text = _paragraph_text(metadata.get("title"))
    display_width = sum(0.5 if ord(character) < 128 else 1.0 for character in title_text)
    if display_width > 80:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "任务书题目超过封面两行可容纳长度。",
            {
                "field": "metadata.title",
                "reason": "display_width_exceeded",
                "maximum": 80,
            },
        )
    clean_metadata = {
        key: _require_text(metadata.get(key), f"metadata.{key}", maximum=maximum)
        for key, maximum in limits.items()
    }
    if TASK_BOOK_ADVISOR_TITLE_PATTERN.search(clean_metadata["advisor"]):
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "“指导教师”仅填写姓名，职称请填写至“指导教师职称”。",
            {"field": "metadata.advisor", "reason": "name_only"},
        )

    sections = document.get("sections")
    expected_sections = {
        "basic_content_and_requirements",
        "schedule",
        "required_materials",
        "references",
        "topic_information",
    }
    if not isinstance(sections, dict) or set(sections) != expected_sections:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "任务书正文结构不完整。",
            {"field": "sections", "reason": "invalid_shape"},
        )
    _validate_task_book_blocks(
        sections.get("basic_content_and_requirements"),
        "sections.basic_content_and_requirements",
        minimum=1,
        maximum=80,
    )
    schedule = sections.get("schedule")
    if not isinstance(schedule, list) or not 1 <= len(schedule) <= 60:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "任务书进度安排至少需要一个条目。",
            {"field": "sections.schedule", "reason": "invalid_items"},
        )
    for index, entry in enumerate(schedule):
        entry_path = f"sections.schedule[{index}]"
        if not isinstance(entry, dict) or set(entry) != {"period", "content"}:
            raise ExportError(
                "DOCUMENT_NOT_READY",
                "任务书进度安排条目格式无效。",
                {"field": entry_path},
            )
        _require_text(entry.get("period"), f"{entry_path}.period", maximum=50)
        _validate_task_book_paragraph(
            entry.get("content"), f"{entry_path}.content", 1500
        )
    _validate_task_book_blocks(
        sections.get("required_materials"),
        "sections.required_materials",
        minimum=0,
        maximum=50,
    )
    references = sections.get("references")
    if not isinstance(references, list) or not 1 <= len(references) <= 100:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "任务书至少需要一条参考文献。",
            {"field": "sections.references", "reason": "invalid_items"},
        )
    for index, reference in enumerate(references):
        _validate_task_book_paragraph(
            reference, f"sections.references[{index}]", 1500
        )
    _validate_task_book_topic_information(sections.get("topic_information"))
    return document


ASSESSMENT_METADATA_FIELDS = frozenset({
    "title", "student_name", "student_id", "college", "major", "advisor", "advisor_title",
    "reviewer", "reviewer_title", "defense_time", "defense_location", "recorder", "leader",
})
ASSESSMENT_SECTION_FIELDS = frozenset({
    "comments", "division_of_work", "suggested_grade", "questions", "members", "final_grade", "date",
})
ASSESSMENT_GUIDANCE_FIELDS = frozenset({"comments", "division_of_work", "questions"})


def _validate_assessment_paragraph(value: Any, path: str, maximum: int) -> None:
    try:
        _validate_paragraph(value, path, maximum)
    except ExportError as exc:
        raise ExportError(exc.code, "评审表文字格式无效，请使用非空段落和受支持的文字样式。", exc.details) from exc


def _validate_assessment_blocks(value: Any, path: str) -> None:
    if not isinstance(value, list) or len(value) > 100:
        raise ExportError("DOCUMENT_NOT_READY", "评审内容必须为受支持的文本内容块。", {"field": path})
    for index, block in enumerate(value):
        field = f"{path}[{index}]"
        if isinstance(block, dict) and block.get("type") in {"ordered_list", "unordered_list"}:
            _validate_list_block(block, field, 5000, _validate_assessment_paragraph, document_name="评审表")
        else:
            _validate_assessment_paragraph(block, field, 5000)


def validate_assessment(document: Any) -> dict[str, Any]:
    """Validate fixed-page forms while leaving现场评审 fields optional."""
    if not isinstance(document, dict) or set(document) != {"schema_version", "metadata", "sections"} or document.get("schema_version") != "0.1":
        raise ExportError("DOCUMENT_NOT_READY", "评审表数据结构无效。")
    metadata, sections = document.get("metadata"), document.get("sections")
    if not isinstance(metadata, dict) or set(metadata) != ASSESSMENT_METADATA_FIELDS:
        raise ExportError("DOCUMENT_NOT_READY", "评审表基本信息结构无效。", {"field": "metadata"})
    if not isinstance(sections, dict) or not ASSESSMENT_SECTION_FIELDS <= set(sections) or set(sections) - ASSESSMENT_SECTION_FIELDS - {"editable_headings", "writing_guidance"}:
        raise ExportError("DOCUMENT_NOT_READY", "评审表填写区域结构无效。", {"field": "sections"})
    if "editable_headings" in sections and not isinstance(sections["editable_headings"], bool):
        raise ExportError("DOCUMENT_NOT_READY", "评审表预填提示状态应为布尔值。", {"field": "sections.editable_headings"})
    if "writing_guidance" in sections:
        guidance = sections["writing_guidance"]
        if not isinstance(guidance, dict) or set(guidance) - ASSESSMENT_GUIDANCE_FIELDS:
            raise ExportError("DOCUMENT_NOT_READY", "评审表填写提示结构无效。", {"field": "sections.writing_guidance"})
        for field, paragraph in guidance.items():
            if paragraph is None or (isinstance(paragraph, str) and not paragraph.strip() and len(paragraph) <= 5000):
                continue
            if isinstance(paragraph, dict) and paragraph.get("runs") == [] and _is_empty_draft_paragraph(paragraph):
                continue
            _validate_assessment_paragraph(paragraph, f"sections.writing_guidance.{field}", 5000)
    _validate_assessment_paragraph(metadata.get("title"), "metadata.title", 200)
    required = {"student_name", "student_id", "college", "major"}
    for field in ASSESSMENT_METADATA_FIELDS - {"title"}:
        value = metadata[field]
        if not isinstance(value, str) or len(value) > 240 or (field in required and not value.strip()):
            raise ExportError("DOCUMENT_NOT_READY", "请填写姓名、学号、学院、专业和论文题目。", {"field": f"metadata.{field}"})
    for field in ("comments", "division_of_work"):
        _validate_assessment_blocks(sections[field], f"sections.{field}")
    for field in ("suggested_grade", "final_grade", "date"):
        if not isinstance(sections[field], str) or len(sections[field]) > 50:
            raise ExportError("DOCUMENT_NOT_READY", "评审表成绩或日期格式无效。", {"field": f"sections.{field}"})
    if sections["final_grade"].strip():
        from decimal import Decimal, InvalidOperation
        try:
            score = Decimal(sections["final_grade"].strip())
            if not score.is_finite() or score < 0 or re.fullmatch(r"\d+(?:\.\d+)?", sections["final_grade"].strip()) is None:
                raise InvalidOperation
        except InvalidOperation as exc:
            raise ExportError("DOCUMENT_NOT_READY", "最终成绩应为非负的有效十进制数字。", {"field": "sections.final_grade"}) from exc
    if sections["date"].strip():
        try:
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", sections["date"]) is None:
                raise ValueError
            date.fromisoformat(sections["date"])
        except ValueError as exc:
            raise ExportError("DOCUMENT_NOT_READY", "请填写有效日期。", {"field": "sections.date"}) from exc
    members = sections["members"]
    if not isinstance(members, list) or len(members) > 30 or any(not isinstance(member, str) or len(member) > 80 for member in members):
        raise ExportError("DOCUMENT_NOT_READY", "答辩成员名单格式无效。", {"field": "sections.members"})
    questions = sections["questions"]
    if not isinstance(questions, list) or len(questions) > 50:
        raise ExportError("DOCUMENT_NOT_READY", "答辩问答格式无效。", {"field": "sections.questions"})
    for index, question in enumerate(questions):
        field = f"sections.questions[{index}]"
        if not isinstance(question, dict) or set(question) != {"question", "answer"}:
            raise ExportError("DOCUMENT_NOT_READY", "答辩问答条目结构无效。", {"field": field})
        for part in ("question", "answer"):
            _validate_assessment_blocks(question[part], f"{field}.{part}")
    return document


def validate_document(document_type: str, document: Any) -> dict[str, Any]:
    if document_type in ASSESSMENT_DOCUMENT_TYPES:
        return validate_assessment(document)
    if document_type == "proposal":
        return validate_proposal(document)
    if document_type == "midterm":
        return validate_midterm(document)
    if document_type == "task_book":
        return validate_task_book(document)
    if document_type == "thesis":
        from .thesis_contract import validate_thesis_content
        from .storage.errors import ValidationError
        try:
            validate_thesis_content(document)
        except (ValidationError, TypeError, KeyError) as exc:
            raise ExportError("DOCUMENT_NOT_READY", "论文草稿结构无效，请检查章节和内容块。") from exc
        metadata = document.get("metadata")
        draft = document["thesis"]
        required = ("title", "student_name", "student_id", "college", "major", "advisor")
        if not isinstance(metadata, dict):
            raise ExportError("DOCUMENT_NOT_READY", "请先填写论文基本信息。")
        for field in required:
            value = _paragraph_text(metadata.get(field)) if field == "title" else metadata.get(field)
            if not isinstance(value, str) or not value.strip():
                raise ExportError("DOCUMENT_NOT_READY", "论文基本信息尚未填写完整。", {"field": f"metadata.{field}"})
        for field in ("englishTitle", "keywordsCn", "keywordsEn"):
            if not draft[field].strip():
                raise ExportError("DOCUMENT_NOT_READY", "论文英文题目和关键词尚未填写完整。", {"field": f"thesis.{field}"})
        try:
            submitted = date.fromisoformat(draft.get("submissionDate", ""))
            if not 2000 <= submitted.year <= 2100:
                raise ValueError
        except (TypeError, ValueError) as exc:
            raise ExportError("DOCUMENT_NOT_READY", "请填写有效的论文封面提交日期。", {"field": "thesis.submissionDate"}) from exc
        if not draft["abstractCn"] or not draft["abstractEn"] or not draft["chapters"]:
            raise ExportError("DOCUMENT_NOT_READY", "请先填写中英文摘要和至少一个章节。")
        if not draft["referencesBibtex"].strip():
            raise ExportError("DOCUMENT_NOT_READY", "请先导入参考文献。")
        try:
            count_valid_bibtex_entries(draft["referencesBibtex"])
        except BibtexValidationError as exc:
            raise ExportError("DOCUMENT_NOT_READY", "参考文献 BibTeX 内容无效。", {"reason": exc.reason}) from exc
        return document
    raise ExportError("DOCUMENT_TYPE_UNSUPPORTED", "当前文档类型不支持导出。")


def _template_json_object(path: Path, *, relative_name: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ExportError(
            "TEMPLATE_LAYOUT_INVALID",
            "任务书模板排版规格无效，无法检查封面题目容量。",
            {"file": relative_name},
        ) from exc
    if not isinstance(value, dict):
        raise ExportError(
            "TEMPLATE_LAYOUT_INVALID",
            "任务书模板排版规格无效，无法检查封面题目容量。",
            {"file": relative_name},
        )
    return value


def _assessment_docx_layout(spec_path: Path, input_path: Path, report_path: Path | None = None) -> dict[str, Any]:
    """Use the trusted renderer's shared row plan, bound to this exact input/spec."""
    base = _template_json_object(spec_path, relative_name="spec/layout.json")
    if not base.get("word", {}).get("effective_layout_report"):
        return base
    try:
        if report_path is None or report_path.is_symlink() or report_path.stat().st_size > 256 * 1024:
            raise ValueError("Invalid layout report")
        report = json.loads(report_path.read_text(encoding="utf-8"))
        if not isinstance(report, dict) or set(report) != {"schema_version", "input_sha256", "layout_spec_sha256", "layout"}:
            raise ValueError("Invalid report envelope")
        if report["schema_version"] != "1.0" or report["input_sha256"] != sha256_file(input_path) or report["layout_spec_sha256"] != sha256_file(spec_path):
            raise ValueError("Layout report binding mismatch")
        effective = report["layout"]
        if not isinstance(effective, dict) or effective.get("page") != base.get("page"):
            raise ValueError("Page geometry changed")
        if not isinstance(effective.get("word"), dict) or any(effective["word"].get(key) != base["word"].get(key) for key in ("table_count", "table_grid_twips", "row_height_rule")):
            raise ValueError("Fixed table geometry changed")
        return effective
    except (OSError, ValueError, TypeError, KeyError) as exc:
        raise ExportError("DOCX_EXPECTATION_INVALID", "评审表有效版式报告缺失或与当前输入不一致。") from exc


def _positive_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) and number > 0 else None


def _task_book_cover_title_constraints(
    engine: EngineDescriptor,
) -> tuple[float, int]:
    """Read the renderer's title-line constraints from this exact engine snapshot."""

    layout_relative_name = "spec/layout.json"
    layout = _template_json_object(
        engine.root / layout_relative_name,
        relative_name=layout_relative_name,
    )
    cover = layout.get("cover")
    typography = layout.get("typography")
    title_style = (
        typography.get("cover_title_value")
        if isinstance(typography, dict)
        else None
    )
    if not isinstance(cover, dict) or not isinstance(title_style, dict):
        raise ExportError(
            "TEMPLATE_LAYOUT_INVALID",
            "任务书模板缺少封面题目排版规格。",
            {"file": layout_relative_name},
        )

    maximum_lines = cover.get("title_max_lines")
    if (
        isinstance(maximum_lines, bool)
        or not isinstance(maximum_lines, int)
        or maximum_lines <= 0
    ):
        raise ExportError(
            "TEMPLATE_LAYOUT_INVALID",
            "任务书模板封面题目行数规格无效。",
            {"file": layout_relative_name, "field": "cover.title_max_lines"},
        )

    if "title_line_capacity_units" in cover:
        line_capacity = _positive_number(cover.get("title_line_capacity_units"))
        if line_capacity is None:
            raise ExportError(
                "TEMPLATE_LAYOUT_INVALID",
                "任务书模板封面题目容量规格无效。",
                {
                    "file": layout_relative_name,
                    "field": "cover.title_line_capacity_units",
                },
            )
    else:
        size_name = title_style.get("size")
        sizes_relative_name = "templates/common/typography/chinese-sizes.json"
        sizes = _template_json_object(
            engine.root.parent / "common" / "typography" / "chinese-sizes.json",
            relative_name=sizes_relative_name,
        ).get("sizes")
        size = sizes.get(size_name) if isinstance(sizes, dict) else None
        title_size_pt = (
            _positive_number(size.get("pt")) if isinstance(size, dict) else None
        )
        if title_size_pt is None:
            raise ExportError(
                "TEMPLATE_LAYOUT_INVALID",
                "任务书模板封面题目字号规格无效。",
                {
                    "file": sizes_relative_name,
                    "field": "typography.cover_title_value.size",
                },
            )
        underline_width_mm = _positive_number(
            cover.get("title_underline_width_mm")
        )
        if underline_width_mm is None:
            raise ExportError(
                "TEMPLATE_LAYOUT_INVALID",
                "任务书模板封面题目宽度规格无效。",
                {
                    "file": layout_relative_name,
                    "field": "cover.title_underline_width_mm",
                },
            )
        line_capacity = underline_width_mm / (title_size_pt * 25.4 / 72.0)

    return line_capacity, maximum_lines


def _task_book_title_fits_cover(
    title: str,
    *,
    line_capacity: float,
    maximum_lines: int,
) -> tuple[bool, int]:
    """Mirror the Word/LaTeX cover splitter without executing template code."""

    line_count = 1
    line_width = 0.0
    line_has_text = False
    for character in title:
        if character == "\n":
            if not line_has_text:
                continue
            if line_count == maximum_lines:
                return False, line_count + 1
            line_count += 1
            line_width = 0.0
            line_has_text = False
            continue
        character_width = 0.5 if ord(character) < 128 else 1.0
        if line_width + character_width > line_capacity and line_has_text:
            if line_count == maximum_lines:
                return False, line_count + 1
            line_count += 1
            line_width = 0.0
        line_width += character_width
        line_has_text = True
    return True, line_count


def validate_template_renderability(
    document_type: str,
    document: dict[str, Any],
    engine: EngineDescriptor,
) -> None:
    """Reject inputs that satisfy the schema but cannot fit the selected template."""

    if engine.document_type != document_type:
        raise ExportError(
            "TEMPLATE_ENGINE_MISMATCH", "模板与文档类型不匹配，请重新选择模板。"
        )
    if document_type != "task_book":
        return
    metadata = document.get("metadata")
    if not isinstance(metadata, dict):
        return
    title = _paragraph_text(metadata.get("title"))
    line_capacity, maximum_lines = _task_book_cover_title_constraints(engine)
    fits, required_lines = _task_book_title_fits_cover(
        title,
        line_capacity=line_capacity,
        maximum_lines=maximum_lines,
    )
    if not fits:
        actual_width = sum(
            0.5 if ord(character) < 128 else 1.0
            for character in title
            if character != "\n"
        )
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "任务书题目超过当前模板封面的可排版容量，请缩短题目。",
            {
                "field": "metadata.title",
                "reason": "template_capacity_exceeded",
                "actual_display_width": actual_width,
                "line_capacity_units": round(line_capacity, 3),
                "maximum_lines": maximum_lines,
                "required_lines": required_lines,
                "template_pack_sha256": engine.pack_sha256,
            },
        )


def _graduation_year_from_cohort(value: Any) -> int | None:
    if not isinstance(value, str):
        return None
    matched = re.fullmatch(r"\s*(\d{4})(?:届)?\s*", value)
    if matched is None:
        return None
    year = int(matched.group(1))
    return year if 2000 <= year <= 2100 else None


def _is_empty_draft_paragraph(value: Any) -> bool:
    """Recognize only structurally valid paragraphs whose text is blank."""

    if isinstance(value, str):
        return not value.strip()
    if (
        not isinstance(value, dict)
        or set(value) - {"type", "runs"}
        or value.get("type", "paragraph") != "paragraph"
        or not isinstance(value.get("runs"), list)
    ):
        return False
    runs = value["runs"]
    if any(
        not isinstance(run, dict)
        or set(run) - {"text", "script", "italic", "bold"}
        or not isinstance(run.get("text"), str)
        or run.get("script", "normal") not in {"normal", "sub", "super"}
        or not isinstance(run.get("bold", False), bool)
        or not isinstance(run.get("italic", False), bool)
        for run in runs
    ):
        return False
    return not any(run["text"].strip() for run in runs)


def _without_empty_draft_paragraphs(
    content: dict[str, Any], document_type: str
) -> dict[str, Any]:
    """Drop editor-only blank blocks before producing the strict render input."""

    normalized = dict(content)
    sections = content.get("sections")
    section_names = DRAFT_PARAGRAPH_SECTION_NAMES.get(document_type)
    if not isinstance(sections, dict) or section_names is None:
        return normalized
    normalized_sections = dict(sections)
    for section_name in section_names:
        blocks = sections.get(section_name)
        if isinstance(blocks, list):
            normalized_sections[section_name] = [
                block for block in blocks if not _is_empty_draft_paragraph(block)
            ]
    if document_type in ASSESSMENT_DOCUMENT_TYPES and isinstance(sections.get("questions"), list):
        normalized_questions = [
            {key: [block for block in value if not _is_empty_draft_paragraph(block)] if key in {"question", "answer"} and isinstance(value, list) else value for key, value in item.items()}
            if isinstance(item, dict) else item
            for item in sections["questions"]
        ]
        normalized_sections["questions"] = [
            item for item in normalized_questions
            if not (isinstance(item, dict) and set(item) == {"question", "answer"} and item["question"] == [] and item["answer"] == [])
        ]
    if document_type in ASSESSMENT_DOCUMENT_TYPES and isinstance(sections.get("members"), list):
        normalized_sections["members"] = [member for member in sections["members"] if not (isinstance(member, str) and not member.strip())]
    normalized["sections"] = normalized_sections
    return normalized


_BIBTEX_FAILURE_MESSAGES: dict[str, str] = {
    "entry_prefix": "参考文献里混入了 BibTeX 条目以外的内容。每条文献都要以 @ 开头，请删掉多余的说明文字。",
    "entry_header": "有参考文献的开头写法不完整，@ 后面的类型或花括号不正确。",
    "unsupported_type": "有参考文献使用了不支持的 BibTeX 类型。常用类型如 article、book、inproceedings、misc、online 都可以。",
    "citation_key": "有参考文献缺少引用标识，或引用标识后面少了逗号。",
    "duplicate_key": "有两条参考文献用了相同的引用标识，请改成不同的名字。",
    "field_definition": "有参考文献的字段写法不完整，字段名后面要跟等号 =。",
    "invalid_value": "有参考文献的字段值格式不正确。",
    "unclosed_value": "有参考文献的字段值没有闭合，缺少右花括号 } 或引号。",
    "empty_value": "第 {entry} 条参考文献的 {field} 字段是空值。请删掉这一行，或填入实际内容。",
    "unclosed_entry": "有参考文献条目没有闭合，缺少右花括号 }。",
    "missing_required_field": "第 {entry} 条参考文献缺少必填字段：{field}。",
    "no_entries": "参考文献列表里没有识别到 BibTeX 条目，请粘贴形如 @article{key, ...} 的内容。",
}


def _bibtex_failure_message(error: BibtexValidationError) -> str:
    """Turn a validation reason into a sentence a student can act on."""

    template = _BIBTEX_FAILURE_MESSAGES.get(error.reason)
    if template is None:
        return "参考文献格式不正确，请检查后重试。"
    # Plain replacement: the messages contain literal braces (for example
    # "缺少右花括号 }"), so str.format would misread them as fields.
    return template.replace("{entry}", str(error.entry or 1)).replace(
        "{field}", error.field or "某个"
    )


def _render_content_without_editor_state(
    content: dict[str, Any], document_type: str
) -> dict[str, Any]:
    """Validate draft-only editor metadata and remove it from render input.

    BibTeX source text belongs to the local editing draft. Word, PDF, LaTeX,
    export snapshots, and history receive only the generated strict references.
    """

    render_content = _without_empty_draft_paragraphs(content, document_type)
    if "editor_state" not in render_content:
        return render_content
    editor_state = render_content.get("editor_state")
    if not isinstance(editor_state, dict) or set(editor_state) != {"bibliography"}:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "参考文献编辑状态无效，请重新粘贴 BibTeX。",
            {"field": "editor_state", "reason": "invalid_shape"},
        )
    if document_type not in {"proposal", "task_book"}:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "当前文档类型不支持参考文献源数据。",
            {"field": "editor_state.bibliography", "reason": "unsupported"},
        )
    bibliography = editor_state.get("bibliography")
    expected_fields = {
        "source_format",
        "source_text",
        "parse_status",
        "entry_count",
    }
    if not isinstance(bibliography, dict) or set(bibliography) != expected_fields:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "参考文献编辑状态不完整，请重新检查 BibTeX。",
            {"field": "editor_state.bibliography", "reason": "invalid_shape"},
        )
    source_text = bibliography.get("source_text")
    entry_count = bibliography.get("entry_count")
    maximum_entries = 50 if document_type == "proposal" else 100
    if (
        bibliography.get("source_format") != "bibtex"
        or not isinstance(source_text, str)
        or not source_text.strip()
        or len(source_text) > 500_000
        or isinstance(entry_count, bool)
        or not isinstance(entry_count, int)
        or not 1 <= entry_count <= maximum_entries
    ):
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "BibTeX 来源信息无效，请检查参考文献。",
            {"field": "editor_state.bibliography", "reason": "invalid_source"},
        )
    if bibliography.get("parse_status") != "valid":
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "BibTeX 尚未通过解析检查，请先修正文献条目。",
            {
                "field": "editor_state.bibliography.parse_status",
                "reason": "invalid_bibtex",
            },
        )
    try:
        parsed_entry_count = count_valid_bibtex_entries(source_text)
    except BibtexValidationError as exc:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            _bibtex_failure_message(exc),
            {
                "field": "editor_state.bibliography.source_text",
                "reason": "invalid_bibtex_source",
                **exc.details(),
            },
        ) from exc
    if parsed_entry_count != entry_count:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "BibTeX 条目数量与编辑状态不一致，请重新检查参考文献。",
            {
                "field": "editor_state.bibliography.entry_count",
                "reason": "entry_count_mismatch",
                "declared": entry_count,
                "parsed": parsed_entry_count,
            },
        )
    sections = render_content.get("sections")
    references = sections.get("references") if isinstance(sections, dict) else None
    rendered_reference_count = len(references) if isinstance(references, list) else 0
    if rendered_reference_count != parsed_entry_count:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "BibTeX 条目数量与待导出的参考文献数量不一致，请重新生成参考文献。",
            {
                "field": "sections.references",
                "reason": "reference_count_mismatch",
                "parsed": parsed_entry_count,
                "rendered": rendered_reference_count,
            },
        )
    return {
        key: value for key, value in render_content.items() if key != "editor_state"
    }


@traced("snapshot")
def capture_export_source(
    workspace: Any, document_id: str
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Read the revision and shared profile from one short SQLite snapshot.

    The control sidecar may save while the render sidecar is working. Release
    this read transaction before resolving templates or starting a renderer so
    the preview has a consistent input without keeping a database lock for the
    duration of rendering.
    """

    with workspace.database.transaction():
        record = workspace.get_document(document_id)
        profile_id = record.get("profile_id")
        profile = (
            workspace.get_profile(profile_id)
            if isinstance(profile_id, str) and profile_id
            else None
        )
    case = current_case.get()
    if case is not None:
        # A preview's internal temporary workspace creates a second document
        # ID. Keep the real user revision as well as the internal renderer input.
        prefix = "preview-render-" if workspace.is_temporary and case.method == "preview.generate" else ""
        case.json(f"{prefix}document.json", record)
        case.json(f"{prefix}profile.json", profile)
        data_root = workspace.database.data_directory
        if data_root is not None:
            asset_root = data_root / "document-assets"
            def copy_assets(value, *, figure_item=False):
                if isinstance(value, dict):
                    image = value.get("path")
                    if (figure_item or value.get("type") in {"image", "figure"}) and isinstance(image, str):
                        source = Path(image)
                        if not source.is_absolute():
                            source = asset_root / source
                        if source.parent.resolve() == asset_root.resolve():
                            case.file(f"document-assets/{source.name}", source)
                        else:
                            case.missing.append(f"文档引用的图片不在受管目录内: {image}")
                    for key, child in value.items():
                        if key == "items" and value.get("type") == "figure_group" and isinstance(child, list):
                            for item in child:
                                copy_assets(item, figure_item=True)
                        else:
                            copy_assets(child)
                elif isinstance(value, list):
                    for child in value:
                        copy_assets(child)
            copy_assets(record.get("content"))
    return record, profile


def build_export_document(
    workspace: Any,
    record: dict[str, Any],
    *,
    profile_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Merge the linked student profile into a document's frozen export input.

    Process-document drafts retain their own body, while the thesis title,
    identity, and programme fields come from the single shared student profile.
    Legacy profiles without a shared title keep the title already stored in the
    document revision until the user saves the title from the profile editor.
    """

    content = record.get("content")
    if not isinstance(content, dict):
        return None
    content = _render_content_without_editor_state(
        content, str(record.get("document_type", ""))
    )
    metadata = content.get("metadata")
    if not isinstance(metadata, dict):
        return {"schema_version": record["schema_version"], **content}
    merged_metadata = dict(metadata)
    shared_fields = ["student_name", "college", "major", "advisor"]
    if record.get("document_type") == "proposal":
        shared_fields.append("student_id")
    elif record.get("document_type") == "midterm":
        shared_fields.append("class_name")
    elif record.get("document_type") == "task_book":
        shared_fields.extend(["student_id", "class_name", "graduation_year"])
    elif record.get("document_type") in ASSESSMENT_DOCUMENT_TYPES:
        shared_fields.extend(["student_id", "advisor_title"])
    elif record.get("document_type") == "thesis":
        shared_fields.extend(["student_id", "advisor_title"])
    for field in shared_fields:
        merged_metadata[field] = ""
    profile_id = record.get("profile_id")
    thesis = content.get("thesis")
    merged_thesis = dict(thesis) if record.get("document_type") == "thesis" and isinstance(thesis, dict) else None
    if isinstance(profile_id, str) and profile_id:
        profile = (
            profile_snapshot
            if profile_snapshot is not None
            else workspace.get_profile(profile_id)
        )
        merged_metadata.update(
            {
                "student_name": profile["full_name"],
                "college": profile["college"],
                "major": profile["major"],
                "advisor": profile.get("advisor_name") or "",
            }
        )
        thesis_title = profile.get("thesis_title")
        if isinstance(thesis_title, list):
            merged_metadata["title"] = thesis_title[0] if thesis_title else ""
        if record.get("document_type") == "proposal":
            merged_metadata["student_id"] = profile["student_number"]
        elif record.get("document_type") == "midterm":
            merged_metadata["class_name"] = profile.get("class_name") or ""
        elif record.get("document_type") == "task_book":
            merged_metadata.update(
                {
                    "student_id": profile["student_number"],
                    "class_name": profile.get("class_name") or "",
                    "graduation_year": _graduation_year_from_cohort(
                        profile.get("graduation_cohort")
                    ),
                }
            )
        elif record.get("document_type") in ASSESSMENT_DOCUMENT_TYPES:
            merged_metadata["student_id"] = profile["student_number"]
            merged_metadata["advisor_title"] = profile.get("advisor_title") or ""
        elif record.get("document_type") == "thesis":
            merged_metadata["student_id"] = profile["student_number"]
            merged_metadata["advisor_title"] = profile.get("advisor_title") or ""
            if merged_thesis is not None and isinstance(profile.get("thesis_title_en"), str):
                merged_thesis["englishTitle"] = profile["thesis_title_en"]
    return {
        "schema_version": record["schema_version"],
        **content,
        "metadata": merged_metadata,
        **({"thesis": merged_thesis} if merged_thesis is not None else {}),
    }


def failed_content_check(
    error: ExportError,
    document_type: str,
    *,
    checked_at: str | None = None,
) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "check_id": f"{document_type}-content",
        "gate": "content",
        "status": "fail",
        "blocking": True,
        "message": error.message,
        "code": error.code,
        "details": error.details,
        "checked_at": checked_at or utc_now(),
    }


def content_check(
    document: Any,
    document_type: str = "proposal",
    *,
    engine: EngineDescriptor | None = None,
) -> dict[str, Any]:
    record_input("renderer-input.json", document)
    checked_at = utc_now()
    try:
        validate_document(document_type, document)
        if document_type == "task_book":
            validate_template_renderability(
                document_type,
                document,
                engine or resolve_engine(document_type),
            )
    except ExportError as exc:
        record_exception(exc)
        return failed_content_check(exc, document_type, checked_at=checked_at)
    return {
        "schema_version": "1.0",
        "check_id": f"{document_type}-content",
        "gate": "content",
        "status": "pass",
        "blocking": True,
        "message": (
            "基本信息和评审内容检查通过；空白处可打印后手写。"
            if document_type in ASSESSMENT_DOCUMENT_TYPES else
            "开题报告内容检查通过。"
            if document_type == "proposal"
            else (
                "中期检查内容检查通过。"
                if document_type == "midterm"
                else (
                    "论文基本信息、摘要、章节和参考文献已通过内容检查。"
                    if document_type == "thesis"
                    else "任务书内容检查通过。"
                )
            )
        ),
        "checked_at": checked_at,
    }


def _ascii_scratch_root() -> Path | None:
    """Return a writable ASCII-only directory for external tool scratch files."""

    candidates: list[Path] = []
    if os.name == "nt":
        program_data = os.environ.get("PROGRAMDATA")
        if program_data:
            candidates.append(Path(program_data) / "SZTU-Docs" / "tmp")
    candidates.append(Path(tempfile.gettempdir()))
    if os.name != "nt":
        candidates.append(Path("/tmp"))
    for candidate in candidates:
        if not str(candidate).isascii():
            continue
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            probe = candidate / f".sztu-probe-{os.getpid()}"
            probe.write_bytes(b"")
            probe.unlink()
            return candidate
        except OSError:
            continue
    return None


def _renderer_environment(
    overrides: dict[str, str] | None = None,
) -> dict[str, str]:
    allowed = (
        "PATH",
        "HOME",
        "USERPROFILE",
        "LOCALAPPDATA",
        "SYSTEMROOT",
        "COMSPEC",
        "PATHEXT",
        "WINDIR",
        "TEMP",
        "TMP",
        "LANG",
        "LC_ALL",
        "SZTU_FONT_DIR",
        "SZTU_STXINGKAI_FONT",
        "SZTU_FZXIAOBIAOSONG_FONT",
        "SZTU_SIMSUN_FONT",
        "SZTU_SIMHEI_FONT",
        "SZTU_TIMES_REGULAR_FONT",
        "SZTU_TIMES_BOLD_FONT",
        "SZTU_TIMES_ITALIC_FONT",
        "SZTU_TIMES_BOLD_ITALIC_FONT",
    )
    environment = {
        key: value for key in allowed if (value := os.environ.get(key))
    }
    environment.update({"PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"})
    if "PATH" in environment:
        environment["PATH"] = windows_tool_path(environment["PATH"])
        environment.update(offline_tex_environment(environment["PATH"]))
    tex_root = environment.get("TEXMFROOT")
    if tex_root:
        # kpathsea otherwise falls back to %USERPROFILE%\.texliveYYYY, which is
        # non-ASCII on Chinese Windows and is not guaranteed to be writable.
        environment["TEXMFVAR"] = tex_root + "/texmf-var"
        environment["TEXMFCACHE"] = tex_root + "/texmf-var"
    scratch = _ascii_scratch_root()
    if scratch is not None:
        # pdftotext/pdftocairo write with a plain fopen() and cannot open
        # non-ASCII output paths; keep every tool scratch file ASCII-only.
        for key in ("TEMP", "TMP", "TMPDIR"):
            current = environment.get(key)
            if not current or not str(current).isascii():
                environment[key] = str(scratch)
    if overrides:
        environment.update(overrides)
    environment = windows_process_environment(environment)
    # Windows ships the same STXingkai family under the shortened STXINGKA filename.
    # Older trusted template policies recognize only its macOS filename.
    if os.name == "nt" and not environment.get("SZTU_STXINGKAI_FONT"):
        windows_font = Path(environment.get("WINDIR", r"C:\Windows")) / "Fonts" / "STXINGKA.TTF"
        if windows_font.is_file():
            environment["SZTU_STXINGKAI_FONT"] = str(windows_font)
    return environment


def _engine_renderer_environment(descriptor: EngineDescriptor) -> dict[str, str]:
    roots: list[str] = []
    configured = os.environ.get("SZTU_FONT_DIR")
    if configured:
        roots.extend(item for item in configured.split(os.pathsep) if item)
    roots.extend(str(path) for path in descriptor.font_directories)
    return {"SZTU_FONT_DIR": os.pathsep.join(dict.fromkeys(roots))} if roots else {}


def _task_book_font_roots(descriptor: EngineDescriptor) -> list[Path]:
    """Mirror the submitted renderer's font roots before starting a DOCX job."""

    roots: list[Path] = []
    configured = os.environ.get("SZTU_FONT_DIR")
    if configured:
        roots.extend(
            Path(item).expanduser()
            for item in configured.split(os.pathsep)
            if item
        )
    roots.extend(
        Path(path).expanduser()
        for path in getattr(descriptor, "font_directories", ())
    )
    if sys.platform == "darwin":
        roots.extend(
            [
                Path.home() / "Library" / "Fonts",
                Path("/Library/Fonts"),
                Path("/System/Library/Fonts"),
                Path("/System/Library/Fonts/Supplemental"),
            ]
        )
    elif os.name == "nt":
        roots.append(Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts")
    else:
        roots.extend(
            [
                Path.home() / ".local" / "share" / "fonts",
                Path.home() / ".fonts",
                Path("/usr/local/share/fonts"),
                Path("/usr/share/fonts"),
            ]
        )
    unique: list[Path] = []
    for root in roots:
        if root.is_dir() and root not in unique:
            unique.append(root)
    return unique


def _find_task_book_checkbox_font(descriptor: EngineDescriptor) -> Path | None:
    candidates = {
        name.casefold() for name in TASK_BOOK_CHECKBOX_FONT_FILENAMES
    }
    for root in _task_book_font_roots(descriptor):
        for path in root.rglob("*"):
            if path.is_file() and path.name.casefold() in candidates:
                return path.resolve()
    return None


def _require_task_book_docx_font(
    document_type: str,
    formats: list[str],
    descriptor: EngineDescriptor,
) -> None:
    if document_type != "task_book" or "docx" not in formats:
        return
    if _find_task_book_checkbox_font(descriptor) is not None:
        return
    raise ExportError(
        "REQUIRED_FONT_MISSING",
        "安装包已内置任务书 Word 勾选框需要的 Wingdings 2 字体。请重新运行最新安装包修复后再导出；PDF 和 LaTeX 导出不受影响。",
        {
            "document_type": "task_book",
            "format": "docx",
            "font_family": "Wingdings 2",
            "candidates": list(TASK_BOOK_CHECKBOX_FONT_FILENAMES),
        },
    )


def _terminate_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name == "nt":
            # latexmk spawns xelatex/bibtex; terminating only the parent leaves
            # orphans that keep writing into the export scratch directory.
            subprocess.run(
                ["taskkill", "/T", "/PID", str(process.pid)],
                capture_output=True,
                check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        else:
            os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=3)
    except (OSError, subprocess.TimeoutExpired):
        try:
            if os.name == "nt":
                process.kill()
            else:
                os.killpg(process.pid, signal.SIGKILL)
        except OSError:
            pass
        process.wait(timeout=3)


_TOOL_STAGES = {
    "pdfinfo": "pdf_structure", "pdffonts": "pdf_fonts",
    "pdftoppm": "preview_rasterize",
}


def _external_reason(output: str) -> str:
    checks = (
        (r"(?:LaTeX Error: File .* not found|I can't find file)", "dependency_missing"),
        (r"fontspec Error|cannot be found.*font|missing.*font", "font_unavailable"),
        (r"Undefined control sequence|Missing \$ inserted|Runaway argument", "tex_input_rejected"),
        (r"Permission denied|Access is denied", "permission_denied"),
        (r"No space left on device|disk full", "disk_full"),
        (r"I can't write on file|Unable to write|Could not write", "output_write_failed"),
        # poppler writes output files with a plain fopen(): UTF-8 arguments are
        # reinterpreted as ANSI, so any non-ASCII output path fails to open.
        (r"couldn't open text file|could not open text file", "tool_path_unsupported"),
        (r"^\s*i/o error", "tool_path_unsupported"),
    )
    for pattern, reason in checks:
        if re.search(pattern, output, flags=re.IGNORECASE):
            return reason
    return "tool_nonzero"


def _friendly_render_failure(output: str) -> str | None:
    """Pick the most actionable explanation out of raw TeX output.

    The UI only shows ``message``; the raw tail stays in details.output_tail so
    diagnostics keep the full evidence without exposing it to the student.
    """

    reason = _external_reason(output)
    dependency = re.search(r"File [`']([^'`]+)[`'] not found", output)
    if reason == "dependency_missing" and dependency:
        name = dependency.group(1)
        return f"编译需要的组件 {name} 没有随安装包提供，请重新运行最新安装包修复。"
    if reason == "dependency_missing":
        return "编译需要的文件没有随安装包提供，请重新运行最新安装包修复。"
    if reason == "font_unavailable":
        return "模板找不到需要的字体。请重新运行最新安装包修复后再试。"
    if reason == "permission_denied":
        return "没有权限写入保存位置或临时目录，请换一个文件夹后重试。"
    if reason == "disk_full":
        return "磁盘空间不足，请清理空间后重试。"
    if reason == "output_write_failed":
        return "无法写入保存位置，请换一个文件夹后重试。"
    if reason == "tool_path_unsupported":
        return "保存位置或临时目录包含中文等特殊字符，请改到英文路径后重试。"
    if re.search(r"TeX capacity exceeded", output, flags=re.IGNORECASE):
        return "文档内容过多，排版时超出了编译器限制，请精简图片或文字后重试。"
    return None


def _run(
    command: list[str], *, cwd: Path, timeout: int = RENDER_TIMEOUT_SECONDS,
    cancellation_file: Path | None = None, environment: dict[str, str] | None = None,
    diagnostic_stage: str | None = None,
) -> str:
    executable = Path(command[0]).stem.lower()
    if executable in _TOOL_STAGES:
        stage, tool = _TOOL_STAGES[executable], executable
    elif diagnostic_stage:
        stage, tool = diagnostic_stage, "python_renderer"
    else:
        stage, tool = "external_render", "other"
    effective_env = _renderer_environment(environment)
    resolved = shutil.which(command[0], path=effective_env.get("PATH"))
    origin = "unresolved"
    if resolved:
        origin = "bundled" if bundled_tool_root(resolved) is not None or (
            getattr(sys, "frozen", False) and Path(resolved) == Path(sys.executable)) else "system"
    with step(stage, tool=tool, tool_source=origin) as evidence:
        if tool == "python_renderer":
            evidence["tool_version"] = platform.python_version()
        elif resolved and emitter.get() is not None and executable in _TOOL_STAGES:
            case = current_case.get()
            prefix = None
            if case is not None:
                case.counter += 1
                prefix = f"tools/{case.counter:03d}"
                case.json(f"{prefix}/invocation.json", {"argv": [resolved, "-v"], "cwd": str(cwd), "environment": effective_env})
            try:
                version_probe = subprocess.run([resolved, "-v"], cwd=cwd, env=effective_env,
                    capture_output=True, timeout=1.5,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
                if case is not None and prefix is not None:
                    case.write(f"{prefix}/stdout.bin", version_probe.stdout)
                    case.write(f"{prefix}/stderr.bin", version_probe.stderr)
                    case.json(f"{prefix}/exit.json", {"exit_code": version_probe.returncode})
                match = re.search(r"(?im)^" + executable + r" version (\d+(?:\.\d+){1,4})",
                                  decode_tool_output(version_probe.stdout + b"\n" + version_probe.stderr))
                if version_probe.returncode == 0 and match:
                    evidence["tool_version"] = match.group(1)
            except (OSError, subprocess.TimeoutExpired) as exc:
                if case is not None and prefix is not None:
                    case.json(f"{prefix}/exit.json", {"exception": repr(exc)})
                    if isinstance(exc, subprocess.TimeoutExpired):
                        case.write(f"{prefix}/stdout.bin", exc.stdout or b"")
                        case.write(f"{prefix}/stderr.bin", exc.stderr or b"")
        return _run_process(command, cwd=cwd, timeout=timeout, cancellation_file=cancellation_file,
                            environment=environment, evidence=evidence)


def _deadline_requested(marker: Path) -> bool:
    try:
        with marker.open("rb") as stream:
            return stream.read(16) == b"timeout\n"
    except OSError:
        return False


def _run_process(
    command: list[str],
    *,
    cwd: Path,
    timeout: int = RENDER_TIMEOUT_SECONDS,
    cancellation_file: Path | None = None,
    environment: dict[str, str] | None = None,
    evidence: dict[str, Any],
) -> str:
    effective_env = _renderer_environment(environment)
    case = current_case.get()
    tool_number = None
    if case is not None:
        case.counter += 1
        tool_number = f"tools/{case.counter:03d}"
        effective_env["SZTU_DOCS_RENDER_EVIDENCE_DIR"] = str(case.path / tool_number / "nested")
        case.json(f"{tool_number}/invocation.json", {
            "argv": command, "cwd": str(cwd), "environment": effective_env,
            "resolved_executable": shutil.which(command[0], path=effective_env.get("PATH")),
            "timeout_seconds": timeout,
        })
    from contextlib import ExitStack

    with ExitStack() as stack:
        raw_stdout = case.raw_stream(f"{tool_number}/stdout.bin") if case is not None and tool_number else None
        raw_stderr = case.raw_stream(f"{tool_number}/stderr.bin") if case is not None and tool_number else None
        for stream in (raw_stdout, raw_stderr):
            if stream is not None:
                stack.enter_context(stream)
        try:
            process = subprocess.Popen(
                command,
                cwd=cwd,
                env=effective_env,
                shell=False,
                stdout=raw_stdout if raw_stdout is not None else subprocess.PIPE,
                stderr=raw_stderr if raw_stderr is not None else subprocess.PIPE,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                start_new_session=os.name != "nt",
            )
        except OSError as exc:
            evidence["reason"] = failure_reason(exc) or "tool_start_failed"
            raise ExportError(
                "RENDER_START_FAILED",
                "编译工具没能启动，可能被安全软件拦截，或编译环境不完整。请先运行环境检查；如果提示编译环境异常，请重新运行最新安装包修复。",
            ) from exc

        if case is not None and tool_number is not None:
            case.json(f"{tool_number}/process.json", {"pid": process.pid})
        deadline = time.monotonic() + timeout
        while True:
            try:
                stdout, stderr = process.communicate(timeout=0.1)
                break
            except subprocess.TimeoutExpired:
                if cancellation_file is not None and cancellation_file.is_file():
                    _terminate_process(process)
                    timed_out = _deadline_requested(cancellation_file)
                    if case is not None and tool_number is not None:
                        case.json(f"{tool_number}/exit.json", {"exit_code": process.returncode, "reason": "timeout" if timed_out else "cancelled"})
                    evidence["reason"] = "tool_timeout" if timed_out else "cancel_requested"
                    _check_cancelled(cancellation_file)
                    raise ExportError("EXPORT_CANCELLED", "已取消本次导出，未保留半成品。")
                if time.monotonic() >= deadline:
                    _terminate_process(process)
                    if case is not None and tool_number is not None:
                        case.json(f"{tool_number}/exit.json", {"exit_code": process.returncode, "reason": "timeout"})
                    evidence["reason"] = "tool_timeout"
                    raise ExportError(
                        "RENDER_TIMEOUT",
                        "编译时间过长，已停止本次导出。可以重试一次；如果反复超时，请减少图片或拆分文档后再试。",
                    )
        if raw_stdout is not None:
            raw_stdout.seek(0)
            stdout = raw_stdout.read()
        if raw_stderr is not None:
            raw_stderr.seek(0)
            stderr = raw_stderr.read()
        if case is not None and tool_number is not None:
            if raw_stdout is None:
                case.write(f"{tool_number}/stdout.bin", stdout)
            if raw_stderr is None:
                case.write(f"{tool_number}/stderr.bin", stderr)
            case.json(f"{tool_number}/exit.json", {"exit_code": process.returncode})
    # Decode only for application-side classification. The capture retains the
    # original bytes, so a Chinese console code page must not turn into U+FFFD.
    stdout = decode_tool_output(stdout).replace("\r\n", "\n").replace("\r", "\n")
    stderr = decode_tool_output(stderr).replace("\r\n", "\n").replace("\r", "\n")
    if case is not None and "Could not retain " in stderr:
        case.missing.append("模板报告有材料写入失败，详细原因见工具标准错误")
    evidence["exit_code"] = process.returncode
    diagnostic = stdout + "\n" + stderr
    xe = re.search(r"(?m)^This is XeTeX, Version ([0-9.]+)", diagnostic) if evidence.get("tool") == "python_renderer" else None
    if xe is not None:
        xe_path = shutil.which("xelatex", path=_renderer_environment(environment).get("PATH"))
        child_exit = re.search(r"returned non-zero exit status (\d{1,5})", diagnostic)
        checkpoint(
            "pdf_compile", "success" if process.returncode == 0 else "failure",
            tool="xelatex", tool_version=xe.group(1),
            tool_source="bundled" if bundled_tool_root(xe_path) is not None
                else "system" if xe_path else "unresolved",
            **({"exit_code": int(child_exit.group(1))} if child_exit else {}),
            **({"reason": _external_reason(diagnostic)} if process.returncode != 0 else {}),
        )
    if process.returncode != 0:
        evidence["reason"] = _external_reason(diagnostic)
        if "SINGLE_PAGE_OVERFLOW" in diagnostic:
            # Renderer diagnostics may contain private text. Only translate
            # allowlisted field identifiers, never forward the diagnostic.
            field = re.search(r"SINGLE_PAGE_OVERFLOW:\s*(?:metadata\.|sections\.)?([a-z_]+)(?=[\s.:]|$)", diagnostic)
            labels = {
                "college": "学院", "major": "专业", "title": "论文题目",
                "student_name": "姓名", "student_id": "学号",
                "advisor": "指导教师", "advisor_title": "指导教师职称",
                "reviewer": "评阅教师", "reviewer_title": "评阅教师职称",
                "comments": "评语", "division_of_work": "分工情况",
                "questions": "答辩问答", "members": "成员名单",
                "final_grade": "最终成绩", "date": "日期",
            }
            label = labels.get(field.group(1)) if field else None
            if label:
                raise ExportError("SINGLE_PAGE_OVERFLOW", f"“{label}”栏超出固定区域，请检查该栏内容后重试。")
            raise ExportError("SINGLE_PAGE_OVERFLOW", "填写内容超出这一页的固定区域，请缩短内容后重新导出。")
        if "尚不能编译" in diagnostic or "Required font" in diagnostic or "缺少必需字体" in diagnostic:
            raise ExportError("REQUIRED_FONT_MISSING", "安装包已内置论文模板需要的字体。请重新运行最新安装包修复后再导出。")
        if "公式命令不受支持" in diagnostic or "公式包含不支持" in diagnostic or "公式花括号不成对" in diagnostic:
            raise ExportError("THESIS_EQUATION_INVALID", "论文公式包含当前预览不支持的数学命令或括号结构，请修改公式源码。")
        if "引用目标不存在" in diagnostic or "引用标记格式无效" in diagnostic or "来源引用的文献不存在" in diagnostic:
            raise ExportError("THESIS_REFERENCE_INVALID", "论文存在失效的图、公式或文献引用，请检查引用目标。")
        if "图片不属于当前工作区" in diagnostic:
            raise ExportError("IMAGE_ASSET_UNAVAILABLE", "论文图片资源不存在或不属于当前工作区，请重新插入图片。")
        if "最终 PDF 仍有未解析引用" in diagnostic:
            raise ExportError("THESIS_PDF_UNRESOLVED", "论文 PDF 仍有未解析引用、缺字或越界内容，请检查正文和参考文献。")
        if "required checkbox font is missing" in diagnostic:
            raise ExportError(
                "REQUIRED_FONT_MISSING",
                "安装包已内置任务书 Word 勾选框需要的 Wingdings 2 字体。请重新运行最新安装包修复后再导出；PDF 和 LaTeX 导出不受影响。",
                {"exit_code": process.returncode},
            )
        if "required official fonts are missing" in diagnostic:
            raise ExportError(
                "REQUIRED_FONT_MISSING",
                "安装包已内置当前模板需要的字体。请重新运行最新安装包修复后再导出。",
                {"exit_code": process.returncode},
            )
        if "No module named 'docx'" in diagnostic or "Pillow is required" in diagnostic:
            raise ExportError(
                "PYTHON_RENDER_DEPENDENCY_MISSING",
                "文档生成组件缺失，请重新安装应用。",
                {"exit_code": process.returncode},
            )
        if (
            "ModuleNotFoundError: No module named 'common.python." in diagnostic
            or "sztu-process-form.tex' not found" in diagnostic
        ):
            raise ExportError(
                "TEMPLATE_ENGINE_INCOMPLETE",
                "模板文件不完整，请重新选择模板。",
                {"exit_code": process.returncode},
            )
        if "texmf.cnf not found" in diagnostic or "can't find the format file" in diagnostic:
            root = portable_tex_root(effective_env.get("PATH", ""))
            unsupported = root is not None and not str(root).isascii()
            raise ExportError(
                "ENGINE_PATH_UNSUPPORTED" if unsupported else "ENGINE_CONFIGURATION_MISSING",
                "编译环境无法读取自己的配置，分页预览和 PDF 导出不可用；请运行最新安装包把编译环境装到 ProgramData 后重启应用。"
                if unsupported
                else "编译环境缺少配置文件或格式文件，分页预览和 PDF 导出不可用；请运行安装包完成修复。",
                {"exit_code": process.returncode, "engine_root": str(root) if root is not None else None},
            )
        reason = _external_reason(diagnostic)
        if reason == "tool_path_unsupported":
            raise ExportError(
                "RENDER_TOOL_PATH_UNSUPPORTED",
                "编译工具无法写入包含中文或其他特殊字符的路径，分页预览和 PDF 导出不可用；请把文档保存到英文路径后重试，并发送诊断包。",
                {"exit_code": process.returncode, "reason": reason},
            )
        raise ExportError(
            "RENDER_FAILED",
            _friendly_render_failure(diagnostic)
            or "文档生成失败，请重试；如果反复失败，请创建诊断包发给维护者。",
            {
                "exit_code": process.returncode,
                # The tail travels with the error so a failed CI run and a
                # student diagnostic both show what the tool actually said.
                "output_tail": diagnostic[-2000:],
            },
        )
    return (stdout + "\n" + stderr)[-20_000:]


def _embedded_fonts(pdffonts_output: str) -> set[str]:
    """Return the font names whose `emb` column reports "yes".

    pdffonts prints: name  type  encoding  emb  sub  uni  object ID. Font names
    may contain spaces, so the trailing six columns are matched from the right.
    """

    embedded: set[str] = set()
    for line in pdffonts_output.splitlines():
        match = re.search(r"\s(yes|no)\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$", line)
        if match is None:
            continue
        if match.group(1) == "yes":
            embedded.add(line[: match.start()].strip())
    return embedded


WINDOWS_MAX_PATH_MARGIN = 240


def _publish_staged_file(staging: Path, destination: Path) -> None:
    """Move a staged artifact into place without ever overwriting a file.

    A hard link is atomic and cheap, but exFAT/FAT32 USB sticks and most network
    shares reject it, so fall back to an exclusive copy in that case.
    """

    try:
        os.link(staging, destination)
        return
    except FileExistsError:
        raise
    except OSError as link_error:
        try:
            with staging.open("rb") as source, destination.open("xb") as target:
                shutil.copyfileobj(source, target)
            return
        except FileExistsError:
            raise
        except OSError:
            raise link_error


@traced("pdf_validation")
def _check_pdf(
    path: Path,
    cancellation_file: Path | None = None,
    document_type: str = "proposal",
) -> list[dict[str, Any]]:
    info = _run(
        ["pdfinfo", str(path)],
        cwd=path.parent,
        timeout=15,
        cancellation_file=cancellation_file,
    )
    if "Page size:" not in info or "A4" not in info:
        raise ExportError("PDF_STRUCTURE_FAILED", "PDF 页面不是 A4。")
    if document_type in ASSESSMENT_DOCUMENT_TYPES:
        pages = re.search(r"^Pages:\s+(\d+)\s*$", info, re.MULTILINE)
        if pages is None or int(pages.group(1)) != 1:
            raise ExportError("SINGLE_PAGE_OVERFLOW", "评审表必须保持一页，请缩短填写内容后重新导出。")
    fonts = _run(
        ["pdffonts", str(path)],
        cwd=path.parent,
        timeout=15,
        cancellation_file=cancellation_file,
    )
    required_fonts = {
        "proposal": ("SimSun", "SimHei", "TimesNewRoman"),
        "midterm": ("FZXBSJW", "SimSun", "TimesNewRoman"),
        "task_book": ("STXingkai", "SimHei", "SimSun", "TimesNewRoman"),
        "thesis": ("SimHei", "SimSun", "TimesNewRoman"),
        **{kind: ("SimHei", "SimSun", "TimesNewRoman") for kind in ASSESSMENT_DOCUMENT_TYPES},
    }[document_type]
    embedded = _embedded_fonts(fonts)
    for required_font in required_fonts:
        if required_font not in fonts:
            raise ExportError(
                "PDF_FONT_FAILED",
                "PDF 未嵌入规定字体，已停止导出。",
                {"font": required_font},
            )
        if not any(required_font in name for name in embedded):
            raise ExportError(
                "PDF_FONT_NOT_EMBEDDED",
                "PDF 使用的规定字体没有嵌入，换一台电脑打开会变形；请安装完整字体后重新导出。",
                {"font": required_font, "embedded": sorted(embedded)},
            )
    return [
        {
            "schema_version": "1.0",
            "check_id": "pdf-structure",
            "gate": "structure",
            "status": "pass",
            "blocking": True,
            "message": "PDF 为 A4 页面并包含规定字体。",
            "checked_at": utc_now(),
        }
    ]


CJK_GATE_MIN_TIMEOUT_SECONDS = 45
CJK_GATE_MAX_TIMEOUT_SECONDS = 300


MAX_PREVIEW_PAGES = 400


def _preview_rasterize_timeout(pdf: Path) -> int:
    """Rasterising a 200-page thesis at 240 dpi takes far longer than a memo."""

    pages = _pdf_page_count(pdf)
    return max(60, min(600, 5 * max(pages, 1)))


def _pdf_page_count(path: Path) -> int:
    """Return the page count, or 0 when pdfinfo cannot be read."""

    try:
        info = _run(["pdfinfo", str(path)], cwd=path.parent, timeout=15)
    except ExportError:
        return 0
    match = re.search(r"^Pages:\s+(\d+)\s*$", info, re.MULTILINE)
    return int(match.group(1)) if match else 0


def _cjk_gate_timeout(path: Path) -> int:
    pages = _pdf_page_count(path)
    # Rasterising every page costs roughly two seconds per page on Windows.
    budget = 15 + 2 * max(pages, 0)
    return max(CJK_GATE_MIN_TIMEOUT_SECONDS, min(CJK_GATE_MAX_TIMEOUT_SECONDS, budget))


@traced("glyph_validation")
def _run_cjk_gate(
    pdf: Path,
    validator: Path,
    cancellation_file: Path | None = None,
) -> dict[str, Any]:
    _run(
        _python_script_command(validator, str(pdf)),
        cwd=pdf.parent,
        timeout=_cjk_gate_timeout(pdf),
        cancellation_file=cancellation_file,
        diagnostic_stage="glyph_validation",
    )
    return {
        "schema_version": "1.0",
        "check_id": "pdf-cjk-glyph",
        "gate": "cjk_glyph",
        "status": "pass",
        "blocking": True,
        "message": "PDF 中文字形检查通过。",
        "checked_at": utc_now(),
    }


def _python_script_command(script: Path, *arguments: str) -> list[str]:
    """Run trusted renderer scripts through source or frozen sidecar Python."""

    if getattr(sys, "frozen", False):
        return [sys.executable, "--run-python-script", str(script), *arguments]
    return [sys.executable, str(script), *arguments]


def _not_checked(check_id: str, gate: str, message: str) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "check_id": check_id,
        "gate": gate,
        "status": "not_checked",
        "blocking": False,
        "message": message,
        "checked_at": None,
    }


@traced("export_input")
def _validate_export_request(
    workspace: Any,
    document_id: str,
    output_directory: str,
    formats: list[str],
    *,
    source_snapshot: tuple[dict[str, Any], dict[str, Any] | None] | None = None,
) -> tuple[Path, dict[str, Any], dict[str, Any], list[str], dict[str, Any] | None]:
    if (
        not isinstance(formats, list)
        or not formats
        or len(formats) != len(set(formats))
        or any(item not in SUPPORTED_FORMATS for item in formats)
    ):
        raise ExportError(
            "INVALID_EXPORT_FORMAT",
            "请选择 Word、PDF、LaTeX 源码包，或它们的组合。",
        )
    record, profile = source_snapshot or capture_export_source(workspace, document_id)
    output = Path(output_directory).expanduser()
    if not output.is_absolute() or not output.is_dir() or output.is_symlink():
        raise ExportError(
            "OUTPUT_DIRECTORY_INVALID",
            "请选择一个已经存在且不是符号链接的本地输出文件夹。",
        )
    output = output.resolve()
    if not os.access(output, os.W_OK):
        raise ExportError(
            "OUTPUT_DIRECTORY_UNWRITABLE",
            "所选输出文件夹不可写。",
        )
    document_type = record["document_type"]
    if document_type == "thesis" and formats != ["pdf"]:
        raise ExportError("INVALID_EXPORT_FORMAT", "毕业论文当前支持 PDF 导出。")
    if document_type not in DOCUMENT_OUTPUT_LABELS or not isinstance(record.get("content"), dict):
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "当前文档尚未保存完整内容。",
        )
    proposal = build_export_document(workspace, record, profile_snapshot=profile)
    record_input("renderer-input.json", proposal)
    validate_document(document_type, proposal)
    ordered_formats = [item for item in SUPPORTED_FORMATS if item in formats]
    return output, record, proposal, ordered_formats, profile


def _preflight_environment_blockers(formats: list[str]) -> list[dict[str, str]]:
    """Cheap environment checks that must pass before rendering starts.

    The expensive xelatex probe stays in `check_environment`; preflight only
    rejects conditions that are guaranteed to fail the export.
    """

    blockers: list[dict[str, str]] = []
    environment = _renderer_environment()
    path = environment.get("PATH", "")
    root = portable_tex_root(path)
    if root is not None and not str(root).isascii():
        blockers.append(
            {
                "code": "ENVIRONMENT_ENGINE_PATH_UNSUPPORTED",
                "message": "编译环境安装在包含中文的路径，PDF 导出不可用；请运行最新安装包修复后重启应用。",
            }
        )
    if "pdf" in formats:
        for tool in ("pdftoppm", "pdftotext"):
            if shutil.which(tool, path=path) is None:
                blockers.append(
                    {
                        "code": "ENVIRONMENT_PDF_TOOLS_MISSING",
                        "message": f"缺少 {tool}，PDF 预览和字形检查不可用；请重新安装应用。",
                    }
                )
    return blockers


@traced("export_preflight")
def preflight_export(
    workspace: Any,
    *,
    document_id: str,
    output_directory: str | None,
    formats: list[str],
    engine: EngineDescriptor | None = None,
    preview_id: str | None = None,
    source_snapshot: tuple[dict[str, Any], dict[str, Any] | None] | None = None,
) -> dict[str, Any]:
    if output_directory is None:
        if (
            not isinstance(formats, list)
            or not formats
            or len(formats) != len(set(formats))
            or any(item not in SUPPORTED_FORMATS for item in formats)
        ):
            raise ExportError("INVALID_EXPORT_FORMAT", "请选择有效的导出格式。")
        record, profile = source_snapshot or capture_export_source(workspace, document_id)
        document_type = record["document_type"]
        if document_type == "thesis" and formats != ["pdf"]:
            raise ExportError("INVALID_EXPORT_FORMAT", "毕业论文当前支持 PDF 导出。")
        if document_type not in DOCUMENT_OUTPUT_LABELS or not isinstance(record.get("content"), dict):
            raise ExportError("DOCUMENT_NOT_READY", "当前文档尚未保存完整内容。")
        proposal = build_export_document(workspace, record, profile_snapshot=profile)
        validate_document(document_type, proposal)
        ordered_formats = [item for item in SUPPORTED_FORMATS if item in formats]
        output = None
    else:
        output, record, proposal, ordered_formats, _profile = _validate_export_request(
            workspace, document_id, output_directory, formats,
            source_snapshot=source_snapshot,
        )
    record_input("renderer-input.json", proposal)
    descriptor = engine or resolve_engine(record["document_type"])
    checkpoint("template", template_version=descriptor.version, document_type=record["document_type"],
               template_source=descriptor.source)
    validate_template_renderability(record["document_type"], proposal, descriptor)
    if preview_id is not None:
        _verified_preview_pdf(
            workspace,
            record=record,
            proposal=proposal,
            descriptor=descriptor,
            preview_id=preview_id,
        )
    _require_task_book_docx_font(
        record["document_type"], ordered_formats, descriptor
    )
    targets: list[dict[str, Any]] = []
    allocated_version = 1
    if output is not None:
        output_filenames, allocated_version = _allocate_output_filenames(
            output, record, ordered_formats
        )
        for format_name in ordered_formats:
            target = output / output_filenames[format_name]
            targets.append(
                {
                    "format": format_name,
                    "filename": target.name,
                    "exists": False,
                }
            )
    environment_blockers = _preflight_environment_blockers(ordered_formats)
    input_sha256 = hashlib.sha256(canonical_json(proposal)).hexdigest()
    token_payload = {
        "document_id": document_id,
        "document_type": record["document_type"],
        "document_revision": record["current_revision"],
        "input_sha256": input_sha256,
        "template_sha256": descriptor.pack_sha256,
        "preview_id": preview_id,
        "formats": ordered_formats,
        "output_directory": str(output) if output is not None else None,
    }
    preflight_token = hashlib.sha256(canonical_json(token_payload)).hexdigest()
    live_workspace = descriptor.source in {
        "development-workspace",
        "environment-workspace",
        "linked-workspace",
    }
    checks = [
        content_check(proposal, record["document_type"], engine=descriptor),
        {
            "schema_version": "1.0",
            "check_id": "environment",
            "gate": "environment",
            "status": "pass" if not environment_blockers else "fail",
            "blocking": True,
            "message": (
                "运行环境可用。"
                if not environment_blockers
                else "运行环境缺少导出所需组件，请先按提示修复。"
            ),
            "details": {"blockers": environment_blockers},
            "checked_at": utc_now(),
        },
        {
            "schema_version": "1.0",
            "check_id": "template-integrity",
            "gate": "template_integrity",
            "status": "pass",
            "blocking": True,
            "message": (
                "模板可用。"
                if live_workspace
                else "模板文件完整性检查通过。"
            ),
            "details": {
                "pack_sha256": descriptor.pack_sha256,
                "source": descriptor.source,
                "live_workspace": live_workspace,
            },
            "checked_at": utc_now(),
        },
        {
            "schema_version": "1.0",
            "check_id": "output-targets",
            "gate": "environment",
            "status": "pass" if output is not None else "not_checked",
            "blocking": False,
            "message": (
                (
                    f"已自动分配第 {allocated_version} 版文件名，不会覆盖已有文件。"
                    if allocated_version > 1
                    else "输出目标可用，不会覆盖已有文件。"
                )
                if output is not None
                else "尚未选择输出目录。"
            ),
            "details": {
                "targets": targets,
                "conflicting_formats": [],
                "allocated_version": allocated_version,
            },
            "checked_at": utc_now() if output is not None else None,
        },
    ]
    return {
        "schema_version": "1.0",
        "ready": not environment_blockers,
        "document_id": document_id,
        "formats": ordered_formats,
        "input_sha256": input_sha256,
        "template": {
            "template_id": descriptor.template_id,
            "version": descriptor.version,
            "pack_sha256": descriptor.pack_sha256,
        },
        "checks": checks,
        "blocking_codes": [item["code"] for item in environment_blockers],
        "preflight_token": preflight_token,
        "expires_at": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(
            timespec="milliseconds"
        ).replace("+00:00", "Z"),
    }


def _create_job(
    workspace: Any,
    document_id: str,
    formats: list[str],
    output: Path,
    *,
    request_id: str,
    proposal: dict[str, Any],
    record: dict[str, Any],
    descriptor: EngineDescriptor,
    overwrite_confirmed: bool,
    profile: dict[str, Any] | None,
) -> str:
    export_id = new_id()
    now = utc_now()
    profile_snapshot = {
        "advisor_title": None,
        "graduation_cohort": None,
        "thesis_title": None,
    }
    if profile is not None:
        profile_snapshot.update(
            {
                "advisor_title": profile.get("advisor_title"),
                "graduation_cohort": profile.get("graduation_cohort"),
                "thesis_title": profile.get("thesis_title"),
            }
        )
    snapshot = {
        "schema_version": "1.0",
        "document_id": document_id,
        "document_type": record["document_type"],
        "document_revision": record["current_revision"],
        "captured_at": now,
        "student_profile": profile_snapshot,
        record["document_type"]: proposal,
    }
    input_sha256 = hashlib.sha256(canonical_json(proposal)).hexdigest()
    with workspace.database.transaction(immediate=True) as connection:
        try:
            insert_job_row(
                connection,
                job_id=export_id,
                document_id=document_id,
                formats_json=encode_json(formats, "formats"),
                status="running",
                progress=5,
                output_directory=str(output),
                now=now,
                request_id=request_id,
                input_sha256=input_sha256,
                template_id=descriptor.template_id,
                template_version=descriptor.version,
                template_sha256=descriptor.pack_sha256,
                snapshot_json=encode_json(snapshot, "snapshot"),
                overwrite_confirmed=overwrite_confirmed,
            )
        except sqlite3.IntegrityError as exc:
            raise ExportError(
                "EXPORT_ALREADY_RUNNING",
                "当前文档已有导出任务正在运行，请等待或先取消。",
            ) from exc
    return export_id


def _fail_job(workspace: Any, export_id: str, code: str) -> None:
    with workspace.database.transaction(immediate=True) as connection:
        fail_job_row(
            connection,
            export_id,
            now=utc_now(),
            error_code=code,
            cancelled=code == "EXPORT_CANCELLED",
        )


def _complete_job(
    workspace: Any,
    export_id: str,
    output: Path,
    artifacts: list[dict[str, Any]],
    receipt: dict[str, Any],
) -> None:
    now = utc_now()
    with workspace.database.transaction(immediate=True) as connection:
        insert_artifact_rows(
            connection,
            export_id,
            [
                {
                    "id": artifact["artifact_id"],
                    "format": artifact["format"],
                    "relative_path": str(Path(artifact["path"]).relative_to(output)),
                    "sha256": artifact["sha256"],
                    "size_bytes": artifact["size_bytes"],
                    "checks_json": encode_json(artifact["checks"], "checks"),
                    "replaced_existing": artifact["replaced_existing"],
                }
                for artifact in artifacts
            ],
            now,
        )
        complete_job_row(
            connection,
            export_id,
            now=now,
            receipt_json=encode_json(receipt, "receipt"),
        )


def _check_cancelled(cancellation_file: Path | None) -> None:
    if cancellation_file is not None and cancellation_file.is_file():
        if _deadline_requested(cancellation_file):
            raise ExportError("RENDER_TIMEOUT", "文档生成超时，已终止本次任务。")
        raise ExportError("EXPORT_CANCELLED", "已取消本次导出，未保留半成品。")


def list_export_history(
    workspace: Any,
    *,
    document_id: str,
    limit: int = 50,
) -> dict[str, Any]:
    workspace.get_document(document_id)
    bounded_limit = max(1, min(limit, 100))
    rows = workspace.database.connection.execute(
        """
        SELECT * FROM export_jobs
        WHERE document_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ?
        """,
        (document_id, bounded_limit),
    ).fetchall()
    history: list[dict[str, Any]] = []
    for row in rows:
        job = dict(row)
        artifacts = []
        artifact_rows = workspace.database.connection.execute(
            "SELECT * FROM export_artifacts WHERE export_job_id = ? ORDER BY format",
            (job["id"],),
        ).fetchall()
        output = Path(job["output_directory"]) if job.get("output_directory") else None
        for artifact_row in artifact_rows:
            artifact = dict(artifact_row)
            target = output / artifact["relative_path"] if output is not None else None
            state = "missing"
            if target is not None and target.is_file() and not target.is_symlink():
                state = "available" if sha256_file(target) == artifact["sha256"] else "modified"
            artifacts.append(
                {
                    "artifact_id": artifact["id"],
                    "format": artifact["format"],
                    "path": str(target) if target is not None else None,
                    "sha256": artifact["sha256"],
                    "size_bytes": artifact["size_bytes"],
                    "file_state": state,
                    "replaced_existing": bool(artifact.get("replaced_existing")),
                    "checks": __import__("json").loads(artifact["checks_json"]),
                }
            )
        history.append(
            {
                "export_id": job["id"],
                "request_id": job.get("request_id"),
                "status": job["status"],
                "progress": job["progress"],
                "error_code": job.get("error_code"),
                "requested_formats": __import__("json").loads(job["requested_formats_json"]),
                "input_sha256": job.get("input_sha256"),
                "template": {
                    "template_id": job.get("template_id"),
                    "version": job.get("template_version"),
                    "pack_sha256": job.get("template_sha256"),
                },
                "snapshot_available": bool(job.get("snapshot_json")),
                "overwrite_confirmed": bool(job.get("overwrite_confirmed")),
                "artifacts": artifacts,
                "created_at": job["created_at"],
                "completed_at": job.get("completed_at"),
            }
        )
    return {"schema_version": "1.0", "history": history}


def delete_export_history_record(
    workspace: Any,
    *,
    document_id: str,
    export_id: str,
) -> dict[str, Any]:
    """Delete one terminal export record without touching its exported files."""

    workspace.get_document(document_id)
    with workspace.database.transaction(immediate=True) as connection:
        row = connection.execute(
            "SELECT status FROM export_jobs WHERE id = ? AND document_id = ?",
            (export_id, document_id),
        ).fetchone()
        if row is None:
            raise ExportError("EXPORT_HISTORY_NOT_FOUND", "未找到该导出记录。")
        if row["status"] in {"queued", "running"}:
            raise ExportError("EXPORT_HISTORY_ACTIVE", "正在进行的导出不能删除记录。")
        connection.execute(
            "DELETE FROM export_jobs WHERE id = ? AND document_id = ?",
            (export_id, document_id),
        )
    return {"export_id": export_id, "deleted": True}


def resolve_artifact(workspace: Any, *, artifact_id: str) -> dict[str, Any]:
    row = workspace.database.connection.execute(
        """
        SELECT a.*, j.output_directory
        FROM export_artifacts AS a
        JOIN export_jobs AS j ON j.id = a.export_job_id
        WHERE a.id = ? AND j.status = 'completed'
        """,
        (artifact_id,),
    ).fetchone()
    if row is None:
        raise ExportError("ARTIFACT_NOT_FOUND", "未找到可打开的导出文件。")
    artifact = dict(row)
    output = Path(artifact["output_directory"]).resolve(strict=False)
    unresolved = output / artifact["relative_path"]
    if unresolved.is_symlink():
        raise ExportError("ARTIFACT_PATH_INVALID", "导出文件路径无效。")
    target = unresolved.resolve(strict=False)
    try:
        target.relative_to(output)
    except ValueError as exc:
        raise ExportError("ARTIFACT_PATH_INVALID", "导出文件路径无效。") from exc
    if target.is_symlink() or not target.is_file():
        raise ExportError("ARTIFACT_MISSING", "导出文件已被移动或删除。")
    if sha256_file(target) != artifact["sha256"]:
        raise ExportError("ARTIFACT_MODIFIED", "导出文件已在外部修改，请重新导出后打开。")
    return {
        "artifact_id": artifact_id,
        "absolute_path": str(target),
        "sha256": artifact["sha256"],
        "verified": True,
    }


def _cached_preview_result(
    preview_directory: Path,
    *,
    preview_id: str,
    document_id: str,
    document_revision: int,
    cache_key: str,
    input_sha256: str,
    descriptor: EngineDescriptor,
) -> dict[str, Any] | None:
    if (
        not preview_directory.is_dir()
        or preview_directory.is_symlink()
        or preview_directory.name != preview_id
    ):
        return None
    manifest_path = preview_directory / "manifest.json"
    if not manifest_path.is_file() or manifest_path.is_symlink():
        return None
    try:
        if manifest_path.stat().st_size > 1_048_576:
            return None
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(manifest, dict) or set(manifest) != {
        "schema_version",
        "cache_key",
        "input_sha256",
        "template",
        "pdf",
        "pages",
        "checks",
        "generated_at",
    }:
        return None
    expected_template = {
        "template_id": descriptor.template_id,
        "version": descriptor.version,
        "pack_sha256": descriptor.pack_sha256,
    }
    if (
        manifest.get("schema_version") != PREVIEW_CACHE_SCHEMA_VERSION
        or manifest.get("cache_key") != cache_key
        or manifest.get("input_sha256") != input_sha256
        or manifest.get("template") != expected_template
        or not isinstance(manifest.get("checks"), list)
        or not isinstance(manifest.get("generated_at"), str)
    ):
        return None

    def cached_artifact(value: Any) -> dict[str, Any] | None:
        if not isinstance(value, dict) or set(value) != {
            "filename",
            "sha256",
            "size_bytes",
        }:
            return None
        filename = value.get("filename")
        expected_sha256 = value.get("sha256")
        expected_size = value.get("size_bytes")
        if (
            not isinstance(filename, str)
            or Path(filename).name != filename
            or not isinstance(expected_sha256, str)
            or re.fullmatch(r"[0-9a-f]{64}", expected_sha256) is None
            or isinstance(expected_size, bool)
            or not isinstance(expected_size, int)
            or expected_size < 1
        ):
            return None
        path = preview_directory / filename
        if not path.is_file() or path.is_symlink():
            return None
        try:
            if path.stat().st_size != expected_size or sha256_file(path) != expected_sha256:
                return None
        except OSError:
            return None
        return {
            "absolute_path": str(path.resolve()),
            "sha256": expected_sha256,
            "size_bytes": expected_size,
        }

    pdf = cached_artifact(manifest.get("pdf"))
    raw_pages = manifest.get("pages")
    if pdf is None or not isinstance(raw_pages, list) or not 1 <= len(raw_pages) <= MAX_PREVIEW_PAGES:
        return None
    if descriptor.document_type in ASSESSMENT_DOCUMENT_TYPES and len(raw_pages) != 1:
        return None
    pages: list[dict[str, Any]] = []
    for index, raw_page in enumerate(raw_pages, start=1):
        if not isinstance(raw_page, dict) or raw_page.get("page_number") != index:
            return None
        artifact = cached_artifact(
            {key: value for key, value in raw_page.items() if key != "page_number"}
        )
        if artifact is None:
            return None
        pages.append({"page_number": index, **artifact})
    return {
        "schema_version": PREVIEW_CACHE_SCHEMA_VERSION,
        "preview_id": preview_id,
        "document_id": document_id,
        "document_revision": document_revision,
        "input_sha256": input_sha256,
        "template": expected_template,
        "pdf": pdf,
        "pages": pages,
        "checks": manifest["checks"],
        "generated_at": manifest["generated_at"],
    }


@traced("preview_cache")
def _verified_preview_pdf(
    workspace: Any,
    *,
    record: dict[str, Any],
    proposal: dict[str, Any],
    descriptor: EngineDescriptor,
    preview_id: str,
) -> Path:
    data_directory = workspace.database.data_directory
    if workspace.is_temporary or data_directory is None:
        raise ExportError("PREVIEW_UNAVAILABLE", "当前工作区无法复用排版预览。")
    input_sha256 = hashlib.sha256(canonical_json(proposal)).hexdigest()
    cache_key, expected_preview_id = _preview_cache_identity(
        record["id"], input_sha256, descriptor.pack_sha256
    )
    if preview_id != expected_preview_id:
        raise ExportError(
            "PREVIEW_STALE",
            "排版预览与当前内容或模板不一致，请重新生成预览。",
        )
    previews_root = (data_directory / "previews").resolve(strict=False)
    document_root = (previews_root / record["id"]).resolve(strict=False)
    preview_directory = (document_root / preview_id).resolve(strict=False)
    if preview_directory.parent != document_root or document_root.parent != previews_root:
        raise ExportError("PREVIEW_PATH_INVALID", "预览缓存路径无效。")
    cached = _cached_preview_result(
        preview_directory,
        preview_id=preview_id,
        document_id=record["id"],
        document_revision=record["current_revision"],
        cache_key=cache_key,
        input_sha256=input_sha256,
        descriptor=descriptor,
    )
    if cached is None:
        raise ExportError(
            "PREVIEW_UNAVAILABLE",
            "当前排版预览已失效或不可用，请重新生成预览。",
        )
    pdf_path = Path(cached["pdf"]["absolute_path"]).resolve(strict=False)
    if pdf_path.parent != preview_directory or not pdf_path.is_file() or pdf_path.is_symlink():
        raise ExportError("PREVIEW_PATH_INVALID", "预览 PDF 路径无效。")
    return pdf_path


@traced("preview_publish")
def _write_preview_manifest(
    preview_directory: Path,
    *,
    cache_key: str,
    result: dict[str, Any],
) -> None:
    pdf = result["pdf"]
    pages = result["pages"]
    manifest = {
        "schema_version": PREVIEW_CACHE_SCHEMA_VERSION,
        "cache_key": cache_key,
        "input_sha256": result["input_sha256"],
        "template": result["template"],
        "pdf": {
            "filename": Path(pdf["absolute_path"]).name,
            "sha256": pdf["sha256"],
            "size_bytes": pdf["size_bytes"],
        },
        "pages": [
            {
                "page_number": page["page_number"],
                "filename": Path(page["absolute_path"]).name,
                "sha256": page["sha256"],
                "size_bytes": page["size_bytes"],
            }
            for page in pages
        ],
        "checks": result["checks"],
        "generated_at": result["generated_at"],
    }
    manifest_path = preview_directory / "manifest.json"
    temporary_path = preview_directory / ".manifest.json.tmp"
    temporary_path.write_bytes(canonical_json(manifest))
    protect_private_file(temporary_path)
    os.replace(temporary_path, manifest_path)
    protect_private_file(manifest_path)


@traced("preview")
def generate_preview(
    workspace: Any,
    *,
    document_id: str,
    request_id: str,
    cancellation_file: str | None = None,
    app_version: str = "unknown",
) -> dict[str, Any]:
    """Render a private PDF preview without adding an export-history record."""

    data_directory = workspace.database.data_directory
    if workspace.is_temporary or data_directory is None:
        raise ExportError(
            "PREVIEW_UNAVAILABLE",
            "排版预览只支持持久本地工作区。",
        )
    try:
        canonical_request = str(uuid.UUID(request_id))
    except (ValueError, AttributeError) as exc:
        raise ExportError("INVALID_REQUEST_ID", "预览请求标识无效。") from exc
    if canonical_request != request_id.lower():
        raise ExportError("INVALID_REQUEST_ID", "预览请求标识无效。")

    source_record, source_profile = capture_export_source(workspace, document_id)
    source_content = source_record.get("content")
    if not isinstance(source_content, dict):
        raise ExportError("DOCUMENT_NOT_READY", "当前文档尚未保存完整内容。")
    descriptor = resolve_engine(source_record["document_type"])
    checkpoint("template", template_version=descriptor.version, document_type=source_record["document_type"],
               template_source=descriptor.source)
    proposal = build_export_document(
        workspace, source_record, profile_snapshot=source_profile
    )
    if not isinstance(proposal, dict):
        raise ExportError("DOCUMENT_NOT_READY", "当前文档尚未保存完整内容。")
    record_input("renderer-input.json", proposal)
    input_sha256 = hashlib.sha256(canonical_json(proposal)).hexdigest()
    cache_key, preview_id = _preview_cache_identity(
        document_id,
        input_sha256,
        descriptor.pack_sha256,
    )
    previews_root = (data_directory / "previews").resolve(strict=False)
    document_root = (previews_root / document_id).resolve(strict=False)
    preview_directory = (document_root / preview_id).resolve(strict=False)
    if preview_directory.parent != document_root or document_root.parent != previews_root:
        raise ExportError("PREVIEW_PATH_INVALID", "预览缓存路径无效。")
    document_root.mkdir(parents=True, mode=0o700, exist_ok=True)
    cached = _cached_preview_result(
        preview_directory,
        preview_id=preview_id,
        document_id=document_id,
        document_revision=source_record["current_revision"],
        cache_key=cache_key,
        input_sha256=input_sha256,
        descriptor=descriptor,
    )
    if cached is not None:
        checkpoint("preview_cache", reason="cache_hit")
        case = current_case.get()
        if case is not None:
            case.tree("preview-work", preview_directory)
        return cached
    checkpoint("preview_cache", reason="cache_miss")
    if preview_directory.exists():
        if preview_directory.is_symlink() or not preview_directory.is_dir():
            raise ExportError("PREVIEW_PATH_INVALID", "预览缓存路径无效。")
        shutil.rmtree(preview_directory)
    preview_directory.mkdir(parents=True, mode=0o700, exist_ok=False)

    try:
        from .storage import Workspace

        with Workspace.create_temporary() as preview_workspace:
            profile_id = None
            if source_profile is not None:
                preview_profile = preview_workspace.save_profile(
                    {
                        key: source_profile.get(key)
                        for key in (
                            "full_name",
                            "student_number",
                            "college",
                            "major",
                            "class_name",
                            "advisor_name",
                            "advisor_title",
                            "graduation_cohort",
                            "thesis_title",
                            "thesis_title_en",
                        )
                    }
                )
                profile_id = preview_profile["id"]
            preview_document = preview_workspace.create_document(
                {
                    "profile_id": profile_id,
                    "document_type": source_record["document_type"],
                    "template_version": source_record["template_version"],
                    "schema_version": source_record["schema_version"],
                    "title": source_record["title"],
                }
            )
            preview_workspace.save_draft(
                preview_document["id"], source_content, 0, reason="import"
            )
            receipt = run_export(
                preview_workspace,
                document_id=preview_document["id"],
                output_directory=str(preview_directory),
                formats=["pdf"],
                engine=descriptor,
                request_id=request_id,
                cancellation_file=cancellation_file,
                app_version=app_version,
                asset_directory=data_directory / "document-assets",
            )

        pdf_artifact = next(
            (
                artifact
                for artifact in receipt.get("artifacts", [])
                if artifact.get("format") == "pdf"
            ),
            None,
        )
        if not isinstance(pdf_artifact, dict):
            raise ExportError("PREVIEW_RENDER_FAILED", "预览 PDF 未生成。")
        pdf_path = Path(str(pdf_artifact.get("path", ""))).resolve(strict=False)
        if pdf_path.parent != preview_directory or not pdf_path.is_file() or pdf_path.is_symlink():
            raise ExportError("PREVIEW_PATH_INVALID", "预览 PDF 路径无效。")

        page_prefix = preview_directory / "page"
        _run(
            [
                "pdftoppm",
                "-png",
                "-r",
                str(PREVIEW_RENDER_DPI),
                str(pdf_path),
                str(page_prefix),
            ],
            cwd=preview_directory,
            timeout=_preview_rasterize_timeout(pdf_path),
            cancellation_file=Path(cancellation_file) if cancellation_file else None,
        )
        page_pattern = re.compile(r"^page-(\d+)\.png$")
        page_paths = sorted(
            (
                (int(match.group(1)), candidate)
                for candidate in preview_directory.iterdir()
                if candidate.is_file()
                and not candidate.is_symlink()
                and (match := page_pattern.fullmatch(candidate.name)) is not None
            ),
            key=lambda item: item[0],
        )
        if not page_paths or len(page_paths) > MAX_PREVIEW_PAGES:
            raise ExportError(
                "PREVIEW_RENDER_FAILED",
                f"预览页面数量超过 {MAX_PREVIEW_PAGES} 页上限。",
            )
        if [number for number, _ in page_paths] != list(range(1, len(page_paths) + 1)):
            raise ExportError("PREVIEW_RENDER_FAILED", "预览页面序号不连续。")

        result = {
            "schema_version": PREVIEW_CACHE_SCHEMA_VERSION,
            "preview_id": preview_id,
            "document_id": document_id,
            "document_revision": source_record["current_revision"],
            "input_sha256": receipt["input_sha256"],
            "template": receipt["template"],
            "pdf": {
                "absolute_path": str(pdf_path),
                "sha256": sha256_file(pdf_path),
                "size_bytes": pdf_path.stat().st_size,
            },
            "pages": [
                {
                    "page_number": number,
                    "absolute_path": str(page_path.resolve()),
                    "sha256": sha256_file(page_path),
                    "size_bytes": page_path.stat().st_size,
                }
                for number, page_path in page_paths
            ],
            "checks": receipt["checks"],
            "generated_at": receipt["generated_at"],
        }
        if (
            result["input_sha256"] != input_sha256
            or result["template"]
            != {
                "template_id": descriptor.template_id,
                "version": descriptor.version,
                "pack_sha256": descriptor.pack_sha256,
            }
        ):
            raise ExportError("PREVIEW_RENDER_FAILED", "预览输入与当前内容不一致。")
        _write_preview_manifest(
            preview_directory,
            cache_key=cache_key,
            result=result,
        )

        for old_preview in document_root.iterdir():
            if old_preview == preview_directory or old_preview.is_symlink():
                continue
            try:
                uuid.UUID(old_preview.name)
            except ValueError:
                continue
            if old_preview.is_dir():
                shutil.rmtree(old_preview)

        case = current_case.get()
        if case is not None:
            case.tree("preview-work", preview_directory)
        return result
    except Exception:
        case = current_case.get()
        if case is not None:
            case.tree("preview-work", preview_directory)
        shutil.rmtree(preview_directory, ignore_errors=True)
        raise


def record_qa(
    workspace: Any,
    *,
    export_id: str,
    artifact_id: str | None,
    gate: str,
    status: str,
    editor: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    if gate not in {"full_page_layout", "target_editor"} or status not in {"pass", "fail"}:
        raise ExportError("INVALID_QA_RECORD", "目标编辑器验收记录无效。")
    supported_editors = {"Microsoft Word", "WPS Office", "TeXstudio", "Texifier"}
    if gate == "target_editor" and editor not in supported_editors:
        raise ExportError("INVALID_QA_RECORD", "目标编辑器验收必须声明编辑器。")
    if gate == "full_page_layout" and editor is not None:
        raise ExportError("INVALID_QA_RECORD", "逐页版式验收不声明编辑器。")
    if notes is not None and (not isinstance(notes, str) or len(notes) > 1000):
        raise ExportError("INVALID_QA_RECORD", "验收说明无效。")
    job = workspace.database.connection.execute(
        "SELECT receipt_json, status FROM export_jobs WHERE id = ?",
        (export_id,),
    ).fetchone()
    if job is None or job["status"] != "completed":
        raise ExportError("EXPORT_NOT_FOUND", "未找到已完成的导出记录。")
    if artifact_id is None:
        rows = workspace.database.connection.execute(
            "SELECT id, format, checks_json FROM export_artifacts WHERE export_job_id = ?",
            (export_id,),
        ).fetchall()
    else:
        rows = workspace.database.connection.execute(
            """
            SELECT id, format, checks_json FROM export_artifacts
            WHERE id = ? AND export_job_id = ?
            """,
            (artifact_id, export_id),
        ).fetchall()
    if not rows:
        raise ExportError("ARTIFACT_NOT_FOUND", "未找到对应的导出文件。")
    if gate == "target_editor" and (
        artifact_id is None or len(rows) != 1 or rows[0]["format"] != "docx"
    ):
        raise ExportError("INVALID_QA_RECORD", "目标编辑器验收仅适用于指定的 Word 文件。")
    editor_slug = {
        "Microsoft Word": "word",
        "WPS Office": "wps",
        "TeXstudio": "texstudio",
        "Texifier": "texifier",
    }.get(editor or "")
    check_id = "full-page-layout" if gate == "full_page_layout" else f"target-editor-{editor_slug}"
    recorded_at = utc_now()
    message = (notes or "").strip() or (
        "已逐页检查本次导出文件的完整页面版式。"
        if gate == "full_page_layout"
        else f"已在 {editor} 中检查本次 Word 导出文件。"
    )
    check = {
        "schema_version": "1.0",
        "check_id": check_id,
        "gate": gate,
        "status": status,
        "blocking": True,
        "message": message,
        "details": {"editor": editor} if editor is not None else {},
        "checked_at": recorded_at,
    }
    with workspace.database.transaction(immediate=True) as connection:
        for row in rows:
            checks = __import__("json").loads(row["checks_json"])
            checks = [
                item
                for item in checks
                if item.get("check_id") not in {check_id, "target-editor"}
                and not (gate == "full_page_layout" and item.get("check_id") == "full-page-layout")
            ]
            checks.append(check)
            connection.execute(
                "UPDATE export_artifacts SET checks_json = ? WHERE id = ?",
                (encode_json(checks, "checks"), row["id"]),
            )
        if job["receipt_json"]:
            receipt = __import__("json").loads(job["receipt_json"])
            receipt_checks = [
                item
                for item in receipt.get("checks", [])
                if item.get("check_id") not in {check_id, "target-editor"}
                and not (gate == "full_page_layout" and item.get("check_id") == "full-page-layout")
            ]
            receipt_checks.append(check)
            receipt["checks"] = receipt_checks
            connection.execute(
                "UPDATE export_jobs SET receipt_json = ?, updated_at = ? WHERE id = ?",
                (encode_json(receipt, "receipt"), recorded_at, export_id),
            )
    return {
        "record_id": new_id(),
        "export_id": export_id,
        "artifact_id": artifact_id,
        "check": check,
        "recorded_at": recorded_at,
    }


@traced("export")
def run_export(
    workspace: Any,
    *,
    document_id: str,
    output_directory: str,
    formats: list[str],
    engine: EngineDescriptor | None = None,
    overwrite_confirmed: bool = False,
    request_id: str | None = None,
    cancellation_file: str | None = None,
    app_version: str = "unknown",
    preflight_token: str | None = None,
    preview_id: str | None = None,
    asset_directory: Path | None = None,
) -> dict[str, Any]:
    output, record, proposal, ordered_formats, profile = _validate_export_request(
        workspace, document_id, output_directory, formats
    )
    record_input("renderer-input.json", proposal)
    descriptor = engine or resolve_engine(record["document_type"])
    checkpoint("template", template_version=descriptor.version, document_type=record["document_type"],
               template_source=descriptor.source)
    with step("content_validation"):
        validate_template_renderability(record["document_type"], proposal, descriptor)
    _require_task_book_docx_font(
        record["document_type"], ordered_formats, descriptor
    )
    preview_pdf = (
        _verified_preview_pdf(
            workspace,
            record=record,
            proposal=proposal,
            descriptor=descriptor,
            preview_id=preview_id,
        )
        if preview_id is not None
        else None
    )
    case = current_case.get()
    if case is not None and preview_pdf is not None:
        case.file("cached-preview.pdf", preview_pdf)
    if preflight_token is not None:
        current_preflight = preflight_export(
            workspace,
            document_id=document_id,
            output_directory=str(output),
            formats=ordered_formats,
            engine=descriptor,
            preview_id=preview_id,
            source_snapshot=(record, profile),
        )
        if current_preflight["preflight_token"] != preflight_token:
            raise ExportError(
                "PREFLIGHT_STALE",
                "导出内容或目标文件在预检后发生变化，请重新确认。",
            )
    request_id = request_id or str(uuid.uuid4())
    try:
        if str(uuid.UUID(request_id)) != request_id.lower():
            raise ValueError
    except (ValueError, AttributeError) as exc:
        raise ExportError(
            "INVALID_REQUEST_ID", "导出请求标识无效。"
        ) from exc
    cancel_path = None
    if cancellation_file is not None:
        candidate = Path(cancellation_file).expanduser()
        if not candidate.is_absolute() or candidate.is_symlink():
            raise ExportError("INVALID_CANCEL_PATH", "取消控制文件路径无效。")
        cancel_path = candidate.resolve(strict=False)
        data_directory = workspace.database.data_directory
        if data_directory is not None:
            allowed_parent = (data_directory / "cancellations").resolve(strict=False)
            if cancel_path.parent != allowed_parent:
                raise ExportError("INVALID_CANCEL_PATH", "取消控制文件不属于当前工作区。")

    input_sha256 = hashlib.sha256(canonical_json(proposal)).hexdigest()
    export_id = _create_job(
        workspace,
        document_id,
        ordered_formats,
        output,
        request_id=request_id,
        proposal=proposal,
        record=record,
        descriptor=descriptor,
        overwrite_confirmed=overwrite_confirmed,
        profile=profile,
    )
    placements: list[tuple[Path, Path | None]] = []
    staged_paths: list[Path] = []

    try:
        with tempfile.TemporaryDirectory(prefix=f"sztu-export-{export_id[:12]}-") as temp, capture_workspace("render-work", Path(temp)):
            work = Path(temp)
            data_path = work / f"{record['document_type']}.json"
            with step("render_input_write"):
                data_path.write_bytes(canonical_json(proposal))
            generated: dict[str, Path] = {}
            live_workspace = descriptor.source in {
                "development-workspace",
                "environment-workspace",
                "linked-workspace",
            }
            checks: list[dict[str, Any]] = [
                content_check(proposal, record["document_type"], engine=descriptor),
                {
                    "schema_version": "1.0",
                    "check_id": "template-integrity",
                    "gate": "template_integrity",
                    "status": "pass",
                    "blocking": True,
                    "message": (
                        "模板可用。"
                        if live_workspace
                        else "模板文件完整性检查通过。"
                    ),
                    "evidence": [
                        {"kind": "hash", "value": descriptor.pack_sha256},
                    ],
                    "details": {
                        "source": descriptor.source,
                        "live_workspace": live_workspace,
                    },
                    "checked_at": utc_now(),
                },
            ]

            if "docx" in ordered_formats:
                _check_cancelled(cancel_path)
                docx_path = work / f"{record['document_type']}.docx"
                assessment_spec = descriptor.root / "spec/layout.json"
                effective_layout_path = None
                layout_arguments: list[str] = []
                if record["document_type"] in ASSESSMENT_DOCUMENT_TYPES and _template_json_object(assessment_spec, relative_name="spec/layout.json").get("word", {}).get("effective_layout_report"):
                    effective_layout_path = work / "effective-layout.json"
                    layout_arguments = ["--layout-output", str(effective_layout_path)]
                _run(
                    _python_script_command(
                        descriptor.root / "word" / "render.py",
                        "--data",
                        str(data_path),
                        "--output",
                        str(docx_path),
                        "--overwrite",
                        *layout_arguments,
                    ),
                    cwd=work,
                    cancellation_file=cancel_path,
                    environment=_engine_renderer_environment(descriptor),
                    diagnostic_stage="word_render",
                )
                try:
                    from .docx_inspector import DocxInspectionError, inspect_docx

                    # Load shared rules lazily: inspection owns their use; mocked
                    # inspectors do not need a complete template filesystem.
                    shared_module = None
                    def normalize_expected(value: Any, field: str, maximum: int, **options: Any) -> Any:
                        nonlocal shared_module
                        if shared_module is None:
                            import importlib.util
                            shared_content = descriptor.root.parent / "common" / "python" / "content.py"
                            spec = importlib.util.spec_from_file_location("_trusted_docx_content", shared_content)
                            if spec is None or spec.loader is None:
                                raise ExportError("DOCX_EXPECTATION_INVALID", "无法载入模板共用内容规则。")
                            shared_module = importlib.util.module_from_spec(spec)
                            spec.loader.exec_module(shared_module)
                        return shared_module.normalize_paragraph(value, field, maximum, **options)
                    with step("docx_inspection"):
                        checks.append(
                            inspect_docx(
                                docx_path,
                                proposal,
                                document_type=record["document_type"],
                                normalize_paragraph=normalize_expected,
                                layout=_assessment_docx_layout(assessment_spec, data_path, effective_layout_path) if record["document_type"] in ASSESSMENT_DOCUMENT_TYPES else None,
                            )
                        )
                except DocxInspectionError as exc:
                    raise ExportError(exc.code, exc.message, exc.details) from exc
                except ExportError:
                    raise
                except Exception as exc:
                    raise ExportError(
                        "DOCX_STRUCTURE_FAILED",
                        "Word 文件未通过深层结构检查。",
                        {"reason": type(exc).__name__},
                    ) from exc
                generated["docx"] = docx_path

            if "tex" in ordered_formats or (
                "pdf" in ordered_formats and preview_pdf is None
            ):
                _check_cancelled(cancel_path)
                latex_dir = work / "latex"
                latex_command = _python_script_command(
                    descriptor.root / "latex" / "render.py",
                    "--data",
                    str(data_path),
                    "--output-dir",
                    str(latex_dir),
                    "--overwrite",
                )
                if "pdf" in ordered_formats and preview_pdf is None:
                    latex_command.append("--compile")
                if record["document_type"] == "thesis":
                    assets_root = asset_directory or (
                        workspace.database.data_directory / "document-assets"
                        if workspace.database.data_directory is not None else None
                    )
                    if assets_root is None:
                        raise ExportError("IMAGE_ASSET_UNAVAILABLE", "论文图片资源目录不可用。")
                    latex_command.extend(["--assets-root", str(assets_root)])
                _run(
                    latex_command,
                    cwd=work,
                    cancellation_file=cancel_path,
                    environment=_engine_renderer_environment(descriptor),
                    timeout=300 if record["document_type"] == "thesis" else RENDER_TIMEOUT_SECONDS,
                    diagnostic_stage="pdf_compile" if "pdf" in ordered_formats and preview_pdf is None else "latex_source",
                )

            if "pdf" in ordered_formats:
                pdf_path = preview_pdf or (latex_dir / "main.pdf")
                checks.extend(
                    _check_pdf(
                        pdf_path,
                        cancel_path,
                        document_type=record["document_type"],
                    )
                )
                checks.append(_run_cjk_gate(pdf_path, descriptor.validator, cancel_path))
                generated["pdf"] = pdf_path

            if "tex" in ordered_formats:
                _check_cancelled(cancel_path)
                bundle_path = work / f"{record['document_type']}-latex.zip"
                try:
                    from .latex_bundle import build_latex_bundle

                    checks.append(
                        build_latex_bundle(
                            latex_dir,
                            data_path,
                            bundle_path,
                            document_type=record["document_type"],
                        )
                    )
                except ExportError:
                    raise
                except Exception as exc:
                    raise ExportError(
                        "LATEX_BUNDLE_FAILED",
                        "LaTeX 源码包生成失败。",
                        {"reason": type(exc).__name__},
                    ) from exc
                generated["tex"] = bundle_path

            if any(item in ordered_formats for item in ("docx", "pdf")):
                checks.append(
                    _not_checked(
                        "full-page-layout",
                        "full_page_layout",
                        "文件已生成；逐页视觉检查尚未由人工确认。",
                    )
                )
            if "docx" in ordered_formats:
                checks.append(
                    _not_checked(
                        "target-editor",
                        "target_editor",
                        "Word/WPS 目标编辑器尚未确认本次导出。",
                    )
                )

            output_filenames, _allocated_version = _allocate_output_filenames(
                output, record, ordered_formats
            )
            artifacts: list[dict[str, Any]] = []
            with step("output_write"):
                for format_name in ordered_formats:
                    _check_cancelled(cancel_path)
                    source = generated[format_name]
                    destination = output / output_filenames[format_name]
                    if destination.is_symlink():
                        raise ExportError(
                            "OUTPUT_TARGET_INVALID",
                            "目标文件不能是符号链接。",
                            {"format": format_name},
                        )
                    staging = output / f".sztu-{export_id}-{format_name}.tmp"
                    staged_paths.append(staging)
                    try:
                        with source.open("rb") as source_stream, staging.open("xb") as target_stream:
                            shutil.copyfileobj(source_stream, target_stream)
                    except FileExistsError as exc:
                        raise ExportError(
                            "OUTPUT_STAGING_CONFLICT",
                            "输出目录中存在冲突的临时文件。",
                        ) from exc
                    except Exception:
                        case = current_case.get()
                        if case is not None and staging.is_file():
                            case.file(f"output-staging/{format_name}.partial", staging)
                        staging.unlink(missing_ok=True)
                        raise
                    if os.name == "nt" and len(str(destination)) >= WINDOWS_MAX_PATH_MARGIN:
                        raise ExportError(
                            "OUTPUT_PATH_TOO_LONG",
                            "导出路径过长，Windows 无法写入；请缩短目标文件夹或文件名后重试。",
                            {"format": format_name, "path_length": len(str(destination))},
                        )
                    try:
                        _publish_staged_file(staging, destination)
                    except OSError as exc:
                        case = current_case.get()
                        if case is not None and staging.is_file():
                            case.file(f"output-staging/{format_name}.partial", staging)
                        if isinstance(exc, FileExistsError):
                            raise ExportError(
                                "OUTPUT_TARGET_RACE",
                                "输出文件名刚被其他程序占用，请重新导出以自动使用下一版本号。",
                                {"format": format_name},
                            ) from exc
                        raise ExportError(
                            "OUTPUT_TARGET_UNSUPPORTED",
                            "输出位置不支持直接写入（例如 U 盘或网络盘），请改存到本机文件夹后重试。",
                            {"format": format_name, "reason": str(exc)},
                        ) from exc
                    finally:
                        staging.unlink(missing_ok=True)
                    placements.append((destination, None))
                    shared_check_ids = {"full-page-layout"}
                    if format_name == "docx":
                        format_check_ids = {"docx-deep-structure", "docx-structure", "target-editor"}
                    elif format_name == "pdf":
                        format_check_ids = {"pdf-structure", "pdf-cjk-glyph"}
                    else:
                        format_check_ids = {"latex-bundle-structure", "latex-bundle"}
                    artifact_checks = [
                        check
                        for check in checks
                        if check["check_id"] in shared_check_ids | format_check_ids
                    ]
                    artifacts.append(
                        {
                            "artifact_id": new_id(),
                            "format": format_name,
                            "path": str(destination),
                            "sha256": sha256_file(destination),
                            "size_bytes": destination.stat().st_size,
                            "checks": artifact_checks,
                            "replaced_existing": False,
                        }
                    )

            case = current_case.get()
            if case is not None:
                case.tree("render-work", work)

        generated_at = utc_now()
        runtime_check = {
            "schema_version": "1.0",
            "check_id": "runtime-environment",
            "gate": "environment",
            "status": "pass",
            "blocking": True,
            "message": "本地导出进程正常完成。",
            "details": {
                "backend_version": BACKEND_VERSION,
                "app_version": app_version,
                "document_schema_version": record["schema_version"],
                "system": platform.system(),
                "system_release": platform.release(),
                "machine": platform.machine(),
                "python": platform.python_version(),
            },
            "checked_at": generated_at,
        }
        receipt = {
            "schema_version": "1.0",
            "export_id": export_id,
            "request_id": request_id,
            "status": "succeeded",
            "template": {
                "template_id": descriptor.template_id,
                "version": descriptor.version,
                "pack_sha256": descriptor.pack_sha256,
            },
            "input_sha256": input_sha256,
            "artifacts": [
                {
                    "artifact_id": item["artifact_id"],
                    "format": item["format"],
                    "path": item["path"],
                    "sha256": item["sha256"],
                    "size_bytes": item["size_bytes"],
                }
                for item in artifacts
            ],
            "checks": checks + [runtime_check],
            "runtime": runtime_check["details"],
            "generated_at": generated_at,
        }
        _complete_job(workspace, export_id, output, artifacts, receipt)
        return receipt
    except ExportError as exc:
        for destination, backup in reversed(placements):
            destination.unlink(missing_ok=True)
            if backup is not None and backup.exists():
                os.replace(backup, destination)
        for path in staged_paths:
            path.unlink(missing_ok=True)
        _fail_job(workspace, export_id, exc.code)
        raise
    except Exception as exc:
        for destination, backup in reversed(placements):
            destination.unlink(missing_ok=True)
            if backup is not None and backup.exists():
                os.replace(backup, destination)
        for path in staged_paths:
            path.unlink(missing_ok=True)
        _fail_job(workspace, export_id, "EXPORT_FAILED")
        raise ExportError(
            "EXPORT_FAILED",
            "本次导出未完成，未保留半成品。",
        ) from exc
    finally:
        if cancel_path is not None:
            cancel_path.unlink(missing_ok=True)
