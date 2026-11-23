"""Local, non-networked environment capability checks."""

from __future__ import annotations

import os
import platform
import re
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
from .runtime_paths import offline_tex_environment, portable_tex_root, windows_process_environment
from .template_catalog import discover_trusted_template_packs
from .template_engine import ASSESSMENT_DOCUMENT_TYPES
from .tool_output import decode_tool_output


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
    # The thesis template binds its Kai Ti and STZhongsong roles to these families.
    "楷体": ("simkai.ttf", "KaiTi.ttf", "楷体.ttf", "Kaiti.ttc"),
    "华文中宋": ("STZHONGS.TTF", "STZhongsong.ttf", "华文中宋.ttf"),
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
            f"应用运行组件可用（Python {platform.python_version()}）。"
            if supported
            else "应用运行组件版本过低，请重新安装应用。"
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
            "message": "无法写入临时文件，请检查磁盘空间和文件夹权限。",
            "details": {"path": tempfile.gettempdir(), "reason": str(exc)},
        }
    return {
        "id": "temporary_directory",
        "required": True,
        "status": "pass",
        "message": "临时目录写入正常。",
        "details": {"path": tempfile.gettempdir()},
    }


TEX_PROBE_DOCUMENT = "\n".join((
    "\\documentclass{article}",
    "\\begin{document}",
    "probe",
    "\\end{document}",
    "",
))

TEX_FAILURE_MARKERS = (
    ("texmf.cnf not found", "ENV_TEX_CONFIG_MISSING"),
    ("can't find the format file", "ENV_TEX_FORMAT_MISSING"),
    ("cannot find the format file", "ENV_TEX_FORMAT_MISSING"),
)

TEX_FAILURE_MESSAGES = {
    "ENV_TEX_CONFIG_MISSING": "编译环境缺少配置文件（texmf.cnf），分页预览和 PDF 导出不可用；请运行安装包完成修复。",
    "ENV_TEX_FORMAT_MISSING": "编译环境缺少格式文件（xelatex.fmt），分页预览和 PDF 导出不可用；请运行安装包完成修复。",
    "ENV_TEX_LAUNCH_FAILED": "无法启动 XeLaTeX；分页预览和 PDF 导出不可用，请重新安装应用。",
    "ENV_TEX_FAILED": "XeLaTeX 无法编译测试文档；分页预览和 PDF 导出不可用，请重新安装应用。",
}


def _tex_failure_code(output: str) -> str:
    """Name why XeLaTeX refused to start instead of reporting a generic failure."""
    lowered = output.lower()
    for marker, code in TEX_FAILURE_MARKERS:
        if marker in lowered:
            return code
    return "ENV_TEX_FAILED"


