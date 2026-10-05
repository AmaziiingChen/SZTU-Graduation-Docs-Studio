"""Verify runtime integrity and compile a CJK PDF without the system TeX PATH."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "src"))
from sztu_docs_backend.environment import PROCESS_TEX_PACKAGE_FILES, THESIS_TEX_PACKAGE_FILES
from sztu_docs_backend.runtime_paths import windows_tool_path, offline_tex_environment


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runtime", type=Path)
    args = parser.parse_args()
    root = args.runtime.resolve(strict=True)
    manifest = json.loads((root / "runtime-manifest.json").read_text(encoding="utf-8"))
    for relative, digest in manifest["tools"].items():
        target = root / relative
        if not target.resolve().is_relative_to(root) or target.is_symlink() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise RuntimeError("Offline runtime integrity check failed")
    texbin, pdfbin = root / "texlive/bin/windows", root / "poppler/Library/bin"
    os.environ["PATH"] = windows_tool_path(os.pathsep.join((str(texbin), str(pdfbin), str(Path(os.environ["SYSTEMROOT"]) / "System32"))))
    for name in ("TEXMFCNF", "TEXMFROOT", "TEXMFDIST", "TEXMF", "TEXINPUTS", "FONTCONFIG_FILE", "FONTCONFIG_PATH"):
        os.environ.pop(name, None)
    os.environ.update(offline_tex_environment(os.environ["PATH"]))
    def run(command: list[str], cwd: Path | None = None) -> str:
        command = [windows_tool_path(command[0]), *command[1:]]
        completed = subprocess.run(command, cwd=cwd, capture_output=True, timeout=60)
        def decode(value: bytes) -> str:
            try:
                return value.decode("utf-8")
            except UnicodeDecodeError:
                return value.decode("mbcs" if os.name == "nt" else "utf-8", errors="replace")
        output = decode(completed.stdout) + decode(completed.stderr)
        if completed.returncode != 0:
            raise RuntimeError(output[-2500:])
        return output
    for filename in (*PROCESS_TEX_PACKAGE_FILES, *THESIS_TEX_PACKAGE_FILES):
        located = run([str(texbin / "kpsewhich.exe"), filename]).strip()
        if not located or not Path(located).resolve().is_relative_to(root / "texlive"):
            raise RuntimeError(f"Package is missing or leaks to system TeX: {filename}")
    run(["latexmk", "-v"])
    run([str(texbin / "bibtex.exe"), "--version"])
    with tempfile.TemporaryDirectory(prefix="sztu-offline-cjk-") as directory:
        work = Path(directory)
        (work / "smoke.tex").write_text(
            "\\documentclass{ctexart}\n\\usepackage{fontspec,tabularray,tcolorbox,adjustbox}\n"
            "\\setCJKmainfont{SimSun}\n\\begin{document}\n"
            "离线依赖验证。中文字体与分页预览测试。\n\n"
            "此内容完全虚构。运行环境无需在线安装宏包。\n\n"
            "列表换行与正文对齐。文档结构和中文字形分别检查。\n\\end{document}\n", encoding="utf-8")
        run([str(texbin / "xelatex.exe"), "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "smoke.tex"], work)
        text = run([str(pdfbin / "pdftotext.exe"), "-enc", "UTF-8", str(work / "smoke.pdf"), "-"])
        if not re.search(r"[\u4e00-\u9fff]", text):
            raise RuntimeError("Offline PDF has no Chinese text layer")
        run([sys.executable, str(ROOT / "scripts/validate_cjk_render.py"), str(work / "smoke.pdf"), "--dpi", "180", "--min-cjk-words", "2"])
    print(json.dumps({"runtime": str(root), "integrity": "pass", "system_tex_path": "excluded", "macro_packages": "pass", "cjk_pdf": "glyph-valid"}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
