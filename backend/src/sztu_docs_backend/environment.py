"""Local, non-networked environment capability checks."""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
import tempfile
from importlib.util import find_spec
from pathlib import Path
from typing import Any

from .exporter import (
    TASK_BOOK_CHECKBOX_FONT_FILENAMES,
    DOCUMENT_OUTPUT_LABELS,
    ExportError,
    _find_task_book_checkbox_font,
    resolve_engine,
)
from .template_catalog import discover_trusted_template_packs
from .template_engine import ASSESSMENT_DOCUMENT_TYPES


CORE_DOCUMENT_FONT_GROUPS = {
    "宋体": ("simsun.ttc", "simsun.ttf"),
    "黑体": ("simhei.ttf",),
    "Times New Roman 常规": ("times.ttf", "Times New Roman.ttf"),
    "Times New Roman 粗体": ("timesbd.ttf", "Times New Roman Bold.ttf"),
    "Times New Roman 斜体": ("timesi.ttf", "Times New Roman Italic.ttf"),
    "Times New Roman 粗斜体": (
        "timesbi.ttf",
        "Times New Roman Bold Italic.ttf",
    ),
}
SPECIAL_DOCUMENT_FONT_GROUPS = {
    "华文行楷": ("STXINGKA.ttf", "STXingkai.ttf", "华文行楷.ttf"),
    "方正小标宋简体": ("方正小标宋简体.ttf", "FZXiaoBiaoSong-B05S.ttf", "FZXBSJW.TTF"),
}
FONT_OVERRIDE_ENVIRONMENTS = (
    "SZTU_STXINGKAI_FONT",
    "SZTU_FZXIAOBIAOSONG_FONT",
    "SZTU_SIMSUN_FONT",
    "SZTU_SIMHEI_FONT",
    "SZTU_TIMES_REGULAR_FONT",
    "SZTU_TIMES_BOLD_FONT",
    "SZTU_TIMES_ITALIC_FONT",
    "SZTU_TIMES_BOLD_ITALIC_FONT",
)
PROCESS_TEX_PACKAGE_FILES = (
    "adjustbox.sty",
    "amssymb.sty",
    "array.sty",
    "changepage.sty",
    "fontspec.sty",
    "geometry.sty",
    "graphicx.sty",
    "needspace.sty",
    "ragged2e.sty",
    "setspace.sty",
    "tabularray.sty",
    "tcolorbox.sty",
    "tikz.sty",
    "xcolor.sty",
    "xeCJK.sty",
)
THESIS_TEX_PACKAGE_FILES = (
    "algorithm.sty",
    "amsmath.sty",
    "bigdelim.sty",
    "bigstrut.sty",
    "bm.sty",
    "booktabs.sty",
    "caption.sty",
    "chngcntr.sty",
    "cprotect.sty",
    "ctex.sty",
    "enumitem.sty",
    "etoolbox.sty",
    "fancyhdr.sty",
    "float.sty",
    "gbt7714.sty",
    "hyperref.sty",
    "indentfirst.sty",
    "lastpage.sty",
    "listings.sty",
    "longtable.sty",
    "multirow.sty",
    "ntheorem.sty",
    "subcaption.sty",
    "titletoc.sty",
    "titlesec.sty",
    "ulem.sty",
    "varwidth.sty",
    "xstring.sty",
)


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


def _font_search_roots() -> list[Path]:
    roots: list[Path] = []
    configured = os.environ.get("SZTU_FONT_DIR")
    if configured:
        roots.extend(
            Path(item).expanduser()
            for item in configured.split(os.pathsep)
            if item
        )
    for environment_name in FONT_OVERRIDE_ENVIRONMENTS:
        configured_font = os.environ.get(environment_name)
        if configured_font:
            roots.append(Path(configured_font).expanduser().parent)
    for document_type in ("proposal", "task_book", "midterm", "thesis", "advisor_review", "reviewer_review", "defense_record", "grade_assessment"):
        try:
            descriptor = resolve_engine(document_type)
        except ExportError:
            continue
        roots.extend(descriptor.font_directories)

    if sys.platform == "darwin":
        roots.extend(
            [
                Path.home() / "Library" / "Fonts",
                Path("/Library/Fonts"),
                Path("/System/Library/Fonts"),
                Path("/System/Library/Fonts/Supplemental"),
                Path("/Applications/Microsoft Word.app/Contents/Resources/DFonts"),
                Path("/Applications/Microsoft Excel.app/Contents/Resources/DFonts"),
                Path(
                    "/Applications/Microsoft PowerPoint.app/Contents/Resources/DFonts"
                ),
                Path("/Applications/wpsoffice.app/Contents/Resources/office6/fonts"),
            ]
        )
    elif os.name == "nt":
        roots.extend(
            [
                Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts",
                Path(os.environ.get("LOCALAPPDATA", ""))
                / "Microsoft"
                / "Windows"
                / "Fonts",
            ]
        )
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


