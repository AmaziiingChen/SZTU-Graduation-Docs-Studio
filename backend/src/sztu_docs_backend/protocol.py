"""Request validation, stateful dispatch, and stable response envelopes."""

from __future__ import annotations

import logging
import os
import platform
import re
import time
import uuid
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from .environment import check_environment
from .diagnostic_steps import step
from .exporter import (
    build_export_document,
    capture_export_source,
    ExportError,
    content_check,
    delete_export_history_record,
    failed_content_check,
    generate_preview,
    list_export_history,
    preflight_export,
    record_qa,
    resolve_engine,
    resolve_artifact,
    run_export,
)
from .errors import (
    INVALID_PARAMS,
    INVALID_REQUEST,
    METHOD_NOT_FOUND,
    WORKSPACE_ALREADY_OPEN,
    WORKSPACE_NOT_OPEN,
    ProtocolError,
)
from .storage import StorageError, ValidationError, Workspace
from .full_diagnostics import current_case, finalize_desktop_case, record_exception, record_input, recover_interrupted_case
from .template_engine import TemplateEngineError, install_engine, sha256_file
from .version import BACKEND_VERSION, PROTOCOL_VERSION

LOGGER = logging.getLogger(__name__)
Identifier = str
Method = Callable[[dict[str, Any]], dict[str, Any]]
INTERNAL_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")

STORAGE_MESSAGES = {
    "NOT_FOUND": "未找到指定的本地记录。",
    "REVISION_CONFLICT": "草稿已发生变化，请重新加载后再保存。",
    "VALIDATION": "输入的数据未通过校验。",
    "MIGRATION_FAILED": "本地数据升级失败，原数据已保留。",
    "STORAGE_ERROR": "本地数据操作失败。",
}


def _trusted_trace_module(frame: Any) -> str | None:
    # Frozen code objects use relative paths; module identity survives packaging.
    module = frame.f_globals.get("__name__")
    if not isinstance(module, str) or not module.startswith("sztu_docs_backend."):
        return None
    name = module.rsplit(".", 1)[-1] + ".py"
    allowed = {"protocol.py", "exporter.py", "docx_inspector.py", "template_engine.py", "storage.py", "validation.py", "environment.py", "database.py", "workspace.py", "profiles.py", "profile_drafts.py", "documents.py"}
    return name if name in allowed else None


def _diagnostic_details(exc: Exception, details: dict[str, Any] | None = None) -> dict[str, Any]:
    result = dict(details or {})
    frames: list[dict[str, Any]] = []
    stage = "request"
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        trace = current.__traceback__
        while trace is not None:
            source = _trusted_trace_module(trace.tb_frame)
            if source is not None:
                frames.append({"module": source, "line": trace.tb_lineno})
                if source == "docx_inspector.py":
                    stage = "docx_inspection"
                elif source in {"storage.py", "database.py", "workspace.py", "profiles.py", "profile_drafts.py", "documents.py"}:
                    stage = "storage"
                elif source == "template_engine.py":
                    stage = "template"
                elif source == "exporter.py":
                    stage = {
                        "content_check": "content_validation", "validate_document": "content_validation",
                        "_run": "external_render", "_check_pdf": "pdf_validation",
                        "_run_cjk_gate": "glyph_validation", "generate_preview": "preview", "run_export": "export",
                    }.get(trace.tb_frame.f_code.co_name, stage)
            trace = trace.tb_next
        current = current.__cause__
    diagnostic: dict[str, Any] = {"trace": frames[-8:], "stage": stage}
    for frame_exc in [exc, exc.__cause__]:
        trace = frame_exc.__traceback__ if frame_exc else None
        while trace is not None:
            if _trusted_trace_module(trace.tb_frame) == "exporter.py":
                descriptor = trace.tb_frame.f_locals.get("descriptor")
                version = getattr(descriptor, "version", None)
                if isinstance(version, str) and re.fullmatch(r"\d{1,4}\.\d{1,4}(?:\.\d{1,4})?(?:\+(?:workspace\.)?[0-9a-f]{7,64})?", version):
                    diagnostic["template_version"] = version
            trace = trace.tb_next
    result["diagnostic"] = diagnostic
    return result


def canonical_request_id(value: Any) -> str | None:
    """Return a canonical UUID request id accepted by the IPC contract."""

    if not isinstance(value, str) or len(value) != 36:
        return None
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError):
        return None
    if str(parsed) != value.lower():
        return None
    if parsed.version not in range(1, 9) or parsed.variant != uuid.RFC_4122:
        return None
    return str(parsed)


def _request_id(value: Any) -> Identifier | None:
    return value if canonical_request_id(value) is not None else None


def _no_params(params: dict[str, Any]) -> dict[str, Any]:
    if params:
        raise ProtocolError(
            INVALID_PARAMS,
            "This method does not accept parameters.",
            {"unexpected": sorted(params)},
        )
    return params


def _shape_params(
    params: dict[str, Any],
    *,
    required: set[str] | None = None,
    optional: set[str] | None = None,
) -> None:
    required = required or set()
    optional = optional or set()
    missing = sorted(required - set(params))
    unexpected = sorted(set(params) - required - optional)
    if missing or unexpected:
        details: dict[str, Any] = {}
        if missing:
            details["missing"] = missing
        if unexpected:
            details["unexpected"] = unexpected
        raise ProtocolError(INVALID_PARAMS, "Params do not match this method.", details)


def _object_param(params: dict[str, Any], name: str) -> dict[str, Any]:
    value = params.get(name)
    if not isinstance(value, dict):
        raise ProtocolError(
            INVALID_PARAMS,
            "A required parameter must be a JSON object.",
            {"field": name},
        )
    return value


