"""Independent render connections keep saves live and export inputs consistent."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import tempfile
import threading
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from sztu_docs_backend import exporter
from sztu_docs_backend.protocol import ProtocolSession
from sztu_docs_backend.storage import Workspace
from sztu_docs_backend.template_engine import EngineDescriptor


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class RenderWorkspaceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="sztu-render-workspace-test-")
        self.root = Path(self.temporary.name)
        self.data_dir = self.root / "data"
        self.control = Workspace.open_persistent(self.data_dir)
        self.content = json.loads((
            REPOSITORY_ROOT / "template-packs/sztu-proposal-2026-dev/fixtures/normal.json"
        ).read_text(encoding="utf-8"))
        self.profile_payload = {
            "full_name": "虚构甲",
            "student_number": "SYNTHETIC-RENDER-001",
            "college": "测试学院",
            "major": "测试专业",
            "advisor_name": "虚构乙",
            "advisor_title": "讲师",
            "graduation_cohort": "2026届",
        }
        self.profile = self.control.save_profile(self.profile_payload)
        self.document = self.control.create_document({
            "profile_id": self.profile["id"],
            "document_type": "proposal",
            "template_version": "synthetic",
            "schema_version": "0.2",
            "title": "并发保存测试",
        })
        self.control.save_draft(self.document["id"], self.content, 0)
        self.control.save_active(
            profile_id=self.profile["id"], document_id=self.document["id"]
        )
        self.engine = EngineDescriptor(
            root=self.root / "synthetic-engine",
            validator=self.root / "synthetic-validator.py",
            pack_sha256="b" * 64,
            source="synthetic",
        )

    def tearDown(self) -> None:
        self.control.close()
        self.temporary.cleanup()

    @staticmethod
    def request(session: ProtocolSession, method: str, params: dict) -> dict:
        return session.dispatch({
            "protocol": "1.0", "id": str(uuid.uuid4()),
            "method": method, "params": params,
        })

    def active_job(self) -> dict:
        job = self.control.create_export_job(
            document_id=self.document["id"],
            request_id=str(uuid.uuid4()),
            formats=["pdf"],
            output_directory=str(self.root),
            input_sha256="a" * 64,
            template_id="synthetic", template_version="1.0",
            template_sha256="b" * 64,
            snapshot={"synthetic": True},
        )
        return self.control.start_export_job(job["id"])

    def test_render_bootstrap_does_not_recover_bind_or_change_active_document(self) -> None:
        unassigned = self.control.create_document({
            "profile_id": None, "document_type": "proposal",
            "template_version": "synthetic", "schema_version": "0.2", "title": "未绑定测试",
        })
        job = self.active_job()
        before_active = self.control.get_setting("workbench.active")
        with patch.dict(os.environ, {
            "SZTU_DOCS_DATA_DIR": str(self.data_dir),
            "SZTU_DOCS_SIDECAR_ROLE": "render",
            "SZTU_DOCS_RECOVER_INTERRUPTED": "1",
        }):
            session = ProtocolSession()
            try:
                for _ in range(2):
                    response = self.request(session, "workspace.open", {"mode": "persistent"})
                    self.assertTrue(response["ok"], response)
                    self.assertEqual(response["result"], {"mode": "persistent", "render_ready": True})
                temporary = self.request(session, "workspace.open", {"mode": "temporary"})
                self.assertEqual(temporary["error"]["code"], "INVALID_PARAMS")
            finally:
                session.close()
        self.assertEqual(self.control.get_setting("workbench.active"), before_active)
        self.assertIsNone(self.control.get_document(unassigned["id"])["profile_id"])
        self.assertEqual(self.control.get_export_job(job["id"])["status"], "running")

    def test_replacement_control_connection_preserves_a_live_render_job(self) -> None:
        job = self.active_job()
        with patch.dict(os.environ, {
            "SZTU_DOCS_DATA_DIR": str(self.data_dir),
            "SZTU_DOCS_SIDECAR_ROLE": "control",
            "SZTU_DOCS_RECOVER_INTERRUPTED": "0",
        }):
            session = ProtocolSession()
            try:
                response = self.request(session, "workspace.open", {"mode": "persistent"})
                self.assertTrue(response["ok"], response)
                self.assertEqual(response["result"]["document"]["id"], self.document["id"])
            finally:
                session.close()
        self.assertEqual(self.control.get_export_job(job["id"])["status"], "running")

    def preview_receipt(self, preview_workspace: Workspace, **kwargs) -> dict:
        document = exporter.build_export_document(
            preview_workspace, preview_workspace.get_document(kwargs["document_id"])
        )
        pdf = Path(kwargs["output_directory"]) / "synthetic.pdf"
        pdf.write_bytes(b"synthetic preview bytes, not a rendered PDF")
        return {
            "artifacts": [{"format": "pdf", "path": str(pdf)}],
            "input_sha256": hashlib.sha256(exporter.canonical_json(document)).hexdigest(),
            "template": {
                "template_id": self.engine.template_id,
                "version": self.engine.version,
                "pack_sha256": self.engine.pack_sha256,
            },
            "checks": [], "generated_at": "2026-10-03T00:00:00Z",
        }

    @staticmethod
    def fake_raster(_command, *, cwd, **_kwargs) -> str:
        (cwd / "page-1.png").write_bytes(b"synthetic page bytes, not a rendered PNG")
        return ""

    def test_preview_freezes_one_revision_and_profile_while_other_connection_saves(self) -> None:
        expected = exporter.build_export_document(
            self.control, self.control.get_document(self.document["id"])
        )
        reading_profile = threading.Event()
        continue_read = threading.Event()
        rendering = threading.Event()
        finish_render = threading.Event()
        observed = {}

        def generate() -> dict:
            # Each connection is created and used on its owning thread. No
            # check_same_thread=False escape hatch is needed in production.
            with Workspace.open_persistent(self.data_dir, recover_interrupted=False) as worker:
                original_get_profile = worker.get_profile

                def read_profile(profile_id):
                    reading_profile.set()
                    if not continue_read.wait(5):
                        raise AssertionError("control save did not finish during snapshot read")
                    return original_get_profile(profile_id)

                def render_preview(preview_workspace, **kwargs):
                    observed["transaction_during_render"] = worker.database.connection.in_transaction
                    observed["input"] = exporter.build_export_document(
                        preview_workspace, preview_workspace.get_document(kwargs["document_id"])
                    )
                    rendering.set()
                    if not finish_render.wait(5):
                        raise AssertionError("control save did not finish while rendering")
                    return self.preview_receipt(preview_workspace, **kwargs)

                with patch.object(worker, "get_profile", side_effect=read_profile), \
                     patch.object(exporter, "resolve_engine", return_value=self.engine), \
                     patch.object(exporter, "run_export", side_effect=render_preview), \
                     patch.object(exporter, "_run", side_effect=self.fake_raster):
                    return exporter.generate_preview(
                        worker, document_id=self.document["id"], request_id=str(uuid.uuid4())
                    )

        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(generate)
            try:
                self.assertTrue(reading_profile.wait(5))
                changed = copy.deepcopy(self.content)
                changed["sections"]["references"] = ["快照读取期间保存的正文"]
                self.control.save_profile({**self.profile_payload, "id": self.profile["id"], "full_name": "虚构丙"})
                self.control.save_draft(self.document["id"], changed, 1)
                continue_read.set()
                self.assertTrue(rendering.wait(5))
                changed["sections"]["references"] = ["渲染期间再次保存的正文"]
                self.control.save_profile({**self.profile_payload, "id": self.profile["id"], "full_name": "虚构丁"})
                self.control.save_draft(self.document["id"], changed, 2)
            finally:
                continue_read.set()
                finish_render.set()
            result = future.result(timeout=5)

        self.assertFalse(observed["transaction_during_render"])
        self.assertEqual(observed["input"], expected)
        self.assertEqual(result["document_revision"], 1)
        self.assertEqual(result["input_sha256"], hashlib.sha256(exporter.canonical_json(expected)).hexdigest())
        self.assertEqual(self.control.get_document(self.document["id"])["current_revision"], 3)
        self.assertEqual(self.control.get_profile(self.profile["id"])["full_name"], "虚构丁")

    def test_preview_copies_shared_english_thesis_title(self) -> None:
        from test_thesis_export import thesis_content

        self.control.save_profile({
            **self.profile_payload, "id": self.profile["id"],
            "thesis_title_en": "Updated Shared English Title",
        })
        document = self.control.create_document({
            "profile_id": self.profile["id"], "document_type": "thesis",
            "template_version": "synthetic", "schema_version": "0.1", "title": "虚构论文",
        })
        self.control.save_draft(document["id"], thesis_content(), 0)
        self.engine = EngineDescriptor(
            root=self.engine.root, validator=self.engine.validator, pack_sha256=self.engine.pack_sha256,
            source="synthetic", document_type="thesis",
        )
        expected = exporter.build_export_document(self.control, self.control.get_document(document["id"]))
        with patch.object(exporter, "resolve_engine", return_value=self.engine), \
             patch.object(exporter, "run_export", side_effect=self.preview_receipt), \
             patch.object(exporter, "_run", side_effect=self.fake_raster):
            result = exporter.generate_preview(
                self.control, document_id=document["id"], request_id=str(uuid.uuid4())
            )
        self.assertEqual(expected["thesis"]["englishTitle"], "Updated Shared English Title")
        self.assertEqual(result["input_sha256"], hashlib.sha256(exporter.canonical_json(expected)).hexdigest())

    def test_export_history_uses_the_profile_captured_with_its_input(self) -> None:
        output = self.root / "output"
        output.mkdir()
        expected = exporter.build_export_document(self.control, self.control.get_document(self.document["id"]))
        with Workspace.open_persistent(self.data_dir, recover_interrupted=False) as worker:
            def update_after_snapshot(*_args):
                self.control.save_profile({
                    **self.profile_payload, "id": self.profile["id"],
                    "full_name": "虚构丙", "advisor_title": "教授", "graduation_cohort": "2027届",
                })

            def fake_word(command, **_kwargs):
                target = Path(command[command.index("--output") + 1])
                target.write_bytes(b"synthetic Word bytes, not a rendered DOCX")
                return ""

            with patch.object(exporter, "validate_template_renderability", side_effect=update_after_snapshot), \
                 patch.object(exporter, "_run", side_effect=fake_word), \
                 patch("sztu_docs_backend.docx_inspector.inspect_docx", return_value={"check_id": "docx-deep-structure"}):
                receipt = exporter.run_export(
                    worker, document_id=self.document["id"], output_directory=str(output),
                    formats=["docx"], engine=self.engine, request_id=str(uuid.uuid4()),
                )

        snapshot = self.control.get_export_job(receipt["export_id"])["snapshot"]
        self.assertEqual(snapshot["proposal"], expected)
        self.assertEqual(snapshot["student_profile"]["advisor_title"], "讲师")
        self.assertEqual(snapshot["student_profile"]["graduation_cohort"], "2026届")
        self.assertEqual(self.control.get_profile(self.profile["id"])["advisor_title"], "教授")


if __name__ == "__main__":
    unittest.main()
