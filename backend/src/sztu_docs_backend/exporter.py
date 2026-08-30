"""Deterministic process-document export orchestration for the local workbench."""

from __future__ import annotations

import hashlib
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
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

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
}
RENDER_TIMEOUT_SECONDS = 90
ADVISOR_TITLE_PATTERN = re.compile(r"(老师|教授|副教授|讲师|博士|导师)\s*$")


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
    if not isinstance(value, dict) or set(value) != {"runs"}:
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
        maximum = 1000 if name == "references" else 5000
        for index, paragraph in enumerate(items):
            _validate_paragraph(paragraph, f"sections.{name}[{index}]", maximum)
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
        if not isinstance(block, dict):
            raise ExportError(
                "DOCUMENT_NOT_READY",
                "中期检查正文内容块格式无效。",
                {"field": block_path, "reason": "invalid_block"},
            )
        block_type = block.get("type", "paragraph")
        if block_type == "paragraph":
            _validate_midterm_paragraph(block, block_path, 5000)
            continue
        if block_type != "ordered_list" or set(block) != {"type", "items"}:
            raise ExportError(
                "DOCUMENT_NOT_READY",
                "工作台当前只支持中期检查正文段落和有序列表。",
                {"field": block_path, "reason": "unsupported_block"},
            )
        items = block.get("items")
        if not isinstance(items, list) or not 1 <= len(items) <= 100:
            raise ExportError(
                "DOCUMENT_NOT_READY",
                "中期检查列表至少需要一个条目。",
                {"field": f"{block_path}.items", "reason": "invalid_items"},
            )
        for item_index, item in enumerate(items):
            item_path = f"{block_path}.items[{item_index}]"
            if not isinstance(item, dict) or set(item) - {"marker", "content"} or "content" not in item:
                raise ExportError(
                    "DOCUMENT_NOT_READY",
                    "中期检查列表条目格式无效。",
                    {"field": item_path, "reason": "invalid_item"},
                )
            marker = item.get("marker")
            if marker is not None and (not isinstance(marker, str) or not marker.strip() or len(marker) > 20):
                raise ExportError(
                    "DOCUMENT_NOT_READY",
                    "中期检查列表编号格式无效。",
                    {"field": f"{item_path}.marker", "reason": "invalid_marker"},
                )
            _validate_midterm_paragraph(item.get("content"), f"{item_path}.content", 5000)


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


def validate_document(document_type: str, document: Any) -> dict[str, Any]:
    if document_type == "proposal":
        return validate_proposal(document)
    if document_type == "midterm":
        return validate_midterm(document)
    raise ExportError("DOCUMENT_TYPE_UNSUPPORTED", "当前文档类型尚未接入导出管线。")


def build_export_document(workspace: Any, record: dict[str, Any]) -> dict[str, Any] | None:
    """Merge the linked student profile into a document's frozen export input.

    Process-document drafts retain their own title and body, while identity and
    programme fields always come from the single shared student profile.
    """

    content = record.get("content")
    if not isinstance(content, dict):
        return None
    metadata = content.get("metadata")
    if not isinstance(metadata, dict):
        return {"schema_version": record["schema_version"], **content}
    merged_metadata = dict(metadata)
    shared_fields = ["student_name", "college", "major", "advisor"]
    if record.get("document_type") == "proposal":
        shared_fields.append("student_id")
    elif record.get("document_type") == "midterm":
        shared_fields.append("class_name")
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
        if record.get("document_type") == "proposal":
            merged_metadata["student_id"] = profile["student_number"]
        elif record.get("document_type") == "midterm":
            merged_metadata["class_name"] = profile.get("class_name") or ""
    return {
        "schema_version": record["schema_version"],
        **content,
        "metadata": merged_metadata,
    }


def content_check(document: Any, document_type: str = "proposal") -> dict[str, Any]:
    checked_at = utc_now()
    try:
        validate_document(document_type, document)
    except ExportError as exc:
        return {
            "schema_version": "1.0",
            "check_id": f"{document_type}-content",
            "gate": "content",
            "status": "fail",
            "blocking": True,
            "message": exc.message,
            "code": exc.code,
            "details": exc.details,
            "checked_at": checked_at,
        }
    return {
        "schema_version": "1.0",
        "check_id": f"{document_type}-content",
        "gate": "content",
        "status": "pass",
        "blocking": True,
        "message": (
            "开题报告必填字段和段落结构已通过严格检查。"
            if document_type == "proposal"
            else "中期检查基本信息、目录和进展内容已通过严格检查。"
        ),
        "checked_at": checked_at,
    }


def _renderer_environment() -> dict[str, str]:
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
        "SZTU_FZXIAOBIAOSONG_FONT",
        "SZTU_SIMSUN_FONT",
        "SZTU_SIMHEI_FONT",
        "SZTU_TIMES_REGULAR_FONT",
        "SZTU_TIMES_BOLD_FONT",
        "SZTU_TIMES_ITALIC_FONT",
        "SZTU_TIMES_BOLD_ITALIC_FONT",
    )
    return {key: value for key in allowed if (value := os.environ.get(key))}


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
) -> str:
    try:
        process = subprocess.Popen(
            command,
            cwd=cwd,
            env=_renderer_environment(),
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
    required_fonts = (
        ("FZXBSJW", "SimSun", "TimesNewRoman")
        if document_type == "midterm"
        else ("SimSun", "SimHei", "TimesNewRoman")
    )
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
    if descriptor.document_type != record["document_type"]:
        raise ExportError("TEMPLATE_ENGINE_MISMATCH", "模板引擎与当前文档类型不匹配。")
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
    checks = [
        content_check(proposal, record["document_type"]),
        {
            "schema_version": "1.0",
            "check_id": "template-integrity",
            "gate": "template_integrity",
            "status": "pass",
            "blocking": True,
            "message": "本地模板引擎文件与受信任版本哈希一致。",
            "details": {"pack_sha256": descriptor.pack_sha256},
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
    snapshot = {
        "schema_version": "1.0",
        "document_id": document_id,
        "document_type": record["document_type"],
        "document_revision": record["current_revision"],
        "captured_at": now,
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
    if descriptor.document_type != record["document_type"]:
        raise ExportError("TEMPLATE_ENGINE_MISMATCH", "模板引擎与当前文档类型不匹配。")
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
            checks: list[dict[str, Any]] = [
                content_check(proposal, record["document_type"]),
                {
                    "schema_version": "1.0",
                    "check_id": "template-integrity",
                    "gate": "template_integrity",
                    "status": "pass",
                    "blocking": True,
                    "message": "本地模板引擎文件与已提交版本哈希一致。",
                    "evidence": [
                        {"kind": "hash", "value": descriptor.pack_sha256},
                    ],
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
