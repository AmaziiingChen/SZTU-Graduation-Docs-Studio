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
    _iter_content_image_paths,
    _output_filenames,
    _run,
    _stage_content_images,
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


class ExportFilenameTests(unittest.TestCase):
    def test_windows_device_names_are_portable_without_changing_normal_names(self) -> None:
        for title in ('CON', 'nul', 'COM1.notes'):
            with self.subTest(title=title):
                self.assertEqual(_output_filenames({'title': title}, ['pdf'])['pdf'], '_' + title + '.pdf')
        self.assertEqual(_output_filenames({'title': 'CON研究报告'}, ['pdf'])['pdf'], 'CON研究报告.pdf')

    def test_saved_document_names_are_not_given_another_type_suffix(self) -> None:
        labels = {
            "proposal": "开题报告",
            "midterm": "中期检查表",
            "task_book": "任务书",
            "thesis": "毕业论文",
            "advisor_review": "指导教师评审表",
            "reviewer_review": "评阅人评审表",
            "defense_record": "答辩记录表",
            "grade_assessment": "成绩考核表",
        }
        for document_type, label in labels.items():
            for title in (label, f"合成学生-{label}"):
                with self.subTest(document_type=document_type, title=title):
                    self.assertEqual(
                        _output_filenames(
                            {"document_type": document_type, "title": title},
                            ["docx", "pdf", "tex"],
                        ),
                        {
                            "docx": f"{title}.docx",
                            "pdf": f"{title}.pdf",
                            "tex": f"{title}-LaTeX.zip",
                        },
                    )

    def test_custom_title_is_preserved_and_conflicts_only_add_a_version(self) -> None:
        self.assertEqual(
            _output_filenames(
                {"document_type": "task_book", "title": "第二版修改稿"},
                ["docx", "pdf", "tex"],
                version=2,
            ),
            {
                "docx": "第二版修改稿-2.docx",
                "pdf": "第二版修改稿-2.pdf",
                "tex": "第二版修改稿-2-LaTeX.zip",
            },
        )


