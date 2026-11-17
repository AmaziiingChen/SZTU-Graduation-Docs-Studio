"""Prove whether a non-ASCII runtime root reproduces the Windows preview failure.

The reported failure (diagnostic 2dd9f424-918e-4deb-8c64-540c2577a77e, app 0.1.15)
was `I can't find the format file 'xelatex.fmt'!` with a user profile named 林振宇.
The working theory is that the runtime root sits under a profile directory whose
name never receives an 8.3 short alias, so `GetShortPathNameW` leaves the Chinese
bytes in `TEXMFROOT`/`TEXMFCNF` and kpathsea cannot open `texmf.cnf`.

This script exercises five scenarios against a verified runtime bundle and writes a
machine-readable report. It never mutates the runtime bundle: the non-ASCII roots are
directory junctions (no copying).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "src"))
from sztu_docs_backend.runtime_paths import (  # noqa: E402
    offline_tex_environment,
    windows_process_environment,
    windows_tool_path,
)

DOCUMENT = (
    "\\documentclass{article}\n"
    "\\begin{document}\n"
    "engine path probe\n"
    "\\end{document}\n"
)

# Short enough to be a valid 8.3 name on NTFS, exactly like a three-character
# Chinese profile name. Such a name does not receive a short alias.
SHORT_CJK = "探针引擎"
# Longer than eight characters, so NTFS must mint a short alias for it.
LONG_CJK = "探针引擎中文长目录名"

FAILURE_MARKERS = (
    "can't find the format file",
    "texmf.cnf not found",
    "no appropriate script or program found",
    "I can't write on file",
    "! LaTeX Error",
    "! Emergency stop",
)


@dataclass
class Case:
    key: str
    title: str
    root: str
    output: str
    console_codepage: int | None = None
    exit_code: int | None = None
    pdf_bytes: int = 0
    diagnostic: list[str] = field(default_factory=list)
    texmfroot: str = ""
    texmfcnf: str = ""
    verdict: str = ""


def fail(message: str) -> None:
    print(f"::error::{message}")
    raise SystemExit(1)


def run(command, **kwargs):
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        **kwargs,
    )


def describe_failure(result) -> list[str]:
    lines: list[str] = []
    for stream in (result.stdout, result.stderr):
        for line in (stream or "").splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            if any(marker in stripped for marker in FAILURE_MARKERS):
                lines.append(stripped)
        if len(lines) >= 5:
            break
    return lines[:5]


def environment_for(root: Path) -> dict[str, str]:
    texbin = root / "texlive" / "bin" / "windows"
    environment = dict(os.environ)
    environment["PATH"] = f"{texbin}{os.pathsep}{environment.get('PATH', '')}"
    environment = windows_process_environment(environment)
    environment.update(offline_tex_environment(environment["PATH"]))
    return environment


def make_junction(link: Path, target: Path) -> None:
    link.parent.mkdir(parents=True, exist_ok=True)
    result = run(["cmd", "/c", "mklink", "/J", str(link), str(target)])
    if result.returncode != 0:
        fail(f"mklink /J failed: {result.stdout} {result.stderr}".strip())


def verify_runtime(root: Path) -> None:
    required = [
        root / "runtime-manifest.json",
        root / "texlive" / "texmf.cnf",
        root / "texlive" / "texmf-var" / "web2c" / "xetex" / "xelatex.fmt",
        root / "texlive" / "bin" / "windows" / "xelatex.exe",
        root / "poppler" / "Library" / "bin" / "pdftoppm.exe",
    ]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        fail(f"runtime bundle is incomplete: {missing}")


def probe_environment_facts(scratch: Path) -> dict:
    facts: dict = {
        "python": sys.version.split()[0],
        "platform": sys.platform,
        "unicode_environment": os.environ.get("PYTHONUTF8"),
        "preferred_encoding": __import__("locale").getpreferredencoding(False),
        "filesystem_encoding": sys.getfilesystemencoding(),
        "stdout_encoding": (getattr(sys.stdout, "encoding", None) or ""),
    }
    version = run(["cmd", "/c", "ver"])
    facts["windows"] = (version.stdout or "").strip()
    codepage = run(["cmd", "/c", "chcp"])
    facts["console_codepage"] = (codepage.stdout or "").strip()
    short_names = run(["cmd", "/c", "fsutil", "8dot3name", "query", "C:"])
    facts["short_name_policy"] = (short_names.stdout or short_names.stderr or "").strip()
    # Windows may disable 8.3 names per volume; record the effective behaviour.
    ascii_probe = scratch / "ascii-probe-directory"
    ascii_probe.mkdir(parents=True, exist_ok=True)
    facts["short_name_ascii_control"] = windows_tool_path(str(ascii_probe))
    return facts


def short_name_evidence(directory: Path) -> dict:
    return {
        "path": str(directory),
        "short": windows_tool_path(str(directory)),
        "aliased": windows_tool_path(str(directory)) != str(directory),
    }


def build_cases(scratch: Path, ascii_root: Path, real_root: Path) -> list[Case]:
    short_root = scratch / SHORT_CJK / "engine"
    long_root = scratch / LONG_CJK / "engine"
    make_junction(short_root, real_root)
    make_junction(long_root, real_root)
    return [
        Case("A", "ASCII 引擎根 + ASCII 工作目录（基线）", str(ascii_root), "ascii"),
        Case("B", "ASCII 引擎根 + 中文输出目录", str(ascii_root), "cjk"),
        Case("C", "中文引擎根（4 字，无 8.3 短名）+ ASCII 工作目录", str(short_root), "ascii"),
        Case("D", "中文引擎根（10 字，有 8.3 短名）+ ASCII 工作目录", str(long_root), "ascii"),
        Case("E", "中文引擎根（4 字）+ 控制台代码页 936", str(short_root), "ascii", 936),
    ]


def execute(case: Case, scratch: Path, ascii_root: Path) -> Case:
    root = Path(case.root)
    workdir = scratch / f"work-{case.key}"
    outdir = scratch / (f"out-{case.key}-{SHORT_CJK}" if case.output == "cjk" else f"out-{case.key}")
    for directory in (workdir, outdir):
        directory.mkdir(parents=True, exist_ok=True)
    document = workdir / "probe.tex"
    document.write_text(DOCUMENT, encoding="utf-8")

    environment = environment_for(root)
    case.texmfroot = environment.get("TEXMFROOT", "")
    case.texmfcnf = environment.get("TEXMFCNF", "")

    xelatex = ascii_root / "texlive" / "bin" / "windows" / "xelatex.exe"
    arguments = [
        str(xelatex),
        "-interaction=nonstopmode",
        "-halt-on-error",
        f"-output-directory={outdir}",
        str(document),
    ]
    if case.console_codepage is None:
        result = run(arguments, cwd=workdir, env=environment)
    else:
        quoted = " ".join(f'"{item}"' for item in arguments)
        script = f"chcp {case.console_codepage} >nul & {quoted}"
        result = run(["cmd", "/c", script], cwd=workdir, env=environment)
    case.exit_code = result.returncode

    pdf = outdir / "probe.pdf"
    case.pdf_bytes = pdf.stat().st_size if pdf.is_file() else 0
    if result.returncode == 0 and case.pdf_bytes > 1024:
        case.verdict = "success"
    else:
        case.verdict = "failure"
        case.diagnostic = describe_failure(result)
        if not case.diagnostic:
            tail = ((result.stdout or "") + (result.stderr or "")).strip().splitlines()
            case.diagnostic = [line.strip() for line in tail[-5:] if line.strip()]
    return case


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine-root", type=Path, default=ROOT / "build" / "offline-runtime")
    parser.add_argument("--report", type=Path, default=ROOT / "build" / "probe-report.json")
    arguments = parser.parse_args()

    if sys.platform != "win32":
        fail("This probe only runs on Windows x64.")

    real_root = arguments.engine_root.resolve(strict=True)
    verify_runtime(real_root)
    scratch = Path(os.environ["RUNNER_TEMP"] if "RUNNER_TEMP" in os.environ else os.environ["TEMP"])
    scratch = scratch / "sztu-engine-path-probe"
    if scratch.exists():
        shutil.rmtree(scratch)
    scratch.mkdir(parents=True)

    ascii_root = real_root
    ascii_out = scratch / "ascii-output"
    ascii_out.mkdir()

    facts = probe_environment_facts(scratch)
    facts["engine_root"] = {
        "path": str(real_root),
        "ascii": real_root.as_posix().isascii(),
        "short": windows_tool_path(str(real_root)),
    }
    cases = [execute(case, scratch, ascii_root) for case in build_cases(scratch, ascii_root, real_root)]
    facts["cjk_directory_short_names"] = [
        short_name_evidence(scratch / SHORT_CJK),
        short_name_evidence(scratch / LONG_CJK),
    ]

    print(f"engine root      : {real_root}")
    print(f"ascii            : {real_root.as_posix().isascii()}")
    for item in facts["cjk_directory_short_names"]:
        print(f"short name       : {item['path']} -> {item['short']} (aliased={item['aliased']})")
    print("")
    for case in cases:
        print(f"[{case.key}] {case.title}")
        print(f"     exit={case.exit_code} pdf={case.pdf_bytes} verdict={case.verdict}")
        print(f"     TEXMFROOT={case.texmfroot}")
        for line in case.diagnostic:
            print(f"     ! {line}")
    print("")

    reproduced = next((case for case in cases if case.key == "C"), None)
    if reproduced is None:
        fail("Case C did not run")
    if reproduced.verdict == "failure":
        print("PROBE VERDICT: non-ASCII engine root REPRODUCES the reported failure.")
    else:
        print("PROBE VERDICT: non-ASCII engine root did NOT reproduce the failure on this runner.")

    report = {
        "schema_version": "1.0",
        "environment": facts,
        "cases": [case.__dict__ for case in cases],
        "reproduced": reproduced.verdict == "failure",
    }
    arguments.report.parent.mkdir(parents=True, exist_ok=True)
    arguments.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"report: {arguments.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
