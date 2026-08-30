"""Local, non-networked environment capability checks."""

from __future__ import annotations

import os
import platform
import shutil
import sys
import tempfile
from importlib.util import find_spec
from pathlib import Path
from typing import Any

from .exporter import (
    TASK_BOOK_CHECKBOX_FONT_FILENAMES,
    ExportError,
    _find_task_book_checkbox_font,
    resolve_engine,
)
from .template_catalog import discover_trusted_template_packs


def _check_python() -> dict[str, Any]:
    supported = sys.version_info >= (3, 11)
    return {
        "id": "python",
        "required": True,
        "status": "pass" if supported else "fail",
        "message": (
            f"Python {platform.python_version()} is supported."
            if supported
            else "Python 3.11 or newer is required."
        ),
        "details": {"minimum": "3.11", "executable": sys.executable},
    }


def _check_temp_directory() -> dict[str, Any]:
    try:
        with tempfile.TemporaryDirectory(prefix="sztu-docs-check-") as path:
            marker = Path(path) / "write-test"
            marker.write_text("ok", encoding="utf-8")
            writable = marker.read_text(encoding="utf-8") == "ok"
        if not writable:
            raise OSError("temporary file readback did not match")
    except OSError as exc:
        return {
            "id": "temporary_directory",
            "required": True,
            "status": "fail",
            "message": "The temporary directory is not writable.",
            "details": {"path": tempfile.gettempdir(), "reason": str(exc)},
        }
    return {
        "id": "temporary_directory",
        "required": True,
        "status": "pass",
        "message": "The temporary directory is writable.",
        "details": {"path": tempfile.gettempdir()},
    }


def _check_xelatex() -> dict[str, Any]:
    executable = shutil.which("xelatex")
    return {
        "id": "xelatex",
        "required": True,
        "status": "pass" if executable else "fail",
        "message": (
            "XeLaTeX is available."
            if executable
            else "未找到 XeLaTeX；分页预览和 PDF 导出不可用。"
        ),
        "details": {"executable": executable},
    }


def _check_document_dependencies() -> dict[str, Any]:
    dependencies = {
        "python-docx": find_spec("docx") is not None,
        "Pillow": find_spec("PIL") is not None,
    }
    available = all(dependencies.values())
    return {
        "id": "document_dependencies",
        "required": True,
        "status": "pass" if available else "fail",
        "message": (
            "Word 与中文字形检查所需 Python 依赖可用。"
            if available
            else "缺少 python-docx 或 Pillow；请运行 corepack pnpm setup:backend 后重启工作台。"
        ),
        "details": dependencies,
    }


def _check_pdf_tools() -> dict[str, Any]:
    names = ("pdfinfo", "pdffonts", "pdftoppm", "pdftotext", "pdftocairo")
    tools = {name: shutil.which(name) for name in names}
    available = all(tools.values())
    return {
        "id": "pdf_tools",
        "required": True,
        "status": "pass" if available else "fail",
        "message": (
            "PDF 分页与中文字形检查工具可用。"
            if available
            else "缺少 Poppler PDF 工具；分页预览不可用。"
        ),
        "details": tools,
    }


def _check_proposal_engine() -> dict[str, Any]:
    try:
        engine = resolve_engine()
    except ExportError as exc:
        return {
            "id": "proposal_engine",
            "required": False,
            "status": "warn",
            "message": exc.message,
            "details": {"code": exc.code},
        }
    live_workspace = engine.source in {
        "development-workspace",
        "environment-workspace",
        "linked-workspace",
    }
    return {
        "id": "proposal_engine",
        "required": False,
        "status": "pass",
        "message": (
            "开题报告本地模板工程已实时同步为导出快照。"
            if live_workspace
            else "已提交版本的开题报告 Word/PDF 引擎可用。"
        ),
        "details": {
            "version": engine.version,
            "pack_sha256": engine.pack_sha256,
            "source": engine.source,
            "live_workspace": live_workspace,
        },
    }


def _check_midterm_engine() -> dict[str, Any]:
    try:
        engine = resolve_engine("midterm")
    except ExportError as exc:
        return {
            "id": "midterm_engine",
            "required": False,
            "status": "warn",
            "message": exc.message,
            "details": {"code": exc.code},
        }
    live_workspace = engine.source in {
        "development-workspace",
        "environment-workspace",
        "linked-workspace",
    }
    return {
        "id": "midterm_engine",
        "required": False,
        "status": "pass",
        "message": (
            "中期检查本地模板工程已实时同步为导出快照。"
            if live_workspace
            else "受信任的中期检查 Word/PDF/LaTeX 引擎可用。"
        ),
        "details": {
            "version": engine.version,
            "pack_sha256": engine.pack_sha256,
            "source": engine.source,
            "live_workspace": live_workspace,
        },
    }


