#!/usr/bin/env python3
"""Discover and verify template packs without executing pack-controlled code."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Iterable


SUPPORTED_MANIFEST = (1, 0)
SUPPORTED_APP_CONTRACT = (1, 0)
SUPPORTED_DOCUMENT_CONTRACTS = {"proposal": (0, 2), **{kind: (0, 1) for kind in ("midterm", "task_book", "advisor_review", "reviewer_review", "defense_record", "grade_assessment")}}
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
SEMVER_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$")


@dataclass(frozen=True)
class PackValidationError(Exception):
    code: str
    message: str
    path: str | None = None

    def as_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.path is not None:
            result["path"] = self.path
        return result


def _fail(code: str, message: str, path: str | None = None) -> None:
    raise PackValidationError(code, message, path)


def _read_json(path: Path, code: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        _fail(code, f"无法读取 JSON：{exc}", path.name)
    if not isinstance(value, dict):
        _fail(code, "JSON 根值必须是对象", path.name)
    return value


def _version(value: Any, field: str) -> tuple[int, int]:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]+\.[0-9]+", value):
        _fail("MANIFEST_INVALID", f"{field} 必须是 MAJOR.MINOR")
    major, minor = value.split(".")
    return int(major), int(minor)


def _compatible(value: Any, supported: tuple[int, int], field: str) -> None:
    actual = _version(value, field)
    if actual[0] != supported[0]:
        _fail("CONTRACT_VERSION_UNSUPPORTED", f"不支持 {field}={value}")
    if actual[1] > supported[1]:
        _fail("CONTRACT_VERSION_TOO_NEW", f"{field}={value} 高于当前支持的 {supported[0]}.{supported[1]}")


def _safe_relative_path(raw: Any) -> PurePosixPath:
    if not isinstance(raw, str) or not raw or len(raw) > 512:
        _fail("PATH_INVALID", "模板路径必须是长度 1..512 的字符串")
    if "\x00" in raw or "\\" in raw or raw.startswith("/") or "//" in raw:
        _fail("PATH_INVALID", "模板路径必须是规范化 POSIX 相对路径", raw)
    path = PurePosixPath(raw)
    if path.is_absolute() or str(path) != raw or any(part in {"", ".", ".."} for part in path.parts):
        _fail("PATH_INVALID", "模板路径不得包含绝对路径、空段、. 或 ..", raw)
    return path


def _reject_symlink_chain(pack_root: Path, relative: PurePosixPath) -> Path:
    current = pack_root
    for part in relative.parts:
        current = current / part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            _fail("FILE_MISSING", "清单声明的文件不存在", relative.as_posix())
        if stat.S_ISLNK(mode):
            _fail("SYMLINK_FORBIDDEN", "模板包不得包含符号链接", relative.as_posix())
    if not current.is_file():
        _fail("FILE_MISSING", "清单路径不是普通文件", relative.as_posix())
    try:
        current.resolve().relative_to(pack_root.resolve())
    except ValueError:
        _fail("PATH_INVALID", "模板路径逃逸模板包根目录", relative.as_posix())
    return current


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _require_keys(value: dict[str, Any], required: set[str], allowed: set[str], code: str) -> None:
    missing = sorted(required - value.keys())
    unknown = sorted(value.keys() - allowed)
    if missing:
        _fail(code, f"缺少必需字段：{', '.join(missing)}")
    if unknown:
        _fail(code, f"包含未知字段：{', '.join(unknown)}")


def _validate_manifest_shape(manifest: dict[str, Any]) -> None:
    required = {
        "manifest_version", "template_id", "school", "document_type", "academic_year",
        "version", "contract_versions", "renderers", "renderer_versions", "entrypoints",
        "qa_policy", "files", "provenance",
    }
    _require_keys(manifest, required, required | {"name"}, "MANIFEST_INVALID")
    if manifest["manifest_version"] != "1.0":
        _compatible(manifest["manifest_version"], SUPPORTED_MANIFEST, "manifest_version")
    if not isinstance(manifest["template_id"], str) or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{2,127}", manifest["template_id"]):
        _fail("MANIFEST_INVALID", "template_id 格式无效")
    if manifest["document_type"] not in SUPPORTED_DOCUMENT_CONTRACTS:
        _fail("CONTRACT_VERSION_UNSUPPORTED", "当前文档类型没有受支持的数据合同")
    if not isinstance(manifest["academic_year"], int) or not 2000 <= manifest["academic_year"] <= 2200:
        _fail("MANIFEST_INVALID", "academic_year 无效")
    if not isinstance(manifest["version"], str) or not SEMVER_RE.fullmatch(manifest["version"]):
        _fail("MANIFEST_INVALID", "version 必须是 SemVer")
    contracts = manifest["contract_versions"]
    if not isinstance(contracts, dict) or set(contracts) != {"app_contract", "document_schema"}:
        _fail("MANIFEST_INVALID", "contract_versions 字段无效")
    _compatible(contracts["app_contract"], SUPPORTED_APP_CONTRACT, "app_contract")
    _compatible(contracts["document_schema"], SUPPORTED_DOCUMENT_CONTRACTS[manifest["document_type"]], "document_schema")
    renderers = manifest["renderers"]
    if not isinstance(renderers, list) or not renderers or len(renderers) != len(set(renderers)) or not set(renderers) <= {"latex", "docx"}:
        _fail("MANIFEST_INVALID", "renderers 必须是无重复的 latex/docx 列表")
    renderer_versions = manifest["renderer_versions"]
    if not isinstance(renderer_versions, dict) or set(renderer_versions) != set(renderers):
        _fail("MANIFEST_INVALID", "renderer_versions 必须与 renderers 一一对应")
    if not all(isinstance(version, str) and SEMVER_RE.fullmatch(version) for version in renderer_versions.values()):
        _fail("MANIFEST_INVALID", "renderer_versions 值必须是 SemVer")
    entrypoints = manifest["entrypoints"]
    if not isinstance(entrypoints, dict) or set(entrypoints) != set(renderers):
        _fail("MANIFEST_INVALID", "entrypoints 必须与 renderers 一一对应")
    provenance = manifest["provenance"]
    if not isinstance(provenance, dict):
        _fail("MANIFEST_INVALID", "provenance 必须是对象")
    _require_keys(provenance, {"source_kind", "license", "redistribution", "sources"}, {"source_kind", "license", "redistribution", "sources"}, "MANIFEST_INVALID")
    if provenance["source_kind"] not in {"synthetic", "upstream-derived", "local-overlay"}:
        _fail("MANIFEST_INVALID", "source_kind 无效")
    if provenance["redistribution"] not in {"allowed", "restricted", "local-only"}:
        _fail("MANIFEST_INVALID", "redistribution 无效")


def _validate_qa_policy(policy: dict[str, Any]) -> None:
    _require_keys(policy, {"policy_version", "required_fonts", "checks", "target_editors"}, {"policy_version", "required_fonts", "checks", "target_editors"}, "QA_POLICY_INVALID")
    if policy["policy_version"] != "1.0":
        _fail("QA_POLICY_INVALID", "只支持 qa policy 1.0")
    if not isinstance(policy["required_fonts"], list) or not isinstance(policy["target_editors"], list):
        _fail("QA_POLICY_INVALID", "字体和目标编辑器必须是数组")
    checks = policy["checks"]
    if not isinstance(checks, list):
        _fail("QA_POLICY_INVALID", "checks 必须是数组")
    gates: set[str] = set()
    check_ids: set[str] = set()
    for check in checks:
        if not isinstance(check, dict):
            _fail("QA_POLICY_INVALID", "每个 check 必须是对象")
        required = {"check_id", "gate", "required", "mode"}
        _require_keys(check, required, required | {"command", "notes"}, "QA_POLICY_INVALID")
        if check["check_id"] in check_ids:
            _fail("QA_POLICY_INVALID", "check_id 不得重复")
        check_ids.add(check["check_id"])
        gates.add(check["gate"])
        if "command" in check and (not isinstance(check["command"], list) or not all(isinstance(item, str) and item for item in check["command"])):
            _fail("QA_POLICY_INVALID", "command 必须是非空字符串参数数组")
    required_gates = {"structure", "cjk_glyph", "full_page_layout", "target_editor"}
    if not required_gates <= gates:
        _fail("QA_POLICY_INVALID", "必须分别声明结构、CJK、逐页和目标编辑器门禁")


def _walk_files(pack_root: Path) -> Iterable[str]:
    for directory, dirnames, filenames in os.walk(pack_root, followlinks=False):
        directory_path = Path(directory)
        for name in list(dirnames):
            child = directory_path / name
            if child.is_symlink():
                relative = child.relative_to(pack_root).as_posix()
                _fail("SYMLINK_FORBIDDEN", "模板包不得包含符号链接目录", relative)
        for name in filenames:
            child = directory_path / name
            relative = child.relative_to(pack_root).as_posix()
            if child.is_symlink():
                _fail("SYMLINK_FORBIDDEN", "模板包不得包含符号链接文件", relative)
            yield relative


def validate_pack(pack_root: Path) -> dict[str, Any]:
    """Validate one unpacked template pack and return its trusted descriptor."""
    pack_root = Path(pack_root)
    if pack_root.is_symlink():
        _fail("SYMLINK_FORBIDDEN", "模板包根目录不得是符号链接", str(pack_root))
    if not pack_root.is_dir():
        _fail("PACK_NOT_FOUND", "模板包目录不存在", str(pack_root))
    manifest_path = pack_root / "manifest.json"
    if manifest_path.is_symlink():
        _fail("SYMLINK_FORBIDDEN", "manifest.json 不得是符号链接", "manifest.json")
    if not manifest_path.is_file():
        _fail("MANIFEST_MISSING", "缺少 manifest.json", "manifest.json")
    manifest = _read_json(manifest_path, "MANIFEST_INVALID")
    _validate_manifest_shape(manifest)

    files = manifest["files"]
    if not isinstance(files, list) or not files:
        _fail("MANIFEST_INVALID", "files 必须是非空数组")
    declared: dict[str, dict[str, Any]] = {}
    for item in files:
        if not isinstance(item, dict):
            _fail("MANIFEST_INVALID", "files 元素必须是对象")
        _require_keys(item, {"path", "sha256", "media_type", "role"}, {"path", "sha256", "media_type", "role"}, "MANIFEST_INVALID")
        path = _safe_relative_path(item["path"]).as_posix()
        if path == "manifest.json":
            _fail("MANIFEST_INVALID", "manifest.json 不得自我声明哈希", path)
        if path in declared:
            _fail("DUPLICATE_FILE", "文件路径重复声明", path)
        if not isinstance(item["sha256"], str) or not SHA256_RE.fullmatch(item["sha256"]):
            _fail("MANIFEST_INVALID", "sha256 必须是 64 位小写十六进制", path)
        declared[path] = item

    for path, item in declared.items():
        file_path = _reject_symlink_chain(pack_root, PurePosixPath(path))
        actual = _sha256(file_path)
        if actual != item["sha256"]:
            _fail("HASH_MISMATCH", f"文件摘要不一致，期望 {item['sha256']}，实际 {actual}", path)

    actual_files = set(_walk_files(pack_root)) - {"manifest.json"}
    undeclared = sorted(actual_files - declared.keys())
    if undeclared:
        _fail("UNDECLARED_FILE", "模板包包含未声明文件", undeclared[0])

    entrypoints = manifest["entrypoints"]
    for renderer, raw_path in entrypoints.items():
        path = _safe_relative_path(raw_path).as_posix()
        item = declared.get(path)
        if item is None or item["role"] != "entrypoint":
            _fail("MANIFEST_INVALID", f"{renderer} 入口点必须声明为 entrypoint", path)
    qa_path = _safe_relative_path(manifest["qa_policy"]).as_posix()
    qa_item = declared.get(qa_path)
    if qa_item is None or qa_item["role"] != "qa_policy":
        _fail("MANIFEST_INVALID", "qa_policy 必须声明为 qa_policy 文件", qa_path)
    _validate_qa_policy(_read_json(pack_root / qa_path, "QA_POLICY_INVALID"))

    fixture_names = {Path(path).name for path, item in declared.items() if item["role"] == "fixture"}
    required_fixtures = {"short.json", "normal.json", "long.json", "layout_stress.json"}
    if not required_fixtures <= fixture_names:
        _fail("MANIFEST_INVALID", "缺少 short/normal/long/layout_stress fixture")

    return {
        "trusted": True,
        "template_id": manifest["template_id"],
        "version": manifest["version"],
        "document_type": manifest["document_type"],
        "contract_versions": manifest["contract_versions"],
        "manifest_sha256": _sha256(manifest_path),
        "files_verified": len(declared),
    }


def discover_packs(root: Path) -> list[dict[str, Any]]:
    """Discover immediate child packs in stable name order."""
    root = Path(root)
    if not root.is_dir():
        _fail("PACK_ROOT_NOT_FOUND", "模板包根目录不存在", str(root))
    results: list[dict[str, Any]] = []
    for child in sorted(root.iterdir(), key=lambda item: item.name):
        if child.name.startswith(".") or not child.is_dir():
            continue
        if (child / "manifest.json").exists() or (child / "manifest.json").is_symlink():
            result = validate_pack(child)
            result["directory"] = child.name
            results.append(result)
    return results


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", type=Path)
    parser.add_argument("--discover", type=Path, metavar="ROOT")
    args = parser.parse_args(argv)
    if (args.path is None) == (args.discover is None):
        parser.error("provide exactly one pack path or --discover ROOT")
    try:
        if args.discover is not None:
            output: dict[str, Any] = {"trusted": True, "packs": discover_packs(args.discover)}
        else:
            output = validate_pack(args.path)
    except PackValidationError as exc:
        print(json.dumps({"trusted": False, "error": exc.as_dict()}, ensure_ascii=False, sort_keys=True))
        return 1
    print(json.dumps(output, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(_main())
