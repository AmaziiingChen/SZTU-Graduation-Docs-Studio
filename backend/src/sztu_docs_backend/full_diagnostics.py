"""Local, per-operation evidence, retained only when the operation fails."""

from __future__ import annotations

import contextlib
import functools
import hashlib
import json
import os
import platform
import shutil
import sys
import time
import traceback
import zipfile
import uuid
from contextvars import ContextVar
from pathlib import Path
from typing import Any

from .storage.paths import prepare_private_directory, protect_private_file, resolve_data_directory
from .version import BACKEND_VERSION

CAPTURE_METHODS = frozenset({
    "environment.check", "document.check", "preview.generate", "export.preflight",
    "export.run", "workspace.saveDraft", "workspace.saveProfile", "workspace.saveProfileDraft",
    "workspace.createDocument", "workspace.open", "template.install",
    "diagnostic.prepare",
})
RETENTION_SECONDS = 48 * 60 * 60
MAX_FAILED_CASES = 5


class Case:
    def __init__(self, case_id: str, method: str) -> None:
        self.case_id = case_id
        self.method = method
        self.path = resolve_data_directory() / "diagnostics" / "full" / case_id
        self.files: dict[str, int] = {}
        self.missing: list[str] = []
        self.counter = 0
        self.failed = False
        self.started_at = time.time()
        self.stages: list[dict[str, Any]] = []

    def stage(self, value: dict[str, Any]) -> None:
        self.stages.append(value)
        name = "stages-live.jsonl"
        try:
            prepare_private_directory(self.path)
            target = self.path / name
            with target.open("ab") as stream:
                protect_private_file(target)
                stream.write((json.dumps(value, ensure_ascii=False) + "\n").encode("utf-8"))
            self.files[name] = target.stat().st_size
        except OSError:
            if name not in self.missing:
                self.missing.append(name)

    def raw_stream(self, name: str):
        try:
            prepare_private_directory(self.path)
            target = self.path / name
            prepare_private_directory(target.parent)
            stream = target.open("w+b")
            protect_private_file(target)
            self.files[name] = 0
            return stream
        except OSError:
            self.missing.append(name)
            return None

    def write(self, name: str, data: bytes) -> None:
        try:
            prepare_private_directory(self.path)
            target = self.path / name
            prepare_private_directory(target.parent)
            target.write_bytes(data)
            protect_private_file(target)
            self.files[name] = len(data)
        except OSError:
            self.missing.append(name)

    def json(self, name: str, value: Any) -> None:
        self.write(name, (json.dumps(value, ensure_ascii=False, default=str) + "\n").encode("utf-8"))

    def file(self, name: str, source: Path) -> None:
        try:
            if not source.is_file() or source.is_symlink():
                self.missing.append(name)
                return
            prepare_private_directory(self.path)
            target = self.path / name
            prepare_private_directory(target.parent)
            shutil.copyfile(source, target)
            protect_private_file(target)
            self.files[name] = target.stat().st_size
        except OSError:
            self.missing.append(name)

    def tree(self, name: str, root: Path, *, skip: frozenset[str] = frozenset()) -> None:
        if not root.is_dir() or root.is_symlink():
            self.missing.append(name)
            return
        for directory, folders, files in os.walk(root, onerror=lambda _: self.missing.append(name)):
            folders[:] = [folder for folder in folders if folder not in skip and not (Path(directory) / folder).is_symlink()]
            for basename in files:
                source = Path(directory) / basename
                if source.suffix.lower() in {".ttf", ".ttc", ".otf"} or basename in skip:
                    continue
                self.file(f"{name}/{source.relative_to(root).as_posix()}", source)

    def finish(self, response: dict[str, Any], *, defer_success: bool = False) -> None:
        result = response.get("result")
        checks = result.get("checks", []) if isinstance(result, dict) else []
        manual = self.method == "diagnostic.prepare"
        self.failed = self.failed or not response.get("ok") or any(
            isinstance(check, dict) and check.get("status") == "fail" for check in checks
        )
        if defer_success and not self.failed:
            self.json("response.json", response)
            self.json("stages.json", self.stages)
            return
        if (not manual and not self.failed) or response.get("error", {}).get("code") in {"EXPORT_CANCELLED", "PREVIEW_CANCELLED"}:
            if self.path.is_dir():
                shutil.rmtree(self.path, ignore_errors=True)
            return
        self.json("response.json", response)
        self.json("stages.json", self.stages)
        for source in self.path.glob("tools/*/nested/*"):
            if source.is_file() and not source.is_symlink():
                name = source.relative_to(self.path).as_posix()
                self.files[name] = 0
        for name in list(self.files):
            try:
                self.files[name] = (self.path / name).stat().st_size
            except OSError:
                del self.files[name]
                self.missing.append(name)
        excluded = [
            "系统字体文件、凭据库及本次操作之外的文件",
            "应用源码副本，可通过版本和文档引擎校验值查找对应构建",
        ]
        if self.method in {"preview.generate", "export.run"}:
            excluded.append("旧模板内部截断或删除且未写入日志的材料")
        if manual:
            excluded.append("手动创建时未执行预览或导出，因此没有对应的编译日志和中间产物")
        manifest = {
            "reportId": self.case_id, "operation": self.method, "createdAt": self.started_at,
            "files": [{"name": name, "sizeBytes": size} for name, size in sorted(self.files.items())],
            "missing": self.missing,
            "excluded": excluded,
        }
        try:
            archive = self.path / "case.zip"
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
                for name in self.files:
                    bundle.write(self.path / name, name)
                bundle.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
            protect_private_file(archive)
            manifest["sizeBytes"] = archive.stat().st_size
            self.json("manifest.json", manifest)
            if "manifest.json" not in self.files:
                return
            for name in list(self.files):
                if name != "manifest.json":
                    (self.path / name).unlink(missing_ok=True)
        except (OSError, RuntimeError, zipfile.LargeZipFile):
            manifest["missing"].append("ZIP 未能生成，原始材料仍在本机")
            self.json("incomplete.json", manifest)
            return
        old_cases = sorted(
            (item for item in self.path.parent.iterdir() if item != self.path and (item / "manifest.json").is_file()),
            key=lambda item: (item / "manifest.json").stat().st_mtime, reverse=True,
        )
        for index, item in enumerate(old_cases):
            if index >= MAX_FAILED_CASES - 1 or time.time() - (item / "manifest.json").stat().st_mtime > RETENTION_SECONDS:
                shutil.rmtree(item, ignore_errors=True)