def _probe_xelatex(executable: str) -> dict[str, Any]:
    """Compile a one-page document; resolving the binary proves nothing by itself.

    A run is the only truthful check: `shutil.which` finds an installed XeLaTeX even
    when kpathsea cannot read `texmf.cnf`, which is exactly the 0.1.15 failure.
    """
    environment = windows_process_environment(dict(os.environ))
    environment.update(offline_tex_environment(environment.get("PATH", "")))
    with tempfile.TemporaryDirectory(prefix="sztu-tex-probe-") as directory:
        workspace = Path(directory)
        (workspace / "probe.tex").write_text(TEX_PROBE_DOCUMENT, encoding="utf-8")
        try:
            completed = subprocess.run(
                [executable, "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "probe.tex"],
                cwd=workspace,
                env=environment,
                capture_output=True,
                timeout=120,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return {"code": "ENV_TEX_LAUNCH_FAILED", "version": None, "reason": repr(exc)}
        output = decode_tool_output(completed.stdout + b"\n" + completed.stderr)
        if completed.returncode == 0 and (workspace / "probe.pdf").is_file():
            version = re.search(r"This is XeTeX, Version (\S+)", output)
            return {"code": "ENV_TEX_OK", "version": version.group(1) if version else None, "reason": ""}
        return {"code": _tex_failure_code(output), "version": None, "reason": output.strip()[-600:]}


def _check_xelatex() -> dict[str, Any]:
    executable = shutil.which("xelatex")
    if not executable:
        return {
            "id": "xelatex",
            "required": True,
            "status": "fail",
            "message": "未找到 XeLaTeX；分页预览和 PDF 导出不可用，请重新安装应用。",
            "details": {"code": "ENV_TEX_MISSING"},
        }
    root = portable_tex_root(os.environ.get("PATH", ""))
    if root is not None and not str(root).isascii():
        return {
            "id": "xelatex",
            "required": True,
            "status": "fail",
            "message": "编译环境安装在包含中文的路径下，XeLaTeX 无法读取自己的配置；请运行最新安装包，把编译环境装到 ProgramData 后重启应用。",
            "details": {"code": "ENV_TEX_PATH_UNSUPPORTED", "path": str(root)},
        }
    probe = _probe_xelatex(executable)
    if probe["code"] == "ENV_TEX_OK":
        return {
            "id": "xelatex",
            "required": True,
            "status": "pass",
            "message": "XeLaTeX 可正常编译。",
            "details": {"code": "ENV_TEX_OK", "executable": executable, "version": probe["version"]},
        }
    return {
        "id": "xelatex",
        "required": True,
        "status": "fail",
        "message": TEX_FAILURE_MESSAGES.get(probe["code"], TEX_FAILURE_MESSAGES["ENV_TEX_FAILED"]),
        "details": {"code": probe["code"], "executable": executable, "reason": probe["reason"]},
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
            "文档生成组件可用。"
            if available
            else "文档生成组件缺失，请重新安装应用。"
        ),
        "details": dependencies,
    }


def _check_pdf_tools() -> dict[str, Any]:
    names = ("pdfinfo", "pdffonts", "pdftoppm", "pdftotext", "pdftocairo")
    tools = {name: shutil.which(name) for name in names}
    available = all(tools.values())
    # `which` alone reports the tool as present even when a bundled DLL is
    # missing or the binary is a broken shim, so execute each one as well.
    executed: dict[str, str] = {}
    if available:
        for name, path in tools.items():
            try:
                completed = subprocess.run(
                    [str(path), "-v"],
                    capture_output=True,
                    timeout=15,
                    check=False,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
            except (OSError, subprocess.TimeoutExpired) as error:
                executed[name] = f"{type(error).__name__}: {error}"
                continue
            output = decode_tool_output(completed.stdout + completed.stderr).strip()
            text = output.splitlines()[0] if output else ""
            # pdftotext/pdftoppm exit 99 for -v on some builds, so only require
            # that the binary ran and printed a version banner.
            executed[name] = text or f"exit {completed.returncode}"
            if not text:
                available = False
    return {
        "id": "pdf_tools",
        "required": True,
        "status": "pass" if available else "fail",
        "message": (
            "PDF 分页与中文字形检查工具可用。"
            if available
            else "缺少或无法运行 Poppler PDF 工具；分页预览与中文字形检查不可用。"
        ),
        "details": {"tools": tools, "versions": executed},
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
    from .full_diagnostics import current_case, record_exception

    command = [kpsewhich, *filenames]
    case = current_case.get()
    prefix = None
    if case is not None:
        case.counter += 1
        prefix = f"tools/{case.counter:03d}"
        case.json(f"{prefix}/invocation.json", {"argv": command, "cwd": os.getcwd()})
    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        if case is not None and prefix is not None and isinstance(exc, subprocess.TimeoutExpired):
            case.write(f"{prefix}/stdout.bin", exc.output or b"")
            case.write(f"{prefix}/stderr.bin", exc.stderr or b"")
        record_exception(exc)
        return {
            "id": check_id,
            "required": required,
            "status": "fail" if required else "warn",
            "message": f"{label}检查未完成。",
            "details": {"error_type": type(exc).__name__, "missing": list(filenames)},
        }
    if case is not None and prefix is not None:
        case.write(f"{prefix}/stdout.bin", completed.stdout)
        case.write(f"{prefix}/stderr.bin", completed.stderr)
        case.json(f"{prefix}/exit.json", {"exit_code": completed.returncode})
    stdout = completed.stdout.decode("utf-8", errors="replace") if isinstance(completed.stdout, bytes) else completed.stdout
    outputs = stdout.splitlines()[: len(filenames)]
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
            "开题报告模板已更新，可以导出。"
            if live_workspace
            else "开题报告模板可用。"
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
            "中期检查模板已更新，可以导出。"
            if live_workspace
            else "中期检查模板可用。"
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
            "任务书模板已更新，可以导出。"
            if live_workspace
            else "任务书模板可用。"
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
        "message": f"{DOCUMENT_OUTPUT_LABELS[document_type]}模板可用，支持导出 PDF、Word 和 LaTeX 源码。",
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
            "已检测到 Word/WPS。"
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
            "message": "随附模板损坏或不完整，请重新安装应用。",
            "details": {"error_type": type(exc).__name__},
        }
    proposal_packs = [pack for pack in packs if pack["document_type"] == "proposal"]
    if not proposal_packs:
        return {
            "id": "template_pack",
            "required": True,
            "status": "fail",
            "message": "未找到可用的开题报告模板，请重新安装应用。",
            "details": {"templates": []},
        }
    return {
        "id": "template_pack",
        "required": True,
        "status": "pass",
        "message": "开题报告模板可用。",
        "details": {"templates": proposal_packs},
    }


def check_environment() -> dict[str, Any]:
    from .diagnostic_steps import step

    with step("environment_font_discovery"):
        fonts = _font_index()
    probes = [
        ("environment_python", _check_python),
        ("environment_temp", _check_temp_directory),
        ("environment_dependencies", _check_document_dependencies),
        ("environment_tex_tool", _check_xelatex),
        ("environment_tex_packages", _check_process_tex_packages),
        ("environment_tex_tool", _check_thesis_toolchain),
        ("environment_tex_packages", _check_thesis_tex_packages),
        ("environment_pdf_tools", _check_pdf_tools),
        ("environment_fonts", lambda: _check_core_document_fonts(fonts)),
        ("environment_fonts", lambda: _check_special_document_fonts(fonts)),
        ("environment_editor", _check_office_editor),
        ("environment_template", _check_template_packs),
        ("environment_template", _check_proposal_engine),
        ("environment_template", _check_midterm_engine),
        ("environment_template", _check_task_book_engine),
        *(("environment_template", lambda kind=kind: _check_assessment_engine(kind)) for kind in sorted(ASSESSMENT_DOCUMENT_TYPES)),
        ("environment_fonts", _check_task_book_docx_font),
    ]
    checks = []
    for name, probe in probes:
        with step(name) as evidence:
            check = probe()
            checks.append(check)
            evidence["check_id"] = check["id"]
            if check["status"] != "pass":
                evidence["outcome"] = "failure"
                evidence["error_code"] = (
                    "ENVIRONMENT_CHECK_FAILED" if check["status"] == "fail" else "ENVIRONMENT_CHECK_WARNING"
                )
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
