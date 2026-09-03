#!/usr/bin/env python3
"""Build and smoke-test the self-contained macOS document sidecar."""

from __future__ import annotations

import json
import hashlib
import importlib.metadata
import os
import platform
import select
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARCHITECTURE = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "x64"}.get(
    platform.machine().lower(), platform.machine().lower()
)
BUILD_ROOT = ROOT / "build"
DIST_ROOT = BUILD_ROOT / "sidecar" / f"darwin-{ARCHITECTURE}"
WORK_ROOT = BUILD_ROOT / "pyinstaller" / f"darwin-{ARCHITECTURE}"
EXECUTABLE = DIST_ROOT / "sztu-docs-backend"
BUILD_MANIFEST = DIST_ROOT / "build-manifest.json"


def request(process: subprocess.Popen[str], method: str) -> dict[str, object]:
    request_id = str(uuid.uuid4())
    assert process.stdin is not None
    assert process.stdout is not None
    process.stdin.write(
        json.dumps(
            {
                "protocol": "1.0",
                "id": request_id,
                "method": method,
                "params": {},
            }
        )
        + "\n"
    )
    process.stdin.flush()
    ready, _, _ = select.select([process.stdout], [], [], 30)
    if not ready:
        raise RuntimeError(f"Packaged sidecar did not answer {method} within 30 seconds.")
    response = json.loads(process.stdout.readline())
    if response.get("id") != request_id or response.get("ok") is not True:
        raise RuntimeError(f"Packaged sidecar returned an invalid response: {response!r}")
    return response


def smoke_test() -> None:
    data_root = tempfile.mkdtemp(prefix="sztu-packaged-sidecar-")
    process = subprocess.Popen(
        [str(EXECUTABLE)],
        cwd=ROOT,
        env={
            **os.environ,
            "SZTU_DOCS_DATA_DIR": data_root,
            "SZTU_DOCS_TEMPLATE_PACKS_DIR": str(ROOT / "template-packs"),
        },
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        request(process, "system.ping")
        environment = request(process, "environment.check")
        result = environment.get("result")
        if not isinstance(result, dict):
            raise RuntimeError("Packaged environment check omitted its result.")
        checks = result.get("checks")
        if not isinstance(checks, list):
            raise RuntimeError("Packaged environment check omitted checks.")
        dependency_check = next(
            (
                item
                for item in checks
                if isinstance(item, dict) and item.get("id") == "document_dependencies"
            ),
            None,
        )
        if not isinstance(dependency_check, dict) or dependency_check.get("status") != "pass":
            raise RuntimeError(
                f"Packaged document dependencies are unavailable: {dependency_check!r}"
            )
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        shutil.rmtree(data_root, ignore_errors=True)


def write_build_manifest() -> None:
    digest = hashlib.sha256(EXECUTABLE.read_bytes()).hexdigest()
    packages = {
        name: importlib.metadata.version(distribution)
        for name, distribution in {
            "pillow": "Pillow",
            "pyinstaller": "pyinstaller",
            "python-docx": "python-docx",
            "lxml": "lxml",
        }.items()
    }
    BUILD_MANIFEST.write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "target": "darwin",
                "architecture": ARCHITECTURE,
                "python_version": platform.python_version(),
                "packages": packages,
                "sidecar": {
                    "file": EXECUTABLE.name,
                    "sha256": digest,
                    "size_bytes": EXECUTABLE.stat().st_size,
                },
                "excluded_runtime_dependencies": [
                    "document-fonts",
                    "poppler",
                    "tex-live",
                ],
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> int:
    if sys.platform != "darwin":
        raise SystemExit("This build target must run on macOS.")
    if ARCHITECTURE not in {"arm64", "x64"}:
        raise SystemExit(f"Unsupported macOS architecture: {ARCHITECTURE}")

    for target in (DIST_ROOT, WORK_ROOT):
        if target.exists():
            shutil.rmtree(target)
        target.mkdir(parents=True, exist_ok=True)

    subprocess.run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--onefile",
            "--name",
            EXECUTABLE.name,
            "--distpath",
            str(DIST_ROOT),
            "--workpath",
            str(WORK_ROOT / "work"),
            "--specpath",
            str(WORK_ROOT / "spec"),
            "--paths",
            str(ROOT / "backend" / "src"),
            "--collect-all",
            "docx",
            "--collect-all",
            "PIL",
            "--collect-all",
            "lxml",
            str(ROOT / "scripts" / "backend_sidecar_entry.py"),
        ],
        cwd=ROOT,
        check=True,
    )
    smoke_test()
    write_build_manifest()
    print(f"Packaged sidecar is ready: {EXECUTABLE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
