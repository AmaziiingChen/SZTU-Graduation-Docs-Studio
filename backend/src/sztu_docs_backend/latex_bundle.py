"""Build deterministic, font-free LaTeX source bundles."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import unicodedata
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

SAFE_SOURCE_FILES = (
    "main.tex",
    "proposal-data.tex",
    "proposal-fonts.tex",
)
MIDTERM_SAFE_SOURCE_FILES = (
    "main.tex",
    "midterm-data.tex",
    "midterm-fonts.tex",
    "midterm-typography.tex",
)
TASK_BOOK_SAFE_SOURCE_FILES = (
    "main.tex",
    "task-book-data.tex",
    "task-book-fixed.tex",
    "task-book-fonts.tex",
    "task-book-typography.tex",
)
TASK_BOOK_ASSET_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".pdf"})
TASK_BOOK_MAX_ASSETS = 32
TASK_BOOK_MAX_ASSET_BYTES = 32 * 1024 * 1024
FORBIDDEN_SUFFIXES = {
    ".doc",
    ".docx",
    ".otf",
    ".pdf",
    ".ttc",
    ".ttf",
    ".woff",
    ".woff2",
}
ABSOLUTE_PATH_PATTERNS = (
    re.compile(rb"/(?:Users|home|private|tmp|var|opt|usr|Library)/[^\s{}\[\]\"']+"),
    re.compile(rb"[A-Za-z]:[\\/][^\s{}\[\]\"']+"),
    re.compile(rb"\\\\[^\s\\]+\\[^\s]+"),
)
FIXED_ZIP_TIME = (1980, 1, 1, 0, 0, 0)
OPTIONAL_SOURCE_FILES = ("proposal-typography.tex", "sztu-process-form.tex")


def _check_tex_dependencies(files: dict[str, bytes]) -> None:
    """Check literal input/include dependencies in the generated source contract."""
    for name, payload in files.items():
        if not name.endswith(".tex"):
            continue
        source = re.sub(r"(?<!\\)%[^\n]*", "", payload.decode("utf-8"))
        for dependency in re.findall(r"\\(?:input|include)\s*\{([^{}]+)\}", source):
            target = dependency.strip()
            if not target.endswith(".tex"):
                target += ".tex"
            if target not in files:
                _raise("LATEX_BUNDLE_INCOMPLETE", "LaTeX 源码包缺少引用的依赖文件。", file=name, dependency=target)

PORTABLE_FONTS_TEX = """% Generated portable configuration; font binaries are not bundled.
% You may place legally obtained simsun.ttf and SimHei.ttf in ./fonts/.
\\IfFileExists{fonts/simsun.ttf}{
  \\setCJKmainfont[Path=fonts/]{simsun.ttf}
  \\newCJKfontfamily\\songti[Path=fonts/]{simsun.ttf}
}{
  \\IfFontExistsTF{SimSun}{
    \\setCJKmainfont{SimSun}
    \\newCJKfontfamily\\songti{SimSun}
  }{
    \\setCJKmainfont{宋体}
    \\newCJKfontfamily\\songti{宋体}
  }
}
\\IfFileExists{fonts/SimHei.ttf}{
  \\setCJKsansfont[Path=fonts/]{SimHei.ttf}
  \\newCJKfontfamily\\heiti[Path=fonts/]{SimHei.ttf}
  \\newCJKfontfamily\\heitiBold[Path=fonts/,AutoFakeBold=3]{SimHei.ttf}
}{
  \\IfFontExistsTF{SimHei}{
    \\setCJKsansfont{SimHei}
    \\newCJKfontfamily\\heiti{SimHei}
    \\newCJKfontfamily\\heitiBold[AutoFakeBold=3]{SimHei}
  }{
    \\setCJKsansfont{黑体}
    \\newCJKfontfamily\\heiti{黑体}
    \\newCJKfontfamily\\heitiBold[AutoFakeBold=3]{黑体}
  }
}
\\setmainfont[
  BoldFont={Times New Roman Bold},
  ItalicFont={Times New Roman Italic},
  BoldItalicFont={Times New Roman Bold Italic}
]{Times New Roman}
"""
README_TEXT = """# 开题报告 LaTeX 源码包

