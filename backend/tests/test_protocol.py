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
    }


def document_payload(profile_id: str | None = None) -> dict[str, str | None]:
    return {
        "profile_id": profile_id,
        "document_type": "proposal",
        "template_version": "fixture-1",
        "schema_version": "fixture-1",
        "title": "协议合成开题报告",
    }


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

    def test_export_run_is_dispatched_without_echoing_document_content(self) -> None:
        self.open()
        document = self.request(
            "workspace.createDocument", {"document": document_payload()}
        )["result"]
        document_id = document["id"]
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
        self.assertEqual(run.call_args.kwargs["formats"], ["docx", "pdf"])
        self.assertEqual(run.call_args.kwargs["request_id"], request_id)
        self.assertEqual(run.call_args.kwargs["preflight_token"], "3" * 64)
        self.assertNotIn("content", json.dumps(response, ensure_ascii=False))

        replay = self.request(
            "export.run",
            {
                "request_id": str(uuid.uuid4()),
                "document_id": document_id,
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
                    "snapshot_json": {"proposal": {"body": "must not pass"}},
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
        artifact = response["result"]["history"][0]["artifacts"][0]
        self.assertEqual(artifact["display_name"], "开题报告.docx")

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

    def test_persistent_profile_document_and_draft_restore_after_restart(self) -> None:
        opened = self.open()
        self.assertEqual(opened["result"], {
            "mode": "persistent", "profile": None, "document": None, "documents": []
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
        restored = self.request(
            "workspace.restorePrevious",
            {"document_id": document["id"], "expected_revision": 2},
        )["result"]
        self.assertEqual(restored["current_revision"], 3)
        self.assertEqual(restored["content"], {"body": "第一版合成正文"})

        self.session.close()
        self.session = ProtocolSession()
        reopened = self.open()["result"]
        self.assertEqual(reopened["profile"]["id"], profile["id"])
        self.assertEqual(reopened["document"]["id"], document["id"])
        self.assertEqual(reopened["document"]["content"], {"body": "第一版合成正文"})

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