def _string_param(params: dict[str, Any], name: str) -> str:
    value = params.get(name)
    if not isinstance(value, str) or not value:
        raise ProtocolError(
            INVALID_PARAMS,
            "A required parameter must be a non-empty string.",
            {"field": name},
        )
    return value


def _integer_param(params: dict[str, Any], name: str) -> int:
    value = params.get(name)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ProtocolError(
            INVALID_PARAMS,
            "A required parameter must be an integer.",
            {"field": name},
        )
    return value


def _ping(params: dict[str, Any]) -> dict[str, Any]:
    _no_params(params)
    return {"pong": True}


def _version(params: dict[str, Any]) -> dict[str, Any]:
    _no_params(params)
    return {
        "backend": BACKEND_VERSION,
        "protocol": PROTOCOL_VERSION,
        "python": platform.python_version(),
    }


def _environment(params: dict[str, Any]) -> dict[str, Any]:
    _no_params(params)
    with step("environment_probe"):
        return check_environment()


SYSTEM_METHODS: dict[str, Method] = {
    "system.ping": _ping,
    "system.version": _version,
    "environment.check": _environment,
}


def _validate_request(payload: Any) -> tuple[Identifier, str, dict[str, Any]]:
    if not isinstance(payload, dict):
        raise ProtocolError(INVALID_REQUEST, "Request must be a JSON object.")

    request_id = _request_id(payload.get("id"))
    if request_id is None:
        raise ProtocolError(INVALID_REQUEST, "Request id must be a UUID string.")
    if payload.get("protocol") != PROTOCOL_VERSION:
        raise ProtocolError(
            INVALID_REQUEST,
            f"Protocol must be {PROTOCOL_VERSION}.",
            {"supported_protocol": PROTOCOL_VERSION},
        )
    method = payload.get("method")
    if not isinstance(method, str) or not method or len(method) > 128:
        raise ProtocolError(INVALID_REQUEST, "Method must be a non-empty string.")
    params = payload.get("params", {})
    if not isinstance(params, dict):
        raise ProtocolError(INVALID_PARAMS, "Params must be a JSON object.")

    allowed = {"protocol", "id", "method", "params"}
    unexpected = sorted(set(payload) - allowed)
    if unexpected:
        raise ProtocolError(
            INVALID_REQUEST,
            "Request contains unsupported fields.",
            {"unexpected": unexpected},
        )
    return request_id, method, params


def success_response(request_id: Identifier, result: Any) -> dict[str, Any]:
    return {
        "protocol": PROTOCOL_VERSION,
        "id": request_id,
        "ok": True,
        "result": result,
    }


