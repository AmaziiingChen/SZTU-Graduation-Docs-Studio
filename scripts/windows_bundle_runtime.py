"""Resolve installer-owned tools; verification may explicitly use the build input."""
import hashlib
import json
import os
from pathlib import Path


def bundle_runtime(resources: Path, staging: Path | None = None) -> Path:
    descriptor = resources / "offline-runtime-location.json"
    if not descriptor.exists():
        return resources / "offline-runtime"
    data = json.loads(descriptor.read_text(encoding="utf-8"))
    identity = data["runtime_id"]
    if len(identity) != 64 or any(c not in "0123456789abcdef" for c in identity):
        raise RuntimeError("Invalid runtime identity")
    root = staging or Path(os.environ["LOCALAPPDATA"]) / "SZTU-Docs-Studio/runtimes" / identity
    if hashlib.sha256((root / "runtime-manifest.json").read_bytes()).hexdigest() != data["manifest_sha256"]:
        raise RuntimeError("Runtime manifest mismatch")
    if staging is None and not (root / "complete.txt").is_file():
        raise RuntimeError("Incomplete runtime installation")
    return root
