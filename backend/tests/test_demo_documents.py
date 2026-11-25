from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

from sztu_docs_backend.demo_documents import (
    DEMO_PREFIX,
    demo_document_types,
    install_demo_documents,
    remove_demo_documents,
)
from sztu_docs_backend.exporter import build_export_document, validate_document
from sztu_docs_backend.storage import Workspace


class DemoDocumentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.directory.name) / "app-data"
        self.workspace = Workspace.open_persistent(self.data_dir)

    def tearDown(self) -> None:
        self.workspace.close()
        self.directory.cleanup()

    def test_install_creates_valid_documents_and_a_demo_profile(self) -> None:
        result = install_demo_documents(self.workspace)
        self.assertEqual(result["installed"], list(demo_document_types()))
        self.assertEqual(result["skipped"], [])
        profile = self.workspace.list_profiles()[0]
        self.assertEqual(profile["full_name"], "程光铭")
        self.assertEqual(profile["student_number"], "202300307418")
        documents = self.workspace.list_documents()
        self.assertEqual({item["document_type"] for item in documents}, set(demo_document_types()))
        for record in documents:
            self.assertTrue(record["title"].startswith(DEMO_PREFIX))
            document = self.workspace.get_document(record["id"])
            validate_document(record["document_type"], build_export_document(self.workspace, document))
        active = self.workspace.load_active()
        self.assertEqual(active["document"]["document_type"], demo_document_types()[0])
        assets = list((self.data_dir / "document-assets").glob("*.png"))
        self.assertTrue(assets)
        for asset in assets:
            self.assertEqual(asset.stem, hashlib.sha256(asset.read_bytes()).hexdigest())

    def test_second_install_skips_existing_documents(self) -> None:
        install_demo_documents(self.workspace)
        again = install_demo_documents(self.workspace)
        self.assertEqual(again["installed"], [])
        self.assertEqual(again["skipped"], list(demo_document_types()))
        self.assertEqual(len(self.workspace.list_documents()), len(demo_document_types()))

    def test_remove_deletes_only_demo_documents(self) -> None:
        install_demo_documents(self.workspace)
        profile = self.workspace.list_profiles()[0]
        own = self.workspace.create_document({
            "profile_id": profile["id"],
            "document_type": "proposal",
            "title": "我的开题报告",
            "template_version": "0.1.0-dev.1",
            "schema_version": "0.2",
        })
        removed = remove_demo_documents(self.workspace)
        self.assertEqual(removed["removed"], len(demo_document_types()))
        remaining = [item["id"] for item in self.workspace.list_documents()]
        self.assertEqual(remaining, [own["id"]])

    def test_install_uses_the_active_profile_when_one_exists(self) -> None:
        profile = self.workspace.save_profile({
            "full_name": "林知远",
            "student_number": "202300302001",
            "college": "新材料与新能源学院",
            "major": "新能源科学与工程",
            "class_name": "新能源2班",
            "advisor_name": "周明远",
            "advisor_title": "副教授",
            "graduation_cohort": "2027届",
            "thesis_title": ["示例题目"],
            "thesis_title_en": "Sample",
        })
        result = install_demo_documents(self.workspace)
        self.assertEqual(result["profile_id"], profile["id"])
        self.assertEqual(len(self.workspace.list_profiles()), 1)
        for record in self.workspace.list_documents():
            self.assertEqual(record["profile_id"], profile["id"])


if __name__ == "__main__":
    unittest.main()