使用 XeLaTeX 编译 `main.tex`。本包不包含字体、官方 Office 模板或本机绝对路径。
编译前请合法安装宋体（SimSun）、黑体（SimHei）和 Times New Roman；macOS
上的字体内部名称可能显示为“宋体”和“黑体”。若 XeLaTeX 仍无法找到中文字体，
可自行创建 `fonts/` 文件夹并放入合法取得的 `simsun.ttf` 与 `SimHei.ttf`；
字体文件不会被工作台打包。

`proposal.json` 是本次导出的冻结输入快照；编辑字段后需要使用工作台重新导出，
不要直接编辑生成的 `proposal-data.tex`。
"""
MIDTERM_PORTABLE_FONTS_TEX = """% Generated portable configuration; font binaries are not bundled.
% You may place legally obtained FZXiaoBiaoSong.ttf and simsun.ttf in ./fonts/.
\\IfFileExists{fonts/FZXiaoBiaoSong.ttf}{
  \\newCJKfontfamily\\formtitle[Path=fonts/]{FZXiaoBiaoSong.ttf}
}{
  \\IfFontExistsTF{方正小标宋简体}{
    \\newCJKfontfamily\\formtitle{方正小标宋简体}
  }{
    \\newCJKfontfamily\\formtitle{FZXiaoBiaoSong}
  }
}
\\IfFileExists{fonts/simsun.ttf}{
  \\setCJKmainfont[Path=fonts/]{simsun.ttf}
  \\newCJKfontfamily\\songti[Path=fonts/]{simsun.ttf}
  \\newCJKfontfamily\\songtiBold[Path=fonts/,AutoFakeBold=3]{simsun.ttf}
}{
  \\IfFontExistsTF{SimSun}{
    \\setCJKmainfont{SimSun}
    \\newCJKfontfamily\\songti{SimSun}
    \\newCJKfontfamily\\songtiBold[AutoFakeBold=3]{SimSun}
  }{
    \\setCJKmainfont{宋体}
    \\newCJKfontfamily\\songti{宋体}
    \\newCJKfontfamily\\songtiBold[AutoFakeBold=3]{宋体}
  }
}
\\setmainfont[
  BoldFont={Times New Roman Bold},
  ItalicFont={Times New Roman Italic},
  BoldItalicFont={Times New Roman Bold Italic}
]{Times New Roman}
"""
MIDTERM_README_TEXT = """# 中期检查表 LaTeX 源码包

使用 XeLaTeX 编译 `main.tex`。本包不包含字体、官方 Office 模板或本机绝对路径。
编译前请合法安装方正小标宋简体、中易宋体和 Times New Roman；也可以在 `fonts/`
中放入合法取得的 `FZXiaoBiaoSong.ttf` 与 `simsun.ttf`。字体文件不会被工作台打包。

