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

from .exporter import ExportError, resolve_engine
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
        "required": False,
        "status": "pass" if executable else "warn",
        "message": (
            "XeLaTeX is available."
            if executable
            else "XeLaTeX was not found; PDF export will be unavailable."
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
        "required": False,
        "status": "pass" if available else "warn",
        "message": (
            "Word 与中文字形检查所需 Python 依赖可用。"
            if available
            else "缺少 Word 或中文字形检查依赖；部分导出不可用。"
        ),
        "details": dependencies,
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
    return {
        "id": "proposal_engine",
        "required": False,
        "status": "pass",
        "message": "已提交版本的开题报告 Word/PDF 引擎可用。",
        "details": {
            "version": "0.2+a0799ee",
            "pack_sha256": engine.pack_sha256,
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
    return {
        "id": "midterm_engine",
        "required": False,
        "status": "pass",
        "message": "受信任的中期检查 Word/PDF/LaTeX 引擎可用。",
        "details": {
            "version": engine.version,
            "pack_sha256": engine.pack_sha256,
            "source": engine.source,
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
        _check_office_editor(),
        _check_template_packs(),
        _check_proposal_engine(),
        _check_midterm_engine(),
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
