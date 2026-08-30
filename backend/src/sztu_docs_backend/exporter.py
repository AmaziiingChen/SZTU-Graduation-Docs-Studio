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
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from .bibtex_gate import BibtexValidationError, count_valid_bibtex_entries
from .storage.database import utc_now
from .storage.services.common import encode_json, new_id
from .template_engine import (
    ENGINE_TEMPLATE_ID,
    ENGINE_VERSION,
    EngineDescriptor,
    TemplateEngineError,
    canonical_json,
    resolve_engine as _resolve_engine,
    sha256_file,
)
from .version import BACKEND_VERSION

SUPPORTED_FORMATS = ("docx", "pdf", "tex")
OUTPUT_FILENAMES = {
    "docx": "开题报告.docx",
    "pdf": "开题报告.pdf",
    "tex": "开题报告-LaTeX.zip",
}
DOCUMENT_OUTPUT_FILENAMES = {
    "proposal": OUTPUT_FILENAMES,
    "midterm": {
        "docx": "中期检查表.docx",
        "pdf": "中期检查表.pdf",
        "tex": "中期检查表-LaTeX.zip",
    },
    "task_book": {
        "docx": "任务书.docx",
        "pdf": "任务书.pdf",
        "tex": "任务书-LaTeX.zip",
    },
}
RENDER_TIMEOUT_SECONDS = 90
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
DRAFT_PARAGRAPH_SECTION_NAMES = {
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


def resolve_engine(document_type: str = "proposal") -> EngineDescriptor:
    try:
        return _resolve_engine(document_type)
    except TemplateEngineError as exc:
        raise ExportError(exc.code, exc.message, exc.details) from exc


def _require_text(
    value: Any,
    path: str,
    *,
    maximum: int,
) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "开题报告内容不完整，请补全必填字段后重试。",
            {"field": path, "reason": "required"},
        )
    normalized = value.strip()
    if len(normalized) > maximum:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "开题报告字段超过允许长度。",
            {"field": path, "reason": "too_long", "maximum": maximum},
        )
    return normalized


def _validate_paragraph(value: Any, path: str, maximum: int) -> None:
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
        if not isinstance(run, dict) or set(run) - {"text", "script", "italic", "bold"}:
            raise ExportError(
                "DOCUMENT_NOT_READY",
                "开题报告富文本字段无效。",
                {"field": run_path, "reason": "unsupported_field"},
            )
        text = _require_text(run.get("text"), f"{run_path}.text", maximum=maximum)
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
        _validate_paragraph(value, path, maximum)
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
    _validate_paragraph({"runs": value.get("runs")}, path, maximum)


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
        or set(value) - {"type", "path", "alt", "width_mm", "caption"}
        or not {"type", "path", "alt"} <= set(value)
        or value.get("type") != "image"
    ):
        raise ExportError(
            "DOCUMENT_NOT_READY",
            f"{document_name}图片内容块格式无效。",
            {"field": path, "reason": "invalid_block"},
        )
    _require_text(value.get("path"), f"{path}.path", maximum=1000)
    _require_text(value.get("alt"), f"{path}.alt", maximum=500)
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
    if value.get("caption") is not None:
        paragraph_validator(value.get("caption"), f"{path}.caption", maximum)


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
    raise ExportError(
        "DOCUMENT_NOT_READY",
        "开题报告正文只支持段落、有序列表和无序列表。",
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
            "指导教师字段只填写姓名，不填写职称。",
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
    if not isinstance(sections, dict) or set(sections) != section_names:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "开题报告正文结构不完整。",
            {"field": "sections", "reason": "invalid_shape"},
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
                _validate_paragraph(block, block_path, maximum)
    return document


def _validate_midterm_paragraph(value: Any, path: str, maximum: int) -> None:
    if isinstance(value, str):
        if not value.strip() or len(value.strip()) > maximum:
            raise ExportError(
                "DOCUMENT_NOT_READY",
                "中期检查文本字段不完整或超过允许长度。",
                {"field": path, "reason": "invalid_text", "maximum": maximum},
            )
        return
    if not isinstance(value, dict) or set(value) - {"type", "runs"} or value.get("type", "paragraph") != "paragraph":
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "中期检查富文本段落格式无效。",
            {"field": path, "reason": "invalid_paragraph"},
        )
    paragraph = {"runs": value.get("runs")}
    _validate_paragraph(paragraph, path, maximum)


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
        if block.get("type") == "image":
            _validate_image_block(
                block,
                block_path,
                5000,
                _validate_midterm_paragraph,
                document_name="中期检查",
            )
            continue
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "中期检查正文只支持段落、有序列表、无序列表和本地图片。",
            {"field": block_path, "reason": "unsupported_block"},
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
            "指导教师字段只填写姓名，不填写职称。",
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
    if not isinstance(sections, dict) or set(sections) != {"directory", "main_research_content", "progress"}:
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "中期检查正文结构不完整。",
            {"field": "sections", "reason": "invalid_shape"},
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
        if isinstance(level, bool) or not isinstance(level, int) or not 1 <= level <= 4:
            raise ExportError("DOCUMENT_NOT_READY", "中期检查目录层级必须为 1 至 4。", {"field": f"{path}.level"})
        if (index == 0 and level != 1) or level > previous_level + 1:
            raise ExportError("DOCUMENT_NOT_READY", "中期检查目录层级不能跳级。", {"field": f"{path}.level"})
        previous_level = level
        number = item.get("number")
        if number is not None and (not isinstance(number, str) or not number.strip() or len(number) > 20):
            raise ExportError("DOCUMENT_NOT_READY", "中期检查目录编号格式无效。", {"field": f"{path}.number"})
        _validate_midterm_paragraph(item.get("title"), f"{path}.title", 200)
    _validate_midterm_blocks(sections.get("main_research_content"), "sections.main_research_content")
    _validate_midterm_blocks(sections.get("progress"), "sections.progress")
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
            "指导教师字段只填写姓名，不填写职称。",
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


