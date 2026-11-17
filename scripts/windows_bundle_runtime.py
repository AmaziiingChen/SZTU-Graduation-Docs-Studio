"""Resolve installer-owned tools; verification may explicitly use the build input."""
import hashlib
import json
import os
from pathlib import Path

VARIABLES = ("PROGRAMDATA", "LOCALAPPDATA", "PROGRAMFILES")


def _expand(value: str) -> Path | None:
    expanded = value
    for name in VARIABLES:
        replacement = os.environ.get(name)
        if replacement:
            expanded = expanded.replace(f"%{name}%", replacement)
    if "%" in expanded:
        return None
    path = Path(expanded)
    return path if path.is_absolute() else None


def candidate_roots(data: dict) -> list[Path]:
    roots = data.get("roots")
    if not isinstance(roots, list) or not roots:
        raise RuntimeError("Invalid runtime roots")
    result = []
    for entry in roots:
        if not isinstance(entry, dict):
            raise RuntimeError("Invalid runtime roots")
        if entry.get("kind") == "env":
            name = entry.get("name")
            if not isinstance(name, str):
                raise RuntimeError("Invalid runtime roots")
            value = os.environ.get(name)
            if value and Path(value).is_absolute():
                result.append(Path(value))
            continue
        if entry.get("kind") != "path" or not isinstance(entry.get("value"), str):
            raise RuntimeError("Invalid runtime roots")
        expanded = _expand(entry["value"])
        if expanded is not None:
            result.append(expanded)
    return result


def bundle_runtime(resources: Path, staging: Path | None = None) -> Path:
    descriptor = resources / "offline-runtime-location.json"
    if not descriptor.exists():
        return resources / "offline-runtime"
    data = json.loads(descriptor.read_text(encoding="utf-8"))
    identity = data["runtime_id"]
    if len(identity) != 64 or any(c not in "0123456789abcdef" for c in identity):
        raise RuntimeError("Invalid runtime identity")
    schema = data.get("schema_version")
    if staging is not None:
        root = staging
    elif schema == "3.0":
        usable, blocked = [], []
        for candidate in candidate_roots(data):
            marker = candidate / "complete.txt"
            complete = marker.is_file() and marker.read_text(encoding="utf-8") == identity
            if not complete:
                continue
            # TeX Live cannot read a non-ASCII root; never resolve to one.
            (usable if str(candidate).isascii() else blocked).append(candidate)
            if usable:
                break
        if not usable:
            if blocked:
                raise RuntimeError("Runtime is installed outside an ASCII path")
            raise RuntimeError("Incomplete runtime installation")
        root = usable[0]
    elif schema in {"1.0", "2.0"}:
        relative = Path("SZTU-Docs/r") / identity[:16] if schema == "2.0" else Path("SZTU-Docs-Studio/runtimes") / identity
        root = Path(os.environ["LOCALAPPDATA"]) / relative
    else:
        raise RuntimeError("Unsupported runtime layout")
    if hashlib.sha256((root / "runtime-manifest.json").read_bytes()).hexdigest() != data["manifest_sha256"]:
        raise RuntimeError("Runtime manifest mismatch")
    if staging is None and (not (root / "complete.txt").is_file() or (root / "complete.txt").read_text(encoding="utf-8") != identity):
        raise RuntimeError("Incomplete runtime installation")
    return root
