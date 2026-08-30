#!/usr/bin/env python3
"""Prepare the repository-local Python runtime used by the Electron sidecar."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tomllib
import venv
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
VENV_ROOT = REPOSITORY_ROOT / ".venv"
PYPROJECT = REPOSITORY_ROOT / "backend" / "pyproject.toml"
MARKER = VENV_ROOT / ".sztu-backend-runtime.json"


def venv_python() -> Path:
    if sys.platform == "win32":
        return VENV_ROOT / "Scripts" / "python.exe"
    return VENV_ROOT / "bin" / "python"


def dependency_fingerprint() -> str:
    digest = hashlib.sha256()
    digest.update(PYPROJECT.read_bytes())
    digest.update(f"{sys.version_info.major}.{sys.version_info.minor}".encode("ascii"))
    return digest.hexdigest()


def runtime_is_current(python: Path, fingerprint: str) -> bool:
    try:
        marker = json.loads(MARKER.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return False
    if marker.get("dependency_fingerprint") != fingerprint:
        return False
    completed = subprocess.run(
        [str(python), "-c", "import docx, PIL"],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return completed.returncode == 0


def main() -> int:
    python = venv_python()
    fingerprint = dependency_fingerprint()
    if python.is_file() and runtime_is_current(python, fingerprint):
        print(f"Backend runtime is ready: {python}")
        return 0

    if not python.is_file():
        print(f"Creating private backend runtime: {VENV_ROOT}")
        venv.EnvBuilder(with_pip=True).create(VENV_ROOT)

    project = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))
    dependencies = project["project"]["dependencies"]
    if not isinstance(dependencies, list) or not all(
        isinstance(item, str) for item in dependencies
    ):
        raise SystemExit("backend dependencies are invalid")
    subprocess.run(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            *dependencies,
        ],
        check=True,
    )
    MARKER.write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "dependency_fingerprint": fingerprint,
                "base_python": sys.executable,
            },
            ensure_ascii=True,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Backend runtime is ready: {python}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
