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
    if data.get("schema_version") not in {"1.0", "2.0"}:
        raise RuntimeError("Unsupported runtime layout")
    relative = Path("SZTU-Docs/r") / identity[:16] if data["schema_version"] == "2.0" else Path("SZTU-Docs-Studio/runtimes") / identity
    root = staging or Path(os.environ["LOCALAPPDATA"]) / relative
    if hashlib.sha256((root / "runtime-manifest.json").read_bytes()).hexdigest() != data["manifest_sha256"]:
        raise RuntimeError("Runtime manifest mismatch")
    if staging is None and (not (root / "complete.txt").is_file() or (root / "complete.txt").read_text(encoding="utf-8") != identity):
        raise RuntimeError("Incomplete runtime installation")
    return root
