import copy
import tempfile
import unittest
from pathlib import Path
from sztu_docs_backend.storage import Workspace, ValidationError, RevisionConflictError


def content():
    return {"metadata": {"title": "合成论文"}, "thesis": {
        "version": 1, "englishTitle": "Synthetic thesis", "abstractCn": [], "keywordsCn": "",
        "abstractEn": [], "keywordsEn": "", "referencesBibtex": "", "acknowledgements": [], "appendix": [],
        "chapters": [{"id": "chapter-a", "level": 1, "title": "绪论", "body": [{"runs": [{"text": "合成正文", "bold": True}]}]}],
    }}


class ThesisAuthoringTests(unittest.TestCase):
    def test_persist_reopen_copy_recycle_restore_and_conflicts(self):
        with tempfile.TemporaryDirectory() as tmp:
            with Workspace.open_persistent(Path(tmp)) as workspace:
                original = workspace.create_document({"document_type": "thesis", "template_version": "workbench-1", "schema_version": "0.1", "title": "合成毕业论文"})
                workspace.save_draft(original["id"], content(), 0)
                with self.assertRaises(RevisionConflictError):
                    workspace.save_draft(original["id"], content(), 0)
                copied = workspace.create_document({"document_type": "thesis", "template_version": "workbench-1", "schema_version": "0.1", "title": "合成副本", "source_document_id": original["id"]})
                self.assertEqual(copied["content"], content())
                workspace.rename_document(original["id"], "已重命名论文")
                workspace.delete_document(original["id"])
                self.assertEqual(len(workspace.list_deleted_documents()), 1)
                workspace.restore_document(original["id"])
            with Workspace.open_persistent(Path(tmp)) as workspace:
                restored = workspace.get_document(original["id"])
                self.assertEqual(restored["content"], content())
                self.assertEqual(restored["title"], "已重命名论文")

    def test_bad_draft_never_overwrites_last_valid_revision(self):
        with Workspace.create_temporary() as workspace:
            document = workspace.create_document({"document_type": "thesis", "template_version": "workbench-1", "schema_version": "0.1", "title": "合成论文"})
            workspace.save_draft(document["id"], content(), 0)
            invalid = []
            for change in [lambda d: d.update(version=2), lambda d: d["chapters"].append(copy.deepcopy(d["chapters"][0])), lambda d: d["chapters"][0].update(level=3), lambda d: d["chapters"][0].update(body=[{"type": "html", "html": "bad"}])]:
                data = content(); change(data["thesis"]); invalid.append(data)
            for data in invalid:
                with self.assertRaises(ValidationError):
                    workspace.save_draft(document["id"], data, 1)
                self.assertEqual(workspace.get_document(document["id"])["content"], content())

    def test_media_survives_reopen_and_invalid_media_preserves_revision(self):
        data = content()
        image = {"type": "image", "id": "fig-aaaaaaaa", "chapter": 1, "path": "assets/fixture.png", "alt": "合成图", "caption": "合成图"}
        group = {"type": "figure_group", "id": "fig-bbbbbbbb", "chapter": 1, "columns": 2, "caption": "组合图", "items": [{"path": "assets/a.png", "alt": "A"}, {"path": "assets/b.png", "alt": "B"}]}
        table = {"type": "data_table", "style": "three_line", "columns": [{"header": "项目"}, {"header": "结果"}], "rows": [{"cells": ["合成样本", "10"]}]}
        data["thesis"]["chapters"][0]["body"] = [image, group, table, "见{{fig:fig-aaaaaaaa}}"]
        with tempfile.TemporaryDirectory() as tmp:
            with Workspace.open_persistent(Path(tmp)) as workspace:
                doc = workspace.create_document({"document_type": "thesis", "template_version": "workbench-1", "schema_version": "0.1", "title": "图表合成论文"})
                workspace.save_draft(doc["id"], data, 0)
                for mutate in [lambda b: b[0].update(width_mm=900), lambda b: b[1].update(id="fig-aaaaaaaa"), lambda b: b[1].update(chapter=2), lambda b: b[2]["rows"][0].update(cells=["missing"]), lambda b: b[1].update(items=[])]:
                    invalid = copy.deepcopy(data)
                    mutate(invalid["thesis"]["chapters"][0]["body"])
                    with self.assertRaises(ValidationError):
                        workspace.save_draft(doc["id"], invalid, 1)
                    self.assertEqual(workspace.get_document(doc["id"])["content"], data)
            with Workspace.open_persistent(Path(tmp)) as workspace:
                self.assertEqual(workspace.get_document(doc["id"])["content"], data)

    def test_equations_and_dangling_references_are_recoverable_drafts(self):
        data = content()
        data["thesis"]["chapters"][0]["body"] = [{"type": "equation", "id": "eq-aaaaaaaa", "latex": r"E=mc^{2}"}, "见{{eq:eq-aaaaaaaa}}和{{cite:missing}}"]
        with Workspace.create_temporary() as workspace:
            doc = workspace.create_document({"document_type": "thesis", "template_version": "workbench-1", "schema_version": "0.1", "title": "公式样例"})
            workspace.save_draft(doc["id"], data, 0)
            self.assertEqual(workspace.get_document(doc["id"])["content"], data)
            for change in [lambda b: b.append(copy.deepcopy(b[0])), lambda b: b[0].update(latex=""), lambda b: b[0].update(id="bad")]:
                invalid = copy.deepcopy(data)
                change(invalid["thesis"]["chapters"][0]["body"])
                with self.assertRaises(ValidationError):
                    workspace.save_draft(doc["id"], invalid, 1)
                self.assertEqual(workspace.get_document(doc["id"])["content"], data)
