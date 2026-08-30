from __future__ import annotations

import hashlib
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from sztu_docs_backend.exporter import (
    ExportError,
    canonical_json,
    resolve_engine,
    run_export,
    validate_midterm,
    validate_proposal,
)
from sztu_docs_backend.storage import Workspace


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
FIXTURE = (
    REPOSITORY_ROOT
    / "template-packs"
    / "sztu-proposal-2026-dev"
    / "fixtures"
    / "normal.json"
)


def proposal_fixture() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


class ProposalContractTests(unittest.TestCase):
    def test_valid_proposal_has_stable_canonical_json(self) -> None:
        proposal = proposal_fixture()
        self.assertIs(validate_proposal(proposal), proposal)
        self.assertEqual(canonical_json(proposal), canonical_json(proposal))
        self.assertEqual(
            hashlib.sha256(canonical_json(proposal)).hexdigest(),
            "a2d7e1fae335e5562f01ea79a903000a31c02802d275f2ee6b7da12452727173",
        )

    def test_significance_requires_two_paragraphs(self) -> None:
        proposal = proposal_fixture()
        proposal["sections"]["significance_and_status"] = ["只有一段"]
        with self.assertRaises(ExportError) as context:
            validate_proposal(proposal)
        self.assertEqual(context.exception.code, "DOCUMENT_NOT_READY")
        self.assertEqual(
            context.exception.details["field"],
            "sections.significance_and_status",
        )

    def test_advisor_title_is_rejected_without_echoing_content(self) -> None:
        proposal = proposal_fixture()
        proposal["metadata"]["advisor"] = "测试教师教授"
        with self.assertRaises(ExportError) as context:
            validate_proposal(proposal)
        self.assertEqual(context.exception.details["field"], "metadata.advisor")
        self.assertNotIn("测试教师", str(context.exception.details))


def midterm_fixture() -> dict:
    return {
        "schema_version": "0.1",
        "metadata": {
            "student_name": "测试同学",
            "college": "测试学院",
            "major": "测试专业",
            "class_name": "测试一班",
            "advisor": "示例教师",
            "check_date": "2026-03-26",
            "title": {"type": "paragraph", "runs": [{"text": "虚构中期检查课题"}]},
        },
        "sections": {
            "directory": [
                {"level": 1, "number": "1", "title": "绪论"},
                {"level": 2, "number": "1.1", "title": "研究背景"},
            ],
            "main_research_content": [
                {"type": "paragraph", "runs": [{"text": "研究虚构问题。"}]},
            ],
            "progress": [
                {
                    "type": "ordered_list",
                    "items": [{"marker": "（1）", "content": "已完成合成验证。"}],
                }
            ],
        },
    }


class MidtermContractTests(unittest.TestCase):
    def test_valid_midterm_accepts_directory_rich_text_and_ordered_lists(self) -> None:
        midterm = midterm_fixture()
        self.assertIs(validate_midterm(midterm), midterm)

    def test_directory_cannot_skip_an_outline_level(self) -> None:
        midterm = midterm_fixture()
        midterm["sections"]["directory"][1]["level"] = 3
        with self.assertRaises(ExportError) as context:
            validate_midterm(midterm)
        self.assertEqual(
            context.exception.details["field"],
            "sections.directory[1].level",
        )

    def test_teacher_fields_are_not_part_of_student_input(self) -> None:
        midterm = midterm_fixture()
        midterm["sections"]["teacher_opinion"] = "不应由学生端填写"
        with self.assertRaises(ExportError) as context:
            validate_midterm(midterm)
        self.assertEqual(context.exception.details["field"], "sections")


class ProposalExportIntegrationTests(unittest.TestCase):
    @unittest.skipUnless(
        importlib.util.find_spec("docx") is not None
        and importlib.util.find_spec("PIL") is not None
        and shutil.which("xelatex")
        and shutil.which("pdfinfo")
        and shutil.which("pdffonts"),
        "local document rendering dependencies are unavailable",
    )
    def test_real_engine_exports_docx_and_pdf_with_receipt(self) -> None:
        try:
            resolve_engine()
        except ExportError as exc:
            self.skipTest(exc.code)

        proposal = proposal_fixture()
        with tempfile.TemporaryDirectory(prefix="sztu-export-test-") as root:
            root_path = Path(root)
            output = root_path / "output"
            output.mkdir()
            workspace = Workspace.open_persistent(root_path / "data")
            try:
                profile = workspace.save_profile(
                    {
                        "full_name": proposal["metadata"]["student_name"],
                        "student_number": proposal["metadata"]["student_id"],
                        "college": proposal["metadata"]["college"],
                        "major": proposal["metadata"]["major"],
                        "advisor_name": proposal["metadata"]["advisor"],
                    }
                )
                document = workspace.create_document(
                    {
                        "profile_id": profile["id"],
                        "document_type": "proposal",
                        "template_version": "0.2+a0799ee",
                        "schema_version": "0.2",
                        "title": proposal["metadata"]["title"],
                    }
                )
                workspace.save_draft(
                    document["id"],
                    {
                        "metadata": proposal["metadata"],
                        "sections": proposal["sections"],
                    },
                    0,
                    reason="manual",
                )

                receipt = run_export(
                    workspace,
                    document_id=document["id"],
                    output_directory=str(output),
                    formats=["docx", "pdf"],
                )
                self.assertEqual(receipt["status"], "succeeded")
                self.assertEqual(
                    [item["format"] for item in receipt["artifacts"]],
                    ["docx", "pdf"],
                )
                self.assertTrue(all(Path(item["path"]).is_file() for item in receipt["artifacts"]))
                self.assertEqual(
                    next(
                        check
                        for check in receipt["checks"]
                        if check["gate"] == "cjk_glyph"
                    )["status"],
                    "pass",
                )
                serialized = json.dumps(receipt, ensure_ascii=False)
                self.assertNotIn(proposal["metadata"]["student_name"], serialized)
                self.assertNotIn(proposal["metadata"]["student_id"], serialized)
                job = workspace.database.connection.execute(
                    "SELECT status, progress FROM export_jobs"
                ).fetchone()
                self.assertEqual(dict(job), {"status": "completed", "progress": 100})
                artifact_rows = workspace.database.connection.execute(
                    "SELECT format, checks_json FROM export_artifacts ORDER BY format"
                ).fetchall()
                artifact_checks = {
                    row["format"]: {
                        check["check_id"]
                        for check in json.loads(row["checks_json"])
                    }
                    for row in artifact_rows
                }
                self.assertEqual(
                    artifact_checks["docx"],
                    {"docx-structure", "full-page-layout", "target-editor"},
                )
                self.assertEqual(
                    artifact_checks["pdf"],
                    {"pdf-structure", "pdf-cjk-glyph", "full-page-layout"},
                )
            finally:
                workspace.close()


if __name__ == "__main__":
    unittest.main()