def error_response(
    request_id: Identifier | None,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if details:
        error["details"] = details
    return {
        "protocol": PROTOCOL_VERSION,
        "id": request_id,
        "ok": False,
        "error": error,
    }


def _safe_storage_details(details: Mapping[str, Any]) -> dict[str, Any]:
    safe: dict[str, Any] = {}
    text_enums = {
        "resource": {"student_profile", "document", "previous_revision", "setting"},
        "field": {
            "id",
            "data_dir",
            "profile",
            "full_name",
            "student_number",
            "college",
            "major",
            "class_name",
            "advisor_name",
            "advisor_title",
            "graduation_cohort",
            "thesis_title",
            "thesis_title_en",
            "document",
            "document_id",
            "source_document_id",
            "title",
            "profile_id",
            "deleted",
            "cursor",
            "limit",
            "content",
            "expected_revision",
            "reason",
            "key",
            "value",
        },
        "reason": {
            "required",
            "too_long",
            "must_be_text",
            "must_be_integer",
            "must_be_non_negative",
            "must_be_object",
            "must_be_json_serializable",
            "must_be_unique",
            "must_be_absolute",
            "unsupported",
            "constraint_failed",
            "not_temporary",
            "does_not_belong_to_profile",
            "already_assigned",
            "document_type_mismatch",
            "temporary_document",
            "must_be_internal_id",
            "must_be_between_1_and_500",
            "must_be_between_1_and_100",
            "must_be_boolean",
            "invalid_cursor",
        },
    }
    for key, allowed in text_enums.items():
        value = details.get(key)
        if isinstance(value, str) and value in allowed:
            safe[key] = value
    resource_id = details.get("resource_id")
    if isinstance(resource_id, str) and INTERNAL_ID_PATTERN.fullmatch(resource_id):
        safe["resource_id"] = resource_id
    for key in (
        "expected_revision",
        "actual_revision",
        "migration_version",
        "records_deleted",
    ):
        value = details.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            safe[key] = value
    return safe


class ProtocolSession:
    """Own one workspace lifecycle for one sidecar process."""

    def __init__(self) -> None:
        self.workspace: Workspace | None = None
        self.mode: str | None = None
        self.all_documents = False
        self.preflight_tokens: dict[str, dict[str, Any]] = {}
        self.render_only = os.environ.get("SZTU_DOCS_SIDECAR_ROLE") == "render"
        # The Electron control process owns one startup recovery. A render
        # connection, or a replacement control process, must not mark work in
        # the other live process as interrupted.
        self.recover_interrupted = (
            not self.render_only
            and os.environ.get("SZTU_DOCS_RECOVER_INTERRUPTED", "1") == "1"
        )

    def dispatch(self, payload: Any) -> dict[str, Any]:
        request_id = _request_id(payload.get("id")) if isinstance(payload, dict) else None
        try:
            request_id, method, params = _validate_request(payload)
            handler = SYSTEM_METHODS.get(method)
            if handler is not None:
                result = handler(params)
            elif method == "diagnostic.prepare":
                result = self._prepare_diagnostic(params)
            else:
                if method in {"diagnostic.recover", "diagnostic.finishPreview"}:
                    _shape_params(params, required={"case_id"}, optional={"error"} if method == "diagnostic.finishPreview" else None)
                    case_id = _string_param(params, "case_id")
                    if canonical_request_id(case_id) != case_id:
                        raise ProtocolError(INVALID_PARAMS, "故障包编号无效。")
                    if method == "diagnostic.finishPreview":
                        error = params.get("error")
                        if error is not None and not isinstance(error, dict):
                            raise ProtocolError(INVALID_PARAMS, "故障详情无效。")
                        finalize_desktop_case(case_id, error=error)
                    else:
                        recover_interrupted_case(case_id)
                    return success_response(request_id, {"recovered": True})
                stage = {
                    "workspace.open": "workspace_open", "workspace.saveProfileDraft": "profile_save",
                    "workspace.saveProfile": "profile_save", "workspace.createProfile": "profile_save",
                    "workspace.selectProfile": "profile_select", "workspace.saveDraft": "draft_save",
                    "workspace.deleteProfile": "profile_save", "workspace.restoreProfile": "profile_save",
                    "workspace.createDocument": "document_create", "workspace.selectDocument": "document_select",
                    "workspace.listDocuments": "document_list", "template.install": "template",
                }.get(method)
                if stage:
                    with step(stage):
                        result = self._dispatch_workspace(method, params)
                else:
                    result = self._dispatch_workspace(method, params)
            return success_response(request_id, result)
        except ProtocolError as exc:
            record_exception(exc)
            return error_response(request_id, exc.code, exc.message, _diagnostic_details(exc, exc.details))
        except StorageError as exc:
            record_exception(exc)
            return error_response(
                request_id,
                exc.code,
                STORAGE_MESSAGES.get(exc.code, STORAGE_MESSAGES["STORAGE_ERROR"]),
                _diagnostic_details(exc, _safe_storage_details(exc.details)),
            )
        except ExportError as exc:
            record_exception(exc)
            return error_response(request_id, exc.code, exc.message, _diagnostic_details(exc, exc.details))
        except TemplateEngineError as exc:
            record_exception(exc)
            return error_response(request_id, exc.code, exc.message, _diagnostic_details(exc, exc.details))
        except Exception as exc:
            record_exception(exc)
            LOGGER.error("Unhandled protocol error (%s)", type(exc).__name__)
            return error_response(
                request_id, "INTERNAL_ERROR", "An internal error occurred.", _diagnostic_details(exc)
            )

    def _dispatch_workspace(
        self, method: str, params: dict[str, Any]
    ) -> dict[str, Any]:
        methods: dict[str, Method] = {
            "workspace.open": self._workspace_open,
            "workspace.load": self._workspace_load,
            "workspace.close": self._workspace_close,
            "workspace.saveProfileDraft": self._save_profile_draft,
            "workspace.saveProfile": self._save_profile,
            "workspace.createProfile": self._create_profile,
            "workspace.selectProfile": self._select_profile,
            "workspace.deleteProfile": self._delete_profile,
            "workspace.restoreProfile": self._restore_profile,
            "workspace.createDocument": self._create_document,
            "workspace.listDocuments": self._list_documents,
            "workspace.selectDocument": self._select_document,
            "workspace.renameDocument": self._rename_document,
            "workspace.deleteDocument": self._delete_document,
            "workspace.restoreDocument": self._restore_document,
            "workspace.purgeDocument": self._purge_document,
            "workspace.installReferenceSample": self._install_reference_sample,
            "workspace.removeReferenceSample": self._remove_reference_sample,
            "workspace.saveDraft": self._save_draft,
            "workspace.closeTemporary": self._close_temporary,
            "document.check": self._check_document,
            "preview.generate": self._generate_preview,
            "export.preflight": self._preflight_export,
            "export.run": self._run_export,
            "export.history": self._export_history,
            "export.deleteHistory": self._delete_export_history,
            "export.resolveArtifact": self._resolve_artifact,
            "template.install": self._install_template,
            "qa.record": self._record_qa,
        }
        handler = methods.get(method)
        if handler is None:
            raise ProtocolError(
                METHOD_NOT_FOUND, "The requested method is not available."
            )
        return handler(params)

    def _require_workspace(self) -> Workspace:
        if self.workspace is None:
            raise ProtocolError(
                WORKSPACE_NOT_OPEN,
                "Open a persistent or temporary workspace before this method.",
            )
        return self.workspace

    @staticmethod
    def _bind_unassigned_documents(
        workspace: Workspace, profile_id: str
    ) -> int:
        """Attach pre-profile drafts to the shared student profile.

        The workbench exposes one shared profile. Documents may be created before
        that profile is first saved, so repair every still-unassigned document as
        soon as a profile becomes active. Existing one-way assignments are never
        changed.
        """

        return workspace.bind_unassigned_profile(profile_id)

    def _workspace_open(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(params, required={"mode"}, optional={"initialize_reference", "all_documents"})
        initialize_reference = params.get("initialize_reference", False)
        if not isinstance(initialize_reference, bool):
            raise ProtocolError(
                INVALID_PARAMS,
                "Reference initialization must be boolean.",
                {"field": "initialize_reference"},
            )
        mode = params.get("mode")
        if mode not in {"persistent", "temporary"}:
            raise ProtocolError(
                INVALID_PARAMS,
                "Workspace mode must be persistent or temporary.",
                {"field": "mode"},
            )
        if self.render_only:
            if mode != "persistent":
                raise ProtocolError(
                    INVALID_PARAMS,
                    "The render process requires a persistent workspace.",
                    {"field": "mode"},
                )
            if self.workspace is None:
                self.workspace = Workspace.open_persistent(recover_interrupted=False)
                self.mode = "persistent"
            # Rendering never changes the active document or binds drafts. In
            # particular, do not call _selection while the control process is
            # saving or changing its own selection.
            return {"mode": "persistent", "render_ready": True}
        all_documents = params.get("all_documents", self.all_documents)
        if not isinstance(all_documents, bool):
            raise ProtocolError(INVALID_PARAMS, "文档列表范围无效。")
        self.all_documents = all_documents
        if self.workspace is not None and self.mode == mode:
            return self._selection()
        if self.workspace is not None and self.mode == "persistent" and mode == "temporary":
            self.workspace.close()
            self.workspace = None
            self.mode = None
        elif self.workspace is not None:
            raise ProtocolError(
                WORKSPACE_ALREADY_OPEN,
                "Close the temporary workspace before returning to persistent data.",
            )
        self.workspace = (
            Workspace.open_persistent(recover_interrupted=self.recover_interrupted)
            if mode == "persistent"
            else Workspace.create_temporary()
        )
        self.mode = mode
        if mode == "persistent" and initialize_reference:
            from .reference_sample import initialize_reference_sample
            initialize_reference_sample(self.workspace)
        return self._selection()

    def _workspace_load(self, params: dict[str, Any]) -> dict[str, Any]:
        _no_params(params)
        self._require_workspace()
        return self._selection()

    def _workspace_close(self, params: dict[str, Any]) -> dict[str, Any]:
        _no_params(params)
        workspace = self._require_workspace()
        workspace.close()
        self.workspace = None
        previous_mode = self.mode
        self.mode = None
        return {"closed": True, "mode": previous_mode}

    def _save_profile(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(params, required={"profile"})
        workspace = self._require_workspace()
        payload = _object_param(params, "profile")
        active = workspace.load_active()
        current = active["profile"]
        expected = current["id"] if current else None
        if payload.get("id") != expected:
            raise ProtocolError("PROFILE_SELECTION_CHANGED", "当前学生档案已切换，请重新加载后保存。")
        first_profile = (
            current is None
            and not workspace.list_profiles(limit=1)
            and not workspace.profiles.list_summaries(deleted=True)
        )
        if current is None and not first_profile:
            raise ProtocolError("PROFILE_SELECTION_CHANGED", "请先选择要保存的学生档案。")
        profile = workspace.save_profile(payload)
        if first_profile:
            # Keep the original single-student first-use flow. Switching to an
            # existing or additional student never claims legacy drafts.
            self._bind_unassigned_documents(workspace, profile["id"])
        active_document = active["document"]
        document_id = None
        if isinstance(active_document, dict) and (
            active_document["profile_id"] == profile["id"]
            or (first_profile and active_document["profile_id"] is None)
        ):
            document_id = active_document["id"]
        workspace.save_active(profile_id=profile["id"], document_id=document_id)
        return profile

    def _create_profile(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(params, required={"profile"})
        workspace = self._require_workspace()
        if self.mode != "persistent":
            raise ProtocolError(INVALID_PARAMS, "临时工作区不支持添加学生档案。")
        payload = _object_param(params, "profile")
        if len(workspace.list_profiles(limit=500)) == 500:
            raise ProtocolError("PROFILE_LIMIT_REACHED", "本机最多保存 500 份学生档案。")
        if "id" in payload:
            raise ProtocolError(INVALID_PARAMS, "新增档案不能指定已有档案编号。")
        try:
            profile = workspace.save_profile(payload)
        except ValidationError as exc:
            if exc.details == {"field": "student_number", "reason": "must_be_unique"}:
                if workspace.profiles.has_deleted_student_number(payload["student_number"].strip()):
                    raise ProtocolError("PROFILE_IN_TRASH", "此学号的档案在「已删除档案」中，请恢复原档案。") from exc
                raise ProtocolError("PROFILE_NUMBER_IN_USE", "此学号已有学生档案。") from exc
            raise
        workspace.save_active(profile_id=profile["id"], document_id=None)
        return self._selection()

    def _select_profile(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(params, required={"profile_id"})
        workspace = self._require_workspace()
        profile_id = params["profile_id"]
        if profile_id is not None:
            profile_id = _string_param(params, "profile_id")
            workspace.get_profile(profile_id)
        workspace.save_active(profile_id=profile_id, document_id=None)
        return self._selection()

    def _delete_profile(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(params, required={"profile_id"})
        workspace = self._require_workspace()
        profile_id = _string_param(params, "profile_id")
        current = workspace.load_active(include_document=False)["profile"]
        if current is None or current["id"] != profile_id:
            raise ProtocolError("PROFILE_SELECTION_CHANGED", "当前学生档案已切换，请重新选择要删除的学生。")
        workspace.profiles.soft_delete(profile_id)
        return self._selection()

    def _restore_profile(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(params, required={"profile_id"})
        workspace = self._require_workspace()
        profile_id = _string_param(params, "profile_id")
        if len(workspace.list_profiles(limit=500)) == 500:
            raise ProtocolError("PROFILE_LIMIT_REACHED", "本机最多使用 500 份学生档案，请先删除一份再恢复。")
        workspace.profiles.restore(profile_id)
        workspace.save_active(profile_id=profile_id, document_id=None)
        return self._selection()

    def _save_profile_draft(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(params, required={"profile"}, optional={"profile_id"})
        workspace = self._require_workspace()
        active = workspace.load_active()["profile"]
        expected = active["id"] if active else None
        if "profile_id" in params and params["profile_id"] != expected:
            raise ProtocolError("PROFILE_SELECTION_CHANGED", "当前学生档案已切换，请重新加载后保存。")
        return workspace.save_profile_draft(_object_param(params, "profile"), profile_id=expected)

    @staticmethod
    def _require_visible_document(workspace: Workspace, document_id: str, *, deleted: bool = False) -> dict[str, Any]:
        document = workspace.documents.get(document_id, include_deleted=deleted)
        if document["profile_id"] is not None:
            workspace.get_profile(document["profile_id"])
        return document

    def _require_active_document_scope(self, workspace: Workspace, document_id: str, *, deleted: bool = False) -> dict[str, Any]:
        document = workspace.documents.get(document_id, include_deleted=deleted)
        active = workspace.load_active(include_document=False)["profile"]
        if document["profile_id"] != (active["id"] if active else None):
            raise ProtocolError("DOCUMENT_PROFILE_MISMATCH", "此文档不属于当前学生档案。")
        return document

    def _create_document(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(params, required={"document"})
        workspace = self._require_workspace()
        payload = _object_param(params, "document")

        document_type = payload.get("document_type")
        if document_type not in {"proposal", "midterm", "task_book", "thesis", "advisor_review", "reviewer_review", "defense_record", "grade_assessment"}:
            raise ProtocolError(
                INVALID_PARAMS,
                "Document type is not supported.",
                {"field": "document.document_type"},
            )
        document = workspace.create_document(payload)
        workspace.save_active(
            profile_id=document["profile_id"], document_id=document["id"]
        )
        return document

    def _rename_document(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(params, required={"document_id", "title"})
        workspace = self._require_workspace()
        document_id = _string_param(params, "document_id")
        document_scope = self._require_visible_document if self.all_documents else self._require_active_document_scope
        document_scope(workspace, document_id)
        workspace.rename_document(
            document_id,
            _string_param(params, "title"),
        )
        return self._selection()

    def _list_documents(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(
            params,
            required={"profile_id", "deleted"},
            optional={"cursor", "limit"},
        )
        workspace = self._require_workspace()
        active = workspace.load_active()["profile"]
        profile_id = params["profile_id"]
        if profile_id is not None and (not isinstance(profile_id, str) or not profile_id or len(profile_id) > 128):
            raise ValidationError("profile_id", "must_be_text")
        if profile_id != (None if self.all_documents else (active["id"] if active else None)):
            raise ProtocolError("PROFILE_SELECTION_CHANGED", "当前学生档案已切换，请重新读取文档列表。")
        return workspace.list_document_page(
            profile_id=profile_id,
            deleted=params["deleted"],
            unassigned_only=profile_id is None and not self.all_documents,
            active_owners_only=self.all_documents,
            cursor=params.get("cursor"),
            limit=params.get("limit", 100),
        )

    def _delete_document(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(params, required={"document_id"})
        workspace = self._require_workspace()
        document_id = _string_param(params, "document_id")
        document_scope = self._require_visible_document if self.all_documents else self._require_active_document_scope
        document_scope(workspace, document_id, deleted=False)
        workspace.delete_document(document_id)
        return self._selection()

    def _restore_document(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(params, required={"document_id"})
        workspace = self._require_workspace()
        document_id = _string_param(params, "document_id")
        document_scope = self._require_visible_document if self.all_documents else self._require_active_document_scope
        document_scope(workspace, document_id, deleted=True)
        document = workspace.restore_document(document_id)
        workspace.save_active(
            profile_id=document["profile_id"], document_id=document["id"]
        )
        return self._selection()

    def _purge_document(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(params, required={"document_id"})
        workspace = self._require_workspace()
        document_id = _string_param(params, "document_id")
        document_scope = self._require_visible_document if self.all_documents else self._require_active_document_scope
        document_scope(workspace, document_id, deleted=True)
        workspace.purge_document(document_id)
        return self._selection()

    def _install_reference_sample(self, params: dict[str, Any]) -> dict[str, Any]:
        _no_params(params)
        workspace = self._require_workspace()
        from .reference_sample import install_reference_sample
        result = install_reference_sample(workspace)
        return {**self._selection(), "sample": result}

    def _remove_reference_sample(self, params: dict[str, Any]) -> dict[str, Any]:
        _no_params(params)
        workspace = self._require_workspace()
        from .reference_sample import remove_reference_sample
        result = remove_reference_sample(workspace)
        return {**self._selection(), "sample": result}

    def _select_document(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(params, required={"document_id"})
        workspace = self._require_workspace()
        document_id = _string_param(params, "document_id")
        document = (
            self._require_visible_document(workspace, document_id)
            if self.all_documents else self._require_active_document_scope(workspace, document_id)
        )
        workspace.save_active(profile_id=document["profile_id"], document_id=document["id"])
        return self._selection()

    def _save_draft(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(
            params,
            required={"document_id", "content", "expected_revision"},
            optional={"reason"},
        )
        workspace = self._require_workspace()
        document_id = _string_param(params, "document_id")
        self._require_active_document_scope(workspace, document_id)
        content = _object_param(params, "content")
        expected_revision = _integer_param(params, "expected_revision")
        reason = params.get("reason", "auto")
        if not isinstance(reason, str):
            raise ProtocolError(
                INVALID_PARAMS,
                "Save reason must be a string.",
                {"field": "reason"},
            )
        workspace.save_draft(
            document_id,
            content,
            expected_revision,
            reason=reason,
        )
        document = workspace.get_document(document_id)
        workspace.save_active(
            profile_id=document["profile_id"], document_id=document["id"]
        )
        return document

    def _close_temporary(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(params, required={"document_id"})
        workspace = self._require_workspace()
        document_id = _string_param(params, "document_id")
        if self.mode != "temporary":
            raise ProtocolError(
                INVALID_PARAMS,
                "The current workspace is not temporary.",
                {"field": "document_id"},
            )
        workspace.get_document(document_id)
        workspace.close()
        self.workspace = None
        self.mode = None
        self.workspace = Workspace.open_persistent(
            recover_interrupted=self.recover_interrupted
        )
        self.mode = "persistent"
        return self._selection()

    def _check_document(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(params, required={"document_id"})
        workspace = self._require_workspace()
        document = self._require_active_document_scope(workspace, _string_param(params, "document_id"))
        document, profile = capture_export_source(workspace, document["id"])
        record_input("document-check-input.json", {"document": document, "profile": profile})
        try:
            proposal: Any = build_export_document(workspace, document, profile_snapshot=profile)
        except ExportError as exc:
            record_exception(exc)
            return {
                "checks": [
                    failed_content_check(exc, str(document["document_type"]))
                ]
            }
        return {"checks": [content_check(proposal, document["document_type"])]}

    def _prepare_diagnostic(self, params: dict[str, Any]) -> dict[str, Any]:
        _no_params(params)
        case = current_case.get()
        if case is None:
            raise ProtocolError(INVALID_PARAMS, "当前无法创建完整诊断包。")
        try:
            record_input("environment.json", _environment({}))
        except Exception as exc:
            record_exception(exc)
            case.missing.append("环境检查未完成")
        if self.workspace is None:
            case.missing.append("工作区尚未打开")
            return {}
        active = self.workspace.load_active()
        document = active["document"]
        profile = active["profile"]
        if document is None or document["profile_id"] != (profile["id"] if profile else None):
            record_input("profile.json", profile)
            case.missing.append("没有打开可采集的文档")
            return {}
        document, profile = capture_export_source(self.workspace, document["id"])
        document_type = document["document_type"]
        try:
            resolve_engine(document_type)
        except ExportError as exc:
            record_exception(exc)
            case.missing.append("当前文档的模板不可用")
        try:
            proposal = build_export_document(self.workspace, document, profile_snapshot=profile)
            record_input("renderer-input.json", proposal)
            record_input("content-check.json", content_check(proposal, document_type))
        except ExportError as exc:
            record_exception(exc)
            case.missing.append("当前文档未能生成渲染输入")
        return {}

    def _generate_preview(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(
            params,
            required={
                "document_id",
                "request_id",
                "cancellation_file",
                "app_version",
            },
        )
        workspace = self._require_workspace()
        request_id = _string_param(params, "request_id")
        if canonical_request_id(request_id) is None:
            raise ProtocolError(
                INVALID_PARAMS,
                "Preview request id must be a UUID.",
                {"field": "request_id"},
            )
        app_version = _string_param(params, "app_version")
        if len(app_version) > 64 or re.fullmatch(
            r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?", app_version
        ) is None:
            raise ProtocolError(
                INVALID_PARAMS,
                "Application version is invalid.",
                {"field": "app_version"},
            )
        document_id = _string_param(params, "document_id")
        self._require_active_document_scope(workspace, document_id)
        return generate_preview(
            workspace,
            document_id=document_id,
            request_id=request_id,
            cancellation_file=_string_param(params, "cancellation_file"),
            app_version=app_version,
        )

    def _run_export(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(
            params,
            required={
                "request_id",
                "document_id",
                "preview_id",
                "output_directory",
                "formats",
                "preflight_token",
                "overwrite_confirmed",
                "cancellation_file",
                "app_version",
            },
        )
        workspace = self._require_workspace()
        formats = params.get("formats")
        if not isinstance(formats, list) or not all(
            isinstance(item, str) for item in formats
        ):
            raise ProtocolError(
                INVALID_PARAMS,
                "Export formats must be a string array.",
                {"field": "formats"},
            )
        document_id = _string_param(params, "document_id")
        preview_id = _string_param(params, "preview_id")
        if canonical_request_id(preview_id) is None:
            raise ProtocolError(
                INVALID_PARAMS,
                "Preview id must be a UUID.",
                {"field": "preview_id"},
            )
        output_directory = _string_param(params, "output_directory")
        request_id = _string_param(params, "request_id")
        if canonical_request_id(request_id) is None:
            raise ProtocolError(
                INVALID_PARAMS, "Export request id must be a UUID.", {"field": "request_id"}
            )
        overwrite_confirmed = params.get("overwrite_confirmed")
        if not isinstance(overwrite_confirmed, bool):
            raise ProtocolError(
                INVALID_PARAMS, "Overwrite confirmation must be boolean.", {"field": "overwrite_confirmed"}
            )
        app_version = _string_param(params, "app_version")
        if len(app_version) > 64 or re.fullmatch(
            r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?", app_version
        ) is None:
            raise ProtocolError(
                INVALID_PARAMS, "Application version is invalid.", {"field": "app_version"}
            )
        cancellation_file = _string_param(params, "cancellation_file")
        token = _string_param(params, "preflight_token")
        preflight = self.preflight_tokens.pop(token, None)
        if preflight is None or preflight["expires_monotonic"] < time.monotonic():
            raise ExportError("PREFLIGHT_EXPIRED", "导出预检已失效，请重新检查。")
        if (
            preflight["document_id"] != document_id
            or preflight["preview_id"] != preview_id
            or preflight["output_directory"] != str(Path(output_directory).resolve())
            or preflight["formats"] != frozenset(formats)
        ):
            raise ExportError("PREFLIGHT_MISMATCH", "导出参数与最近一次预检不一致。")
        document = self._require_active_document_scope(workspace, document_id)
        if document["current_revision"] != preflight["document_revision"]:
            raise ExportError("PREFLIGHT_STALE", "草稿在预检后发生变化，请重新检查。")
        return run_export(
            workspace,
            document_id=document_id,
            output_directory=output_directory,
            formats=formats,
            overwrite_confirmed=overwrite_confirmed,
            request_id=request_id,
            cancellation_file=cancellation_file,
            app_version=app_version,
            preflight_token=token,
            preview_id=preview_id,
        )

    def _preflight_export(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(
            params,
            required={"document_id", "preview_id", "output_directory", "formats"},
        )
        workspace = self._require_workspace()
        formats = params.get("formats")
        if not isinstance(formats, list) or not all(
            isinstance(item, str) for item in formats
        ):
            raise ProtocolError(
                INVALID_PARAMS,
                "Export formats must be a string array.",
                {"field": "formats"},
            )
        output_directory = _string_param(params, "output_directory")
        document_id = _string_param(params, "document_id")
        preview_id = _string_param(params, "preview_id")
        if canonical_request_id(preview_id) is None:
            raise ProtocolError(
                INVALID_PARAMS,
                "Preview id must be a UUID.",
                {"field": "preview_id"},
            )
        self._require_active_document_scope(workspace, document_id)
        source_snapshot = capture_export_source(workspace, document_id)
        document = source_snapshot[0]
        result = preflight_export(
            workspace,
            document_id=document_id,
            output_directory=output_directory,
            formats=formats,
            preview_id=preview_id,
            source_snapshot=source_snapshot,
        )
        now = time.monotonic()
        self.preflight_tokens = {
            key: value
            for key, value in self.preflight_tokens.items()
            if value["expires_monotonic"] >= now
        }
        token = result.get("preflight_token")
        if not isinstance(token, str) or re.fullmatch(r"[a-f0-9]{64}", token) is None:
            raise ExportError("PREFLIGHT_INVALID", "导出预检结果无效，请重试。")
        raw_targets: Any = []
        for check in result.get("checks", []):
            if isinstance(check, dict) and check.get("check_id") == "output-targets":
                details = check.get("details")
                if isinstance(details, dict):
                    raw_targets = details.get("targets", [])
                break
        if not isinstance(raw_targets, list):
            raise ExportError("PREFLIGHT_INVALID", "导出目标检查结果无效，请重试。")
        output_root = Path(output_directory).resolve()
        targets: list[dict[str, Any]] = []
        for target in raw_targets:
            if (
                not isinstance(target, dict)
                or target.get("format") not in result.get("formats", [])
                or not isinstance(target.get("filename"), str)
                or not isinstance(target.get("exists"), bool)
            ):
                raise ExportError("PREFLIGHT_INVALID", "导出目标检查结果无效，请重试。")
            target_path = (output_root / target["filename"]).resolve(strict=False)
            if target_path.parent != output_root:
                raise ExportError("PREFLIGHT_INVALID", "导出目标路径无效，请重试。")
            targets.append({**target, "path": str(target_path)})
        self.preflight_tokens[token] = {
            "document_id": result["document_id"],
            "preview_id": preview_id,
            "document_revision": document["current_revision"],
            "output_directory": str(Path(output_directory).resolve()),
            "formats": frozenset(result["formats"]),
            "expires_monotonic": now + 300,
        }
        return {
            **result,
            "document_revision": document["current_revision"],
            "targets": targets,
            "overwrite_required": any(target["exists"] for target in targets),
        }

    def _export_history(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(params, required={"document_id"}, optional={"limit"})
        workspace = self._require_workspace()
        limit = params.get("limit", 50)
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 100:
            raise ProtocolError(
                INVALID_PARAMS, "History limit must be between 1 and 100.", {"field": "limit"}
            )
        document_id = _string_param(params, "document_id")
        self._require_active_document_scope(workspace, document_id)
        result = list_export_history(
            workspace,
            document_id=document_id,
            limit=limit,
        )
        safe_history: list[dict[str, Any]] = []
        for job in result.get("history", []):
            if not isinstance(job, dict):
                raise ExportError("EXPORT_HISTORY_INVALID", "导出历史记录无效。")
            template = job.get("template")
            if not isinstance(template, dict) or not all(
                isinstance(template.get(key), str)
                for key in ("template_id", "version", "pack_sha256")
            ):
                template = None
            safe_artifacts: list[dict[str, Any]] = []
            artifacts = job.get("artifacts")
            if not isinstance(artifacts, list):
                raise ExportError("EXPORT_HISTORY_INVALID", "导出历史产物记录无效。")
            for artifact in artifacts:
                if not isinstance(artifact, dict):
                    raise ExportError("EXPORT_HISTORY_INVALID", "导出历史产物记录无效。")
                raw_path = artifact.pop("path", None)
                display_name = (
                    Path(raw_path).name
                    if isinstance(raw_path, str) and raw_path
                    else f"artifact.{artifact['format']}"
                )
                safe_artifacts.append(
                    {
                        key: artifact.get(key)
                        for key in (
                            "artifact_id",
                            "format",
                            "sha256",
                            "size_bytes",
                            "file_state",
                            "replaced_existing",
                            "checks",
                        )
                    }
                    | {"display_name": display_name}
                )
            safe_history.append(
                {
                    key: job.get(key)
                    for key in (
                        "export_id",
                        "request_id",
                        "status",
                        "progress",
                        "error_code",
                        "requested_formats",
                        "input_sha256",
                        "snapshot_available",
                        "overwrite_confirmed",
                        "created_at",
                        "completed_at",
                    )
                }
                | {"template": template, "artifacts": safe_artifacts}
            )
        return {"schema_version": "1.0", "history": safe_history}

    def _delete_export_history(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(params, required={"document_id", "export_id"})
        workspace = self._require_workspace()
        document_id = _string_param(params, "document_id")
        self._require_active_document_scope(workspace, document_id)
        return delete_export_history_record(
            workspace,
            document_id=document_id,
            export_id=_string_param(params, "export_id"),
        )

    def _resolve_artifact(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(params, required={"artifact_id"})
        workspace = self._require_workspace()
        artifact_id = _string_param(params, "artifact_id")
        artifact = workspace.database.connection.execute("""
            SELECT a.format, j.document_id FROM export_artifacts a
            JOIN export_jobs j ON j.id = a.export_job_id WHERE a.id = ?
        """, (artifact_id,)).fetchone()
        if artifact is None or artifact["format"] not in {"docx", "pdf", "tex"}:
            raise ExportError("ARTIFACT_NOT_FOUND", "未找到可打开的导出文件。")
        self._require_active_document_scope(workspace, artifact["document_id"])
        result = resolve_artifact(workspace, artifact_id=artifact_id)
        return {
            **result,
            "format": artifact["format"],
            "sha256": sha256_file(Path(result["absolute_path"])),
            "verified": True,
        }

    def _install_template(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(params, required={"source_directory", "document_type"})
        document_type = _string_param(params, "document_type")
        if document_type not in {"proposal", "midterm", "task_book", "thesis", "advisor_review", "reviewer_review", "defense_record", "grade_assessment"}:
            raise ProtocolError(INVALID_PARAMS, "Document type is not supported.")
        return install_engine(
            self._require_workspace(),
            _string_param(params, "source_directory"),
            document_type,
        )

    def _record_qa(self, params: dict[str, Any]) -> dict[str, Any]:
        _shape_params(
            params,
            required={"gate", "status", "message"},
            optional={"export_id", "artifact_id", "editor"},
        )
        gate = _string_param(params, "gate")
        status = _string_param(params, "status")
        artifact_id = params.get("artifact_id")
        editor = params.get("editor")
        message = _string_param(params, "message")
        if gate not in {"full_page_layout", "target_editor"} or status not in {"pass", "fail"}:
            raise ProtocolError(
                INVALID_PARAMS,
                "QA gate or status is invalid.",
            )
        if artifact_id is not None and not isinstance(artifact_id, str):
            raise ProtocolError(INVALID_PARAMS, "Artifact id is invalid.", {"field": "artifact_id"})
        if gate == "target_editor":
            if artifact_id is None or editor not in {"word", "wps"}:
                raise ProtocolError(
                    INVALID_PARAMS,
                    "Target-editor QA requires one Word artifact and supported editor.",
                )
            row = self._require_workspace().database.connection.execute(
                "SELECT export_job_id FROM export_artifacts WHERE id = ?", (artifact_id,)
            ).fetchone()
            if row is None:
                raise ExportError("ARTIFACT_NOT_FOUND", "未找到对应的导出文件。")
            export_id = row["export_job_id"]
        else:
            if editor is not None:
                raise ProtocolError(
                    INVALID_PARAMS,
                    "Full-page layout QA does not accept an editor.",
                    {"field": "editor"},
                )
            export_id = _string_param(params, "export_id")
        if len(message) > 1000:
            raise ProtocolError(INVALID_PARAMS, "QA message is invalid.", {"field": "message"})
        return record_qa(
            self._require_workspace(),
            export_id=export_id,
            artifact_id=artifact_id,
            gate=gate,
            editor={"word": "Microsoft Word", "wps": "WPS Office"}.get(editor),
            status=status,
            notes=message,
        )

    def _selection(self) -> dict[str, Any]:
        workspace = self._require_workspace()
        active = workspace.load_active()
        profile = active.get("profile")
        document = active.get("document")
        profiles = workspace.profiles.list_summaries()
        deleted_profiles = workspace.profiles.list_summaries(deleted=True)
        # A deleted selection can be left behind by interruption. An explicit
        # null selection still belongs to the unassigned workspace.
        has_active = workspace.has_setting("workbench.active")
        previous = workspace.get_setting("workbench.active")["value"] if has_active else None
        deleted_selection = isinstance(previous, dict) and any(
            previous.get("profile_id") == row["id"] for row in deleted_profiles
        )
        if profile is None and profiles and (not has_active or deleted_selection):
            profile = workspace.get_profile(profiles[0]["id"])
        profile_id = profile["id"] if profile else None
        # The null selection is the explicit unassigned workspace, including
        # on restart; it must never fall back to another student's documents.
        if document is not None and document["profile_id"] != profile_id:
            document = None
        scoped_documents = workspace.list_document_page(profile_id=profile_id, unassigned_only=profile_id is None)
        if document is None and scoped_documents["documents"]:
            document = workspace.get_document(scoped_documents["documents"][0]["id"])
        if self.all_documents:
            documents_page = workspace.list_document_page(active_owners_only=True)
            deleted_documents_page = workspace.list_document_page(deleted=True, active_owners_only=True)
        else:
            documents_page = scoped_documents
            deleted_documents_page = workspace.list_document_page(
                profile_id=profile_id, deleted=True, unassigned_only=profile_id is None
            )
        if profile is not None or document is not None or deleted_selection:
            workspace.save_active(profile_id=profile_id, document_id=document["id"] if document else None)
        return {
            "mode": self.mode,
            "profile": profile,
            "profiles": profiles,
            "deleted_profiles": deleted_profiles,
            "profile_draft": (
                workspace.load_profile_draft(profile_id=profile_id)
                if profile_id is not None or not (profiles or deleted_profiles)
                else None
            ),
            "document": document,
            "documents": documents_page["documents"],
            "deleted_documents": deleted_documents_page["documents"],
            "documents_page": {
                key: documents_page[key] for key in ("profile_id", "next_cursor", "has_more")
            },
            "deleted_documents_page": {
                key: deleted_documents_page[key] for key in ("profile_id", "next_cursor", "has_more")
            },
        }

    def close(self) -> None:
        if self.workspace is not None:
            self.workspace.close()
        self.workspace = None
        self.mode = None
        self.preflight_tokens.clear()


def dispatch(payload: Any, session: ProtocolSession | None = None) -> dict[str, Any]:
    """Dispatch one request; callers needing state must retain a session."""

    if session is not None:
        return session.dispatch(payload)
    one_shot = ProtocolSession()
    try:
        return one_shot.dispatch(payload)
    finally:
        one_shot.close()