def _font_index() -> dict[str, Path]:
    index: dict[str, Path] = {}
    for root in _font_search_roots():
        for path in root.rglob("*"):
            if path.is_file():
                index.setdefault(path.name.casefold(), path.resolve())
    # Match the renderer's explicit file overrides even when a file was renamed.
    override_aliases = {
        "SZTU_STXINGKAI_FONT": "STXingkai.ttf",
        "SZTU_FZXIAOBIAOSONG_FONT": "FZXiaoBiaoSong-B05S.ttf",
        "SZTU_SIMSUN_FONT": "simsun.ttc",
        "SZTU_SIMHEI_FONT": "simhei.ttf",
        "SZTU_TIMES_REGULAR_FONT": "times.ttf",
        "SZTU_TIMES_BOLD_FONT": "timesbd.ttf",
        "SZTU_TIMES_ITALIC_FONT": "timesi.ttf",
        "SZTU_TIMES_BOLD_ITALIC_FONT": "timesbi.ttf",
    }
    for variable, alias in override_aliases.items():
        configured = os.environ.get(variable)
        if configured and (candidate := Path(configured).expanduser()).is_file():
            index[alias.casefold()] = candidate.resolve()
    return index


def _check_font_groups(
    check_id: str,
    groups: dict[str, tuple[str, ...]],
    *,
    required: bool,
    index: dict[str, Path] | None = None,
) -> dict[str, Any]:
    available_fonts = index if index is not None else _font_index()
    resolved = {
        label: next(
            (
                str(available_fonts[candidate.casefold()])
                for candidate in candidates
                if candidate.casefold() in available_fonts
            ),
            None,
        )
        for label, candidates in groups.items()
    }
    missing = [label for label, path in resolved.items() if path is None]
    if not missing:
        return {
            "id": check_id,
            "required": required,
            "status": "pass",
            "message": "、".join(groups) + "均可用。",
            "details": {"fonts": resolved, "missing": []},
        }
    return {
        "id": check_id,
        "required": required,
        "status": "fail" if required else "warn",
        "message": "缺少字体：" + "、".join(missing) + "。",
        "details": {"fonts": resolved, "missing": missing},
    }


def _check_core_document_fonts(
    index: dict[str, Path] | None = None,
) -> dict[str, Any]:
    return _check_font_groups(
        "core_document_fonts",
        CORE_DOCUMENT_FONT_GROUPS,
        required=True,
        index=index,
    )


def _check_special_document_fonts(
    index: dict[str, Path] | None = None,
) -> dict[str, Any]:
    return _check_font_groups(
        "special_document_fonts",
        SPECIAL_DOCUMENT_FONT_GROUPS,
        required=False,
        index=index,
    )