`midterm.json` 是本次导出的冻结输入快照；编辑字段后需要使用工作台重新导出，
不要直接编辑生成的 `midterm-data.tex`。
"""
TASK_BOOK_PORTABLE_FONTS_TEX = r"""% Generated portable configuration; font binaries are not bundled.
% You may place legally obtained STXingkai.ttf, SimHei.ttf and simsun.ttf in ./fonts/.
\IfFileExists{fonts/STXingkai.ttf}{
  \newCJKfontfamily\schoolmark[Path=fonts/,AutoFakeBold=3]{STXingkai.ttf}
}{
  \IfFontExistsTF{STXingkai}{
    \newCJKfontfamily\schoolmark[AutoFakeBold=3]{STXingkai}
  }{
    \newCJKfontfamily\schoolmark[AutoFakeBold=3]{华文行楷}
  }
}
\IfFileExists{fonts/SimHei.ttf}{
  \setCJKsansfont[Path=fonts/]{SimHei.ttf}
  \newCJKfontfamily\heiti[Path=fonts/,AutoFakeBold=3]{SimHei.ttf}
  \newCJKfontfamily\heitiBold[Path=fonts/,AutoFakeBold=3]{SimHei.ttf}
  \newfontfamily\heitiLatin[Path=fonts/,AutoFakeBold=3]{SimHei.ttf}
}{
  \IfFontExistsTF{SimHei}{
    \setCJKsansfont{SimHei}
    \newCJKfontfamily\heiti[AutoFakeBold=3]{SimHei}
    \newCJKfontfamily\heitiBold[AutoFakeBold=3]{SimHei}
    \newfontfamily\heitiLatin[AutoFakeBold=3]{SimHei}
  }{
    \setCJKsansfont{黑体}
    \newCJKfontfamily\heiti[AutoFakeBold=3]{黑体}
    \newCJKfontfamily\heitiBold[AutoFakeBold=3]{黑体}
    \newfontfamily\heitiLatin{Times New Roman}
  }
}
\IfFileExists{fonts/simsun.ttf}{
  \setCJKmainfont[Path=fonts/]{simsun.ttf}
  \newCJKfontfamily\songti[Path=fonts/,AutoFakeBold=3]{simsun.ttf}
  \newCJKfontfamily\songtiBold[Path=fonts/,AutoFakeBold=3]{simsun.ttf}
}{
  \IfFontExistsTF{SimSun}{
    \setCJKmainfont{SimSun}
    \newCJKfontfamily\songti[AutoFakeBold=3]{SimSun}
    \newCJKfontfamily\songtiBold[AutoFakeBold=3]{SimSun}
  }{
    \setCJKmainfont{宋体}
    \newCJKfontfamily\songti[AutoFakeBold=3]{宋体}
    \newCJKfontfamily\songtiBold[AutoFakeBold=3]{宋体}
  }
}
\setmainfont[
  BoldFont={Times New Roman Bold},
  ItalicFont={Times New Roman Italic},
  BoldItalicFont={Times New Roman Bold Italic}
]{Times New Roman}
"""
TASK_BOOK_README_TEXT = """# 任务书 LaTeX 源码包

使用 XeLaTeX 编译 `main.tex`。本包不包含字体或官方 Office 模板。
编译前请合法安装华文行楷（STXingkai）、黑体（SimHei）、宋体（SimSun）和
Times New Roman；也可以在 `fonts/` 中放入合法取得的对应字体文件。
字体文件不会被工作台打包。