class ContentImageStagingTests(unittest.TestCase):
    def test_collects_paths_from_image_blocks_and_figure_groups(self) -> None:
        content = {
            "sections": {
                "basic": [
                    {"type": "paragraph", "runs": [{"text": "正文"}]},
                    {"type": "image", "path": "document-assets/first.png"},
                ],
                "extra": [
                    {
                        "type": "figure_group",
                        "items": [
                            {"path": "document-assets/second.png"},
                            {"path": "document-assets/third.png"},
                        ],
                    }
                ],
            }
        }

        self.assertEqual(
            sorted(_iter_content_image_paths(content)),
            [
                "document-assets/first.png",
                "document-assets/second.png",
                "document-assets/third.png",
            ],
        )

    def test_stages_relative_images_next_to_the_renderer_input(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            assets = root / "document-assets"
            assets.mkdir()
            (assets / "demo.png").write_bytes(b"png-bytes")
            work = root / "work"
            work.mkdir()
            content = {"sections": {"basic": [{"type": "image", "path": "document-assets/demo.png"}]}}

            _stage_content_images(content, assets_root=assets, work=work)

            staged = work / "document-assets" / "demo.png"
            self.assertTrue(staged.is_file())
            self.assertEqual(staged.read_bytes(), b"png-bytes")

    def test_reports_missing_managed_images_with_a_readable_error(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            assets = root / "document-assets"
            assets.mkdir()
            work = root / "work"
            work.mkdir()
            content = {"sections": {"basic": [{"type": "image", "path": "document-assets/missing.png"}]}}

            with self.assertRaises(ExportError) as raised:
                _stage_content_images(content, assets_root=assets, work=work)

            self.assertEqual(raised.exception.code, "IMAGE_ASSET_UNAVAILABLE")
            self.assertIn("图片文件找不到", raised.exception.message)

    def test_ignores_absolute_and_escaping_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            assets = root / "document-assets"
            assets.mkdir()
            absolute = root / "absolute.png"
            absolute.write_bytes(b"absolute")
            work = root / "work"
            work.mkdir()
            content = {
                "sections": {
                    "basic": [
                        {"type": "image", "path": str(absolute)},
                        {"type": "image", "path": "../../escape.png"},
                    ]
                }
            }

            _stage_content_images(content, assets_root=assets, work=work)

            self.assertFalse((work / "absolute.png").exists())
            self.assertFalse((work.parent / "escape.png").exists())


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
        diagnostic_stage: str | None = None,
    ) -> str:
        del cwd, timeout, cancellation_file, environment, diagnostic_stage
        if "--output" in command:
            output = Path(command[command.index("--output") + 1])
            output.write_bytes(b"synthetic-docx-render-v2")
        return "synthetic renderer completed"

    def test_preflight_uses_tree_title_and_allocates_one_shared_version(self) -> None:
        stem = self.proposal["metadata"]["title"]
        existing_pdf = self.output / f"{stem}.pdf"
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
            [f"{stem}-2.docx", f"{stem}-2.pdf", f"{stem}-2-LaTeX.zip"],
        )
        self.assertEqual(
            [target["exists"] for target in targets],
            [False, False, False],
        )
        self.assertNotIn("code", output_check)
        self.assertEqual(output_check["details"]["conflicting_formats"], [])
        self.assertEqual(output_check["details"]["allocated_version"], 2)
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
            [
                "中期检查表.docx",
                "中期检查表.pdf",
                "中期检查表-LaTeX.zip",
            ],
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
        # The host may not ship Poppler; PDF preflight only needs to know the
        # tools are resolvable, and that check belongs to its own test.
        with patch(
            "sztu_docs_backend.exporter.shutil.which",
            side_effect=lambda name, path=None: f"/usr/bin/{name}",
        ):
            pdf_and_tex = preflight_export(
                self.workspace,
                document_id=document["id"],
                output_directory=str(self.output),
                formats=["tex", "pdf"],
                engine=engine,
            )
        self.assertTrue(pdf_and_tex["ready"])

        with patch(
            "sztu_docs_backend.exporter.shutil.which",
            side_effect=lambda name, path=None: (
                None if name == "pdftoppm" else f"/usr/bin/{name}"
            ),
        ):
            unavailable = preflight_export(
                self.workspace,
                document_id=document["id"],
                output_directory=str(self.output),
                formats=["pdf"],
                engine=engine,
            )
        self.assertFalse(unavailable["ready"])
        self.assertIn(
            "ENVIRONMENT_PDF_TOOLS_MISSING", unavailable["blocking_codes"]
        )
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
        self.assertIn("模板文件不完整", caught.exception.message)

    def test_renderer_maps_missing_list_layout_snapshot(self) -> None:
        with self.assertRaises(ExportError) as caught:
            _run(
                [
                    sys.executable,
                    "-c",
                    (
                        "import sys; "
                        "sys.stderr.write(\"ModuleNotFoundError: No module named "
                        "'common.python.list_layout'\"); "
                        "sys.exit(1)"
                    ),
                ],
                cwd=self.root,
            )

        self.assertEqual(caught.exception.code, "TEMPLATE_ENGINE_INCOMPLETE")
        self.assertNotIn("字体", caught.exception.message)

    def test_unknown_renderer_failure_does_not_blame_fonts(self) -> None:
        with self.assertRaises(ExportError) as caught:
            _run(
                [
                    sys.executable,
                    "-c",
                    "import sys; sys.stderr.write('synthetic failure'); sys.exit(1)",
                ],
                cwd=self.root,
            )

        self.assertEqual(caught.exception.code, "RENDER_FAILED")
        self.assertNotIn("字体", caught.exception.message)

    def test_docx_inspection_preserves_specific_failure(self) -> None:
        from sztu_docs_backend.docx_inspector import DocxInspectionError
        failure = DocxInspectionError(
            "DOCX_STRUCTURE_MISMATCH", "任务书选题性质标签结构不完整。", {"field": "nature"}
        )
        with patch("sztu_docs_backend.exporter._run", side_effect=self.fake_render), patch(
            "sztu_docs_backend.docx_inspector.inspect_docx", side_effect=failure
        ):
            with self.assertRaises(ExportError) as caught:
                run_export(
                    self.workspace, document_id=self.document_id,
                    output_directory=str(self.output), formats=["docx"],
                    engine=self.engine, request_id=str(uuid.uuid4()),
                )
        self.assertEqual(caught.exception.code, failure.code)
        self.assertEqual(caught.exception.message, failure.message)
        self.assertEqual(caught.exception.details, failure.details)
        self.assertEqual(list(self.output.glob("*.docx")), [])

    def test_existing_target_allocates_next_version_without_overwriting(self) -> None:
        stem = self.proposal["metadata"]["title"]
        original_target = self.output / f"{stem}.docx"
        original_target.write_bytes(b"original-user-file")
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

        versioned_target = self.output / f"{stem}-2.docx"
        self.assertEqual(original_target.read_bytes(), b"original-user-file")
        self.assertEqual(versioned_target.read_bytes(), b"synthetic-docx-render-v2")
        self.assertEqual(receipt["status"], "succeeded")
        self.assertEqual(receipt["request_id"], request_id)
        self.assertEqual(
            Path(receipt["artifacts"][0]["path"]).resolve(), versioned_target.resolve()
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
        # 用户确认只记录在历史里；导出仍分配新版本，不覆盖原文件。
        self.assertTrue(stored["overwrite_confirmed"])
        self.assertFalse(stored["artifacts"][0]["replaced_existing"])
        self.assertEqual(stored["artifacts"][0]["relative_path"], versioned_target.name)

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
        self.assertEqual(original_target.read_bytes(), b"original-user-file")
        self.assertEqual(versioned_target.read_bytes(), b"synthetic-docx-render-v2")

    def test_preflight_sanitizes_tree_title_and_advances_past_multiple_versions(self) -> None:
        self.workspace.rename_document(self.document_id, " 方案/A:*? ")
        (self.output / "方案-A.docx").write_bytes(b"version-one")
        (self.output / "方案-A-2.docx").write_bytes(b"version-two")

        result = preflight_export(
            self.workspace,
            document_id=self.document_id,
            output_directory=str(self.output),
            formats=["docx"],
            engine=self.engine,
        )
        target = next(
            check for check in result["checks"] if check["check_id"] == "output-targets"
        )["details"]["targets"][0]

        self.assertEqual(target["filename"], "方案-A-3.docx")
        self.assertFalse(target["exists"])

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

    def test_packaged_engine_is_verified_and_resolved_without_a_development_checkout(self) -> None:
        bundled_root = self.root / "bundled-engines"
        bundled = bundled_root / "proposal"
        renderer = bundled / "word" / "render.py"
        renderer.parent.mkdir(parents=True)
        renderer.write_bytes(b"bundled proposal renderer")
        validator = bundled / "scripts" / "validate_cjk_render.py"
        validator.parent.mkdir(parents=True)
        validator.write_bytes(b"bundled validator")
        hashes = {
            "word/render.py": hashlib.sha256(renderer.read_bytes()).hexdigest()
        }
        with patch.object(template_engine, "ENGINE_FILE_HASHES", hashes):
            source = template_engine._workspace_source(bundled, "proposal")
            pack_sha256 = template_engine._workspace_pack_sha256(source)
            template_id, version = template_engine._workspace_identity(
                "proposal", pack_sha256
            )
            (bundled_root / "bundle-manifest.json").write_text(
                json.dumps(
                    {
                        "schema_version": "1.0",
                        "redistribution": "local-preview-only",
                        "engines": {
                            "proposal": {
                                "template_id": template_id,
                                "version": version,
                                "pack_sha256": pack_sha256,
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )
            with patch.dict(
                os.environ,
                {
                    "SZTU_DOCS_DATA_DIR": str(self.data_dir),
                    "SZTU_DOCS_BUNDLED_ENGINES_DIR": str(bundled_root),
                },
                clear=False,
            ):
                resolved = template_engine.resolve_engine("proposal")

        self.assertEqual(resolved.source, "bundled")
        self.assertEqual(resolved.pack_sha256, pack_sha256)
        self.assertEqual(resolved.root, bundled.resolve())

    def test_packaged_engine_rejects_content_drift(self) -> None:
        bundled_root = self.root / "bundled-engines"
        bundled = bundled_root / "proposal"
        renderer = bundled / "word" / "render.py"
        renderer.parent.mkdir(parents=True)
        renderer.write_bytes(b"bundled proposal renderer")
        validator = bundled / "scripts" / "validate_cjk_render.py"
        validator.parent.mkdir(parents=True)
        validator.write_bytes(b"bundled validator")
        hashes = {
            "word/render.py": hashlib.sha256(renderer.read_bytes()).hexdigest()
        }
        with patch.object(template_engine, "ENGINE_FILE_HASHES", hashes):
            source = template_engine._workspace_source(bundled, "proposal")
            pack_sha256 = template_engine._workspace_pack_sha256(source)
            template_id, version = template_engine._workspace_identity(
                "proposal", pack_sha256
            )
            (bundled_root / "bundle-manifest.json").write_text(
                json.dumps(
                    {
                        "schema_version": "1.0",
                        "redistribution": "local-preview-only",
                        "engines": {
                            "proposal": {
                                "template_id": template_id,
                                "version": version,
                                "pack_sha256": pack_sha256,
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )
            renderer.write_bytes(b"tampered renderer")
            with patch.dict(
                os.environ,
                {
                    "SZTU_DOCS_DATA_DIR": str(self.data_dir),
                    "SZTU_DOCS_BUNDLED_ENGINES_DIR": str(bundled_root),
                },
                clear=False,
            ), self.assertRaises(TemplateEngineError) as caught:
                template_engine.resolve_engine("proposal")

        self.assertEqual(caught.exception.code, "TEMPLATE_BUNDLE_HASH_MISMATCH")

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
        self.assertEqual(verified.version, "0.2+66c968c")
        self.assertEqual(caught.exception.code, "TEMPLATE_ENGINE_HASH_MISMATCH")

    def test_midterm_workspace_uses_the_same_content_addressed_link_flow(self) -> None:
        payloads = {
            "templates/common/python/content.py": b"synthetic shared content",
            "templates/common/python/outline_numbering.py": b"synthetic outline numbering",
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
        self.assertTrue(linked["version"].startswith("0.3+workspace."))
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
        self.assertTrue(linked["version"].startswith("0.2+workspace."))
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
        try:
            (self.source / "word").symlink_to(outside, target_is_directory=True)
        except OSError as exc:
            if getattr(exc, "winerror", None) == 1314:
                self.skipTest("Windows user lacks symbolic-link creation privilege")
            raise
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