def finalize_desktop_case(case_id: str, *, error: dict[str, Any] | None) -> None:
    root = resolve_data_directory() / "diagnostics" / "full" / case_id
    if error is None:
        if root.is_dir() and not root.is_symlink() and not (root / "manifest.json").is_file():
            shutil.rmtree(root)
    else:
        recover_interrupted_case(case_id, desktop_error=error)


def recover_interrupted_case(case_id: str, *, desktop_error: dict[str, Any] | None = None) -> None:
    """Finalize files left on disk after the Electron-owned engine stopped."""
    root = resolve_data_directory() / "diagnostics" / "full"
    if not root.is_dir():
        return
    for path in (root / case_id,):
        if path.is_symlink() or not path.is_dir() or (path / "manifest.json").is_file():
            continue
        try:
            if str(uuid.UUID(path.name)) != path.name:
                continue
            started = json.loads((path / "capture-start.json").read_text("utf-8"))
            case = Case(path.name, started["operation"])
            case.started_at = float(started["createdAt"])
            for source in path.rglob("*"):
                if source.is_file() and not source.is_symlink() and source.name not in {"case.zip", "incomplete.json"}:
                    case.files[source.relative_to(path).as_posix()] = source.stat().st_size
            live_stages = path / "stages-live.jsonl"
            if live_stages.is_file():
                for line in live_stages.read_bytes().splitlines():
                    try:
                        case.stages.append(json.loads(line))
                    except (UnicodeDecodeError, ValueError):
                        case.missing.append("引擎退出时有未写完的步骤记录，原始字节仍在包内")
                        break
            if desktop_error is None:
                case.missing.append("文档引擎中途退出，只保留了退出前写入本机的材料")
                if (path / "engine-startup-stderr-truncated").is_file():
                    case.missing.append("文档引擎启动输出超出 256 KiB，仅保留开头")
                interruption = path / "engine-interruption.json"
                if interruption.is_file():
                    with contextlib.suppress(OSError, ValueError):
                        interruption_info = json.loads(interruption.read_text("utf-8"))
                        if interruption_info.get("protocol_fragment") == "multiple_pending_requests":
                            case.missing.append("协议异常时存在多个请求，无法确认原始输出归属")
                        elif interruption_info.get("code") == "MESSAGE_TOO_LARGE":
                            case.missing.append("异常协议输出超过 1 MiB，仅保留开头")
                response = {"ok": False, "error": {"code": "SIDECAR_INTERRUPTED"}}
            else:
                engine_response = path / "response.json"
                if engine_response.is_file():
                    case.file("engine-response.json", engine_response)
                stages = path / "stages.json"
                if stages.is_file():
                    case.stages = json.loads(stages.read_text("utf-8"))
                case.json("desktop-error.json", desktop_error)
                response = {"ok": False, "error": {"code": "PREVIEW_VERIFY_FAILED"}}
            case.finish(response)
        except (OSError, ValueError, TypeError, KeyError):
            continue


