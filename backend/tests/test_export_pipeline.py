from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from sztu_docs_backend import template_engine
from sztu_docs_backend.exporter import (
    ExportError,
    build_export_document,
    list_export_history,
    preflight_export,
    run_export,
)
from sztu_docs_backend.storage import Workspace
from sztu_docs_backend.template_engine import (
    EngineDescriptor,
    TemplateEngineError,
    install_engine,
    installed_engine_root,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
PROPOSAL_FIXTURE = (
    REPOSITORY_ROOT
    / "template-packs"
    / "sztu-proposal-2026-dev"
    / "fixtures"
    / "normal.json"
)


def proposal_fixture() -> dict[str, object]:
    return json.loads(PROPOSAL_FIXTURE.read_text(encoding="utf-8"))


def deep_docx_check() -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "check_id": "docx-deep-structure",
        "gate": "structure",
        "status": "pass",
        "blocking": True,
        "message": "合成 Word 深层结构检查通过。",
        "checked_at": "2026-08-30T00:00:00Z",
    }


class ExportPipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.data_dir = self.root / "data"
        self.output = self.root / "output"
        self.output.mkdir()
        self.workspace = Workspace.open_persistent(self.data_dir)
        self.proposal = proposal_fixture()
        profile = self.workspace.save_profile(
            {
                "full_name": self.proposal["metadata"]["student_name"],
                "student_number": self.proposal["metadata"]["student_id"],
                "college": self.proposal["metadata"]["college"],
                "major": self.proposal["metadata"]["major"],
                "advisor_name": self.proposal["metadata"]["advisor"],
            }
        )
        self.profile_id = profile["id"]
        document = self.workspace.create_document(
            {
                "profile_id": profile["id"],
                "document_type": "proposal",
                "template_version": "fixture-engine",
                "schema_version": "0.2",
                "title": self.proposal["metadata"]["title"],
            }
        )
        self.document_id = document["id"]
        self.workspace.save_draft(
            self.document_id,
            {
                "metadata": self.proposal["metadata"],
                "sections": self.proposal["sections"],
            },
            0,
            reason="manual",
        )
        self.engine = EngineDescriptor(
            root=self.root / "synthetic-engine",
            validator=self.root / "synthetic-validator.py",
            pack_sha256="e" * 64,
            source="synthetic",
        )

    def tearDown(self) -> None:
        self.workspace.close()
        self.temporary_directory.cleanup()

    def fake_render(
        self,
        command: list[str],
        *,
        cwd: Path,
        timeout: int = 90,
        cancellation_file: Path | None = None,
    ) -> str:
        del cwd, timeout, cancellation_file
        if "--output" in command:
            output = Path(command[command.index("--output") + 1])
            output.write_bytes(b"synthetic-docx-render-v2")
        return "synthetic renderer completed"

    def test_preflight_uses_stable_ordered_filenames(self) -> None:
        existing_pdf = self.output / "开题报告.pdf"
        existing_pdf.write_bytes(b"existing")
        result = preflight_export(
            self.workspace,
            document_id=self.document_id,
            output_directory=str(self.output),
            formats=["tex", "docx", "pdf"],
            engine=self.engine,
        )
        repeated = preflight_export(
            self.workspace,
            document_id=self.document_id,
            output_directory=str(self.output),
            formats=["tex", "docx", "pdf"],
            engine=self.engine,
        )
        output_check = next(
            check for check in result["checks"] if check["check_id"] == "output-targets"
        )
        targets = output_check["details"]["targets"]
        self.assertEqual(
            [target["format"] for target in targets],
            ["docx", "pdf", "tex"],
        )
        self.assertEqual(
            [target["filename"] for target in targets],
            ["开题报告.docx", "开题报告.pdf", "开题报告-LaTeX.zip"],
        )
        self.assertEqual(
            [target["exists"] for target in targets],
            [False, True, False],
        )
        self.assertEqual(output_check["code"], "OUTPUT_EXISTS")
        self.assertEqual(output_check["details"]["conflicting_formats"], ["pdf"])
        self.assertEqual(result["preflight_token"], repeated["preflight_token"])

    def test_shared_profile_overrides_stale_identity_fields_in_export_input(self) -> None:
        updated = self.workspace.save_profile(
            {
                "id": self.profile_id,
                "full_name": "统一档案姓名",
                "student_number": "PROFILE-ONLY-2026",
                "college": "统一档案学院",
                "major": "统一档案专业",
                "class_name": "统一档案班级",
                "advisor_name": "统一档案教师",
            }
        )
        record = self.workspace.get_document(self.document_id)
        self.assertNotEqual(record["content"]["metadata"]["student_name"], updated["full_name"])

        merged = build_export_document(self.workspace, record)

        self.assertEqual(
            merged["metadata"],
            {
                **record["content"]["metadata"],
                "student_name": "统一档案姓名",
                "student_id": "PROFILE-ONLY-2026",
                "college": "统一档案学院",
                "major": "统一档案专业",
                "advisor": "统一档案教师",
            },
        )

    def test_export_input_without_a_linked_profile_cannot_reuse_legacy_identity(self) -> None:
        document = self.workspace.create_document(
            {
                "profile_id": None,
                "document_type": "proposal",
                "template_version": "fixture-engine",
                "schema_version": "0.2",
                "title": "未绑定档案的历史草稿",
            }
        )
        self.workspace.save_draft(
            document["id"],
            {
                "metadata": self.proposal["metadata"],
                "sections": self.proposal["sections"],
            },
            0,
            reason="manual",
        )
        merged = build_export_document(
            self.workspace,
            self.workspace.get_document(document["id"]),
        )
        for field in ("student_name", "student_id", "college", "major", "advisor"):
            self.assertEqual(merged["metadata"][field], "")

    def test_midterm_preflight_uses_its_own_filenames_and_template_identity(self) -> None:
        midterm = {
            "schema_version": "0.1",
            "metadata": {
                "student_name": "测试同学",
                "college": "测试学院",
                "major": "测试专业",
                "class_name": "测试一班",
                "advisor": "示例教师",
                "check_date": "2026-03-26",
                "title": "虚构中期检查课题",
            },
            "sections": {
                "directory": [{"level": 1, "number": "1", "title": "绪论"}],
                "main_research_content": [
                    {"type": "paragraph", "runs": [{"text": "研究虚构问题。"}]}
                ],
                "progress": [
                    {"type": "paragraph", "runs": [{"text": "已完成合成验证。"}]}
                ],
            },
        }
        midterm_profile = self.workspace.save_profile(
            {
                "full_name": "测试同学",
                "student_number": "MIDTERM-PROFILE-2026",
                "college": "测试学院",
                "major": "测试专业",
                "class_name": "测试一班",
                "advisor_name": "示例教师",
            }
        )
        document = self.workspace.create_document(
            {
                "profile_id": midterm_profile["id"],
                "document_type": "midterm",
                "template_version": "0.1+local.20260830",
                "schema_version": "0.1",
                "title": "中期检查表",
            }
        )
        self.workspace.save_draft(
            document["id"],
            {"metadata": midterm["metadata"], "sections": midterm["sections"]},
            0,
            reason="manual",
        )
        engine = EngineDescriptor(
            root=self.root / "synthetic-midterm-engine",
            validator=self.root / "synthetic-validator.py",
            pack_sha256="f" * 64,
            source="synthetic",
            document_type="midterm",
            template_id="sztu.midterm.synthetic",
            version="0.1-test",
        )
        result = preflight_export(
            self.workspace,
            document_id=document["id"],
            output_directory=str(self.output),
            formats=["tex", "docx", "pdf"],
            engine=engine,
        )
        targets = next(
            check for check in result["checks"] if check["check_id"] == "output-targets"
        )["details"]["targets"]
        self.assertEqual(
            [target["filename"] for target in targets],
            ["中期检查表.docx", "中期检查表.pdf", "中期检查表-LaTeX.zip"],
        )
        self.assertEqual(result["template"]["template_id"], "sztu.midterm.synthetic")

    def test_existing_target_is_not_overwritten_without_confirmation(self) -> None:
        target = self.output / "开题报告.docx"
        target.write_bytes(b"original-user-file")
        with patch("sztu_docs_backend.exporter._run") as renderer:
            with self.assertRaises(ExportError) as caught:
                run_export(
                    self.workspace,
                    document_id=self.document_id,
                    output_directory=str(self.output),
                    formats=["docx"],
                    engine=self.engine,
                    request_id=str(uuid.uuid4()),
                )
        self.assertEqual(caught.exception.code, "OUTPUT_EXISTS")
        renderer.assert_not_called()
        self.assertEqual(target.read_bytes(), b"original-user-file")
        self.assertEqual(self.workspace.list_export_jobs(), [])
        self.assertEqual([path.name for path in self.output.iterdir()], [target.name])

    def test_confirmed_overwrite_round_trips_receipt_snapshot_and_history(self) -> None:
        target = self.output / "开题报告.docx"
        target.write_bytes(b"original-user-file")
        request_id = str(uuid.uuid4())
        with patch(
            "sztu_docs_backend.exporter._run", side_effect=self.fake_render
        ), patch(
            "sztu_docs_backend.docx_inspector.inspect_docx",
            return_value=deep_docx_check(),
        ):
            receipt = run_export(
                self.workspace,
                document_id=self.document_id,
                output_directory=str(self.output),
                formats=["docx"],
                engine=self.engine,
                overwrite_confirmed=True,
                request_id=request_id,
                app_version="synthetic-app",
            )

        self.assertEqual(target.read_bytes(), b"synthetic-docx-render-v2")
        self.assertEqual(receipt["status"], "succeeded")
        self.assertEqual(receipt["request_id"], request_id)
        self.assertEqual(
            Path(receipt["artifacts"][0]["path"]).resolve(), target.resolve()
        )

        stored = self.workspace.get_export_job(receipt["export_id"])
        self.assertEqual(stored["status"], "completed")
        self.assertEqual(stored["receipt"], receipt)
        self.assertEqual(stored["snapshot"]["proposal"], self.proposal)
        self.assertTrue(stored["overwrite_confirmed"])
        self.assertTrue(stored["artifacts"][0]["replaced_existing"])
        self.assertEqual(stored["artifacts"][0]["relative_path"], target.name)

        history = list_export_history(
            self.workspace, document_id=self.document_id, limit=10
        )["history"]
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["export_id"], receipt["export_id"])
        self.assertEqual(history[0]["status"], "completed")
        self.assertTrue(history[0]["snapshot_available"])
        self.assertTrue(history[0]["overwrite_confirmed"])
        self.assertEqual(history[0]["artifacts"][0]["file_state"], "available")

    def test_existing_cancel_marker_cancels_without_partial_artifacts(self) -> None:
        cancellation_directory = self.data_dir / "cancellations"
        cancellation_directory.mkdir()
        marker = cancellation_directory / "synthetic-export.cancel"
        marker.write_text("cancel", encoding="utf-8")
        request_id = str(uuid.uuid4())

        with patch("sztu_docs_backend.exporter._run") as renderer:
            with self.assertRaises(ExportError) as caught:
                run_export(
                    self.workspace,
                    document_id=self.document_id,
                    output_directory=str(self.output),
                    formats=["docx"],
                    engine=self.engine,
                    request_id=request_id,
                    cancellation_file=str(marker),
                )
        self.assertEqual(caught.exception.code, "EXPORT_CANCELLED")
        renderer.assert_not_called()
        self.assertEqual(list(self.output.iterdir()), [])
        jobs = self.workspace.list_export_jobs(document_id=self.document_id)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["status"], "cancelled")
        self.assertEqual(jobs[0]["error_code"], "EXPORT_CANCELLED")
        self.assertEqual(jobs[0]["progress"], 100)
        self.assertIsNotNone(jobs[0]["cancel_requested_at"])
        self.assertIsNotNone(jobs[0]["completed_at"])
        self.assertEqual(self.workspace.get_export_job(jobs[0]["id"])["artifacts"], [])

    def test_active_export_for_same_document_is_rejected_before_render(self) -> None:
        active = self.workspace.create_export_job(
            document_id=self.document_id,
            request_id=str(uuid.uuid4()),
            formats=["docx"],
            output_directory=str(self.output),
            input_sha256="a" * 64,
            template_id="synthetic.template",
            template_version="1.0",
            template_sha256="b" * 64,
            snapshot={"document_revision": 1},
        )
        self.workspace.start_export_job(active["id"])
        with patch("sztu_docs_backend.exporter._run") as renderer:
            with self.assertRaises(ExportError) as caught:
                run_export(
                    self.workspace,
                    document_id=self.document_id,
                    output_directory=str(self.output),
                    formats=["docx"],
                    engine=self.engine,
                    request_id=str(uuid.uuid4()),
                )
        self.assertEqual(caught.exception.code, "EXPORT_ALREADY_RUNNING")
        renderer.assert_not_called()
        jobs = self.workspace.list_export_jobs(document_id=self.document_id)
        self.assertEqual([job["id"] for job in jobs], [active["id"]])
        self.assertEqual(jobs[0]["status"], "running")
        self.assertEqual(list(self.output.iterdir()), [])


class TemplateEngineInstallationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.source = self.root / "selected-source"
        self.source.mkdir()
        self.data_dir = self.root / "data"
        self.workspace = Workspace.open_persistent(self.data_dir)

    def tearDown(self) -> None:
        self.workspace.close()
        self.temporary_directory.cleanup()

    def create_source(
        self, payloads: dict[str, bytes], validator_payload: bytes
    ) -> tuple[dict[str, str], str]:
        hashes: dict[str, str] = {}
        for relative_name, payload in payloads.items():
            path = self.source / relative_name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
            hashes[relative_name] = hashlib.sha256(payload).hexdigest()
        validator = self.source / "scripts" / "validate_cjk_render.py"
        validator.parent.mkdir(parents=True, exist_ok=True)
        validator.write_bytes(validator_payload)
        return hashes, hashlib.sha256(validator_payload).hexdigest()

    def test_exact_engine_is_copied_locally_and_reinstall_is_idempotent(self) -> None:
        payloads = {
            "word/render.py": b"synthetic word renderer v1",
            "schema/proposal.schema.json": b'{"synthetic":true}',
        }
        hashes, validator_hash = self.create_source(
            payloads, b"synthetic cjk validator v1"
        )
        with patch.object(template_engine, "ENGINE_FILE_HASHES", hashes), patch.object(
            template_engine, "VALIDATOR_SHA256", validator_hash
        ):
            installed = install_engine(self.workspace, str(self.source))
            repeated = install_engine(self.workspace, str(self.source))

        destination = installed_engine_root(self.workspace.database.data_directory)
        self.assertEqual(installed["status"], "installed")
        self.assertEqual(repeated["status"], "already_installed")
        self.assertEqual(repeated["installed_at"], installed["installed_at"])
        for relative_name, payload in payloads.items():
            self.assertEqual((destination / relative_name).read_bytes(), payload)
        self.assertEqual(
            (destination / "scripts" / "validate_cjk_render.py").read_bytes(),
            b"synthetic cjk validator v1",
        )
        installations = self.workspace.list_template_installations(enabled_only=True)
        self.assertEqual(len(installations), 1)
        self.assertEqual(
            Path(installations[0]["install_path"]).resolve(), destination.resolve()
        )
        self.assertEqual(installations[0]["metadata"]["pack_sha256"], installed["pack_sha256"])

        original_installed = (destination / "word" / "render.py").read_bytes()
        (self.source / "word" / "render.py").write_bytes(b"drifted renderer")
        with patch.object(template_engine, "ENGINE_FILE_HASHES", hashes), patch.object(
            template_engine, "VALIDATOR_SHA256", validator_hash
        ):
            with self.assertRaises(TemplateEngineError) as caught:
                install_engine(self.workspace, str(self.source))
        self.assertEqual(caught.exception.code, "TEMPLATE_ENGINE_HASH_MISMATCH")
        self.assertEqual(
            (destination / "word" / "render.py").read_bytes(), original_installed
        )

    def test_conflicting_verified_install_does_not_overwrite_destination(self) -> None:
        self.create_source(
            {"word/render.py": b"selected source"}, b"selected validator"
        )
        destination = installed_engine_root(self.workspace.database.data_directory)
        destination.mkdir(parents=True)
        sentinel = destination / "sentinel.bin"
        sentinel.write_bytes(b"preserve-existing-install")
        validator = self.source / "scripts" / "validate_cjk_render.py"
        descriptors = [
            EngineDescriptor(
                root=self.source,
                validator=validator,
                pack_sha256="1" * 64,
                source="selected-local-source",
            ),
            EngineDescriptor(
                root=destination,
                validator=destination / "scripts" / "validate_cjk_render.py",
                pack_sha256="2" * 64,
                source="installed",
            ),
        ]
        with patch.object(template_engine, "verify_engine", side_effect=descriptors):
            with self.assertRaises(TemplateEngineError) as caught:
                install_engine(self.workspace, str(self.source))
        self.assertEqual(caught.exception.code, "TEMPLATE_INSTALL_CONFLICT")
        self.assertEqual(sentinel.read_bytes(), b"preserve-existing-install")
        self.assertEqual([path.name for path in destination.iterdir()], [sentinel.name])

    def test_intermediate_source_directory_symlink_is_rejected(self) -> None:
        outside = self.root / "outside"
        outside.mkdir()
        payload = b"synthetic renderer outside selection"
        (outside / "render.py").write_bytes(payload)
        (self.source / "word").symlink_to(outside, target_is_directory=True)
        validator = self.source / "scripts" / "validate_cjk_render.py"
        validator.parent.mkdir(parents=True)
        validator.write_bytes(b"synthetic validator")

        with patch.object(
            template_engine,
            "ENGINE_FILE_HASHES",
            {"word/render.py": hashlib.sha256(payload).hexdigest()},
        ), patch.object(
            template_engine,
            "VALIDATOR_SHA256",
            hashlib.sha256(validator.read_bytes()).hexdigest(),
        ):
            with self.assertRaises(TemplateEngineError) as caught:
                install_engine(self.workspace, str(self.source))

        self.assertEqual(caught.exception.code, "TEMPLATE_ENGINE_INVALID")
        self.assertFalse(installed_engine_root(self.data_dir).exists())


if __name__ == "__main__":
    unittest.main()
