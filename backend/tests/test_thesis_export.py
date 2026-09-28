"""Thesis export readiness stays separate from editable draft validity."""
import tempfile
import unittest
from pathlib import Path

from sztu_docs_backend.exporter import ExportError, build_export_document, validate_document
from sztu_docs_backend.storage import Workspace


def thesis_content():
    return {
        "metadata": {"title": "合成论文"},
        "thesis": {
            "version": 1, "englishTitle": "Synthetic Thesis", "submissionDate": "2026-05-01", "abstractCn": ["合成摘要"], "keywordsCn": "测试",
            "abstractEn": ["Synthetic abstract"], "keywordsEn": "test",
            "chapters": [{"id": "chapter-a", "level": 1, "title": "绪论", "body": ["合成正文"]}],
            "referencesBibtex": "@article{sample,author={Test, Alice},title={Sample},journal={Synthetic Journal},year={2026}}",
            "acknowledgements": [], "appendix": [],
        },
    }


class ThesisExportTests(unittest.TestCase):
    def test_profile_is_merged_and_incomplete_draft_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            with Workspace.open_persistent(Path(temp)) as workspace:
                profile = workspace.save_profile({
                    "full_name": "测试同学", "student_number": "00000001", "college": "合成学院",
                    "major": "测试专业", "advisor_name": "测试导师", "advisor_title": "教授",
                    "thesis_title": ["合成论文"], "thesis_title_en": "Profile English Title",
                })
                doc = workspace.create_document({
                    "profile_id": profile["id"], "document_type": "thesis", "template_version": "workbench-1",
                    "schema_version": "0.1", "title": "合成论文",
                })
                draft = thesis_content()
                workspace.save_draft(doc["id"], draft, 0)
                merged = build_export_document(workspace, workspace.get_document(doc["id"]))
                self.assertEqual(merged["metadata"]["student_id"], "00000001")
                self.assertEqual(merged["metadata"]["advisor_title"], "教授")
                self.assertEqual(merged["thesis"]["englishTitle"], "Profile English Title")
                self.assertEqual(workspace.get_document(doc["id"])["content"]["thesis"]["englishTitle"], "Synthetic Thesis")
                validate_document("thesis", merged)
                workspace.save_profile({
                    "id": profile["id"], "full_name": "测试同学", "student_number": "00000001",
                    "college": "合成学院", "major": "测试专业", "advisor_name": "测试导师",
                    "thesis_title_en": "",
                })
                cleared = build_export_document(workspace, workspace.get_document(doc["id"]))
                self.assertEqual(cleared["thesis"]["englishTitle"], "")
                with self.assertRaises(ExportError):
                    validate_document("thesis", cleared)
                workspace.save_profile({
                    "id": profile["id"], "full_name": "测试同学", "student_number": "00000001",
                    "college": "合成学院", "major": "测试专业", "advisor_name": "测试导师",
                    "thesis_title_en": None,
                })
                legacy = build_export_document(workspace, workspace.get_document(doc["id"]))
                self.assertEqual(legacy["thesis"]["englishTitle"], "Synthetic Thesis")
                merged["thesis"]["submissionDate"] = "2026-02-30"
                with self.assertRaises(ExportError):
                    validate_document("thesis", merged)
                merged["thesis"]["submissionDate"] = "2026-05-01"
                merged["thesis"]["abstractCn"] = []
                with self.assertRaises(ExportError):
                    validate_document("thesis", merged)


if __name__ == "__main__":
    unittest.main()