def validate_document(document_type: str, document: Any) -> dict[str, Any]:
    if document_type == "proposal":
        return validate_proposal(document)
    if document_type == "midterm":
        return validate_midterm(document)
    if document_type == "task_book":
        return validate_task_book(document)
    raise ExportError("DOCUMENT_TYPE_UNSUPPORTED", "当前文档类型尚未接入导出管线。")


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
            "TEMPLATE_ENGINE_MISMATCH", "模板引擎与当前文档类型不匹配。"
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
    normalized["sections"] = normalized_sections
    return normalized


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
            "BibTeX 来源未通过后端一致性检查，请重新粘贴或修正文献条目。",
            {
                "field": "editor_state.bibliography.source_text",
                "reason": "invalid_bibtex_source",
                "validation_reason": exc.reason,
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


def build_export_document(workspace: Any, record: dict[str, Any]) -> dict[str, Any] | None:
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
    for field in shared_fields:
        merged_metadata[field] = ""
    profile_id = record.get("profile_id")
    if isinstance(profile_id, str) and profile_id:
        profile = workspace.get_profile(profile_id)
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
    return {
        "schema_version": record["schema_version"],
        **content,
        "metadata": merged_metadata,
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
        return failed_content_check(exc, document_type, checked_at=checked_at)
    return {
        "schema_version": "1.0",
        "check_id": f"{document_type}-content",
        "gate": "content",
        "status": "pass",
        "blocking": True,
        "message": (
            "开题报告必填字段和段落结构已通过严格检查。"
            if document_type == "proposal"
            else (
                "中期检查基本信息、目录和进展内容已通过严格检查。"
                if document_type == "midterm"
                else "任务书基本信息、正文、进度安排、选题信息和当前模板封面容量已通过严格检查。"
            )
        ),
        "checked_at": checked_at,
    }


def _renderer_environment(
    overrides: dict[str, str] | None = None,
) -> dict[str, str]:
    allowed = (
        "PATH",
        "HOME",
        "USERPROFILE",
        "SYSTEMROOT",
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
    if overrides:
        environment.update(overrides)
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
        "缺少任务书 Word 勾选框要求的 Wingdings 2 字体；请安装该字体，或在本地模板 fonts.local 中提供授权字体文件。PDF 和 LaTeX 导出不受影响。",
        {
            "document_type": "task_book",
            "format": "docx",
            "font_family": "Wingdings 2",
            "candidates": list(TASK_BOOK_CHECKBOX_FONT_FILENAMES),
        },
    )


def _terminate_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name == "nt":
            process.terminate()
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


def _run(
    command: list[str],
    *,
    cwd: Path,
    timeout: int = RENDER_TIMEOUT_SECONDS,
    cancellation_file: Path | None = None,
    environment: dict[str, str] | None = None,
) -> str:
    try:
        process = subprocess.Popen(
            command,
            cwd=cwd,
            env=_renderer_environment(environment),
            shell=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=os.name != "nt",
        )
    except OSError as exc:
        raise ExportError(
            "RENDER_START_FAILED",
            "无法启动本地文档渲染器。",
        ) from exc

    deadline = time.monotonic() + timeout
    while True:
        try:
            stdout, stderr = process.communicate(timeout=0.1)
            break
        except subprocess.TimeoutExpired:
            if cancellation_file is not None and cancellation_file.is_file():
                _terminate_process(process)
                raise ExportError(
                    "EXPORT_CANCELLED",
                    "已取消本次导出，未保留半成品。",
                )
            if time.monotonic() >= deadline:
                _terminate_process(process)
                raise ExportError(
                    "RENDER_TIMEOUT",
                    "文档渲染超时，已停止本次导出。",
                )
    if process.returncode != 0:
        diagnostic = stdout + "\n" + stderr
        if "required checkbox font is missing" in diagnostic:
            raise ExportError(
                "REQUIRED_FONT_MISSING",
                "缺少任务书 Word 勾选框要求的 Wingdings 2 字体；请安装该字体，或在本地模板 fonts.local 中提供授权字体文件。PDF 和 LaTeX 导出不受影响。",
                {"exit_code": process.returncode},
            )
        if "required official fonts are missing" in diagnostic:
            raise ExportError(
                "REQUIRED_FONT_MISSING",
                "缺少当前模板要求的官方字体；请安装字体或在本地模板 fonts.local 中提供授权字体文件。",
                {"exit_code": process.returncode},
            )
        if "No module named 'docx'" in diagnostic or "Pillow is required" in diagnostic:
            raise ExportError(
                "PYTHON_RENDER_DEPENDENCY_MISSING",
                "缺少本地文档渲染依赖；请运行 corepack pnpm setup:backend 后重启工作台。",
                {"exit_code": process.returncode},
            )
        raise ExportError(
            "RENDER_FAILED",
            "文档渲染失败，请检查本机字体和文档引擎环境。",
            {"exit_code": process.returncode},
        )
    return (stdout + "\n" + stderr)[-20_000:]


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
    }[document_type]
    for required_font in required_fonts:
        if required_font not in fonts:
            raise ExportError(
                "PDF_FONT_FAILED",
                "PDF 未嵌入规定字体，已停止导出。",
                {"font": required_font},
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


def _run_cjk_gate(
    pdf: Path,
    validator: Path,
    cancellation_file: Path | None = None,
) -> dict[str, Any]:
    _run(
        [sys.executable, str(validator), str(pdf)],
        cwd=pdf.parent,
        timeout=45,
        cancellation_file=cancellation_file,
    )
    return {
        "schema_version": "1.0",
        "check_id": "pdf-cjk-glyph",
        "gate": "cjk_glyph",
        "status": "pass",
        "blocking": True,
        "message": "PDF 中文字形门禁通过。",
        "checked_at": utc_now(),
    }


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


def _validate_export_request(
    workspace: Any,
    document_id: str,
    output_directory: str,
    formats: list[str],
) -> tuple[Path, dict[str, Any], dict[str, Any], list[str]]:
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
    record = workspace.get_document(document_id)
    document_type = record["document_type"]
    if document_type not in DOCUMENT_OUTPUT_FILENAMES or not isinstance(record.get("content"), dict):
        raise ExportError(
            "DOCUMENT_NOT_READY",
            "当前文档尚未保存完整内容。",
        )
    proposal = build_export_document(workspace, record)
    validate_document(document_type, proposal)
    ordered_formats = [item for item in SUPPORTED_FORMATS if item in formats]
    return output, record, proposal, ordered_formats


def preflight_export(
    workspace: Any,
    *,
    document_id: str,
    output_directory: str | None,
    formats: list[str],
    engine: EngineDescriptor | None = None,
) -> dict[str, Any]:
    if output_directory is None:
        if (
            not isinstance(formats, list)
            or not formats
            or len(formats) != len(set(formats))
            or any(item not in SUPPORTED_FORMATS for item in formats)
        ):
            raise ExportError("INVALID_EXPORT_FORMAT", "请选择有效的导出格式。")
        record = workspace.get_document(document_id)
        document_type = record["document_type"]
        if document_type not in DOCUMENT_OUTPUT_FILENAMES or not isinstance(record.get("content"), dict):
            raise ExportError("DOCUMENT_NOT_READY", "当前文档尚未保存完整内容。")
        proposal = build_export_document(workspace, record)
        validate_document(document_type, proposal)
        ordered_formats = [item for item in SUPPORTED_FORMATS if item in formats]
        output = None
    else:
        output, record, proposal, ordered_formats = _validate_export_request(
            workspace, document_id, output_directory, formats
        )
    descriptor = engine or resolve_engine(record["document_type"])
    validate_template_renderability(record["document_type"], proposal, descriptor)
    _require_task_book_docx_font(
        record["document_type"], ordered_formats, descriptor
    )
    output_filenames = DOCUMENT_OUTPUT_FILENAMES[record["document_type"]]
    targets: list[dict[str, Any]] = []
    if output is not None:
        for format_name in ordered_formats:
            target = output / output_filenames[format_name]
            if target.is_symlink():
                raise ExportError(
                    "OUTPUT_TARGET_INVALID",
                    "目标文件不能是符号链接。",
                    {"format": format_name},
                )
            targets.append(
                {
                    "format": format_name,
                    "filename": target.name,
                    "exists": target.exists(),
                }
            )
    input_sha256 = hashlib.sha256(canonical_json(proposal)).hexdigest()
    token_payload = {
        "document_id": document_id,
        "document_type": record["document_type"],
        "document_revision": record["current_revision"],
        "input_sha256": input_sha256,
        "template_sha256": descriptor.pack_sha256,
        "formats": ordered_formats,
        "output_directory": str(output) if output is not None else None,
        "targets": targets,
    }
    preflight_token = hashlib.sha256(canonical_json(token_payload)).hexdigest()
    conflicts = [item["format"] for item in targets if item["exists"]]
    live_workspace = descriptor.source in {
        "development-workspace",
        "environment-workspace",
        "linked-workspace",
    }
    checks = [
        content_check(proposal, record["document_type"], engine=descriptor),
        {
            "schema_version": "1.0",
            "check_id": "template-integrity",
            "gate": "template_integrity",
            "status": "pass",
            "blocking": True,
            "message": (
                "本地模板工程已冻结为内容寻址快照。"
                if live_workspace
                else "本地模板引擎文件与受信任版本哈希一致。"
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
            "status": "warn" if conflicts else ("pass" if output is not None else "not_checked"),
            "blocking": False,
            "message": (
                "目标文件已存在，执行前必须明确确认覆盖。"
                if conflicts
                else "输出目标可用。" if output is not None else "尚未选择输出目录。"
            ),
            **({"code": "OUTPUT_EXISTS"} if conflicts else {}),
            "details": {"targets": targets, "conflicting_formats": conflicts},
            "checked_at": utc_now() if output is not None else None,
        },
    ]
    return {
        "schema_version": "1.0",
        "ready": True,
        "document_id": document_id,
        "formats": ordered_formats,
        "input_sha256": input_sha256,
        "template": {
            "template_id": descriptor.template_id,
            "version": descriptor.version,
            "pack_sha256": descriptor.pack_sha256,
        },
        "checks": checks,
        "blocking_codes": [],
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
) -> str:
    export_id = new_id()
    now = utc_now()
    profile_snapshot = {
        "advisor_title": None,
        "graduation_cohort": None,
        "thesis_title": None,
    }
    profile_id = record.get("profile_id")
    if isinstance(profile_id, str) and profile_id:
        profile = workspace.get_profile(profile_id)
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
            connection.execute(
                """
                INSERT INTO export_jobs(
                    id, document_id, requested_formats_json, status, progress,
                    output_directory, created_at, updated_at, request_id,
                    input_sha256, template_id, template_version, template_sha256,
                    snapshot_json, overwrite_confirmed
                ) VALUES (?, ?, ?, 'running', 5, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    export_id,
                    document_id,
                    encode_json(formats, "formats"),
                    str(output),
                    now,
                    now,
                    request_id,
                    input_sha256,
                    descriptor.template_id,
                    descriptor.version,
                    descriptor.pack_sha256,
                    encode_json(snapshot, "snapshot"),
                    int(overwrite_confirmed),
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise ExportError(
                "EXPORT_ALREADY_RUNNING",
                "当前文档已有导出任务正在运行，请等待或先取消。",
            ) from exc
    return export_id


def _fail_job(workspace: Any, export_id: str, code: str) -> None:
    status = "cancelled" if code == "EXPORT_CANCELLED" else "failed"
    now = utc_now()
    with workspace.database.transaction(immediate=True) as connection:
        connection.execute(
            """
            UPDATE export_jobs
            SET status = ?, progress = 100, error_code = ?, updated_at = ?,
                completed_at = ?, cancel_requested_at = CASE
                    WHEN ? = 'cancelled' THEN COALESCE(cancel_requested_at, ?)
                    ELSE cancel_requested_at END
            WHERE id = ?
            """,
            (status, code, now, now, status, now, export_id),
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
        for artifact in artifacts:
            connection.execute(
                """
                INSERT INTO export_artifacts(
                    id, export_job_id, format, relative_path, sha256,
                    size_bytes, checks_json, created_at, replaced_existing
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    artifact["artifact_id"],
                    export_id,
                    artifact["format"],
                    str(Path(artifact["path"]).relative_to(output)),
                    artifact["sha256"],
                    artifact["size_bytes"],
                    encode_json(artifact["checks"], "checks"),
                    now,
                    int(artifact["replaced_existing"]),
                ),
            )
        connection.execute(
            """
            UPDATE export_jobs
            SET status = 'completed', progress = 100, updated_at = ?,
                completed_at = ?, receipt_json = ?
            WHERE id = ?
            """,
            (now, now, encode_json(receipt, "receipt"), export_id),
        )


def _check_cancelled(cancellation_file: Path | None) -> None:
    if cancellation_file is not None and cancellation_file.is_file():
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

    source_record = workspace.get_document(document_id)
    source_content = source_record.get("content")
    if not isinstance(source_content, dict):
        raise ExportError("DOCUMENT_NOT_READY", "当前文档尚未保存完整内容。")
    descriptor = resolve_engine(source_record["document_type"])
    preview_id = new_id()
    previews_root = (data_directory / "previews").resolve(strict=False)
    document_root = (previews_root / document_id).resolve(strict=False)
    preview_directory = (document_root / preview_id).resolve(strict=False)
    if preview_directory.parent != document_root or document_root.parent != previews_root:
        raise ExportError("PREVIEW_PATH_INVALID", "预览缓存路径无效。")
    preview_directory.mkdir(parents=True, mode=0o700, exist_ok=False)

    try:
        from .storage import Workspace

        with Workspace.create_temporary() as preview_workspace:
            profile_id = None
            source_profile_id = source_record.get("profile_id")
            if isinstance(source_profile_id, str) and source_profile_id:
                source_profile = workspace.get_profile(source_profile_id)
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
                "150",
                str(pdf_path),
                str(page_prefix),
            ],
            cwd=preview_directory,
            timeout=60,
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
        if not page_paths or len(page_paths) > 80:
            raise ExportError("PREVIEW_RENDER_FAILED", "预览页面数量无效。")
        if [number for number, _ in page_paths] != list(range(1, len(page_paths) + 1)):
            raise ExportError("PREVIEW_RENDER_FAILED", "预览页面序号不连续。")

        for old_preview in document_root.iterdir():
            if old_preview == preview_directory or old_preview.is_symlink():
                continue
            try:
                uuid.UUID(old_preview.name)
            except ValueError:
                continue
            if old_preview.is_dir():
                shutil.rmtree(old_preview)

        return {
            "schema_version": "1.0",
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
    except Exception:
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
) -> dict[str, Any]:
    output, record, proposal, ordered_formats = _validate_export_request(
        workspace, document_id, output_directory, formats
    )
    descriptor = engine or resolve_engine(record["document_type"])
    validate_template_renderability(record["document_type"], proposal, descriptor)
    _require_task_book_docx_font(
        record["document_type"], ordered_formats, descriptor
    )
    output_filenames = DOCUMENT_OUTPUT_FILENAMES[record["document_type"]]
    if preflight_token is not None:
        current_preflight = preflight_export(
            workspace,
            document_id=document_id,
            output_directory=str(output),
            formats=ordered_formats,
            engine=descriptor,
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

    conflicting = [
        format_name
        for format_name in ordered_formats
        if (output / output_filenames[format_name]).exists()
    ]
    if conflicting and not overwrite_confirmed:
        raise ExportError(
            "OUTPUT_EXISTS",
            "目标文件已存在；请确认覆盖后重试。",
            {"formats": conflicting},
        )
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
    )
    placements: list[tuple[Path, Path | None]] = []
    staged_paths: list[Path] = []

    try:
        with tempfile.TemporaryDirectory(prefix=f"sztu-export-{export_id[:12]}-") as temp:
            work = Path(temp)
            data_path = work / f"{record['document_type']}.json"
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
                        "本地模板工程已冻结为内容寻址快照。"
                        if live_workspace
                        else "本地模板引擎文件与已提交版本哈希一致。"
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
                _run(
                    [
                        sys.executable,
                        str(descriptor.root / "word" / "render.py"),
                        "--data",
                        str(data_path),
                        "--output",
                        str(docx_path),
                        "--overwrite",
                    ],
                    cwd=work,
                    cancellation_file=cancel_path,
                    environment=_engine_renderer_environment(descriptor),
                )
                try:
                    from .docx_inspector import inspect_docx

                    checks.append(
                        inspect_docx(
                            docx_path,
                            proposal,
                            document_type=record["document_type"],
                        )
                    )
                except ExportError:
                    raise
                except Exception as exc:
                    raise ExportError(
                        "DOCX_STRUCTURE_FAILED",
                        "Word 文件未通过深层结构检查。",
                        {"reason": type(exc).__name__},
                    ) from exc
                generated["docx"] = docx_path

            if "pdf" in ordered_formats or "tex" in ordered_formats:
                _check_cancelled(cancel_path)
                latex_dir = work / "latex"
                latex_command = [
                    sys.executable,
                    str(descriptor.root / "latex" / "render.py"),
                    "--data",
                    str(data_path),
                    "--output-dir",
                    str(latex_dir),
                    "--overwrite",
                ]
                if "pdf" in ordered_formats:
                    latex_command.append("--compile")
                _run(
                    latex_command,
                    cwd=work,
                    cancellation_file=cancel_path,
                    environment=_engine_renderer_environment(descriptor),
                )

            if "pdf" in ordered_formats:
                pdf_path = latex_dir / "main.pdf"
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

            artifacts: list[dict[str, Any]] = []
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
                existed = destination.exists()
                if existed and not overwrite_confirmed:
                    raise ExportError(
                        "OUTPUT_EXISTS",
                        "目标文件在导出期间出现；未执行覆盖。",
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
                    staging.unlink(missing_ok=True)
                    raise
                backup = None
                if existed:
                    backup = work / "replaced" / format_name
                    backup.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(destination, backup)
                try:
                    os.replace(staging, destination)
                except Exception:
                    if backup is not None and backup.exists():
                        os.replace(backup, destination)
                    raise
                placements.append((destination, backup))
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
                        "replaced_existing": existed,
                    }
                )

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