`task-book.json` 是本次导出的冻结输入快照；编辑字段后需要使用工作台重新导出，
不要直接编辑生成的 `task-book-data.tex`。
"""


class LatexBundleError(Exception):
    """Stable, sanitized LaTeX bundle failure."""

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


def _raise(code: str, message: str, **details: Any) -> None:
    raise LatexBundleError(code, message, details)


def _safe_archive_name(name: str) -> str:
    normalized = unicodedata.normalize("NFC", name)
    path = PurePosixPath(normalized)
    if (
        not normalized
        or "\\" in normalized
        or path.is_absolute()
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        _raise("LATEX_BUNDLE_UNSAFE_PATH", "LaTeX 源码包包含不安全路径。")
    if path.suffix.casefold() in FORBIDDEN_SUFFIXES:
        _raise("LATEX_BUNDLE_FORBIDDEN_FILE", "LaTeX 源码包不得包含模板、字体或成品文件。")
    return path.as_posix()


def _safe_task_book_asset_name(name: str) -> str:
    normalized = unicodedata.normalize("NFC", name)
    path = PurePosixPath(normalized)
    if (
        "\\" in normalized
        or path.is_absolute()
        or len(path.parts) != 2
        or path.parts[0] != "assets"
        or any(part in {"", ".", ".."} for part in path.parts)
        or path.suffix.casefold() not in TASK_BOOK_ASSET_SUFFIXES
        or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,191}", path.name) is None
    ):
        _raise("LATEX_BUNDLE_UNSAFE_PATH", "任务书图片资源路径无效。")
    return path.as_posix()


def _check_content(name: str, payload: bytes) -> None:
    if any(pattern.search(payload) for pattern in ABSOLUTE_PATH_PATTERNS):
        _raise(
            "LATEX_BUNDLE_ABSOLUTE_PATH",
            "LaTeX 源码包包含本机绝对路径。",
            file=name,
        )


def _validate_input_path(path: Path, *, kind: str) -> Path:
    if not path.is_absolute() or path.is_symlink():
        _raise("LATEX_BUNDLE_INVALID_INPUT", "LaTeX 源码包输入路径无效。", field=kind)
    try:
        return path.resolve(strict=True)
    except OSError as exc:
        raise LatexBundleError(
            "LATEX_BUNDLE_INVALID_INPUT",
            "LaTeX 源码包输入路径无效。",
            {"field": kind},
        ) from exc


def build_latex_bundle(
    latex_dir: Path,
    proposal_json: Path,
    output_zip: Path,
    *,
    document_type: str = "proposal",
) -> dict[str, Any]:
    """Deterministically package an already generated LaTeX source directory.

    The renderer may use local commercial fonts while generating the directory,
    but font files and its absolute font paths are never copied into the archive.
    """

    if document_type not in {"proposal", "midterm", "task_book"}:
        _raise("LATEX_BUNDLE_INVALID_INPUT", "当前文档类型没有 LaTeX 源码包配置。")
    generated = _validate_input_path(latex_dir, kind="latex_dir")
    proposal = _validate_input_path(proposal_json, kind="proposal_json")
    if not generated.is_dir() or not proposal.is_file():
        _raise("LATEX_BUNDLE_INVALID_INPUT", "LaTeX 源码包输入路径无效。")
    if output_zip.suffix.casefold() != ".zip":
        _raise("LATEX_BUNDLE_OUTPUT_INVALID", "LaTeX 源码包输出必须是 ZIP 文件。")
    try:
        proposal_data = json.loads(proposal.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LatexBundleError(
            "LATEX_BUNDLE_INVALID_INPUT", "结构化输入 JSON 无法读取。", {"field": "proposal_json"}
        ) from exc
    if not isinstance(proposal_data, dict):
        _raise(
            "LATEX_BUNDLE_INVALID_INPUT",
            "结构化输入 JSON 结构无效。",
            field="proposal_json",
        )
    proposal_digest = hashlib.sha256(
        json.dumps(
            proposal_data,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    ).hexdigest()
    proposal_payload = json.dumps(
        proposal_data,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8") + b"\n"
    output_zip.parent.mkdir(parents=True, exist_ok=True)

    try:
        files: dict[str, bytes] = {}
        source_files = {
            "proposal": SAFE_SOURCE_FILES,
            "midterm": MIDTERM_SAFE_SOURCE_FILES,
            "task_book": TASK_BOOK_SAFE_SOURCE_FILES,
        }[document_type]
        source_files += tuple(
            name for name in OPTIONAL_SOURCE_FILES
            if (generated / name).exists() or (generated / name).is_symlink()
        )
        font_config_name = {
            "proposal": "proposal-fonts.tex",
            "midterm": "midterm-fonts.tex",
            "task_book": "task-book-fonts.tex",
        }[document_type]
        input_name = {
            "proposal": "proposal.json",
            "midterm": "midterm.json",
            "task_book": "task-book.json",
        }[document_type]
        readme = {
            "proposal": README_TEXT,
            "midterm": MIDTERM_README_TEXT,
            "task_book": TASK_BOOK_README_TEXT,
        }[document_type]
        portable_fonts = {
            "proposal": PORTABLE_FONTS_TEX,
            "midterm": MIDTERM_PORTABLE_FONTS_TEX,
            "task_book": TASK_BOOK_PORTABLE_FONTS_TEX,
        }[document_type]
        for raw_name in source_files:
            name = _safe_archive_name(raw_name)
            source = generated / raw_name
            if raw_name == font_config_name:
                payload = portable_fonts.encode("utf-8")
            else:
                if source.is_symlink() or not source.is_file():
                    _raise(
                        "LATEX_BUNDLE_INCOMPLETE",
                        "LaTeX 渲染器未生成完整源码。",
                        file=raw_name,
                    )
                payload = source.read_bytes()
            _check_content(name, payload)
            files[name] = payload
        _check_tex_dependencies(files)
        if document_type == "task_book":
            assets_dir = generated / "assets"
            if assets_dir.exists():
                if assets_dir.is_symlink() or not assets_dir.is_dir():
                    _raise("LATEX_BUNDLE_UNSAFE_PATH", "任务书图片资源目录无效。")
                assets = sorted(assets_dir.iterdir(), key=lambda item: item.name)
                if len(assets) > TASK_BOOK_MAX_ASSETS:
                    _raise("LATEX_BUNDLE_ASSET_LIMIT", "任务书图片资源数量超过安全限制。")
                total_asset_bytes = 0
                for asset in assets:
                    name = _safe_task_book_asset_name(f"assets/{asset.name}")
                    if asset.is_symlink() or not asset.is_file():
                        _raise("LATEX_BUNDLE_UNSAFE_PATH", "任务书图片资源文件无效。")
                    payload = asset.read_bytes()
                    total_asset_bytes += len(payload)
                    if total_asset_bytes > TASK_BOOK_MAX_ASSET_BYTES:
                        _raise("LATEX_BUNDLE_ASSET_LIMIT", "任务书图片资源超过安全大小限制。")
                    files[name] = payload
        _check_content(input_name, proposal_payload)
        files[input_name] = proposal_payload
        files["README.md"] = readme.encode("utf-8")

        manifest = {
            "bundle_version": "1.0",
            "compiler": "xelatex",
            "entrypoint": "main.tex",
            "input_sha256": proposal_digest,
            **({"proposal_sha256": proposal_digest} if document_type == "proposal" else {}),
            **({"task_book_sha256": proposal_digest} if document_type == "task_book" else {}),
            "document_type": document_type,
            "fonts_embedded": False,
            "official_office_template_embedded": False,
            "files": [
                {
                    "path": name,
                    "sha256": hashlib.sha256(payload).hexdigest(),
                    "size": len(payload),
                }
                for name, payload in sorted(files.items())
            ],
        }
        manifest_payload = json.dumps(
            manifest,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8") + b"\n"
        files["bundle-manifest.json"] = manifest_payload

        staging = output_zip.parent / f".{output_zip.name}.tmp"
        try:
            with zipfile.ZipFile(staging, "w", compression=zipfile.ZIP_STORED) as archive:
                archive.comment = b""
                for name, payload in sorted(files.items()):
                    info = zipfile.ZipInfo(name, FIXED_ZIP_TIME)
                    info.create_system = 3
                    info.external_attr = (stat.S_IFREG | 0o644) << 16
                    info.compress_type = zipfile.ZIP_STORED
                    info.extra = b""
                    info.comment = b""
                    archive.writestr(info, payload)
            os.replace(staging, output_zip)
        finally:
            if staging.exists():
                staging.unlink()
    except LatexBundleError:
        raise
    except OSError as exc:
        raise LatexBundleError("LATEX_BUNDLE_WRITE_FAILED", "LaTeX 源码包写入失败。") from exc

    digest = hashlib.sha256(output_zip.read_bytes()).hexdigest()
    return {
        "schema_version": "1.0",
        "check_id": "latex-bundle",
        "gate": "structure",
        "status": "pass",
        "blocking": True,
        "message": "LaTeX 源码包已生成；未包含字体或官方 Office 模板。",
        "details": {
            "sha256": digest,
            "size": output_zip.stat().st_size,
            "entrypoint": "main.tex",
            "files": sorted(files),
            "deterministic": True,
            "fonts_embedded": False,
            "official_office_template_embedded": False,
        },
    }


__all__ = ["LatexBundleError", "build_latex_bundle"]