current_case: ContextVar[Case | None] = ContextVar("full_diagnostic_case", default=None)


@contextlib.contextmanager
def capture_engine_stderr(case: Case | None):
    """Route engine stderr directly to its current request until dispatch ends."""
    if case is None:
        yield
        return
    stream = case.raw_stream("engine-stderr.bin")
    if stream is None:
        yield
        return
    with stream:
        previous = None
        try:
            sys.stderr.flush()
            previous = os.dup(2)
            os.dup2(stream.fileno(), 2)
        except (OSError, ValueError):
            case.missing.append("无法重定向文档引擎标准错误")
        try:
            yield
        finally:
            if previous is not None:
                try:
                    try:
                        sys.stderr.flush()
                    finally:
                        os.dup2(previous, 2)
                except (OSError, ValueError):
                    case.missing.append("无法恢复文档引擎标准错误")
                finally:
                    os.close(previous)


def record_exception(exc: BaseException) -> None:
    case = current_case.get()
    if case is not None:
        case.failed = True
        case.counter += 1
        case.write(f"exceptions/{case.counter:03d}.txt", "".join(traceback.format_exception(exc)).encode("utf-8", "backslashreplace"))


def record_input(name: str, value: Any) -> None:
    case = current_case.get()
    if case is not None:
        case.json(name, value)


@contextlib.contextmanager
def capture_workspace(name: str, root: Path):
    try:
        yield
    except Exception:
        case = current_case.get()
        if case is not None:
            case.tree(name, root)
        raise


def record_machine(case: Case) -> None:
    case.json("capture-start.json", {"reportId": case.case_id, "operation": case.method, "createdAt": case.started_at})
    sidecar_hash = _frozen_digest()
    if getattr(sys, "frozen", False) and sidecar_hash is None:
        case.missing.append("文档引擎可执行文件校验值")
    case.json("runtime.json", {
        "system": platform.uname()._asdict(), "python": sys.version,
        "executable": sys.executable, "frozen": getattr(sys, "frozen", False),
        "cwd": os.getcwd(), "sidecar_sha256": sidecar_hash, "backend_version": BACKEND_VERSION,
        "application_version": os.environ.get("SZTU_DOCS_APP_VERSION"),
        "environment": {key: os.environ[key] for key in ("PATH", "HOME", "USERPROFILE", "TEMP", "TMP", "LANG", "LC_ALL", "SZTU_FONT_DIR", "SZTU_DOCS_DATA_DIR") if key in os.environ},
    })


@functools.cache
def _frozen_digest() -> str | None:
    if not getattr(sys, "frozen", False):
        return None
    try:
        with open(sys.executable, "rb") as executable:
            return hashlib.file_digest(executable, "sha256").hexdigest()
    except OSError:
        return None