def _check_task_book_engine() -> dict[str, Any]:
    try:
        engine = resolve_engine("task_book")
    except ExportError as exc:
        return {
            "id": "task_book_engine",
            "required": False,
            "status": "warn",
            "message": exc.message,
            "details": {"code": exc.code},
        }
    live_workspace = engine.source in {
        "development-workspace",
        "environment-workspace",
        "linked-workspace",
    }
    return {
        "id": "task_book_engine",
        "required": False,
        "status": "pass",
        "message": (
            "任务书本地模板工程已实时同步为导出快照。"
            if live_workspace
            else "已提交版本的任务书 Word/PDF/LaTeX 引擎可用。"
        ),
        "details": {
            "version": engine.version,
            "pack_sha256": engine.pack_sha256,
            "source": engine.source,
            "live_workspace": live_workspace,
        },
    }


def _check_task_book_docx_font() -> dict[str, Any]:
    try:
        engine = resolve_engine("task_book")
    except ExportError as exc:
        return {
            "id": "task_book_docx_font",
            "required": False,
            "status": "warn",
            "message": "任务书模板尚不可用，暂时无法检查 Word 勾选框字体。",
            "details": {
                "code": exc.code,
                "document_type": "task_book",
                "format": "docx",
            },
        }
    found = _find_task_book_checkbox_font(engine)
    return {
        "id": "task_book_docx_font",
        "required": False,
        "status": "pass" if found is not None else "warn",
        "message": (
            "任务书 Word 勾选框字体 Wingdings 2 可用。"
            if found is not None
            else "未找到任务书 Word 勾选框字体 Wingdings 2；仅 Word 导出不可用，PDF 和 LaTeX 不受影响。"
        ),
        "details": {
            "document_type": "task_book",
            "format": "docx",
            "font_family": "Wingdings 2",
            "found": found is not None,
            "candidates": list(TASK_BOOK_CHECKBOX_FONT_FILENAMES),
        },
    }


def _office_candidates() -> list[str]:
    system = platform.system()
    if system == "Darwin":
        return [
            "/Applications/Microsoft Word.app",
            "/Applications/wpsoffice.app",
            "/Applications/WPS Office.app",
        ]
    if system == "Windows":
        roots = [
            os.environ.get("PROGRAMFILES"),
            os.environ.get("PROGRAMFILES(X86)"),
            os.environ.get("LOCALAPPDATA"),
        ]
        relative_paths = [
            "Microsoft Office/root/Office16/WINWORD.EXE",
            "Kingsoft/WPS Office/ksolaunch.exe",
        ]
        return [
            str(Path(root) / relative)
            for root in roots
            if root
            for relative in relative_paths
        ]
    return [path for name in ("wps", "libreoffice") if (path := shutil.which(name))]


def _check_office_editor() -> dict[str, Any]:
    candidates = _office_candidates()
    installed = next((path for path in candidates if Path(path).exists()), None)
    return {
        "id": "office_editor",
        "required": False,
        "status": "pass" if installed else "warn",
        "message": (
            "A Word-compatible target editor was found."
            if installed
            else "Microsoft Word or WPS was not found automatically."
        ),
        "details": {"path": installed, "candidates": candidates},
    }


def _check_template_packs() -> dict[str, Any]:
    try:
        packs = discover_trusted_template_packs()
    except Exception as exc:
        return {
            "id": "template_pack",
            "required": True,
            "status": "fail",
            "message": "The bundled template pack could not be verified.",
            "details": {"error_type": type(exc).__name__},
        }
    proposal_packs = [pack for pack in packs if pack["document_type"] == "proposal"]
    if not proposal_packs:
        return {
            "id": "template_pack",
            "required": True,
            "status": "fail",
            "message": "No trusted proposal template pack is available.",
            "details": {"templates": []},
        }
    return {
        "id": "template_pack",
        "required": True,
        "status": "pass",
        "message": "A trusted proposal development template pack is available.",
        "details": {"templates": proposal_packs},
    }


def check_environment() -> dict[str, Any]:
    checks = [
        _check_python(),
        _check_temp_directory(),
        _check_document_dependencies(),
        _check_xelatex(),
        _check_pdf_tools(),
        _check_office_editor(),
        _check_template_packs(),
        _check_proposal_engine(),
        _check_midterm_engine(),
        _check_task_book_engine(),
        _check_task_book_docx_font(),
    ]
    ready = not any(
        check["required"] and check["status"] == "fail" for check in checks
    )
    return {
        "ready": ready,
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        },
        "checks": checks,
    }