def _check_tex_packages(
    check_id: str,
    filenames: tuple[str, ...],
    *,
    required: bool,
    label: str,
) -> dict[str, Any]:
    kpsewhich = shutil.which("kpsewhich")
    if kpsewhich is None:
        return {
            "id": check_id,
            "required": required,
            "status": "fail" if required else "warn",
            "message": f"未找到 kpsewhich，无法检查{label}。",
            "details": {"kpsewhich": None, "missing": list(filenames)},
        }
    try:
        completed = subprocess.run(
            [kpsewhich, *filenames],
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {
            "id": check_id,
            "required": required,
            "status": "fail" if required else "warn",
            "message": f"{label}检查未完成。",
            "details": {"error_type": type(exc).__name__, "missing": list(filenames)},
        }
    outputs = completed.stdout.splitlines()[: len(filenames)]
    outputs.extend([""] * (len(filenames) - len(outputs)))
    missing = [
        filename
        for filename, resolved in zip(filenames, outputs, strict=True)
        if not resolved.strip()
    ]
    return {
        "id": check_id,
        "required": required,
        "status": "pass" if not missing else ("fail" if required else "warn"),
        "message": (
            f"{label}可用。"
            if not missing
            else f"{label}缺少：" + "、".join(missing) + "。"
        ),
        "details": {
            "kpsewhich": kpsewhich,
            "checked": list(filenames),
            "missing": missing,
        },
    }


def _check_process_tex_packages() -> dict[str, Any]:
    return _check_tex_packages(
        "process_tex_packages",
        PROCESS_TEX_PACKAGE_FILES,
        required=True,
        label="过程文档 TeX 宏包",
    )


def _check_thesis_toolchain() -> dict[str, Any]:
    tools = {
        name: shutil.which(name) for name in ("xelatex", "bibtex", "latexmk")
    }
    missing = [name for name, path in tools.items() if path is None]
    return {
        "id": "thesis_toolchain",
        "required": False,
        "status": "pass" if not missing else "warn",
        "message": (
            "毕业论文 XeLaTeX、BibTeX 和 latexmk 工具链可用。"
            if not missing
            else "毕业论文编译工具缺少：" + "、".join(missing) + "。"
        ),
        "details": {"tools": tools, "missing": missing},
    }


def _check_thesis_tex_packages() -> dict[str, Any]:
    return _check_tex_packages(
        "thesis_tex_packages",
        THESIS_TEX_PACKAGE_FILES,
        required=False,
        label="毕业论文 TeX 宏包",
    )


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


def _check_assessment_engine(document_type: str) -> dict[str, Any]:
    try:
        engine = resolve_engine(document_type)
    except ExportError as exc:
        return {
            "id": f"{document_type}_engine", "required": False, "status": "warn",
            "message": exc.message, "details": {"code": exc.code},
        }
    live_workspace = engine.source in {"development-workspace", "environment-workspace", "linked-workspace"}
    return {
        "id": f"{document_type}_engine", "required": False, "status": "pass",
        "message": f"{DOCUMENT_OUTPUT_LABELS[document_type]}模板已同步为本地快照，可导出一页 PDF、Word 和 LaTeX 源码。",
        "details": {"version": engine.version, "pack_sha256": engine.pack_sha256, "source": engine.source, "live_workspace": live_workspace},
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


def _windows_office_registry_candidates() -> list[str]:
    """Read registered application paths without executing registry commands."""
    try:
        import winreg
    except ImportError:
        return []
    candidates: list[str] = []
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
            for executable in ("WINWORD.EXE", "wps.exe", "ksolaunch.exe"):
                try:
                    with winreg.OpenKey(hive, rf"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{executable}", 0, winreg.KEY_READ | view) as key:
                        value, _ = winreg.QueryValueEx(key, "")
                except OSError:
                    continue
                if isinstance(value, str) and value.strip():
                    candidates.append(os.path.expandvars(value.strip().strip('"')))
    return list(dict.fromkeys(candidates))


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
            "Microsoft Office/Office16/WINWORD.EXE",
            "Kingsoft/WPS Office/ksolaunch.exe",
        ]
        fallback = [
            str(Path(root) / relative)
            for root in roots
            if root
            for relative in relative_paths
        ]
        return list(dict.fromkeys([*_windows_office_registry_candidates(), *fallback]))
    return [path for name in ("wps", "libreoffice") if (path := shutil.which(name))]


def _check_office_editor() -> dict[str, Any]:
    candidates = _office_candidates()
    installed = next((path for path in candidates if Path(path).is_file()), None)
    return {
        "id": "office_editor",
        "required": False,
        "status": "pass" if installed else "warn",
        "message": (
            "已检测到本机 Word/WPS，可用于打开和验收 DOCX。"
            if installed
            else "未自动找到 Word/WPS；请确认已安装，或检查应用的安装注册信息。"
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
    fonts = _font_index()
    checks = [
        _check_python(),
        _check_temp_directory(),
        _check_document_dependencies(),
        _check_xelatex(),
        _check_process_tex_packages(),
        _check_thesis_toolchain(),
        _check_thesis_tex_packages(),
        _check_pdf_tools(),
        _check_core_document_fonts(fonts),
        _check_special_document_fonts(fonts),
        _check_office_editor(),
        _check_template_packs(),
        _check_proposal_engine(),
        _check_midterm_engine(),
        _check_task_book_engine(),
        *(_check_assessment_engine(kind) for kind in sorted(ASSESSMENT_DOCUMENT_TYPES)),
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
