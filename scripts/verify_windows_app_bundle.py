"""Verify Windows bundle integrity and exercise its actual JSONL executable."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from build_backend_sidecar import request
from windows_bundle_runtime import bundle_runtime

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "src"))
from sztu_docs_backend.docx_privacy import (  # noqa: E402
    PUBLIC_RELEASE_REDISTRIBUTION,
    RELEASE_DOCX_METADATA_POLICY,
    inspect_release_docx_metadata,
)


def verify_file(root: Path, entry: dict) -> Path:
    name = entry.get("path", entry.get("file"))
    if not isinstance(name, str) or "\\" in name or Path(name).is_absolute():
        raise RuntimeError("Invalid bundle file path")
    target = root / name
    if target.is_symlink() or not target.resolve().is_relative_to(root.resolve()):
        raise RuntimeError("Bundle file escapes its root")
    if target.stat().st_size != entry.get("size_bytes"):
        raise RuntimeError(f"Bundle file size mismatch: {name}")
    if hashlib.sha256(target.read_bytes()).hexdigest() != entry.get("sha256"):
        raise RuntimeError(f"Bundle file hash mismatch: {name}")
    return target


def main() -> int:
    bundle = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "release" / "win-unpacked"
    resources = bundle / "resources"
    for target in (bundle / "SZTU-Docs-Studio.exe", resources / "app.asar", resources / "backend" / "pyproject.toml"):
        if not target.is_file():
            raise RuntimeError(f"Required application file is missing: {target.name}")
    if (resources / "app.asar").stat().st_size > 16 * 1024 * 1024:
        raise RuntimeError("Application archive is unexpectedly large")
    sidecar_root = resources / "sidecar"
    sidecar_manifest = json.loads((sidecar_root / "build-manifest.json").read_text(encoding="utf-8"))
    if (sidecar_manifest["target"], sidecar_manifest["architecture"]) != ("win32", "x64"):
        raise RuntimeError("Sidecar target does not match Windows x64")
    executable = verify_file(sidecar_root, sidecar_manifest["sidecar"])
    engines_root = resources / "bundled-template-engines"
    manifest = json.loads((engines_root / "bundle-manifest.json").read_text(encoding="utf-8"))
    if manifest["redistribution"] != PUBLIC_RELEASE_REDISTRIBUTION or manifest["docx_metadata_policy"] != RELEASE_DOCX_METADATA_POLICY:
        raise RuntimeError("Template bundle policy is invalid")
    expected_engines = {"proposal", "task_book", "midterm", "advisor_review", "reviewer_review", "defense_record", "grade_assessment"}
    if set(manifest["engines"]) != expected_engines:
        raise RuntimeError("Template bundle does not contain the seven supported process-document engines")
    for name in sorted(expected_engines):
        engine = manifest["engines"][name]
        engine_root = engines_root / name
        for entry in engine["files"]:
            verify_file(engine_root, entry)
        scrubbed = engine["metadata_scrubbed_files"]
        if len(scrubbed) != 1:
            raise RuntimeError(f"{name} must have one scrubbed official template")
        report = inspect_release_docx_metadata(engine_root / scrubbed[0])
        if report:
            raise RuntimeError(f"{name} template metadata failed privacy checks")
    for target in engines_root.rglob("*"):
        if target.suffix.lower() in {".ttf", ".ttc", ".otf"}:
            raise RuntimeError("Document fonts must not be bundled")
    # 系统不常备的文档字体必须随包分发，否则新机器上论文题名、任务书校名和封面会直接失败。
    for font in ("STZhongsong.ttf", "STXingkai.ttf", "FZXiaoBiaoSong-B05S.ttf"):
        if not (resources / "document-fonts" / font).is_file():
            raise RuntimeError(f"Bundled document font missing: {font}")
    with tempfile.TemporaryDirectory(prefix="sztu-windows-bundle-") as data_root:
        environment_path = os.environ.get("PATH", "")
        runtime = bundle_runtime(resources, Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else None)
        if runtime.is_dir():
            environment_path = os.pathsep.join((str(runtime / "texlive/bin/windows"), str(runtime / "poppler/Library/bin"), str(Path(os.environ["SYSTEMROOT"]) / "System32")))
        process = subprocess.Popen(
            [str(executable)], cwd=resources / "backend",
            env={**os.environ, "PATH": environment_path, "SZTU_DOCS_DATA_DIR": data_root,
                 "SZTU_DOCS_TEMPLATE_PACKS_DIR": str(resources / "template-packs"),
                 "SZTU_FONT_DIR": str(resources / "document-fonts"),
                 "SZTU_DOCS_BUNDLED_ENGINES_DIR": str(engines_root)},
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8",
        )
        try:
            request(process, "system.ping")
            environment = request(process, "environment.check")["result"]
            required = {"document_dependencies", "proposal_engine", "task_book_engine", "midterm_engine"}
            required.update(f"{name}_engine" for name in expected_engines)
            if runtime.is_dir():
                required.update({"xelatex", "process_tex_packages", "pdf_tools"})
            checks = {entry["id"]: entry for entry in environment["checks"]}
            for name in required:
                if checks.get(name, {}).get("status") != "pass":
                    raise RuntimeError(f"Bundled runtime check failed: {name}")
            print(json.dumps({"bundle": str(bundle), "integrity": "pass", "jsonl_utf8": "pass",
                              "environment": {name: entry["status"] for name, entry in checks.items()}}, ensure_ascii=False, indent=2))
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream is not None:
                    stream.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
