from __future__ import annotations

import json
import os
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from sztu_docs_backend.protocol import ProtocolSession, dispatch
from sztu_docs_backend.storage import Workspace
from sztu_docs_backend.template_engine import EngineDescriptor


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
PROPOSAL_FIXTURE = (
    REPOSITORY_ROOT
    / "template-packs"
    / "sztu-proposal-2026-dev"
    / "fixtures"
    / "normal.json"
)


def profile_payload(number: str = "PROTO-0001") -> dict[str, str]:
    return {
        "full_name": "协议合成学生",
        "student_number": number,
        "college": "协议示例学院",
        "major": "协议示例专业",
        "advisor_title": "教授",
        "graduation_cohort": "2027届",
    }


def document_payload(profile_id: str | None = None) -> dict[str, str | None]:
    return {
        "profile_id": profile_id,
        "document_type": "proposal",
        "template_version": "fixture-1",
        "schema_version": "fixture-1",
        "title": "协议合成开题报告",
    }


def profile_draft_payload(**updates: object) -> dict[str, object]:
    draft = {
        "full_name": "",
        "student_number": "",
        "college": "",
        "major": "",
        "class_name": "",
        "advisor_name": "",
        "advisor_title": "",
        "graduation_cohort": "",
        "thesis_title": None,
        "thesis_title_en": None,
    }
    draft.update(updates)
    return draft


def write_task_book_layout(engine_root: Path) -> None:
    layout_path = engine_root / "spec" / "layout.json"
    sizes_path = (
        engine_root.parent / "common" / "typography" / "chinese-sizes.json"
    )
    layout_path.parent.mkdir(parents=True, exist_ok=True)
    sizes_path.parent.mkdir(parents=True, exist_ok=True)
    layout_path.write_text(
        json.dumps(
            {
                "typography": {"cover_title_value": {"size": "三号"}},
                "cover": {
                    "title_underline_width_mm": 128.0,
                    "title_max_lines": 2,
                },
            }
        ),
        encoding="utf-8",
    )
    sizes_path.write_text(
        json.dumps({"sizes": {"三号": {"pt": 16.0}}}),
        encoding="utf-8",
    )


class ProtocolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temporary_directory.name) / "app-data"
        self.environment = patch.dict(
            os.environ, {"SZTU_DOCS_DATA_DIR": str(self.data_dir)}
        )
        self.environment.start()
        self.session = ProtocolSession()

    def tearDown(self) -> None:
        self.session.close()
        self.environment.stop()
        self.temporary_directory.cleanup()

    def request(
        self,
        method: str,
        params: object = None,
        *,
        session: ProtocolSession | None = None,
        request_id: object | None = None,
    ) -> dict[str, object]:
        payload: dict[str, object] = {
            "protocol": "1.0",
            "id": request_id or str(uuid.uuid4()),
            "method": method,
        }
        if params is not None:
            payload["params"] = params
        return dispatch(payload, session or self.session)

    def open(self, mode: str = "persistent") -> dict[str, object]:
        return self.request("workspace.open", {"mode": mode})

    def test_thesis_create_save_and_reopen_over_protocol(self) -> None:
        self.open()
        payload = {**document_payload(), "document_type": "thesis", "title": "协议合成毕业论文"}
        created = self.request("workspace.createDocument", {"document": payload})
        self.assertTrue(created["ok"], created)
        document_id = created["result"]["id"]
        content = {"metadata": {"title": "合成论文"}, "thesis": {
            "version": 1, "englishTitle": "", "abstractCn": [], "keywordsCn": "",
            "abstractEn": [], "keywordsEn": "", "referencesBibtex": "", "acknowledgements": [], "appendix": [],
            "chapters": [{"id": "stable-id", "level": 1, "title": "绪论", "body": ["协议正文"]}],
        }}
        saved = self.request("workspace.saveDraft", {"document_id": document_id, "content": content, "expected_revision": 0})
        self.assertTrue(saved["ok"], saved)
        self.session.close()
        self.session = ProtocolSession()
        reopened = self.open()["result"]["document"]
        self.assertEqual(reopened["document_type"], "thesis")
        self.assertEqual(reopened["content"], content)

    def test_ping(self) -> None:
        request_id = str(uuid.uuid4())
        self.assertEqual(
            self.request("system.ping", request_id=request_id),
            {
                "protocol": "1.0",
                "id": request_id,
                "ok": True,
                "result": {"pong": True},
            },
        )

    def test_version(self) -> None:
        response = self.request("system.version")
        self.assertTrue(response["ok"])
        result = response["result"]
        self.assertEqual(result["protocol"], "1.0")
        self.assertRegex(result["backend"], r"^\d+\.\d+\.\d+$")

    def test_unknown_method_has_stable_error(self) -> None:
        response = self.request("document.teleport")
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "METHOD_NOT_FOUND")

    def test_removed_draft_restore_method_is_not_available(self) -> None:
        response = self.request("workspace.restorePrevious")
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "METHOD_NOT_FOUND")

    def test_wrong_protocol_preserves_valid_uuid(self) -> None:
        request_id = str(uuid.uuid4())
        response = dispatch(
            {"protocol": "0.9", "id": request_id, "method": "system.ping"}
        )
        self.assertEqual(response["id"], request_id)
        self.assertEqual(response["error"]["code"], "INVALID_REQUEST")

    def test_only_rfc_uuid_strings_are_request_ids(self) -> None:
        for invalid in (True, 7, "test-request", "00000000-0000-0000-0000-000000000000"):
            with self.subTest(invalid=invalid):
                response = self.request("system.ping", request_id=invalid)
                self.assertIsNone(response["id"])
                self.assertEqual(response["error"]["code"], "INVALID_REQUEST")

    def test_unexpected_request_field_is_rejected(self) -> None:
        request_id = str(uuid.uuid4())
        response = dispatch(
            {
                "protocol": "1.0",
                "id": request_id,
                "method": "system.ping",
                "private": "must-not-pass-through",
            }
        )
        self.assertEqual(response["error"]["code"], "INVALID_REQUEST")
        self.assertEqual(response["error"]["details"]["unexpected"], ["private"])

    def test_params_must_be_an_object(self) -> None:
        response = self.request("system.ping", ["unexpected"])
        self.assertEqual(response["error"]["code"], "INVALID_PARAMS")

    def test_environment_check_is_dispatched(self) -> None:
        expected = {"ready": True, "platform": {}, "checks": []}
        with patch(
            "sztu_docs_backend.protocol.check_environment", return_value=expected
        ):
            response = self.request("environment.check")
        self.assertEqual(response["result"], expected)

    def test_document_check_uses_the_strict_proposal_contract(self) -> None:
        proposal = json.loads(PROPOSAL_FIXTURE.read_text(encoding="utf-8"))
        self.open()
        profile = self.request(
            "workspace.saveProfile",
            {
                "profile": {
                    "full_name": proposal["metadata"]["student_name"],
                    "student_number": proposal["metadata"]["student_id"],
                    "college": proposal["metadata"]["college"],
                    "major": proposal["metadata"]["major"],
                    "advisor_name": proposal["metadata"]["advisor"],
                }
            },
        )["result"]
        document = self.request(
            "workspace.createDocument",
            {
                "document": {
                    **document_payload(profile["id"]),
                    "schema_version": "0.2",
                }
            },
        )["result"]
        self.request(
            "workspace.saveDraft",
            {
                "document_id": document["id"],
                "content": {
                    "metadata": proposal["metadata"],
                    "sections": proposal["sections"],
                },
                "expected_revision": 0,
            },
        )

        response = self.request("document.check", {"document_id": document["id"]})

        self.assertTrue(response["ok"])
        self.assertEqual(response["result"]["checks"][0]["status"], "pass")

    def test_task_book_document_check_uses_profile_cohort_and_strict_contract(self) -> None:
        self.open()
        profile = self.request(
            "workspace.saveProfile",
            {
                "profile": {
                    **profile_payload("TASK-PROTOCOL-2027"),
                    "class_name": "新能源一班",
                    "advisor_name": "示例教师",
                }
            },
        )["result"]
        document = self.request(
            "workspace.createDocument",
            {
                "document": {
                    "profile_id": profile["id"],
                    "document_type": "task_book",
                    "template_version": "0.1+46b6d97",
                    "schema_version": "0.1",
                    "title": "协议合成任务书",
                }
            },
        )["result"]
        content = {
            "metadata": {
                "graduation_year": 2026,
                "title": "协议合成任务书课题",
                "student_name": "旧姓名",
                "student_id": "OLD-ID",
                "college": "旧学院",
                "major": "旧专业",
                "class_name": "旧班级",
                "advisor": "旧教师",
            },
            "sections": {
                "basic_content_and_requirements": ["完成虚构设计与验证。"],
                "schedule": [{"period": "第1—16周", "content": "完成全部工作。"}],
                "required_materials": [],
                "references": ["[1] 虚构参考文献。"],
                "topic_information": {
                    "nature": "graduation_design",
                    "source": {"type": "practice_project"},
                },
            },
        }
        self.request(
            "workspace.saveDraft",
            {
                "document_id": document["id"],
                "content": content,
                "expected_revision": 0,
            },
        )

        engine_root = self.data_dir.parent / "synthetic-task-book-engine"
        write_task_book_layout(engine_root)
        engine = EngineDescriptor(
            root=engine_root,
            validator=self.data_dir.parent / "synthetic-validator.py",
            pack_sha256="a" * 64,
            source="synthetic",
            document_type="task_book",
            template_id="sztu.task-book.synthetic",
            version="0.1-test",
        )
        with patch(
            "sztu_docs_backend.exporter.resolve_engine", return_value=engine
        ):
            response = self.request(
                "document.check", {"document_id": document["id"]}
            )

            self.assertTrue(response["ok"])
            check = response["result"]["checks"][0]
            self.assertEqual(check["status"], "pass")
            self.assertEqual(check["check_id"], "task_book-content")

            content["metadata"]["title"] = "任" * 46
            self.request(
                "workspace.saveDraft",
                {
                    "document_id": document["id"],
                    "content": content,
                    "expected_revision": 1,
                },
            )
            response = self.request(
                "document.check", {"document_id": document["id"]}
            )

        self.assertTrue(response["ok"])
        check = response["result"]["checks"][0]
        self.assertEqual(check["status"], "fail")
        self.assertTrue(check["blocking"])
        self.assertEqual(check["code"], "DOCUMENT_NOT_READY")
        self.assertEqual(check["details"]["field"], "metadata.title")
        self.assertEqual(
            check["details"]["reason"], "template_capacity_exceeded"
        )

    def test_preview_generation_is_dispatched_with_private_artifacts(self) -> None:
        self.open()
        document = self.request(
            "workspace.createDocument", {"document": document_payload()}
        )["result"]
        preview_result = {
            "schema_version": "1.0",
            "preview_id": "a" * 32,
            "document_id": document["id"],
            "document_revision": 1,
            "input_sha256": "b" * 64,
            "template": {
                "template_id": "fixture",
                "version": "fixture-1",
                "pack_sha256": "c" * 64,
            },
            "pdf": {
                "absolute_path": str(self.data_dir / "previews" / "preview.pdf"),
                "sha256": "d" * 64,
                "size_bytes": 10,
            },
            "pages": [],
            "checks": [],
            "generated_at": "2026-08-30T00:00:00Z",
        }
        with patch(
            "sztu_docs_backend.protocol.generate_preview",
            return_value=preview_result,
        ) as generate:
            response = self.request(
                "preview.generate",
                {
                    "request_id": str(uuid.uuid4()),
                    "document_id": document["id"],
                    "cancellation_file": str(self.data_dir / "cancellations" / "preview.cancel"),
                    "app_version": "0.1.0",
                },
            )
        self.assertTrue(response["ok"])
        self.assertEqual(response["result"], preview_result)
        generate.assert_called_once()

    def test_export_run_is_dispatched_without_echoing_document_content(self) -> None:
        self.open()
        document = self.request(
            "workspace.createDocument", {"document": document_payload()}
        )["result"]
        document_id = document["id"]
        preview_id = str(uuid.uuid4())
        output_directory = str(Path(self.temporary_directory.name) / "output")
        preflight_result = {
            "schema_version": "1.0",
            "ready": True,
            "document_id": document_id,
            "formats": ["docx", "pdf"],
            "input_sha256": "1" * 64,
            "template": {
                "template_id": "sztu.proposal.2026.dev",
                "version": "0.1.0",
                "pack_sha256": "2" * 64,
            },
            "checks": [
                {
                    "schema_version": "1.0",
                    "check_id": "output-targets",
                    "gate": "environment",
                    "status": "pass",
                    "blocking": False,
                    "message": "synthetic targets",
                    "details": {
                        "targets": [
                            {"format": "docx", "filename": "proposal.docx", "exists": False},
                            {"format": "pdf", "filename": "proposal.pdf", "exists": False},
                        ],
                        "conflicting_formats": [],
                    },
                }
            ],
            "blocking_codes": [],
            "preflight_token": "3" * 64,
            "expires_at": "2026-08-30T12:00:00Z",
        }
        expected = {"schema_version": "1.0", "status": "succeeded"}
        with patch(
            "sztu_docs_backend.protocol.preflight_export",
            return_value=preflight_result,
        ), patch("sztu_docs_backend.protocol.run_export", return_value=expected) as run:
            preflight = self.request(
                "export.preflight",
                {
                    "document_id": document_id,
                    "preview_id": preview_id,
                    "output_directory": output_directory,
                    "formats": ["docx", "pdf"],
                },
            )["result"]
            request_id = str(uuid.uuid4())
            response = self.request(
                "export.run",
                {
                    "request_id": request_id,
                    "document_id": document_id,
                    "preview_id": preview_id,
                    "output_directory": output_directory,
                    "formats": ["docx", "pdf"],
                    "preflight_token": preflight["preflight_token"],
                    "overwrite_confirmed": False,
                    "cancellation_file": str(Path(self.temporary_directory.name) / "cancel.marker"),
                    "app_version": "0.1.0",
                },
            )

        self.assertEqual(response["result"], expected)
        self.assertEqual(run.call_args.kwargs["document_id"], document_id)
        self.assertEqual(run.call_args.kwargs["preview_id"], preview_id)
        self.assertEqual(run.call_args.kwargs["formats"], ["docx", "pdf"])
        self.assertEqual(run.call_args.kwargs["request_id"], request_id)
        self.assertEqual(run.call_args.kwargs["preflight_token"], "3" * 64)
        self.assertNotIn("content", json.dumps(response, ensure_ascii=False))

        replay = self.request(
            "export.run",
            {
                "request_id": str(uuid.uuid4()),
                "document_id": document_id,
                "preview_id": preview_id,
                "output_directory": output_directory,
                "formats": ["docx", "pdf"],
                "preflight_token": preflight["preflight_token"],
                "overwrite_confirmed": False,
                "cancellation_file": str(Path(self.temporary_directory.name) / "cancel.marker"),
                "app_version": "0.1.0",
            },
        )
        self.assertEqual(replay["error"]["code"], "PREFLIGHT_EXPIRED")

    def test_export_history_is_allowlisted_and_strips_paths_and_snapshots(self) -> None:
        self.open()
        document_id = uuid.uuid4().hex
        artifact_id = uuid.uuid4().hex
        export_id = uuid.uuid4().hex
        unsafe = {
            "schema_version": "1.0",
            "history": [
                {
                    "export_id": export_id,
                    "request_id": str(uuid.uuid4()),
                    "status": "completed",
                    "progress": 100,
                    "error_code": None,
                    "requested_formats": ["docx"],
                    "input_sha256": "4" * 64,
                    "template": {
                        "template_id": "sztu.proposal.2026.dev",
                        "version": "0.1.0",
                        "pack_sha256": "5" * 64,
                    },
                    "snapshot_available": True,
                    "overwrite_confirmed": False,
                    "artifacts": [
                        {
                            "artifact_id": artifact_id,
                            "format": "docx",
                            "path": "/private/output/开题报告.docx",
                            "sha256": "6" * 64,
                            "size_bytes": 123,
                            "file_state": "available",
                            "replaced_existing": False,
                            "checks": [],
                            "private_content": "must not pass",
                        }
                    ],
                    "created_at": "2026-08-30T12:00:00Z",
                    "completed_at": "2026-08-30T12:00:01Z",
                    "snapshot_json": {
                        "proposal": {"body": "must not pass"},
                        "student_profile": {
                            "advisor_title": "私密职称不得透传",
                            "graduation_cohort": "私密届别不得透传",
                        },
                    },
                    "output_directory": "/private/output",
                }
            ],
        }
        with patch(
            "sztu_docs_backend.protocol.list_export_history", return_value=unsafe
        ):
            response = self.request(
                "export.history", {"document_id": document_id, "limit": 10}
            )

        self.assertTrue(response["ok"])
        encoded = json.dumps(response, ensure_ascii=False)
        self.assertNotIn("/private/output", encoded)
        self.assertNotIn("snapshot_json", encoded)
        self.assertNotIn("private_content", encoded)
        self.assertNotIn("私密职称不得透传", encoded)
        self.assertNotIn("私密届别不得透传", encoded)
        artifact = response["result"]["history"][0]["artifacts"][0]
        self.assertEqual(artifact["display_name"], "开题报告.docx")

    def test_export_history_delete_is_scoped_and_returns_no_paths(self) -> None:
        self.open()
        document_id = uuid.uuid4().hex
        export_id = uuid.uuid4().hex
        with patch(
            "sztu_docs_backend.protocol.delete_export_history_record",
            return_value={"export_id": export_id, "deleted": True},
        ) as delete_record:
            response = self.request(
                "export.deleteHistory",
                {"document_id": document_id, "export_id": export_id},
            )

        self.assertTrue(response["ok"])
        self.assertEqual(response["result"], {"export_id": export_id, "deleted": True})
        delete_record.assert_called_once()
        self.assertEqual(delete_record.call_args.kwargs["document_id"], document_id)
        self.assertEqual(delete_record.call_args.kwargs["export_id"], export_id)

    def test_internal_exception_is_not_exposed_or_traced(self) -> None:
        with patch(
            "sztu_docs_backend.protocol.check_environment",
            side_effect=RuntimeError("private implementation detail"),
        ), self.assertLogs("sztu_docs_backend.protocol", level="ERROR") as logs:
            response = self.request("environment.check")
        self.assertEqual(response["error"]["code"], "INTERNAL_ERROR")
        encoded = json.dumps(response, ensure_ascii=False)
        self.assertNotIn("private implementation detail", encoded)
        self.assertNotIn(str(self.data_dir), "\n".join(logs.output))
        self.assertNotIn("Traceback", "\n".join(logs.output))

    def test_workspace_must_be_open_before_data_methods(self) -> None:
        response = self.request("workspace.load")
        self.assertEqual(response["error"]["code"], "WORKSPACE_NOT_OPEN")

    def test_partial_profile_input_draft_survives_restart(self) -> None:
        self.open()
        expected = profile_draft_payload(
            full_name="尚未填写完整的学生档案",
            graduation_cohort="2028届",
        )
        saved = self.request(
            "workspace.saveProfileDraft",
            {
                "profile": {
                    "full_name": "尚未填写完整的学生档案",
                    "graduation_cohort": "2028届",
                }
            },
        )["result"]
        self.assertEqual(saved, expected)

        self.session.close()
        self.session = ProtocolSession()
        reopened = self.open()["result"]
        self.assertIsNone(reopened["profile"])
        self.assertEqual(reopened["profile_draft"], expected)

    def test_explicitly_cleared_profile_input_draft_stays_blank(self) -> None:
        self.open()
        self.request(
            "workspace.saveProfileDraft",
            {"profile": profile_draft_payload(full_name="即将清空")},
        )
        cleared = self.request(
            "workspace.saveProfileDraft",
            {"profile": profile_draft_payload()},
        )["result"]
        self.assertEqual(cleared, profile_draft_payload())

        self.session.close()
        self.session = ProtocolSession()
        self.assertEqual(
            self.open()["result"]["profile_draft"], profile_draft_payload()
        )

    def test_complete_profile_save_replaces_stale_profile_input_draft(self) -> None:
        self.open()
        self.request(
            "workspace.saveProfileDraft",
            {"profile": profile_draft_payload(full_name="旧的未完成内容")},
        )
        profile = self.request(
            "workspace.saveProfile", {"profile": profile_payload()}
        )["result"]
        loaded = self.request("workspace.load")["result"]
        self.assertEqual(
            loaded["profile_draft"],
            {
                field: (
                    profile.get(field)
                    if field in {"thesis_title", "thesis_title_en"}
                    else profile.get(field) or ""
                )
                for field in profile_draft_payload()
            },
        )

    def test_profile_input_draft_validation_and_history_do_not_leak_content(self) -> None:
        self.open()
        secret = "不应进入日志或导出历史的档案草稿"
        with self.assertNoLogs("sztu_docs_backend.protocol", level="ERROR"):
            invalid = self.request(
                "workspace.saveProfileDraft",
                {"profile": {"full_name": secret, "major": {"secret": secret}}},
            )
        encoded_invalid = json.dumps(invalid, ensure_ascii=False)
        self.assertEqual(invalid["error"]["code"], "VALIDATION")
        self.assertNotIn(secret, encoded_invalid)

        self.request(
            "workspace.saveProfileDraft",
            {"profile": profile_draft_payload(full_name=secret)},
        )
        document_id = uuid.uuid4().hex
        with patch(
            "sztu_docs_backend.protocol.list_export_history",
            return_value={"schema_version": "1.0", "history": []},
        ):
            history = self.request(
                "export.history", {"document_id": document_id, "limit": 10}
            )
        self.assertNotIn(secret, json.dumps(history, ensure_ascii=False))

    def test_persistent_profile_and_current_draft_survive_restart(self) -> None:
        opened = self.open()
        self.assertEqual(opened["result"], {
            "mode": "persistent",
            "profile": None,
            "profile_draft": None,
            "document": None,
            "documents": [],
            "deleted_documents": [],
        })
        profile = self.request(
            "workspace.saveProfile", {"profile": profile_payload()}
        )["result"]
        document = self.request(
            "workspace.createDocument",
            {"document": document_payload(profile["id"])},
        )["result"]
        first = self.request(
            "workspace.saveDraft",
            {
                "document_id": document["id"],
                "content": {"body": "第一版合成正文"},
                "expected_revision": 0,
                "reason": "manual",
            },
        )["result"]
        self.assertEqual(first["current_revision"], 1)
        second = self.request(
            "workspace.saveDraft",
            {
                "document_id": document["id"],
                "content": {"body": "第二版合成正文"},
                "expected_revision": 1,
            },
        )["result"]
        self.assertEqual(second["current_revision"], 2)

        self.session.close()
        self.session = ProtocolSession()
        reopened = self.open()["result"]
        self.assertEqual(reopened["profile"]["id"], profile["id"])
        self.assertEqual(reopened["profile"]["advisor_title"], "教授")
        self.assertEqual(reopened["profile"]["graduation_cohort"], "2027届")
        self.assertEqual(reopened["document"]["id"], document["id"])
        self.assertEqual(reopened["document"]["content"], {"body": "第二版合成正文"})

    def test_open_falls_back_to_most_recent_records_without_active_setting(self) -> None:
        with Workspace.open_persistent(self.data_dir) as direct:
            profile = direct.save_profile(profile_payload())
            document = direct.create_document(document_payload(profile["id"]))
            direct.save_draft(document["id"], {"fallback": True}, 0)

        opened = self.open()["result"]
        self.assertEqual(opened["profile"]["id"], profile["id"])
        self.assertEqual(opened["document"]["id"], document["id"])
        self.assertEqual(opened["document"]["content"], {"fallback": True})

    def test_stale_save_is_stable_conflict_without_content_leak(self) -> None:
        self.open()
        document = self.request(
            "workspace.createDocument", {"document": document_payload()}
        )["result"]
        self.request(
            "workspace.saveDraft",
            {
                "document_id": document["id"],
                "content": {"secret": "先写入的合成正文"},
                "expected_revision": 0,
            },
        )
        response = self.request(
            "workspace.saveDraft",
            {
                "document_id": document["id"],
                "content": {"secret": "不应泄露的冲突正文"},
                "expected_revision": 0,
            },
        )
        self.assertEqual(response["error"]["code"], "REVISION_CONFLICT")
        self.assertEqual(response["error"]["details"]["actual_revision"], 1)
        self.assertNotIn("不应泄露", json.dumps(response, ensure_ascii=False))

    def test_first_profile_binds_empty_document_and_recovers_after_restart(self) -> None:
        self.open()
        document = self.request(
            "workspace.createDocument", {"document": document_payload()}
        )["result"]
        self.assertIsNone(document["profile_id"])
        profile = self.request(
            "workspace.saveProfile", {"profile": profile_payload()}
        )["result"]
        loaded = self.request("workspace.load")["result"]
        self.assertEqual(loaded["document"]["profile_id"], profile["id"])
        self.request(
            "workspace.saveDraft",
            {
                "document_id": document["id"],
                "content": {"first_run": "已绑定"},
                "expected_revision": 0,
            },
        )

        self.session.close()
        self.session = ProtocolSession()
        reopened = self.open()["result"]
        self.assertEqual(reopened["profile"]["id"], profile["id"])
        self.assertEqual(reopened["document"]["id"], document["id"])
        self.assertEqual(reopened["document"]["profile_id"], profile["id"])
        self.assertEqual(reopened["document"]["content"], {"first_run": "已绑定"})

    def test_first_profile_binds_all_preexisting_process_documents(self) -> None:
        self.open()
        task_book_payload = document_payload()
        task_book_payload.update(
            {
                "document_type": "task_book",
                "template_version": "0.1+46b6d97",
                "schema_version": "0.1",
                "title": "协议合成任务书",
            }
        )
        task_book = self.request(
            "workspace.createDocument", {"document": task_book_payload}
        )["result"]
        proposal = self.request(
            "workspace.createDocument", {"document": document_payload()}
        )["result"]
        self.assertIsNone(task_book["profile_id"])
        self.assertIsNone(proposal["profile_id"])

        profile = self.request(
            "workspace.saveProfile", {"profile": profile_payload()}
        )["result"]
        loaded = self.request("workspace.load")["result"]
        documents = {item["id"]: item for item in loaded["documents"]}
        self.assertEqual(documents[task_book["id"]]["profile_id"], profile["id"])
        self.assertEqual(documents[proposal["id"]]["profile_id"], profile["id"])

        selected = self.request(
            "workspace.selectDocument", {"document_id": task_book["id"]}
        )
        self.assertNotIn("error", selected)
        self.assertEqual(selected["result"]["document"]["profile_id"], profile["id"])

    def test_document_file_lifecycle_is_exposed_through_workspace_protocol(self) -> None:
        self.open()
        profile = self.request(
            "workspace.saveProfile", {"profile": profile_payload()}
        )["result"]
        source = self.request(
            "workspace.createDocument",
            {"document": document_payload(profile["id"])},
        )["result"]
        self.request(
            "workspace.saveDraft",
            {
                "document_id": source["id"],
                "content": {"body": "用于复制的内容"},
                "expected_revision": 0,
            },
        )
        copied_payload = document_payload(profile["id"])
        copied_payload.update(
            {"title": "开题报告副本", "source_document_id": source["id"]}
        )
        copied = self.request(
            "workspace.createDocument", {"document": copied_payload}
        )["result"]
        self.assertEqual(copied["content"], {"body": "用于复制的内容"})

        renamed = self.request(
            "workspace.renameDocument",
            {"document_id": copied["id"], "title": "第二版开题报告"},
        )["result"]
        self.assertEqual(renamed["document"]["title"], "第二版开题报告")

        recycled = self.request(
            "workspace.deleteDocument", {"document_id": copied["id"]}
        )["result"]
        self.assertEqual([item["id"] for item in recycled["documents"]], [source["id"]])
        self.assertEqual(
            [item["id"] for item in recycled["deleted_documents"]],
            [copied["id"]],
        )

        restored = self.request(
            "workspace.restoreDocument", {"document_id": copied["id"]}
        )["result"]
        self.assertEqual(restored["document"]["id"], copied["id"])
        self.request("workspace.deleteDocument", {"document_id": copied["id"]})
        purged = self.request(
            "workspace.purgeDocument", {"document_id": copied["id"]}
        )["result"]
        self.assertEqual(purged["deleted_documents"], [])

    def test_untrusted_record_id_is_not_reflected_in_storage_error(self) -> None:
        self.open()
        response = self.request(
            "workspace.saveDraft",
            {
                "document_id": "协议合成学生-PROTO-0001",
                "content": {"body": "不应泄露"},
                "expected_revision": 0,
            },
        )
        encoded = json.dumps(response, ensure_ascii=False)
        self.assertEqual(response["error"]["code"], "NOT_FOUND")
        self.assertNotIn("协议合成学生", encoded)
        self.assertNotIn("不应泄露", encoded)

    def test_switch_persistent_to_temporary_then_close_returns_persistent(self) -> None:
        self.open("persistent")
        profile = self.request(
            "workspace.saveProfile", {"profile": profile_payload()}
        )["result"]
        persistent_document = self.request(
            "workspace.createDocument",
            {"document": document_payload(profile["id"])},
        )["result"]
        self.request(
            "workspace.saveDraft",
            {
                "document_id": persistent_document["id"],
                "content": {"kind": "persistent"},
                "expected_revision": 0,
            },
        )

        switched = self.open("temporary")["result"]
        self.assertEqual(switched["mode"], "temporary")
        temp_document = self.request(
            "workspace.createDocument", {"document": document_payload()}
        )["result"]
        self.request(
            "workspace.saveDraft",
            {
                "document_id": temp_document["id"],
                "content": {"kind": "temporary"},
                "expected_revision": 0,
            },
        )
        returned = self.request(
            "workspace.closeTemporary", {"document_id": temp_document["id"]}
        )["result"]
        self.assertEqual(returned["mode"], "persistent")
        self.assertEqual(returned["profile"]["id"], profile["id"])
        self.assertEqual(returned["document"]["id"], persistent_document["id"])
        self.assertEqual(returned["document"]["content"], {"kind": "persistent"})

    def test_open_is_idempotent_but_cannot_silently_discard_temporary(self) -> None:
        first = self.open("persistent")["result"]
        second = self.open("persistent")["result"]
        self.assertEqual(second, first)
        self.open("temporary")
        refused = self.open("persistent")
        self.assertEqual(refused["error"]["code"], "WORKSPACE_ALREADY_OPEN")


if __name__ == "__main__":
    unittest.main()
