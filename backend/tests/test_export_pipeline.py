from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from sztu_docs_backend import template_engine
from sztu_docs_backend.exporter import (
    ExportError,
    _run,
    build_export_document,
    delete_export_history_record,
    list_export_history,
    preflight_export,
    run_export,
)
from sztu_docs_backend.storage import Workspace
from sztu_docs_backend.template_engine import (
    EngineDescriptor,
    TemplateEngineError,
    install_engine,
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
                "advisor_title": "副教授",
                "graduation_cohort": "2026届",
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
        environment: dict[str, str] | None = None,
    ) -> str:
        del cwd, timeout, cancellation_file, environment
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
                "advisor_title": "教授",
                "graduation_cohort": "2027届",
                "thesis_title": [
                    {"runs": [{"text": "统一", "bold": True}, {"text": "论文题目"}]}
                ],
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
                "title": {
                    "runs": [
                        {"text": "统一", "bold": True},
                        {"text": "论文题目"},
                    ]
                },
            },
        )

    def test_export_input_discards_empty_editor_paragraphs_without_mutating_draft(self) -> None:
        record = self.workspace.get_document(self.document_id)
        original_sections = record["content"]["sections"]
        for section_name in (
            "significance_and_status",
            "research_content",
            "methods_and_means",
            "research_steps",
            "references",
        ):
            original_sections[section_name].extend(
                ["", "   ", {"type": "paragraph", "runs": []}]
            )

        merged = build_export_document(self.workspace, record)

        for section_name in (
            "significance_and_status",
            "research_content",
            "methods_and_means",
            "research_steps",
            "references",
        ):
            self.assertEqual(
                merged["sections"][section_name],
                self.proposal["sections"][section_name],
            )
            self.assertEqual(
                len(original_sections[section_name]),
                len(merged["sections"][section_name]) + 3,
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

    def test_task_book_uses_shared_cohort_and_complete_export_pipeline(self) -> None:
        task_book = {
            "schema_version": "0.1",
            "metadata": {
                "graduation_year": 2025,
                "title": "虚构任务书课题",
                "student_name": "旧姓名",
                "student_id": "OLD-ID",
                "college": "旧学院",
                "major": "旧专业",
                "class_name": "旧班级",
                "advisor": "旧教师",
            },
            "sections": {
                "basic_content_and_requirements": ["完成虚构课题的设计与验证。"],
                "schedule": [{"period": "第1—16周", "content": "完成全部工作。"}],
                "required_materials": [],
                "references": ["[1] 虚构参考文献。"],
                "topic_information": {
                    "nature": "graduation_design",
                    "source": {"type": "practice_project"},
                },
            },
        }
        profile = self.workspace.save_profile(
            {
                "full_name": "统一档案姓名",
                "student_number": "TASK-PROFILE-2027",
                "college": "统一档案学院",
                "major": "统一档案专业",
                "class_name": "新能源一班",
                "advisor_name": "统一档案教师",
                "advisor_title": "副教授",
                "graduation_cohort": "2027届",
            }
        )
        document = self.workspace.create_document(
            {
                "profile_id": profile["id"],
                "document_type": "task_book",
                "template_version": "0.1+46b6d97",
                "schema_version": "0.1",
                "title": "任务书",
            }
        )
        self.workspace.save_draft(
            document["id"],
            {"metadata": task_book["metadata"], "sections": task_book["sections"]},
            0,
            reason="manual",
        )
        engine_root = self.root / "synthetic-task-book-engine"
        write_task_book_layout(engine_root)
        font_directory = self.root / "synthetic-task-book-fonts"
        font_directory.mkdir()
        checkbox_font = font_directory / "Wingdng2.ttf"
        checkbox_font.write_bytes(b"synthetic licensed-font placeholder")
        engine = EngineDescriptor(
            root=engine_root,
            validator=self.root / "synthetic-validator.py",
            pack_sha256="a" * 64,
            source="synthetic",
            document_type="task_book",
            template_id="sztu.task-book.synthetic",
            version="0.1-test",
            font_directories=(font_directory,),
        )

        merged = build_export_document(
            self.workspace, self.workspace.get_document(document["id"])
        )
        self.assertEqual(
            merged["metadata"],
            {
                **task_book["metadata"],
                "graduation_year": 2027,
                "student_name": "统一档案姓名",
                "student_id": "TASK-PROFILE-2027",
                "college": "统一档案学院",
                "major": "统一档案专业",
                "class_name": "新能源一班",
                "advisor": "统一档案教师",
            },
        )
        with patch(
            "sztu_docs_backend.exporter._task_book_font_roots",
            return_value=[font_directory],
        ):
            preflight = preflight_export(
                self.workspace,
                document_id=document["id"],
                output_directory=str(self.output),
                formats=["tex", "docx", "pdf"],
                engine=engine,
            )
        targets = next(
            check
            for check in preflight["checks"]
            if check["check_id"] == "output-targets"
        )["details"]["targets"]
        self.assertEqual(
            [target["filename"] for target in targets],
            ["任务书.docx", "任务书.pdf", "任务书-LaTeX.zip"],
        )

        with patch(
            "sztu_docs_backend.exporter._run", side_effect=self.fake_render
        ), patch(
            "sztu_docs_backend.docx_inspector.inspect_docx",
            return_value=deep_docx_check(),
        ), patch(
            "sztu_docs_backend.exporter._task_book_font_roots",
            return_value=[font_directory],
        ):
            receipt = run_export(
                self.workspace,
                document_id=document["id"],
                output_directory=str(self.output),
                formats=["docx"],
                engine=engine,
                request_id=str(uuid.uuid4()),
            )
        stored = self.workspace.get_export_job(receipt["export_id"])
        self.assertEqual(stored["snapshot"]["task_book"], merged)
        self.assertEqual(
            stored["snapshot"]["student_profile"],
            {
                "advisor_title": "副教授",
                "graduation_cohort": "2027届",
                "thesis_title": None,
            },
        )

        checkbox_font.unlink()
        with patch(
            "sztu_docs_backend.exporter._task_book_font_roots",
            return_value=[font_directory],
        ), self.assertRaises(ExportError) as missing_font:
            preflight_export(
                self.workspace,
                document_id=document["id"],
                output_directory=str(self.output),
                formats=["docx"],
                engine=engine,
            )
        self.assertEqual(missing_font.exception.code, "REQUIRED_FONT_MISSING")
        self.assertEqual(missing_font.exception.details["format"], "docx")
        self.assertIn("Wingdings 2", missing_font.exception.message)
        pdf_and_tex = preflight_export(
            self.workspace,
            document_id=document["id"],
            output_directory=str(self.output),
            formats=["tex", "pdf"],
            engine=engine,
        )
        self.assertTrue(pdf_and_tex["ready"])
        self.assertEqual(pdf_and_tex["formats"], ["pdf", "tex"])

        long_content = json.loads(
            json.dumps(
                {"metadata": task_book["metadata"], "sections": task_book["sections"]},
                ensure_ascii=False,
            )
        )
        long_content["metadata"]["title"] = "任" * 46
        current = self.workspace.get_document(document["id"])
        self.workspace.save_draft(
            document["id"],
            long_content,
            current["current_revision"],
            reason="manual",
        )
        with self.assertRaises(ExportError) as caught:
            preflight_export(
                self.workspace,
                document_id=document["id"],
                output_directory=str(self.output),
                formats=["pdf"],
                engine=engine,
            )
        self.assertEqual(caught.exception.code, "DOCUMENT_NOT_READY")
        self.assertEqual(caught.exception.details["field"], "metadata.title")
        self.assertEqual(
            caught.exception.details["reason"], "template_capacity_exceeded"
        )
        self.assertEqual(caught.exception.details["maximum_lines"], 2)
        self.assertAlmostEqual(
            caught.exception.details["line_capacity_units"], 22.677, places=3
        )

    def test_renderer_maps_task_book_checkbox_font_diagnostic(self) -> None:
        with self.assertRaises(ExportError) as caught:
            _run(
                [
                    sys.executable,
                    "-c",
                    (
                        "import sys; "
                        "sys.stderr.write('required checkbox font is missing'); "
                        "sys.exit(1)"
                    ),
                ],
                cwd=self.root,
            )

        self.assertEqual(caught.exception.code, "REQUIRED_FONT_MISSING")
        self.assertIn("Wingdings 2", caught.exception.message)

    def test_renderer_maps_incomplete_process_form_snapshot(self) -> None:
        with self.assertRaises(ExportError) as caught:
            _run(
                [
                    sys.executable,
                    "-c",
                    (
                        "import sys; "
                        "sys.stderr.write(\"ModuleNotFoundError: No module named "
                        "'common.python.process_form'\"); "
                        "sys.exit(1)"
                    ),
                ],
                cwd=self.root,
            )

        self.assertEqual(caught.exception.code, "TEMPLATE_ENGINE_INCOMPLETE")
        self.assertIn("模板快照", caught.exception.message)

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
        self.assertEqual(
            stored["snapshot"]["student_profile"],
            {
                "advisor_title": "副教授",
                "graduation_cohort": "2026届",
                "thesis_title": None,
            },
        )
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

        deleted = delete_export_history_record(
            self.workspace,
            document_id=self.document_id,
            export_id=receipt["export_id"],
        )
        self.assertEqual(deleted, {"export_id": receipt["export_id"], "deleted": True})
        self.assertEqual(
            list_export_history(
                self.workspace, document_id=self.document_id, limit=10
            )["history"],
            [],
        )
        self.assertEqual(target.read_bytes(), b"synthetic-docx-render-v2")

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

    def test_linked_workspace_is_snapshotted_and_resynced_after_source_change(self) -> None:
        payloads = {
            "word/render.py": b"synthetic word renderer v1",
            "schema/proposal.schema.json": b'{"synthetic":true}',
        }
        hashes, _validator_hash = self.create_source(
            payloads, b"synthetic cjk validator v1"
        )
        with patch.object(template_engine, "ENGINE_FILE_HASHES", hashes):
            linked = install_engine(self.workspace, str(self.source))
            repeated = install_engine(self.workspace, str(self.source))

        first_installation = self.workspace.list_template_installations(
            enabled_only=True
        )[0]
        first_destination = Path(first_installation["install_path"])
        self.assertEqual(linked["status"], "linked")
        self.assertEqual(repeated["status"], "already_current")
        self.assertEqual(repeated["installed_at"], linked["installed_at"])
        self.assertEqual(linked["source"], "linked-workspace")
        for relative_name, payload in payloads.items():
            self.assertEqual((first_destination / relative_name).read_bytes(), payload)
        self.assertEqual(
            (first_destination / "scripts" / "validate_cjk_render.py").read_bytes(),
            b"synthetic cjk validator v1",
        )
        original_snapshot = (first_destination / "word" / "render.py").read_bytes()
        (self.source / "word" / "render.py").write_bytes(b"drifted renderer")
        with patch.object(template_engine, "ENGINE_FILE_HASHES", hashes):
            updated = install_engine(self.workspace, str(self.source))
            with patch.dict(
                os.environ,
                {"SZTU_DOCS_DATA_DIR": str(self.data_dir)},
                clear=False,
            ):
                resolved = template_engine.resolve_engine("proposal")

        self.assertEqual(updated["status"], "updated")
        self.assertNotEqual(updated["pack_sha256"], linked["pack_sha256"])
        self.assertEqual(resolved.pack_sha256, updated["pack_sha256"])
        self.assertEqual(resolved.source, "linked-workspace")
        self.assertEqual(
            (resolved.root / "word" / "render.py").read_bytes(),
            b"drifted renderer",
        )
        self.assertEqual(
            (first_destination / "word" / "render.py").read_bytes(), original_snapshot
        )
        self.assertEqual(
            len(self.workspace.list_template_installations(enabled_only=True)), 1
        )

    def test_immutable_committed_engine_still_rejects_hash_drift(self) -> None:
        payloads = {"word/render.py": b"committed renderer"}
        hashes, validator_hash = self.create_source(
            payloads, b"committed validator"
        )
        validator = self.source / "scripts" / "validate_cjk_render.py"
        with patch.object(template_engine, "ENGINE_FILE_HASHES", hashes), patch.object(
            template_engine, "VALIDATOR_SHA256", validator_hash
        ):
            verified = template_engine.verify_engine(
                self.source, validator=validator, source="committed"
            )
            (self.source / "word" / "render.py").write_bytes(b"drifted renderer")
            with self.assertRaises(TemplateEngineError) as caught:
                template_engine.verify_engine(
                    self.source, validator=validator, source="committed"
                )
        self.assertEqual(verified.source, "committed")
        self.assertEqual(caught.exception.code, "TEMPLATE_ENGINE_HASH_MISMATCH")

    def test_immutable_submitted_task_book_engine_rejects_hash_drift(self) -> None:
        relative_name = "templates/task-book/word/render.py"
        payload = b"submitted task-book renderer"
        candidate = self.source / relative_name
        candidate.parent.mkdir(parents=True, exist_ok=True)
        candidate.write_bytes(payload)
        validator = self.source / "scripts" / "validate_cjk_render.py"
        validator.parent.mkdir(parents=True, exist_ok=True)
        validator.write_bytes(b"submitted task-book validator")
        with patch.object(
            template_engine,
            "TASK_BOOK_ENGINE_FILE_HASHES",
            {relative_name: hashlib.sha256(payload).hexdigest()},
        ), patch.object(
            template_engine,
            "VALIDATOR_SHA256",
            hashlib.sha256(validator.read_bytes()).hexdigest(),
        ):
            verified = template_engine.verify_task_book_engine(
                self.source, validator=validator.resolve(), source="submitted"
            )
            candidate.write_bytes(b"drifted task-book renderer")
            with self.assertRaises(TemplateEngineError) as caught:
                template_engine.verify_task_book_engine(
                    self.source, validator=validator.resolve(), source="submitted"
                )
        self.assertEqual(verified.document_type, "task_book")
        self.assertEqual(verified.version, "0.1+46b6d97")
        self.assertEqual(caught.exception.code, "TEMPLATE_ENGINE_HASH_MISMATCH")

    def test_midterm_workspace_uses_the_same_content_addressed_link_flow(self) -> None:
        payloads = {
            "templates/common/python/content.py": b"synthetic shared content",
            "templates/midterm/word/render.py": b"synthetic midterm renderer",
        }
        for relative_name, payload in payloads.items():
            path = self.source / relative_name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
        validator = self.source / "scripts" / "validate_cjk_render.py"
        validator.parent.mkdir(parents=True, exist_ok=True)
        validator.write_bytes(b"synthetic validator")
        local_fonts = self.source / "templates" / "midterm" / "fonts.local"
        local_fonts.mkdir()
        (local_fonts / "licensed-test-font.ttf").write_bytes(b"local-only font")

        with patch.object(
            template_engine,
            "MIDTERM_ENGINE_FILE_HASHES",
            {name: hashlib.sha256(payload).hexdigest() for name, payload in payloads.items()},
        ):
            linked = install_engine(self.workspace, str(self.source), "midterm")
            repeated = install_engine(self.workspace, str(self.source), "midterm")
            with patch.dict(
                os.environ,
                {"SZTU_DOCS_DATA_DIR": str(self.data_dir)},
                clear=False,
            ):
                resolved = template_engine.resolve_engine("midterm")

        self.assertEqual(linked["status"], "linked")
        self.assertEqual(repeated["status"], "already_current")
        self.assertTrue(linked["version"].startswith("0.1+workspace."))
        installation = self.workspace.list_template_installations(enabled_only=True)[0]
        engine_root = Path(installation["install_path"])
        self.assertEqual(
            (engine_root / "word" / "render.py").read_bytes(),
            b"synthetic midterm renderer",
        )
        self.assertEqual(resolved.font_directories, (local_fonts.resolve(),))
        self.assertFalse((engine_root / "fonts.local").exists())

    def test_task_book_workspace_is_snapshotted_with_shared_runtime_files(self) -> None:
        payloads = {
            "templates/common/latex/sztu-process-form.tex": b"synthetic shared latex support",
            "templates/common/python/content.py": b"synthetic shared task content",
            "templates/common/python/process_form.py": b"synthetic shared process form",
            "templates/common/typography/font-policy-2026.json": b"{}",
            "templates/task-book/python/model.py": b"synthetic task model",
            "templates/task-book/word/render.py": b"synthetic task word renderer",
            "templates/task-book/latex/render.py": b"synthetic task latex renderer",
        }
        for relative_name, payload in payloads.items():
            candidate = self.source / relative_name
            candidate.parent.mkdir(parents=True, exist_ok=True)
            candidate.write_bytes(payload)
        validator = self.source / "scripts" / "validate_cjk_render.py"
        validator.parent.mkdir(parents=True, exist_ok=True)
        validator.write_bytes(b"synthetic task validator")

        with patch.object(
            template_engine,
            "TASK_BOOK_ENGINE_FILE_HASHES",
            {
                name: hashlib.sha256(payload).hexdigest()
                for name, payload in payloads.items()
            },
        ):
            linked = install_engine(self.workspace, str(self.source), "task_book")
            with patch.dict(
                os.environ,
                {"SZTU_DOCS_DATA_DIR": str(self.data_dir)},
                clear=False,
            ):
                resolved = template_engine.resolve_engine("task_book")

        self.assertEqual(linked["status"], "linked")
        self.assertTrue(linked["version"].startswith("0.1+workspace."))
        self.assertEqual(
            (
                resolved.root.parents[1]
                / "templates/common/python/process_form.py"
            ).read_bytes(),
            b"synthetic shared process form",
        )
        self.assertEqual(
            (
                resolved.root.parents[1]
                / "templates/common/latex/sztu-process-form.tex"
            ).read_bytes(),
            b"synthetic shared latex support",
        )
        self.assertEqual(resolved.document_type, "task_book")
        self.assertEqual(resolved.template_id, "sztu.task-book.2026.local")
        self.assertEqual(
            (resolved.root / "python/model.py").read_bytes(),
            b"synthetic task model",
        )
        self.assertEqual(
            (resolved.root.parent / "common/python/content.py").read_bytes(),
            b"synthetic shared task content",
        )

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

        self.assertEqual(caught.exception.code, "TEMPLATE_SOURCE_INVALID")
        self.assertFalse(
            (self.data_dir / "template-engines" / "workspace-links.json").exists()
        )


if __name__ == "__main__":
    unittest.main()
